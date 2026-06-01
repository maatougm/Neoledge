/**
 * @file prisma/seed.ts
 * @desc Local development seed — realistic NeoLeadge demo data
 * Run: npx ts-node --esm prisma/seed.ts   (or: npm run seed)
 */

import * as bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import { createSeedClient } from './seed-client.js';

// Picks MariaDB (mysql://) or Postgres (postgres://) adapter at runtime.
let prisma!: PrismaClient;
const HASH = (p: string) => bcrypt.hashSync(p, 10);

// ─── Fixed UUIDs so seed is idempotent ───────────────────────────────────────
const ID = {
  // Users
  admin:    'aaaaaaaa-0001-0000-0000-000000000000',
  pm1:      'aaaaaaaa-0002-0000-0000-000000000000',
  pm2:      'aaaaaaaa-0003-0000-0000-000000000000',
  spec1:    'aaaaaaaa-0004-0000-0000-000000000000',
  spec2:    'aaaaaaaa-0005-0000-0000-000000000000',
  real1:    'aaaaaaaa-0006-0000-0000-000000000000',
  deploy1:  'aaaaaaaa-0007-0000-0000-000000000000',
  viewer1:  'aaaaaaaa-0008-0000-0000-000000000000',

  // Projects
  p1: 'bbbbbbbb-0001-0000-0000-000000000000',
  p2: 'bbbbbbbb-0002-0000-0000-000000000000',
  p3: 'bbbbbbbb-0003-0000-0000-000000000000',
  p4: 'bbbbbbbb-0004-0000-0000-000000000000',
  p5: 'bbbbbbbb-0005-0000-0000-000000000000',
  p6: 'bbbbbbbb-0006-0000-0000-000000000000',

  // Templates
  tpl1: 'cccccccc-0001-0000-0000-000000000000',
  tpl2: 'cccccccc-0002-0000-0000-000000000000',
};

