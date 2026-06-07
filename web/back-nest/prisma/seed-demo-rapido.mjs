/**
 * @file prisma/seed-demo-rapido.mjs
 * @desc DEMO seed — fully-populated "Rapido" restaurant-platform project for the
 *       demo video. NON-DESTRUCTIVE: it only (re)creates the single Rapido
 *       project + ensures the demo users exist. Every other project is left
 *       untouched. Idempotent — re-run it freely between takes; it deletes the
 *       Rapido project (cascade) and recreates it from scratch each run.
 *
 *       Plain ESM (.mjs) on purpose: the production server image runs
 *       `npm prune --omit=dev`, so `tsx` is NOT available — but `node`,
 *       `@prisma/client`, `@prisma/adapter-pg` and `bcryptjs` ARE. So this runs
 *       with plain `node` inside the deployed container:
 *
 *         docker compose -f docker-compose.prod.yml exec server \
 *           node prisma/seed-demo-rapido.mjs
 *
 *       Locally (Postgres dev DB):  node prisma/seed-demo-rapido.mjs
 *
 *       The fixed RAPIDO_PROJECT_ID below MUST match
 *       src/meetings/live-copilot.demo.ts (RAPIDO_DEMO_PROJECT_ID) so the
 *       deterministic copilot demo-mode activates for this project.
 */

import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const HASH = (p) => bcrypt.hashSync(p, 10);

// ── Fixed ids ────────────────────────────────────────────────────────────────
// Keep in sync with src/meetings/live-copilot.demo.ts (RAPIDO_DEMO_PROJECT_ID).
const RAPIDO_PROJECT_ID = 'f00d0000-0000-4000-8000-000000000001';
const TRANSCRIPT_ID = 'f00d0000-0000-4000-8000-000000000010';
const BOARD_ID = 'f00d0000-0000-4000-8000-000000000020';
const SPRINT_ID = 'f00d0000-0000-4000-8000-000000000021';

const AI_TAG = 'questionnaire+cahier+meeting';
const AI_MODEL = 'glm-4.5-air';

// Stable demo dates (project runs juin → août 2026, per the brief).
const START_DATE = new Date('2026-06-01T00:00:00.000Z');
const END_DATE = new Date('2026-08-31T00:00:00.000Z');
const MEETING_DATE = new Date('2026-06-04T14:00:00.000Z');
const CAHIER_SAVED_AT = '2026-06-05T10:00:00.000Z';
const CAHIER_APPROVED_AT = new Date('2026-06-05T11:00:00.000Z');

// ── PrismaClient (Postgres adapter — same as prisma/seed-client.ts) ───────────
function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL env var is not set');
  if (!url.startsWith('postgres')) {
    throw new Error('DATABASE_URL must use postgres:// — the project is Postgres-only.');
  }
  const adapter = new PrismaPg({ connectionString: url });
  return new PrismaClient({ adapter });
}

const prisma = createClient();

// ── Users (ensured, never deleted) ───────────────────────────────────────────
const USERS = [
  { firstName: 'Sophie',  lastName: 'Dubois', email: 'admin@neoleadge.com',  pass: 'Admin@123', role: 'Admin',             jobTitle: 'Administratrice système', department: 'Direction IT' },
  { firstName: 'Luca',    lastName: 'Martin', email: 'pm@neoleadge.com',     pass: 'Pm@123',    role: 'ProjectManager',    jobTitle: 'Chef de projet senior',   department: 'Direction Projets' },
  { firstName: 'Julien',  lastName: 'Morel',  email: 'spec@neoleadge.com',   pass: 'Spec@123',  role: 'SpecificationTeam',  jobTitle: 'Analyste fonctionnel',    department: 'Études & Specs' },
  { firstName: 'Antoine', lastName: 'Petit',  email: 'antoine@neoleadge.com', pass: 'Dev@123',  role: 'Member',             jobTitle: 'Développeur fullstack',   department: 'Réalisation' },
  { firstName: 'Karim',   lastName: 'Haddad', email: 'karim@neoleadge.com',  pass: 'Dev@123',   role: 'Member',             jobTitle: 'Développeur backend',     department: 'Réalisation' },
  { firstName: 'Léa',     lastName: 'Roux',   email: 'lea@neoleadge.com',    pass: 'Qa@123',    role: 'Member',             jobTitle: 'Ingénieure QA',           department: 'Qualité' },
];

