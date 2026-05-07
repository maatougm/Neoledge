/**
 * @file backfill-project-members.ts
 * @desc Pre-flight migration before the RBAC removal (Phase 5 of
 *       /plan remove-custom-roles).
 *
 * Today, three signals can grant a user access to a project:
 *   1. Project.projectManagerId === user.id              (PM)
 *   2. ProjectMember row(projectId, userId)              (member onboarding)
 *   3. UserRoleAssignment(userId, role, projectId?)      (the RBAC path)
 *
 * Phase 5 drops UserRoleAssignment, leaving signals 1 + 2. Anyone whose
 * project access today flows ONLY through signal 3 would lose access
 * unless we materialise it as a ProjectMember row first.
 *
 * Two cohorts to backfill:
 *
 *   A. Scoped role assignments — `UserRoleAssignment(projectId IS NOT NULL)`.
 *      Each one becomes a ProjectMember row on (projectId, userId).
 *
 *   B. Validators — every user who has ever submitted a `CahierFeedback`
 *      row on a project they're not yet in `ProjectMember` for. They need
 *      to keep submitting validations after the cutover.
 *
 * Idempotent: every insert is wrapped in `where: { project_member_uq: {…} }`
 * upsert semantics via createMany + skipDuplicates. Running twice is safe.
 *
 * Run:
 *   npx tsx web/back-nest/scripts/backfill-project-members.ts
 *
 * Output: per-cohort counts of inserts attempted vs. inserted (skipped =
 * already exists). Exits non-zero on any unexpected error.
 */

import type { PrismaClient } from '@prisma/client'
import { createSeedClient } from '../prisma/seed-client.js'

let prisma!: PrismaClient

interface Plan {
  projectId: string
  userId: string
  label: string
  reason: 'role-assignment' | 'cahier-validator'
}

async function main(): Promise<void> {
  prisma = await createSeedClient()
  console.log('🌱  Pre-RBAC-removal backfill — copying access into ProjectMember…')

  const plans: Plan[] = []

  // ── Cohort A — scoped UserRoleAssignment rows ─────────────────────────
  // We treat any per-project assignment as proof the admin intended that
  // user to have project access. Label uses the role name so the admin
  // can see why the row was created.
  const scoped = await prisma.userRoleAssignment.findMany({
    where: { projectId: { not: null } },
    select: {
      userId: true,
      projectId: true,
      role: { select: { name: true } },
    },
  })
  for (const a of scoped) {
    if (!a.projectId) continue
    plans.push({
      projectId: a.projectId,
      userId: a.userId,
      label: `Backfill — ${a.role.name}`,
      reason: 'role-assignment',
    })
  }

  // ── Cohort B — anyone who has submitted a CahierFeedback on a project
  // they're not yet in ProjectMember for. Catches global-role validators.
  const feedback = await prisma.cahierFeedback.findMany({
    where: { userId: { not: null } },
    select: { projectId: true, userId: true },
    distinct: ['projectId', 'userId'],
  })
  for (const f of feedback) {
    if (!f.userId) continue
    plans.push({
      projectId: f.projectId,
      userId: f.userId,
      label: 'Backfill — Validation team',
      reason: 'cahier-validator',
    })
  }

  // ── Skip rows that would conflict with the project's PM. PMs already
  //    have implicit access via Project.projectManagerId; adding them as
  //    ProjectMember is meaningless and the service-layer rules reject it.
  const projectIds = [...new Set(plans.map((p) => p.projectId))]
  const projects = await prisma.project.findMany({
    where: { id: { in: projectIds } },
    select: { id: true, projectManagerId: true },
  })
  const pmByProject = Object.fromEntries(
    projects.map((p) => [p.id, p.projectManagerId]),
  )
  const filtered = plans.filter((p) => pmByProject[p.projectId] !== p.userId)

  // ── Inactive users skipped — they shouldn't be in ProjectMember either.
  const userIds = [...new Set(filtered.map((p) => p.userId))]
  const users = await prisma.appUser.findMany({
    where: { id: { in: userIds } },
    select: { id: true, isActive: true },
  })
  const activeUserIds = new Set(users.filter((u) => u.isActive).map((u) => u.id))
  const eligible = filtered.filter((p) => activeUserIds.has(p.userId))

  // ── Apply via createMany with skipDuplicates (idempotent re-runs).
  // Group by (projectId, userId) so the same user is added once per project
  // even if both cohorts include them. First-seen reason wins the label.
  const dedupKey = (p: Plan) => `${p.projectId}:${p.userId}`
  const dedup = new Map<string, Plan>()
  for (const p of eligible) {
    if (!dedup.has(dedupKey(p))) dedup.set(dedupKey(p), p)
  }
  const toInsert = [...dedup.values()]

  if (toInsert.length === 0) {
    console.log('  ✓ Nothing to backfill — every UserRoleAssignment / cahier validator')
    console.log('    already has a ProjectMember row.')
  } else {
    const result = await prisma.projectMember.createMany({
      data: toInsert.map((p) => ({
        projectId: p.projectId,
        userId: p.userId,
        label: p.label.slice(0, 150),
      })),
      skipDuplicates: true,
    })
    const byReason: Record<string, number> = {}
    for (const p of toInsert) byReason[p.reason] = (byReason[p.reason] ?? 0) + 1
    console.log(`  ✓ ${result.count} ProjectMember row(s) inserted`)
    console.log(`    └─ planned: ${toInsert.length}, skipped (already existed): ${toInsert.length - result.count}`)
    for (const [reason, n] of Object.entries(byReason)) {
      console.log(`    └─ ${reason}: ${n} planned`)
    }
  }

  console.log('\n✅  Backfill complete. Safe to proceed to Phase 5 (drop RBAC tables).')
}

main()
  .catch((e) => { console.error('Backfill failed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
