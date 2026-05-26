# Neo Project — Engineering Handbook

> **Who this is for:** an engineer (or presenter) who has **never seen this code** and may have **never used these frameworks or languages**. By the end of this handbook you can confidently explain *what the product does, how it's built, which technologies we chose and why,* and answer technical Q&A.
>
> Read the files in order for a full picture, or jump to what you need.

> **Naming note (read once):** the product is branded **Neo Project**, with the **NeoLedge** logo. The *codebase, repository, database, containers, and live domain* still carry the original internal name **"NeoLeadge"** (e.g. `neoleadge.pythagore-init.com`, the `neoleadge` database, `neoleadge_server` container). That's intentional — renaming the infrastructure would take the live site down. So: **"Neo Project" = the product name you present; "NeoLeadge" = what you'll see inside the code and on the server.** They're the same thing.

---

## The 60-second pitch (memorize this)

**NeoLeadge** is a web platform that runs IT-deployment projects end to end, with **AI doing the heavy paperwork**. A project manager (PM) holds live meetings; the app **transcribes them in real time**, then an **AI writes the formal specification document** ("cahier des charges"), a **spec team approves it**, the AI **generates the task backlog** (epics + tasks), the PM **drag-drops tasks onto team members** (with AI suggesting who fits best), and the team executes via a Kanban board, Gantt chart, and sprints.

It's three programs working together:
- a **backend** (the brain: business rules + database + AI orchestration),
- a **frontend** (the website the users click on),
- a **transcription service** (turns meeting audio into text).

Everything is written in **TypeScript** (backend + frontend) plus a small **Python** service for audio, runs in **Docker** containers, and is live at `https://neoleadge.pythagore-init.com`.

---

## How to read this handbook

| # | File | What it answers |
|---|------|-----------------|
| 1 | [01-product-overview.md](./01-product-overview.md) | What is NeoLeadge? Who uses it? What's the workflow? |
| 2 | [02-architecture.md](./02-architecture.md) | How are the pieces wired together? What happens on a request? |
| 3 | [03-tech-stack-and-rationale.md](./03-tech-stack-and-rationale.md) | **Every technology explained from zero + why we chose it** |
| 4 | [04-backend-deep-dive.md](./04-backend-deep-dive.md) | How the backend is organized (NestJS), the key patterns |
| 5 | [05-frontend-deep-dive.md](./05-frontend-deep-dive.md) | How the website is built (Vue 3 + Pinia) |
| 6 | [06-data-layer.md](./06-data-layer.md) | The database (PostgreSQL), the ORM (Prisma), AI search (pgvector) |
| 7 | [07-ai-pipeline.md](./07-ai-pipeline.md) | How the AI features actually work |
| 8 | [08-design-decisions.md](./08-design-decisions.md) | The big decisions and *why* (decision log) |
| 9 | [09-presentation-script.md](./09-presentation-script.md) | A slide-by-slide talk + live-demo flow |
| 10 | [10-qa-prep.md](./10-qa-prep.md) | Likely questions + precise answers (incl. "why not X?") |
| 11 | [11-glossary.md](./11-glossary.md) | Every acronym and term, plain-English |

**If you only have 30 minutes:** read 01, skim 03, then read 09 + 10.

---

## One-line tech summary (for the title slide)

> Vue 3 single-page app → NestJS 11 REST API + Socket.IO → PostgreSQL 16 (Prisma ORM) with pgvector for AI search; a Python FastAPI service for speech-to-text; LLMs (Z.AI / OpenAI) for generation; all in Docker behind Caddy.

Don't worry if none of those words mean anything yet — file **03** explains each one from scratch.

---

## Source-of-truth documents (deeper, already in the repo)

This handbook is the *explanation layer*. The authoritative technical references are:
- `CLAUDE.md` (repo root) — the engineering rulebook and gotchas.
- `docs/DATABASE_SCHEMA.md` — every table, relationship, and cascade rule.
- `docs/AI_MODULE_GUIDE.md` — the exhaustive AI internals.

When this handbook and those disagree, those win (they're closer to the code).