// ── Questionnaire (mirrors the client brief; drivers feed the AI backlog) ─────
const FIELDS = [
  { label: 'Nom du client',                              fieldType: 'Text',   value: 'Rapido' },
  { label: 'Date de début',                              fieldType: 'Date',   value: '2026-06-01' },
  { label: 'Date de fin',                                fieldType: 'Date',   value: '2026-08-31' },
  {
    label: 'Contexte et problématique',
    fieldType: 'Text',
    value:
      "Le restaurant rencontre des difficultés dans la gestion quotidienne des commandes, des réservations et du suivi des plats disponibles. Les méthodes manuelles actuelles entraînent des erreurs, des retards de traitement et une mauvaise organisation pendant les périodes de forte activité. Le projet vise à digitaliser ces processus afin d'améliorer l'efficacité opérationnelle et l'expérience client.",
  },
  {
    label: 'Objectif du projet et résultats attendus',
    fieldType: 'Text',
    driver: true,
    hint: 'Objectif et résultats attendus du projet',
    value:
      "Développer une plateforme intelligente centralisant les opérations du restaurant.\nRésultats attendus :\n- Meilleure gestion des commandes et des réservations\n- Réduction des erreurs humaines\n- Amélioration de la rapidité du service\n- Suivi en temps réel des plats et des stocks\n- Interface simple et intuitive pour les utilisateurs",
  },
  {
    label: 'Périmètre fonctionnel (modules à développer)',
    fieldType: 'Text',
    driver: true,
    hint: 'Modules fonctionnels à livrer',
    value:
      "- Gestion des utilisateurs et authentification\n- Gestion des commandes\n- Gestion des réservations\n- Gestion des menus et plats\n- Suivi des disponibilités et des stocks\n- Tableau de bord administrateur\n- Notifications et états des commandes",
  },
  {
    label: 'Stack technique proposée',
    fieldType: 'Text',
    driver: true,
    hint: 'Front-end, back-end, base de données',
    value:
      "Front-end : React JS\nBack-end : Node.js / Express.js\nBase de données : MySQL\nAPI REST entre les modules\nGit/GitHub pour le versioning",
  },
  {
    label: 'Livrables attendus',
    fieldType: 'Text',
    value:
      "- Cahier des charges fonctionnel\n- Conception UML et base de données\n- Application web fonctionnelle\n- Code source documenté\n- Rapport technique du projet\n- Présentation de soutenance",
  },
  {
    label: 'Périmètre exclus',
    fieldType: 'Text',
    value:
      "- Développement d'une application mobile native\n- Intégration d'un système de paiement en ligne\n- Gestion de livraison externe\n- Hébergement cloud avancé",
  },
  { label: 'Priorité', fieldType: 'Select', value: 'Haute', options: ['Haute', 'Moyenne', 'Basse'] },
];

