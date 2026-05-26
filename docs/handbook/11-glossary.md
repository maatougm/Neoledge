# 11 — Glossary

> Every term, acronym, and technology in plain English. Skim before the talk so nothing trips you up.

## Product / domain terms (mostly French)

- **Neo Project** — the product's brand name (what you present).
- **NeoLeadge / NeoLedge** — the original internal name, still used by the codebase, database, containers, and live domain. Same product.
- **Cahier des charges** — the formal **specification document** (the contract for what will be built). 9 fixed sections. The AI's flagship output.
- **Questionnaire** — structured project fields the PM fills in about the client's needs. Fields flagged `isBacklogDriver` feed the AI.
- **Réunion** — meeting.
- **Backlog** — the prioritized list of work: **epics** (big functional chunks) → **tasks**.
- **Work Package (WP)** — a single task/issue (the term comes from OpenProject). Has a type (Epic/Feature/Task/Bug), status, assignee, estimate.
- **Epic** — a large work item grouping several tasks.
- **Sprint** — a fixed time-box of work (agile).
- **Gantt** — a timeline chart of tasks and milestones.
- **Kanban board** — columns (To do / In progress / Done) of cards you drag between.
- **Jalon** — milestone. **MEP** (*Mise En Production*) — go-live. **Recette** — acceptance testing. **Cadrage technique** — technical scoping. **Clôture** — project closure.
- **Validation / CahierFeedback** — the SpecificationTeam's approve/reject record on a cahier.
- **GED** — *Gestion Électronique de Documents* = electronic document management (the kind of software clients deploy).
- **Elise / Archimed** — the client's/parent products in this domain (document management). Appear in demo data.

## Roles

- **Admin** — full access; manages projects + users.
- **ProjectManager (PM)** — owns projects; runs the whole flow.
- **SpecificationTeam** — validates the cahier des charges.
- **Member** — executes the work; the only role tasks are assigned to.

## Web / architecture terms

- **Frontend** — the part that runs in the browser (the UI).
- **Backend** — the server-side part (business logic + database).
- **SPA (Single-Page Application)** — a website that loads once then updates in place (no full reloads). The Vue app is one.
- **API (Application Programming Interface)** — the set of backend URLs the frontend calls.
- **REST** — the common request/response style of API ("GET this," "POST that").
- **WebSocket / Socket.IO** — a persistent two-way connection so the server can *push* to the browser instantly. Socket.IO is the library.
- **SSE (Server-Sent Events)** — one-way streaming from server to browser (used to stream the cahier section-by-section).
- **Reverse proxy** — a front-door server that routes incoming traffic to the right service and handles HTTPS. We use **Caddy**.
- **TLS / HTTPS** — encrypted connections (the padlock). Caddy + Let's Encrypt provide it automatically.
- **JWT (JSON Web Token)** — a signed token proving who you are, sent on every request after login.
- **IDOR** — a security flaw where you can access another user's data by guessing IDs. The project-access guard prevents it.

## Languages / frameworks / tools

- **TypeScript** — JavaScript with types (compile-time safety). The main language.
- **NestJS** — the backend framework (TypeScript). Organizes code into modules/controllers/services.
- **Vue 3** — the frontend framework. Builds the UI from components.
- **Vite** — the fast build tool/dev server for the frontend.
- **Pinia** — Vue's state store (shared data across the app).
- **Vue Router** — maps URLs to pages.
- **axios** — the library for making HTTP calls from the frontend.
- **PrimeVue 4** — a UI component library; **NeoLibrary** is the company wrapper around it.
- **Python / FastAPI** — the language/framework of the speech-to-text microservice.
- **Docker** — packages each service into a portable container. **Docker Compose** runs them together.

## Data terms

- **PostgreSQL (Postgres)** — the relational SQL database storing everything.
- **ORM (Object-Relational Mapper)** — lets you query the DB with typed code instead of raw SQL. We use **Prisma**.
- **Schema** — the definition of all tables (`schema.prisma`).
- **Migration** — a versioned, tracked change to the database structure.
- **Soft-delete** — marking a row deleted (`isDeleted=true`) instead of physically removing it.
- **Multi-tenancy** — keeping each project's data isolated (filtered by `projectId`).
- **DTO (Data Transfer Object)** — a class defining the shape + validation of an incoming request body.

## AI / ML terms

- **LLM (Large Language Model)** — the "ChatGPT-style" model that generates text. We call **Z.AI** (primary) and **OpenAI** (fallback).
- **Embedding** — a list of numbers representing the *meaning* of a piece of text, so similar meanings have similar numbers.
- **pgvector** — the PostgreSQL extension that stores embeddings and finds the most similar ones.
- **Semantic / similarity search** — finding text by meaning rather than exact keywords.
- **Cosine similarity** — the math for "how similar are these two embeddings."
- **HNSW** — a fast index for nearest-neighbor (similarity) search.
- **Speech-to-text / transcription** — turning meeting audio into text (faster-whisper / AssemblyAI).
- **Diarization** — labeling *who* said each part of a transcript (SpeechBrain).
- **Agent / tool-calling** — the AI calling backend functions ("tools") to fetch data, then producing output — instead of one big prompt.
- **Planner-worker** — a faster mode: pre-fetch all needed data in parallel, then the model emits the result in one shot.
- **Hallucination** — when an AI invents facts. The cahier flow has a six-layer defense against it.
- **INFO_MANQUANTE** — the marker the AI writes when a section has no source data (instead of making something up). French for "missing information."
- **Result pattern** — backend convention: services return `Result.ok`/`Result.fail` instead of throwing.

## Testing / ops

- **Jest** — backend unit-test runner. **Vitest** — frontend unit-test runner. **Playwright** — runs a real headless browser for end-to-end smoke tests.
- **CI (Continuous Integration)** — automated checks (build + tests) that run on every push (GitHub Actions here).
- **Migration on boot** — the backend applies pending DB migrations automatically when it starts in production.

— End of handbook. Start at **[README.md](./README.md)** if you skipped ahead.
