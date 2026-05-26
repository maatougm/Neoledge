# 7 — The AI Pipeline

> The AI is the product's differentiator. This explains *what each AI feature does and how*, accessibly. (Exhaustive internals: `docs/AI_MODULE_GUIDE.md`.)

## The five AI features

| # | Feature | What it produces |
|---|---------|------------------|
| 1 | **Meeting transcript analysis** | Summary + action items + decisions from a meeting |
| 2 | **Cahier des charges** | The 9-section specification document |
| 3 | **AI backlog** | Epics + tasks (the work breakdown) |
| 4 | **Assignment suggestions** | Which team member fits each task |
| 5 | **Live meeting copilot** | Real-time "what to ask next" during a meeting |

Plus the **speech-to-text** pipeline (live transcription) that feeds #1 and #2.

## How the LLM is called: provider abstraction

All generation goes through one place that picks a provider against an **OpenAI-compatible** API:
- **Primary: Z.AI `glm-4.5-air`** — cheap, good French, supports tool-calling. (The live server currently runs a `glm-5-turbo` model variant.)
- **Fallback: OpenAI `gpt-4o-mini`** — used automatically if the primary errors or rate-limits.

Because both speak the same API shape, switching providers is a config change, not a rewrite.

## The "agent" runtime (how the AI uses tools)

For complex generation, the AI runs as a **tool-using agent**, not a single prompt. The idea: instead of dumping everything into one giant prompt, the AI is given **tools** it can call — `read_questionnaire`, `read_meeting_summaries`, `read_validated_cahier`, `read_relevant_meeting_excerpts` (pgvector search), etc. The agent loop:
1. The model decides which tool(s) to call.
2. The backend runs them (reading the database) and returns results.
3. The model uses those results, then calls a final **emit** tool to produce the structured output (e.g. `emit_cahier`).

There's also a faster **planner-worker** mode (the default for the cahier): since the cahier always needs the same data, the backend pre-fetches everything in parallel, hands it to the model in one shot, and the model emits the document — no back-and-forth loop. This cut cahier generation from ~108 s to ~21 s on the eval suite.

## Feature 1 — Meeting transcript analysis

- Meetings are captured **live** in the browser (`getDisplayMedia`/microphone → `MediaRecorder` → audio chunks → `/transcribe-chunk`), transcribed in real time.
- On demand, `AiService.analyzeTranscript` builds a prompt from the transcript segments and produces a **summary, action items, and decisions** (saved to the DB; the frontend polls until done).

## Feature 2 — Cahier des charges (the crown jewel)

- Pulls the questionnaire answers, meeting summaries, and any past rejection feedback into a prompt, and produces a **9-key JSON** (objectifDocument, contexte, objectifProjet, perimetreInclus, perimetreExclus, exigencesFonctionnelles, architectureTechnique, livrables, conclusion).
- Streams section-by-section to the UI via **Server-Sent Events** so the PM sees content appear progressively (first section in ~7 s).
- Saved into `Project.aiOutput`. The spec team then approves/rejects; a rejection's comment feeds the next generation.

### Anti-hallucination defense (important talking point)
Early testing caught the AI **inventing** tech names (e.g. claiming "AWS" or "DocuSign" when the client never said so). So there's a **six-layer defense**, the key ones being:
- A strict system-prompt rule: *never invent* client names, technologies, volumes, dates.
- An `INFO_MANQUANTE: <topic>` marker the model must emit when a section has no source — instead of fabricating.
- A **grounding pass** that scans the output for known tech names and rewrites any not found in the source material as `INFO_MANQUANTE`.
- **PII redaction** of transcripts before they enter the prompt.

> Demo point: in the generated cahiers you can literally see `[INFO_MANQUANTE: ...]` markers — that's the AI *refusing to make things up*, which is exactly what you want for a contractual document.

## Feature 3 — AI backlog

- Reads the driver questionnaire fields, the saved cahier, and recent meeting summaries; produces `{ epics: [{ title, priority, estimatedHours, children: [tasks] }] }`.
- The PM reviews/edits, then "accepts" → the backlog is written as **Work Packages**.
- Runs as an **async job** (start → poll) because it takes ~1–2 minutes, so the request never blocks/times out.

## Feature 4 — Assignment suggestions

- The PM selects tasks; the AI ranks up to 3 candidate **Member**s per task by fit, using signals like job title and *recently delivered tasks* on the project, with a confidence floor.
- Only the **Member** role is assignable (PMs and the spec team are excluded).

## Feature 5 — Live meeting copilot

- During a live meeting, it maintains a checklist of topics to collect and suggests questions to fill gaps — pushed to the browser over the `/copilot` WebSocket.

## Cost & safety controls

- Every LLM call logs one `AiUsage` row (tokens, cost, duration) and is checked against a **per-project daily token budget**.
- All AI calls have timeouts; fire-and-forget calls catch their own errors so they can't crash the server.
- The resolved AI config (provider/model/key-present) is logged at startup, so a misconfiguration is caught immediately, not as a vague "AI unavailable" later.

Next: **[08-design-decisions.md](./08-design-decisions.md)**.