// ── Cahier des charges (9 keys; arrays for the two structured sections) ───────
const CAHIER_CONTENT = {
  objectifDocument:
    "Le présent cahier des charges définit les besoins fonctionnels et techniques du projet « Plateforme intelligente de gestion de restaurant » pour le client Rapido. Il sert de référence contractuelle entre Rapido et l'équipe projet pour le développement, la validation et la livraison de la solution.",
  contexte:
    "Le restaurant Rapido gère aujourd'hui ses commandes, ses réservations et le suivi de ses plats à l'aide de méthodes manuelles. Ces pratiques génèrent des erreurs, des retards de traitement et une organisation difficile pendant les périodes de forte activité. Le projet vise à digitaliser et centraliser ces processus afin d'améliorer l'efficacité opérationnelle et l'expérience client.",
  objectifProjet:
    "Développer une plateforme web intelligente centralisant les opérations du restaurant.\n\n- Centraliser la gestion des commandes et des réservations\n- Réduire les erreurs humaines liées aux processus manuels\n- Améliorer la rapidité et la qualité du service\n- Assurer un suivi en temps réel des plats et des stocks\n- Offrir une interface simple et intuitive aux utilisateurs",
  perimetreInclus:
    "- Gestion des utilisateurs et authentification\n- Gestion des commandes (création, suivi, états)\n- Gestion des réservations\n- Gestion des menus et des plats\n- Suivi des disponibilités et des stocks en temps réel\n- Tableau de bord administrateur\n- Notifications et changements d'état des commandes",
  perimetreExclus:
    "- Développement d'une application mobile native\n- Intégration d'un système de paiement en ligne\n- Gestion de la livraison externe\n- Hébergement cloud avancé",
  exigencesFonctionnelles: [
    {
      title: 'Gestion des utilisateurs et authentification',
      content:
        "Création de comptes, connexion sécurisée et gestion des rôles (administrateur, personnel).\n- Authentification par identifiant et mot de passe\n- Rôles et permissions différenciés\n- Gestion du profil utilisateur",
    },
    {
      title: 'Gestion des commandes',
      content:
        "Prise et suivi des commandes du restaurant en temps réel.\n- Création et modification d'une commande\n- Suivi des états (en préparation, prête, servie)\n- Historique des commandes",
    },
    {
      title: 'Gestion des réservations',
      content:
        "Réservation de tables et gestion de la disponibilité.\n- Création et annulation de réservations\n- Visualisation des créneaux disponibles\n- Confirmation au client",
    },
    {
      title: 'Gestion des menus et des plats',
      content:
        "Administration du catalogue de plats et des menus.\n- Ajout, modification et retrait d'un plat\n- Organisation par menus et catégories\n- Indication de disponibilité par plat",
    },
    {
      title: 'Suivi des disponibilités et des stocks',
      content:
        "Mise à jour en temps réel de la disponibilité des plats et des stocks.\n- Décrément automatique selon les commandes\n- Alerte de rupture ou d'indisponibilité\n- Tableau de suivi des stocks",
    },
    {
      title: 'Tableau de bord administrateur',
      content:
        "Espace d'administration pour piloter l'activité du restaurant.\n- Gestion des utilisateurs et des menus\n- Consultation des commandes et des réservations\n- Indicateurs d'activité",
    },
  ],
  architectureTechnique: [
    {
      title: 'Front-end',
      content:
        "Application web développée avec React JS.\n- Interface responsive et intuitive\n- Communication avec le back-end via API REST",
    },
    {
      title: 'Back-end',
      content:
        "API REST développée avec Node.js et Express.js.\n- Logique métier et règles de gestion\n- Endpoints REST sécurisés",
    },
    {
      title: 'Base de données',
      content:
        "Persistance des données avec MySQL.\n- Modèle relationnel (utilisateurs, commandes, réservations, menus, stocks)\n- Requêtes optimisées pour le suivi en temps réel",
    },
    {
      title: 'Gestion de versions',
      content:
        "Versioning du code source avec Git / GitHub.\n- Suivi des évolutions et collaboration\n- Historique et revue de code",
    },
  ],
  livrables:
    "- Cahier des charges fonctionnel\n- Conception UML et schéma de base de données\n- Application web fonctionnelle\n- Code source documenté\n- Rapport technique du projet\n- Présentation de soutenance",
  conclusion:
    "La plateforme intelligente de gestion de restaurant permettra à Rapido de digitaliser et de centraliser ses opérations quotidiennes — commandes, réservations, menus et stocks — afin de réduire les erreurs, d'accélérer le service et d'améliorer l'expérience client. La solution sera développée avec une stack React, Node.js / Express et MySQL, livrée avec sa documentation et sa présentation de soutenance, dans le périmètre validé avec le client.",
};

