# 5 — Frontend Deep Dive (Vue 3)

> Goal: understand how the website is built, even if you've never used Vue. (Product name: **Neo Project**; the code lives in `web/Front/customapp`.)

## What "single-page application" means here

When you open the site, the browser downloads the Vue app **once**. After that, clicking around does **not** reload the page — Vue swaps the visible content instantly and fetches only the data it needs from the backend. This is why it feels app-like, not website-like.

## The building blocks

### Components (`.vue` files)
A **component** is a reusable piece of UI in a single `.vue` file with three parts:
```
<template>  … the HTML-like markup (what you see)
<script setup lang="ts">  … the logic (TypeScript)
<style scoped>  … CSS that only affects this component
```
There are ~180 components/views. Example: a Kanban column, a project card, the notification bell.

### Reactivity (the magic)
Vue tracks data with `ref()`. When a `ref`'s value changes, every part of the screen using it **re-renders automatically**. You never manually update the DOM. Example: `const loading = ref(true)` — flip it to `false` and the spinner disappears on its own.

### Views vs components
- **Views** (`src/views/`, ~27 + 8 team views) = full pages mapped to a URL (e.g. `PMProjectDetailView.vue`).
- **Components** (`src/components/`) = the smaller pieces views are built from.

## State management: Pinia (24 stores)

A **store** is a shared data container that any component can read/write, so data doesn't have to be passed manually through layers. Stores live in `src/stores/`.

Examples: `authStore` (logged-in user + token), `projectStore` (project list/detail), `notificationStore`, `backlogGeneratorStore`. A component just does `const auth = useAuthStore()` and reads `auth.userRole`.

> **Convention to know:** per-project stores are **reset** when navigating between projects (`store.reset()` in `onMounted`), so project B never briefly shows project A's data.

## Routing: Vue Router (role-aware)

`src/router/index.ts` maps URLs to views. Routes are **guarded by role**: a Member visiting `/app/admin/...` is redirected. The URL structure mirrors the roles:
- `/app/admin/*` — admin pages
- `/app/pm/projects/:id/*` — per-project PM pages (overview, questionnaire, meetings, cahier, board, gantt, backlog-generator, assign-tasks, members…)
- `/app/team/*` — Member + SpecificationTeam pages

## Talking to the backend: `lib/api.ts`

A single configured **axios** instance. Highlights:
- Automatically attaches the JWT token to every request.
- Prefixes relative URLs with the backend base URL (from a runtime `config.json`, so the same build works in dev and prod).
- Has a **timeout** (30s default, 180s for slow AI endpoints) so a hung backend can't freeze the UI forever.
- Auto-toasts on 5xx server errors; 4xx (validation/business errors) are left to the calling component to display.

## The UI library: NeoLibrary (on PrimeVue 4)

Instead of hand-building every button/table/dialog, the app uses **NeoLibrary** — a company component library wrapping **PrimeVue 4**. Components like `NeoButton`, `NeoTag`, `NeoSelect`, `NeoDialog` give a consistent look.

> **Gotchas a developer must know (they fail silently otherwise):**
> - `NeoTag` severity is `warn`, not `warning`.
> - `NeoButton` has no `primary` severity (omit it for the default).
> - Use `AppModal` (Teleport-based), not the deprecated `NeoDialog`.
> - All NeoLibrary components must be explicitly imported — a missing import renders an empty tag silently.

NeoLibrary ships as a packaged file (`deign/components-*.tgz`), so its internal styling (e.g. the brand button color) isn't edited directly — it's overridden via our own CSS (that's how the yellow rebrand recolors the primary buttons).

## Real-time on the frontend

Composables (`src/composables/`) wrap the Socket.IO client:
- `useNotificationSocket` — listens for push notifications, updates the bell.
- `useCollaborationSocket` — presence + who's-editing indicators.
- `useLiveCopilot` — the live-meeting assistant.

A **composable** is just a reusable function holding reactive logic (Vue's version of a custom hook).

## Styling & theme

Global CSS variables live in `src/assets/base.css` (e.g. `--nl-accent` = the brand accent, now NeoLeadge yellow `#F0C800`). Components reference these tokens, so changing one variable re-themes the whole app. Dark mode toggles a `.dark` class.

## Testing the frontend

**Vitest** runs ~868 unit tests (components mount in a simulated DOM, stores tested in isolation). Type-checking is done by **vue-tsc** during the build. A **Playwright** smoke test loads every route in a real headless browser asserting zero console errors.

## Cheat-sheet

| I want to find… | Open… |
|------------------|-------|
| a page | `src/views/` |
| shared data | `src/stores/` |
| the URL map + role guards | `src/router/index.ts` |
| backend calls | `src/lib/api.ts` |
| the theme colors | `src/assets/base.css` |
| real-time logic | `src/composables/` |

Next: **[06-data-layer.md](./06-data-layer.md)**.
