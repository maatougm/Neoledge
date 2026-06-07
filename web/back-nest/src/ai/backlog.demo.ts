/* ============================================================================
 * FILE: backlog.demo.ts  —  Fixed "Rapido" AI backlog (DEMO ONLY)
 * ============================================================================
 * EN — The exact Epics + Tasks returned by BacklogService.preview() while
 *   DEMO_COPILOT_MODE=on, so any project (incl. one created live on camera)
 *   gets a perfect, identical backlog with no AI call. Shape = ProposedBacklog.
 *   Mirrors the backlog in prisma/seed-demo-rapido.mjs. See common/demo-mode.ts.
 *
 * FR — Les Epics + tâches exacts renvoyés par BacklogService.preview() quand
 *   DEMO_COPILOT_MODE=on, pour qu'un projet (même créé en direct) obtienne un
 *   backlog parfait et identique sans appel IA.
 * ========================================================================== */

import type { ProposedBacklog } from './backlog-generator.js';

export const RAPIDO_BACKLOG: ProposedBacklog = {
  epics: [
    {
      title: 'Authentification & gestion des utilisateurs',
      description: "Comptes, connexion sécurisée et gestion des rôles (administrateur, personnel).",
      priority: 'High',
      estimatedHours: 24,
      children: [
        { title: 'Modèle de données utilisateurs et rôles', description: 'Schéma des utilisateurs, rôles et permissions.', type: 'Task', priority: 'High', estimatedHours: 8 },
        { title: 'Écran de connexion et inscription', description: 'Interface de connexion / création de compte.', type: 'Task', priority: 'Normal', estimatedHours: 10 },
        { title: 'Gestion des rôles et permissions', description: 'Attribution des droits par rôle.', type: 'Task', priority: 'Normal', estimatedHours: 6 },
      ],
    },
    {
      title: 'Gestion des commandes',
      description: "Prise et suivi des commandes en temps réel.",
      priority: 'High',
      estimatedHours: 40,
      children: [
        { title: 'API commandes (CRUD et états)', description: 'Endpoints REST de création, mise à jour et états de commande.', type: 'Feature', priority: 'High', estimatedHours: 16 },
        { title: 'Écran de prise de commande', description: 'Interface de saisie et modification des commandes.', type: 'Task', priority: 'Normal', estimatedHours: 14 },
        { title: 'Suivi des états de commande en temps réel', description: 'Affichage live des états (en préparation, prête, servie).', type: 'Task', priority: 'Normal', estimatedHours: 10 },
      ],
    },
    {
      title: 'Gestion des réservations',
      description: "Réservation de tables et gestion de la disponibilité.",
      priority: 'High',
      estimatedHours: 28,
      children: [
        { title: 'API réservations', description: 'Endpoints de création, annulation et consultation des réservations.', type: 'Feature', priority: 'High', estimatedHours: 14 },
        { title: 'Écran de réservation de tables', description: 'Interface de réservation et visualisation des créneaux.', type: 'Task', priority: 'Normal', estimatedHours: 14 },
      ],
    },
    {
      title: 'Gestion des menus et des plats',
      description: "Administration du catalogue de plats et de menus.",
      priority: 'Normal',
      estimatedHours: 24,
      children: [
        { title: 'CRUD des plats et des menus', description: 'Ajout, modification et retrait des plats et menus.', type: 'Task', priority: 'Normal', estimatedHours: 14 },
        { title: 'Catégories et disponibilité par plat', description: 'Organisation par catégories et indication de disponibilité.', type: 'Task', priority: 'Normal', estimatedHours: 10 },
      ],
    },
    {
      title: 'Suivi des disponibilités et des stocks',
      description: "Mise à jour en temps réel de la disponibilité des plats et des stocks.",
      priority: 'Normal',
      estimatedHours: 26,
      children: [
        { title: 'Décrément automatique des stocks', description: 'Décompte des stocks au fil des commandes.', type: 'Task', priority: 'Normal', estimatedHours: 14 },
        { title: 'Alertes de rupture et tableau de stocks', description: "Alertes d'indisponibilité et vue de suivi des stocks.", type: 'Task', priority: 'Normal', estimatedHours: 12 },
      ],
    },
    {
      title: 'Tableau de bord administrateur',
      description: "Espace d'administration pour piloter l'activité du restaurant.",
      priority: 'Normal',
      estimatedHours: 22,
      children: [
        { title: "Vue d'ensemble de l'activité", description: "Indicateurs et synthèse de l'activité.", type: 'Task', priority: 'Normal', estimatedHours: 12 },
        { title: 'Gestion centralisée (utilisateurs, menus, commandes)', description: "Pilotage centralisé des entités du restaurant.", type: 'Task', priority: 'Normal', estimatedHours: 10 },
      ],
    },
  ],
};
