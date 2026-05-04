/**
 * @file prisma/seed-openproject.ts
 * @desc Seeds coherent demo data across the new OpenProject-parity tables:
 *       Work Packages, Sprints, Milestones, Budget, Time, Wiki,
 *       Meeting extras. Idempotent — safe to re-run.
 *
 * Usage: cd web/back-nest && npx tsx prisma/seed-openproject.ts
 */

import 'dotenv/config';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { createSeedClient } from './seed-client.js';

let prisma!: PrismaClient;

// Deterministic date helpers
const today = new Date();
function daysFromToday(n: number): Date {
  const d = new Date(today);
  d.setDate(d.getDate() + n);
  d.setHours(0, 0, 0, 0);
  return d;
}
function isoDate(n: number): Date {
  return daysFromToday(n);
}

async function main() {
  prisma = await createSeedClient();
  console.log('── Seeding OpenProject-parity demo data ──');

  // ── Fetch fixtures ───────────────────────────────────────────────────────
  const projects = await prisma.project.findMany({
    where: { isDeleted: false, id: { startsWith: 'bbbbbbbb-' } },
    orderBy: { name: 'asc' },
  });
  if (projects.length === 0) {
    console.log('No seed projects (bbbbbbbb-*) found. Abort.');
    return;
  }

  const users = await prisma.appUser.findMany({ where: { isActive: true } });
  const admin = users.find((u) => u.role === 'Admin');
  const pms = users.filter((u) => u.role === 'ProjectManager');
  const team = users.filter((u) =>
    ['SpecificationTeam', 'Member'].includes(u.role),
  );
  if (!admin) throw new Error('No Admin user found.');

  console.log(`   Projects: ${projects.length}, PMs: ${pms.length}, team: ${team.length}`);

  // ── 1. Hourly rates seed removed — HourlyRate model retired. ─────────────

  // ── 2. Per-project seeding loop ──────────────────────────────────────────
  for (const project of projects) {
    console.log(`── Project: ${project.name}`);

    // 2a. Board (auto-created by agile service on first GET, but seed here to be safe)
    let board = await prisma.board.findFirst({ where: { projectId: project.id } });
    if (!board) {
      board = await prisma.board.create({
        data: {
          projectId: project.id,
          name: 'Default Board',
          type: 'Kanban',
          isDefault: true,
          columns: {
            create: [
              { name: 'New', mapStatus: 'New', position: 0 },
              { name: 'In Progress', mapStatus: 'InProgress', position: 1 },
              { name: 'Resolved', mapStatus: 'Resolved', position: 2 },
              { name: 'Closed', mapStatus: 'Closed', position: 3 },
            ],
          },
        },
      });
    }
    const columns = await prisma.boardColumn.findMany({
      where: { boardId: board.id },
      orderBy: { position: 'asc' },
    });
    const colByStatus = new Map(columns.map((c) => [c.mapStatus ?? '', c.id]));

    // 2b. Versions (releases) ─────────────────────────────────────────────
    const versionNames = ['v1.0', 'v1.1', 'v2.0'];
    for (const [i, vname] of versionNames.entries()) {
      const exists = await prisma.version.findFirst({
        where: { projectId: project.id, name: vname },
      });
      if (!exists) {
        await prisma.version.create({
          data: {
            projectId: project.id,
            name: vname,
            description: `Release ${vname}`,
            startDate: isoDate(-30 + i * 30),
            endDate: isoDate(i * 30 + 20),
            status: i === 0 ? 'Closed' : i === 1 ? 'Open' : 'Open',
            position: i,
          },
        });
      }
    }
    const versions = await prisma.version.findMany({ where: { projectId: project.id } });
    const activeVersion = versions.find((v) => v.status === 'Open') ?? versions[0];

    // 2c. Sprints ──────────────────────────────────────────────────────────
    const existingSprints = await prisma.sprint.findMany({ where: { boardId: board.id } });
    if (existingSprints.length === 0) {
      await prisma.sprint.create({
        data: {
          boardId: board.id,
          name: 'Sprint 1',
          goal: 'Livrer le socle fonctionnel',
          startDate: isoDate(-14),
          endDate: isoDate(0),
          status: 'Closed',
          capacity: new Prisma.Decimal(80),
        },
      });
      await prisma.sprint.create({
        data: {
          boardId: board.id,
          name: 'Sprint 2',
          goal: 'Déploiement environnement de test',
          startDate: isoDate(0),
          endDate: isoDate(14),
          status: 'Active',
          capacity: new Prisma.Decimal(80),
        },
      });
      await prisma.sprint.create({
        data: {
          boardId: board.id,
          name: 'Sprint 3',
          goal: 'Recette et mise en production',
          startDate: isoDate(14),
          endDate: isoDate(28),
          status: 'Planning',
          capacity: new Prisma.Decimal(80),
        },
      });
    }
    const sprints = await prisma.sprint.findMany({
      where: { boardId: board.id },
      orderBy: { startDate: 'asc' },
    });
    const activeSprint = sprints.find((s) => s.status === 'Active');
    const plannedSprint = sprints.find((s) => s.status === 'Planning');

    // 2d. Custom field ─────────────────────────────────────────────────────
    let customField = await prisma.workPackageCustomField.findFirst({
      where: { projectId: project.id, name: 'Environnement' },
    });
    if (!customField) {
      customField = await prisma.workPackageCustomField.create({
        data: {
          projectId: project.id,
          name: 'Environnement',
          fieldType: 'select',
          options: '["DEV","RECETTE","PROD"]',
          isRequired: false,
          position: 0,
        },
      });
    }

    // 2e. Work Packages (hierarchy + statuses) ────────────────────────────
    const existingWps = await prisma.workPackage.count({
      where: { projectId: project.id, isDeleted: false },
    });
    if (existingWps > 0) {
      console.log(`   Skipping WP seed — ${existingWps} already exist.`);
    } else {
      const wpSpecs: Array<{
        title: string;
        type: string;
        status: string;
        priority: string;
        assigneeIdx: number;
        sprintIdx?: number | null;
        versionIdx?: number | null;
        startOffset?: number;
        dueOffset?: number;
        estHours?: number;
        pct: number;
      }> = [
        { title: 'Cadrage fonctionnel',                type: 'Epic',    status: 'Closed',     priority: 'High',      assigneeIdx: 0, sprintIdx: 0, versionIdx: 0, startOffset: -20, dueOffset: -10, estHours: 40, pct: 100 },
        { title: 'Rédaction du cahier des charges',   type: 'Task',    status: 'Closed',     priority: 'High',      assigneeIdx: 1, sprintIdx: 0, versionIdx: 0, startOffset: -18, dueOffset: -12, estHours: 24, pct: 100 },
        { title: 'Maquettes UI',                       type: 'Task',    status: 'Closed',     priority: 'Normal',    assigneeIdx: 2, sprintIdx: 0, versionIdx: 0, startOffset: -14, dueOffset: -8,  estHours: 16, pct: 100 },
        { title: 'Architecture technique',             type: 'Task',    status: 'Resolved',   priority: 'High',      assigneeIdx: 3, sprintIdx: 1, versionIdx: 1, startOffset: -7,  dueOffset: 2,   estHours: 32, pct: 80  },
        { title: 'Développement API backend',          type: 'Feature', status: 'InProgress', priority: 'High',      assigneeIdx: 4, sprintIdx: 1, versionIdx: 1, startOffset: -5,  dueOffset: 10,  estHours: 80, pct: 50  },
        { title: 'Développement frontend',             type: 'Feature', status: 'InProgress', priority: 'High',      assigneeIdx: 2, sprintIdx: 1, versionIdx: 1, startOffset: -3,  dueOffset: 12,  estHours: 60, pct: 35  },
        { title: 'Fix: crash au démarrage',            type: 'Bug',     status: 'InProgress', priority: 'Urgent',    assigneeIdx: 4, sprintIdx: 1, versionIdx: 1, startOffset: -1,  dueOffset: 3,   estHours: 8,  pct: 60  },
        { title: 'Tests unitaires',                    type: 'Task',    status: 'New',        priority: 'Normal',    assigneeIdx: 3, sprintIdx: 2, versionIdx: 1, startOffset: 5,   dueOffset: 14,  estHours: 24, pct: 0   },
        { title: 'Tests d\'intégration',               type: 'Task',    status: 'New',        priority: 'Normal',    assigneeIdx: 5, sprintIdx: 2, versionIdx: 1, startOffset: 8,   dueOffset: 18,  estHours: 20, pct: 0   },
        { title: 'Documentation utilisateur',          type: 'Task',    status: 'New',        priority: 'Low',       assigneeIdx: 1, sprintIdx: 2, versionIdx: 2, startOffset: 10,  dueOffset: 22,  estHours: 16, pct: 0   },
        { title: 'Déploiement en pré-production',      type: 'Task',    status: 'New',        priority: 'High',      assigneeIdx: 5, sprintIdx: 2, versionIdx: 2, startOffset: 14,  dueOffset: 20,  estHours: 12, pct: 0   },
        { title: 'Formation client',                   type: 'Task',    status: 'New',        priority: 'Normal',    assigneeIdx: 1, sprintIdx: null, versionIdx: 2, startOffset: 20,  dueOffset: 25,  estHours: 16, pct: 0   },
        { title: 'Amélioration performances UI',       type: 'Feature', status: 'OnHold',     priority: 'Low',       assigneeIdx: 2, sprintIdx: null, versionIdx: 2, startOffset: null as unknown as number, dueOffset: 40, estHours: 20, pct: 0 },
        { title: 'Mode hors-ligne',                    type: 'Feature', status: 'New',        priority: 'Low',       assigneeIdx: 4, sprintIdx: null, versionIdx: 2, startOffset: null as unknown as number, dueOffset: 60, estHours: 40, pct: 0 },
      ];

      const people = team.length ? team : [admin, ...pms];
      const createdWps: { id: string; title: string; status: string }[] = [];

      for (const spec of wpSpecs) {
        const assignee = people[spec.assigneeIdx % people.length];
        const sprintId = spec.sprintIdx != null ? sprints[spec.sprintIdx]?.id ?? null : null;
        const versionId = spec.versionIdx != null ? versions[spec.versionIdx]?.id ?? null : null;
        const wp = await prisma.workPackage.create({
          data: {
            projectId: project.id,
            title: spec.title,
            description: `Auto-seeded pour ${project.name}`,
            type: spec.type,
            status: spec.status,
            priority: spec.priority,
            assigneeId: assignee.id,
            authorId: admin.id,
            sprintId,
            versionId,
            boardColumnId: colByStatus.get(spec.status) ?? null,
            startDate: spec.startOffset != null && !Number.isNaN(spec.startOffset) ? isoDate(spec.startOffset) : null,
            dueDate: spec.dueOffset != null ? isoDate(spec.dueOffset) : null,
            estimatedHours: new Prisma.Decimal(spec.estHours ?? 0),
            spentHours: new Prisma.Decimal(((spec.estHours ?? 0) * spec.pct) / 100),
            percentDone: spec.pct,
            position: createdWps.length,
          },
        });
        createdWps.push({ id: wp.id, title: wp.title, status: wp.status });

        // One watcher per WP (the assignee's PM)
        const watcher = pms[createdWps.length % pms.length];
        if (watcher) {
          await prisma.workPackageWatcher.create({
            data: { workPackageId: wp.id, userId: watcher.id },
          }).catch(() => {});
        }

        // Custom field value for environment
        await prisma.workPackageCustomValue.create({
          data: {
            workPackageId: wp.id,
            customFieldId: customField.id,
            value: spec.status === 'Closed' ? 'PROD' : spec.status === 'InProgress' ? 'RECETTE' : 'DEV',
          },
        }).catch(() => {});
      }

      // Dependencies: WP5 (dev backend) blocks WP8/WP9 (tests)
      if (createdWps[4] && createdWps[7]) {
        await prisma.workPackageDependency.create({
          data: { fromWpId: createdWps[4].id, toWpId: createdWps[7].id, type: 'blocks' },
        }).catch(() => {});
      }
      if (createdWps[4] && createdWps[8]) {
        await prisma.workPackageDependency.create({
          data: { fromWpId: createdWps[4].id, toWpId: createdWps[8].id, type: 'blocks' },
        }).catch(() => {});
      }
      if (createdWps[5] && createdWps[7]) {
        await prisma.workPackageDependency.create({
          data: { fromWpId: createdWps[5].id, toWpId: createdWps[7].id, type: 'blocks' },
        }).catch(() => {});
      }
      if (createdWps[9] && createdWps[10]) {
        await prisma.workPackageDependency.create({
          data: { fromWpId: createdWps[9].id, toWpId: createdWps[10].id, type: 'follows' },
        }).catch(() => {});
      }

      console.log(`   ✓ ${createdWps.length} work packages`);
    }

    // 2f. Milestones ─────────────────────────────────────────────────────
    const existingMs = await prisma.milestone.count({ where: { projectId: project.id } });
    if (existingMs === 0) {
      await prisma.milestone.createMany({
        data: [
          { projectId: project.id, title: 'Kick-off',                date: isoDate(-20), isReached: true,  color: '#10b981', position: 0 },
          { projectId: project.id, title: 'Spécifications validées', date: isoDate(-5),  isReached: true,  color: '#10b981', position: 1 },
          { projectId: project.id, title: 'MVP livré',               date: isoDate(14),  isReached: false, color: '#f59e0b', position: 2 },
          { projectId: project.id, title: 'Mise en production',      date: isoDate(28),  isReached: false, color: '#ef4444', position: 3 },
        ],
      });
    }

    // 2g. Budget seed removed — budgeting module was retired.

    // 2h. Time entries (last 14 days, various users on various WPs) ──────
    const existingTe = await prisma.timeEntry.count({ where: { projectId: project.id } });
    if (existingTe === 0) {
      const wps = await prisma.workPackage.findMany({
        where: { projectId: project.id, isDeleted: false, status: { in: ['InProgress', 'Resolved', 'Closed'] } },
        take: 6,
      });
      const teamPool = team.length ? team : [admin];
      const activities = ['development', 'design', 'testing', 'meeting'];
      let count = 0;
      for (let dayAgo = 1; dayAgo <= 14; dayAgo++) {
        const spentOn = isoDate(-dayAgo);
        // Skip weekends
        if (spentOn.getDay() === 0 || spentOn.getDay() === 6) continue;
        for (const user of teamPool.slice(0, 3)) {
          const wp = wps[count % wps.length];
          if (!wp) continue;
          await prisma.timeEntry.create({
            data: {
              userId: user.id,
              projectId: project.id,
              workPackageId: wp.id,
              hours: new Prisma.Decimal(Math.floor(Math.random() * 4 + 2)),
              spentOn,
              activity: activities[count % activities.length],
              comment: `${activities[count % activities.length]} sur "${wp.title}"`,
              isBillable: true,
            },
          });
          count++;
        }
      }
      console.log(`   ✓ ${count} time entries`);
    }

    // 2i. Wiki seed removed — wiki module retired.

    // 2j. Meeting extras (only for projects with transcripts) ────────────
    const transcripts = await prisma.meetingTranscript.findMany({ where: { projectId: project.id }, take: 1 });
    if (transcripts.length > 0) {
      const meeting = transcripts[0];
      const agendaExists = await prisma.meetingAgendaItem.count({ where: { meetingId: meeting.id } });
      if (agendaExists === 0) {
        await prisma.meetingAgendaItem.createMany({
          data: [
            { meetingId: meeting.id, title: 'Tour de table', duration: 5, position: 0, responsibleId: admin.id },
            { meetingId: meeting.id, title: 'Avancement sprint', duration: 15, position: 1, responsibleId: (pms[0] ?? admin).id },
            { meetingId: meeting.id, title: 'Points bloquants', duration: 10, position: 2, responsibleId: (pms[0] ?? admin).id },
            { meetingId: meeting.id, title: 'Planning semaine prochaine', duration: 10, position: 3, responsibleId: admin.id },
          ],
        });
      }
      const attExists = await prisma.meetingAttendee.count({ where: { meetingId: meeting.id } });
      if (attExists === 0) {
        const attendees = [admin, ...pms.slice(0, 2), ...team.slice(0, 2)];
        for (const [i, u] of attendees.entries()) {
          await prisma.meetingAttendee.create({
            data: {
              meetingId: meeting.id,
              userId: u.id,
              isPresent: i < 4,
              role: i === 0 ? 'Animateur' : i === 1 ? 'Chef de projet' : 'Participant',
            },
          });
        }
      }
      const outExists = await prisma.meetingOutcome.count({ where: { meetingId: meeting.id } });
      if (outExists === 0) {
        await prisma.meetingOutcome.createMany({
          data: [
            { meetingId: meeting.id, type: 'Decision', description: 'Adoption de la nouvelle stack Vue 3 + Pinia.',                     ownerId: admin.id },
            { meetingId: meeting.id, type: 'Action',   description: 'Rédiger le guide d\'installation d\'ici vendredi.',                    ownerId: (pms[0] ?? admin).id, dueDate: isoDate(3) },
            { meetingId: meeting.id, type: 'Risk',     description: 'Risque de retard sur la livraison API si l\'auth n\'est pas finalisée.', ownerId: (pms[0] ?? admin).id },
            { meetingId: meeting.id, type: 'Note',     description: 'Le client demande un rendez-vous avant la mise en production.' },
          ],
        });
      }
    }
  }

  // ── 4. Recompute WP spentHours from time entries ─────────────────────────
  console.log('4. Recomputing spent hours…');
  const allWps = await prisma.workPackage.findMany({
    where: { projectId: { in: projects.map((p) => p.id) }, isDeleted: false },
    select: { id: true },
  });
  for (const wp of allWps) {
    const agg = await prisma.timeEntry.aggregate({
      where: { workPackageId: wp.id },
      _sum: { hours: true },
    });
    if (agg._sum.hours) {
      await prisma.workPackage.update({
        where: { id: wp.id },
        data: { spentHours: agg._sum.hours },
      });
    }
  }

  console.log('── Seed complete ✓');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
