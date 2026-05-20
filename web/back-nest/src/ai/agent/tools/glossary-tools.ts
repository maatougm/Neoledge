/**
 * @file glossary-tools.ts — domain glossary lookup tool.
 * The agent uses this to ground unfamiliar terms in NeoLedge / Elise
 * vocabulary instead of hallucinating definitions.
 *
 * Glossary is inlined as a TS const rather than loaded from JSON at
 * runtime — the entries are small, stable, and we don't need an extra
 * fs read every loop iteration.
 */

import type { ToolDefinition } from '../agent-types.js'
import { obj, str } from '../json-schema.js'

const GLOSSARY: Record<string, string> = {
  'elise':              "Plateforme NeoLedge Elise — solution de gestion de projets / GED conçue pour les administrations et grandes entreprises. Inclut Elise.Automate (workflows métier en C# / .NET Core).",
  'elise.automate':     "Moteur d'automatisation métier de NeoLedge Elise. Stack : C# / .NET Core Web API. Exécute des workflows déclaratifs (validations, routages, notifications) sur des dossiers Elise.",
  'ged':                'Gestion Électronique de Documents. Système d\'archivage, classement, indexation et workflow de validation des documents d\'entreprise. Cœur métier de NeoLedge Elise.',
  'neoform':            'Bibliothèque de formulaires NeoLedge fondée sur Vue 3 + PrimeVue. Permet de générer des écrans dynamiques pilotés par schéma JSON. Brique frontale standard des projets Elise.',
  'neoleadge':          "Plateforme de gestion de projets IT que vous (l'agent) êtes en train d'aider à construire. Vue 3 + NestJS + PostgreSQL. Cible : administrations / grandes structures.",
  'cahier des charges': "Document contractuel décrivant le périmètre fonctionnel et technique d'un projet. Pour NeoLeadge, structure standard à 9 sections : objectifDocument, contexte, objectifProjet, perimetreInclus, perimetreExclus, exigencesFonctionnelles, architectureTechnique, livrables, conclusion.",
  'questionnaire':      "Formulaire pré-projet rempli par le chef de projet (PM). Champs `isBacklogDriver=true` alimentent l'IA pour la génération de backlog.",
  'backlog driver':     "Champ du questionnaire marqué `isBacklogDriver=true`. Sa réponse est utilisée comme contexte primaire par l'IA pour proposer des epics et tâches.",
  'epic':               "Regroupement fonctionnel d'envergure dans le backlog. Contient 2 à 8 tâches concrètes. Priorité : Low / Normal / High / Critical. Estimation 8 à 200h.",
  'task':               "Unité de travail concrète et implémentable (1 à 80h). Type : Task / Feature / Bug. Doit être livrable indépendamment.",
  'specification team': "Équipe (rôle SpecificationTeam) chargée de valider le cahier des charges. Le PM ne peut PAS valider son propre cahier (blocage serveur).",
  'deployment team':    "Équipe (rôle DeploymentTeam) qui prend le projet en charge une fois la phase de cadrage validée. Reçoit les tâches via l'écran Assignation.",
  'kickoff':            "Première phase du projet (status='Kickoff'). Cadrage initial, livrable principal : cahier des charges approuvé.",
  'cadrage technique':  "Phase suivant Kickoff (status='CadrageTechnique'). Livrables : architecture cible, choix de stack, plan de développement.",
  'phase':              'Étape du cycle de vie projet. Ordre : Draft → Kickoff → CadrageTechnique → Realization → Integration → UAT → Deployment → MaintenanceTransfer → Closure / Archived.',
  'project member':     'Utilisateur ajouté à un projet via l\'écran Membres. Étiquette libre (`label`). Sources d\'autorisation : ProjectMember row OU être PM du projet OU être Admin.',
  'feedback':           'Retour de la SpecificationTeam sur un cahier des charges (table CahierFeedback). Statut : approved / rejected. Re-sauvegarder le cahier réinitialise la file de validation.',
}

export const readGlossaryTool: ToolDefinition<{ term?: string }, { term: string; definition: string | null }> = {
  name: 'read_glossary',
  description: "Look up a NeoLedge / Elise / project-management term in the curated glossary. Use this BEFORE inventing a definition for any term you're not 100% sure about.",
  parameters: obj(
    { term: str({ description: 'The term to look up. Case-insensitive. Examples: "Elise", "GED", "backlog driver".' }) },
    { required: ['term'] },
  ),
  handler: async ({ term }) => {
    const key = (term ?? '').trim().toLowerCase()
    // Planner-worker reads the glossary as background context (no specific
    // term). Return the whole glossary instead of crashing on `undefined`.
    if (key === '') {
      const all = Object.entries(GLOSSARY)
        .map(([t, d]) => `${t}: ${d}`)
        .join('\n')
      return { term: '', definition: all }
    }
    const definition = GLOSSARY[key] ?? GLOSSARY[key.replace(/\s+/g, '.')] ?? null
    return { term: term ?? '', definition }
  },
}
