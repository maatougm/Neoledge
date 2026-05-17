# Agent Orchestra — Status

**Final state of the 5-phase upgrade.** Last update: 2026-05-17.

---

## TL;DR (in two numbers)

| Surface | Before | After | Win |
|---|---|---|---|
| Cahier `/preview` (end-to-end) | **108 s** | **21–30 s** | **-72 to -81%** |
| Backlog `/generate-backlog` | **502 timeout** | **61 s** | broken → working |
| Assignment `/suggest-assignments` (5 WPs) | **50 s** | **27 s** | **-47%** |
| Eval suite (5 fixtures) | 60/100 (with transient 500s) | **100/100** | quality verified |
| Eval suite runtime | ~20 min (mostly timeouts) | **131 s** | **~8.5×** |

All wins measured on the live test server (`https://neoleadge.pythagore-init.com`) running Z.AI `glm-5-turbo`. No additional infrastructure cost; same provider, same plan.

---

## What shipped

### Phase 1 — Parallel tool calls in the agent runtime
- `web/back-nest/src/ai/agent/openai-compatible-tool-loop.ts` — each iteration now executes every `tool_call` in an assistant message concurrently via `Promise.all` while preserving OpenAI's required tool-reply ordering.
- Two unit tests lock in the invariants (parallel timing + reply-order + failure isolation).
- `parallel_tool_calls: true` set explicitly on every chat-completions POST so OpenAI-compatible providers (Z.AI, Moonshot, Groq) all honor it.

### Phase 2 — Eval harness
- `scripts/eval-cahier.mjs` (~700 LOC, zero dependencies beyond Node built-ins).
- 5 curated fixtures under `tests/eval/cahier-dataset/` covering rich, sparse, contradictory, francophone, and bilingual data shapes.
- Scoring on three axes: fact-grounding (50%), anti-hallucination (30%), French-style judge (20%) — judge model **must differ from the model under test** (explicit blocklist guard).
- `npm run eval:cahier` wrapper.
- Auto-generated report at `docs/AI_EVAL.md` (overwritten per run, never appended).
- CI-suitable exit codes (0 if suite ≥ threshold, 1 otherwise).

### Phase 4 — pgvector semantic retrieval (plan ready, not executed)
- `docs/agent-orchestra/PHASE_4_PGVECTOR_PLAN.md` — full 8-day execution plan with 10 staged gates, written by the architect agent.
- Decisions baked in: `intfloat/multilingual-e5-small` self-hosted in the existing FastAPI service; vector(384) columns on `TranscriptSegments` / `ProjectFieldValues` / `MeetingTranscripts`; HNSW indexes with `CREATE INDEX CONCURRENTLY`; image swap to `pgvector/pgvector:pg16`.
- Two new agent tools designed: `read_relevant_meeting_excerpts` + `read_relevant_questionnaire`.
- Estimated cahier prompt-size reduction: 40% on sparse projects, 55–60% on dense.

### Phase 5 — Planner / Worker pattern (cahier + backlog + assignment)
The cahier read set is deterministic: every generation always wants the same six tools. An agent loop with N round-trips to the LLM is the wrong architecture for that. The planner-worker pattern collapses it to:

```
                 parallel reads (Promise.all)
                          |
                          v
                   context blob (formatted)
                          |
                          v
            single LLM call with tools=[] +
            maxIterations=1 + forced emit_*
```

- `runCahierPlannerWorker` in `cahier-agent.ts` — 6 deterministic reads (project_summary, questionnaire, validated_cahier, meeting_summaries, validation_feedback, glossary) + worker-specific system prompt.
- `runBacklogPlannerWorker` in `backlog-agent.ts` — same shape with backlog-appropriate reads (driver-only questionnaire, past backlogs).
- `runAssignmentPlannerWorker` in `assignment-agent.ts` — project_summary + candidate_tasks + project_members + glossary; skips `read_member_history` because `read_project_members` payload now carries top-3 `recentResolvedTitles` per user.
- `runReadSafely` wraps each read in a per-handler try/catch — one failing read becomes a structured `{error: ...}` in the context blob; the worker emits `INFO_MANQUANTE` for that section instead of hallucinating.
- `formatContextBlob` joins reads as `## SECTION\n<json>` chunks with a 6 KB per-section truncation guard.

### Phase 5 follow-up — `CAHIER_PLANNER_SKIP_CRITIQUE`
Initial measurement showed the planner-worker's win was eaten by `runSelfCritique` post-processing. The second flag skips that pass for the planner path (the worker received a deterministic context blob in a single LLM call with no opportunity to drift mid-generation; the grounding regex still runs). End-to-end cahier dropped from 123 s → 21 s after the flag landed.

Trade-off documented: skipping critique loses a second-pass French-style polish; in one test fixture the model added `"react/vue à confirmer"` instead of `INFO_MANQUANTE`. The eval harness (Phase 2) is the monitoring tool for any further drift.

---

## Production flag state (test server)

```
AI_PROVIDER=zai
AI_FALLBACK_MODEL=glm-5-turbo
AI_MODEL=glm-5-turbo
CAHIER_AI_MODEL=glm-5-turbo

CAHIER_USE_PLANNER=on
CAHIER_PLANNER_SKIP_CRITIQUE=on
BACKLOG_USE_PLANNER=on
ASSIGNMENT_USE_PLANNER=on
AI_AGENT_MODE=all
LIVE_MEETING_COPILOT=on
```

