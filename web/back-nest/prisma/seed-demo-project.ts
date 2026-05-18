/**
 * @file prisma/seed-demo-project.ts
 * @desc End-to-end demo project seeded so a tester can exercise every
 *       feature: members, questionnaire, sprints, work packages,
 *       dependencies, milestones, time entries, meeting transcript,
 *       cahier des charges. Idempotent (uses fixed UUIDs + upserts).
 *
 * Run:
 *   cd web/back-nest
 *   npx ts-node --esm prisma/seed-demo-project.ts
 *
 * Pre-req: the main prisma/seed.ts has already been run so the user
 * accounts (admin@, pm@, spec@, real@, deploy@) exist.
 */

import type { PrismaClient } from '@prisma/client'
import { createSeedClient } from './seed-client.js'

let prisma!: PrismaClient

// ─── Fixed IDs so the script is idempotent ───────────────────────────────
const PROJECT_ID    = 'dddddddd-dem0-0000-0000-000000000001'
const BOARD_ID      = 'eeeeeeee-bo0d-0000-0000-000000000001'
const COL_NEW       = 'eeeeeeee-co1n-0000-0000-000000000001'
const COL_INPRG     = 'eeeeeeee-co2p-0000-0000-000000000001'
const COL_REVIEW    = 'eeeeeeee-co3r-0000-0000-000000000001'
const COL_DONE      = 'eeeeeeee-co4d-0000-0000-000000000001'

const SPRINT_S0     = 'ffffffff-sp00-0000-0000-000000000001' // Sprint 0 — Cadrage initial (closed)
const SPRINT_PAST   = 'ffffffff-sp01-0000-0000-000000000001' // Sprint 1 — Maquettes & cahier (closed)
const SPRINT_ACTIVE = 'ffffffff-sp02-0000-0000-000000000001' // Sprint 2 — Auth & espace personnel (active)
const SPRINT_NEXT   = 'ffffffff-sp03-0000-0000-000000000001' // Sprint 3 — Demande d'acte & paiement (planning)
const SPRINT_S4     = 'ffffffff-sp04-0000-0000-000000000001' // Sprint 4 — RDV & notifications (planning)

const TRANSCRIPT_ID = 'ababcdcd-tran-0000-0000-000000000001'

// Work packages — predictable IDs so dependencies stay stable
const WP = (n: number) => `bcbcbcbc-wp${String(n).padStart(2, '0')}-0000-0000-000000000001`

const TODAY = new Date()
const days = (n: number) => new Date(TODAY.getTime() + n * 86_400_000)
const dayOnly = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

