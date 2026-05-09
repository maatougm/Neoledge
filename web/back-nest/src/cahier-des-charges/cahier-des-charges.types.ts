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

// ─── Preflight gap analysis ─────────────────────────────────────────────────

/** One missing piece of information identified before cahier generation. */
export interface MissingFieldInfo {
  /** Section of the cahier this gap belongs to (e.g. "perimetreExclus", "exigencesFonctionnelles"). */
  section: string
  /** Short human-readable label of what's missing. */
  topic: string
  /** Severity — 'high' blocks generation by default, 'medium'/'low' are warnings. */
  severity: 'high' | 'medium' | 'low'
  /** A concrete question the PM should answer (or ask in a meeting). */
  suggestedQuestion: string
  /** Stable id so the UI can attach actions / dismissals to a specific row. */
  id: string
  /** Optional id of a ProjectField that, if filled, would close this gap. */
  relatedFieldId?: string | null
}

export interface CahierPreflightResult {
  /** 0..1 — proportion of expected sections covered. */
  readinessScore: number
  /** All identified gaps (high + medium + low). */
  missingFields: MissingFieldInfo[]
  /** Sections the AI considers complete. */
  answeredFields: string[]
  /** True when no high-severity gaps remain. */
  canGenerate: boolean
  /** Unix ms — timestamp the preflight was computed. */
  computedAt: number
  /** Origin: 'ai' (LLM call) or 'heuristic' (fallback when AI fails). */
  source: 'ai' | 'heuristic'
}
