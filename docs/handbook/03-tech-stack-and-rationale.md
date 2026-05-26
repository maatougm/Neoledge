# 3 — Technology Stack & Why We Chose It

> This file assumes you know **nothing** about these tools. Each entry: *what it is (plain English) → what it does for us → why we chose it (vs the alternative).*

---

## The foundation: TypeScript (the language)

**What it is.** TypeScript is JavaScript with **types**. JavaScript is the language every web browser runs. "Types" means you declare what kind of data a variable holds (`string`, `number`, a `User` object…), and a compiler checks you're not mixing them up *before* the code runs.

**What it does for us.** Both the backend and the frontend are written in TypeScript. A `User` object defined on the backend can share the same shape on the frontend. Mistakes (typos, wrong data shapes) are caught at compile time, not by users in production.

**Why we chose it.**
- **One language, full stack.** The same engineers work on backend and frontend without context-switching languages.
- **Safety at scale.** This is a big codebase (~210 backend files, ~180 frontend). Types make refactors safe — change a field, the compiler shows every place that breaks.
- *Alternative considered:* plain JavaScript (no safety net) or a different backend language like Java/Go (would split the stack into two languages and two skill sets). TypeScript gives safety *and* one language.

---

## Backend framework: NestJS 11

**What it is.** A **framework** is a pre-built skeleton that decides how your code is organized so you don't reinvent structure for every project. NestJS is a backend framework for building APIs in TypeScript. It's heavily inspired by Angular's structure (modules, dependency injection).

**What it does for us.** It gives the backend a consistent shape: every feature is a **module** (auth, projects, meetings, ai…), and within a module you have **controllers** (handle URLs), **services** (business logic), and **guards** (security). NestJS wires these together automatically.

**Key NestJS idea — Dependency Injection (DI):** instead of a service creating the things it needs, it *declares* them in its constructor and NestJS *provides* them. This makes code testable (you can swap a real database for a fake one in tests) and decoupled.

