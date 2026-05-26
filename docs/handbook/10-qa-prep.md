# 10 — Q&A Preparation

> Anticipated questions with precise, honest answers. Format: **Q** → short answer → (extra if pushed).

## Product

**Q: What does Neo Project actually do?**
Runs IT-deployment projects end-to-end and uses AI to generate the specification document and the task backlog, plus real-time meeting transcription and analysis. Humans (PM + spec team) review and approve everything.

**Q: Who are the users?**
Four roles: Admin (manages projects/users), ProjectManager (owns projects), SpecificationTeam (validates the cahier), Member (executes tasks).

**Q: Is it in production?**
Yes — deployed at a live URL, containerized, with automatic HTTPS and database migrations on deploy.

## Architecture

**Q: Why split into multiple services instead of one app?**
Each service scales and deploys independently. The Python service exists because the best speech/ML libraries are Python-only, so we isolate that ecosystem behind a clean HTTP boundary instead of forcing it into the TypeScript backend.

**Q: How does the frontend talk to the backend?**
REST (request/response) for most actions via axios, and Socket.IO WebSockets for real-time push (notifications, presence, the live copilot).

**Q: What happens on a request, security-wise?**
Guards run in order: JWT validity → project access → role/permission. Only then does the controller call the service. The project-access guard prevents users from touching projects they don't belong to (closes an IDOR).

## Technology choices

**Q: Why Vue and not React/Angular?**
Vue 3 has a gentle learning curve, readable single-file components, and built-in reactivity. It's fast to build in and fast at runtime. (We're not religious about it — the reasons are pragmatic.)

**Q: Why NestJS?**
Opinionated structure: 35 modules all follow the same Controller→Service→Prisma shape, so the codebase is learnable and testable, with dependency injection built in.

**Q: Why PostgreSQL + pgvector instead of a vector database?**
Keeping relational data and AI similarity search in one database means no separate vector DB to run, secure, or pay for. pgvector is mature and fast (HNSW index).

**Q: Why two AI providers?**
Z.AI is ~10× cheaper than OpenAI with comparable quality and good French; OpenAI is the automatic fallback for outages. Both use an OpenAI-compatible API, so switching is a config change.

**Q: Why self-host the embeddings?**
Zero per-call cost, no rate limits, and — critically for administrations/hospitals — client data never leaves our servers.

## AI (expect the most scrutiny here)

**Q: How do you stop the AI from hallucinating / inventing facts?**
A six-layer defense: strict "never invent" prompt rules; an `INFO_MANQUANTE` marker the model must use when a section has no source; a grounding pass that rewrites any tech name not present in the source material as `INFO_MANQUANTE`; PII redaction; and a self-critique pass. We added this after production testing caught invented tech names. The cahier is contractual, so flagging a gap beats fabricating.

**Q: How does the AI know the project's specifics?**
It doesn't get told everything in one prompt. It uses *tools* to read the questionnaire, meeting summaries, and the most relevant excerpts (found via pgvector semantic search), then writes from that real data.

**Q: Is the output deterministic / trustworthy?**
It's reviewed by humans — the PM edits the cahier and the SpecificationTeam approves/rejects. We also score quality with an evaluation suite (the cahier suite scores 100/100 on fact-grounding + anti-hallucination + French style).

**Q: What if the AI is wrong?**
The PM edits any field; a rejected cahier's feedback feeds the next generation; backlog tasks are editable before being accepted; assignment suggestions are just suggestions.

**Q: How much does the AI cost to run?**
Every call is logged with token counts and cost, and there's a per-project daily token budget cap. Z.AI keeps per-call cost low; embeddings are free (self-hosted).

## Data & reliability

**Q: How do schema changes work?**
Versioned Prisma migrations, applied automatically on deploy with `migrate deploy`. Never `db push` (data-loss risk).

**Q: Is deleting data reversible?**
Key tables use soft-delete (`isDeleted` flag) with a trash/restore feature; history is preserved.

**Q: How is it tested?**
~1,650 backend unit tests (Jest, mocked DB), ~870 frontend tests (Vitest), type-checking (tsc/vue-tsc), and a Playwright smoke test that loads every page asserting zero console errors. CI runs all of these.

## Honest limitations (don't hide these)

**Q: What doesn't scale yet?**
Real-time presence is held in the backend's memory, so it works on a single instance; multiple instances would need a shared store (Redis). It's documented.

**Q: Any rough edges?**
AI generation is slow (20–90 s) — inherent to LLM calls; we mitigate with streaming (cahier) and async jobs (backlog), and honest progress UI. The frontend ESLint config isn't fully wired (advisory only; not a production gate).

**Q: Why is the code named "NeoLeadge" if the product is "Neo Project"?**
"Neo Project" is the product brand; "NeoLeadge" is the original internal name still used by the codebase, database, containers, and live domain. Renaming the infrastructure would take the live site down, so we rebranded the user-facing layer only. Same product.

## Curveballs

**Q: Could you swap the LLM for a different one?**
Yes — it's behind an OpenAI-compatible abstraction. We'd point it at the new provider's endpoint and A/B test with our eval scripts before committing.

**Q: What's the single most important file to understand the system?**
`CLAUDE.md` at the repo root — the engineering rulebook and gotchas. Then `prisma/schema.prisma` for the data shape.

Next: **[11-glossary.md](./11-glossary.md)**.
