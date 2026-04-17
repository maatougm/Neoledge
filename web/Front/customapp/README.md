# NeoLeadge Frontend (`customapp`)

Vue 3 + Vite + Pinia + NeoLibrary SPA for the NeoLeadge Deployment Manager.

## Run

```bash
npm install
npm run dev    # http://localhost:5173 (or 5174 if 5173 is taken)
npm run build  # type-check + production build to dist/
npm run lint
```

`public/config.json` provides runtime `GLB_API_URL` / `GLB_ELISE_URL`. Change the backend URL there (no rebuild needed).

## NeoLibrary constraints — READ THIS

- `NeoButton`: props `label`, `icon`, `loading`, `disabled`, `outlined`, `text`, `size`. **Never** use `severity="primary"` — omit `severity` for default teal. Valid: `secondary`, `danger`, `warn`.
- `NeoDatePicker`: `v-model` must be `string | string[] | null`. **Never** bind a `Date` object.
- `useNeoToast()` only exposes `.add({ severity, summary?, detail, life? })`. No `.success()` / `.error()` shortcuts.
- `useNeoConfirm().require(options)` returns `void`. Use the `accept` callback; don't `await` it.
- **`NeoDialog` does not exist** in current NeoLibrary — use `components/common/AppModal.vue` instead.
- `NeoTag` severity values: `success | info | warn | danger | secondary | contrast`.
- `NeoInputText` v-model is always `string`. Don't use `v-model.number` — parse on submit instead.

## Layout shell

`AppShell.vue` is the root authenticated layout. It provides:

- Collapsible `AppSidebar` with contextual nav (switches to project-module nav when inside `/app/pm/projects/:id/*`)
- `AppTopbar` with notification bell + user menu
- `<router-view>` for the page content
- Global `NeoConfirmDialog` + `NeoToast` (required for `useNeoConfirm` / `useNeoToast` to work)

The contextual sidebar uses `router.afterEach` (not a computed) to update nav after navigation completes — this prevents RouterView crashes during layout transitions.

## Views map

### Admin — `/app/admin/*`
| Route | View | Purpose |
|-------|------|---------|
| `/dashboard` | `DashboardSection` | Overview metrics |
| `/projects` | `ProjectManagementSection` | Project CRUD, bulk ops |
| `/users` | `UserManagementSection` | User CRUD |
| `/templates` | `TemplatesSection` | Project templates |
| `/analytics` | `AnalyticsSection` | 4-panel dashboard (phase velocity, bottleneck, risk, workload) |
| `/activity` | `ActivitySection` | Global activity feed |
| `/logs` | `LogsSection` | Audit logs |
| `/system` | `SystemStatusSection` | Health check |
| `/trash` | `TrashSection` | Soft-deleted projects |
| `/portfolio` | `PortfolioView` | **v2.0** Portfolio CRUD |
| `/team-planner` | `TeamPlannerView` | **v2.0** Capacity + assignments + conflicts |

### PM — `/app/pm/*`
| Route | View | Purpose |
|-------|------|---------|
| `/projects` | `PMProjectsPage` | Assigned project list |
| `/projects/:id` | `PMProjectDetailView` | **v2.0** OpenProject-style module tile grid |
| `/projects/:id/workpackages` | `WorkPackagesView` | **v2.0** WP list + detail split panel |
| `/projects/:id/gantt` | `GanttView` | **v2.0** Timeline + milestones + baselines |
| `/projects/:id/board` | `KanbanBoardView` | **v2.0** Drag-drop kanban |
| `/projects/:id/backlogs` | `BacklogView` | **v2.0** Unassigned + active sprint |
| `/projects/:id/sprint` | `SprintBoardView` | **v2.0** Sprint picker + burndown chart |
| `/projects/:id/wiki[/:slug]` | `WikiView` | **v2.0** Per-project wiki |
| `/projects/:id/budget` | `BudgetView` | **v2.0** Budget + line items + burn report |
| `/projects/:id/time` | `TimeTrackingView` | **v2.0** Time entries + summary |
| `/projects/:id/members` | `MembersView` | **v2.0** Member list |
| `/projects/:id/activity` | `ProjectActivityView` | **v2.0** Project activity feed |