// ── Meeting transcript (the reunion script, segmented by speaker) ─────────────
const DIALOGUE = [
  ['Client', "Bonjour, merci d'être venue. Nous souhaitons développer une solution pour améliorer la gestion de notre restaurant."],
  ['Chef de projet', "Bonjour, merci pour votre accueil. Pouvez-vous m'expliquer les principaux problèmes que vous rencontrez actuellement ?"],
  ['Client', "Nous utilisons encore plusieurs méthodes manuelles pour gérer les commandes et les réservations. Cela provoque souvent des erreurs et des retards, surtout pendant les heures de forte activité."],
  ['Chef de projet', "Je comprends. Est-ce que vous avez également des difficultés concernant le suivi des plats ou des stocks ?"],
  ['Client', "Oui exactement. Parfois certains plats ne sont plus disponibles mais l'information n'est pas mise à jour rapidement."],
  ['Chef de projet', "D'accord. Notre idée serait de développer une plateforme web centralisée qui permettra de gérer les commandes, les réservations, les menus et le suivi des disponibilités en temps réel."],
  ['Client', "Cela correspond bien à nos besoins. Est-ce qu'il sera possible d'avoir un espace administrateur ?"],
  ['Chef de projet', "Bien sûr. L'administrateur pourra gérer les utilisateurs, consulter les commandes, modifier les menus et suivre l'activité du restaurant à travers un tableau de bord."],
  ['Client', "Très bien. Quelles technologies comptez-vous utiliser pour le développement ?"],
  ['Chef de projet', "Nous proposons React JS pour le front-end, Node.js avec Express pour le back-end et MySQL pour la base de données."],
  ['Client', "Parfait. Et concernant les délais ?"],
  ['Chef de projet', "Le projet pourra être réalisé sur une période de quatre mois avec des réunions de suivi régulières afin de valider chaque étape."],
  ['Client', "Excellent. Nous validons donc le lancement du projet."],
  ['Chef de projet', "Merci pour votre confiance. Nous allons commencer par l'analyse détaillée des besoins et la préparation du cahier des charges."],
];

const MEETING_SUMMARY =
  "Réunion de cadrage avec le client Rapido pour une plateforme de gestion de restaurant. " +
  "Le client souffre de processus manuels (commandes, réservations, suivi des plats) générant des erreurs et des retards en période de forte activité. " +
  "La solution retenue est une plateforme web centralisée couvrant la gestion des commandes, des réservations, des menus et le suivi des disponibilités en temps réel, avec un espace administrateur. " +
  "Stack validée : React JS (front-end), Node.js / Express (back-end), MySQL (base de données). " +
  "Délai d'environ quatre mois avec des réunions de suivi régulières. Le lancement du projet est validé.";

const ACTION_ITEMS = [
  { description: "Rédiger le cahier des charges fonctionnel", assigneeName: 'Luca Martin', dueOffsetDays: 2 },
  { description: "Planifier les réunions de suivi régulières", assigneeName: 'Luca Martin', dueOffsetDays: 4 },
  { description: "Préparer la conception UML et le schéma de base de données", assigneeName: 'Karim Haddad', dueOffsetDays: 8 },
];

const DECISIONS = [
  { category: 'decision', description: "Développer une plateforme web centralisée (commandes, réservations, menus, suivi en temps réel)." },
  { category: 'decision', description: "Stack technique retenue : React JS (front-end), Node.js / Express (back-end), MySQL (base de données)." },
  { category: 'decision', description: "Périmètre validé. Hors périmètre : application mobile native, paiement en ligne, livraison externe, hébergement cloud avancé." },
  { category: 'risk', description: "Forte charge aux heures de pointe — prévoir un suivi des disponibilités performant et en temps réel." },
];

