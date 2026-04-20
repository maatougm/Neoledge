/**
 * Seed the permission catalog, six preset roles, and backfill
 * UserRoleAssignment rows from the legacy AppUser.role column.
 *
 * Idempotent — safe to re-run after every schema change.
 *
 * Run:
 *   cd web/back-nest
 *   npx tsx prisma/seed-permissions.ts
 */

import { PrismaClient } from '@prisma/client';
import {
  PERMISSION_CATALOG,
  PRESET_ROLE_PERMISSIONS,
} from '../src/permissions/permission-keys.js';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('[seed-permissions] upserting permission catalog…');
  for (const p of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { resource: p.resource, description: p.description },
      create: { key: p.key, resource: p.resource, description: p.description },
    });
  }
  console.log(`[seed-permissions] ${PERMISSION_CATALOG.length} permissions present`);

  console.log('[seed-permissions] upserting preset roles + permission bindings…');
  for (const [roleName, keys] of Object.entries(PRESET_ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: { isPreset: true },
      create: {
        name: roleName,
        isPreset: true,
        description: `Preset role: ${roleName}`,
      },
    });

    const existing = await prisma.rolePermission.findMany({
      where: { roleId: role.id },
      select: { permission: { select: { key: true } } },
    });
    const existingKeys = new Set(existing.map((e) => e.permission.key));
    const wantedKeys = new Set(keys);

    const toAdd = [...wantedKeys].filter((k) => !existingKeys.has(k));
    const toRemove = [...existingKeys].filter((k) => !wantedKeys.has(k));

    if (toAdd.length > 0) {
      const perms = await prisma.permission.findMany({
        where: { key: { in: toAdd } },
        select: { id: true, key: true },
      });
      await prisma.rolePermission.createMany({
        data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
        skipDuplicates: true,
      });
    }

    if (toRemove.length > 0) {
      const perms = await prisma.permission.findMany({
        where: { key: { in: toRemove } },
        select: { id: true },
      });
      await prisma.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: { in: perms.map((p) => p.id) } },
      });
    }

    console.log(
      `[seed-permissions]   ${roleName}: +${toAdd.length}  -${toRemove.length}  (total wanted=${wantedKeys.size})`,
    );
  }

  console.log('[seed-permissions] backfilling UserRoleAssignment from legacy AppUser.role…');
  const users = await prisma.appUser.findMany({
    select: { id: true, role: true },
  });
  const roles = await prisma.role.findMany({ select: { id: true, name: true } });
  const roleByName = new Map(roles.map((r) => [r.name, r.id]));

  let created = 0;
  for (const u of users) {
    const roleId = roleByName.get(u.role);
    if (!roleId) continue;
    // MySQL treats NULL as distinct in unique keys, so we can't rely on the
    // compound unique for NULL projectId. findFirst + create keeps it idempotent.
    const existing = await prisma.userRoleAssignment.findFirst({
      where: { userId: u.id, roleId, projectId: null },
      select: { id: true },
    });
    if (!existing) {
      await prisma.userRoleAssignment.create({
        data: { userId: u.id, roleId, projectId: null },
      });
      created += 1;
    }
  }
  console.log(`[seed-permissions]   processed ${users.length} users, ${created} new assignments`);

  console.log('[seed-permissions] done.');
}

main()
  .catch((err) => {
    console.error('[seed-permissions] FAILED:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
