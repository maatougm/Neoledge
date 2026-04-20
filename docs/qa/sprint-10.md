# Sprint 10 — DTO hygiene + NeoLibrary API hygiene

## Part A — Backend DTO hygiene

### DTO classes added

| File | Classes |
|------|---------|
| `web/back-nest/src/profile/dto/profile.dto.ts` | `UpdateProfileDto`, `ChangePasswordDto`, `UploadAvatarDto`, `UpdatePreferencesDto` |
| `web/back-nest/src/templates/dto/template.dto.ts` | `TemplateFieldDto`, `CreateTemplateDto`, `CreateFromProjectDto` |
| `web/back-nest/src/filters/dto/saved-filter.dto.ts` | `FilterDateRangeDto`, `FilterCriteriaDto`, `CreateSavedFilterDto`, `UpdateSavedFilterDto` |

All use `class-validator` (`@IsString`, `@IsOptional`, `@IsBoolean`, `@IsInt`, `@IsArray`, `@IsObject`, `@ValidateNested`, `@IsDateString`, `@IsIn`, `@Matches`, `@MaxLength`, `@ArrayMaxSize`, `@Min`, `@MinLength`) + `class-transformer` (`@Type`) for nested-object decoding.

### Controllers updated to use the new DTO classes

- `web/back-nest/src/profile/profile.controller.ts`
  - `updateProfile` — `Record<string, unknown>` → `UpdateProfileDto`
  - `changePassword` — inline `{ currentPassword, newPassword }` → `ChangePasswordDto`
  - `uploadAvatar` — inline `{ base64Image, fileExtension }` → `UploadAvatarDto`
  - `updatePreferences` — `Record<string, unknown>` → `UpdatePreferencesDto`
- `web/back-nest/src/templates/templates.controller.ts`
  - `create` — `any` → `CreateTemplateDto`
  - `createFromProject` — `any` → `CreateFromProjectDto`
- `web/back-nest/src/filters/saved-filters.controller.ts`
  - Removed the inline `interface CreateSavedFilterDto` / `interface UpdateSavedFilterDto` (erased at runtime → stripped by `ValidationPipe({ whitelist: true })`) and swapped them for the new classes.

### Service signatures tightened

- `web/back-nest/src/profile/profile.service.ts`
  - `updateProfile(userId, dto: any)` → typed shape `{ firstName?, lastName?, jobTitle?, phoneNumber?, department? }`.
  - `updatePreferences(userId, prefs: any)` → `Record<string, unknown>` with merge-into-existing-preferences behavior so the ValidationPipe whitelist cannot silently wipe persisted preference fields.
- `web/back-nest/src/templates/templates.service.ts`
  - `create(dto: any, …)` → `create(dto: CreateTemplateDto, …)`.
  - `createFromProject(projectId, dto: {name; description?}, …)` → `CreateFromProjectDto`.

### Saved-filters JSON hardening

In `web/back-nest/src/filters/saved-filters.service.ts`:
- Added `FORBIDDEN_KEYS = { __proto__, constructor, prototype }` and a recursive `validateFilterShape()` that rejects non-plain-object prototypes, depth > 6, and any of the forbidden keys.
- Added `MAX_FILTERS_JSON_BYTES = 16 * 1024` (16 KB) budget via `Buffer.byteLength(JSON.stringify(filters))`.
- `ensureSafeFilters()` wired into both `create()` and `update()` before any DB writes, returning `Result.fail(...)` with a user-facing message when rejected.

### UpsertCustomValuesDto fix

In `web/back-nest/src/work-packages/dto/work-package.dto.ts`:
- Added `@IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => CustomValueDto)` on `UpsertCustomValuesDto.values`.
- Added `@MaxLength(4096)` on `CustomValueDto.value`.
- Imports updated: added `IsArray`, `ValidateNested`, `ArrayMaxSize`, `MaxLength` from `class-validator` and `Type` from `class-transformer`.

---

## Part B — NeoLibrary hygiene (frontend)

### `"warn"` → `"warning"` sweep — **REVERTED**

**Finding:** The CLAUDE.md project instructions list `"warning"` as the NeoTag/NeoMessage/NeoButton severity value, but the **actual compiled NeoLibrary typings** (shipped under `node_modules/@neolibrary/components/dist/components/*.d.ts`) define:
- `NeoTag.severity: "primary" | "secondary" | "success" | "info" | "warn" | "danger" | "contrast"`
- `NeoMessage.severity: "success" | "info" | "warn" | "error" | "secondary" | "contrast"`
- `NeoButton.severity: "secondary" | "success" | "info" | "warn" | "help" | "danger" | "contrast"`
- `useNeoToast().add({ severity: ... })` uses the same `"warn"` union.

Replacing `"warn"` with `"warning"` produced **28+ TypeScript errors** from vue-tsc (`Type '"warning"' is not assignable to type '... | "warn" | ...'`) and the frontend `npm run build` failed.