// ── Backlog (Epics + child Tasks). memberKey → assignee email. ────────────────
const BACKLOG = [
  {
    title: 'Authentification & gestion des utilisateurs', status: 'Closed', pct: 100, est: 24, assignee: 'antoine@neoleadge.com',
    children: [
      { title: 'Modèle de données utilisateurs et rôles', type: 'Task', status: 'Closed', pct: 100, est: 8, assignee: 'karim@neoleadge.com' },
      { title: 'Écran de connexion et inscription', type: 'Task', status: 'Closed', pct: 100, est: 10, assignee: 'antoine@neoleadge.com' },
      { title: 'Gestion des rôles et permissions', type: 'Task', status: 'Resolved', pct: 90, est: 6, assignee: 'antoine@neoleadge.com' },
    ],
  },
  {
    title: 'Gestion des commandes', status: 'InProgress', pct: 60, est: 40, assignee: 'karim@neoleadge.com',
    children: [
      { title: 'API commandes (CRUD et états)', type: 'Feature', status: 'InProgress', pct: 70, est: 16, assignee: 'karim@neoleadge.com' },
      { title: 'Écran de prise de commande', type: 'Task', status: 'InProgress', pct: 50, est: 14, assignee: 'antoine@neoleadge.com' },
      { title: 'Suivi des états de commande en temps réel', type: 'Task', status: 'New', pct: 0, est: 10, assignee: 'karim@neoleadge.com' },
    ],
  },
  {
    title: 'Gestion des réservations', status: 'InProgress', pct: 35, est: 28, assignee: 'antoine@neoleadge.com',
    children: [
      { title: 'API réservations', type: 'Feature', status: 'InProgress', pct: 50, est: 14, assignee: 'karim@neoleadge.com' },
      { title: 'Écran de réservation de tables', type: 'Task', status: 'New', pct: 0, est: 14, assignee: 'antoine@neoleadge.com' },
    ],
  },
  {
    title: 'Gestion des menus et des plats', status: 'New', pct: 0, est: 24, assignee: 'antoine@neoleadge.com',
    children: [
      { title: 'CRUD des plats et des menus', type: 'Task', status: 'New', pct: 0, est: 14, assignee: 'antoine@neoleadge.com' },
      { title: 'Catégories et disponibilité par plat', type: 'Task', status: 'New', pct: 0, est: 10, assignee: 'karim@neoleadge.com' },
    ],
  },
  {
    title: 'Suivi des disponibilités et des stocks', status: 'New', pct: 0, est: 26, assignee: 'karim@neoleadge.com',
    children: [
      { title: 'Décrément automatique des stocks', type: 'Task', status: 'New', pct: 0, est: 14, assignee: 'karim@neoleadge.com' },
      { title: 'Alertes de rupture et tableau de stocks', type: 'Task', status: 'New', pct: 0, est: 12, assignee: 'lea@neoleadge.com' },
    ],
  },
  {
    title: 'Tableau de bord administrateur', status: 'New', pct: 0, est: 22, assignee: 'antoine@neoleadge.com',
    children: [
      { title: "Vue d'ensemble de l'activité", type: 'Task', status: 'New', pct: 0, est: 12, assignee: 'antoine@neoleadge.com' },
      { title: 'Gestion centralisée (utilisateurs, menus, commandes)', type: 'Task', status: 'New', pct: 0, est: 10, assignee: 'antoine@neoleadge.com' },
    ],
  },
];