async function main() {
  prisma = await createSeedClient();
  console.log('🌱  Seeding database...');

  // ─── Users ────────────────────────────────────────────────────────────────
  const users = [
    {
      id: ID.admin, firstName: 'Sophie', lastName: 'Dubois',
      email: 'admin@neoleadge.com', passwordHash: HASH('Admin@123'),
      role: 'Admin', jobTitle: 'Administratrice système',
      department: 'Direction IT',
    },
    {
      id: ID.pm1, firstName: 'Luca', lastName: 'Martin',
      email: 'pm@neoleadge.com', passwordHash: HASH('Pm@123'),
      role: 'ProjectManager', jobTitle: 'Chef de projet senior',
      department: 'Direction Projets',
    },
    {
      id: ID.pm2, firstName: 'Emma', lastName: 'Bernard',
      email: 'pm2@neoleadge.com', passwordHash: HASH('Pm@12345'),
      role: 'ProjectManager', jobTitle: 'Chef de projet',
      department: 'Direction Projets',
    },
    {
      id: ID.spec1, firstName: 'Julien', lastName: 'Morel',
      email: 'spec@neoleadge.com', passwordHash: HASH('Spec@123'),
      role: 'SpecificationTeam', jobTitle: 'Analyste fonctionnel',
      department: 'Études & Specs',
    },
    {
      id: ID.spec2, firstName: 'Camille', lastName: 'Leroy',
      email: 'spec2@neoleadge.com', passwordHash: HASH('Valid@123'),
      role: 'SpecificationTeam', jobTitle: 'Consultante métier',
      department: 'Études & Specs',
    },
    {
      id: ID.real1, firstName: 'Antoine', lastName: 'Petit',
      email: 'realiz@neoleadge.com', passwordHash: HASH('Realiz@123'),
      role: 'Member', jobTitle: 'Développeur fullstack',
      department: 'Réalisation',
    },
    {
      id: ID.deploy1, firstName: 'Nadia', lastName: 'Simon',
      email: 'deploy@neoleadge.com', passwordHash: HASH('Deploy@123'),
      role: 'Member', jobTitle: 'Ingénieure déploiement',
      department: 'Infrastructure',
    },
    {
      id: ID.viewer1, firstName: 'Thomas', lastName: 'Dupont',
      email: 'viewer@neoleadge.com', passwordHash: HASH('Viewer@1'),
      role: 'Member', jobTitle: 'Directeur commercial',
      department: 'Commerce',
    },
  ];

  for (const u of users) {
    const { id, ...rest } = u;
    await prisma.appUser.upsert({
      where: { email: u.email },
      update: { ...rest, isActive: true },
      create: { ...u, isActive: true },
    });
  }
  console.log(`  ✓ ${users.length} users`);

  // Fetch actual DB IDs (may differ from fixed IDs if records pre-existed)
  const dbUsers = await prisma.appUser.findMany({
    where: { email: { in: users.map(u => u.email) } },
    select: { id: true, email: true },
  });
  const userIdByEmail = Object.fromEntries(dbUsers.map(u => [u.email, u.id]));
  const R = {
    admin:   userIdByEmail['admin@neoleadge.com'],
    pm1:     userIdByEmail['pm@neoleadge.com'],
    pm2:     userIdByEmail['pm2@neoleadge.com'],
    spec1:   userIdByEmail['spec@neoleadge.com'],
    spec2:   userIdByEmail['spec2@neoleadge.com'],
    real1:   userIdByEmail['realiz@neoleadge.com'],
    deploy1: userIdByEmail['deploy@neoleadge.com'],
    viewer1: userIdByEmail['viewer@neoleadge.com'],
  };

  // ─── Projects ─────────────────────────────────────────────────────────────
  const projects = [
    {
      id: ID.p1,
      name: 'Migration GED Mairie de Lyon',
      clientName: 'Mairie de Lyon',
      status: 'InProgress',
      priority: 'High',
      projectManagerId: R.pm1,
      createdByAdminId: R.admin,
      startDate: new Date('2026-01-15'),
      endDate:   new Date('2026-07-30'),
      tags: 'GED,migration,collectivité',
    },
    {
      id: ID.p2,
      name: 'Déploiement Elise v4 — CHU Bordeaux',
      clientName: 'CHU de Bordeaux',
      status: 'SpecificationValidation',
      priority: 'Critical',
      projectManagerId: R.pm1,
      createdByAdminId: R.admin,
      startDate: new Date('2026-02-01'),
      endDate:   new Date('2026-09-15'),
      tags: 'santé,elise,déploiement',
    },
    {
      id: ID.p3,
      name: 'Intégration NeoLeadge — Conseil Régional PACA',
      clientName: 'Conseil Régional PACA',
      status: 'Realization',
      priority: 'High',
      projectManagerId: R.pm2,
      createdByAdminId: R.admin,
      startDate: new Date('2026-01-10'),
      endDate:   new Date('2026-06-30'),
      tags: 'NeoLeadge,région,intégration',
    },
    {
      id: ID.p4,
      name: 'Mise en production Elise v4 — CHU Bordeaux',
      clientName: 'Ministère de l\'Économie et des Finances',
      status: 'Realisation',
      priority: 'Critical',
      projectManagerId: R.pm2,
      createdByAdminId: R.admin,
      startDate: new Date('2025-10-01'),
      endDate:   new Date('2026-04-30'),
      tags: 'archivage,ministère,mep',
    },
    {
      id: ID.p5,
      name: 'Mise en place GED — Université Paris-Saclay',
      clientName: 'Université Paris-Saclay',
      status: 'Completed',
      priority: 'Medium',
      projectManagerId: R.pm1,
      createdByAdminId: R.admin,
      startDate: new Date('2025-06-01'),
      endDate:   new Date('2025-12-20'),
      tags: 'enseignement,GED,université',
    },
    {
      id: ID.p6,
      name: 'Configuration initiale — Ville de Nantes',
      clientName: 'Ville de Nantes',
      status: 'Draft',
      priority: 'Low',
      projectManagerId: R.pm2,
      createdByAdminId: R.admin,
      startDate: new Date('2026-05-01'),
      endDate:   new Date('2026-11-30'),
      tags: 'collectivité,initialisation',
    },
  ];

  for (const p of projects) {
    await prisma.project.upsert({
      where: { id: p.id },
      // Re-apply on re-seed so stale enum values (e.g. old 'Planning') are corrected.
      update: { status: p.status, priority: p.priority, isDeleted: false },
      create: { ...p, isDeleted: false },
    });
  }
  console.log(`  ✓ ${projects.length} projects`);

  // ─── Project Fields & Values ───────────────────────────────────────────────
  const staticFields = [
    { label: 'Société',        fieldType: 'Text',   isRequired: true, fieldCategory: 'Static', orderIndex: 0 },
    { label: 'Code client',    fieldType: 'Text',   isRequired: true, fieldCategory: 'Static', orderIndex: 1 },
    { label: 'Type de projet', fieldType: 'Select', isRequired: true, fieldCategory: 'Static', orderIndex: 2,
      options: JSON.stringify(['NeoLeadge', 'Elise', 'Les deux']) },
    { label: 'Date démarrage', fieldType: 'Date',   isRequired: false, fieldCategory: 'Static', orderIndex: 3 },
    { label: 'Statut global',  fieldType: 'Select', isRequired: false, fieldCategory: 'Dynamic', orderIndex: 4,
      options: JSON.stringify(['À faire', 'En cours', 'Terminé']) },
    { label: 'Responsable technique', fieldType: 'Text', isRequired: false, fieldCategory: 'Dynamic', orderIndex: 5 },
  ];

  const projectValues: Record<string, Record<string, string>> = {
    [ID.p1]: { 'Société': 'Mairie de Lyon', 'Code client': 'ML-2026-001', 'Type de projet': 'Les deux', 'Date démarrage': '2026-01-15', 'Statut global': 'En cours', 'Responsable technique': 'Luca Martin' },
    [ID.p2]: { 'Société': 'CHU de Bordeaux', 'Code client': 'CHU-BDX-26', 'Type de projet': 'Elise', 'Date démarrage': '2026-02-01', 'Statut global': 'En cours', 'Responsable technique': 'Luca Martin' },
    [ID.p3]: { 'Société': 'Conseil Régional PACA', 'Code client': 'CR-PACA-01', 'Type de projet': 'NeoLeadge', 'Date démarrage': '2026-01-10', 'Statut global': 'En cours', 'Responsable technique': 'Emma Bernard' },
    [ID.p4]: { 'Société': 'Min. Économie', 'Code client': 'MINEFI-2025', 'Type de projet': 'Les deux', 'Date démarrage': '2025-10-01', 'Statut global': 'En cours', 'Responsable technique': 'Emma Bernard' },
    [ID.p5]: { 'Société': 'Université Paris-Saclay', 'Code client': 'UPS-2025-GED', 'Type de projet': 'NeoLeadge', 'Date démarrage': '2025-06-01', 'Statut global': 'Terminé', 'Responsable technique': 'Luca Martin' },
    [ID.p6]: { 'Société': 'Ville de Nantes', 'Code client': 'VDN-2026', 'Type de projet': 'NeoLeadge', 'Date démarrage': '2026-05-01', 'Statut global': 'À faire', 'Responsable technique': '' },
  };

  for (const projectId of Object.keys(projectValues)) {
    for (const field of staticFields) {
      const existing = await prisma.projectField.findFirst({
        where: { projectId, label: field.label },
      });
      let fieldId: string;
      if (existing) {
        fieldId = existing.id;
      } else {
        const created = await prisma.projectField.create({
          data: { projectId, ...field },
        });
        fieldId = created.id;
      }

      const value = projectValues[projectId]?.[field.label] ?? null;
      await prisma.projectFieldValue.upsert({
        where: { projectId_projectFieldId: { projectId, projectFieldId: fieldId } },
        update: { value },
        create: { projectId, projectFieldId: fieldId, value },
      });
    }
  }
  console.log('  ✓ project fields & values');

  // ─── Comments ─────────────────────────────────────────────────────────────
  const comments = [
    { projectId: ID.p1, userId: R.pm1,   content: 'Réunion de lancement effectuée. Tous les interlocuteurs identifiés. Prochaine étape : atelier de recueil des besoins.' },
    { projectId: ID.p1, userId: R.spec1, content: 'Cartographie des flux documentaires en cours. Estimation : 4 000 documents à migrer.' },
    { projectId: ID.p1, userId: R.admin, content: 'Budget validé par le DSI. Bon pour commencer la phase de spec.' },
    { projectId: ID.p2, userId: R.pm1,   content: 'Spécifications fonctionnelles envoyées pour validation côté client. Délai de retour : 10 jours.' },
    { projectId: ID.p2, userId: R.spec2, content: 'Point bloquant identifié : hétérogénéité des formats de fichiers médicaux. Nécessite une réunion de cadrage.' },
    { projectId: ID.p3, userId: R.pm2,   content: 'Environnement de recette installé. Tests d\'intégration planifiés pour la semaine du 10 mars.' },
    { projectId: ID.p3, userId: R.real1, content: 'Connecteur SSO SAML2 développé et testé avec succès en environnement de dev.' },
    { projectId: ID.p4, userId: R.pm2,   content: 'Validation ANSSI reçue. Le déploiement en production est autorisé.' },
    { projectId: ID.p4, userId: R.deploy1, content: 'Plan de basculement préparé. Date retenue : 15 avril 2026 à 22h00.' },
    { projectId: ID.p5, userId: R.pm1,   content: 'Projet livré avec succès. PV de recette signé le 18 décembre. Formation utilisateurs réalisée.' },
  ];

  for (const c of comments) {
    const exists = await prisma.projectComment.findFirst({
      where: { projectId: c.projectId, userId: c.userId, content: c.content },
    });
    if (!exists) {
      await prisma.projectComment.create({
        data: { ...c, createdAt: new Date(Date.now() - Math.random() * 7 * 86400000) },
      });
    }
  }
  console.log(`  ✓ ${comments.length} comments`);

  // ─── Activities ────────────────────────────────────────────────────────────
  const activities = [
    { projectId: ID.p1, userId: R.admin,   action: 'create',        detail: 'Projet créé' },
    { projectId: ID.p1, userId: R.admin,   action: 'assign',        detail: 'Chef de projet assigné : Luca Martin' },
    { projectId: ID.p1, userId: R.pm1,     action: 'status_change', detail: 'Statut → InProgress' },
    { projectId: ID.p2, userId: R.admin,   action: 'create',        detail: 'Projet créé' },
    { projectId: ID.p2, userId: R.pm1,     action: 'status_change', detail: 'Statut → SpecificationValidation' },
    { projectId: ID.p2, userId: R.spec1,   action: 'validate',      detail: 'Validation spécifications soumise' },
    { projectId: ID.p3, userId: R.admin,   action: 'create',        detail: 'Projet créé' },
    { projectId: ID.p3, userId: R.pm2,     action: 'status_change', detail: 'Statut → Realization' },
    { projectId: ID.p4, userId: R.admin,   action: 'create',        detail: 'Projet créé' },
    { projectId: ID.p4, userId: R.pm2,     action: 'status_change', detail: 'Statut → MEP' },
    { projectId: ID.p5, userId: R.pm1,     action: 'status_change', detail: 'Statut → Completed' },
    { projectId: ID.p6, userId: R.admin,   action: 'create',        detail: 'Projet créé' },
  ];

  for (const a of activities) {
    const exists = await prisma.projectActivity.findFirst({
      where: { projectId: a.projectId, action: a.action, detail: a.detail },
    });
    if (!exists) {
      await prisma.projectActivity.create({
        data: { ...a, createdAt: new Date(Date.now() - Math.random() * 14 * 86400000) },
      });
    }
  }
  console.log(`  ✓ ${activities.length} activities`);

  // ─── Analytics-compatible phase-transition activities ──────────────────────
  // These use the lowercase action 'status_change' and the detail format
  // "Statut changé: <from> → <to>" that analytics.service.ts parses.
  // Fixed timestamps give deterministic phase durations for the analytics queries.
  const analyticsActivities: Array<{ projectId: string; userId: string; action: string; detail: string; createdAt: Date }> = [
    // p1: Draft → InProgress (14 days in Draft), then InProgress → Realization (21 days)
    { projectId: ID.p1, userId: ID.admin, action: 'status_change', detail: 'Statut changé: Draft → InProgress',       createdAt: new Date('2026-01-15') },
    { projectId: ID.p1, userId: ID.pm1,   action: 'status_change', detail: 'Statut changé: InProgress → Realization', createdAt: new Date('2026-02-05') },
    // p2: Draft → InProgress (10 days), InProgress → SpecificationValidation (18 days)
    { projectId: ID.p2, userId: ID.admin, action: 'status_change', detail: 'Statut changé: Draft → InProgress',                  createdAt: new Date('2026-01-05') },
    { projectId: ID.p2, userId: ID.pm1,   action: 'status_change', detail: 'Statut changé: InProgress → SpecificationValidation', createdAt: new Date('2026-01-15') },
    // p3: Draft → InProgress (12 days), InProgress → Realization (30 days)
    { projectId: ID.p3, userId: ID.admin, action: 'status_change', detail: 'Statut changé: Draft → InProgress',       createdAt: new Date('2025-11-01') },
    { projectId: ID.p3, userId: ID.pm2,   action: 'status_change', detail: 'Statut changé: InProgress → Realization', createdAt: new Date('2025-11-13') },
    // p4: Draft → Kickoff (7 days), Kickoff → MEP (45 days)
    { projectId: ID.p4, userId: ID.admin, action: 'status_change', detail: 'Statut changé: Draft → Kickoff', createdAt: new Date('2025-12-01') },
    { projectId: ID.p4, userId: ID.pm2,   action: 'status_change', detail: 'Statut changé: Kickoff → MEP',   createdAt: new Date('2025-12-08') },
    // p5: Draft → InProgress (5 days), InProgress → Completed (60 days)
    { projectId: ID.p5, userId: ID.admin, action: 'status_change', detail: 'Statut changé: Draft → InProgress', createdAt: new Date('2025-07-01') },
    { projectId: ID.p5, userId: ID.pm1,   action: 'status_change', detail: 'Statut changé: InProgress → Completed', createdAt: new Date('2025-07-06') },
  ];
  for (const a of analyticsActivities) {
    const exists = await prisma.projectActivity.findFirst({
      where: { projectId: a.projectId, action: a.action, detail: a.detail },
    });
    if (!exists) {
      await prisma.projectActivity.create({ data: a });
    }
  }
  console.log(`  ✓ ${analyticsActivities.length} analytics phase-transition activities`);

  // ─── Validations ──────────────────────────────────────────────────────────
  const validations = [
    {
      projectId: ID.p2, validatedByUserId: ID.spec1,
      validatedByRole: 'SpecificationTeam', phase: 'Specification',
      isApproved: true, comment: 'Cahier des charges complet et cohérent. Approuvé.',
      validatedAt: new Date('2026-02-28'),
    },
    {
      projectId: ID.p4, validatedByUserId: ID.spec2,
      validatedByRole: 'SpecificationTeam', phase: 'Specification',
      isApproved: true, comment: 'Spécifications conformes aux exigences du ministère.',
      validatedAt: new Date('2026-01-15'),
    },
    {
      projectId: ID.p4, validatedByUserId: ID.real1,
      validatedByRole: 'Member', phase: 'Realization',
      isApproved: false, comment: 'Tests de charge insuffisants. Nécessite un cycle supplémentaire.',
      validatedAt: new Date('2026-03-01'),
    },
    {
      projectId: ID.p4, validatedByUserId: ID.deploy1,
      validatedByRole: 'Member', phase: 'Deployment',
      isApproved: true, comment: 'Infrastructure prête. Plan de rollback validé.',
      validatedAt: new Date('2026-03-20'),
    },
    {
      projectId: ID.p5, validatedByUserId: ID.spec1,
      validatedByRole: 'SpecificationTeam', phase: 'Specification',
      isApproved: true, comment: 'OK', validatedAt: new Date('2025-07-10'),
    },
    {
      projectId: ID.p5, validatedByUserId: ID.deploy1,
      validatedByRole: 'Member', phase: 'Deployment',
      isApproved: true, comment: 'Déploiement réussi, toutes les vérifications passées.',
      validatedAt: new Date('2025-12-15'),
    },
  ];

  for (const v of validations) {
    const exists = await prisma.projectValidation.findFirst({
      where: { projectId: v.projectId, validatedByUserId: v.validatedByUserId, phase: v.phase },
    });
    if (!exists) {
      await prisma.projectValidation.create({ data: v });
    }
  }
  console.log(`  ✓ ${validations.length} validations`);

  // ─── Notifications ────────────────────────────────────────────────────────
  const notifications = [
    { userId: R.pm1, type: 'validation_approved', title: 'Validation approuvée', message: 'Validation Specification approuvée pour "CHU de Bordeaux"', projectId: ID.p2, isRead: false },
    { userId: R.pm1, type: 'project_updated',     title: 'Projet mis à jour',   message: 'Le projet "Mairie de Lyon" a été modifié par l\'admin', projectId: ID.p1, isRead: false },
    { userId: R.pm2, type: 'validation_rejected', title: 'Validation rejetée',  message: 'Validation Realization rejetée pour "Ministère Finances"', projectId: ID.p4, isRead: true },
    { userId: R.pm2, type: 'validation_approved', title: 'Validation approuvée', message: 'Validation Deployment approuvée pour "Ministère Finances"', projectId: ID.p4, isRead: false },
    { userId: R.spec1, type: 'project_updated',   title: 'Nouveau projet',      message: 'Vous avez été ajouté au projet "Mairie de Lyon"', projectId: ID.p1, isRead: true },
    { userId: R.admin, type: 'validation_approved', title: 'Validation reçue',  message: 'Luca Martin a soumis une validation sur "CHU de Bordeaux"', projectId: ID.p2, isRead: false },
  ];

  for (const n of notifications) {
    const exists = await prisma.notification.findFirst({
      where: { userId: n.userId, type: n.type, projectId: n.projectId },
    });
    if (!exists) {
      await prisma.notification.create({
        data: { ...n, createdAt: new Date(Date.now() - Math.random() * 3 * 86400000) },
      });
    }
  }
  console.log(`  ✓ ${notifications.length} notifications`);

  // ─── Templates ────────────────────────────────────────────────────────────
  const templates = [
    {
      id: ID.tpl1,
      name: 'Modèle GED Standard',
      description: 'Champs de base pour tout projet de déploiement GED',
      createdByAdminId: R.admin,
      fields: [
        { label: 'Version Elise cible', type: 'Text',     isRequired: true,  displayOrder: 0 },
        { label: 'Nombre de postes',    type: 'Number',   isRequired: true,  displayOrder: 1 },
        { label: 'SSO actif',          type: 'Checkbox', isRequired: false, displayOrder: 2 },
        { label: 'Date recette',       type: 'Date',     isRequired: false, displayOrder: 3 },
        { label: 'Type connecteur',    type: 'Select',   isRequired: false, displayOrder: 4,
          options: JSON.stringify(['LDAP', 'SAML2', 'OAuth2', 'Aucun']) },
      ],
    },
    {
      id: ID.tpl2,
      name: 'Modèle Collectivité',
      description: 'Informations spécifiques aux collectivités territoriales',
      createdByAdminId: R.admin,
      fields: [
        { label: 'Strate de la collectivité', type: 'Select', isRequired: true,  displayOrder: 0,
          options: JSON.stringify(['Commune', 'Intercommunalité', 'Département', 'Région']) },
        { label: 'Population',               type: 'Number', isRequired: false, displayOrder: 1 },
        { label: 'Contact DSI',              type: 'Text',   isRequired: true,  displayOrder: 2 },
        { label: 'Contact élu référent',     type: 'Text',   isRequired: false, displayOrder: 3 },
        { label: 'Délibération validée',     type: 'Checkbox', isRequired: false, displayOrder: 4 },
      ],
    },
  ];

  for (const tpl of templates) {
    const existing = await prisma.projectTemplate.findUnique({ where: { id: tpl.id } });
    if (!existing) {
      const { fields, ...tplData } = tpl;
      const created = await prisma.projectTemplate.create({ data: tplData });
      for (const f of fields) {
        await prisma.projectTemplateField.create({ data: { templateId: created.id, ...f } });
      }
    }
  }
  console.log(`  ✓ ${templates.length} templates`);

  // ─── Audit Logs ───────────────────────────────────────────────────────────
  const auditLogs = [
    { entityType: 'Project', entityId: ID.p1, action: 'CREATE', userId: R.admin },
    { entityType: 'Project', entityId: ID.p2, action: 'CREATE', userId: R.admin },
    { entityType: 'Project', entityId: ID.p1, action: 'STATUS_CHANGE', userId: R.pm1,
      metadata: JSON.stringify({ from: 'Draft', to: 'InProgress' }) },
    { entityType: 'AppUser', entityId: R.pm1, action: 'LOGIN', userId: R.pm1 },
    { entityType: 'AppUser', entityId: R.pm2, action: 'LOGIN', userId: R.pm2 },
    { entityType: 'Project', entityId: ID.p4, action: 'VALIDATE', userId: R.deploy1 },
    { entityType: 'Project', entityId: ID.p5, action: 'STATUS_CHANGE', userId: R.pm1,
      metadata: JSON.stringify({ from: 'MEP', to: 'Cloture' }) },
  ];

  for (const log of auditLogs) {
    await prisma.auditLog.create({
      data: { ...log, createdAt: new Date(Date.now() - Math.random() * 10 * 86400000) },
    });
  }
  console.log(`  ✓ ${auditLogs.length} audit logs`);

  console.log('\n✅  Seed complete!\n');
  console.log('Quick-login accounts:');
  console.log('  Admin          admin@neoleadge.com     / Admin@123');
  console.log('  ProjectManager pm@neoleadge.com        / Pm@123');
  console.log('  ProjectManager pm2@neoleadge.com       / Pm@12345');
  console.log('  SpecTeam       spec@neoleadge.com      / Spec@123');
  console.log('  SpecTeam (2)   spec2@neoleadge.com     / Valid@123');
  console.log('  Member         realiz@neoleadge.com    / Realiz@123');
  console.log('  Member         deploy@neoleadge.com    / Deploy@123');
  console.log('  Member (2)     viewer@neoleadge.com    / Viewer@1');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