### Team — `/app/team/*`
- `/projects` — `TeamMemberView`
- `/projects/:id` — `PMProjectDetail` (readonly)
- `/validations` — `TeamMemberView`

### Public
- `/login` — `LoginView`
- `/portal/:token` — `ClientPortalView`
- `/unauthorized`, `/force-change-password`, `/custom-action`

## Stores (Pinia, in `src/stores/`)

Core: `authStore`, `configStore`, `uiStore`
Admin CRUD: `projectStore`, `userStore`, `templateStore`
PM: `pmStore` (projects, meetings, validations, AI polling, automation)
Data: `analyticsStore`, `notificationStore`, `commentStore`, `savedFiltersStore`

**v2.0 stores:** `workPackageStore`, `agileStore`, `ganttStore`, `timeStore`, `budgetStore`, `wikiStore`, `portfolioStore`, `teamPlannerStore`, `meetingExtrasStore`

## Shared utilities

- `lib/api.ts` — axios instance with JWT + base-URL interceptors
- `lib/formatDate.ts` — `formatDate`, `formatDateShort`, `formatDateTime`, `formatRelative` (FR locale). **Use these instead of re-implementing `new Date(iso).toLocaleDateString()` in every view.**
- `utils/phaseLabels.ts` — translates `ProjectStatus` enum values (Draft → Brouillon, etc.)

## Shared components (v2.0)

- `common/AppModal.vue` — Teleport modal (replaces deprecated NeoDialog)
- `common/ProjectModuleShell.vue` — wraps project module pages with breadcrumbs + header
- `common/ProjectBreadcrumbs.vue` — Home > Project > Module trail
- `common/SplitPanel.vue` — responsive 35/65 list + detail layout
- `common/ModulePageHeader.vue` — title + status tag + actions bar
- `common/PriorityDot.vue` — colored dot for WP priority
- `common/WpStatusTag.vue` — NeoTag wrapper with status → severity mapping

## Composables

- `useDarkMode` — dark/light toggle + persistence
- `useNotificationSocket` — Socket.IO `/notifications` namespace
- `useCollaborationSocket` — Socket.IO `/collaboration` namespace (presence + field sync)
- `useProjectForm` — project creation/edit state + validation

## Adding a new view

1. Create `src/views/MyNewView.vue`. For project module pages, wrap with `ProjectModuleShell`:
   ```vue
   <template>
     <ProjectModuleShell :project-id="id" title="My Module">
       <template #actions>
         <NeoButton label="Action" icon="pi pi-plus" @click="..." />
       </template>
       <!-- content -->
     </ProjectModuleShell>
   </template>
   <script setup lang="ts">
   defineProps<{ id: string }>()
   </script>
   ```
2. Add the route in `src/router/index.ts` under the appropriate layout's `children` (use `props: true`).
3. If it's a project sub-module, add a nav entry in `AppShell.vue`'s `buildProjectModuleNav()` function.
4. Add any new store in `src/stores/` following the pattern of existing stores (e.g. `workPackageStore.ts`).

## Known gotchas

- **Bundle size** — `neolibrary.js` is ~970 KB (monolithic vendor). Cached in browser, so only loaded once. App code is split: `index.js` is ~15 KB, per-route chunks 5–30 KB each, `chart.js` lazy-loaded.
- **Type-check vs build** — `npm run build` runs `vue-tsc --noEmit` AND `vite build` in parallel. The build can succeed while type-check fails. Watch both outputs.
- **NeoDatePicker + ISO strings** — the picker returns `dd/mm/yy` strings. Convert to `YYYY-MM-DD` before sending to backend using `toISODate()` (see `composables/useProjectForm.ts`).
- **Axios multipart uploads** — never set `Content-Type: multipart/form-data` manually; axios sets the boundary automatically when `FormData` is passed.

---

## Recommended IDE setup

[VS Code](https://code.visualstudio.com/) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (disable Vetur) + [TypeScript Vue Plugin (Volar)](https://marketplace.visualstudio.com/items?itemName=Vue.vscode-typescript-vue-plugin).
