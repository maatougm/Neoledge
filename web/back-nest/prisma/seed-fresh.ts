/**
 * @file prisma/seed-fresh.ts
 * @desc CLEAN-SLATE seed for the test server. Wipes ALL projects and every
 *       non-Admin user, then creates 5 coherent IT-deployment projects spanning
 *       the phase lifecycle, each with a PM, ProjectMember rows, a questionnaire
 *       (incl. backlog drivers + answers), a Kanban board, and work packages
 *       assigned to the project's members across statuses. The CadrageTechnique
 *       project carries a saved cahier so the spec-review flow is testable.
 *
 * Run: cd web/back-nest && npx tsx prisma/seed-fresh.ts
 * DESTRUCTIVE — drops data. Intended for the test/demo environment.
 */

import * as bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import { createSeedClient } from './seed-client.js';

let prisma!: PrismaClient;
const HASH = (p: string) => bcrypt.hashSync(p, 10);

const today = new Date();
const day = (n: number): Date => {
  const d = new Date(today);
  d.setDate(d.getDate() + n);
  d.setHours(0, 0, 0, 0);
  return d;
};

// ── Canonical phase values (match src/utils/phaseLabels.ts) ──────────────────
type Phase = 'Kickoff' | 'CadrageTechnique' | 'Parametrage' | 'Recette' | 'MEP';

interface WpSpec {
  title: string;
  type: 'Epic' | 'Feature' | 'Task' | 'Bug';
  status: 'New' | 'InProgress' | 'Resolved' | 'Closed' | 'OnHold';
  priority: 'Low' | 'Normal' | 'High' | 'Urgent';
  memberIdx: number; // index into the project's member list
  estHours: number;
  pct: number;
  startOffset: number | null;
  dueOffset: number | null;
}