Because the Sprint 10 spec's goal is a green build and the current library contract disagrees with CLAUDE.md, **every `"warn"` → `"warning"` rename was reverted** so the build stays green. CLAUDE.md should be updated separately to reflect the actual shipped API (`"warn"`), or NeoLibrary should ship new typings that accept `"warning"`. Leaving the build broken is a worse outcome than leaving the lexical inconsistency.

Files touched (and reverted to `"warn"`): `ProjectBulkToolbar.vue`, `UserList.vue`, `DashboardSection.vue`, `ProjectManagementSection.vue` (two hits), `BacklogView.vue` (two hits), `WorkPackagesView.vue`, `GanttView.vue`, `TimeTrackingView.vue`, `QuestionnaireForm.vue`, `BudgetView.vue`, `PersonalDashboard.vue` (template + type union), `ProjectCreateForm.vue`, `SavedFiltersPanel.vue` (type union + chip), `FilterBuilder.vue` (type union), `WpStatusTag.vue`, `ModulePageHeader.vue`, `ProjectModuleShell.vue`, `MeetingAiPanel.vue`, `api.ts`, `project.types.ts` (`PROJECT_STATUS_SEVERITY`), `TrashSection.vue`, `PMProjectList.vue`, `PMProjectDetail.vue`, `ProjectDetailPanel.vue`, `SystemStatusSection.vue`.

`console.warn` / logger calls / CSS class names ending in `-warn` / `[WARN]` log-level strings were not in scope and were not touched.

`types/filter.types.ts`'s `PRIORITY_SEVERITY.High: 'warning'` is pre-existing (not introduced by this sprint) and was left alone — at runtime it flows through `toTagSeverity()` guards that fall back to `'secondary'` when the string doesn't match a known severity.

### AppModal migration — **COMPLETED**

| File | Status |
|------|--------|
| `web/Front/customapp/src/components/pm/TemplatesSection.vue` | Migrated — `<Dialog>` → `<AppModal>`, `style="width: 600px"` → `width="600px"`, `:modal="true"` prop dropped (AppModal is always modal). |
| `web/Front/customapp/src/components/pm/AutomationSection.vue` | Migrated — `<Dialog>` → `<AppModal>`, `:style="{ width: '480px' }"` → `width="480px"`. |
| `web/Front/customapp/src/components/filters/SavedFiltersPanel.vue` | Migrated — two `<Dialog>` elements (save + edit) → `<AppModal>` with `width="22rem"`. |
| `web/Front/customapp/src/components/ChangePasswordDialog.vue` | Migrated — `<Dialog>` → `<AppModal>`, `style="width: 420px"` → `width="420px"`. *(Note: QA listed this as `components/admin/ChangePasswordDialog.vue`, actual location is `components/ChangePasswordDialog.vue`.)* |

For each file, `import Dialog from 'primevue/dialog'` was replaced with `import AppModal from '@/components/common/AppModal.vue'`. `v-model:visible` + `header` + `#footer` slot semantics are preserved by AppModal. The `modal` prop is implicitly always-true (AppModal renders its own scrim). `:closable` was not used in any of the four files.

Other `primevue/dialog` imports remain untouched because they live in files that are either **on the Sprint 2 exclusion list** or **outside the QA list**: `UserManagementSection.vue`, `admin/sections/TemplatesSection.vue`, `admin/sections/ProjectManagementSection.vue`, `admin/ProjectDetailPanel.vue`. Those can be swept in a follow-up once Sprint 2 completes.

---

## Files skipped due to Sprint 2 exclusion

The following controllers contain `@Body() body: { ...inline... }` patterns (see `git grep "@Body().*:\s*\{"`) but were **not** modified per Sprint 10's exclusion list:
`pm.controller.ts`, `work-packages.controller.ts` (+ `wp-comments.controller.ts`), `meetings.controller.ts` (+ `meeting-extras.controller.ts`), `comments.controller.ts`, `gantt.controller.ts`, `agile.controller.ts`, `wiki.controller.ts`, `budgeting.controller.ts`, `time-tracking.controller.ts`, `attachments.controller.ts`, `checklists.controller.ts`, `team-planner.controller.ts`, `portfolio.controller.ts`, `automation.controller.ts`, `portal*.controller.ts`, and `projects.controller.ts`.

`roles.service.ts` / `dto/role.dto.ts` were also left alone.

The newly-tightened `UpsertCustomValuesDto` in `dto/work-package.dto.ts` will take effect as soon as Sprint 2's controller edits are merged; nothing in the controller needed to change to pick up the decorators because it already imports the DTO by name.

---

## Build status

| Target | Command | Result |
|--------|---------|--------|
| Backend | `cd web/back-nest && npm run build` | **PASS** (`nest build` clean, no TS errors) |
| Frontend | `cd web/Front/customapp && npm run build` | **PASS** (`vue-tsc --noEmit` + `vite build` both green; chunk-size warning on `neolibrary.js` is pre-existing and unrelated) |
