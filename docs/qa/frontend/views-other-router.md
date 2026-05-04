# QA Review — Views (other) + Router + Libs + Types

Files opened:

- `web/Front/customapp/src/views/LoginView.vue` (611 LOC)
- `web/Front/customapp/src/views/ClientPortalView.vue` (1025 LOC)
- `web/Front/customapp/src/views/HomeView.vue` (533 LOC)
- `web/Front/customapp/src/views/UserProfileView.vue` (800 LOC)
- `web/Front/customapp/src/views/UnauthorizedView.vue` (98 LOC)
- `web/Front/customapp/src/views/ForceChangePasswordView.vue` (309 LOC)
- `web/Front/customapp/src/views/TeamMemberView.vue` (150 LOC)
- `web/Front/customapp/src/views/CustomActionView.vue` (120 LOC)
- `web/Front/customapp/src/views/PortfolioView.vue` (112 LOC)
- `web/Front/customapp/src/views/AuditLogView.vue` (120 LOC)
- `web/Front/customapp/src/views/AdminView.vue` (512 LOC)
- `web/Front/customapp/src/views/admin/RolesView.vue` (346 LOC)
- `web/Front/customapp/src/router/guards.ts` (63 LOC)
- `web/Front/customapp/src/router/index.ts` (410 LOC)
- `web/Front/customapp/src/lib/api.ts` (94 LOC)
- `web/Front/customapp/src/lib/jwt.ts` (128 LOC)
- `web/Front/customapp/src/lib/formatDate.ts` (46 LOC)
- `web/Front/customapp/src/utils/phaseLabels.ts` (15 LOC)
- `web/Front/customapp/src/types/index.d.ts` (15 LOC)
- `web/Front/customapp/src/types/user.types.ts` (58 LOC)
- `web/Front/customapp/src/types/project.types.ts` (221 LOC)
- `web/Front/customapp/src/types/filter.types.ts` (38 LOC)
- `web/Front/customapp/src/types/notification.types.ts` (11 LOC)
- `web/Front/customapp/src/types/nav.types.ts` (29 LOC)
- `web/Front/customapp/src/types/pm.types.ts` (117 LOC)
- `web/Front/customapp/src/types/work-package.types.ts` (91 LOC)

Cross-referenced (read-only, for evidence):
- `web/Front/customapp/src/stores/authStore.ts`
- `web/Front/customapp/src/stores/configStore.ts` (grepped)
- `web/back-nest/src/portal/portal.controller.ts`
- `web/back-nest/src/auth/auth.controller.ts` (changePassword route)
- `web/back-nest/src/auth/auth.service.ts` (changePassword service)

---

## Findings

### [CRITICAL] Dev auto-login-as-admin leaks into any build where `import.meta.env.DEV` is true
- File: `web/Front/customapp/src/router/index.ts:375-381`
- Category: auth
- Evidence:
```ts
if (!auth.isAuthenticated) {
  // In development, auto-login for convenience. In production, redirect to login.
  if (import.meta.env.DEV) {
    try {
      await auth.login('admin@neoleadge.com', 'Admin@123')
    } catch {
      // fall through to redirect below
    }
  }
```
- Impact: Any anonymous visitor of a dev-mode build (including accidental Vite dev-server deployments, staging servers that run `npm run dev`, or CI preview hosts) is automatically signed in as **Administrator** (`admin@neoleadge.com` / `Admin@123`). Combined with the matching quick-access demo credentials hard-coded in `LoginView.vue:211-217`, these credentials are known-plaintext and ship in the repo.
- Fix: Replace the dev auto-login with a redirect-to-`/login` no matter the build mode; if a demo convenience is still desired, gate it on a runtime config flag (e.g. `configStore.enableDemoAutoLogin`) that is off by default and never true in any hosted environment. At minimum, also add `&& window.location.hostname === 'localhost'` to avoid leaking into staging.

---

