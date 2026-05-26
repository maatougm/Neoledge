# 6 — Data Layer (PostgreSQL + Prisma + pgvector)

> How and where the data lives. (Authoritative detail: `docs/DATABASE_SCHEMA.md`.)

## The database: PostgreSQL 16

All persistent data is in one PostgreSQL database (`neoleadge`). It's **relational**: data is in tables with relationships. There are **41 models** (tables) — users, projects, work packages, meetings, transcripts, the cahier feedback, notifications, audit logs, embeddings, and more.

## The ORM: Prisma 7

We never write raw SQL by hand. **Prisma** is the bridge between TypeScript code and the database.

### The schema file (`prisma/schema.prisma`)
One file describes every table, in a readable syntax:
```prisma
model Project {
  id               String   @id @default(uuid())
  name             String
  status           String   @default("Draft")
  projectManagerId String
  isDeleted        Boolean  @default(false)
  manualProgressPct Int?     // null = auto from work packages
  ...
}
```
From this, Prisma generates a fully typed client, so `prisma.project.findMany(...)` returns objects TypeScript understands.

### Migrations (how the schema changes safely)
Every schema change is a **versioned migration** — a timestamped SQL file in `prisma/migrations/`. In production, the backend runs `prisma migrate deploy` on boot, applying any new migrations.

> **Hard rule:** never use `prisma db push` (it can lose data and doesn't track changes). Always create a tracked migration with `prisma migrate dev`, applied with `migrate deploy`. This is enforced in the team rules.

### The adapter
In production Prisma connects via `@prisma/adapter-pg` (a PostgreSQL driver adapter). This is just the plumbing between Prisma and Postgres.

## Two important data conventions

### 1. Soft-delete
Some tables (Project, WorkPackage, comments, attachments) aren't physically deleted — they get `isDeleted = true`. This preserves history and allows a trash/restore feature.

> **Consequence a developer must remember:** every read of a soft-deletable table must include `isDeleted: false` in its filter, or deleted rows leak back into the UI. There's no global filter — it's explicit per query.

### 2. Multi-tenancy by `projectId`
Most data belongs to a project. Queries filter by `projectId`, and the `ProjectAccessGuard` (see backend doc) ensures a user can only touch projects they belong to. This keeps one client's data invisible to another.

## JSON columns
A few columns store JSON blobs instead of structured rows:
- `Project.aiOutput` — the saved cahier des charges (the 9-section document).
- `AppUser.preferences` — user settings.
- `AutomationRule.actionConfig`.

> **Rule:** every `JSON.parse` of these is wrapped in try/catch — a single corrupt row must never crash an endpoint.

## pgvector — AI similarity search inside the database

This is the part that makes the AI features smart.

### The problem it solves
When the AI writes the cahier des charges, it needs the **most relevant** meeting excerpts and questionnaire answers — found by *meaning*, not exact keywords. ("What did the client say about security?" should match a sentence about "chiffrement" even if the word "security" never appears.)

### How it works
1. Text is turned into an **embedding** — a list of 384 numbers capturing its meaning — by a self-hosted model (`multilingual-e5-small`) in the Python service.
2. Embeddings are stored in three vector columns: on transcript segments, on questionnaire field values, and on meeting summaries.
3. To find relevant text, we compute the **cosine similarity** between the query's embedding and the stored ones, and return the closest matches — accelerated by an **HNSW index** (a fast approximate nearest-neighbor index).

### Why this design
- **Self-hosted embeddings** = zero external API cost + client data never leaves our servers (confidentiality).
- **In-database (pgvector)** = no separate vector database to run, secure, or pay for. One database for relational data *and* AI search.
- The model handles French + other languages (it's "multilingual"), and uses e5's `passage:`/`query:` prefixes for accurate matching.

### Verifiable result
On the retrieval evaluation suite, this achieves **100% recall@5** (the right excerpt is in the top 5 results every time) with ~30–47 ms latency.

## Where to look

| For… | Open… |
|------|-------|
| every table + relationship + cascade rules | `docs/DATABASE_SCHEMA.md` |
| the live schema | `web/back-nest/prisma/schema.prisma` |
| schema-change history | `web/back-nest/prisma/migrations/` |
| the embeddings/indexer code | `web/back-nest/src/ai/embeddings/` |

Next: **[07-ai-pipeline.md](./07-ai-pipeline.md)**.
