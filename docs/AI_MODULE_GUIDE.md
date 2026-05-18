# NeoLeadge AI Module — Engineering Guide

> **Audience:** engineers ramping up on NeoLeadge's AI surface area, or anyone
> touching `src/ai/`, `src/cahier-des-charges/`, `src/meetings/live-copilot.*`,
> or `src/ai-usage/`.
>
> **Last updated:** 2026-05-18 (post Phase 1-5 delivery: parallel tool calls,
> eval harness, section streaming, pgvector retrieval, planner-worker).
>
> **Scope:** the NestJS backend only. The Vue frontend is a consumer — when
> it speaks to AI, it goes through the HTTP endpoints catalogued in §11.
> The Python `web/Transcription/` service is documented at the boundary
> (one endpoint: `/embed`); its internals are out of scope here.

---

## Table of contents

1. [Executive overview](#1-executive-overview)
2. [Provider topology](#2-provider-topology)
3. [Agent runtime (`AgentRunnerService`)](#3-agent-runtime-agentrunnerservice)
4. [The OpenAI-compatible tool loop](#4-the-openai-compatible-tool-loop)
5. [Tools catalog (read + emit)](#5-tools-catalog-read--emit)
6. [Feature: meeting transcript analysis](#6-feature-meeting-transcript-analysis)
7. [Feature: cahier des charges](#7-feature-cahier-des-charges)
8. [Feature: AI backlog](#8-feature-ai-backlog)
9. [Feature: assignment suggestions](#9-feature-assignment-suggestions)
10. [Feature: live meeting copilot](#10-feature-live-meeting-copilot)
11. [Semantic retrieval (pgvector)](#11-semantic-retrieval-pgvector)
12. [Embeddings indexer + backfill](#12-embeddings-indexer--backfill)
13. [AI usage logging + budgets](#13-ai-usage-logging--budgets)
14. [Anti-hallucination defences](#14-anti-hallucination-defences)
15. [Eval harness (cahier + retrieval)](#15-eval-harness-cahier--retrieval)
16. [Test suite (unit + integration)](#16-test-suite-unit--integration)
17. [HTTP endpoint catalog](#17-http-endpoint-catalog)
18. [Environment variable matrix](#18-environment-variable-matrix)
19. [File map](#19-file-map)
20. [Operational runbook](#20-operational-runbook)
21. [Known limitations](#21-known-limitations)

---

## 1. Executive overview

NeoLeadge ships **five LLM-driven features** plus one STT pipeline:

| # | Feature | Owner module | Mode(s) | Default model |
|---|---------|--------------|---------|---------------|
| 1 | Meeting transcript analysis | `src/ai/` | agent loop ⊕ single-shot fallback | `glm-4.5-air` (Z.AI) |
| 2 | Cahier des charges | `src/cahier-des-charges/` | **planner-worker** (default) ⊕ agent loop ⊕ section-mode ⊕ section-streaming (Phase 3) ⊕ single-shot | `glm-4.5-air` |
| 3 | AI backlog (Epics + Tasks) | `src/ai/` | **planner-worker** (default) ⊕ agent loop ⊕ single-shot | `glm-4.5-air` |
| 4 | Assignment suggestions (drag-drop) | `src/ai/` | **planner-worker** (default) ⊕ agent loop | `glm-4.5-air` |
| 5 | Live meeting copilot | `src/meetings/live-copilot.*` | agent loop, single emit | `glm-4.5-air` |
| 6 | STT — full-meeting | `src/meetings/assemblyai.provider.ts` ⊕ FastAPI fallback | external API | AssemblyAI Universal-2 |
| 6′ | STT — live chunks | `src/meetings/live-meeting.service.ts` | FastAPI `/transcribe` | faster-whisper `base` |
| 7 | Semantic retrieval (Phase 4) | `src/ai/embeddings/` + `agent/tools/semantic-tools.ts` | pgvector HNSW | `multilingual-e5-small` (384-d, self-hosted) |

**Key architectural pillars:**

- One agent runtime (`AgentRunnerService`) drives every tool-using feature against any **OpenAI-compatible** chat-completions endpoint. Z.AI's `glm-4.5-air` is the empirically-verified primary; OpenAI `gpt-4o-mini` is the agent fallback. Gemini is intentionally **not** supported in agent mode (no `tool_choice` parity).
- Every feature has a **single-shot fallback** triggered automatically by `AgentEmitMissedError`.
- Generation features (cahier, backlog) gate on a **non-empty driver-field check** and a **per-project daily token budget** at preflight.
- The cahier flow has a **six-layer anti-hallucination defence** (§14) after a live test caught six invented tech names on production.
- All embeddings are self-hosted (zero external API spend) — `multilingual-e5-small` runs inside the FastAPI transcription container.
- Every LLM round-trip writes one row to `AiUsage` for cost tracking + per-project rate limiting.

**Latency wins from the Phase 1-5 program** (measured against the 5-fixture eval suite):

| Feature | Before | After (planner-worker default) | Δ |
|---------|--------|--------------------------------|---|
| Cahier preview | ~108 s | ~21 s | **−81%** |
| Backlog preview | ~502 s | ~61 s | **−88%** |
| Assignment suggestions | ~50 s | ~27 s | **−46%** |
| Cahier streaming (first section visible) | — | ~7 s | new path |

Eval suite (5 fixtures, weighted): **100/100** after grounding + critique.

---

## 2. Provider topology

```
┌────────────────────────────────────────────────────────────────────────┐
│ Single-shot transcript analysis (legacy fallback path)                 │
│   src/ai/ai-provider.factory.ts → IAiProvider.analyze()                │
│                                                                        │
│  primary: AI_PROVIDER (default 'zai')                                  │
│  fallback: AI_FALLBACK_PROVIDER (default 'openai', 'none' to disable)  │
│                                                                        │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐             │
│   │ ZaiFallback  │    │   OpenAi     │    │   Gemini     │             │
│   │ Provider     │    │  Provider    │    │  Provider    │             │
│   └──────┬───────┘    └──────┬───────┘    └──────┬───────┘             │
│          │ glm-4.5-air        │ gpt-4o-mini       │ gemini-1.5-flash   │
│          ▼                    ▼                   ▼                    │
│    api.z.ai (OAI-compat)  api.openai.com    generativelanguage…       │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ Agent runtime — tool-using path                                        │
│   src/ai/agent/agent-runner.service.ts                                 │
│                                                                        │
│   Allowed providers: 'zai' | 'openai'                                  │
│   Gemini → throws AgentEmitMissedError (intentional)                   │
│                                                                        │
│   AI_PROVIDER → providerConfig() → runOpenAiCompatibleLoop()           │
└────────────────────────────────────────────────────────────────────────┘
```

**Why Z.AI primary:**
- ~10x cheaper than OpenAI gpt-4o-mini for the same prompt sizes.
- Verified tool-calling parity (`tools`, `tool_choice` free + forced, `parallel_tool_calls`).
- `glm-4.5-air` follows French instructions well — the entire product is French-first.

**Why OpenAI fallback (and not Z.AI dual-region):**
- Z.AI outages and burst-rate limits are real. The 429 → swap is automated.
- `gpt-4o-mini` matches glm-4.5-air on the cahier eval (100/100), so the fallback doesn't change quality observably.

**Why Gemini is *not* in agent mode:**
- `tool_choice: { type: "function", function: { name: ... } }` doesn't have a stable counterpart in the Gemini function-calling API. The forced-emit terminal step is critical (it's how the loop terminates), so Gemini stays available only on the legacy single-shot path.

---

## 3. Agent runtime (`AgentRunnerService`)

**File:** `src/ai/agent/agent-runner.service.ts`

A single injectable wraps:
- Provider config resolution (Z.AI vs OpenAI based on `AI_PROVIDER`).
- Iteration 0 budget assertion (`AiUsageService.assertWithinDailyBudget`).
- The loop call (`runOpenAiCompatibleLoop`).
- Post-loop AiUsage logging (success + duration + tokens).
- Mid-loop budget re-check at iteration > `BUDGET_RECHECK_AT_ITER` (4).

**Public API:**
```ts
runner.run<TOutput>(input: AgentRunInput<TOutput>): Promise<AgentRunResult<TOutput>>
runner.runDetached<TOutput>(input, onResult, onError): void   // fire-and-forget
runner.isAgentModeAvailable(provider?): boolean               // env check
```

**`AgentRunInput<TOutput>`** carries:
- `systemPrompt` — defines the agent's role.
- `userMessage?` — optional kickoff (most agents omit; loop synthesizes a generic kick).
- `tools[]` — read-only tools the model may call.
- `emitTools[]` — terminal "emit" tools.
  - **Single-emit mode**: one entry; loop forces it via `tool_choice` on the final iteration. Return value is `emitTools[0]` args.
  - **Multi-emit mode**: N entries; loop ends once every emit has been called at least once. Caller must supply `combineEmits` to fold the N tool-call args into one `TOutput`.
- `maxIterations` — per-loop iteration cap (8 for transcript, 10 for cahier, 1 for planner-worker).
- `loopTimeoutMs` — wall-clock cap (default 5 min).
- `feature` — `'cahier' | 'backlog' | 'meeting-analysis'` for AiUsage attribution.
- `projectId` — required, drives multi-tenancy in every tool handler.
- `provider?` — optional override of the configured provider.

**Defaults:**
- `DEFAULT_PER_CALL_TIMEOUT_MS = 120_000` (120 s; chosen after 45 s clipped the cahier emit on a 9-key JSON).
- `DEFAULT_LOOP_TIMEOUT_MS = 5 * 60 * 1000` (5 min wall-clock).

**Error surface:**
- `AgentEmitMissedError` — loop exited without any emit (or with missing emits in multi-emit mode). Callers catch this and fall through to single-shot.
- `AgentLoopTimeoutError` — wall-clock exceeded.
- `AgentToolValidationError` — tool args failed JSON-schema validation.
- All other thrown errors bubble (cost / token / network).

---

## 4. The OpenAI-compatible tool loop

**File:** `src/ai/agent/openai-compatible-tool-loop.ts`

The loop is **provider-agnostic**: any endpoint that implements `/chat/completions` with `tools` + `tool_choice` semantics works. Z.AI and OpenAI both pass; the function never branches on provider name.

**Loop shape:**
```
seed messages = [ system, user-kick ]
for iter in 0..maxIterations:
  if iter == last AND single-emit: tool_choice = { force emit }
  else                              : tool_choice = 'auto'
  POST /chat/completions
  parse assistant message + tool_calls
  if no tool_calls → AgentEmitMissedError
  // ─── Phase 1 — parallel tool execution ─────────────────────────
  classify every call into { parse-error | unknown | emit | read }
  fire every READ handler in parallel via Promise.all
  // ─── Reply phase ───────────────────────────────────────────────
  for each original call (IN ORDER — OpenAI requires order):
    push role:'tool' reply
  if single-emit collected ≥ 1 emit  → break
  if multi-emit  collected == all    → break
```

**Critical invariants:**
- `messages` is rebuilt in-place across iterations (no reset). Every assistant + tool turn is preserved.
- Tool replies MUST appear in the same order as `tool_calls` in the prior assistant message — OpenAI 400s if not.
- Tool handler errors are NEVER thrown out of the loop; they're surfaced to the model as `{error: 'tool_failed', message: '...'}` so it can self-correct.
- Tool result JSON is truncated to `MAX_TOOL_RESULT_CHARS_DEFAULT = 8000` chars and tagged with ` [trunc]` so the model knows it's not the full payload.
- `parallel_tool_calls: true` is explicitly sent on every request — OpenAI defaults to true but Z.AI / Moonshot / Groq pick it up from this hint.

**Why parallel** (Phase 1): when the cahier agent emits `read_questionnaire + read_meeting_summaries + read_validated_cahier` in a single assistant turn, executing them sequentially was the dominant cost of the loop. Most reads are independent DB queries; firing them via `Promise.all` saves the round-trip difference. With single-emit cahier-prompted models still emitting one read per turn, the win is modest — the bigger win came from Phase 5 (planner-worker), which removed the decision entirely.

---

## 5. Tools catalog (read + emit)

All tools live under `src/ai/agent/tools/`. They share `ToolContext` (projectId, logger, prisma, maxResultChars) and a JSON-schema parameter definition (no `class-validator` — these schemas go straight onto the OpenAI tool-calling wire).

### Read tools (idempotent, no side effects)

| Tool | File | Purpose | Used by |
|---|---|---|---|
| `read_project_summary` | `project-tools.ts` | Name, client, status, dates, PM, member count | all agents |
| `read_questionnaire` | `project-tools.ts` | Field labels + answers; `driverOnly: true` for backlog drivers | cahier, backlog |
| `read_validated_cahier` | `project-tools.ts` | Last saved `aiOutput` JSON (priority source if `saved: true`) | cahier, backlog |
| `read_validation_feedback` | `project-tools.ts` | Past `CahierFeedback` rejection comments | cahier |
| `read_meeting_summaries` | `project-tools.ts` | List of `MeetingTranscript.aiSummary` strings | cahier, backlog |
| `read_meeting_segments` | `cahier-tools.ts` | Keyword search across `TranscriptSegment.text` | cahier |
| `read_relevant_meeting_excerpts` | `semantic-tools.ts` | pgvector top-K segments by cosine similarity | cahier (Phase 4) |
| `read_relevant_questionnaire` | `semantic-tools.ts` | pgvector top-K field values by similarity | cahier (Phase 4) |
| `read_past_backlogs` | `project-tools.ts` | Existing `WorkPackage` rows so the agent doesn't duplicate | backlog |
| `read_glossary` | `glossary-tools.ts` | Defined business terms (Elise, GED, Neoform…) | all agents |
| `read_segments` (chunked) | `transcript-tools.ts` | Paginated segments for the transcript agent | transcript |
| `read_other_meeting_summaries` | `transcript-tools.ts` | Sibling meetings on the same project | transcript |
| `read_transcript_metadata` | `transcript-tools.ts` | Duration, language, speaker count | transcript |
| `read_candidate_tasks` / `read_project_members` / `read_member_history` | `assignment-tools.ts` | Candidate WPs + team (eligibility-filtered, see §9) + per-member history | assignment |
| `read_questionnaire_status` / `read_meeting_state` | `copilot-tools.ts` | Live-copilot context (covered topics, missing answers) | copilot |

### Emit tools (terminal, ends loop)

| Tool | Owner agent | Single/Multi | Output shape |
|---|---|---|---|
| `emit_summary`, `emit_action_items`, `emit_decisions` | transcript | **multi** (3 emits) | `{ summary, actionItems[], decisions[] }` (merged by `combineEmits`) |
| `emit_cahier` | cahier | single | `CahierAiResult` (9 keys) |
| `emit_backlog` | backlog | single | `ProposedBacklog` (epics + tasks) |
| `emit_assignments` | assignment | single | `{ items: [{ wpId, suggestions[] }] }` |
| `emit_checklist` | copilot | single | `{ items[], coverage[] }` |

### Why JSON-schema and not Zod / class-validator

The CLAUDE.md rule "DTOs are classes" applies to `@Body()` request payloads. Tool argument schemas are **not** DTOs — they serialise directly onto the OpenAI function-calling wire format. `class-validator` decorators would erase under JIT and never reach the model. So tools use the tiny `json-schema.ts` helpers: `obj()`, `str()`, `arr()`, `num()`, `int()`, `bool()`, `enum_()`.

---

## 6. Feature: meeting transcript analysis

**Entry:** `AiService.analyzeTranscript(transcriptId)` in `src/ai/ai.service.ts`.

**Trigger:** fire-and-forget after `MeetingsService.uploadTranscript` finishes the STT job. Sets `MeetingTranscript.aiStatus = 'processing'` (concurrency guard via `updateMany` with `aiStatus: { not: 'processing' }`).

**Two paths, picked at runtime:**
1. **Agent mode** (`AI_AGENT_MODE` includes `'transcript'` or `'all'`)
   - Runs `runTranscriptAgent` in `src/ai/transcript-agent.ts`.
   - Tools: `read_transcript_metadata`, `read_segments(offset, limit)`, `read_other_meeting_summaries`, `read_glossary`.
   - Multi-emit: `emit_summary` + `emit_action_items` + `emit_decisions` (all three must fire).
   - On `AgentEmitMissedError`, falls through to single-shot.

2. **Single-shot** (`singleShotAnalyze`)
   - Sends the full transcript + the prompt from `src/ai/prompts/transcript-prompt.ts` to the primary provider.
   - `ZaiFallbackProvider.analyze()` is the workhorse; OpenAI is the fallback via `AiProviderFactory.getFallback()`.
   - Parses `{ summary, actionItems, decisions }` directly from the JSON response.

**Persistence (transactional):**
```
clear prior MeetingActionItem + MeetingDecision rows
update MeetingTranscript { aiSummary, aiStatus: 'completed', aiProcessedAt, aiModel }
createMany MeetingActionItem
createMany MeetingDecision
```

**Side effects:**
- `ProjectActivity` row written for the activity feed (`ai_analysis_completed`).
- Notification to the project PM (`notifyEnhanced` with `entityType: 'meeting'`).
- **Phase 4** — `EmbeddingIndexerService.indexAndStore('summary', ...)` fire-and-forget. Failure logs but doesn't crash.

**Stuck-row sweep:** `onModuleInit` marks any `aiStatus: 'processing'` row older than 10 min as `failed` so a server restart doesn't leave rows in limbo.

**Why agent mode for transcript:** the agent can self-paginate when transcripts are huge (instead of trying to fit 200 segments into one prompt). The single-shot still wins on cost for short meetings, so agent mode is opt-in via `AI_AGENT_MODE`.

---

## 7. Feature: cahier des charges

**File:** `src/cahier-des-charges/cahier-des-charges.service.ts` (~2000 LOC; the largest service in the project for a reason — see §14).

The cahier has **five distinct generation paths**, picked in this order:

```
1. assertDriverFieldsFilled(projectId)
2. assertWithinDailyBudget(projectId, promptTokens + 12_000)

if AI_AGENT_MODE includes 'cahier' AND agent provider available:
  if CAHIER_USE_PLANNER='on'  → runCahierPlannerWorker  ← DEFAULT in prod
  else                         → runCahierAgent
  + applyGroundingCheck
  + runSelfCritique (unless CAHIER_PLANNER_SKIP_CRITIQUE='on')
  ↓ on AgentEmitMissedError, fall through to:

if CAHIER_SECTION_MODE='on':
  generateInThreeGroups (3 parallel Z.AI calls — intro/scope/delivery)
  + grounding + critique

else: single-shot
  primary provider → on error → fallback provider
  + grounding + critique
```

### 7.1 Planner-worker path (default in prod)

**File:** `src/cahier-des-charges/cahier-agent.ts → runCahierPlannerWorker`.

The cahier's read set is **deterministic** — we always want the same six tools. The model's "decide which tool to call" loop spends one LLM round-trip per decision that's actually constant. Phase 5 collapses this:

1. **Parallel reads** (`Promise.all`):
   - `readProjectSummaryTool({})`
   - `readQuestionnaireTool({ driverOnly: false })`
   - `readValidatedCahierTool({})`
   - `readMeetingSummariesTool({})`
   - `readValidationFeedbackTool({})`
   - `readGlossaryTool({})`
2. **Format context blob** — concatenate the 6 read outputs with `## LABEL\n<json>` headers; truncate each section at 6000 chars.
3. **Single-shot worker call** — `maxIterations: 1`, `tools: []`, `emitTools: [emitCahierTool]`. The runtime forces `emit_cahier` on iteration 0. No loop.

`read_meeting_segments` (keyword-driven, query-specific) is intentionally excluded — its job is "find a specific quote I'm missing", which the single-shot worker cannot decide it needs on the fly. Phase 4 added pgvector retrieval that closes this gap in the agent loop, but the planner-worker remains the default because measurements showed it beats the loop on every cahier eval fixture.

**Measured impact:** cahier preview 108 s → 21 s (−81%) on the eval suite. 100/100 eval score retained.

### 7.2 Agent loop path

**File:** `cahier-agent.ts → runCahierAgent`.

Used when `CAHIER_USE_PLANNER` is off OR the planner-worker throws `AgentEmitMissedError`. Same tools, but the model decides the order.

When `CAHIER_USE_SEMANTIC_RETRIEVAL='on'`, `buildSemanticTools(embeddings, logger)` adds two extra tools (`read_relevant_meeting_excerpts`, `read_relevant_questionnaire`) and swaps the system prompt to `SYSTEM_PROMPT_WITH_SEMANTIC`, which instructs the model to prefer semantic search and fall back to keyword search only when sparse.

### 7.3 Section-mode (3 parallel focused calls)

`generateInThreeGroups` runs 3 Z.AI calls in parallel:
- **`intro`** group emits `objectifDocument`, `contexte`, `objectifProjet`.
- **`scope`** group emits `perimetreInclus`, `perimetreExclus`, `exigencesFonctionnelles`.
- **`delivery`** group emits `architectureTechnique`, `livrables`, `conclusion`.

Each group's system prompt is the full anti-hallucination preamble + a schema narrowed to its 3 keys. Splitting the 9-key generation into 3 focused 3-key generations was a **hallucination-rate** intervention as much as a latency one — the model is less prone to "fill the blanks" pressure on a 3-key emit than a 9-key emit.

Behind `CAHIER_SECTION_MODE='off'` flag — *not* the default since planner-worker landed.

### 7.4 Section-streaming (Phase 3)

**Endpoint:** `GET /pm/projects/:projectId/cahier-des-charges/preview-stream` (Server-Sent Events).

**Service entry:** `streamCahierContent(formData, transcripts, projectId, onEvent, signal?)`.

Runs the same 3-group parallel structure as section-mode, but emits each group as it lands via SSE instead of waiting for all 3:

```
event: started      data: {"totalGroups":3,"transcriptCount":N}
event: section      data: {"group":"intro","partial":{...},"latencyMs":N}
event: group_error  data: {"group":"scope","message":"..."}
event: complete     data: {"aiContent":{...},"durationMs":N}
event: error        data: {"message":"..."}
event: aborted      data: {"reason":"client_disconnected"}
```

**Trade-off:** 3× LLM calls vs the planner-worker's single call. First section visible in ~7 s; full document in ~14 s. Self-critique skipped (would re-introduce the wall-time the streaming win recovered). Grounding regex still runs per-section.

Behind `CAHIER_STREAM_SECTIONS='on'` (default). When `off`, the endpoint still works but emits one `complete` event after the standard `/preview` path — keeps the client-side wire format stable across flag flips.

**Frontend consumer:** `web/Front/customapp/src/lib/cahier-stream.ts` — fetch + ReadableStream + SSE frame parsing (EventSource can't carry the JWT). `CahierDesChargesSection.vue` renders sections progressively with skeleton placeholders for not-yet-arrived groups.

### 7.5 Single-shot (legacy fallback)

Bypasses both the agent and section-mode paths; sends one provider call with the full prompt. Used when both other paths failed.

### 7.6 Grounding + self-critique

After every path produces a cahier:

1. **`applyGroundingCheck`** — scans the output for `KNOWN_TECH_NAMES` (PostgreSQL, AWS, DocuSign, …) and rewrites any name absent from the project's source corpus as `INFO_MANQUANTE: <name>`. Idempotent. Word-boundary matching. Disambiguated names ("vue.js" instead of "vue") to avoid French collisions.
2. **`runSelfCritique`** — a second LLM call where the model re-reads its own output against the source corpus and emits a corrected version. Adds ~90 s; skipped on the planner-worker path when `CAHIER_PLANNER_SKIP_CRITIQUE='on'` (the default) because the worker saw a deterministic context blob with no opportunity to drift.

---

## 8. Feature: AI backlog

**File:** `src/ai/backlog.service.ts` (entry) + `src/ai/backlog-agent.ts` (agent loop + planner-worker).

**Output:** `ProposedBacklog = { epics: [{ title, description, priority, estimatedHours, children: Task[] }] }` — sanitized via `sanitizeBacklog()` before persistence.

**Two paths:**
1. **Planner-worker** (`BACKLOG_USE_PLANNER='on'`, default) — `runBacklogPlannerWorker` fires parallel reads of:
   - project summary, driver-only questionnaire, validated cahier, meeting summaries, existing backlog, glossary.
   - Then single-shot `emit_backlog`.
   - **Measured impact:** 502 s → 61 s.
2. **Agent loop** — `runBacklogAgent` — model decides tool order. Same tools as planner.

**Lifecycle:**
- `BacklogService.preview(projectId)` — generates without writing to DB. PM reviews + edits in the UI.
- 30 s in-memory cooldown per `(projectId, userId)` prevents accidental burn from double-clicks.
- `BacklogService.accept(projectId, backlog, userId)` — persists `WorkPackage` rows in a transaction. Each row carries `aiGeneratedFrom: 'backlog-preview-<timestamp>'` for traceability.

**Anti-hallucination rule** (in the system prompt): if a functional area is mentioned without details, emit a minimal "Investigation: <topic>" epic with a "Définir <topic> avec le client" task instead of inventing tasks.

---

## 9. Feature: assignment suggestions

**File:** `src/ai/assignment-agent.ts`.

**Use case:** PM drags multiple WorkPackages onto the "À répartir" column and asks the agent to recommend assignees. The agent ranks up to 3 candidates per WP by confidence (0.60–1.0).

**Eligibility filter — single source of truth across 3 surfaces:**

Per-project team selection was deliberately removed earlier; the PM should be able to assign any Member or SpecificationTeam user without first adding them to a `ProjectMember` row. The eligible set on every assignment-related surface is the **same union**:

- The project's own PM (so they can self-assign), AND
- Every active user with role ∈ `{Member, SpecificationTeam}`.

Admins and PMs from **other** projects are excluded — they have no place on this project's task board. The three surfaces that enforce this union and MUST stay aligned:

| Surface | File | Role |
|---|---|---|
| Dropdown source | `GET /pm/projects/:id/assignable-users` (`pm.controller.ts`) | What the UI shows |
| AI tool | `read_project_members` (`agent/tools/assignment-tools.ts`) | What the agent suggests from |
| Write-path validation | `WorkPackagesService.bulkAssign` (`work-packages.service.ts`) | What the backend accepts |

If you tighten one, tighten all three or you'll re-introduce the class of bug where the dropdown shows users the backend then rejects with `Certains utilisateurs ne sont pas assignables sur ce projet`.

Side effect on a successful assignment: `bulkAssign` calls `ensureProjectMembership(projectId, assigneeId)` which idempotently inserts a `ProjectMember` row so the assignee gains read access to the project. Assignment **creates** membership; it does not require it as a precondition.

**Signal hierarchy** (from the system prompt):
1. **`jobTitle`** — strongest signal. "Backend Engineer" → API tasks; "QA" → Bug tasks; "DevOps" → infra.
2. **`recentResolvedTitles`** — last 3 delivered tasks on this project. More reliable than jobTitle when they diverge.
3. **`department`** — secondary signal when jobTitle is ambiguous.
4. **Platform `label`** ("Member", "SpecificationTeam") — coarse; never used alone.
5. **`inProgressCount`** — tie-breaker (penalise > 5 WPs in progress).
6. **`totalAssignedThisProject`** — secondary tie-breaker.

**Confidence floor:** `< 0.60` → omit the suggestion entirely (better silence than noise).

**Paths:**
1. **Planner-worker** (`ASSIGNMENT_USE_PLANNER='on'`, default) — parallel reads of candidates + members + history, then single-shot `emit_assignments`.
2. **Agent loop** — model decides order.

---

## 10. Feature: live meeting copilot

**File:** `src/meetings/live-copilot.service.ts` + `live-copilot.gateway.ts` (Socket.IO) + `live-copilot.prompt.ts`.

A **real-time** agent that listens to a live meeting transcript and maintains:
- A **checklist** of topics-to-collect (categorised by `CahierSection` — "Contexte", "Périmètre", …).
- Per-item **status**: `not_covered` → `partial` → `covered` (with an evidence snippet).
- **Suggestion cards** — questions the PM should ask to fill gaps, with urgency.

**Trigger model:** the gateway calls `service.fireSuggest(sessionId, transcriptAppend)` every N characters of new transcript. The service decides whether to actually fire the agent based on:
- Min character delta since last fire.
- Max frequency (cooldown).
- Whether any not-covered topics still exist.

**Agent shape:**
- Single emit (`emit_checklist`), `maxIterations: 6`.
- Reads: `read_project_summary`, `read_questionnaire`, `read_validated_cahier`, `read_glossary`, plus the live-only `read_meeting_state` (current covered topics + transcript window).

**Why this isn't a planner-worker:** the read set depends on the meeting state and the PM's actions. Each fire is genuinely different. The agent loop is the right shape here — and `LIVE_MEETING_COPILOT='on'` is the gate.

**Persistence:** in-process state map per `liveSessionId`, swept every 5 min. Suggestion cards the PM acted on (asked/dismissed) are persisted to `LiveMeetingSuggestion` for audit.

---

## 11. Semantic retrieval (pgvector)

**Phase 4 deliverable.** Replaces keyword search with cosine-similarity nearest-neighbour search over self-hosted embeddings.

### Architecture

```
[NestJS server]  ──HTTP──▶  [FastAPI /embed]  ──▶  multilingual-e5-small
     │                                                  (384-dim)
     │                                                       │
     │  SELECT … 1 - (embedding <=> $1::vector)              │
     ▼                                                       │
[PostgreSQL 16 + pgvector]  ◀───── stores 384-dim vectors ───┘
     │
     │  HNSW indexes (m=16, ef_construction=64)
     ▼
  3 columns:
   - TranscriptSegments.embedding
   - ProjectFieldValues.embedding
   - MeetingTranscripts.summaryEmbedding
```

### Why these choices

- **multilingual-e5-small (384-d)** — strong multilingual perf (French is primary), small enough to run on the transcription container's CPU at ~2 s per batch of 64.
- **Self-hosted** — zero per-call cost, no rate limits, no data-leak risk for client questionnaires.
- **e5 asymmetric prefixes** — `"passage: "` for stored text, `"query: "` for search queries. Mixing them tanks cosine similarity by ~30%. Wrapped at the `/embed` endpoint so callers can't get it wrong (`inputType` param).
- **HNSW indexes** built `CONCURRENTLY` — no write lock during the migration. `m=16, ef_construction=64` balances build time, memory, and recall.
- **Multi-tenancy** — every retrieval SQL query includes `WHERE m."projectId" = $X`. The semantic tools cross-check too (no leakage across projects).
- **Cosine via `1 - (a <=> b)`** — pgvector's `<=>` is cosine *distance* (0..2). `1 - distance` converts to similarity (0..1) for human-readable scores. `ORDER BY` uses raw distance so HNSW can serve it cheaply.

### Tools

| Tool | Schema | Returns |
|---|---|---|
| `read_relevant_meeting_excerpts` | `{ query, limit?, minSimilarity? }` | `{ hits: { segmentId, meetingId, meetingTitle, speaker, text, startTime, endTime, similarity }[], truncated }` |
| `read_relevant_questionnaire` | `{ query, limit? }` | `{ hits: { fieldLabel, fieldType, isRequired, isBacklogDriver, backlogHint, value, similarity }[], truncated }` |

Both filter `WHERE embedding IS NOT NULL` so the backfill window doesn't break retrieval (rows without embeddings just don't show up — the agent falls through to keyword tools).

### Eval results (against the 5-fixture dataset)

| Metric | Value |
|---|---|
| Recall @5 | **100% (30/30 queries)** |
| Recall @10 | 100% |
| MRR | 0.958 |
| Latency p50 / p95 | 32 ms / 47 ms |

Report at `docs/AI_EVAL_RETRIEVAL.md`.

---

## 12. Embeddings indexer + backfill

**File:** `src/ai/embeddings/embedding-indexer.service.ts`.

Combines the HTTP client (`EmbeddingsService`) with raw SQL writes to the three vector columns. Public surface:

```ts
indexAndStore(
  target: 'segment' | 'field-value' | 'summary',
  items: Array<{ id, text }>,
  opts: { projectId? }
): Promise<{ indexed: number; failed: number }>
```

Fire-and-forget callers chain `.catch(...)` to log without breaking the calling transaction. Idempotent — re-embedding overwrites prior vectors.

### Real-time hooks

Every write path that touches an indexable row fires the indexer **after** the source row is committed:

| Source path | Hook | Notes |
|---|---|---|
| `meetings.service.uploadTranscript` → `transcriptSegment.createMany` | `indexSegmentsAsync(transcriptId)` | reads back the just-inserted rows then embeds |
| `live-meeting.service.saveLiveTranscript` | `indexAndStore('segment', [...])` | single blob; verified live during Phase 4 eval |
| `ai.service.analyzeTranscript` (after analysis tx) | `indexAndStore('summary', [{id, text: result.summary}])` | embeds `aiSummary` |
| `projects.service.saveFieldValues` | `indexFieldValuesAsync(projectId, written)` | reads back the upserted rows with their field labels, embeds `"<label>: <value>"` |
| `collaboration.service.saveField` (live editing) | `scheduleEmbed(...)` with 1500 ms debounce | coalesces keystrokes |

The debounce on the live-editing path is in-process — incompatible with multi-instance scaling. The form-save path is the safety net.

### Backfill command

**File:** `src/commands/backfill-embeddings.ts`. Walks segments / field-values / summaries in batches, embedding rows where the embedding column is `NULL`. Uses `NestFactory.createApplicationContext(AppModule)` for DI.

```bash
docker exec neoleadge_server node dist/src/commands/backfill-embeddings.js \
  --table=all \
  --batch-size=32 \
  --max-rows=20000 \
  [--project-id=<uuid>] \
  [--dry-run]
```

Idempotent (`WHERE embedding IS NULL` = resume cursor). 100 ms rate-limit between batches. Field-value text is formatted `"label: value"` for semantic grounding.

---

## 13. AI usage logging + budgets

**File:** `src/ai-usage/ai-usage.service.ts`.

### What gets logged

Every LLM round-trip and every embed call writes one `AiUsage` row:
- `projectId`, `userId` — multi-tenant attribution.
- `provider` — `'zai' | 'openai' | 'gemini' | 'zai-section-mode' | 'zai-stream-sections' | 'planner-worker' | 'agent' | 'local-e5' | 'assemblyai' | 'local-whisper'`.
- `model` — `'glm-4.5-air' | 'gpt-4o-mini' | 'multilingual-e5-small' | …`.
- `feature` — `'cahier' | 'backlog' | 'meeting-analysis' | 'checklist' | 'transcribe' | 'transcribe-chunk' | 'embed'`.
- `promptTokens`, `completionTokens`, `totalTokens`.
- `audioSeconds` (STT only).
- `costEstimateUsd` — computed from per-model rates in the same file (per-1k-tokens for chat, per-second for audio).
- `durationMs`, `success`, `errorMessage`.

The agent runner emits ONE log row per loop attempt (not per iteration) — aggregated tokens across the whole loop.

### Daily token budget

**Env:** `AI_MAX_TOKENS_PER_PROJECT_PER_DAY` (default 0 = unlimited).

**Enforcement:** `assertWithinDailyBudget(projectId, estimateTokens)` aggregates `SUM(totalTokens)` over the last 24 h. If the projected total would exceed the cap, throws `ForbiddenException` with a French message ("Quota IA quotidien atteint…").

**Check points:**
- Cahier preflight (`generateCahierContent` and `streamCahierContent`): estimate prompt + 12000.
- Agent runner iteration 0: estimate 8000.
- Agent runner mid-loop re-check at iteration > 4 (post-hoc warn).

### Admin dashboard

`GET /admin/ai-usage` — paginated rows.
`GET /admin/ai-usage/summary?daysBack=30` — `summaryByProject()` aggregates per-project + per-feature totals.

---

## 14. Anti-hallucination defences

Cahier-specific — production caught six invented tech names (PostgreSQL, AWS, DocuSign…) on the first live test. The defence is six-layer:

1. **System-prompt preamble** — the cahier prompt opens with `# RÈGLE NUMÉRO UN — NE JAMAIS INVENTER` listing every category that must never be fabricated (client names, technologies, volumes, dates, KPIs, deliverable formats, modules, regulations). Includes worked examples of bad vs good output.
2. **`INFO_MANQUANTE: <topic>` marker** — when a section has no source, the model must write the marker verbatim instead of "à définir" or a paraphrase. The preflight + frontend detect markers and prompt the PM to fill the gap.
3. **PII redaction** — `src/common/pii-redact.ts` strips emails, phone numbers, addresses from transcripts before they enter the prompt. The model can't leak what it never saw.
4. **`applyGroundingCheck` regex pass** — scans the output for `KNOWN_TECH_NAMES` (PostgreSQL, AWS, DocuSign, Salesforce, …) and rewrites any name absent from `buildSourceCorpus(formData, transcripts, previousCorrectedCahier)` as `INFO_MANQUANTE`. Word-boundary matching avoids French false-positives ("vue.js" not "vue", "java spring" not "java").
5. **`runSelfCritique`** — a second LLM call where the model re-reads its own output against the source corpus and emits a corrected version. Adds ~90 s; skipped on the planner-worker path with `CAHIER_PLANNER_SKIP_CRITIQUE='on'` because the worker saw a deterministic context blob and didn't drift.
6. **Driver-fields preflight** — `assertDriverFieldsFilled` blocks generation when any `isBacklogDriver=true` field has no answer. Forces the PM to fill the critical fields before the AI ever sees the project.

The cahier eval suite (`docs/AI_EVAL.md`) scores each fixture on three axes — fact-grounding (`mustMention`), anti-hallucination (`mustNotMention`), and French style (LLM-judge). Weighted suite stays at 100/100 after grounding + critique.

---

## 15. Eval harness (cahier + retrieval)

Two independent eval scripts, both safe to run against the live test server.

### 15.1 Cahier eval — `scripts/eval-cahier.mjs`

5 fixtures under `tests/eval/cahier-dataset/`:
- `01-ged-rich` — high-volume GED migration
- `02-ged-sparse` — minimal questionnaire (stress-test for hallucination)
- `03-workflow-contradictory` — transcripts contradict the questionnaire
- `04-deployment-francophone` — French-only, SecNumCloud constraints
- `05-documentation-bilingual` — mixed FR/EN content

Each fixture has `input.json` (questionnaire + transcripts) and `expected.json` (`mustMention`, `mustNotMention`, `requiredSections`).

**Scoring** (weighted 50/30/20):
- Fact-grounding: % of `mustMention` strings present.
- Anti-hallucination: % of `mustNotMention` strings absent.
- French style: LLM-judge call returning 1–10 (judge model MUST differ from the cahier model — blocklist enforced).

```bash
node scripts/eval-cahier.mjs                  # full suite
EVAL_FIXTURE_FILTER=01-ged-rich EVAL_SUITE_THRESHOLD=0 node scripts/eval-cahier.mjs   # one fixture, no threshold
```

Outputs `docs/AI_EVAL.md`. Exit 0 if suite ≥ 80; exit 1 otherwise.

### 15.2 Retrieval eval — `scripts/eval-retrieval.mjs`

30 golden queries in `scripts/fixtures/retrieval-golden.json`. Seeds the 4 transcript-bearing fixtures, waits for embeddings to land, runs each query via `POST /admin/eval/retrieval/batch`, computes recall@5 / recall@10 / MRR.

Outputs `docs/AI_EVAL_RETRIEVAL.md`. Exit 0 if recall@5 ≥ 0.7.

### 15.3 Why two judge models matter

If the same model judges its own output, you get **self-flattery** — the judge consistently scores its sibling higher than the alternatives. The cahier eval enforces a blocklist (`CAHIER_MODELS_BLOCKLIST`) and exits 2 if the judge model is in it.

---

## 16. Test suite (unit + integration)

The AI module ships with three layers of test coverage. Layer choice matters: the eval scripts in §15 verify **AI quality** (recall, hallucination rates) against the live test server, while the test suite below verifies **code correctness** in isolation with no external API spend.

### Layer 1 — Backend unit tests (jest)

Co-located with sources under `web/back-nest/src/**/*.spec.ts`. **91 tests across 9 suites**, all green.

| Suite | What it covers |
|---|---|
| `ai/agent/agent-runner.service.spec.ts` | Tool-loop runner: provider resolution, iteration cap, budget gating, Phase 1 parallel tool-call execution, `AgentEmitMissedError` shape |
| `ai/embeddings/embeddings.service.spec.ts` | `/embed` HTTP client: batch overflow, 503 reasoning, timeout reasoning, length-mismatch, text truncation, prefix wrapping |
| `cahier-des-charges/cahier-stream.spec.ts` | Phase 3 SSE: event order (started → 3× section → complete), group_error fan-out, `zai not configured` short-circuit, AbortSignal handling, all-three-fail INFO_MANQUANTE fallback |
| `cahier-des-charges/cahier-grounding.spec.ts` | `applyGroundingCheck` (6 tests: grounded names survive, ungrounded → INFO_MANQUANTE, word-boundary safety, array title+content scanning, two-pass safety) + `runSelfCritique` (4 tests: not-configured no-op, valid correction, degenerate-result guard, LLM-throws fallback) |
| Plus 5 non-AI suites (agile, deadlines, notifications, phase-gate, work-packages) | Pre-existing — kept green during the Phase 1-5 program |

Run:
```bash
cd web/back-nest
npx jest                # full suite
npx jest src/ai         # AI subtree only
npx jest --coverage     # with coverage report
```

### Layer 2 — Backend integration tests (gated)

`web/back-nest/src/ai/embeddings/pgvector.int.spec.ts` — **10 tests**, gated on `INTEGRATION_DB_URL`. **Skipped** in the default test run; **executes** against any PostgreSQL 16 + pgvector instance when the env var is set.

Coverage:
- `EmbeddingIndexerService.indexAndStore` for all 3 targets (`segment`, `field-value`, `summary`)
- Empty-input + whitespace-only filter behavior
- Semantic SQL: top-1 cosine match, **multi-tenancy non-leakage**, `minSimilarity` floor, `WHERE embedding IS NOT NULL` backfill-window safety
- End-to-end: indexer write → cosine retrieval round-trip

**Isolation:** each run creates a unique schema (`int_<ts>_<rand>`), installs minimal table copies, runs assertions, drops the schema. Safe to point at a shared DB even with concurrent runs.

**Embeddings are stubbed** to deterministic 4-dim unit vectors keyed by input-text first-char. Keeps cosine assertions exact and avoids needing the FastAPI service running. The real `multilingual-e5-small` is already covered end-to-end by the retrieval eval (§15.2 — recall@5 = 100% on the live test server).

Run:
```bash
INTEGRATION_DB_URL=postgresql://user:pass@host:5432/db \
  npx jest src/ai/embeddings/pgvector.int
```

### Layer 3 — Frontend unit tests (vitest)

`web/Front/customapp/src/lib/cahier-stream.spec.ts` — **5 tests** for the SSE parser used by `CahierDesChargesSection.vue`:
- Frame order on the happy path
- Frame split across stream-chunk boundaries (the real bug class)
- `Authorization: Bearer <jwt>` attached from the Pinia auth store
- Non-200 server response → rejection with status code in the message
- Malformed frames (missing data line, bad JSON) silently skipped

Run:
```bash
cd web/Front/customapp
npx vitest run                    # one-off
npx vitest run src/lib/cahier-stream  # this suite only
```

### Coverage summary

| Layer | Count | Status | Runner |
|---|---|---|---|
| Backend unit | 91 | ✅ green | jest |
| Backend integration (gated) | 10 | ⏸ skipped (set `INTEGRATION_DB_URL` to run) | jest |
| Frontend unit | 5 | ✅ green | vitest |
| Eval scripts (live server) | 5 cahier fixtures + 30 retrieval queries | ✅ 100/100 + recall@5=100% | node |

---

## 17. HTTP endpoint catalog

### Cahier des charges (PM-scoped)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/pm/projects/:projectId/cahier-des-charges/preflight` | Gap analysis before generation |
| `GET` | `/pm/projects/:projectId/cahier-des-charges/preview` | One-shot generate + return JSON (no save) |
| `GET` | `/pm/projects/:projectId/cahier-des-charges/preview-stream` | **Phase 3** SSE — emit sections progressively |
| `GET` | `/pm/projects/:projectId/cahier-des-charges/generate` | Generate + return `.docx` blob |
| `POST` | `/pm/projects/:projectId/cahier-des-charges/save` | Persist `aiContent` to `Project.aiOutput` |
| `GET` | `/pm/projects/:projectId/cahier-des-charges/saved` | Last saved cahier |
| `GET` | `/pm/projects/:projectId/cahier-des-charges/status` | Validation status badge |
| `GET` | `/pm/projects/:projectId/cahier-des-charges/versions` | History (last 50) |
| `GET` | `/pm/projects/:projectId/cahier-des-charges/versions/:versionId` | One historical version |
| `PATCH` | `/pm/projects/:projectId/cahier-des-charges/content` | Manual in-place edit (preserves `savedAt`) |
| `POST` | `/pm/projects/:projectId/cahier-des-charges/feedback` | Approve / reject (feeds the next generation) |
| `GET` | `/pm/projects/:projectId/cahier-des-charges/feedback` | Past feedback list |

### Backlog

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/pm/projects/:projectId/ai/generate-backlog` | Preview (no DB write) |
| `POST` | `/pm/projects/:projectId/ai/accept-backlog` | Persist `WorkPackage` rows |

### Live meeting copilot

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/pm/projects/:projectId/meetings/live/start` | Open session |
| `POST` | `/pm/projects/:projectId/meetings/live/append` | Append transcript chunk |
| `POST` | `/pm/projects/:projectId/meetings/live/save` | Persist as `MeetingTranscript` |
| WS | `/copilot` (Socket.IO) | Real-time checklist + suggestion events |

### AI usage

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/admin/ai-usage` | Paginated rows |
| `GET` | `/admin/ai-usage/summary?daysBack=30` | Per-project aggregates |

### Admin debug

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/admin/eval/retrieval/query` | Single retrieval probe (admin only) |
| `POST` | `/admin/eval/retrieval/batch` | Batched retrieval probe (used by `eval-retrieval.mjs`) |

---

## 18. Environment variable matrix

### Provider selection

| Var | Default | Purpose |
|---|---|---|
| `AI_ENABLED` | `false` | Master switch for all AI features (some endpoints 503 when false) |
| `AI_PROVIDER` | `zai` | Primary provider for single-shot + agent paths |
| `AI_FALLBACK_PROVIDER` | `openai` | Secondary provider on primary failure (`none` to disable) |
| `AI_MODEL` | `gpt-4o-mini` | Model for non-Z.AI providers in single-shot |
| `CAHIER_AI_MODEL` | (=`AI_MODEL`) | Override the model for cahier-specific calls |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL` | — | OpenAI auth |
| `GEMINI_API_KEY` | — | Gemini single-shot only |
| `AI_FALLBACK_API_KEY` | — | Z.AI auth (also primary when `AI_PROVIDER=zai`) |
| `AI_FALLBACK_BASE_URL` | `https://api.z.ai/api/coding/paas/v4` | Z.AI base |
| `AI_FALLBACK_MODEL` | `glm-4.5-air` | Z.AI model |

### Agent mode

| Var | Default | Purpose |
|---|---|---|
| `AI_AGENT_MODE` | `off` | Comma list or `all`: `transcript`, `cahier`, `backlog`, `assignment` |
| `LIVE_MEETING_COPILOT` | `off` | Toggles the live copilot agent |

### Phase 1-5 + retrieval flags

| Var | Default | Effect |
|---|---|---|
| `CAHIER_USE_PLANNER` | `on` | Cahier uses planner-worker (single-shot) instead of agent loop |
| `CAHIER_PLANNER_SKIP_CRITIQUE` | `on` | Skip the self-critique pass in planner-worker (saves ~90 s) |
| `CAHIER_USE_SEMANTIC_RETRIEVAL` | `on` | Register pgvector semantic tools alongside keyword tools |
| `CAHIER_STREAM_SECTIONS` | `on` | Section-streaming SSE path active |
| `CAHIER_SECTION_MODE` | `off` | Non-streaming 3-group fan-out |
| `BACKLOG_USE_PLANNER` | `on` | Backlog uses planner-worker |
| `ASSIGNMENT_USE_PLANNER` | `on` | Assignment uses planner-worker |

### Embeddings

| Var | Default | Purpose |
|---|---|---|
| `TRANSCRIPTION_URL` | `http://transcription:8000` | FastAPI base URL (docker-internal in prod) |
| `TRANSCRIPTION_SECRET` | — | Shared secret for `/embed`, `/transcribe` |
| `EMBEDDING_TIMEOUT_MS` | `30000` | Per-call timeout on `/embed` (was `15000` in early Phase 4) |

### Budgets + safety

| Var | Default | Purpose |
|---|---|---|
| `AI_MAX_TOKENS_PER_PROJECT_PER_DAY` | `0` (unlimited) | Daily token cap per project |

### Test gating

| Var | Default | Purpose |
|---|---|---|
| `INTEGRATION_DB_URL` | unset (suite skipped) | Postgres connection string for `pgvector.int.spec.ts`. Must point at an instance with the `vector` extension available. |
| `EVAL_BACKEND_URL` | `https://neoleadge.pythagore-init.com` | Target backend for `eval-cahier.mjs` and `eval-retrieval.mjs`. |
| `EVAL_PM_EMAIL` / `EVAL_PM_PASSWORD` | `admin@neoleadge.com` / `Admin@123` | Admin login used by the eval scripts to drive the API. |
| `EVAL_LLM_BASE_URL` / `EVAL_LLM_API_KEY` / `EVAL_LLM_JUDGE_MODEL` | Z.AI / — / `glm-4.5-air` | Cahier eval LLM-judge config. Judge model MUST differ from the cahier model (blocklist enforced). |
| `EVAL_FIXTURE_FILTER` | unset | Substring filter to run a single fixture (e.g. `01-ged-rich`). |
| `EVAL_SUITE_THRESHOLD` | `80` | Cahier eval pass/fail score threshold. |
| `RETRIEVAL_RECALL_THRESHOLD` | `0.7` | Retrieval eval pass/fail recall@5 threshold. |
| `EVAL_SKIP_CLEANUP` | unset | Set to `1` to leave the seeded projects in place after a run (debugging). |

---

## 19. File map

### `src/ai/`
```
ai.module.ts                       Registration; @Global re-exports EmbeddingsModule
ai.service.ts                      analyzeTranscript() entry; stuck-row sweep
ai.types.ts                        AiAnalysisResult, AiActionItemInput, AiDecisionInput
ai-provider.factory.ts             primary/fallback resolution for non-agent paths
assignment-agent.ts                runAssignmentAgent + runAssignmentPlannerWorker
backlog-agent.ts                   runBacklogAgent + runBacklogPlannerWorker
backlog-generator.ts               sanitizeBacklog (defensive cleanup of agent output)
backlog.controller.ts              /pm/projects/:id/ai/{generate,accept}-backlog
backlog.service.ts                 BacklogService.preview + accept
eval-retrieval.controller.ts       /admin/eval/retrieval/{query,batch}
transcript-agent.ts                runTranscriptAgent (multi-emit)

agent/
  agent-errors.ts                  AgentEmitMissedError, AgentLoopTimeoutError, AgentToolValidationError
  agent-runner.service.ts          run(), runDetached(), isAgentModeAvailable()
  agent-runner.service.spec.ts     unit tests for the runner
  agent-types.ts                   ToolDefinition, ToolContext, AgentRunInput, …
  json-schema.ts                   obj/str/num/arr/bool/enum builders
  openai-compatible-tool-loop.ts   the actual loop (Phase 1 parallel tool calls live here)

agent/tools/
  assignment-tools.ts              candidate tasks + members + history
  cahier-tools.ts                  read_meeting_segments (keyword)
  copilot-tools.ts                 read_meeting_state, read_questionnaire_status
  glossary-tools.ts                read_glossary
  project-tools.ts                 read_project_summary, read_questionnaire, …
  semantic-tools.ts                read_relevant_meeting_excerpts, read_relevant_questionnaire (Phase 4)
  transcript-tools.ts              read_segments, read_other_meeting_summaries, read_transcript_metadata

embeddings/
  embedding-indexer.service.ts     indexAndStore() — batch embed + UPDATE
  embeddings.module.ts             registration
  embeddings.service.ts            embed() HTTP client (Result-typed)
  embeddings.service.spec.ts       7 unit tests covering failure modes
  pgvector.int.spec.ts             10 gated integration tests (INTEGRATION_DB_URL)

prompts/
  transcript-prompt.ts             SYSTEM_PROMPT for single-shot transcript analysis

providers/
  gemini.provider.ts               Gemini single-shot
  openai.provider.ts               OpenAI single-shot
  zai-fallback.provider.ts         Z.AI single-shot + chat() + chatWithUsage()
```

### `src/cahier-des-charges/`
```
cahier-agent.ts                    runCahierAgent + runCahierPlannerWorker
cahier-des-charges.controller.ts   12 endpoints (preview, preview-stream, save, …)
cahier-des-charges.module.ts       registration
cahier-des-charges.service.ts      ~2000 LOC — all 5 generation paths + grounding + critique
cahier-des-charges.types.ts        CahierAiResult, CahierStreamEvent, CahierPreflightResult, …
cahier-stream.spec.ts              5 unit tests for streamCahierContent (Phase 3 SSE)
cahier-grounding.spec.ts           10 unit tests for applyGroundingCheck + runSelfCritique
docx-builder.ts                    Pure rendering — CahierAiResult → .docx
dto/cahier-feedback.dto.ts         class DTO for POST /feedback
```

### `src/ai-usage/`
```
ai-usage.controller.ts             /admin/ai-usage + /admin/ai-usage/summary
ai-usage.module.ts                 @Global
ai-usage.service.ts                log(), assertWithinDailyBudget(), summaryByProject(), cost rates
```

### `src/meetings/` (AI-touching only)
```
live-copilot.service.ts            Real-time agent for kickoff/cadrage meetings
live-copilot.gateway.ts            Socket.IO `/copilot` namespace
live-copilot.controller.ts         REST shim for start/append/save
live-copilot.prompt.ts             buildLiveCopilotPrompt — context-aware system prompt
live-copilot.types.ts              ChecklistItem, SuggestionUrgency, LiveSessionState, …
live-meeting.service.ts            saveLiveTranscript (with embedding hook)
meetings.service.ts                uploadTranscript + STT + AI analysis trigger
assemblyai.provider.ts             AssemblyAI Universal-2 wrapper
```

### `src/commands/`
```
backfill-embeddings.ts             Standalone CLI — runs inside the server container
```

### `web/Front/customapp/src/lib/` (frontend, AI-touching only)
```
cahier-stream.ts                   SSE consumer for /cahier-des-charges/preview-stream
                                   (fetch + ReadableStream + frame parser)
cahier-stream.spec.ts              5 vitest tests for the parser
```

### `web/Transcription/` (Python, boundary only)
```
app.py                             FastAPI: /transcribe, /transcribe-chunk, /embed
                                   /embed lazy-loads SentenceTransformer(multilingual-e5-small)
                                   Shared-secret auth via X-Transcription-Secret header
```

### `docs/`
```
AI_MODULE_GUIDE.md                 ← this file
AI_SURFACE_REPORT.md               Pre-Phase 4-5 inventory (kept for history)
AI_EVAL.md                         Output of scripts/eval-cahier.mjs
AI_EVAL_RETRIEVAL.md               Output of scripts/eval-retrieval.mjs
agent-orchestra/
  STATUS.md                        Phase 1-5 outcomes + measurements
  PHASE_4_PGVECTOR_PLAN.md         pgvector implementation plan
  PHASE_5_FINDINGS.md              Planner-worker measurements + rollout
```

### `scripts/`
```
eval-cahier.mjs                    Live-server cahier eval
eval-retrieval.mjs                 Live-server retrieval eval
fixtures/retrieval-golden.json     30 golden queries for retrieval eval
```

### `tests/eval/cahier-dataset/`
```
01-ged-rich/        02-ged-sparse/  03-workflow-contradictory/
04-deployment-francophone/          05-documentation-bilingual/
   input.json         expected.json   per fixture
```

---

## 20. Operational runbook

### First-time prod deploy (already done — kept for re-runs)

1. **Postgres image swap** to `pgvector/pgvector:pg16`. Memory bumped to 1g.
2. **Apply Phase 4 migrations** (`prisma migrate deploy` in entrypoint):
   - `20260517120000_pgvector_extension` (`CREATE EXTENSION IF NOT EXISTS vector`)
   - `20260517120100_pgvector_columns_and_indexes` (3 columns + 3 HNSW indexes, `CONCURRENTLY`)
3. **Build server + transcription images** (transcription pulls `sentence-transformers`).
4. **Restart containers** with the kill-then-rm pattern (AppArmor blocks `docker stop`):
   ```bash
   PID=$(docker inspect -f '{{.State.Pid}}' neoleadge_server)
   kill -9 $PID
   docker rm -f neoleadge_server
   docker compose -f docker-compose.prod.yml --env-file .env.prod up -d server
   ```
5. **Run backfill** once embeddings columns exist:
   ```bash
   docker exec neoleadge_server node dist/src/commands/backfill-embeddings.js \
     --table=all --batch-size=32 --max-rows=20000
   ```
6. **Flip flags ON** in `.env.prod` (already done):
   - `CAHIER_USE_PLANNER=on`
   - `CAHIER_PLANNER_SKIP_CRITIQUE=on`
   - `CAHIER_USE_SEMANTIC_RETRIEVAL=on`
   - `CAHIER_STREAM_SECTIONS=on`
   - `BACKLOG_USE_PLANNER=on`
   - `ASSIGNMENT_USE_PLANNER=on`

### Rollback

Every Phase 1-5 path is gated. Rollback is **always** a single env-var flip + container restart. Code stays on the new commit.

| Symptom | Flip |
|---|---|
| Cahier hallucinating after planner-worker switch | `CAHIER_PLANNER_SKIP_CRITIQUE=off` (re-enables 2nd pass) |
| Cahier worse after `glm-4.5-air` → switch primary | `CAHIER_USE_PLANNER=off` (back to agent loop) |
| Semantic retrieval returning irrelevant excerpts | `CAHIER_USE_SEMANTIC_RETRIEVAL=off` (keyword tools only) |
| Streaming endpoint flapping | `CAHIER_STREAM_SECTIONS=off` (endpoint emits one `complete` event) |
| Z.AI outage | `AI_PROVIDER=openai` (single-shot path auto-engages OpenAI) |
| pgvector pg16 image regression | redeploy `postgres:16-alpine` — embeddings columns are nullable, queries still work via keyword tools |

### Daily-ops gotchas

- **AppArmor blocks `docker stop`** on the deploy host. Always kill-then-rm.
- **`vue-tsc` is stricter than local `tsc`** in the Docker build. Run `npx vue-tsc --noEmit` from `web/Front/customapp/` before pushing.
- **`NeoTag` severity is `warn`, not `warning`** — see CLAUDE.md.
- **Z.AI 429 burst limits** are real even on paid accounts. The fallback to OpenAI must be configured (`OPENAI_API_KEY` set) or the cahier will fall back to the slowest path.
- **`prisma db push` is forbidden** — always use tracked migrations.
- **PostgreSQL table names are quoted** (`"Projects"`, `"TranscriptSegments"`) — psql requires the quotes.

### Cost monitoring

- `/admin/ai-usage/summary?daysBack=7` for a weekly per-project breakdown.
- Set `AI_MAX_TOKENS_PER_PROJECT_PER_DAY=200000` on a runaway project; the daily-budget guard throws 403 before the next call.
- Embeddings have zero cost (`local-e5` provider) but contribute to AiUsage row counts. Filter them out at the admin-dashboard level if needed.

### Pre-merge verification checklist

Run before opening a PR that touches `src/ai/`, `src/cahier-des-charges/`, or `src/meetings/live-copilot.*`:

```bash
# Backend typecheck + unit tests (must pass)
cd web/back-nest
npx tsc --noEmit
npx jest

# Frontend typecheck + unit tests (must pass)
cd ../Front/customapp
npx vue-tsc --noEmit
npx vitest run

# Optional but recommended for retrieval/indexer changes
INTEGRATION_DB_URL=postgresql://user:pass@host:5432/db \
  npx jest src/ai/embeddings/pgvector.int

# Optional but recommended for cahier or retrieval prompt/SQL changes
node scripts/eval-cahier.mjs              # ~10 min, ~$0.10 Z.AI spend
node scripts/eval-retrieval.mjs           # ~1 min, free (local-e5)
```

`vue-tsc` is **stricter than** the local `tsc` in the Docker build — running it locally catches `NeoTag severity="warning"` (must be `"warn"`) and similar class issues before they break the prod build.

---

## 21. Known limitations

1. **In-process state for live-edit debouncing.** `CollaborationService.pendingEmbeds` is a per-process `Map`. Won't survive a PM2 cluster split. The form-save path is the safety net (it always re-embeds on `saveFieldValues`).
2. **Live copilot session map** has the same constraint — `LiveCopilotService.sessions` is per-process. Multi-instance scaling requires Redis-backed session state.
3. **Gemini is not in agent mode** — `tool_choice` parity isn't worth chasing while Z.AI + OpenAI cover the spectrum.
4. **`KNOWN_TECH_NAMES` list is hand-curated.** Adding a new name (e.g. "Bedrock") means editing `cahier-des-charges.service.ts` + redeploying. A future eval-driven approach would auto-mine names from past INFO_MANQUANTE markers.
5. **Backfill is a one-shot CLI**, not a Cron. Re-runs are idempotent (`WHERE embedding IS NULL`), so a periodic cron via `crontab` works fine — but isn't scripted yet.
6. **No streaming on the planner-worker path.** Phase 3 streaming is mutually exclusive with the single-shot planner-worker (no intermediate state to emit). Token-by-token streaming on the worker's single emit was considered and rejected (brittle progressive JSON parsing).
7. **No PR-stage rate-limit testing** of `parallel_tool_calls=true` against alternative providers (Moonshot, Groq). Verified on Z.AI + OpenAI; assumed safe elsewhere.
8. **Cahier `runSelfCritique` is single-shot** even when the cahier itself came from the streaming path — re-introducing the wall-time saving of the streaming path. Document for the future: a streaming critique pass is feasible (one section's critique can fire as soon as that section lands) but unimplemented.

---

*This document supersedes `AI_SURFACE_REPORT.md` (2026-05-12) as the canonical reference. The earlier doc remains in the repo for historical interest; update **this** file when you change anything in `src/ai/`, `src/cahier-des-charges/`, `src/meetings/live-copilot.*`, or the embeddings stack.*