### [CRITICAL] Hard-coded plaintext admin + PM + team credentials in shipped bundle
- File: `web/Front/customapp/src/views/LoginView.vue:210-217`
- Category: security
- Evidence:
```ts
const quickAccounts = [
  { role: 'admin',  label: 'Administrateur',        email: 'admin@neoleadge.com',   pwd: 'Admin@123',   color: 'var(--nl-accent)', init: 'A'  },
  { role: 'pm',     label: 'Chef de projet',         email: 'pm@neoleadge.com',      pwd: 'Pm@123',      color: '#3B82F6',          init: 'CP' },
  { role: 'spec',   label: 'Équipe spécification',   email: 'spec@neoleadge.com',    pwd: 'Spec@123',    color: '#8B5CF6',          init: 'ES' },
  { role: 'realiz', label: 'Équipe réalisation',     email: 'realiz@neoleadge.com',  pwd: 'Realiz@123',  color: '#F97316',          init: 'ER' },
  { role: 'deploy', label: 'Équipe déploiement',     email: 'deploy@neoleadge.com',  pwd: 'Deploy@123',  color: '#10B981',          init: 'ED' },
]
```
- Impact: The compiled `dist/assets/*.js` will contain these credentials in plaintext. Anyone who visits a production deployment can one-click log in as Admin. The comment on line 210 (`// Quick-access demo accounts (credentials must exist on this deployment)`) acknowledges this is intentional, but there is **no `import.meta.env.DEV` gate** around the render of `quickAccounts` — it's always visible.
- Fix: Wrap the `quick-access` section and `quickAccounts` constant in `if (import.meta.env.DEV)` / `v-if="isDev"`. If the feature must also exist on staging, drive it from a runtime config flag from `configStore` so production builds can disable it per-deployment.

---

### [CRITICAL] `ForceChangePasswordView` is functionally broken — always returns 401
- File: `web/Front/customapp/src/views/ForceChangePasswordView.vue:149`
- Category: logic
- Evidence (frontend):
```ts
await api.post('/auth/change-password', { currentPassword: '', newPassword: newPassword.value })
```
- Evidence (backend, `web/back-nest/src/auth/auth.service.ts:355-362`):
```ts
const isCurrentValid = await bcrypt.compare(
  currentPassword,
  user.passwordHash,
);

if (!isCurrentValid) {
  throw new UnauthorizedException('Current password is incorrect');
}
```
- Impact: The forced-first-login password-change flow will **always fail** because the backend `changePassword` service unconditionally verifies `currentPassword` via `bcrypt.compare('', hash)`. A freshly-seeded user who is redirected to `/force-change-password` can never complete it, leaving `mustChangePassword=true` and locking the account in a redirect loop to this view. No dedicated "force-change" endpoint exists.
- Fix: Either (a) add a new `POST /auth/force-change-password` endpoint that skips the currentPassword check when `user.mustChangePassword === true`, or (b) have the frontend prompt the user for their temporary/original password and send it. Option (a) is preferred.

---

### [HIGH] Force-password-change view is bypassable by direct navigation
- File: `web/Front/customapp/src/router/index.ts:389-392`, `web/Front/customapp/src/router/guards.ts:28-31`
- Category: auth
- Evidence (`router/index.ts`):
```ts
// Force password change
if (auth.mustChangePassword && to.name !== 'force-change-password') {
  return { name: 'force-change-password' }
}
```
- Evidence (`guards.ts`):
```ts
if (auth.mustChangePassword && to.name !== 'force-change-password') {
  next({ name: 'force-change-password' })
  return
}
```
- Impact: `/force-change-password` is in `PUBLIC_ROUTE_NAMES` (router/index.ts:23) so the guard short-circuits before checking `mustChangePassword`. More importantly: the check in `router.beforeEach` is only evaluated inside the `if (!isPublic && to.meta.requiresAuth)` branch (line 372), so navigating to ANY public route (e.g. `/login` itself, `/unauthorized`, or `/portal/xxx`) while carrying `mustChangePassword=true` is allowed. Worse, the forced redirect also never runs on the very first load of `/force-change-password` itself, so the user can simply navigate away (e.g. to `/portal/<whatever>`, then `window.location.href = '/app/admin/dashboard'`) to evade it. Since backend endpoints don't (re-)enforce `mustChangePassword` per request, the user continues to authenticate and call APIs with an otherwise-valid JWT.
- Fix: Enforce the `mustChangePassword` check for all authenticated navigations (move it above the `!isPublic && to.meta.requiresAuth` block), AND add a server-side middleware/guard on every non-auth endpoint that returns 403 when `user.mustChangePassword` is true. See `auth/jwt.strategy.ts` to inject the flag into `req.user`.

---

### [HIGH] Client portal POST uses wrong base path — sign-off is permanently broken
- File: `web/Front/customapp/src/views/ClientPortalView.vue:338, 371`
- Category: logic
- Evidence:
```ts
// GET (correct)
const { data } = await axios.get<PortalProject>(
  `${configStore.apiUrl}/api/portal/${token}`,
)
...
// POST (wrong path)
await axios.post(`${configStore.apiUrl}/portal/${token}/signoff`, {
```
- Evidence (backend `portal.controller.ts:72, 86`):
```ts
@Controller('api/portal')
export class PortalPublicController {
  ...
  @Post(':token/signoff')
```
- Impact: GET succeeds against `/api/portal/:token`, but the POST goes to `/portal/:token/signoff` — a route that doesn't exist in the NestJS backend. Every client sign-off attempt fails with 404 (or worse, hits an unrelated route if any future middleware claims it). CLAUDE.md documents both as `/portal/:token` but the backend controller is `@Controller('api/portal')` so both should be `/api/portal/...`.
- Fix: Change line 371 to `${configStore.apiUrl}/api/portal/${token}/signoff`.

