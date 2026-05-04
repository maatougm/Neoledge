/**
 * @file prisma/seed-rbac.js
 * @desc Idempotent RBAC seeder. Inserts every Permission, every preset Role,
 *       binds them via RolePermissions, and grants each existing AppUser a
 *       global UserRoleAssignment matching their AppUser.role string. Safe
 *       to re-run on any environment (dev / prod) — uses upsert + findFirst
 *       gates everywhere.
 *
 * Usage:
 *   cd web/back-nest && node prisma/seed-rbac.js
 *
 * Prerequisites:
 *   - DATABASE_URL exported (postgresql://...)
 *   - dist/ exists (built from src/permissions/permission-keys.ts)
 *   - tables Permissions / Roles / RolePermissions / UserRoleAssignments
 *     already exist (Prisma migrate has been applied)
 */

const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');
require('dotenv/config');

const distPath = require('path').resolve(__dirname, '../dist/src/permissions/permission-keys.js');
const { PERMISSION_CATALOG, PRESET_ROLE_PERMISSIONS } = require(distPath);

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  if (!url.startsWith('postgres')) throw new Error('Postgres-only seeder');

  const adapter = new PrismaPg({ connectionString: url });
  const p = new PrismaClient({ adapter });

  // 1. Permissions
  for (const x of PERMISSION_CATALOG) {
    await p.permission.upsert({
      where: { key: x.key },
      create: { key: x.key, resource: x.resource, description: x.description },
      update: {},
    });
  }
  console.log(`Permissions: ${PERMISSION_CATALOG.length}`);

  // 2. Roles
  for (const r of Object.keys(PRESET_ROLE_PERMISSIONS)) {
    await p.role.upsert({
      where: { name: r },
      create: { name: r, isPreset: true },
      update: {},
    });
  }
  console.log(`Roles: ${Object.keys(PRESET_ROLE_PERMISSIONS).length}`);

  // 3. RolePermissions
  let rpCount = 0;
  for (const [name, keys] of Object.entries(PRESET_ROLE_PERMISSIONS)) {
    const role = await p.role.findUnique({ where: { name } });
    if (!role) continue;
    for (const k of keys) {
      const perm = await p.permission.findUnique({ where: { key: k } });
      if (!perm) continue;
      await p.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        create: { roleId: role.id, permissionId: perm.id },
        update: {},
      });
      rpCount += 1;
    }
  }
  console.log(`RolePermissions: ${rpCount}`);

  // 4. UserRoleAssignments — grant each active user a global assignment
  //    matching their AppUser.role. composite-with-NULL not supported by
  //    Prisma upsert, so we findFirst then create.
  const users = await p.appUser.findMany({ where: { isActive: true } });
  let uraCount = 0;
  for (const u of users) {
    const role = await p.role.findUnique({ where: { name: u.role } });
    if (!role) continue;
    const existing = await p.userRoleAssignment.findFirst({
      where: { userId: u.id, roleId: role.id, projectId: null },
    });
    if (existing) continue;
    await p.userRoleAssignment.create({
      data: { userId: u.id, roleId: role.id, projectId: null },
    });
    uraCount += 1;
  }
  console.log(`UserRoleAssignments created: ${uraCount} (over ${users.length} active users)`);

  await p.$disconnect();
  console.log('RBAC seed OK');
})().catch((e) => {
  console.error('SEED FAILED:', e.message);
  process.exit(1);
});
