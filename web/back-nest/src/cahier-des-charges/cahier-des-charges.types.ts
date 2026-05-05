// ─── Types for Cahier des Charges generation ────────────────────────────────

/** Form data collected from the project questionnaire. */
export interface CahierFormData {
  projectName: string
  clientName: string
  projectManagerName: string
  startDate: string
  endDate: string
  priority: string
  status: string
  /** Dynamic / custom fields from the questionnaire form. */
  fields: Array<{
    label: string
    value: string | null
    fieldType: string
  }>
}

/** A single transcript used as input for the cahier. */
export interface CahierTranscriptInput {
  title: string
  recordedAt: string
  durationSeconds: number
  speakers: string[]
  fullText: string
  /** AI summary produced by the meeting analysis pipeline (if available). */
  aiSummary?: string | null
  /** Action items extracted from the transcript. */
  actionItems: Array<{
    description: string
    assigneeName?: string | null
    dueDate?: string | null
  }>
  /** Decisions & risks extracted from the transcript. */
  decisions: Array<{
    description: string
    category: 'decision' | 'risk'
  }>
}

// ─── AI-generated content — matches Neoledge template structure ─────────────

export interface CahierSection {
  title: string
  content: string // Markdown content
}

export interface CahierAiResult {
  // ── 1. Introduction ────────────────────────────────────────────────────────
  /** 1.1 Objectif du document */
  objectifDocument: string
  /** 1.2 Contexte */
  contexte: string

  // ── 2. Présentation du projet ──────────────────────────────────────────────
  /** 2.1 Objectif du projet */
  objectifProjet: string
  /** 2.2.1 Éléments inclus */
  perimetreInclus: string
  /** 2.2.2 Éléments exclus */
  perimetreExclus: string
  /** 2.3 Exigences fonctionnelles — array of subsections (e.g. Gestion des projets, Gestion des tâches…) */
  exigencesFonctionnelles: CahierSection[]
  /** 2.4 Architecture technique — array of subsections (Frontend, Backend, Module IA…) */
  architectureTechnique: CahierSection[]
  /** 2.5 Livrables */
  livrables: string

  // ── 3. Conclusion ──────────────────────────────────────────────────────────
  /** 3 Conclusion */
  conclusion: string
}

// ─── DOCX generation payload ─────────────────────────────────────────────────

export interface CahierDocxPayload {
  formData: CahierFormData
  aiContent: CahierAiResult
  generatedAt: string
}
