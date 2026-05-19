# Code Quality & Architecture Audit — NeoLeadge

**Auditor:** Code-quality + Architecture fork (seventh parallel audit)
**Scope:** `web/back-nest/src/` and `web/Front/customapp/src/`
**Date:** 2026-05-19

---

## Executive Summary

The codebase shows strong bones — the Result pattern is implemented and used consistently in most modules, guards are properly applied on project-scoped routes, and the AI module is well-documented in `AI_MODULE_GUIDE.md`. The most pressing concerns are: three feature-flag defaults that are documented as `on` but coded as `off` (doc/code split that will confuse operators), a 2,017-line service that is a maintainability blocker, pervasive `catch (e)` without `unknown` narrowing (97 sites), 5 DTO interfaces that will silently strip validation if ever promoted to controller inputs, and a `formatDate` helper defined in 21 separate Vue components despite a shared `lib/formatDate.ts` already existing.

---

## Findings

### CRITICAL

**[CRITICAL-1] Three feature-flag defaults documented as `on` but coded as `off`**

Operators reading `docs/AI_MODULE_GUIDE.md` will believe these flags are active by default, but they are not.

- `cahier-des-charges.service.ts:1051` — `CAHIER_USE_PLANNER` defaults to `'off'`
- `cahier-des-charges.service.ts:1080` — `CAHIER_PLANNER_SKIP_CRITIQUE` defaults to `'off'`
- `ai/backlog.service.ts:75` — `BACKLOG_USE_PLANNER` defaults to `'off'`

Guide table lines 808-813 say these are `on` by default.

**Nuance verified post-audit**: production `.env.prod` has these set to `on` explicitly, so live behavior is correct. But a fresh deploy without `.env.prod` will default to OFF — operator confusion guaranteed. Fix: align the `?? 'off'` literals to `?? 'on'`, OR update the guide to say "default off — set to on in prod".

### HIGH

**[HIGH-1] `cahier-des-charges.service.ts` is 2,017 lines** — CLAUDE.md max is 800. Six distinct responsibilities. Split into 5 focused services.

**[HIGH-2] 97 `catch (e)` clauses without `unknown` type annotation** — unsafe `(e as Error).message` casts. Pattern fix: `catch (e: unknown) { ... e instanceof Error ? e.message : String(e) }`.

**[HIGH-3] `projects.service.ts` is 1,008 lines with 8 `dto: any` parameters** in public methods. Class-validator doesn't run on `any`-typed bodies.

**[HIGH-4] `CreateNotificationDto` is an interface, not a class** — `src/notifications/dto/create-notification.dto.ts:1`. If ever wired to `@Body()`, all fields strip silently. Three other internal DTOs share the pattern.

**[HIGH-5] `auth.service.ts` throws NestJS HTTP exceptions** (516 lines, 30+ throws). CLAUDE.md says return Result. Also `backlog.service.ts` throws directly. Inconsistent error contract.

**[HIGH-6] 21 inline copies of `formatDate` in Vue components** despite `lib/formatDate.ts` existing. Active source of UI date-format inconsistency.

### MEDIUM

**[MEDIUM-1] `CahierAiResult` defined in 5 places** — backend + 4 frontend files. 2 frontend copies use `string | unknown` for fields the backend defines as `string`. Backend rename won't fail frontend compile.

**[MEDIUM-2] `isAgentModeEnabled()` copy-pasted across 3 services** — same env-var parsing logic for `AI_AGENT_MODE` in ai.service, backlog.service, cahier-des-charges.service.

**[MEDIUM-3] `work-packages.service.ts` is 890 lines** — over CLAUDE.md limit. CRUD + dependency-cycle DFS + sprint + bulk + notifications all in one file.

**[MEDIUM-4] `CAHIER_SECTION_MODE` flag is dead-by-default code** — 143 lines of `generateInThreeGroups` with no tests, superseded by streaming. Remove or test.

**[MEDIUM-5] `extractApiError` defined twice in frontend** — `lib/api.ts:68` and `stores/projectStore.ts:12` with slightly different signatures.

**[MEDIUM-6] Magic numbers scattered without named constants** — 9 timeouts/limits identified across the AI module. Should be a shared `ai-constants.ts`.

**[MEDIUM-7] `agile.service.ts` throws HTTP exceptions inside `$transaction` callbacks** — convoluted error flow, future maintainer footgun.

**[MEDIUM-8] `CahierDesChargesSection.vue` is 989 lines** — well above 800-line limit. Also `MeetingAiPanel.vue` (897), `LiveMeetingPanel.vue` (879).

### LOW

**[LOW-1] One pending TODO without a ticket reference** — `prisma.module.ts:28`, comment cut off mid-sentence.

**[LOW-2] `console.warn` left in production service code** — `users.service.ts:221`, gated behind `NODE_ENV !== 'production'` but leaks temp password to stdout in staging.

**[LOW-3] Naming inconsistency** — `pmId` in analytics vs `projectManagerId` everywhere else.

**[LOW-4] Service method naming inconsistency** — `get*` vs `find*` vs `list*` mixed across services without a convention.

**[LOW-5] Hardcoded legal company data in `docx-builder.ts:302`** — NeoLedge's SIRET + share-capital baked into source. Corporate change requires redeploy.

---

## Refactors (Ranked by ROI)

### R1. Split `cahier-des-charges.service.ts` — HIGH ROI
Six logical groups → five 200-400 LOC services. Removes the single largest onboarding blocker. Also: `callOpenAi`/`callGemini` private helpers duplicate `ai/providers/openai.provider.ts` — delete in favor of the providers (~200 LOC saved).

### R2. Unify `CahierAiResult` into shared types — HIGH ROI
5 independent copies. Quickest fix: `web/shared-types/` with tsconfig.paths in both projects. Longer-term: `openapi-typescript` from the backend Swagger spec — kills the entire drift class.

### R3. Extract shared `ai-flags.ts` helper — MEDIUM ROI
Single source of truth for `AI_AGENT_MODE` and `*_USE_PLANNER` parsing. Would have prevented CRITICAL-1.

### R4. Migrate 21 inline `formatDate` copies to `lib/formatDate.ts` — MEDIUM ROI
Mechanical search-and-replace. Removes ~50 LOC, fixes UI date inconsistency.

### R5. Type `projects.service.ts` `dto: any` parameters — MEDIUM ROI
Enables class-validator on those paths. Required precursor to safely splitting the file.

---

## Architectural Recommendations

### A1. OpenAPI-generated shared types
`@nestjs/swagger` already exists. `openapi-typescript` → frontend `types.ts`. ~1 day setup. Kills MEDIUM-1 permanently.

### A2. `AiDispatchService` unifying provider dispatch
Currently `callOpenAi`/`callGemini` exist in BOTH cahier-des-charges.service AND ai/providers/. Single wrapper makes adding Anthropic future-proof and makes feature-flag routing testable.

### A3. Replace in-process `lastPreviewAt` cooldown with DB or Redis lock
`ai/backlog.service.ts:28` — 30s per-project cooldown is a `Map`. Multi-instance deploy = bypass. Use `prisma.aiUsage` timestamp check or Redis `SETNX`.

---

## Review Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 1     |
| HIGH     | 6     |
| MEDIUM   | 8     |
| LOW      | 5     |

**Verdict: BLOCK** on CRITICAL-1 until verified — prod runtime is correct, but fresh deploys without `.env.prod` get a different system than the docs describe.