---

### [HIGH] Client portal has no server-side replay protection — only a localStorage flag
- File: `web/Front/customapp/src/views/ClientPortalView.vue:321-324, 378-396`
- Category: logic | security
- Evidence:
```ts
// Check localStorage first
if (localStorage.getItem(getSignedKey(token))) {
  alreadySigned.value = true
}
...
// Persist in localStorage so "already signed" message shows on revisit
localStorage.setItem(getSignedKey(token), '1')
```
- Impact: The only mechanism preventing a client from submitting multiple sign-offs for the same token is a `localStorage` flag. Clearing site data, using a private window, or a different device lets a single client submit unlimited approvals/rejections. The portal endpoint itself (`POST /api/portal/:token/signoff`) does not require `isApproved === null` on existing records and does not return 409 on subsequent submissions — the frontend relies entirely on the local flag.
- Fix: Enforce one-signoff-per-token on the backend: check `PortalSignoff` count by `portalTokenId` and return 409 when >0. Better still, bind sign-off status to the token (set `portalToken.isSignedOff=true` inside a transaction).

---

### [HIGH] Elise `?Guid=` flow performs an authenticated redirect without validating the source
- File: `web/Front/customapp/src/router/index.ts:356-369`
- Category: open-redirect | auth
- Evidence:
```ts
const guid = to.query.Guid as string | undefined
if (guid && !auth.isAuthenticated) {
  try {
    const response = await axios.get<{ jwt: string }>(
      config.apiUrl + '/hook/auth',
      { params: { guid } },
    )
    auth.setJwt(response.data.jwt)
  } catch {
    return { name: 'unauthorized' }
  }
}
```
- Impact: Any URL containing `?Guid=<any>` triggers a `GET /hook/auth?guid=...`. If the backend `/hook/auth` accepts an Elise-side GUID and issues a JWT, a malicious attacker who acquires or guesses a valid GUID gets the JWT attached to the current browser via `auth.setJwt()` which calls `_persist(token)` and writes to `localStorage` under `STORAGE_KEY='nl_jwt'`. The JWT is then sent as `Authorization: Bearer` on every subsequent request (via `lib/api.ts:28`). There is **no verification that `to.query` came from the expected Elise origin** (no Referer check, no `window.parent.postMessage` handshake, no origin check). Combined with the fact that `/custom-action` has `meta.requiresAuth` — any unrelated route the user navigates to will happily pick up the `?Guid=` and silently escalate. Also note: the `redirect` query param preserved in the login guard (`router/index.ts:384`) is used for post-login navigation without allowlist filtering — a crafted `?redirect=https://evil.example/phish` would cause a redirect to an absolute external URL if reused by LoginView (not checked in this review, but worth auditing).
- Fix: (a) Restrict the Elise flow to only the `CustomAction` route: move the `?Guid` handler into `CustomActionView.vue` or gate it on `to.name === 'CustomAction'`. (b) Require that the page be loaded in an iframe with a known ancestor origin (`window.top !== window && document.referrer` check). (c) On the backend, bind the issued JWT to a short TTL and a single allowed origin. (d) When preserving `redirect` in the login query, reject any value that parses as an absolute URL (`new URL(v)` succeeds) — keep only same-origin pathnames.

---

