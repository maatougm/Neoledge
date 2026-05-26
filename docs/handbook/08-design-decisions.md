# 8 — Key Design Decisions (and Why)

> A decision log. Each entry: the decision, the reasoning, and the alternative we rejected. These are the "why did you do it that way?" answers.

### D1 — TypeScript end-to-end
**Decision:** one language (TypeScript) for backend and frontend.
**Why:** one skill set, shared types, compile-time safety across a large codebase.
**Rejected:** a split stack (e.g. Java backend + JS frontend) — two languages, no shared types.

### D2 — NestJS with a strict Controller → Service → Prisma layering
**Decision:** all logic in services; controllers only route; Prisma only does data.
**Why:** every one of ~35 modules looks identical, so the codebase is learnable and testable.
**Rejected:** unstructured Express — flexible but every feature reinvents structure.

### D3 — The Result pattern (services never throw for business errors)
**Decision:** services return `Result.ok` / `Result.fail`; controllers map to HTTP codes.
**Why:** business failures become explicit values that can't be silently swallowed; exceptions are reserved for true bugs.
**Rejected:** throwing exceptions for "not found"/"forbidden" — easy to miss, scatters HTTP concerns into services.

### D4 — DTOs are classes, not interfaces
**Decision:** request-body DTOs are classes with `class-validator` decorators.
**Why:** validation rules are read at runtime via class metadata; TypeScript interfaces vanish at compile time, so an interface-DTO would have its fields silently stripped.
**Rejected:** interface DTOs — caused silent data loss.

### D5 — PostgreSQL + pgvector (migrated from MySQL)
**Decision:** PostgreSQL as the single database, with the pgvector extension for AI search.
**Why:** keeps relational data and AI similarity search in one system; stronger SQL; no separate vector database to operate.
**Rejected:** a dedicated vector DB (Pinecone/Weaviate) — extra service to run, pay for, secure; and staying on MySQL (no good in-DB vector support).

### D6 — Self-hosted embeddings
**Decision:** generate embeddings with a local `multilingual-e5-small` model in the Python service.
**Why:** zero per-call cost, no rate limits, and **client data never leaves our servers** (confidentiality matters for administrations/hospitals).
**Rejected:** a paid embeddings API (OpenAI embeddings) — cost + data egress.

### D7 — Z.AI primary, OpenAI fallback, via an OpenAI-compatible interface
**Decision:** route all generation through one abstraction; Z.AI primary, OpenAI auto-fallback.
**Why:** Z.AI is ~10× cheaper with comparable quality and good French; the fallback keeps the product working during outages; the compatible API makes switching trivial.
**Rejected:** hard-coding a single provider — outages would break features, and switching would be a rewrite.

### D8 — Agent + planner-worker for generation
**Decision:** a tool-using agent runtime, with a fast "planner-worker" shortcut for deterministic reads (cahier/backlog/assignment).
**Why:** tools let the model fetch exactly what it needs (and use pgvector); planner-worker removes wasted round-trips where the read set is fixed (cut cahier from ~108 s to ~21 s).
**Rejected:** one giant prompt — worse grounding, higher hallucination, no semantic retrieval.

### D9 — Six-layer anti-hallucination for the cahier
**Decision:** strict prompt rules + `INFO_MANQUANTE` markers + a grounding regex pass + PII redaction + self-critique.
**Why:** the cahier is a *contractual* document; production testing caught invented tech names. A spec that fabricates facts is worse than one that flags gaps.
**Rejected:** trusting the model's raw output.

### D10 — Live meeting capture, not file upload
**Decision:** meetings are captured live in the browser and transcribed in chunks.
**Why:** matches the real workflow (a PM runs a meeting), gives real-time transcript + copilot.
**Rejected:** uploading a recorded audio file afterward (a legacy endpoint still exists but isn't the product path).

### D11 — Four roles; task assignment limited to Member
**Decision:** Admin / ProjectManager / SpecificationTeam / Member; only Members can be assigned tasks.
**Why:** clear separation — PMs own projects, SpecificationTeam validates, Members execute. Assignment-to-Member-only matches who actually does the work, enforced across three code surfaces that must agree (endpoint, write-validation, AI tool).
**Rejected:** the older 6-role model (RealizationTeam/DeploymentTeam/Viewer) — collapsed into the 4 + per-project responsibility fields.

### D12 — Soft-delete + explicit `isDeleted` filters
**Decision:** opt-in soft-delete on key tables; each read filters `isDeleted: false` explicitly.
**Why:** preserves history + enables trash/restore; explicit filters keep it obvious (no hidden global middleware surprising developers).
**Rejected:** hard deletes (no recovery) or a global silent filter (hard to reason about).

### D13 — Docker Compose + Caddy on one VPS
**Decision:** containerize all services; Caddy for TLS + routing.
**Why:** reproducible deploys, automatic HTTPS, simple single-host operation.
**Rejected:** manual server setup (TLS pain, "works on my machine" drift) or full Kubernetes (overkill for this scale).

### D14 — In-process real-time state (a known trade-off)
**Decision:** collaboration presence is held in the backend process memory.
**Why:** simple and fast for a single instance.
**Trade-off:** won't scale across multiple backend instances without a shared store (Redis). Documented as a known limitation.

### D15 — Async jobs for slow AI (backlog)
**Decision:** backlog generation returns a job id; the frontend polls.
**Why:** a ~90 s blocking HTTP request feels broken and risks proxy/client timeouts.
**Rejected:** one long synchronous request.

Next: **[09-presentation-script.md](./09-presentation-script.md)**.