// Members of the project + their displayed labels.
const MEMBERS = [
  { email: 'antoine@neoleadge.com', label: 'Développeur fullstack' },
  { email: 'karim@neoleadge.com',  label: 'Développeur backend' },
  { email: 'lea@neoleadge.com',    label: 'Ingénieure QA' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const addDays = (base, n) => {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
};

async function main() {
  console.log('🍽️  Seeding Rapido demo project…\n');

  // 1. Ensure users (upsert by email — never deletes existing users).
  for (const u of USERS) {
    await prisma.appUser.upsert({
      where: { email: u.email },
      update: { isActive: true, role: u.role },
      create: {
        firstName: u.firstName, lastName: u.lastName, email: u.email,
        passwordHash: HASH(u.pass), role: u.role,
        jobTitle: u.jobTitle, department: u.department, isActive: true,
      },
    });
  }
  const dbUsers = await prisma.appUser.findMany({
    where: { email: { in: USERS.map((u) => u.email) } },
    select: { id: true, email: true },
  });
  const userId = Object.fromEntries(dbUsers.map((u) => [u.email, u.id]));
  const admin = userId['admin@neoleadge.com'];
  const pm = userId['pm@neoleadge.com'];
  const spec = userId['spec@neoleadge.com'];
  console.log(`  ✓ ${USERS.length} users ensured`);

  // 2. Idempotency — wipe any previous Rapido project (cascade removes fields,
  //    members, transcript+segments+actions+decisions, cahier feedback,
  //    validations, board+columns+sprint, work packages, activities).
  await prisma.project.deleteMany({ where: { id: RAPIDO_PROJECT_ID } });

  // 3. Project (with the saved cahier in aiOutput).
  await prisma.project.create({
    data: {
      id: RAPIDO_PROJECT_ID,
      name: 'Plateforme intelligente de gestion de restaurant',
      clientName: 'Rapido',
      status: 'Realisation',
      priority: 'High',
      projectManagerId: pm,
      createdByAdminId: admin,
      startDate: START_DATE,
      endDate: END_DATE,
      tags: 'restaurant,web,react,node,mysql',
      currentPhaseEnteredAt: MEETING_DATE,
      isDeleted: false,
      aiOutput: JSON.stringify({ aiContent: CAHIER_CONTENT, savedAt: CAHIER_SAVED_AT }),
    },
  });
  console.log('  ✓ project created (status=Realisation, +cahier)');

  // 4. Members.
  await prisma.projectMember.createMany({
    data: MEMBERS.map((m) => ({ projectId: RAPIDO_PROJECT_ID, userId: userId[m.email], label: m.label })),
  });
  console.log(`  ✓ ${MEMBERS.length} members`);

  // 5. Questionnaire fields + values.
  for (const [i, f] of FIELDS.entries()) {
    const field = await prisma.projectField.create({
      data: {
        projectId: RAPIDO_PROJECT_ID,
        label: f.label,
        fieldType: f.fieldType,
        isRequired: i < 4,
        orderIndex: i,
        fieldCategory: 'Static',
        isBacklogDriver: f.driver ?? false,
        backlogHint: f.hint ?? null,
        options: f.options ? JSON.stringify(f.options) : null,
      },
    });
    await prisma.projectFieldValue.create({
      data: { projectId: RAPIDO_PROJECT_ID, projectFieldId: field.id, value: f.value },
    });
  }
  console.log(`  ✓ ${FIELDS.length} questionnaire fields (3 backlog drivers, all answered)`);

  // 6. Meeting transcript + segments + action items + decisions.
  await prisma.meetingTranscript.create({
    data: {
      id: TRANSCRIPT_ID,
      projectId: RAPIDO_PROJECT_ID,
      title: 'Réunion de cadrage — Rapido',
      durationSeconds: 480,
      detectedLanguages: 'fr',
      recordedAt: MEETING_DATE,
      aiSummary: MEETING_SUMMARY,
      aiStatus: 'completed',
      aiStartedAt: MEETING_DATE,
      aiProcessedAt: addDays(MEETING_DATE, 0),
      aiModel: AI_MODEL,
      meetingType: 'cadrage',
    },
  });
  await prisma.transcriptSegment.createMany({
    data: DIALOGUE.map(([speaker, text], idx) => ({
      transcriptId: TRANSCRIPT_ID,
      speaker,
      text,
      startTime: idx * 25,
      endTime: idx * 25 + 22,
      language: 'fr',
      confidence: 0.96,
    })),
  });
  await prisma.meetingActionItem.createMany({
    data: ACTION_ITEMS.map((a) => ({
      transcriptId: TRANSCRIPT_ID,
      description: a.description,
      assigneeName: a.assigneeName,
      dueDate: addDays(MEETING_DATE, a.dueOffsetDays),
      isCompleted: false,
    })),
  });
  await prisma.meetingDecision.createMany({
    data: DECISIONS.map((d) => ({ transcriptId: TRANSCRIPT_ID, description: d.description, category: d.category })),
  });
  console.log(`  ✓ meeting transcript (${DIALOGUE.length} segments, ${ACTION_ITEMS.length} actions, ${DECISIONS.length} decisions)`);

  // 7. Cahier validation — approved by the SpecificationTeam (Julien).
  await prisma.cahierFeedback.create({
    data: {
      id: randomUUID(),
      projectId: RAPIDO_PROJECT_ID,
      userId: spec,
      status: 'approved',
      comment: 'Cahier des charges complet et conforme au besoin exprimé par Rapido. Validé.',
      section: null,
      aiModel: AI_MODEL,
      createdAt: CAHIER_APPROVED_AT,
    },
  });
  await prisma.projectValidation.create({
    data: {
      projectId: RAPIDO_PROJECT_ID,
      validatedByUserId: spec,
      validatedByRole: 'SpecificationTeam',
      phase: 'Specification',
      isApproved: true,
      comment: 'Spécifications validées et conformes au besoin client.',
      validatedAt: CAHIER_APPROVED_AT,
    },
  });
  console.log('  ✓ cahier approved (CahierFeedback + ProjectValidation)');

  // 8. Board + columns + sprint.
  await prisma.board.create({
    data: {
      id: BOARD_ID,
      projectId: RAPIDO_PROJECT_ID,
      name: 'Tableau principal',
      type: 'Kanban',
      isDefault: true,
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
  const columns = await prisma.boardColumn.findMany({ where: { boardId: BOARD_ID } });
  const colByStatus = new Map(columns.map((c) => [c.mapStatus ?? '', c.id]));
  await prisma.sprint.create({
    data: {
      id: SPRINT_ID,
      boardId: BOARD_ID,
      name: 'Sprint 1',
      goal: 'Socle technique + authentification + commandes',
      startDate: addDays(MEETING_DATE, 3),
      endDate: addDays(MEETING_DATE, 17),
      status: 'Active',
    },
  });
  console.log('  ✓ board (4 columns) + active sprint');

  // 9. Backlog — Epics + child Tasks, assigned to members, AI-tagged.
  let wpCount = 0;
  let position = 0;
  for (const epic of BACKLOG) {
    const epicId = randomUUID();
    await prisma.workPackage.create({
      data: {
        id: epicId,
        projectId: RAPIDO_PROJECT_ID,
        title: epic.title,
        type: 'Epic',
        status: epic.status,
        priority: 'High',
        assigneeId: userId[epic.assignee] ?? null,
        authorId: pm,
        estimatedHours: epic.est,
        percentDone: epic.pct,
        position: position++,
        boardColumnId: colByStatus.get(epic.status) ?? null,
        sprintId: epic.status === 'InProgress' || epic.status === 'New' ? SPRINT_ID : null,
        startDate: START_DATE,
        aiGeneratedFrom: AI_TAG,
        isDeleted: false,
      },
    });
    wpCount++;
    for (const task of epic.children) {
      await prisma.workPackage.create({
        data: {
          id: randomUUID(),
          projectId: RAPIDO_PROJECT_ID,
          parentId: epicId,
          title: task.title,
          type: task.type,
          status: task.status,
          priority: 'Normal',
          assigneeId: userId[task.assignee] ?? null,
          authorId: pm,
          estimatedHours: task.est,
          percentDone: task.pct,
          position: position++,
          boardColumnId: colByStatus.get(task.status) ?? null,
          sprintId: task.status === 'InProgress' || task.status === 'New' ? SPRINT_ID : null,
          aiGeneratedFrom: AI_TAG,
          isDeleted: false,
        },
      });
      wpCount++;
    }
  }
  console.log(`  ✓ backlog: ${BACKLOG.length} epics + ${wpCount - BACKLOG.length} tasks = ${wpCount} work packages`);

  // 10. Activity feed.
  const activities = [
    { action: 'create', detail: 'Projet créé', userId: admin, at: MEETING_DATE },
    { action: 'assign', detail: 'Chef de projet assigné : Luca Martin', userId: admin, at: MEETING_DATE },
    { action: 'cahier_generated', detail: "Cahier des charges généré par l'IA", userId: pm, at: new Date(CAHIER_SAVED_AT) },
    { action: 'cahier_approved', detail: 'Cahier des charges approuvé par l\'équipe de spécification', userId: spec, at: CAHIER_APPROVED_AT },
    { action: 'backlog_accepted', detail: `Backlog IA accepté (${BACKLOG.length} epics, ${wpCount} éléments)`, userId: pm, at: addDays(CAHIER_APPROVED_AT, 0) },
    { action: 'status_change', detail: 'Statut changé: Kickoff → Realisation', userId: pm, at: addDays(CAHIER_APPROVED_AT, 1) },
  ];
  await prisma.projectActivity.createMany({
    data: activities.map((a) => ({ projectId: RAPIDO_PROJECT_ID, userId: a.userId, action: a.action, detail: a.detail, createdAt: a.at })),
  });
  console.log(`  ✓ ${activities.length} activity rows`);

  console.log('\n✅  Rapido demo project ready.');
  console.log(`   Project id : ${RAPIDO_PROJECT_ID}`);
  console.log('   Open as PM : pm@neoleadge.com / Pm@123');
  console.log('   Spec login : spec@neoleadge.com / Spec@123  (cahier already approved)');
  console.log('   Reminder   : set DEMO_COPILOT_MODE=on and LIVE_MEETING_COPILOT=on for the live copilot demo.\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