async function main() {
  prisma = await createSeedClient()
  console.log('🌱  Seeding demo project (Refonte Portail Citoyen — Mairie de Tunis)...')

  // ─── Resolve user IDs by email (created by main seed) ──────────────────
  const users = await prisma.appUser.findMany({
    where: {
      email: {
        in: [
          'admin@neoleadge.com',
          'pm@neoleadge.com',
          'spec@neoleadge.com',
          'spec2@neoleadge.com',
          'realiz@neoleadge.com',
          'deploy@neoleadge.com',
        ],
      },
    },
    select: { id: true, email: true },
  })
  const id = (email: string, optional = false): string | null => {
    const u = users.find((x) => x.email === email)
    if (!u && !optional) throw new Error(`Missing seed user ${email} — run prisma/seed.ts first`)
    return u?.id ?? null
  }
  // Required users — script aborts if any of these is missing.
  const adminId   = id('admin@neoleadge.com')!
  const pmId      = id('pm@neoleadge.com')!
  const spec1Id   = id('spec@neoleadge.com')!
  const devId     = id('realiz@neoleadge.com')!
  const deployId  = id('deploy@neoleadge.com')!
  // spec2 is nice-to-have. If absent, the second SpecTeam member just
  // doesn't get added — everything else still works.
  const spec2Id   = id('spec2@neoleadge.com', true)
  const U = {
    admin:   adminId,
    pm:      pmId,
    spec1:   spec1Id,
    spec2:   spec2Id,
    dev:     devId,
    deploy:  deployId,
  }

  // ─── Project ────────────────────────────────────────────────────────────
  // Status MUST match a key in the frontend's PROJECT_STATUS_LABELS map
  // (project.types.ts) — otherwise the NeoTag in the projects list renders
  // empty. 'Integration' is the closest semantic match for "active dev".
  await prisma.project.upsert({
    where: { id: PROJECT_ID },
    update: {
      status: 'Integration',
      priority: 'High',
      isDeleted: false,
    },
    create: {
      id: PROJECT_ID,
      name: 'Refonte Portail Citoyen — Mairie de Tunis',
      clientName: 'Mairie de Tunis',
      status: 'Integration',
      priority: 'High',
      projectManagerId: U.pm,
      createdByAdminId: U.admin,
      startDate: days(-60),
      endDate:   days(120),
      tags: 'demo,e2e,portail,collectivité',
    },
  })
  console.log('  ✓ project')

  // ─── Members ────────────────────────────────────────────────────────────
  // PM is implicit (projectManagerId). Add the rest as ProjectMembers with
  // realistic role labels. spec2 is included only when seeded.
  const members: Array<{ userId: string; label: string }> = [
    { userId: U.spec1,  label: 'Lead spécification' },
    { userId: U.dev,    label: 'Développeur fullstack' },
    { userId: U.deploy, label: 'Ingénieur déploiement' },
  ]
  if (U.spec2) members.splice(1, 0, { userId: U.spec2, label: 'Validation métier' })
  for (const m of members) {
    await prisma.projectMember.upsert({
      where: { project_member_uq: { projectId: PROJECT_ID, userId: m.userId } },
      update: { label: m.label },
      create: { projectId: PROJECT_ID, userId: m.userId, label: m.label },
    })
  }
  console.log(`  ✓ ${members.length} project members`)

  // ─── Questionnaire fields + values ──────────────────────────────────────
  const fields = [
    { label: 'Société',                fieldType: 'Text',     isRequired: true,  fieldCategory: 'Static',  orderIndex: 0, value: 'Mairie de Tunis' },
    { label: 'Code client',            fieldType: 'Text',     isRequired: true,  fieldCategory: 'Static',  orderIndex: 1, value: 'MTU-2026-001' },
    { label: 'Type de projet',         fieldType: 'Select',   isRequired: true,  fieldCategory: 'Static',  orderIndex: 2, value: 'NeoLeadge', options: JSON.stringify(['NeoLeadge','Elise','Les deux']) },
    { label: 'Volumétrie attendue',    fieldType: 'Number',   isRequired: true,  fieldCategory: 'Dynamic', orderIndex: 3, value: '50000', isBacklogDriver: true, backlogHint: 'Nombre de demandes citoyennes par mois' },
    { label: 'Authentification',       fieldType: 'Select',   isRequired: true,  fieldCategory: 'Dynamic', orderIndex: 4, value: 'SAML2 + OAuth2', options: JSON.stringify(['LDAP','SAML2','OAuth2','SAML2 + OAuth2','Aucune']), isBacklogDriver: true },
    { label: 'Modules attendus',       fieldType: 'Textarea', isRequired: false, fieldCategory: 'Dynamic', orderIndex: 5, value: 'Demande d\'acte d\'état civil, suivi de dossier, paiement en ligne, prise de rendez-vous, espace personnel.', isBacklogDriver: true },
    { label: 'Contraintes RGPD',       fieldType: 'Textarea', isRequired: true,  fieldCategory: 'Dynamic', orderIndex: 6, value: 'Hébergement en Tunisie, audit annuel, droit à l\'oubli, double consentement.', isBacklogDriver: true },
    { label: 'Échéance MEP',           fieldType: 'Date',     isRequired: true,  fieldCategory: 'Static',  orderIndex: 7, value: dayOnly(days(120)).toISOString().slice(0, 10) },
    { label: 'Sponsor exécutif',       fieldType: 'Text',     isRequired: false, fieldCategory: 'Dynamic', orderIndex: 8, value: 'Mme Salma Mejri, DGS' },
  ]

  for (const f of fields) {
    const { value, ...fieldData } = f
    let existing = await prisma.projectField.findFirst({ where: { projectId: PROJECT_ID, label: f.label } })
    if (!existing) {
      existing = await prisma.projectField.create({ data: { projectId: PROJECT_ID, ...fieldData } })
    }
    await prisma.projectFieldValue.upsert({
      where: { projectId_projectFieldId: { projectId: PROJECT_ID, projectFieldId: existing.id } },
      update: { value },
      create: { projectId: PROJECT_ID, projectFieldId: existing.id, value },
    })
  }
  console.log(`  ✓ ${fields.length} questionnaire fields + values`)

  // ─── Board + columns ────────────────────────────────────────────────────
  await prisma.board.upsert({
    where: { id: BOARD_ID },
    update: { isDefault: true },
    create: { id: BOARD_ID, projectId: PROJECT_ID, name: 'Board principal', type: 'Kanban', isDefault: true },
  })
  const columns = [
    { id: COL_NEW,    name: 'À faire',  position: 0, mapStatus: 'New' },
    { id: COL_INPRG,  name: 'En cours', position: 1, mapStatus: 'InProgress' },
    { id: COL_REVIEW, name: 'Revue',    position: 2, mapStatus: 'Resolved' },
    { id: COL_DONE,   name: 'Terminé',  position: 3, mapStatus: 'Closed' },
  ]
  for (const c of columns) {
    await prisma.boardColumn.upsert({
      where: { id: c.id },
      update: { name: c.name, position: c.position, mapStatus: c.mapStatus },
      create: { boardId: BOARD_ID, ...c },
    })
  }
  console.log(`  ✓ board + ${columns.length} columns`)

  // ─── Sprints ────────────────────────────────────────────────────────────
  // Five 2-week sprints from kickoff (~8 weeks ago) through MEP planning.
  const sprints = [
    {
      id: SPRINT_S0,
      name: 'Sprint 0 — Cadrage initial',
      goal: 'Lancement officiel du projet, ateliers d\'identification des parties prenantes, recueil initial des besoins.',
      startDate: dayOnly(days(-70)),
      endDate:   dayOnly(days(-57)),
      status: 'Closed',
      capacity: 60,
    },
    {
      id: SPRINT_PAST,
      name: 'Sprint 1 — Maquettes & cahier des charges',
      goal: 'Maquettes interactives, validation par la DGS, rédaction et signature du cahier des charges.',
      startDate: dayOnly(days(-56)),
      endDate:   dayOnly(days(-42)),
      status: 'Closed',
      capacity: 80,
    },
    {
      id: SPRINT_ACTIVE,
      name: 'Sprint 2 — Authentification & Espace personnel',
      goal: 'Implémenter SAML2/OAuth2, créer l\'espace citoyen avec consultation des dossiers et notifications.',
      startDate: dayOnly(days(-14)),
      endDate:   dayOnly(days(0)),
      status: 'Active',
      capacity: 110,
    },
    {
      id: SPRINT_NEXT,
      name: 'Sprint 3 — Demande d\'acte & Paiement',
      goal: 'Développer le formulaire de demande d\'acte d\'état civil et l\'intégration du paiement en ligne (Tunisie Net Pay).',
      startDate: dayOnly(days(1)),
      endDate:   dayOnly(days(15)),
      status: 'Planning',
      capacity: 110,
    },
    {
      id: SPRINT_S4,
      name: 'Sprint 4 — Prise de RDV & notifications avancées',
      goal: 'Module de prise de rendez-vous, notifications SMS/email, tableau de bord administratif.',
      startDate: dayOnly(days(16)),
      endDate:   dayOnly(days(30)),
      status: 'Planning',
      capacity: 100,
    },
  ]
  for (const s of sprints) {
    await prisma.sprint.upsert({
      where: { id: s.id },
      update: { status: s.status, name: s.name, goal: s.goal, startDate: s.startDate, endDate: s.endDate, capacity: s.capacity },
      create: { boardId: BOARD_ID, ...s },
    })
  }
  console.log(`  ✓ ${sprints.length} sprints`)

  // ─── Work packages ──────────────────────────────────────────────────────
  // Mix of types, statuses, priorities, sprints, assignees. Hours match
  // sprint capacity reasonably. specB falls back to spec1 if spec2 is unseeded.
  const specB = U.spec2 ?? U.spec1
  const wps = [
    // Sprint 0 — Cadrage initial (closed)
    { n:17, title:'Kick-off avec la DGS et les sponsors',   type:'Task',  status:'Closed', priority:'High',   assigneeId:U.pm,    sprintId:SPRINT_S0,     colId:COL_DONE,   start:days(-70), due:days(-68), est:8,  spent:10, pct:100 },
    { n:18, title:'Identification des parties prenantes',   type:'Task',  status:'Closed', priority:'High',   assigneeId:U.pm,    sprintId:SPRINT_S0,     colId:COL_DONE,   start:days(-68), due:days(-65), est:6,  spent:5,  pct:100 },
    { n:19, title:'Recueil initial des besoins métier',     type:'Task',  status:'Closed', priority:'High',   assigneeId:U.spec1, sprintId:SPRINT_S0,     colId:COL_DONE,   start:days(-65), due:days(-60), est:16, spent:18, pct:100 },
    { n:20, title:'Étude de l\'existant (portail v1)',      type:'Task',  status:'Closed', priority:'Normal', assigneeId:U.spec1, sprintId:SPRINT_S0,     colId:COL_DONE,   start:days(-63), due:days(-58), est:12, spent:11, pct:100 },
    { n:21, title:'Validation périmètre Sprint 0',          type:'Task',  status:'Closed', priority:'Normal', assigneeId:specB,   sprintId:SPRINT_S0,     colId:COL_DONE,   start:days(-58), due:days(-57), est:4,  spent:3,  pct:100 },

    // Sprint 1 — Maquettes & cahier (closed)
    { n:1,  title:'Atelier de recueil des besoins détaillés', type:'Task',    status:'Closed', priority:'High',   assigneeId:U.spec1, sprintId:SPRINT_PAST,   colId:COL_DONE,   start:days(-56), due:days(-52), est:16, spent:18, pct:100 },
    { n:2,  title:'Maquettes Figma — espace citoyen',        type:'Task',    status:'Closed', priority:'High',   assigneeId:U.spec1, sprintId:SPRINT_PAST,   colId:COL_DONE,   start:days(-50), due:days(-46), est:24, spent:22, pct:100 },
    { n:3,  title:'Validation maquettes par DGS',            type:'Task',    status:'Closed', priority:'Normal', assigneeId:specB,   sprintId:SPRINT_PAST,   colId:COL_DONE,   start:days(-46), due:days(-44), est:8,  spent:6,  pct:100 },
    { n:4,  title:'Rédaction cahier des charges',            type:'Task',    status:'Closed', priority:'High',   assigneeId:U.spec1, sprintId:SPRINT_PAST,   colId:COL_DONE,   start:days(-44), due:days(-42), est:16, spent:14, pct:100 },
    { n:22, title:'Architecture technique cible (revue)',    type:'Task',    status:'Closed', priority:'High',   assigneeId:U.dev,   sprintId:SPRINT_PAST,   colId:COL_DONE,   start:days(-49), due:days(-45), est:12, spent:14, pct:100 },

    // Sprint 2 — Auth & espace personnel (active)
    { n:5,  title:'POC SAML2 contre IdP de la mairie',           type:'Task',    status:'Closed',    priority:'High',   assigneeId:U.dev,    sprintId:SPRINT_ACTIVE, colId:COL_DONE,   start:days(-14), due:days(-10), est:12, spent:11, pct:100 },
    { n:6,  title:'Implémenter OAuth2 (Google/Facebook)',        type:'Feature', status:'Resolved',  priority:'High',   assigneeId:U.dev,    sprintId:SPRINT_ACTIVE, colId:COL_REVIEW, start:days(-10), due:days(-3),  est:20, spent:22, pct:90 },
    { n:7,  title:'Espace citoyen — page d\'accueil',            type:'Feature', status:'InProgress', priority:'High',  assigneeId:U.dev,    sprintId:SPRINT_ACTIVE, colId:COL_INPRG,  start:days(-7),  due:days(-1),  est:16, spent:10, pct:60 },
    { n:8,  title:'Consultation des dossiers en cours',          type:'Feature', status:'InProgress', priority:'Normal',assigneeId:U.dev,    sprintId:SPRINT_ACTIVE, colId:COL_INPRG,  start:days(-5),  due:days(2),   est:14, spent:6,  pct:40 },
    { n:9,  title:'Notifications push citoyennes',               type:'Feature', status:'New',        priority:'Normal',assigneeId:U.dev,    sprintId:SPRINT_ACTIVE, colId:COL_NEW,    start:days(0),   due:days(5),   est:18, spent:0,  pct:0 },
    { n:10, title:'Bug — login échoue avec accents dans le nom', type:'Bug',     status:'New',        priority:'Urgent',assigneeId:U.dev,    sprintId:SPRINT_ACTIVE, colId:COL_NEW,    start:null,      due:days(-1),  est:4,  spent:0,  pct:0 },
    { n:23, title:'Tests E2E Cypress — parcours connexion',      type:'Task',    status:'InProgress', priority:'Normal',assigneeId:U.dev,    sprintId:SPRINT_ACTIVE, colId:COL_INPRG,  start:days(-3),  due:days(3),   est:10, spent:4,  pct:35 },
    { n:24, title:'Audit accessibilité (WCAG AA) — page accueil',type:'Task',    status:'New',        priority:'Normal',assigneeId:U.spec1,  sprintId:SPRINT_ACTIVE, colId:COL_NEW,    start:days(1),   due:days(4),   est:6,  spent:0,  pct:0 },

    // Sprint 3 — Demande d'acte & paiement (planning)
    { n:11, title:'Formulaire demande d\'acte d\'état civil',         type:'Feature', status:'New', priority:'High',   assigneeId:U.dev,    sprintId:SPRINT_NEXT, colId:COL_NEW, start:days(1),  due:days(8),  est:24, spent:0, pct:0 },
    { n:12, title:'Intégration passerelle de paiement (Tunisie Net)', type:'Feature', status:'New', priority:'High',   assigneeId:U.dev,    sprintId:SPRINT_NEXT, colId:COL_NEW, start:days(3),  due:days(12), est:30, spent:0, pct:0 },
    { n:13, title:'Validation des paiements côté trésorerie',         type:'Task',    status:'New', priority:'Normal', assigneeId:specB,    sprintId:SPRINT_NEXT, colId:COL_NEW, start:days(12), due:days(15), est:8,  spent:0, pct:0 },
    { n:25, title:'Génération PDF du reçu de paiement',               type:'Task',    status:'New', priority:'Normal', assigneeId:U.dev,    sprintId:SPRINT_NEXT, colId:COL_NEW, start:days(8),  due:days(13), est:10, spent:0, pct:0 },
    { n:26, title:'Suivi de statut du dossier (workflow)',            type:'Feature', status:'New', priority:'High',   assigneeId:U.dev,    sprintId:SPRINT_NEXT, colId:COL_NEW, start:days(5),  due:days(14), est:18, spent:0, pct:0 },

    // Sprint 4 — RDV & notifications avancées (planning)
    { n:14, title:'Prise de rendez-vous — calendrier par service',   type:'Feature', status:'New', priority:'Normal', assigneeId:U.dev,    sprintId:SPRINT_S4,   colId:COL_NEW, start:days(16), due:days(24), est:24, spent:0, pct:0 },
    { n:27, title:'Notifications email transactionnelles',           type:'Feature', status:'New', priority:'Normal', assigneeId:U.dev,    sprintId:SPRINT_S4,   colId:COL_NEW, start:days(20), due:days(26), est:14, spent:0, pct:0 },
    { n:28, title:'Notifications SMS via Twilio (créneau RDV)',      type:'Feature', status:'New', priority:'Low',    assigneeId:U.dev,    sprintId:SPRINT_S4,   colId:COL_NEW, start:days(22), due:days(28), est:12, spent:0, pct:0 },
    { n:29, title:'Tableau de bord administratif (suivi dossiers)',  type:'Feature', status:'New', priority:'Normal', assigneeId:U.dev,    sprintId:SPRINT_S4,   colId:COL_NEW, start:days(18), due:days(29), est:20, spent:0, pct:0 },

    // Backlog (no sprint) — long-term planning + recette + MEP
    { n:15, title:'Audit RGPD pré-MEP',                             type:'Task',    status:'New', priority:'High',   assigneeId:specB,    sprintId:null, colId:COL_NEW, start:days(80),  due:days(95),  est:16, spent:0, pct:0 },
    { n:16, title:'Plan de bascule production',                     type:'Task',    status:'New', priority:'Normal', assigneeId:U.deploy, sprintId:null, colId:COL_NEW, start:days(100), due:days(115), est:20, spent:0, pct:0 },
    { n:30, title:'Recette utilisateur — cycle 1 (parcours bout-en-bout)', type:'Task', status:'New', priority:'High', assigneeId:U.spec1,  sprintId:null, colId:COL_NEW, start:days(35), due:days(50), est:24, spent:0, pct:0 },
    { n:31, title:'Tests de charge (50k req/mois pic)',              type:'Task',    status:'New', priority:'High',   assigneeId:U.deploy, sprintId:null, colId:COL_NEW, start:days(60),  due:days(70),  est:16, spent:0, pct:0 },
    { n:32, title:'Documentation technique + guide utilisateur',     type:'Task',    status:'New', priority:'Normal', assigneeId:U.spec1,  sprintId:null, colId:COL_NEW, start:days(85),  due:days(105), est:20, spent:0, pct:0 },
    { n:33, title:'Formation des agents municipaux (2 sessions)',    type:'Task',    status:'New', priority:'Normal', assigneeId:U.spec1,  sprintId:null, colId:COL_NEW, start:days(105), due:days(112), est:12, spent:0, pct:0 },
  ]

  for (const w of wps) {
    await prisma.workPackage.upsert({
      where: { id: WP(w.n) },
      update: {
        title: w.title, status: w.status, priority: w.priority, assigneeId: w.assigneeId,
        sprintId: w.sprintId, boardColumnId: w.colId, startDate: w.start, dueDate: w.due,
        estimatedHours: w.est, spentHours: w.spent, percentDone: w.pct, isDeleted: false,
      },
      create: {
        id: WP(w.n), projectId: PROJECT_ID, title: w.title, type: w.type,
        status: w.status, priority: w.priority, assigneeId: w.assigneeId, authorId: U.pm,
        sprintId: w.sprintId, boardColumnId: w.colId, startDate: w.start, dueDate: w.due,
        estimatedHours: w.est, spentHours: w.spent, percentDone: w.pct,
      },
    })
  }
  console.log(`  ✓ ${wps.length} work packages`)

  // ─── Dependencies ───────────────────────────────────────────────────────
  // POC SAML2 (#5) blocks OAuth2 (#6); cahier (#4) blocks all sprint-2 dev WPs;
  // formulaire acte (#11) blocks paiement (#12); paiement (#12) blocks
  // validation trésorerie (#13).
  const deps = [
    [4, 5, 'blocks'],
    [4, 6, 'blocks'],
    [5, 6, 'blocks'],
    [4, 7, 'blocks'],
    [11, 12, 'blocks'],
    [12, 13, 'blocks'],
  ]
  for (const [from, to, type] of deps) {
    try {
      await prisma.workPackageDependency.upsert({
        where: { fromWpId_toWpId_type: { fromWpId: WP(from as number), toWpId: WP(to as number), type: type as string } },
        update: {},
        create: { fromWpId: WP(from as number), toWpId: WP(to as number), type: type as string },
      })
    } catch { /* already exists or schema differs — ignore */ }
  }
  console.log(`  ✓ ${deps.length} dependencies`)

  // ─── Milestones (jalons) ────────────────────────────────────────────────
  // Spread across the project lifeline. Past = reached; future = pending.
  const milestones = [
    { id: 'mile0001-0000-0000-0000-000000000001', title: 'Kick-off projet signé',                date: dayOnly(days(-68)), isReached: true,  workPackageId: WP(17), color: '#10b981' },
    { id: 'mile0002-0000-0000-0000-000000000001', title: 'Périmètre Sprint 0 validé',            date: dayOnly(days(-57)), isReached: true,  workPackageId: WP(21), color: '#10b981' },
    { id: 'mile0003-0000-0000-0000-000000000001', title: 'Cahier des charges signé',             date: dayOnly(days(-42)), isReached: true,  workPackageId: WP(4),  color: '#10b981' },
    { id: 'mile0004-0000-0000-0000-000000000001', title: 'POC SAML2 validé en interne',          date: dayOnly(days(-10)), isReached: true,  workPackageId: WP(5),  color: '#10b981' },
    { id: 'mile0005-0000-0000-0000-000000000001', title: 'Recette espace citoyen',               date: dayOnly(days(7)),   isReached: false, workPackageId: WP(8),  color: '#3b82f6' },
    { id: 'mile0006-0000-0000-0000-000000000001', title: 'Recette demande d\'acte & paiement',   date: dayOnly(days(20)),  isReached: false, workPackageId: WP(13), color: '#3b82f6' },
    { id: 'mile0007-0000-0000-0000-000000000001', title: 'Recette prise de RDV & notifications', date: dayOnly(days(35)),  isReached: false, workPackageId: WP(14), color: '#3b82f6' },
    { id: 'mile0008-0000-0000-0000-000000000001', title: 'Tests de charge passés',               date: dayOnly(days(72)),  isReached: false, workPackageId: WP(31), color: '#f59e0b' },
    { id: 'mile0009-0000-0000-0000-000000000001', title: 'Audit RGPD validé',                    date: dayOnly(days(95)),  isReached: false, workPackageId: WP(15), color: '#f59e0b' },
    { id: 'mile0010-0000-0000-0000-000000000001', title: 'Formation agents municipaux',          date: dayOnly(days(112)), isReached: false, workPackageId: WP(33), color: '#8b5cf6' },
    { id: 'mile0011-0000-0000-0000-000000000001', title: 'Mise en production',                   date: dayOnly(days(120)), isReached: false, workPackageId: WP(16), color: '#dc2626' },
  ]
  for (const m of milestones) {
    const { id: mid, ...mRest } = m
    await prisma.milestone.upsert({
      where: { id: mid },
      update: { title: mRest.title, date: mRest.date, isReached: mRest.isReached, workPackageId: mRest.workPackageId },
      create: { id: mid, projectId: PROJECT_ID, ...mRest },
    })
  }
  console.log(`  ✓ ${milestones.length} milestones`)

  // ─── Time entries ───────────────────────────────────────────────────────
  // Spread entries over the past 14 days — for the active sprint mostly.
  const timeEntries = [
    { userId: U.dev,    workPackageId: WP(5), hours: 5, daysAgo: 13, comment: 'Setup projet + auth IdP' },
    { userId: U.dev,    workPackageId: WP(5), hours: 6, daysAgo: 11, comment: 'Tests SAML2 OK' },
    { userId: U.dev,    workPackageId: WP(6), hours: 7, daysAgo: 9,  comment: 'OAuth2 Google + tests' },
    { userId: U.dev,    workPackageId: WP(6), hours: 8, daysAgo: 7,  comment: 'OAuth2 Facebook + intégration' },
    { userId: U.dev,    workPackageId: WP(6), hours: 7, daysAgo: 5,  comment: 'Refactor + tests E2E' },
    { userId: U.dev,    workPackageId: WP(7), hours: 4, daysAgo: 4,  comment: 'Page accueil — squelette' },
    { userId: U.dev,    workPackageId: WP(7), hours: 6, daysAgo: 2,  comment: 'Composants + responsive' },
    { userId: U.dev,    workPackageId: WP(8), hours: 6, daysAgo: 1,  comment: 'Liste dossiers + filtre' },
    { userId: U.spec1,  workPackageId: WP(1), hours: 8, daysAgo: 50, comment: 'Atelier sponsor + écriture compte-rendu' },
    { userId: U.spec1,  workPackageId: WP(2), hours: 6, daysAgo: 48, comment: 'Maquettes basse-fi' },
    // Sprint 0 entries — historical context for analytics / burndown
    { userId: U.pm,     workPackageId: WP(17), hours: 4, daysAgo: 69, comment: 'Préparation kick-off + slides DGS' },
    { userId: U.pm,     workPackageId: WP(17), hours: 6, daysAgo: 68, comment: 'Réunion kick-off + compte-rendu' },
    { userId: U.spec1,  workPackageId: WP(19), hours: 8, daysAgo: 64, comment: 'Recueil besoins équipe état civil' },
    { userId: U.spec1,  workPackageId: WP(19), hours: 6, daysAgo: 62, comment: 'Recueil besoins service paiement' },
    { userId: U.spec1,  workPackageId: WP(20), hours: 8, daysAgo: 61, comment: 'Audit code legacy portail v1' },
    { userId: U.dev,    workPackageId: WP(22), hours: 6, daysAgo: 47, comment: 'Architecture target + ADR' },
    { userId: U.dev,    workPackageId: WP(22), hours: 8, daysAgo: 46, comment: 'Revue tech avec lead' },
    // Active-sprint progress
    { userId: U.dev,    workPackageId: WP(23), hours: 2, daysAgo: 3,  comment: 'Setup Cypress + 1er parcours' },
    { userId: U.dev,    workPackageId: WP(23), hours: 2, daysAgo: 1,  comment: 'Tests 2FA + reset password' },
  ]
  for (const t of timeEntries) {
    const spentOn = dayOnly(days(-t.daysAgo))
    const exists = await prisma.timeEntry.findFirst({
      where: { userId: t.userId, workPackageId: t.workPackageId, spentOn, hours: t.hours },
    })
    if (!exists) {
      await prisma.timeEntry.create({
        data: {
          userId: t.userId, projectId: PROJECT_ID, workPackageId: t.workPackageId,
          hours: t.hours, spentOn, activity: 'development',
          comment: t.comment, isBillable: true,
        },
      })
    }
  }
  console.log(`  ✓ ${timeEntries.length} time entries`)

  // ─── Comments ───────────────────────────────────────────────────────────
  const comments = [
    { userId: U.pm,    content: 'Lancement réussi, le sponsor est aligné sur les 4 modules majeurs.', daysAgo: 56 },
    { userId: U.spec1, content: 'Cahier des charges v1 partagé pour validation. Merci de retourner avant vendredi.', daysAgo: 44 },
    ...(U.spec2 ? [{ userId: U.spec2, content: 'Cahier OK de mon côté. Une remarque sur la section RGPD — j\'ai laissé un commentaire en ligne.', daysAgo: 43 }] : []),
    { userId: U.dev,   content: 'POC SAML2 fonctionne avec l\'IdP de la mairie. On peut démarrer OAuth2 sereinement.', daysAgo: 11 },
    { userId: U.pm,    content: 'Sprint 2 démarre demain — focus sur l\'auth + espace citoyen. Daily à 9h30.', daysAgo: 14 },
    { userId: U.dev,   content: 'OAuth2 Google + Facebook OK. Je passe la PR en revue.', daysAgo: 4 },
    { userId: U.deploy,content: 'Environnement de staging prêt. URL : https://staging.portail-tunis.tn', daysAgo: 2 },
    { userId: U.pm,    content: 'Kick-off réussi avec la DGS — équipe alignée sur les 4 modules majeurs et l\'échéance MEP.', daysAgo: 68 },
    { userId: U.spec1, content: 'Étude de l\'existant terminée. ~12k dossiers actifs à reprendre, format hétérogène à normaliser.', daysAgo: 60 },
    { userId: U.dev,   content: 'Architecture cible validée : Vue 3 + NestJS + PostgreSQL hébergés en Tunisie.', daysAgo: 46 },
    { userId: U.pm,    content: 'Sprint 3 (demande d\'acte + paiement) démarrage J+1 — prévoir réunion préparatoire avec la trésorerie.', daysAgo: 1 },
  ]
  for (const c of comments) {
    const createdAt = days(-c.daysAgo)
    const exists = await prisma.projectComment.findFirst({
      where: { projectId: PROJECT_ID, userId: c.userId, content: c.content },
    })
    if (!exists) {
      await prisma.projectComment.create({
        data: { projectId: PROJECT_ID, userId: c.userId, content: c.content, createdAt },
      })
    }
  }
  console.log(`  ✓ ${comments.length} project comments`)

  // ─── Meeting transcript (with segments) — one realistic kickoff meeting
  let transcript = await prisma.meetingTranscript.findUnique({ where: { id: TRANSCRIPT_ID } })
  if (!transcript) {
    transcript = await prisma.meetingTranscript.create({
      data: {
        id: TRANSCRIPT_ID,
        projectId: PROJECT_ID,
        title: 'Réunion de cadrage — Mairie de Tunis',
        originalFileName: 'kickoff-mairie-tunis.webm',
        durationSeconds: 1820,
        detectedLanguages: 'fr,ar',
        recordedAt: days(-56),
        aiStatus: 'completed',
        aiSummary: 'Réunion de cadrage avec la DGS. Points clés : 50k demandes/mois attendues, exigences RGPD (hébergement Tunisie), 4 modules prioritaires (espace citoyen, demande d\'acte, paiement, RDV). Échéance MEP confirmée à 4 mois.',
      },
    })
    const segments = [
      { speaker: 'Speaker 1', text: 'Bonjour à tous, merci d\'être là. On va cadrer ensemble la refonte du portail citoyen.', startTime: 0,    endTime: 8,   language: 'fr', confidence: 0.95 },
      { speaker: 'Speaker 2', text: 'On vise 50 000 demandes par mois en pic, principalement des actes d\'état civil.',          startTime: 8,    endTime: 16,  language: 'fr', confidence: 0.93 },
      { speaker: 'Speaker 1', text: 'Côté authentification, on veut SAML2 avec notre IdP interne plus OAuth2 pour les citoyens externes.', startTime: 16, endTime: 26, language: 'fr', confidence: 0.96 },
      { speaker: 'Speaker 2', text: 'L\'hébergement doit rester en Tunisie — c\'est une exigence non-négociable du RGPD local.', startTime: 26, endTime: 34, language: 'fr', confidence: 0.94 },
      { speaker: 'Speaker 1', text: 'Quatre modules : espace personnel, demande d\'acte, paiement en ligne, prise de rendez-vous.', startTime: 34, endTime: 42, language: 'fr', confidence: 0.95 },
    ]
    await prisma.transcriptSegment.createMany({
      data: segments.map((s) => ({ transcriptId: TRANSCRIPT_ID, ...s })),
    })
  }
  console.log('  ✓ meeting transcript with 5 segments')

  // ─── Saved Cahier des Charges (Project.aiOutput) ────────────────────────
  // Realistic content covering the 9-key schema the rest of the system expects.
  const cahierContent = {
    objectifDocument: 'Le présent cahier des charges décrit les besoins fonctionnels et techniques de la refonte du portail citoyen de la Mairie de Tunis. Il sert de base contractuelle entre la Mairie et le prestataire NeoLeadge.',
    contexte: 'La Mairie de Tunis souhaite moderniser son portail citoyen pour répondre à la demande croissante de services en ligne. L\'outil actuel ne supporte plus la charge (50 000 demandes mensuelles attendues) et ne respecte pas le RGPD tunisien.',
    objectifProjet: '- Offrir un espace citoyen unifié avec authentification SAML2 et OAuth2.\n- Permettre la demande dématérialisée d\'actes d\'état civil.\n- Intégrer un paiement en ligne sécurisé.\n- Garantir la conformité RGPD et l\'hébergement local en Tunisie.',
    perimetreInclus: '- Refonte complète du frontend (Vue 3) et du backend (NestJS).\n- Intégration SAML2 + OAuth2 (Google, Facebook).\n- Module de demande d\'acte d\'état civil.\n- Passerelle de paiement Tunisie Net.\n- Module de prise de rendez-vous.\n- Espace personnel citoyen.',
    perimetreExclus: '- Application mobile native (prévue en phase 2).\n- Module de signalements citoyens.\n- Intégration avec d\'autres administrations.',
    exigencesFonctionnelles: [
      { title: 'Authentification & Espace personnel', content: 'SAML2 (IdP mairie) + OAuth2 (Google/Facebook). Espace citoyen avec consultation des dossiers, notifications, historique des demandes.' },
      { title: 'Demande d\'acte d\'état civil',       content: 'Formulaire pas-à-pas, upload de pièces justificatives, suivi du statut (déposé / en cours / disponible).' },
      { title: 'Paiement en ligne',                  content: 'Intégration Tunisie Net Pay, reçu PDF, gestion des remboursements.' },
      { title: 'Prise de rendez-vous',               content: 'Calendrier par service municipal, créneaux disponibles, rappels SMS/email.' },
      { title: 'Notifications',                      content: 'Notifications in-app, email, SMS optionnel pour les changements de statut.' },
    ],
    architectureTechnique: [
      { title: 'Frontend',     content: 'Vue 3 + Vite + Pinia + NeoLibrary (PrimeVue 4). PWA pour usage mobile. Hébergé sur CDN national.' },
      { title: 'Backend',      content: 'NestJS 11 + Prisma 7 + PostgreSQL 16. API REST + WebSocket pour notifications temps réel.' },
      { title: 'Infrastructure', content: 'Hébergement Tunisie (Tunisie Telecom Cloud). HTTPS via Caddy + Let\'s Encrypt. Sauvegardes quotidiennes.' },
      { title: 'Sécurité',     content: 'JWT signed HS256, audit log immutable, redaction PII des logs, rate limiting par utilisateur.' },
    ],
    livrables: '- Code source complet sur GitLab Mairie de Tunis.\n- Documentation technique + guide utilisateur.\n- Plan de bascule production + plan de rollback.\n- Formation des équipes municipales (2 sessions de 4h).',
    conclusion: 'Ce cahier formalise les besoins de la Mairie de Tunis et engage le prestataire à fournir un portail citoyen moderne, performant et conforme à la réglementation tunisienne, dans un délai de 4 mois.',
  }

  await prisma.project.update({
    where: { id: PROJECT_ID },
    data: {
      aiOutput: JSON.stringify({
        aiContent: cahierContent,
        savedAt: new Date().toISOString(),
      }),
    },
  })
  console.log('  ✓ cahier des charges (saved in Project.aiOutput)')

  // ─── Snapshot the cahier as a CahierVersion (versioning history) ────────
  const existingVersion = await prisma.cahierVersion.findFirst({
    where: { projectId: PROJECT_ID },
    orderBy: { version: 'desc' },
  })
  if (!existingVersion) {
    await prisma.cahierVersion.create({
      data: {
        projectId: PROJECT_ID,
        version: 1,
        kind: 'generated',
        aiContent: JSON.stringify(cahierContent),
        createdById: U.pm,
      },
    })
    console.log('  ✓ cahier version 1 (generated)')
  }

  // ─── Final summary ──────────────────────────────────────────────────────
  console.log('\n✅  Demo project seeded!\n')
  console.log(`URL: https://neoleadge.pythagore-init.com/app/pm/projects/${PROJECT_ID}`)
  console.log('\nLogins to test (all roles see this project):')
  console.log('  Admin   admin@neoleadge.com / Admin@123    — full access')
  console.log('  PM      pm@neoleadge.com    / Pm@123       — full PM workflow')
  console.log('  Spec    spec@neoleadge.com  / Spec@123     — validation team (read + edit cahier)')
  console.log('  Spec2   spec2@neoleadge.com / Valid@123    — validation team')
  console.log('  Dev     realiz@neoleadge.com / Realiz@123  — assigned to ~10 WPs')
  console.log('  Deploy  deploy@neoleadge.com / Deploy@123  — deployment milestone owner')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
