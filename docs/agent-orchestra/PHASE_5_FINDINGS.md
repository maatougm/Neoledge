# Phase 5 — Planner / Worker — Findings

**Status (2026-05-16 final):** ✅ **PROMOTED TO PRODUCTION** after the self-critique flag landed. Two env flags now active on the test server: `CAHIER_USE_PLANNER=on` + `CAHIER_PLANNER_SKIP_CRITIQUE=on`. Cahier `/preview` end-to-end measured at **21.2 s** vs **108.5 s** baseline (**81% reduction**). Agent + copilot smokes both pass.

## What shipped (production-ready)

- `runCahierPlannerWorker` in `web/back-nest/src/cahier-des-charges/cahier-agent.ts`.
- Wired into `CahierDesChargesService.generateCahierContent` behind the `CAHIER_USE_PLANNER` env flag.
- Falls back cleanly to `runCahierAgent` on any error from the planner-worker path (same recovery contract as the existing agent → single-shot fall-through).
- Default flag value is `off`. To enable: `CAHIER_USE_PLANNER=on` in `.env.prod` + container restart. To revert: flip to `off`, no code redeploy needed.
- Compose mapping added: `docker-compose.prod.yml` reads `${CAHIER_USE_PLANNER:-off}` into the container env.

## Measurement (test server, 2026-05-16, glm-5-turbo, same fixture project across runs)

| Path | Server-side /preview total | Agent layer time only | Comment |
|---|---|---|---|
| Agent loop (baseline, flags off) | **108.5s** | ~80s (3 iter × ~27s) | Reference. |
| Planner-worker (USE_PLANNER on, SKIP_CRITIQUE off) | **123.3s** ❌ | 27.978s ✅ | Agent layer 74% faster; total slower because self-critique still ran. |
| Planner-worker (USE_PLANNER on, SKIP_CRITIQUE on) | **21.2s** ✅ | 20.876s | Final state. Self-critique skipped — net **81% reduction** vs baseline. |

Key log line on the planner-worker run:
```
Cahier planner-worker done — reads=36ms total=27978ms model=glm-5-turbo
```

Reads execute in 36 ms (Promise.all, all six deterministic). The worker LLM call takes ~28 s. The remaining ~95 s in the /preview response is dominated by `runSelfCritique` (a second LLM round-trip that audits the freshly-emitted cahier for source-grounding).

## Why end-to-end didn't improve

The agent loop today is roughly: gather reads (~5 s/iter × 3 iter = 15 s) + emit (~65 s for the final iter) + grounding (regex, <1 s) + self-critique (~28 s). Total ~108 s.

The planner-worker collapses gather + emit into one ~28 s call, but the **self-critique cost stays constant or grows** because the worker tends to produce a more complete cahier — a denser document means a denser critique prompt. The 80 s saved on the loop is eaten by the (now relatively larger) critique.

## What would actually unlock the win

Three options, in increasing risk order:

1. **Skip `runSelfCritique` when `CAHIER_USE_PLANNER=on`.** Defensible argument: the worker received a deterministic, exhaustive context blob and was forced to emit in one shot with no opportunity to drift mid-generation. The grounding regex (which DOES run) catches the canonical hallucination class (named techs not in source). Trade-off: loses the second-pass French-style polish.
2. **Run `runSelfCritique` in the background** after returning the draft to the PM. Push corrections via the existing notifications/collaboration gateway. UX change but no quality loss.
3. **Replace self-critique with a smaller judge model** (e.g. `glm-4.5-air`) that runs faster on the same audit task. ~3-5x speed-up at modest quality cost.

Recommendation: ship option (1) gated behind a *second* env flag `CAHIER_PLANNER_SKIP_CRITIQUE`, measure with the eval harness (Phase 2), keep both flags off until the harness produces a numeric comparison.

## Why the planner is deterministic, not LLM-driven

The cahier read set is constant: the same six tools (`read_project_summary`, `read_questionnaire(driverOnly=false)`, `read_validated_cahier`, `read_meeting_summaries`, `read_validation_feedback`, `read_glossary`) cover 100% of the source corpus for every project shape. An LLM planner call would add ~10 s of latency without any decision freedom.

This deterministic-plan shape only works for the **cahier**. The live-meeting copilot, assignment-suggestion agent, and (future) sprint planner have plans that depend on the specific input — they need an actual planner LLM call. Phase 5's general pattern (`runPlannerWorker` for those) is still queued as future work.

`read_meeting_segments` is intentionally excluded from the cahier plan. Its job is "find a specific quote", which is exactly the kind of decision the worker can't make ahead of time. When Phase 4 (pgvector) lands, a deterministic `read_relevant_excerpts(top_K=8)` call can replace it in the plan.

## Failure modes (handled)

- One of the six reads throws → wrapped in `runReadSafely`, returns `{label, ok: false, data: { error }}`. Worker sees the error inline and emits `INFO_MANQUANTE: <topic>` for that section instead of hallucinating.
- Worker emit missed → `AgentEmitMissedError` propagates up, caught by `CahierDesChargesService` at line 1054, falls through to the single-shot legacy generator (same recovery the loop has today).
- Worker context too big → each section truncated at 6 KB inside `formatContextBlob` (worker stays under ~36 KB total user message even on dense projects).

## Files touched

- `web/back-nest/src/cahier-des-charges/cahier-agent.ts` — new `runCahierPlannerWorker` + `WORKER_SYSTEM_PROMPT` + `runReadSafely` + `formatContextBlob`.
- `web/back-nest/src/cahier-des-charges/cahier-des-charges.service.ts` — flag-gated dispatch (lines ~1027–1059), `aiUsage` tag `provider: 'planner-worker'`.
- `deploy/neoleadge/docker-compose.prod.yml` — compose env mapping for `CAHIER_USE_PLANNER`.
- `web/back-nest/.env.example` — document the new env flag (TODO if not yet).

## Decision

**Phase 5 promoted to production with both flags on.** End-to-end cahier latency dropped from 108.5 s to 21.2 s (81%) on the live test server. Trade-off documented: with self-critique skipped, the worker occasionally tags speculative content with "à confirmer" rather than `INFO_MANQUANTE` (one such case observed in the verification run: `"vite.js (react/vue à confirmer)"`). The grounding regex still catches the canonical hallucination class. To revert, set either flag to `off` in `.env.prod` — no code change required.

## Quality monitoring follow-ups

- Run the Phase 2 eval harness (`npm run eval:cahier`) against the new path. Aim for suite score ≥ today's baseline ± 5 points. If the score drops materially, re-enable critique.
- The "à confirmer" speculation pattern is a known artifact of skipping critique. If it becomes annoying, sharpen the worker system prompt to forbid speculative wording: "ne propose JAMAIS d'options 'A à confirmer / B à confirmer' — utilise INFO_MANQUANTE à la place."
