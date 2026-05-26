# 9 — Presentation Script

> A ready-to-deliver talk for **Neo Project**. ~15–20 min + demo. Each slide has a title, what to say, and the key point. Adapt freely.

## Slide 0 — Title
- **Neo Project** (NeoLedge logo). "AI-driven IT-deployment project management."
- One line: *"Neo Project runs deployment projects end-to-end and uses AI to write the paperwork — specifications and backlogs — that used to take days."*

## Slide 1 — The problem
- Deploying software for a client means heavy paperwork: meetings → a formal spec ("cahier des charges") → validation → backlog → assignment → execution.
- It's slow and manual. **Say:** "We automated the slow parts with AI, while keeping humans in control."

## Slide 2 — The workflow (the heart of the talk)
- Walk the chain: *Admin creates project → PM builds team + questionnaire → live meetings (auto-transcribed) → AI writes the cahier → spec team approves → AI generates the backlog → PM assigns tasks (AI suggests) → team executes (board/Gantt/sprints).*
- **Key point:** "AI does the drafting; humans approve. The PM edits everything."

## Slide 3 — The four roles
- Admin, ProjectManager, SpecificationTeam, Member. **Key point:** "Clear separation of duties: PMs own, SpecTeam validates, Members execute."

## Slide 4 — Architecture (one diagram)
- Show the box diagram (handbook file 02): Browser → Caddy → Vue frontend + NestJS backend → PostgreSQL/pgvector + Python speech service → LLMs.
- **Key point:** "A standard 3-tier web app, plus a Python microservice for ML, all in Docker behind a reverse proxy."

## Slide 5 — The stack & why
- TypeScript everywhere (safety + one language); NestJS (structure); Vue 3 (UI); PostgreSQL + pgvector (data + AI search in one DB); Python FastAPI (speech); Z.AI/OpenAI (generation).
- **Key point per choice** (from file 03): each chosen for type-safety, cost, or keeping AI data in-house.

## Slide 6 — How the AI works
- The agent + tools idea; the planner-worker speed-up; pgvector retrieval (find by meaning).
- **Key point:** "The AI fetches the project's real data via tools, then writes — it's grounded, not guessing."

## Slide 7 — Anti-hallucination (the trust slide)
- Show a generated cahier with `INFO_MANQUANTE` markers.
- **Key point:** "For a contractual document, the AI must never invent facts. Six layers stop it; when it lacks a source, it flags the gap instead of fabricating."

## Slide 8 — Engineering quality
- ~1,650 backend tests + ~870 frontend tests; CI gates (build, type-check, tests, smoke); Dockerized deploy with automatic migrations + HTTPS.
- **Key point:** "It's not a prototype — it's tested, type-safe, and deployed."

## Slide 9 — Live demo (next section)
## Slide 10 — Q&A (see file 10)

---

## Live demo flow (do this in the app)

Log in as **admin** (`admin@neoleadge.com` / `Admin@123`). Open a project that's mid-flow (e.g. "Migration GED — Mairie de Lyon").

1. **Overview** — show the dashboard, the (now manual-editable) progress bar.
2. **Réunions (Meetings)** — open a meeting → show the AI **summary, action items, decisions**.
3. **Cahier des charges** — show the saved 9-section document; **point out the `INFO_MANQUANTE` markers** (the anti-hallucination story).
4. **Validations / as SpecificationTeam** (`spec@neoleadge.com` / `Spec@123`) — show the review queue → Approve. Then "Mes validations" history.
5. **Backlog / Board** — show the AI-generated epics + tasks on the Kanban board.
6. **Assignation** — select tasks → "Suggestions IA" → show ranked Member suggestions with rationale.
7. **(Admin) Statut système** — the monitoring dashboard: uptime, DB/transcription health, security panel.

> **Demo tips:** AI generation takes 20–90 s — trigger it *before* you start talking, or use the already-generated results on the seeded projects. The seed has projects across all phases.

---

## If the demo can't run live
Use screenshots of: the login (branded Neo Project, yellow theme), a cahier with `INFO_MANQUANTE`, the Kanban board, the assignment suggestions, and the system dashboard. The handbook's architecture + AI diagrams also stand alone.

Next: **[10-qa-prep.md](./10-qa-prep.md)**.
