# Sprint 9 — Portal hardening & CSV formula injection sanitiser

Date: 2026-04-18
Branch: `nest-back`

## Scope

Three targeted fixes to harden the export pipeline and the public client portal:

1. CSV formula-injection sanitiser on project exports.
2. Portal sign-off idempotency (DB uniqueness + service-level guard).
3. Front-end portal sign-off POST URL correction.

## Changes

### 1. CSV formula-injection sanitiser — `web/back-nest/src/export/export.service.ts`

- Verified the existing `safeCsvCell(value: unknown)` helper already present at the top of the module covers the required behaviour:
  - Neutralises leading `=`, `+`, `-`, `@`, `\t`, `\r` by prefixing a single quote (Excel / Google Sheets formula-injection guard).
  - RFC 4180 compliant: doubles internal `"` and wraps cells containing `,`, `"`, `\r` or `\n` in `"…"`.
- Confirmed all user-controlled project fields in `exportCsv` already flow through `safeCsvCell`: `p.name`, `p.clientName`, `pm` (PM full name), `pmEmail`, `p.status`, `p.priority`, and the three date strings.
- No additional edits required — the sanitiser was merged in an earlier sprint and is still in force.

### 2. Portal sign-off idempotency

#### `web/back-nest/prisma/schema.prisma`

Added `@@unique([portalTokenId])` to the `PortalSignoff` model alongside the existing `@@index([portalTokenId])` and `@@map("PortalSignoffs")`:

```prisma
model PortalSignoff {
  ...
  portalToken PortalToken @relation(fields: [portalTokenId], references: [id], onDelete: Cascade)

  @@unique([portalTokenId])
  @@index([portalTokenId])
  @@map("PortalSignoffs")
}
```

#### `web/back-nest/prisma/migration-portal-signoff-unique.sql` (new)

```sql
-- Enforce single-signoff-per-token idempotency.
ALTER TABLE `PortalSignoffs`
  ADD CONSTRAINT `uq_portal_signoff_token` UNIQUE (`portalTokenId`);
```

#### `web/back-nest/src/portal/portal.service.ts`

`submitSignoff(...)` now:

1. After token / project validations, looks up an existing signoff by `portalTokenId` via `findUnique`. If one exists, returns `Result.ok({ id: existing.id })` so a retry returns the same success envelope the first POST returned.
2. Wraps the `prisma.portalSignoff.create({...})` call in a `try/catch`. A Prisma `P2002` (unique-constraint violation) is treated as a race-condition win by another request — the service re-reads the winning row and returns it as success, still matching the original HTTP contract (Result-based, controller maps to 200/4xx with no new error shape).
3. The notification fan-out to the project manager only runs on the first (non-idempotent) create path.

This keeps the existing HTTP contract: the controller maps `Result.isFailure` to `400 BAD_REQUEST` exactly as before — no `ConflictException` was introduced to avoid breaking the front-end error handler that keys on `response.data.message`.

Prisma client was regenerated (`npx prisma generate`) after the schema edit.

### 3. Portal route mismatch — `web/Front/customapp/src/views/ClientPortalView.vue`

The portal public controller is mounted at `@Controller('api/portal')` in the Nest backend. The frontend GET was already correct:

```ts
await axios.get<PortalProject>(`${configStore.apiUrl}/api/portal/${token}`)
```

…but the sign-off POST was hitting the wrong path:

```diff
- await axios.post(`${configStore.apiUrl}/portal/${token}/signoff`, { ... })
+ await axios.post(`${configStore.apiUrl}/api/portal/${token}/signoff`, { ... })
```

Fixed. No other axios calls to `/portal/` exist in the file.

## Files touched

- `web/back-nest/src/export/export.service.ts` — verified only (no edit needed)
- `web/back-nest/src/portal/portal.service.ts` — idempotent signoff + P2002 catch
- `web/back-nest/prisma/schema.prisma` — `@@unique([portalTokenId])` on `PortalSignoff`
- `web/back-nest/prisma/migration-portal-signoff-unique.sql` — new migration
- `web/Front/customapp/src/views/ClientPortalView.vue` — POST URL → `/api/portal/...`

Not touched: `test-login` (per constraint).

## Migration — command to run on the dev DB

Per CLAUDE.md, never run `prisma db push` on an existing DB. Apply the migration via raw SQL:

```bash
C:/xampp/mysql/bin/mysql.exe -u root -h 127.0.0.1 -P 3306 NeoLeadgeDeployment < web/back-nest/prisma/migration-portal-signoff-unique.sql
```

If the DB currently contains duplicate rows per `portalTokenId`, the `ALTER TABLE` will fail. In that case, dedupe first by keeping the earliest sign-off per token:

```sql
DELETE s1 FROM PortalSignoffs s1
JOIN PortalSignoffs s2
  ON s1.portalTokenId = s2.portalTokenId
 AND s1.signedAt > s2.signedAt;
```

…then re-run the `ALTER TABLE`.

After applying the migration on the DB, the Prisma client is already regenerated — no further action needed.

## Build status

| Target | Command | Result |
|---|---|---|
| Prisma client | `cd web/back-nest && npx prisma generate` | OK — Generated Prisma Client (v7.6.0) |
| NestJS backend | `cd web/back-nest && npm run build` | OK — nest build passed, no TS errors |
| Vue front-end | `cd web/Front/customapp && npm run build` | OK — built in 11.15s (only pre-existing chunk-size warning on `neolibrary.js`, unrelated) |

Both builds are green.

## Verification checklist

- [x] `safeCsvCell` applied to every user-controlled CSV value (verified in place)
- [x] `PortalSignoff.@@unique([portalTokenId])` added to schema
- [x] Raw-SQL migration file created at `web/back-nest/prisma/migration-portal-signoff-unique.sql`
- [x] `submitSignoff` returns existing signoff on duplicate before `create`
- [x] `submitSignoff` wraps `create` in `try/catch` and handles Prisma `P2002` gracefully
- [x] `ClientPortalView.vue` POST hits `/api/portal/${token}/signoff`
- [x] `prisma generate` succeeded
- [x] Backend build green
- [x] Frontend build green
- [x] `test-login` untouched
- [x] `prisma db push` NOT invoked