### [HIGH] `isTokenExpired` treats missing `exp` as non-expiring
- File: `web/Front/customapp/src/lib/jwt.ts:123-128`
- Category: auth
- Evidence:
```ts
export function isTokenExpired(token: string): boolean {
  const payload = decodeJwt(token)
  if (!payload) return true
  if (payload.exp === undefined) return false
  return payload.exp < Date.now() / 1000
}
```
- Impact: A JWT with no `exp` claim is considered forever-valid and will be picked up from localStorage on every app boot (`authStore.init()` at `authStore.ts:78-87`). The backend should always sign with `exp`, but any misconfiguration of `JWT_EXPIRES_IN` or any legacy/Elise-issued token without `exp` silently creates a forever-session. Also: `decodeJwt` does NOT verify signatures (expected client-side — it can't), but the comment is missing, so a caller could mistakenly trust it as authoritative.
- Fix: `if (payload.exp === undefined) return true` (treat missing `exp` as expired / reject). Add a JSDoc note on `decodeJwt` that it performs base64 decode only and MUST NOT be used as an authentication decision — only for UI hints. Also add a safeguard: check `iat` + a sane max age.

---

### [HIGH] `UserProfileView` duplicates JWT decode logic that exists in `lib/jwt.ts`
- File: `web/Front/customapp/src/views/UserProfileView.vue:349-358` and `AdminView.vue:171-178, 181-186, 196-202, 236-242`
- Category: security | types
- Evidence (UserProfileView):
```ts
function hydrateFromJwt(): void {
  if (!authStore.jwt) return
  try {
    const payload = JSON.parse(atob(authStore.jwt.split('.')[1])) as JwtPayload
    userId.value    = payload.sub ?? ''
    ...
  } catch { /* JWT decode failed — ignore */ }
}
```
- Evidence (AdminView repeated 4 times):
```ts
const p = JSON.parse(atob(app.jwt.split('.')[1]))
```
- Impact: Four call sites in `AdminView.vue` re-implement `JSON.parse(atob(jwt.split('.')[1]))` instead of using `decodeJwt()` from `@/lib/jwt`. This (a) silently swallows malformed-token errors in each place, (b) doesn't handle the ASP.NET full-URI claim names that `lib/jwt.ts` already maps (so `given_name`/`family_name` work here but the proper `firstName`/`lastName` claims used elsewhere are not considered), (c) makes it impossible to add signature or expiry checks centrally. `lib/jwt.ts` also already has helpers for `getUserId` / `getUserInitials` / `getUserFullName`.
- Fix: Replace all `JSON.parse(atob(...))` call sites in `UserProfileView.vue:352` and `AdminView.vue:173,183,197,238` with `decodeJwt(app.jwt)` / the `getUser*` helpers from `@/lib/jwt`.

---

### [HIGH] Router `meta.allowedRoles` uses hard-coded legacy roles, bypassing the new custom-role / permission system
- File: `web/Front/customapp/src/router/index.ts:74, 167, 271-276`; `web/Front/customapp/src/router/guards.ts:44-60`
- Category: auth | types
- Evidence:
```ts
meta: { requiresAuth: true, allowedRoles: ['Admin'] as UserRole[] },
...
meta: { requiresAuth: true, allowedRoles: ['ProjectManager', 'Admin'] as UserRole[] },
...
allowedRoles: [
  'SpecificationTeam',
  'RealizationTeam',
  'DeploymentTeam',
  'Viewer',
] as UserRole[],
```
- Evidence (`guards.ts:57`):
```ts
if (!auth.userRole || !allowedRoles.includes(auth.userRole)) {
  next({ name: 'unauthorized' })
  return
}
```
- Impact: The roleGuard decides admin-area access by matching `auth.userRole` (derived from a hard-coded `UserRole` enum string in the JWT — see `types/user.types.ts:9-15`). But the store now exposes a richer permission system via `authStore.can(permissionKey, projectId?)` and `globalPermissions`, and RolesView.vue lets admins create arbitrary custom roles with their own permission keys. A user assigned a custom role such as "Regional Admin" whose permissions include `user.manage` but whose JWT `role` claim is still `ProjectManager` is wrongly redirected to `/unauthorized` when visiting `/app/admin/users`. Conversely, a user whose role changed from `Admin` to a restricted custom role continues to access admin routes as long as the cached JWT still says `Admin`.
- Fix: Replace `roleGuard` with a `permissionGuard` that uses `auth.can(permissionKey)` and change each `meta.allowedRoles` to `meta.requiredPermissions` (e.g. `['user.manage']` or `['admin.*']`). Fall back to role-based behaviour only when `auth.globalPermissions.size === 0` (legacy JWT still in flight). See `components/pm/PMProjectDetail.vue` for the usage pattern of `usePermission`.

---

### [HIGH] `types/user.types.ts` `UserRole` is a fixed enum incompatible with custom roles
- File: `web/Front/customapp/src/types/user.types.ts:9-24`
- Category: types
- Evidence:
```ts
export type UserRole =
  | 'Admin'
  | 'ProjectManager'
  | 'SpecificationTeam'
  | 'RealizationTeam'
  | 'DeploymentTeam'
  | 'Viewer'

export const USER_ROLE_LABELS: Record<UserRole, string> = { ... }
```
- Impact: This union is imported into router meta, `UserProfileView.vue` (line 260), `AdminView.vue` (line 137), and used as a narrowing type all through the codebase. As soon as backend `/auth/me` returns a `role.name` like `"Regional Admin"` (from `RolesView.vue` creating custom roles), any typed lookup on `USER_ROLE_LABELS[role.value as UserRole]` quietly returns `undefined` and the UI shows the raw role name (acceptable) but the `as UserRole` cast in `UserProfileView.vue:337` and `AdminView.vue:189` is lying to TS. Most concerning: backend DTOs in `types/user.types.ts:37, 50` return `role: UserRole` — so the type now contradicts actual runtime values.
- Fix: Change `UserRole` to `string` (or `type UserRole = string & { __brand: 'UserRole' }`) and keep `USER_ROLE_LABELS` only as a fallback-labels map. Add a helper `getRoleLabel(role: string): string` that returns `USER_ROLE_LABELS[role] ?? role`. Flip callers from `role as UserRole` to the helper.

---

### [MEDIUM] Axios base-URL interceptor double-prefixes portal URL (only by accident today)
- File: `web/Front/customapp/src/lib/api.ts:33-35`, portal uses plain `axios` directly
- Category: logic
- Evidence:
```ts
// Prefix relative URLs with the configured API base URL
if (config.url && !config.url.startsWith('http')) {
  config.url = configStore.apiUrl + config.url
}
```
- Impact: `ClientPortalView.vue` imports `axios` (the untouched singleton), not `@/lib/api`. This is intentional (the public portal should not attach the admin JWT), but it's a trap: any future developer who "fixes" the import to use `@/lib/api` will (a) leak the admin JWT on the public portal and (b) double-prefix the already-absolute `${configStore.apiUrl}/api/portal/${token}` (it won't because the URL already starts with `http`, but the copy-paste risk stands).
- Fix: Add an inline comment at `ClientPortalView.vue:228` explicitly saying "Do NOT replace with `@/lib/api` — this is a public endpoint and must not attach the admin JWT." Alternatively, create a second `publicApi` axios instance with no auth interceptor and have the portal use that.