**Rollback path:** any planner-worker can be disabled by flipping its flag to `off` in `.env.prod` and restarting the server. No code redeploy. Backups of `.env.prod` from prior states are kept on the server as `.env.prod.bak{,2,3}`.

---

## What was *not* done

### Phase 3 — Streaming partial sections
**Status:** deliberately deferred.
**Rationale:** the cahier dropped from 108 s to ~25 s with Phase 5. The marginal UX gain from streaming sections (PM sees "first section in 5 s" instead of "all sections in 25 s") is much smaller than originally scoped. Would still help for the rare 60-90 s tail, but no longer the highest-leverage piece.

### Live-meeting copilot planner-worker
**Status:** not applicable in the clean planner-worker form.
**Rationale:** the copilot's read set is *not* deterministic. It depends on transcript state (which segments to re-read, which keywords to look up) and PM actions (which questions were already asked). The agent loop is the right shape there. A *hybrid* version is feasible (precompute the deterministic reads in parallel on the first fire, fall through to the loop after) — not yet pursued.

### Phase 5 follow-up for backlog + assignment
The cahier path is the only one with a follow-on `runSelfCritique` step. Backlog and assignment don't have an equivalent critique pass today, so no `*_SKIP_CRITIQUE` flag is needed for them.

---

## Architecture insight (the real "why")

The agent-loop pattern is correct when **the model needs to decide what to read next based on previous reads**. For tasks where the read set is fixed up-front — cahier, backlog, assignment — the loop spends one LLM round-trip per tool call to make a decision that's actually deterministic. That's the latency we recovered.

Phase 1 (parallel tool calls) tried to fix this from inside the loop, but the model still emits one tool_call per turn on the cahier prompt, so the parallel runtime had nothing to parallelize. Phase 5 fixed it by removing the decision entirely: hand the worker every read in one context blob and force the emit.

This pattern generalizes to any task with a deterministic plan. The live copilot is the natural counter-example.

---

## Eval methodology (for re-runs)

```bash
# Full suite
node scripts/eval-cahier.mjs

# Single fixture, no judge
EVAL_FIXTURE_FILTER=01-ged-rich EVAL_SUITE_THRESHOLD=0 node scripts/eval-cahier.mjs

# With judge (requires the key)
EVAL_LLM_API_KEY=<z.ai key> node scripts/eval-cahier.mjs
```

The harness drives the live backend through admin APIs: creates a temp project, seeds questionnaire fields + transcripts, calls `/cahier-des-charges/preview`, scores the output, deletes the temp project. Idempotent and safe to run repeatedly.

Latest results (2026-05-17, planner-worker active):

| Fixture | Score | Preview |
|---|---|---|
| 01-ged-rich | 100/100 | 30 s |
| 02-ged-sparse | 100/100 | 25 s |
| 03-workflow-contradictory | 100/100 | 27 s |
| 04-deployment-francophone | 100/100 | 26 s |
| 05-documentation-bilingual | 100/100 | 25 s |
| **Suite weighted** | **100/100** | **131 s total** |

---

## Files of record

```
docs/agent-orchestra/
  STATUS.md                        — this file
  PHASE_4_PGVECTOR_PLAN.md         — 8-day pgvector execution plan
  PHASE_5_FINDINGS.md              — measurement notes, decision audit
docs/AI_EVAL.md                    — auto-generated per eval run

web/back-nest/src/ai/agent/
  openai-compatible-tool-loop.ts   — Phase 1 parallel refactor
  agent-runner.service.spec.ts     — invariant tests

web/back-nest/src/cahier-des-charges/
  cahier-agent.ts                  — runCahierAgent + runCahierPlannerWorker
  cahier-des-charges.service.ts    — flag-gated dispatch

web/back-nest/src/ai/
  backlog-agent.ts                 — runBacklogAgent + runBacklogPlannerWorker
  backlog.service.ts               — flag-gated dispatch
  assignment-agent.ts              — runAssignmentAgent + runAssignmentPlannerWorker

web/back-nest/src/work-packages/
  work-packages.service.ts         — assignment dispatch

deploy/neoleadge/
  docker-compose.prod.yml          — all 4 planner-worker env mappings

scripts/
  eval-cahier.mjs                  — Phase 2 harness
  eval-assignment.mjs              — assignment latency probe
  live-cahier-hallucination-test.mjs (existing)
  agent-mode-smoke.mjs (existing)
  copilot-live-smoke.mjs (existing)

tests/eval/cahier-dataset/         — 5 fixtures
tests/eval/README.md               — harness usage
```

---

## Suggested next move

If you want to continue:

1. **Run the eval harness on a schedule (weekly)** with the LLM-judge enabled, capture trends. Any model swap or prompt change can be evaluated against a baseline.
2. **Phase 4 (pgvector)** if you want to compound the latency win — would reduce prompt size 40%+ and improve retrieval quality. 8 days of execution. Documented.
3. **Hybrid copilot planner-worker** — extracts the deterministic reads from the live-meeting copilot's first fire. Modest win (the loop is already short there), but the same template.
4. **Sit on this** — production is healthy, eval suite is 100/100, all three planner-workers default-on. Letting the change bake under real PM traffic is the cheapest experiment.