async function main() {
  prisma = await createSeedClient();
  console.log('🧹  CLEAN-SLATE seed starting…\n');

  // ── 0. Admin (kept / ensured) ──────────────────────────────────────────────
  const ADMIN_EMAIL = 'admin@neoleadge.com';
  await prisma.appUser.upsert({
    where: { email: ADMIN_EMAIL },
    update: { isActive: true, role: 'Admin' },
    create: {
      firstName: 'Sophie', lastName: 'Dubois', email: ADMIN_EMAIL,
      passwordHash: HASH('Admin@123'), role: 'Admin',
      jobTitle: 'Administratrice système', department: 'Direction IT', isActive: true,
    },
  });

  // ── 1. WIPE (projects + non-admin users only) ──────────────────────────────
  // Projects first (cascades WPs, fields, members, cahier, meetings, comments,
  // activities, validations, boards, sprints, versions, milestones, time).
  const delProjects = await prisma.project.deleteMany({});
  // AuditLog.userId is NoAction, so detach (not delete) audit rows for the users
  // we're about to remove — this preserves audit history while freeing the FK.
  // Notifications cascade on user delete, so no explicit notification wipe.
  const nonAdmin = await prisma.appUser.findMany({ where: { role: { not: 'Admin' } }, select: { id: true } });
  const nonAdminIds = nonAdmin.map((u) => u.id);
  if (nonAdminIds.length > 0) {
    await prisma.auditLog.updateMany({ where: { userId: { in: nonAdminIds } }, data: { userId: null } });
  }
  const delUsers = await prisma.appUser.deleteMany({ where: { role: { not: 'Admin' } } });
  console.log(`   wiped: ${delProjects.count} projects, ${delUsers.count} non-admin users (audit history kept)\n`);

  const admin = await prisma.appUser.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });

  // ── 2. Users (fresh) ─────────────────────────────────────────────────────
  const mk = (
    firstName: string, lastName: string, email: string, password: string,
    role: 'ProjectManager' | 'SpecificationTeam' | 'Member', jobTitle: string, department: string,
  ) => ({ firstName, lastName, email, passwordHash: HASH(password), role, jobTitle, department, isActive: true });

  const userDefs = [
    mk('Luca', 'Martin', 'pm@neoleadge.com', 'Pm@123', 'ProjectManager', 'Chef de projet senior', 'Direction Projets'),
    mk('Emma', 'Bernard', 'pm2@neoleadge.com', 'Pm@12345', 'ProjectManager', 'Cheffe de projet', 'Direction Projets'),
    mk('Julien', 'Morel', 'spec@neoleadge.com', 'Spec@123', 'SpecificationTeam', 'Analyste fonctionnel', 'Études & Specs'),
    mk('Camille', 'Leroy', 'spec2@neoleadge.com', 'Valid@123', 'SpecificationTeam', 'Consultante métier', 'Études & Specs'),
    mk('Antoine', 'Petit', 'antoine@neoleadge.com', 'Dev@123', 'Member', 'Développeur fullstack', 'Réalisation'),
    mk('Nadia', 'Simon', 'nadia@neoleadge.com', 'Dev@123', 'Member', 'Ingénieure déploiement', 'Infrastructure'),
    mk('Karim', 'Haddad', 'karim@neoleadge.com', 'Dev@123', 'Member', 'Développeur backend', 'Réalisation'),
    mk('Léa', 'Roux', 'lea@neoleadge.com', 'Qa@123', 'Member', 'Ingénieure QA', 'Qualité'),
    mk('Marc', 'Girard', 'marc@neoleadge.com', 'Ops@123', 'Member', 'Ingénieur DevOps', 'Infrastructure'),
  ];
  await prisma.appUser.createMany({ data: userDefs });
  const dbUsers = await prisma.appUser.findMany({ where: { isActive: true } });
  const byEmail = Object.fromEntries(dbUsers.map((u) => [u.email, u]));
  console.log(`   ✓ ${userDefs.length} users created (+ admin)\n`);

  const pmLuca = byEmail['pm@neoleadge.com'];
  const pmEmma = byEmail['pm2@neoleadge.com'];
  const specJulien = byEmail['spec@neoleadge.com'];
  const specCamille = byEmail['spec2@neoleadge.com'];
  const antoine = byEmail['antoine@neoleadge.com'];
  const nadia = byEmail['nadia@neoleadge.com'];
  const karim = byEmail['karim@neoleadge.com'];
  const lea = byEmail['lea@neoleadge.com'];
  const marc = byEmail['marc@neoleadge.com'];

  // ── 3. Project definitions ─────────────────────────────────────────────────
  interface ProjDef {
    name: string; clientName: string; phase: Phase; priority: 'Low' | 'Medium' | 'High' | 'Critical';
    pm: typeof admin; startOffset: number; endOffset: number; tags: string;
    members: Array<{ u: typeof admin; label: string }>;
    fields: Array<{ label: string; fieldType: string; value: string; driver?: boolean; hint?: string; options?: string[] }>;
    wps: WpSpec[];
    cahier?: boolean;
  }

  const baseWps = (a: number, b: number, c: number, d: number): WpSpec[] => ([
    { title: 'Cadrage fonctionnel', type: 'Epic', status: 'Closed', priority: 'High', memberIdx: a, estHours: 40, pct: 100, startOffset: -40, dueOffset: -30 },
    { title: 'Rédaction des spécifications', type: 'Task', status: 'Closed', priority: 'High', memberIdx: b, estHours: 24, pct: 100, startOffset: -38, dueOffset: -28 },
    { title: 'Architecture technique', type: 'Task', status: 'Resolved', priority: 'High', memberIdx: c, estHours: 32, pct: 90, startOffset: -25, dueOffset: -10 },
    { title: 'Développement back-end', type: 'Feature', status: 'InProgress', priority: 'High', memberIdx: a, estHours: 80, pct: 55, startOffset: -15, dueOffset: 10 },
    { title: 'Développement front-end', type: 'Feature', status: 'InProgress', priority: 'Normal', memberIdx: b, estHours: 60, pct: 40, startOffset: -12, dueOffset: 12 },
    { title: 'Connecteur SSO', type: 'Task', status: 'InProgress', priority: 'High', memberIdx: c, estHours: 20, pct: 30, startOffset: -8, dueOffset: 8 },
    { title: 'Tests d\'intégration', type: 'Task', status: 'New', priority: 'Normal', memberIdx: d, estHours: 24, pct: 0, startOffset: 5, dueOffset: 18 },
    { title: 'Plan de recette', type: 'Task', status: 'New', priority: 'Normal', memberIdx: d, estHours: 16, pct: 0, startOffset: 8, dueOffset: 20 },
    { title: 'Documentation utilisateur', type: 'Task', status: 'New', priority: 'Low', memberIdx: b, estHours: 16, pct: 0, startOffset: 10, dueOffset: 24 },
    { title: 'Optimisation performances', type: 'Feature', status: 'OnHold', priority: 'Low', memberIdx: a, estHours: 20, pct: 0, startOffset: null, dueOffset: 40 },
  ]);

  const stdFields = (soc: string, code: string, type: string, vol: string, mods: string, contraintes: string) => ([
    { label: 'Société', fieldType: 'Text', value: soc },
    { label: 'Code client', fieldType: 'Text', value: code },
    { label: 'Type de projet', fieldType: 'Select', value: type, options: ['NeoLeadge', 'Elise', 'Les deux'] },
    { label: 'Volume documentaire', fieldType: 'Text', value: vol, driver: true, hint: 'Volume à migrer (nb documents, To)' },
    { label: 'Modules à déployer', fieldType: 'Text', value: mods, driver: true, hint: 'Modules fonctionnels attendus' },
    { label: 'Contraintes techniques', fieldType: 'Text', value: contraintes, driver: true, hint: 'SSO, hébergement, sécurité, intégrations' },
  ]);

  const projects: ProjDef[] = [
    {
      name: 'Migration GED — Mairie de Lyon', clientName: 'Mairie de Lyon', phase: 'Kickoff', priority: 'High',
      pm: pmLuca, startOffset: -10, endOffset: 160, tags: 'GED,migration,collectivité',
      members: [
        { u: antoine, label: 'Développeur' }, { u: karim, label: 'Développeur backend' },
        { u: lea, label: 'QA' }, { u: specJulien, label: 'Analyste fonctionnel' },
      ],
      fields: stdFields('Mairie de Lyon', 'ML-2026-001', 'Les deux', '120 000 documents, 4 To', 'GED, Workflow validation, Recherche full-text', 'SSO SAML2, hébergement SecNumCloud'),
      wps: baseWps(0, 1, 1, 2).slice(0, 4),
    },
    {
      name: 'Déploiement Elise v4 — CHU Bordeaux', clientName: 'CHU de Bordeaux', phase: 'CadrageTechnique', priority: 'Critical',
      pm: pmLuca, startOffset: -30, endOffset: 150, tags: 'santé,elise,déploiement',
      members: [
        { u: antoine, label: 'Développeur' }, { u: nadia, label: 'Déploiement' },
        { u: karim, label: 'Développeur backend' }, { u: specJulien, label: 'Analyste fonctionnel' },
      ],
      fields: stdFields('CHU de Bordeaux', 'CHU-BDX-26', 'Elise', '500 000 documents médicaux, 12 To', 'Archivage légal, Signature électronique, Connecteur DPI', 'Hébergement HDS, chiffrement au repos, SSO LDAP'),
      wps: baseWps(0, 2, 1, 3).slice(0, 6),
      cahier: true,
    },
    {
      name: 'Intégration NeoLeadge — Région PACA', clientName: 'Conseil Régional PACA', phase: 'Parametrage', priority: 'High',
      pm: pmEmma, startOffset: -60, endOffset: 90, tags: 'NeoLeadge,région,intégration',
      members: [
        { u: karim, label: 'Développeur backend' }, { u: antoine, label: 'Développeur' },
        { u: lea, label: 'QA' }, { u: marc, label: 'DevOps' },
      ],
      fields: stdFields('Conseil Régional PACA', 'CR-PACA-01', 'NeoLeadge', '80 000 documents, 2 To', 'Gestion de projet, Kanban, Gantt, Reporting', 'SSO OAuth2, intégration parapheur, API REST'),
      wps: baseWps(0, 1, 2, 3),
    },
    {
      name: 'Déploiement Elise — Ministère des Finances', clientName: 'Ministère de l\'Économie et des Finances', phase: 'Recette', priority: 'Critical',
      pm: pmEmma, startOffset: -120, endOffset: 40, tags: 'archivage,ministère,recette',
      members: [
        { u: nadia, label: 'Déploiement' }, { u: marc, label: 'DevOps' },
        { u: lea, label: 'QA' }, { u: karim, label: 'Développeur backend' },
      ],
      fields: stdFields('Min. Économie', 'MINEFI-2025', 'Les deux', '1 200 000 documents, 30 To', 'Archivage à valeur probante, Workflow visa, Audit', 'SecNumCloud, validation ANSSI, PRA/PCA'),
      wps: (() => { const w = baseWps(0, 1, 2, 3); return w.map((s, i) => ({ ...s, status: (i < 7 ? (i < 5 ? 'Closed' : 'Resolved') : 'InProgress') as WpSpec['status'], pct: i < 5 ? 100 : i < 7 ? 90 : 60 })); })(),
    },
    {
      name: 'Mise en place GED — Université Paris-Saclay', clientName: 'Université Paris-Saclay', phase: 'MEP', priority: 'Medium',
      pm: pmLuca, startOffset: -200, endOffset: 10, tags: 'enseignement,GED,université',
      members: [
        { u: antoine, label: 'Développeur' }, { u: nadia, label: 'Déploiement' },
        { u: marc, label: 'DevOps' },
      ],
      fields: stdFields('Université Paris-Saclay', 'UPS-2025-GED', 'NeoLeadge', '60 000 documents, 1.5 To', 'GED recherche, Espaces collaboratifs', 'SSO Shibboleth, fédération RENATER'),
      wps: (() => { const w = baseWps(0, 1, 2, 2); return w.map((s, i) => ({ ...s, status: (i < 8 ? 'Closed' : 'InProgress') as WpSpec['status'], pct: i < 8 ? 100 : 70 })); })(),
    },
  ];

  // ── 4. Create projects ─────────────────────────────────────────────────────
  for (const def of projects) {
    const project = await prisma.project.create({
      data: {
        name: def.name, clientName: def.clientName, status: def.phase, priority: def.priority,
        projectManagerId: def.pm.id, createdByAdminId: admin.id,
        startDate: day(def.startOffset), endDate: day(def.endOffset), tags: def.tags,
        isDeleted: false,
        ...(def.cahier ? { aiOutput: cahierJson(def) } : {}),
      },
    });

    // Members
    await prisma.projectMember.createMany({
      data: def.members.map((m) => ({ projectId: project.id, userId: m.u.id, label: m.label })),
    });

    // Questionnaire fields + values
    for (const [i, f] of def.fields.entries()) {
      const field = await prisma.projectField.create({
        data: {
          projectId: project.id, label: f.label, fieldType: f.fieldType, isRequired: i < 4,
          orderIndex: i, fieldCategory: 'Static',
          isBacklogDriver: f.driver ?? false, backlogHint: f.hint ?? null,
          options: f.options ? JSON.stringify(f.options) : null,
        },
      });
      await prisma.projectFieldValue.create({
        data: { projectId: project.id, projectFieldId: field.id, value: f.value },
      });
    }

    // Board + columns
    const board = await prisma.board.create({
      data: {
        projectId: project.id, name: 'Tableau principal', type: 'Kanban', isDefault: true,
        columns: {
          create: [
            { name: 'À faire', mapStatus: 'New', position: 0 },
            { name: 'En cours', mapStatus: 'InProgress', position: 1 },
            { name: 'Résolu', mapStatus: 'Resolved', position: 2 },
            { name: 'Terminé', mapStatus: 'Closed', position: 3 },
          ],
        },
      },
    });
    const cols = await prisma.boardColumn.findMany({ where: { boardId: board.id } });
    const colByStatus = new Map(cols.map((c) => [c.mapStatus ?? '', c.id]));

    // Sprint (one active)
    const sprint = await prisma.sprint.create({
      data: { boardId: board.id, name: 'Sprint courant', goal: 'Avancer le socle fonctionnel', startDate: day(-7), endDate: day(7), status: 'Active' },
    });

    // Work packages assigned to members
    for (const [i, w] of def.wps.entries()) {
      const member = def.members[w.memberIdx % def.members.length];
      await prisma.workPackage.create({
        data: {
          projectId: project.id, title: w.title, type: w.type, status: w.status, priority: w.priority,
          assigneeId: member.u.id, authorId: def.pm.id,
          estimatedHours: w.estHours, percentDone: w.pct, position: i,
          boardColumnId: colByStatus.get(w.status) ?? null,
          sprintId: w.status === 'InProgress' || w.status === 'New' ? sprint.id : null,
          startDate: w.startOffset !== null ? day(w.startOffset) : null,
          dueDate: w.dueOffset !== null ? day(w.dueOffset) : null,
          isDeleted: false,
        },
      });
    }

    console.log(`   ✓ ${def.name}  [${def.phase}]  PM=${def.pm.firstName}  members=${def.members.length}  wps=${def.wps.length}${def.cahier ? '  +cahier' : ''}`);
  }

  console.log('\n✅  Clean-slate seed complete.\n');
  console.log('Logins:');
  console.log('  Admin           admin@neoleadge.com   / Admin@123');
  console.log('  PM (Luca)       pm@neoleadge.com      / Pm@123');
  console.log('  PM (Emma)       pm2@neoleadge.com     / Pm@12345');
  console.log('  Spec (Julien)   spec@neoleadge.com    / Spec@123');
  console.log('  Spec (Camille)  spec2@neoleadge.com   / Valid@123');
  console.log('  Member          antoine@neoleadge.com / Dev@123');
  console.log('  Member          nadia@neoleadge.com   / Dev@123');
  console.log('  Member          karim@neoleadge.com   / Dev@123');
  console.log('  Member          lea@neoleadge.com     / Qa@123');
  console.log('  Member          marc@neoleadge.com    / Ops@123');
}

function cahierJson(def: { name: string; clientName: string }): string {
  return JSON.stringify({
    objectifDocument: `Le présent cahier des charges décrit le déploiement de la solution pour ${def.clientName}.`,
    contexte: `${def.clientName} souhaite moderniser sa gestion documentaire dans le cadre du projet « ${def.name} ».`,
    objectifProjet: 'Déployer la solution Elise v4, migrer le fonds documentaire existant et former les utilisateurs.',
    perimetreInclus: 'Migration des documents, paramétrage des workflows, connecteur DPI, signature électronique, formation.',
    perimetreExclus: 'Reprise des archives papier non numérisées. Développements spécifiques hors catalogue.',
    exigencesFonctionnelles: 'Archivage légal à valeur probante, recherche full-text, gestion fine des droits, piste d\'audit.',
    architectureTechnique: 'Hébergement HDS, chiffrement au repos, authentification SSO LDAP, haute disponibilité.',
    livrables: 'Environnement de production, documentation d\'exploitation, PV de recette, support de formation.',
    conclusion: 'Le projet vise une mise en production sécurisée et conforme aux exigences du secteur de la santé.',
    savedAt: new Date().toISOString(),
  });
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
