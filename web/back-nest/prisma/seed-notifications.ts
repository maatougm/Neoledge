/**
 * @file prisma/seed-notifications.ts
 * @desc Seeds demo notifications (mention, assignee, watcher, deadline) for the admin user
 *       so the bell shows realistic unread state.
 */

import 'dotenv/config';
import type { PrismaClient } from '@prisma/client';
import { createSeedClient } from './seed-client.js';

let prisma!: PrismaClient;

async function main() {
  prisma = await createSeedClient();
  console.log('── Seeding demo notifications ──');

  const admin = await prisma.appUser.findFirst({ where: { role: 'Admin' } });
  const pms = await prisma.appUser.findMany({ where: { role: 'ProjectManager', isActive: true } });
  if (!admin) throw new Error('No admin user.');

  const newSchemaExisting = await prisma.notification.count({
    where: { userId: admin.id, reason: { not: 'system' } },
  });
  if (newSchemaExisting > 0) {
    console.log(`   ${newSchemaExisting} new-schema notifications already exist — skipping.`);
    return;
  }

  const wps = await prisma.workPackage.findMany({
    where: { isDeleted: false, status: { in: ['InProgress', 'New'] } },
    include: { project: { select: { id: true, name: true } } },
    take: 6,
  });
  const meetings = await prisma.meetingTranscript.findMany({
    include: { project: { select: { id: true, name: true } } },
    take: 2,
  });

  const now = new Date();
  function ago(mins: number): Date {
    return new Date(now.getTime() - mins * 60 * 1000);
  }

  const notifs: Array<{
    userId: string;
    type: string;
    reason: string;
    title: string;
    message: string;
    projectId: string | null;
    entityType: string | null;
    entityId: string | null;
    actorId: string | null;
    link: string | null;
    isRead: boolean;
    createdAt: Date;
  }> = [];

  // Assignee notifications (3)
  for (const [i, wp] of wps.slice(0, 3).entries()) {
    notifs.push({
      userId: admin.id,
      type: 'work_package_assigned',
      reason: 'Assignee',
      title: `Nouvelle tâche assignée`,
      message: `"${wp.title}" vous a été assigné par ${pms[i % pms.length]?.firstName ?? 'un PM'}`,
      projectId: wp.projectId,
      entityType: 'work_package',
      entityId: wp.id,
      actorId: pms[i % pms.length]?.id ?? null,
      link: `/app/pm/projects/${wp.projectId}/workpackages`,
      isRead: false,
      createdAt: ago(30 + i * 15),
    });
  }

  // Watcher notification (1)
  if (wps[3]) {
    const wp = wps[3];
    notifs.push({
      userId: admin.id,
      type: 'status_changed',
      reason: 'Watcher',
      title: 'Changement de statut',
      message: `"${wp.title}" est passé à "En cours"`,
      projectId: wp.projectId,
      entityType: 'work_package',
      entityId: wp.id,
      actorId: pms[0]?.id ?? null,
      link: `/app/pm/projects/${wp.projectId}/workpackages`,
      isRead: false,
      createdAt: ago(90),
    });
  }

  // Mention (1) — in a comment
  if (meetings[0]) {
    const m = meetings[0];
    notifs.push({
      userId: admin.id,
      type: 'mention',
      reason: 'Mention',
      title: 'Vous avez été mentionné',
      message: `${pms[0]?.firstName ?? 'Un PM'}: "@admin peux-tu valider la décision sur l'architecture ?"`,
      projectId: m.projectId,
      entityType: 'meeting',
      entityId: m.id,
      actorId: pms[0]?.id ?? null,
      link: `/app/pm/projects/${m.projectId}`,
      isRead: false,
      createdAt: ago(120),
    });
  }

  // Deadline (1)
  if (wps[4]) {
    const wp = wps[4];
    notifs.push({
      userId: admin.id,
      type: 'deadline_warning',
      reason: 'Deadline',
      title: 'Échéance approche',
      message: `"${wp.title}" arrive à échéance dans 3 jours`,
      projectId: wp.projectId,
      entityType: 'work_package',
      entityId: wp.id,
      actorId: null,
      link: `/app/pm/projects/${wp.projectId}/workpackages`,
      isRead: false,
      createdAt: ago(240),
    });
  }

  // Read ones (2) — show that the system also keeps history
  if (wps[5]) {
    const wp = wps[5];
    notifs.push({
      userId: admin.id,
      type: 'work_package_assigned',
      reason: 'Assignee',
      title: 'Tâche assignée',
      message: `"${wp.title}" (lu)`,
      projectId: wp.projectId,
      entityType: 'work_package',
      entityId: wp.id,
      actorId: pms[0]?.id ?? null,
      link: `/app/pm/projects/${wp.projectId}/workpackages`,
      isRead: true,
      createdAt: ago(60 * 24),
    });
  }

  await prisma.notification.createMany({ data: notifs });
  console.log(`   ✓ ${notifs.length} notifications seeded for ${admin.email}`);

  console.log('── Done ✓');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
