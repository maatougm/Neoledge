# Cahier des charges evaluation harness

Production-ready regression suite for the cahier-des-charges AI pipeline. Each
fixture under `cahier-dataset/` describes a fully formed project (questionnaire
answers + meeting transcripts) and the assertions to make about the resulting
9-key JSON cahier.

## How it works

1. **Seed.** For each fixture, the harness creates a temporary project on the
   live backend (assigning an existing `ProjectManager` user), writes the
   questionnaire field values via `PATCH /pm/projects/:id/field-values`, and
   seeds each transcript via `POST /pm/projects/:id/meetings/live/save`.
2. **Generate.** It calls `GET /pm/projects/:id/cahier-des-charges/preview` —
   the same endpoint the frontend uses — which fires the real Z.AI generation
   and returns the parsed 9-key JSON.
3. **Score.** Each output is graded on three axes:
   - **50 %** Fact-grounding — `mustMention` strings present (case-insensitive)
   - **30 %** Anti-hallucination — `mustNotMention` strings absent
   - **20 %** French style — LLM-judge call to a model **distinct from** the
     one under test (defaults to `glm-4.5-air`) to avoid self-flattery
4. **Report.** A markdown report is written to `docs/AI_EVAL.md` (regenerated
   on every run) with per-fixture breakdown + suite-wide weighted average.
5. **Cleanup.** Every temp project is soft-deleted via
   `DELETE /admin/project/:id` even on failure. Set `EVAL_SKIP_CLEANUP=1` to
   keep them around for debugging.

The script exits with code `0` if the suite average is ≥ `EVAL_SUITE_THRESHOLD`
(default `80`), `1` otherwise — suitable for CI.

## Usage

```bash
# From the repo root
export EVAL_BACKEND_URL=https://neoleadge.pythagore-init.com
export EVAL_PM_EMAIL=admin@neoleadge.com
export EVAL_PM_PASSWORD='Admin@123'
export EVAL_LLM_BASE_URL=https://api.z.ai/api/coding/paas/v4
export EVAL_LLM_API_KEY=...your-zai-key...

# Run every fixture
node scripts/eval-cahier.mjs

# Or via the backend's npm script
cd web/back-nest && npm run eval:cahier
```

### Environment variables

| Name | Required | Default | Purpose |
|---|---|---|---|
| `EVAL_BACKEND_URL` | yes | `https://neoleadge.pythagore-init.com` | Base URL of the NestJS backend (no trailing slash) |
| `EVAL_PM_EMAIL` | yes | `admin@neoleadge.com` | API-driver credentials — must have Admin role so it bypasses `ProjectAccessGuard` |
| `EVAL_PM_PASSWORD` | yes | `Admin@123` | Password for the above |
| `EVAL_LLM_BASE_URL` | yes | `https://api.z.ai/api/coding/paas/v4` | OpenAI-compatible base for the judge model |
| `EVAL_LLM_API_KEY` | yes | — | Bearer token for the judge model (skipped if absent) |
| `EVAL_LLM_JUDGE_MODEL` | no | `glm-4.5-air` | Judge model — must NOT be in the blocklist (`glm-5-turbo`, `gpt-4o-mini`, `gpt-4o`) |
| `EVAL_FIXTURE_FILTER` | no | — | Substring filter to run a single fixture, e.g. `02-ged-sparse` |
| `EVAL_SKIP_CLEANUP` | no | — | If `1`, leaves temp projects in place |
| `EVAL_SUITE_THRESHOLD` | no | `80` | Suite-average pass/fail threshold |
| `EVAL_REPORTED_CAHIER_MODEL` | no | `glm-5-turbo (...)` | Cosmetic — what to print as "model under test" in the report |

### Performance

- Each fixture takes **~110–180 s** end-to-end (cahier generation dominates).
- A full 5-fixture run is therefore ~10–15 minutes.
- The harness is purely additive — no backend code changes — so it can be run
  against any live NeoLeadge environment.

## Adding a new fixture

```
tests/eval/cahier-dataset/06-my-new-case/
├── input.json
└── expected.json
```

### `input.json`

```jsonc
{
  "projectName": "EVAL-...",
  "clientName": "...",
  "fields": [
    { "label": "Contexte et problématique", "value": "..." },
    { "label": "Objectif du projet et résultats attendus", "value": "..." },
    { "label": "Périmètre fonctionnel (modules à développer)", "value": "..." },
    { "label": "Stack technique proposée", "value": "..." },
    { "label": "Livrables attendus", "value": "..." },
    { "label": "Périmètre exclus", "value": "..." }
  ],
  "transcripts": [
    {
      "title": "Réunion ...",
      "summary": "...",
      "decisions": "..."
    }
  ]
}
```

Labels matching the seven static fields the backend auto-creates (see
`projects.service.ts:182`) are reused; any additional label is created on the
fly via `POST /admin/project/:id/fields`.

### `expected.json`

```jsonc
{
  "mustMention":    [ "PostgreSQL", "20 mai 2026", "Elise", ... ],
  "mustNotMention": [ "AWS", "DocuSign", ... ],
  "requiredSections": [
    "objectifDocument", "contexte", "objectifProjet",
    "perimetreInclus", "perimetreExclus",
    "exigencesFonctionnelles", "architectureTechnique",
    "livrables", "conclusion"
  ]
}
```

## Output

- `docs/AI_EVAL.md` — markdown report, regenerated on each run.
- stdout — compact JSON line with suite score (for CI log parsing).
- stderr — human-readable progress log.

## Self-flattery guard

If `EVAL_LLM_JUDGE_MODEL` is one of `glm-5-turbo`, `gpt-4o-mini`, `gpt-4o` (the
current and historical cahier-generation models) the script aborts with exit
code `2` before any network call. Override the blocklist by editing
`CAHIER_MODELS_BLOCKLIST` in `scripts/eval-cahier.mjs` only after careful
consideration.