---

### [MEDIUM] Global axios response interceptor toasts errors on the public portal too
- File: `web/Front/customapp/src/lib/api.ts:61-92`
- Category: logic
- Evidence:
```ts
api.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError) => {
    ...
    if (status && status >= 400 && status !== 401 && shouldToast(error.config)) {
      const message = extractErrorMessage(error) ?? `Erreur ${status}`
      ...
```
- Impact: Any module that has imported `@/lib/api` ambiently registers interceptors on the shared axios singleton only via `axios.create()` (line 18) — so this is isolated to the `api` instance, not `axios` the default. **However**, `ClientPortalView.vue` imports `axios` directly and server errors (e.g. the current broken `POST /portal/:token/signoff` 404) will NOT flow through any toast. The portal handles them inline (`formError.value = msg ?? 'Une erreur est survenue.'`) so this is fine. Note for reviewer: the claim "interceptor attaches JWT" is confirmed to only happen on the `@/lib/api` `api` instance, NOT on `axios` the default.
- Fix: None required. Add a code comment in `lib/api.ts` clarifying that interceptors are scoped to the `api` instance only.

---

### [MEDIUM] Login route forwards `?redirect` query but no allowlist is documented
- File: `web/Front/customapp/src/router/index.ts:383-386`, `guards.ts:22-26`
- Category: open-redirect
- Evidence:
```ts
const redirect = to.fullPath !== '/' ? to.fullPath : undefined
return { name: 'login', query: redirect ? { redirect } : undefined }
```
- Impact: The guard captures `to.fullPath` (relative path), which is safe at this layer. The concern is on the LoginView side: I did not find any code in `LoginView.vue:241-281` that reads `route.query.redirect` and performs the post-login navigation, so presently this metadata is set but unused. When it's later wired up, the value must be validated to be a same-origin relative path; otherwise `?redirect=//evil.example/phish` or `?redirect=https%3A%2F%2Fevil.example` passes through with the fully-authenticated session.
- Fix: When LoginView is updated to consume `redirect`, use `if (raw.startsWith('/') && !raw.startsWith('//')) router.push(raw)` — otherwise fall back to `{ name: 'app-home' }`.

---

### [MEDIUM] `LoginView` email/password inputs have no length caps
- File: `web/Front/customapp/src/views/LoginView.vue:68-92`
- Category: validation
- Evidence:
```vue
<NeoInputText
  id="login-email"
  v-model="email"
  label="Adresse e-mail"
  ...
  type="email"
  class="w-full"
/>
<NeoPassword
  id="login-password"
  v-model="password"
  ...
  toggleMask
  :feedback="false"
  autocomplete="current-password"
  class="w-full"
/>
```
- Impact: Neither field enforces a `maxlength`. Users may paste an arbitrarily long password; the request payload size is then bounded only by the backend. If `JwtAuthGuard`'s body parser default is high, this is an easy DoS vector for the login endpoint. Email has no format validation beyond `type="email"` (browser hint only) — and the `handleLogin` function calls `.trim()` on email but not `password`, so leading/trailing whitespace in a pasted password fails silently with "Email ou mot de passe incorrect." — bad UX.
- Fix: Add `maxlength="254"` on the email field and `maxlength="128"` on the password field. Mirror those caps in the backend `LoginDto`. Don't trim passwords (that's correct today). Server-side: the auth controller should also rate-limit and cap body size.

