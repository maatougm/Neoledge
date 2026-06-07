/* ============================================================================
 * FILE: cahier.demo.ts  —  Fixed "Rapido" cahier des charges (DEMO ONLY)
 * ============================================================================
 * EN — The exact 9-key cahier returned by the generation endpoints while
 *   DEMO_COPILOT_MODE=on. Lets any project (incl. one created live on camera)
 *   render a perfect, identical cahier with no AI call. Mirrors the content in
 *   prisma/seed-demo-rapido.mjs. See common/demo-mode.ts.
 *
 * FR — Le cahier exact (9 clés) renvoyé par les endpoints de génération quand
 *   DEMO_COPILOT_MODE=on. Permet à n'importe quel projet (même créé en direct)
 *   d'afficher un cahier parfait et identique sans appel IA.
 * ========================================================================== */

import type { CahierAiResult } from './cahier-des-charges.types.js'

export const RAPIDO_CAHIER: CahierAiResult = {
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
}