**Why we chose it.**
- **Opinionated structure** → 35 feature modules all look the same → a newcomer learns one module and understands all of them.
- **Batteries included:** validation, guards, WebSocket gateways, dependency injection, all standard.
- **TypeScript-native** → fits our one-language goal.
- *Alternative considered:* Express (a minimal, unopinionated library — you'd have to invent all the structure yourself) or a non-JS framework (Spring/Django — different language). NestJS gives Express's power with enforced structure.

---

## Frontend framework: Vue 3 (+ Vite)

**What it is.** Vue is a framework for building **interactive websites** — specifically "single-page applications" (SPA): the browser loads the app once, then updates the screen instantly as you click, without full page reloads (like Gmail). **Vite** is the build tool that compiles/serves it (extremely fast).

**What it does for us.** The whole user interface — 27 main pages + 8 team pages, 24 state stores — is Vue. Components are reusable UI pieces (a button, a project card, a Kanban column). Vue automatically re-renders the screen when data changes ("reactivity").

**Why we chose it.**
- **Gentle learning curve + readable** — Vue's "single-file components" (`.vue` files mix HTML-like template, logic, and styles) are approachable.
- **Reactivity** handles the hard part (keeping the screen in sync with data) for us.
- We also ship a company UI library, **NeoLibrary** (built on **PrimeVue 4**), for consistent buttons/tables/dialogs.
- *Alternative considered:* React (more verbose, more boilerplate) or Angular (heavier). Vue 3 + Vite is fast to build in and fast at runtime.

**Supporting frontend pieces:**
- **Pinia** — the "state store." A central place to hold data shared across pages (the current user, the project list) so components don't pass it around manually.
- **Vue Router** — maps URLs (`/app/pm/projects/123/cahier`) to pages, with per-role guards.
- **axios** — the library that makes HTTP calls to the backend.

---

## Database: PostgreSQL 16

**What it is.** A **database** stores the app's data permanently. PostgreSQL ("Postgres") is a **relational** database — data lives in tables (rows and columns) with defined relationships (a Project *has many* WorkPackages).

**What it does for us.** Stores all 41 data models — users, projects, work packages, meetings, transcripts, the cahier, validations, notifications, audit logs, embeddings.

**Why we chose it.**
- **Rock-solid + free + open-source**, the industry default for serious relational data.
- **pgvector** (below) plugs into it, so our AI similarity search lives in the *same* database — no separate vector database to operate.
- *Alternative considered:* the project originally used **MySQL/MariaDB** and migrated to PostgreSQL — partly for pgvector, partly for stronger SQL features. (You'll find historical MySQL artifacts in old migration files; they're not used.)

---

## The ORM: Prisma 7

**What it is.** An **ORM** (Object-Relational Mapper) lets you talk to the database using typed code instead of raw SQL strings. You describe your tables once in a schema file; Prisma generates a type-safe client.

**What it does for us.** Instead of `SELECT * FROM projects WHERE...`, we write `prisma.project.findMany({ where: { isDeleted: false } })` — and TypeScript knows exactly what comes back. The schema lives in `prisma/schema.prisma` (41 models); changes are applied via versioned **migrations**.

**Why we chose it.**
- **Type safety end-to-end** — the database shape becomes TypeScript types automatically.
- **Migrations are versioned and tracked** — every schema change is a reviewable file; `prisma migrate deploy` applies them safely in production (never `db push`, which can lose data).
- *Alternative considered:* raw SQL (powerful but error-prone, no type safety) or TypeORM (older, clunkier). Prisma is the modern, type-safe choice.

---

## AI similarity search: pgvector

**What it is.** A PostgreSQL **extension** that stores "embeddings" (a list of numbers representing the *meaning* of a piece of text) and finds the most *similar* ones quickly. This is how "semantic search" works — finding text by meaning, not exact keywords.

**What it does for us.** When the AI writes the cahier des charges, it needs the *most relevant* meeting excerpts and questionnaire answers. We embed all that text and use pgvector to fetch the closest matches (cosine similarity) via an HNSW index (a fast nearest-neighbor index).

**Why we chose it.**
- **It lives inside Postgres** — no extra "vector database" (Pinecone, Weaviate) to run, pay for, or secure. One database for everything.
- The embeddings are generated by a **self-hosted** model (`multilingual-e5-small`, 384 dimensions) in our Python service → **zero external API cost** and no data leaves our servers (important for client confidentiality).

---

## Real-time: Socket.IO

**What it is.** A library for **WebSockets** — a persistent two-way connection between browser and server, so the server can *push* messages to the browser instantly (not just answer requests).

**What it does for us.** Three channels: instant notifications, live presence/co-editing during the questionnaire, and the live-meeting copilot's suggestions.

**Why we chose it.** Notifications and collaboration need to feel instant. Polling (asking "anything new?" every few seconds) is wasteful and laggy; WebSockets push the moment something happens. Socket.IO handles reconnection and fallbacks for us.

---

## Speech-to-text: a Python FastAPI service

**What it is.** A small, separate web service written in **Python** (using **FastAPI**, a fast Python web framework). It takes audio and returns text.

Inside it:
- **faster-whisper** — runs OpenAI's Whisper speech-recognition model locally (no per-use cost).
- **SpeechBrain** — speaker diarization ("who said what").
- **sentence-transformers (e5)** — the embedding model for pgvector search.

**What it does for us.** During live meetings, audio chunks are sent here and turned into transcript text. It also generates the embeddings for AI search.

**Why a separate Python service?** The best speech/ML libraries are Python-only. Rather than contort the TypeScript backend, we isolate ML in its own service with a clean HTTP boundary. The backend just calls `POST /transcribe`.

> **Note on live transcription:** for *live* meeting chunks we now use **AssemblyAI** (a cloud speech API) as the primary engine because it keeps up with real-time better, with the local Python whisper as the fallback. The Python service still handles embeddings and full-file transcription.

---

## The LLMs (the generative AI): Z.AI + OpenAI

**What it is.** A **Large Language Model (LLM)** is the "ChatGPT-style" AI that generates text. We don't host these — we call them over HTTPS.

**What it does for us.** Writes the cahier des charges, generates the backlog (epics + tasks), analyzes meeting transcripts (summary/decisions/action items), and suggests task assignees.

**Why we chose this setup.**
- **Z.AI (`glm-4.5-air`) is the primary** — it's ~10× cheaper than OpenAI for similar quality on our prompts, follows French instructions well, and supports the "tool-calling" features our AI agent needs. It speaks the **OpenAI-compatible API**, so switching providers is just a config change.
- **OpenAI (`gpt-4o-mini`) is the automatic fallback** — if Z.AI errors or rate-limits, we fail over so the feature still works.
- *Why a fallback at all?* Single-provider outages are real; the automatic swap keeps the product running.

---

## Auth & security building blocks

- **JWT (JSON Web Token)** — when you log in, the server gives you a signed token; you send it on every request to prove who you are. We pin it to the HS256 algorithm on both signing and verifying (defence-in-depth).
- **bcryptjs** — hashes passwords so we never store them in plain text.
- **class-validator** — checks incoming request data against rules (`@IsString()`, `@IsEmail()`) before it reaches business logic.
- **Helmet + rate limiting** — standard HTTP hardening and abuse protection.

---

## Packaging & deployment: Docker + Caddy

- **Docker** — packages each service (backend, frontend, Python, database) into a **container**: a self-contained box with everything it needs, so it runs the same on any machine.
- **Docker Compose** — describes and runs all the containers together as one stack.
- **Caddy** — the reverse proxy at the front: handles HTTPS certificates automatically and routes each request to the right container.

**Why:** containers eliminate "works on my machine" problems and make deployment one command. Caddy removes the pain of manual TLS certificate management.

---

## Testing

- **Jest** — backend unit tests (~1,650 tests). The database is mocked, so they run fast with no real DB.
- **Vitest** — frontend unit tests (~870 tests).
- **Playwright** — a real headless browser for end-to-end "smoke" tests (does the site load every page with zero console errors?).

**Why so many tests:** a large codebase changes constantly; tests are the safety net that lets us refactor and ship confidently.

---

## One-paragraph summary you can say out loud

> "It's a TypeScript-everywhere stack: a Vue 3 single-page app for the UI, a NestJS API for the brain, PostgreSQL with the pgvector extension for data *and* AI search, and a small Python FastAPI service for speech-to-text and embeddings. Generation is done by LLMs — Z.AI as the cheap primary, OpenAI as the fallback — called through an OpenAI-compatible interface. Everything is Dockerized behind Caddy. We chose each piece for type-safety, cost, and keeping AI data in-house."

Next: **[04-backend-deep-dive.md](./04-backend-deep-dive.md)**.