---

### [MEDIUM] `ForceChangePasswordView` password rules are laxer than the admin-profile copy
- File: `web/Front/customapp/src/views/ForceChangePasswordView.vue:112-116` vs `UserProfileView.vue:181-183`
- Category: validation
- Evidence:
```ts
// ForceChangePasswordView
const requirements = computed<Requirement[]>(() => [
  { key: 'length',    label: 'Au moins 8 caractères',  met: newPassword.value.length >= 8 },
  { key: 'uppercase', label: 'Une lettre majuscule',   met: /[A-Z]/.test(newPassword.value) },
  { key: 'number',    label: 'Un chiffre',             met: /[0-9]/.test(newPassword.value) },
])
```
```vue
<!-- UserProfileView -->
Choisissez un mot de passe fort d'au moins 8 caractères, avec des majuscules, des chiffres et des caractères spéciaux.
```
- Impact: The user-facing copy and the requirement checker disagree. Worse, submission only requires `newPassword.value.length >= 8` — a fully-lowercase password like `aaaaaaaa` will pass. No special-character requirement is enforced in either view.
- Fix: Align both views to enforce length + upper + digit + special. Consider using a shared `validatePasswordStrength()` helper in `lib/` so it can be tested. Mirror the exact rules in the backend.

---

### [MEDIUM] Client portal does not inject the documented `robots: noindex` meta tag
- File: `web/Front/customapp/src/views/ClientPortalView.vue:1-10`
- Category: security (info disclosure)
- Evidence:
```vue
<!--
  ...
  @robots   noindex (meta tag injected below)
-->
<template>
  <!-- robots: noindex -->
  <div class="portal-page">
```
- Impact: The comment claims `noindex` is injected but no `useHead({ meta: [{ name: 'robots', content: 'noindex' }] })` or `document.head.appendChild(...)` actually runs. Search engines will index `/portal/:token` pages by default, exposing client names, project names, and sign-off comments via Google cache.
- Fix: Install `@vueuse/head` or use a plain `onMounted` that creates a meta tag, and/or serve an `X-Robots-Tag: noindex` header from the backend for the `/portal/...` frontend route (edge-cached).

---

### [MEDIUM] `UserProfileView` avatar URL leaks browsing history via `?t=Date.now()` timestamps
- File: `web/Front/customapp/src/views/UserProfileView.vue:381, 431` and `AdminView.vue:200`
- Category: security (minor info disclosure)
- Evidence:
```ts
avatarUrl.value = p.avatarPath
  ? `${configStore.apiUrl}/api/userprofile/avatar/${p.id}?t=${Date.now()}`
  : null
```
- Impact: The cache-bust query string `t=Date.now()` is a timestamp correlated with the user's navigation. Combined with server access logs (common in proxy layers) it provides a semi-unique user fingerprint and can be used to tie requests across the session. Also: `AdminView.vue:200` builds the avatar URL **without** cache-busting and is used in every admin view, so an outdated avatar is served after update; inconsistent behaviour.
- Fix: Instead of per-request timestamp, invalidate on change only (e.g. append `?v=${user.avatarVersion}` where `avatarVersion` is a counter incremented on upload and returned in the profile DTO). This also makes the cache actually useful.

---

### [MEDIUM] `HomeView` calls `api.get('/admin/project', …)` with singular `project`, likely 404
- File: `web/Front/customapp/src/views/HomeView.vue:316, 338`
- Category: logic
- Evidence:
```ts
const endpoint = authStore.userRole === 'Admin' ? '/admin/project' : '/pm/team-projects'
```
- Impact: The CLAUDE.md project manifest documents the route as `GET /admin/projects` (plural). Calling `/admin/project` returns 404, so `loadPendingValidations` and `loadMilestones` silently fail for Admin users — they see empty "Validations en attente" and "Prochains jalons" lists. Grep of the backend confirms no `@Controller('admin/project')` handler.
- Fix: Change both occurrences to `'/admin/projects'`.

---

### [MEDIUM] `HomeView` milestones `suppressErrorToast` cast uses `as never`
- File: `web/Front/customapp/src/views/HomeView.vue:346`
- Category: types
- Evidence:
```ts
const { data: ms } = await api.get<MilestoneRow[]>(`/pm/projects/${p.id}/milestones`, { suppressErrorToast: true } as never)
```
- Impact: `as never` is the worst possible escape hatch — it asserts that the value cannot be any type, then silently succeeds. This defeats the whole point of having a typed axios config. Same anti-pattern at `UserProfileView.vue:390`.
- Fix: Extend `AxiosRequestConfig` via module augmentation in `lib/api.ts`:
  ```ts
  declare module 'axios' {
    interface AxiosRequestConfig { suppressErrorToast?: boolean }
  }
  ```
  Then the callers drop the cast.

