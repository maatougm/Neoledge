# 2 — Architecture

## The big picture: three programs + a database

Neo Project is not one program — it's a few cooperating services. Here's the whole system on one page:

```
                    ┌─────────────────────────────────────────────┐
   Browser  ───────▶│  Caddy  (reverse proxy + HTTPS/TLS)          │
   (the user)       │  routes by URL path                          │
                    └───────┬───────────────────────┬─────────────┘
                            │                        │
              static files  │                        │ /api, /auth, /pm, /spec...
                            ▼                        ▼
                  ┌──────────────────┐    ┌──────────────────────────┐
                  │  Frontend (web)  │    │  Backend (server)         │
                  │  Vue 3 SPA       │    │  NestJS 11 (TypeScript)   │
                  │  served by nginx │    │  REST API + Socket.IO     │
                  └──────────────────┘    └───────┬──────────┬───────┘
                                                  │          │
                              Prisma ORM          │          │  HTTP
                                                  ▼          ▼
                                       ┌────────────────┐  ┌─────────────────────┐
                                       │ PostgreSQL 16  │  │ Transcription svc    │
                                       │ + pgvector     │  │ Python FastAPI       │
                                       │ (all the data) │  │ faster-whisper +     │
                                       └────────────────┘  │ SpeechBrain + e5     │
                                                           └─────────────────────┘
                                                  │
                                                  │  HTTPS (LLM calls)
                                                  ▼
                                       ┌────────────────────────────┐
                                       │ External AI: Z.AI / OpenAI │
                                       │ + AssemblyAI (speech)      │
                                       └────────────────────────────┘
```

### What each box is

| Box | Tech | Role | Port (dev) |
|-----|------|------|-----------|
| **Frontend** | Vue 3 + Vite | The website. Pure UI; holds no business rules. Talks to the backend over HTTP + WebSocket. | 5173 |
| **Backend** | NestJS 11 (TypeScript) | The brain. All business rules, auth, the database, AI orchestration. | 5122 |
| **Database** | PostgreSQL 16 + pgvector | Stores everything. pgvector adds "AI similarity search." | 5432 |
| **Transcription** | Python FastAPI | Converts meeting audio → text (+ speaker labels + embeddings). | 8000 |
| **Caddy** | Caddy server | Front door: HTTPS certificates + routes traffic to web vs backend. | 443 |

> **Why split into services?** Each can be scaled, deployed, and reasoned about independently. The Python service exists only because the best speech/ML libraries (faster-whisper, SpeechBrain, sentence-transformers) are Python — so we isolate that ecosystem instead of forcing it into the TypeScript backend.

---

## How a typical request flows (concrete example)

**Scenario:** the PM clicks "Generate cahier des charges."

```
1. Browser (Vue) → HTTP GET /pm/projects/:id/cahier-des-charges/preview-stream
                    with a JWT token in the Authorization header
2. Caddy sees the path starts with /pm → forwards to the Backend
3. Backend guards run IN ORDER:
     - JwtAuthGuard      : "is this token valid?"          (else 401)
     - ProjectAccessGuard: "can THIS user touch THIS project?" (else 403)
     - PermissionsGuard  : "does the role allow this action?"   (else 403)
4. Controller calls the CahierService
5. Service reads from PostgreSQL (questionnaire answers, meeting summaries),
   builds a prompt, calls the LLM (Z.AI), runs anti-hallucination checks
6. Result streams back to the browser via Server-Sent Events (section by section)
7. Vue renders each section as it arrives
```

The same shape applies everywhere: **Browser → Caddy → Controller → Guards → Service → Database/AI → response.** The "Service" layer is where all logic lives.

---

## Two ways the frontend talks to the backend

1. **REST (request/response)** — most actions. "Give me the projects," "save this field." Plain HTTP via the `axios` library.
2. **WebSockets (real-time push)** — when the server needs to *push* to the browser without being asked. Built on **Socket.IO**. Three "namespaces":
   - `/notifications` — bell-icon alerts ("your cahier was approved").
   - `/collaboration` — live presence + who's editing which field (so two PMs don't clobber each other).
   - `/copilot` — the live-meeting assistant's suggestions.

> **Mental model:** REST = "I ask, you answer." WebSocket = "you tap me on the shoulder when something happens."

---

## The request lifecycle inside the backend (NestJS layers)

NestJS organizes code into layers. A request passes through them top-to-bottom:

```
HTTP request
   │
   ▼  Guard        → security: is the caller allowed? (auth, project access, role)
   ▼  Pipe         → validation: is the request body well-formed? (ValidationPipe)
   ▼  Controller   → routing: maps the URL to a method; no logic here
   ▼  Service      → ALL business logic lives here; returns a Result
   ▼  Prisma       → database access (typed queries)
   │
   ▼  HTTP response (Controller turns the Service's Result into 200/400/404…)
```

This separation is strict and intentional — see **[04-backend-deep-dive.md](./04-backend-deep-dive.md)**.

---

## Deployment topology (production)

Everything runs as **Docker containers** orchestrated by **Docker Compose** on a single VPS:

```
neoleadge_postgres     PostgreSQL 16 + pgvector   (the database, a persistent volume)
neoleadge_server       NestJS backend             (runs DB migrations on boot, then serves)
neoleadge_web          nginx serving the built Vue app
neoleadge_transcription Python FastAPI speech service
caddy                  TLS terminator, routes by hostname/path
```

- **TLS/HTTPS** is automatic via Caddy + Let's Encrypt.
- On deploy: the repo is pulled, images are rebuilt, containers restarted. The backend container automatically applies any pending **database migrations** before starting.
- Live URL: `https://neoleadge.pythagore-init.com`.

> **Talking point:** "It's a standard containerized 3-tier web app — SPA frontend, API backend, SQL database — with an extra Python microservice for ML, all behind a reverse proxy." That sentence alone answers most architecture questions.

Next: **[03-tech-stack-and-rationale.md](./03-tech-stack-and-rationale.md)** — every technology, explained from zero.
