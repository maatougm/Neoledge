# Rapido — demo-video setup (restaurant platform)

A self-contained, **deterministic** demo of the full NeoLeadge flow built around a
fictional client **Rapido** ("Plateforme intelligente de gestion de restaurant").
Everything the camera shows is pre-baked and reproducible — **no live AI calls,
no tokens, no latency, nothing to hallucinate**.

What you get:

| Screen | Pre-baked content |
|---|---|
| Questionnaire | All fields filled from the client brief; 3 backlog-driver fields answered |
| Réunions | A saved "Réunion de cadrage — Rapido" (the reunion script, segmented by speaker) + AI summary + 3 action items + 4 decisions |
| Cahier des charges | A complete, approved 9-section cahier (no `INFO_MANQUANTE`) |
| Validations | Cahier **approved** by the SpecificationTeam |
| Backlog / Board / Sprint | 6 epics + 14 tasks assigned to members, spread across Kanban columns + an active sprint |
| **Live meeting copilot** | A scripted, deterministic checklist that fills in **live** as the reunion script is spoken (the one on-camera "magic" moment) |

The project id is fixed: **`f00d0000-0000-4000-8000-000000000001`**.

---

## How the live copilot is made deterministic

Normally the live-meeting copilot calls the AI on the real transcript. For the
demo it is replaced by a fixed, hand-authored checklist that reacts to the
**actual** spoken words — so it still "comes alive" on camera, but it can never
show wrong or missing topics.

- Implemented in `web/back-nest/src/meetings/live-copilot.demo.ts`.
- Activated **only** when `DEMO_COPILOT_MODE=on` **and** the meeting belongs to
  the Rapido project. It is a strict no-op for every other project/session, and
  off by default.
- Each checklist row flips from *à collecter* → *couvert* when its trigger words
  appear in the transcript (accent-insensitive, tolerant of imperfect speech
  recognition). When everything is covered, the **"Prêt pour le cahier"** badge
  lights up.

Because onsite mode transcribes in the browser (Web Speech API) and the cahier /
backlog are pre-baked, **the whole demo works even with the AI provider disabled.**

### Speech → copilot reaction map

| When the script says… | …this row turns green |
|---|---|
| "développer une solution pour **améliorer la gestion** de notre restaurant" | Objectif du projet |
| "plusieurs **méthodes manuelles**… des **erreurs** et des **retards**… **forte activité**" | Problèmes actuels |
| "certains **plats** ne sont plus **disponibles**… pas **mise à jour**… **temps réel**" | Suivi des plats & stocks |
| "gérer les **commandes**…" | Gestion des commandes |
| "…les **réservations**…" | Gestion des réservations |
| "…les **menus** et **les plats**…" | Gestion des menus & plats |
| "espace **administrateur**… **tableau de bord**" | Espace administrateur |
| "**React** JS… **Node**.js avec **Express**… **MySQL**" | Stack technique |
| "une période de **quatre mois** avec des **réunions de suivi**" | Délai & suivi |

The 4 suggestion cards (Objectif, Problèmes, Suivi plats, Espace admin) appear at
the start and resolve to green as those topics are spoken.

---

## Logins

| Role | Email | Password |
|---|---|---|
| Admin | `admin@neoleadge.com` | `Admin@123` |
| **PM (use this for the demo)** | `pm@neoleadge.com` | `Pm@123` |
| SpecificationTeam | `spec@neoleadge.com` | `Spec@123` |
| Member (dev) | `antoine@neoleadge.com` | `Dev@123` |
| Member (dev) | `karim@neoleadge.com` | `Dev@123` |
| Member (QA) | `lea@neoleadge.com` | `Qa@123` |

---

## Deploy to the test server

> Run from your machine. Assumes the changes are committed & pushed to `nest-back`.

**1. Pull the code on the server**

```bash
ssh -i ~/.ssh/id_ed25519 root@187.77.70.67 \
  'cd /root/neoleadge && git fetch origin nest-back && git reset --hard origin/nest-back'
```

**2. Turn the demo flags on in `.env.prod`** (`/root/neoleadge/deploy/neoleadge/.env.prod`)

```env
LIVE_MEETING_COPILOT=on
DEMO_COPILOT_MODE=on
# DEMO_COPILOT_PROJECT_ID can stay blank — it defaults to the Rapido seed id.
```

**3. Rebuild + restart `server` and `web`**

```bash
ssh -i ~/.ssh/id_ed25519 root@187.77.70.67 \
  'cd /root/neoleadge/deploy/neoleadge \
   && docker compose -f docker-compose.prod.yml --env-file .env.prod build server web'
```

Then restart (AppArmor blocks `docker stop`, so kill-then-rm):

```bash
ssh -i ~/.ssh/id_ed25519 root@187.77.70.67 \
  'cd /root/neoleadge/deploy/neoleadge \
   && PID=$(docker inspect -f "{{.State.Pid}}" neoleadge_server 2>/dev/null) \
   && [ -n "$PID" ] && kill -9 "$PID"; docker rm -f neoleadge_server neoleadge_web 2>/dev/null; \
   docker compose -f docker-compose.prod.yml --env-file .env.prod up -d server web'
```

**4. Seed the Rapido project** (runs inside the freshly-built container with plain
`node` — no `tsx` needed):

```bash
ssh -i ~/.ssh/id_ed25519 root@187.77.70.67 \
  'cd /root/neoleadge/deploy/neoleadge \
   && docker compose -f docker-compose.prod.yml exec -T server node prisma/seed-demo-rapido.mjs'
```

You should see `✅  Rapido demo project ready.` Open
`https://neoleadge.pythagore-init.com`, log in as the PM, and the Rapido project
is fully populated.

---

## Recording the live-meeting moment

1. **Use Chrome or Edge** (Web Speech API), with a working microphone.
2. PM → Rapido project → **Réunions** → **Réunion en direct**.
3. Keep meeting type **Cadrage**, choose **Sur site**, language **Français (FR)**.
4. Click **Démarrer (micro)** and allow microphone access.
5. Read the reunion script aloud (one or two presenters). Within a few sentences
   the checklist appears; rows turn green as each topic is spoken; the coverage
   bar rises and **"Prêt pour le cahier"** appears at the end.
6. Click **Terminer & enregistrer** to save the meeting (optional on camera).

The pre-baked cahier and backlog are already there to show right after.

---

## Reset between takes

The seed is idempotent — re-running it wipes and recreates **only** the Rapido
project (every other project is untouched):

```bash
ssh -i ~/.ssh/id_ed25519 root@187.77.70.67 \
  'cd /root/neoleadge/deploy/neoleadge \
   && docker compose -f docker-compose.prod.yml exec -T server node prisma/seed-demo-rapido.mjs'
```

For the live copilot, just start a new meeting (each gets a fresh session).

---

## Revert after the shoot

1. In `.env.prod` set `DEMO_COPILOT_MODE=off`, then restart `server` (step 3 above).
   The copilot returns to normal AI behaviour. (The demo code is inert while the
   flag is off, so you can leave it in place.)
2. Optionally delete the demo project: log in as Admin → Projets → Corbeille, or
   re-run nothing and just leave it.
3. To remove the code entirely: revert the commit, delete
   `src/meetings/live-copilot.demo.ts`, `prisma/seed-demo-rapido.mjs`, and the
   `DEMO_COPILOT_*` lines in `docker-compose.prod.yml` / `.env.prod`.