---

### [MEDIUM] `LoginView.fillCredentials` is unused dead code
- File: `web/Front/customapp/src/views/LoginView.vue:220-224`
- Category: logic
- Evidence:
```ts
function fillCredentials(e: string, p: string): void {
  email.value    = e
  password.value = p
  errorMsg.value = null
}
```
- Impact: `fillCredentials` is defined and called only by `quickLogin` (`LoginView.vue:227-230`), which is itself the one-click demo login handler. Inlining it would remove a level of indirection. Minor.
- Fix: Inline into `quickLogin` and remove.

---

### [MEDIUM] `CustomActionView` trusts `window.parent` unconditionally
- File: `web/Front/customapp/src/views/CustomActionView.vue:67`
- Category: security
- Evidence:
```ts
window.parent.postMessage('EliseCustomActionDone', '*')
```
- Impact: `postMessage(..., '*')` broadcasts to any parent origin. If the page is loaded in a malicious iframe (phishing), the attacker knows the exact moment the user clicked "Validate". Content here is just a string ("EliseCustomActionDone") — no secrets — but the pattern is wrong. Also: no validation that the page is actually framed by the expected Elise origin.
- Fix: `window.parent.postMessage('EliseCustomActionDone', configStore.eliseUrl)` (or the known Elise origin); on mount, verify `window.top !== window && document.referrer.startsWith(expectedOrigin)` and render an "unframed" error otherwise.

---

### [LOW] `AdminView.vue` and router ship unused `TeamMemberView` sections
- File: `web/Front/customapp/src/views/TeamMemberView.vue:16-19`
- Category: logic
- Evidence: The view conditionally renders `PMProjectList` when `activeSection === 'projects'` but `activeSection` is derived from `route.name === 'team-validations'`. The two routes `team-projects` and `team-validations` both mount the SAME `TeamMemberView.vue` (`router/index.ts:286-300`), so the route-based branching works, but only by accident.
- Impact: Adds mental overhead. If a future route name is added, the default `'projects'` case silently handles it.
- Fix: Split into two distinct views (`TeamProjectsView.vue`, `TeamValidationsView.vue`) and drop the internal branching.

---

### [LOW] `PortfolioView` mutates `portfolioStore.currentPortfolio = null` directly
- File: `web/Front/customapp/src/views/PortfolioView.vue:30`
- Category: logic
- Evidence:
```vue
<NeoButton icon="pi pi-arrow-left" text label="Retour" @click="portfolioStore.currentPortfolio = null" />
```
- Impact: Writes directly to the store state from a template. This works with Pinia setup stores but bypasses any store-level mutation logic and can't be tracked by devtools. Minor.
- Fix: Add a `portfolioStore.closePortfolio()` action that sets `currentPortfolio = null` and any future side effects (clear cached members, cancel fetches).

---

### [LOW] `RolesView.clonePreset` uses native `prompt()`
- File: `web/Front/customapp/src/views/admin/RolesView.vue:279`
- Category: logic (UX)
- Evidence:
```ts
const newName = prompt(`Nom du clone de "${role.name}" :`, `${role.name} (copie)`)
```
- Impact: Inconsistent with the rest of the app which uses `AppModal`/NeoDialog. Native prompts are blocked by some browsers in iframes, cannot be styled, and are accessibility-poor.
- Fix: Replace with a small inline `AppModal` that captures the clone name.

---

### [LOW] `AuditLogView` limit fixed at 100, no pagination
- File: `web/Front/customapp/src/views/AuditLogView.vue:78`
- Category: logic
- Evidence:
```ts
const params = new URLSearchParams({ limit: '100' })
```
- Impact: An admin investigating an incident is capped at the last 100 entries with no way to page further. No date filters either.
- Fix: Add pagination (offset + limit) and date-range filters.

---

### [LOW] `formatDate` helper silently returns "—" for invalid input, hiding bugs
- File: `web/Front/customapp/src/lib/formatDate.ts:10-15`
- Category: logic
- Evidence:
```ts
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('fr-FR')
}
```
- Impact: A typo-passing (e.g. accidentally passing `user.id` instead of `user.createdAt`) renders "—" with no console warning. Callers never learn.
- Fix: Leave the production fallback, but add a `console.warn` in DEV:
  ```ts
  if (Number.isNaN(d.getTime())) {
    if (import.meta.env.DEV) console.warn('[formatDate] invalid input:', iso)
    return '—'
  }
  ```

---

### [LOW] `types/index.d.ts` has a typo `aomalies`
- File: `web/Front/customapp/src/types/index.d.ts:6-8`
- Category: types
- Evidence:
```ts
export interface ResponseModel {
  message: string
  aomalies: string[]
}
```
- Impact: Almost certainly meant `anomalies`. If the backend sends `anomalies` as JSON, destructuring `ResponseModel.aomalies` silently reads `undefined`.
- Fix: Rename to `anomalies` and grep for any consumer.

---

### [LOW] `types/notification.types.ts` missing fields used throughout UI
- File: `web/Front/customapp/src/types/notification.types.ts`
- Category: types
- Evidence: The interface has 7 fields, but `HomeView.vue:293` and `authStore` / `notificationStore` code references `link`, `actorId`, `reason`, `entityType`, `entityId` (see CLAUDE.md v2.0 notes).
- Impact: Typed reads of those fields require `as { link?: string }` casts at call sites.
- Fix: Expand the `Notification` interface to include `reason?: string`, `entityType?: string`, `entityId?: string`, `actorId?: string`, `link?: string`.

---

### [LOW] `types/work-package.types.ts` does not export `WpType` / `WpStatus` / `WpPriority` label maps
- File: `web/Front/customapp/src/types/work-package.types.ts:3-5`
- Category: types
- Evidence: Only the bare unions are exported; there is no `WP_STATUS_LABELS` / `WP_PRIORITY_LABELS` like other domains have (`project.types.ts:20-28`).
- Impact: Each WP-facing view hand-rolls its own FR label map. Duplication risk.
- Fix: Add label and severity maps alongside the union types, mirroring `project.types.ts`.

---

### [UNCERTAIN] `nav.types.ts` allows `ComputedRef<number>` for badges; unclear if serializable
- File: `web/Front/customapp/src/types/nav.types.ts:16`
- Category: types
- Evidence:
```ts
badge?: number | ComputedRef<number>
```
- Impact: Mixing a primitive with a reactive `ComputedRef` in the same slot makes template rendering ambiguous (`{{ badge }}` prints `[object Object]` on a ComputedRef unless `.value` is accessed). Any consumer that tries to persist nav to localStorage would fail on the ComputedRef.
- Fix: `[UNCERTAIN]` — did not trace all consumers. Recommend splitting into `badge?: number` and `badgeComputed?: ComputedRef<number>` and have the renderer prefer the computed when present.

---

### [UNCERTAIN] `UserProfileView` avatar upload sends base64 JSON instead of multipart
- File: `web/Front/customapp/src/views/UserProfileView.vue:424-429`
- Category: logic | performance
- Evidence:
```ts
const base64 = await toBase64(file)
const ext    = `.${file.name.split('.').pop()?.toLowerCase() ?? 'jpg'}`
const { data } = await api.post<string>(
  '/api/userprofile/avatar',
  { base64Image: base64, fileExtension: ext },
)
```
- Impact: Base64 inflates the payload by ~33% and the backend must decode it. A 2 MB avatar becomes ~2.7 MB of JSON. The NestJS backend with `ValidationPipe({ whitelist: true })` will keep the base64 string in memory as a class instance. Trusting `file.name` for the extension is also shaky — a user can rename `.exe` to `.jpg`. `ALLOWED_TYPES` check on line 413 uses `file.type` (MIME) so that's fine, but the extension passed to the server may not match the actual content.
- Fix: `[UNCERTAIN]` — depends on whether the backend route exists (I did not open the userprofile controller). If it accepts multipart, switch to `FormData` upload. Also derive extension from `file.type`, not `file.name`.

---

## Summary counts

- CRITICAL: 3 (dev auto-login in non-prod, hard-coded demo creds in bundle, broken force-change password)
- HIGH: 7 (force-change bypass, portal POST path bug, portal replay protection, Elise open-redirect, isTokenExpired missing-exp, JWT decode duplication, allowedRoles bypasses permissions, UserRole enum type)
- MEDIUM: 9
- LOW: 7
- UNCERTAIN: 2

## Top three priorities

1. Remove / gate the dev auto-login branch (`router/index.ts:375-381`) and the quick-access accounts (`LoginView.vue:210-217`) from production bundles — simple flag change, massive security impact.
2. Fix the broken `/force-change-password` flow by adding a backend endpoint that skips `currentPassword` verification when `mustChangePassword=true`, and move the `mustChangePassword` guard earlier in the router so it cannot be bypassed via public routes.
3. Replace the role-name-based router guard with a permission-based one that reads from `authStore.can()` / `globalPermissions`, so the new custom-role system actually controls access. Ship `UserRole` as `string` everywhere to match reality.
