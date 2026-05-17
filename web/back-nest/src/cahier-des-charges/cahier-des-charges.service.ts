import { Injectable, Logger, NotFoundException, BadRequestException, HttpException, HttpStatus } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service.js'
import { ZaiFallbackProvider } from '../ai/providers/zai-fallback.provider.js'
import { AgentRunnerService } from '../ai/agent/agent-runner.service.js'
import { EmbeddingsService } from '../ai/embeddings/embeddings.service.js'
import { AgentEmitMissedError } from '../ai/agent/agent-errors.js'
import { runCahierAgent, runCahierPlannerWorker } from './cahier-agent.js'
import { AiUsageService } from '../ai-usage/ai-usage.service.js'
import { NotificationsService } from '../notifications/notifications.service.js'
import { redactPii } from '../common/pii-redact.js'
import type {
  CahierFormData,
  CahierTranscriptInput,
  CahierAiResult,
  CahierDocxPayload,
  CahierPreflightResult,
  MissingFieldInfo,
  CahierSectionGroup,
  CahierStreamEvent,
} from './cahier-des-charges.types.js'

// ─── System prompt for cahier des charges generation ─────────────────────────

const SYSTEM_PROMPT = `# RÈGLE NUMÉRO UN — NE JAMAIS INVENTER

Tu n'inventes JAMAIS, sous aucun prétexte, un seul de ces éléments :
- nom de client, nom d'entreprise tierce, nom de produit
- technologie / framework / langage / base de données / cloud provider
- volume (nombre de documents, d'utilisateurs, GB, requêtes/seconde, etc.)
- date, calendrier, jalon, durée
- KPI, métrique, SLA, pourcentage
- format de livrable (.docx, ZIP, image Docker, etc.)
- nom de module, de fonctionnalité, d'écran qui n'est pas littéralement écrit dans la source
- contrainte réglementaire (RGPD, HDS, ISO, etc.) si elle n'est pas explicitement mentionnée

Si l'information n'est pas LITTÉRALEMENT présente dans QUESTIONNAIRE, REUNIONS, ou CAHIER_VALIDE_PAR_EQUIPE, tu écris exactement \`INFO_MANQUANTE: <sujet précis et court>\` à la place. Pas de paraphrase, pas de "à définir", pas de "à préciser ultérieurement". Le marqueur exact.

## Exemples

MAUVAIS (inventé — l'utilisateur n'a JAMAIS parlé de PostgreSQL ni de 10 000 docs/mois) :
\`\`\`
"livrables": "- Application web déployée sur AWS\\n- Base de données PostgreSQL pour 10 000 documents/mois\\n- Documentation technique"
\`\`\`

BON (l'utilisateur n'a précisé que "documentation technique" dans le questionnaire) :
\`\`\`
"livrables": "- INFO_MANQUANTE: plateforme de déploiement cible\\n- INFO_MANQUANTE: type de base de données et volume documentaire\\n- Documentation technique"
\`\`\`

MAUVAIS (le questionnaire dit "gestion des contrats" mais n'a JAMAIS mentionné de signature électronique) :
\`\`\`
"exigencesFonctionnelles": [{"title":"Gestion contractuelle","content":"Création de contrats avec signature électronique DocuSign et workflow de validation à 3 niveaux"}]
\`\`\`

BON :
\`\`\`
"exigencesFonctionnelles": [{"title":"Gestion contractuelle","content":"Création et suivi des contrats.\\n- INFO_MANQUANTE: type de signature requis (électronique, manuelle, hybride)\\n- INFO_MANQUANTE: structure du workflow de validation"}]
\`\`\`

Il vaut **toujours** mieux un cahier court et honnête avec des marqueurs INFO_MANQUANTE qu'un cahier complet rempli de détails inventés. Les marqueurs seront remplis manuellement par le PM avant la validation finale.

# RÔLE

Tu es expert NeoLedge/Archimed en rédaction de cahiers des charges contractuels (modèle Elise). Entrée au format TOON compact. Tu retournes UNIQUEMENT un JSON valide (pas de code fences) avec ces 9 clés :
objectifDocument (string), contexte (string), objectifProjet (string, bullets markdown), perimetreInclus (string, bullets), perimetreExclus (string, bullets), exigencesFonctionnelles (array {title,content} — un objet par module fonctionnel), architectureTechnique (array {title,content} — Frontend, Backend, Module IA, etc.), livrables (string, bullets), conclusion (string paragraphe).

# STRUCTURE (modèle NeoLedge interne)

- exigencesFonctionnelles : 4–6 modules MAX. N'invente PAS un module pour atteindre 6 ; mieux vaut 3 modules sourcés que 6 dont 3 inventés. Chaque module = phrase d'intro + bullets.
- architectureTechnique : 3–4 composants MAX. Si la stack n'est pas définie dans la source, écris \`INFO_MANQUANTE: stack <composant>\` plutôt qu'une suggestion générique.
- livrables : ne liste que ce qui est explicitement demandé dans la source. Si rien n'est demandé, c'est INFO_MANQUANTE.

# RÈGLES JSON

Tous les textes sont des strings JSON échappées. Pas de \`**\` ni de \`-\` en dehors des strings. Markdown (\`**gras**\`, listes \`- \`, sauts de ligne \\n) autorisé À L'INTÉRIEUR des strings uniquement.

# RÈGLES DE CONTENU

Français, ton contractuel professionnel, exhaustif **mais sourcé**. Réutilise le vocabulaire Elise/GED/Neoform/Elise.Automate UNIQUEMENT si le type de projet le justifie ET que la source y fait référence. Conclusion = paragraphe synthétique sans liste.

# PRIORITÉ DES SOURCES (du plus prioritaire au moins prioritaire)

1. CAHIER_VALIDE_PAR_EQUIPE (si présent) — version corrigée par l'équipe de validation, fait foi. Conserve les phrases telles qu'elles sont rédigées pour les sections qu'ils ont modifiées. NE LES RÉÉCRIS PAS.
2. FEEDBACK_PRECEDENT — corrige uniquement ce qui est explicitement signalé. Ne touche pas au reste.
3. QUESTIONNAIRE + REUNIONS — sources brutes pour combler ce qui manque.

Tu n'es PAS autorisé à reformuler une section que l'équipe de validation a corrigée juste pour "améliorer le style". Leur rédaction prévaut.`

@Injectable()
export class CahierDesChargesService {
  private readonly logger = new Logger(CahierDesChargesService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly zaiFallback: ZaiFallbackProvider,
    private readonly aiUsage: AiUsageService,
    private readonly agentRunner: AgentRunnerService,
    private readonly notifications: NotificationsService,
    private readonly embeddings: EmbeddingsService,
  ) {}

  /** Phase 4 — pgvector semantic retrieval flag. Off by default until the
   *  backfill is verified on prod data (Stage 1.9 → 1.10). */
  private isSemanticRetrievalEnabled(): boolean {
    return (this.config.get<string>('CAHIER_USE_SEMANTIC_RETRIEVAL') ?? 'off').toLowerCase() === 'on'
  }

  /** True when the cahier agent loop should run instead of single-shot. */
  private isAgentModeEnabled(): boolean {
    const raw = (this.config.get<string>('AI_AGENT_MODE') ?? 'off').toLowerCase()
    return raw === 'all' || raw.split(/[,\s]+/).includes('cahier')
  }

  // ─── 1. Gather all project data ────────────────────────────────────────────

  async gatherProjectData(projectId: string): Promise<{
    formData: CahierFormData
    transcripts: CahierTranscriptInput[]
  }> {
    // Hard caps to keep the prompt + memory bounded for projects with many
    // long meetings. The cahier is a summary — we don't need every segment of
    // every transcript, just the most recent + AI-summarised meetings.
    const MAX_TRANSCRIPTS = 8
    const MAX_SEGMENTS_PER_TRANSCRIPT = 250

    const project = await this.prisma.project.findFirst({
      where: { id: projectId, isDeleted: false },
      include: {
        projectManager: { select: { firstName: true, lastName: true } },
        fields: { orderBy: { orderIndex: 'asc' } },
        fieldValues: { include: { field: true } },
        transcripts: {
          include: {
            segments: { orderBy: { startTime: 'asc' }, take: MAX_SEGMENTS_PER_TRANSCRIPT },
            actionItems: { take: 50 },
            decisions: { take: 50 },
          },
          orderBy: { createdAt: 'desc' },
          take: MAX_TRANSCRIPTS,
        },
      },
    })

    if (!project) {
      throw new NotFoundException('Projet non trouvé')
    }

    // Build form data
    const formData: CahierFormData = {
      projectName: project.name,
      clientName: project.clientName,
      projectManagerName: project.projectManager
        ? `${project.projectManager.firstName} ${project.projectManager.lastName}`
        : 'Non assigné',
      startDate: project.startDate.toISOString().slice(0, 10),
      endDate: project.endDate.toISOString().slice(0, 10),
      priority: project.priority,
      status: project.status,
      fields: project.fieldValues.map((v) => ({
        label: v.field?.label ?? 'Champ',
        value: v.value,
        fieldType: v.field?.fieldType ?? 'Text',
      })),
    }

    // Build transcript inputs
    const transcripts: CahierTranscriptInput[] = project.transcripts.map((t) => ({
      title: t.title,
      recordedAt: t.recordedAt.toISOString().slice(0, 10),
      durationSeconds: t.durationSeconds,
      speakers: [...new Set(t.segments.map((s) => s.speaker))],
      fullText: t.segments.map((s) => `${s.speaker}: ${s.text}`).join('\n'),
      aiSummary: t.aiSummary,
      actionItems: t.actionItems.map((a) => ({
        description: a.description,
        assigneeName: a.assigneeName,
        dueDate: a.dueDate?.toISOString().slice(0, 10) ?? null,
      })),
      decisions: t.decisions.map((d) => ({
        description: d.description,
        category: d.category as 'decision' | 'risk',
      })),
    }))

    return { formData, transcripts }
  }

  // ─── 1c. Preflight gap analysis ────────────────────────────────────────────

  /**
   * Inspect questionnaire + meetings + saved cahier and report what's missing
   * BEFORE generation. Lets the PM either (a) fill the gaps, (b) record more
   * meetings, or (c) explicitly accept generating with holes — instead of the
   * AI silently inventing "À définir" placeholders or, worse, hallucinating data.
   */
  async runPreflight(projectId: string): Promise<CahierPreflightResult> {
    const { formData, transcripts } = await this.gatherProjectData(projectId)

    // Pull existing cahier so we can flag remaining INFO_MANQUANTE markers too.
    const persisted = await this.getPersistedCahier(projectId).catch(() => ({ aiContent: null }))

    // Pull project fields so the UI can deep-link "fill this answer" actions.
    const fields = await this.prisma.projectField.findMany({
      where: { projectId },
      select: { id: true, label: true, isBacklogDriver: true },
    })
    const fieldByLabel = new Map(fields.map((f) => [f.label.toLowerCase().trim(), f.id]))

    // 1. Cheap deterministic checks first — these never miss the obvious
    //    "no questionnaire / no meeting" cases regardless of AI mood.
    const heuristicGaps = this.collectHeuristicGaps(formData, transcripts, persisted.aiContent, fieldByLabel)

    // 2. Try the LLM for richer, project-specific gap discovery. Failure
    //    falls back to heuristic-only — never blocks the user.
    let aiGaps: MissingFieldInfo[] = []
    let source: 'ai' | 'heuristic' = 'heuristic'
    if (this.zaiFallback.isConfigured()) {
      try {
        aiGaps = await this.runAiPreflight(formData, transcripts, persisted.aiContent, fieldByLabel)
        source = 'ai'
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        this.logger.warn(`Preflight AI call failed, falling back to heuristic: ${msg.slice(0, 200)}`)
      }
    }

    // Merge — dedupe by (section + topic) so AI doesn't re-report what
    // the heuristic already caught.
    const seen = new Set<string>()
    const merged: MissingFieldInfo[] = []
    for (const g of [...heuristicGaps, ...aiGaps]) {
      const key = `${g.section}::${g.topic.toLowerCase().trim()}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(g)
    }

    const answeredFields = this.collectAnsweredFields(formData, transcripts, persisted.aiContent)

    // Readiness = answered / (answered + high+medium gaps). Low-severity
    // gaps don't penalize the score.
    const weighted = merged.filter((g) => g.severity !== 'low').length
    const total = answeredFields.length + weighted
    const readinessScore = total === 0 ? 0 : Math.max(0, Math.min(1, answeredFields.length / total))

    const canGenerate = !merged.some((g) => g.severity === 'high')

    return {
      readinessScore,
      missingFields: merged,
      answeredFields,
      canGenerate,
      computedAt: Date.now(),
      source,
    }
  }

  /** Section slugs the cahier expects to populate. */
  private static readonly REQUIRED_SECTIONS: Array<{ key: string; label: string }> = [
    { key: 'objectifProjet', label: 'Objectif du projet' },
    { key: 'contexte', label: 'Contexte' },
    { key: 'perimetreInclus', label: 'Périmètre — éléments inclus' },
    { key: 'perimetreExclus', label: 'Périmètre — éléments exclus' },
    { key: 'exigencesFonctionnelles', label: 'Exigences fonctionnelles' },
    { key: 'architectureTechnique', label: 'Architecture technique' },
    { key: 'livrables', label: 'Livrables' },
  ]

  /** What the project clearly already answers (never invents — based on data). */
  private collectAnsweredFields(
    formData: CahierFormData,
    transcripts: CahierTranscriptInput[],
    saved: unknown,
  ): string[] {
    const answered: string[] = []
    const filledLabels = new Set(
      formData.fields.filter((f) => f.value && f.value.trim().length > 10).map((f) => f.label),
    )
    if (filledLabels.size > 0) answered.push(`Questionnaire (${filledLabels.size} champs remplis)`)
    if (transcripts.length > 0) {
      answered.push(`Réunions enregistrées (${transcripts.length})`)
    }
    if (saved && typeof saved === 'object') {
      const s = saved as Record<string, unknown>
      for (const sec of CahierDesChargesService.REQUIRED_SECTIONS) {
        const v = s[sec.key]
        const filled =
          (typeof v === 'string' && v.trim().length > 20 && !v.includes('INFO_MANQUANTE') && !/à définir/i.test(v)) ||
          (Array.isArray(v) && v.length > 0)
        if (filled) answered.push(sec.label)
      }
    }
    return answered
  }

  /**
   * Deterministic gap list — catches the obvious "the user hasn't answered"
   * cases without spending an LLM call. Always runs, even when AI mode is on.
   */
  private collectHeuristicGaps(
    formData: CahierFormData,
    transcripts: CahierTranscriptInput[],
    saved: unknown,
    fieldByLabel: Map<string, string>,
  ): MissingFieldInfo[] {
    const gaps: MissingFieldInfo[] = []
    const filledFields = formData.fields.filter((f) => f.value && f.value.trim().length > 0)

    if (filledFields.length === 0 && transcripts.length === 0) {
      gaps.push({
        id: 'h-no-data',
        section: 'global',
        topic: 'Aucune donnée projet disponible',
        severity: 'high',
        suggestedQuestion:
          'Le projet n\'a ni questionnaire rempli ni réunion enregistrée. Remplissez d\'abord le questionnaire ou enregistrez une réunion de cadrage.',
      })
      return gaps
    }

    // Empty backlog-driver fields are always high severity — they're flagged
    // as required by the PM.
    for (const f of formData.fields) {
      const trimmed = (f.value ?? '').trim()
      if (trimmed.length === 0) {
        gaps.push({
          id: `h-field-${f.label}`,
          section: 'questionnaire',
          topic: f.label,
          severity: 'high',
          suggestedQuestion: `Renseignez le champ « ${f.label} » dans le questionnaire.`,
          relatedFieldId: fieldByLabel.get(f.label.toLowerCase().trim()) ?? null,
        })
      }
    }

    // Markers left by previous generations — must be resolved before regen.
    // The cahier mixes string sections (objectifDocument, contexte, livrables,
    // conclusion, …) and array sections (exigencesFonctionnelles, architectureTechnique,
    // each holding { title, content } items). Walk every leaf so KPIs / NFRs
    // buried inside arrays don't get silently re-emitted on the next generate.
    if (saved && typeof saved === 'object') {
      const markerRe = /INFO_MANQUANTE:\s*([^\n\]]+)/g
      const seenTopics = new Set<string>()
      const pushMarker = (sectionKey: string, sectionLabel: string, rawTopic: string): void => {
        const topic = rawTopic.replace(/[\]\)\.;,]+$/, '').trim().slice(0, 200)
        if (!topic) return
        const dedupeKey = `${sectionKey}::${topic.toLowerCase()}`
        if (seenTopics.has(dedupeKey)) return
        seenTopics.add(dedupeKey)
        gaps.push({
          id: `h-marker-${sectionKey}-${seenTopics.size}`,
          section: sectionKey,
          topic,
          severity: 'high',
          suggestedQuestion: `Section « ${sectionLabel} » : marqueur "${topic}" laissé par la précédente génération.`,
        })
      }
      const scanString = (sectionKey: string, sectionLabel: string, txt: unknown): void => {
        if (typeof txt !== 'string') return
        for (const match of txt.matchAll(markerRe)) pushMarker(sectionKey, sectionLabel, match[1])
      }
      const sectionByKey = new Map(CahierDesChargesService.REQUIRED_SECTIONS.map((s) => [s.key, s.label]))
      // Include a few keys not in REQUIRED_SECTIONS so leakage into objectifDocument
      // / conclusion is also surfaced.
      const extraLabels: Record<string, string> = {
        objectifDocument: 'Objectif du document',
        conclusion: 'Conclusion',
      }
      const s = saved as Record<string, unknown>
      for (const [key, value] of Object.entries(s)) {
        const label = sectionByKey.get(key) ?? extraLabels[key] ?? key
        if (typeof value === 'string') {
          scanString(key, label, value)
        } else if (Array.isArray(value)) {
          for (const item of value) {
            if (item && typeof item === 'object') {
              scanString(key, label, (item as { title?: unknown }).title)
              scanString(key, label, (item as { content?: unknown }).content)
            }
          }
        }
      }
    }

    // Zero meetings is medium — backlog can be inferred from the questionnaire alone
    // but the cahier is much weaker without any meeting context.
    if (transcripts.length === 0) {
      gaps.push({
        id: 'h-no-meetings',
        section: 'reunions',
        topic: 'Aucune réunion enregistrée',
        severity: 'medium',
        suggestedQuestion:
          'Aucune réunion de cadrage avec le client n\'est enregistrée. Le cahier sera généré uniquement à partir du questionnaire.',
      })
    }

    return gaps
  }

  /**
   * Ask the LLM to identify project-specific gaps a heuristic can't see —
   * e.g. "le client mentionne un module IA mais sans détailler les cas d'usage".
   * Returns at most 8 gaps. Throws on AI failure (caller falls back to heuristic).
   */
  private async runAiPreflight(
    formData: CahierFormData,
    transcripts: CahierTranscriptInput[],
    saved: unknown,
    fieldByLabel: Map<string, string>,
  ): Promise<MissingFieldInfo[]> {
    const PREFLIGHT_SYSTEM = `Tu es expert NeoLedge en analyse de complétude de cahiers des charges. À partir des données projet, identifie les informations CLAIREMENT MANQUANTES qui empêcheraient de rédiger un cahier des charges contractuel honnête.

Retourne UNIQUEMENT un JSON valide avec ce format strict :
{
  "missingFields": [
    {
      "section": "objectifProjet" | "contexte" | "perimetreInclus" | "perimetreExclus" | "exigencesFonctionnelles" | "architectureTechnique" | "livrables" | "global",
      "topic": "<3-8 mots décrivant ce qui manque>",
      "severity": "high" | "medium" | "low",
      "suggestedQuestion": "<question concrète à poser au client en réunion ou réponse à fournir dans le questionnaire>"
    }
  ]
}

RÈGLES :
- Maximum 8 entrées. Privilégie ce qui bloque vraiment la rédaction (severity=high).
- "high" : information critique manquante (périmètre exclu non défini, formats de livrables, technologies imposées, volume métier, calendrier, contraintes réglementaires).
- "medium" : information utile mais inférable (exemples concrets, KPIs, profils utilisateurs).
- "low" : nice-to-have (anecdotes, contexte historique).
- Ne signale PAS ce qui est déjà fourni. Lis attentivement avant de demander.
- Pas d'invention : si tu n'es pas certain qu'une info manque, ne la signale pas.
- Français concis et professionnel.`

    const userPrompt = (() => {
      const parts: string[] = []
      parts.push(`# PROJET\nnom: ${formData.projectName}\nclient: ${formData.clientName}\npriorite: ${formData.priority}\nstatut: ${formData.status}`)
      if (formData.fields.length > 0) {
        parts.push(`\n# QUESTIONNAIRE[${formData.fields.length}]{label,type,value}:`)
        for (const f of formData.fields) {
          parts.push(`${this.toonCell(f.label)},${this.toonCell(f.fieldType)},${this.toonCell(f.value)}`)
        }
      }
      if (transcripts.length > 0) {
        parts.push(`\n# REUNIONS[${transcripts.length}]`)
        for (const t of transcripts) {
          parts.push(`\n## ${t.title} | ${t.recordedAt}`)
          if (t.aiSummary) parts.push(`resume: ${t.aiSummary.trim().slice(0, 600)}`)
          if (t.decisions.length > 0) {
            parts.push(`decisions[${t.decisions.length}]:`)
            for (const d of t.decisions.slice(0, 8)) parts.push(`- ${d.category}: ${d.description}`)
          }
        }
      } else {
        parts.push(`\n# REUNIONS: aucune`)
      }
      if (saved && typeof saved === 'object') {
        const json = JSON.stringify(saved)
        const trimmed = json.length > 4000 ? json.slice(0, 4000) + ' [trunc]' : json
        parts.push(`\n# CAHIER_ACTUEL (référence — flag les marqueurs INFO_MANQUANTE):\n${trimmed}`)
      }
      return parts.join('\n')
    })()

    const raw = await this.zaiFallback.chat(PREFLIGHT_SYSTEM, userPrompt, { maxTokens: 1500, temperature: 0.2 })
    const cleaned = this.stripFences(raw)
    let parsed: { missingFields?: unknown } = {}
    try {
      parsed = JSON.parse(cleaned) as typeof parsed
    } catch (e) {
      throw new Error(`Preflight returned invalid JSON: ${(e as Error).message}`)
    }

    const list = Array.isArray(parsed.missingFields) ? parsed.missingFields : []
    const out: MissingFieldInfo[] = []
    for (const [idx, item] of list.entries()) {
      if (!item || typeof item !== 'object') continue
      const r = item as Record<string, unknown>
      const section = typeof r.section === 'string' ? r.section : 'global'
      const topic = typeof r.topic === 'string' ? r.topic.trim() : ''
      if (!topic) continue
      const severity: MissingFieldInfo['severity'] =
        r.severity === 'high' || r.severity === 'medium' || r.severity === 'low' ? r.severity : 'medium'
      const suggestedQuestion = typeof r.suggestedQuestion === 'string' ? r.suggestedQuestion.trim() : ''
      out.push({
        id: `ai-${section}-${idx}`,
        section,
        topic: topic.slice(0, 200),
        severity,
        suggestedQuestion: (suggestedQuestion || `Précisez : ${topic}`).slice(0, 400),
        relatedFieldId: fieldByLabel.get(topic.toLowerCase().trim()) ?? null,
      })
      if (out.length >= 8) break
    }
    return out
  }

  // ─── 1b. Fetch past feedback for AI learning ────────────────────────────────

  async getPastFeedback(projectId: string): Promise<string[]> {
    const feedback = await this.prisma.cahierFeedback.findMany({
      where: { projectId, status: 'rejected' },
      orderBy: { createdAt: 'desc' },
      take: 10, // Last 10 rejections
      select: { comment: true, section: true, createdAt: true },
    })
    return feedback.map(
      (f) =>
        `[${f.createdAt.toISOString().slice(0, 10)}]${f.section ? ` Section "${f.section}":` : ''} ${f.comment}`,
    )
  }

  /**
   * In-place edit of an already-saved cahier. Preserves the original `savedAt`
   * so the existing validation queue and feedback rows stay valid (an edit is
   * NOT a regeneration). No notifications fire — only an activity log row.
   */
  async editCahierContent(
    projectId: string,
    aiContent: unknown,
    userId: string | null,
  ): Promise<void> {
    if (!aiContent || typeof aiContent !== 'object') {
      throw new BadRequestException('aiContent manquant ou invalide')
    }
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, aiOutput: true },
    })
    if (!project) throw new BadRequestException('Projet introuvable')
    if (!project.aiOutput) {
      throw new BadRequestException(
        'Aucun cahier à éditer — générez-le d\'abord.',
      )
    }
    let originalSavedAt: string | null = null
    try {
      const parsed = JSON.parse(project.aiOutput) as { savedAt?: string }
      originalSavedAt = parsed.savedAt ?? null
    } catch {
      // corrupt JSON — fall back to current time so we still write a valid row
    }
    const payload = JSON.stringify({
      aiContent,
      savedAt: originalSavedAt ?? new Date().toISOString(),
    })
    await this.prisma.project.update({
      where: { id: projectId },
      data: { aiOutput: payload },
    })
    // Snapshot the new content as a CahierVersion so the team can roll
    // back / diff later. Failure is logged, not surfaced.
    void this.snapshotVersion(projectId, aiContent, 'edited', userId).catch((e) =>
      this.logger.warn(`cahier version snapshot failed: ${e instanceof Error ? e.message : e}`),
    )
    void this.prisma.projectActivity
      .create({
        data: {
          projectId,
          userId,
          action: 'cahier_edited',
          detail: 'Cahier des charges modifié manuellement',
        },
      })
      .catch((e) =>
        this.logger.warn(`activity log failed: ${e instanceof Error ? e.message : e}`),
      )
  }

  /**
   * Append a new CahierVersion row. Version number is monotonic per project.
   */
  private async snapshotVersion(
    projectId: string,
    aiContent: unknown,
    kind: 'generated' | 'edited' | 'approved',
    userId: string | null,
  ): Promise<void> {
    const last = await this.prisma.cahierVersion.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
      select: { version: true },
    })
    const nextVersion = (last?.version ?? 0) + 1
    await this.prisma.cahierVersion.create({
      data: {
        projectId,
        version: nextVersion,
        kind,
        aiContent: JSON.stringify(aiContent),
        createdById: userId ?? null,
      },
    })
  }

  /** Public read API — list versions for a project, newest first. */
  async listVersions(projectId: string) {
    const rows = await this.prisma.cahierVersion.findMany({
      where: { projectId },
      orderBy: { version: 'desc' },
      take: 50,
      select: {
        id: true,
        version: true,
        kind: true,
        createdAt: true,
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    })
    return rows.map((r) => ({
      id: r.id,
      version: r.version,
      kind: r.kind,
      createdAt: r.createdAt,
      createdBy: r.createdBy ? `${r.createdBy.firstName} ${r.createdBy.lastName}` : null,
    }))
  }

  /** Public read API — fetch one version's full content. */
  async getVersion(projectId: string, versionId: string) {
    const row = await this.prisma.cahierVersion.findFirst({
      where: { id: versionId, projectId },
      select: {
        id: true,
        version: true,
        kind: true,
        createdAt: true,
        aiContent: true,
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    })
    if (!row) return null
    let content: unknown = null
    try { content = JSON.parse(row.aiContent) } catch { content = null }
    return {
      id: row.id,
      version: row.version,
      kind: row.kind,
      createdAt: row.createdAt,
      createdBy: row.createdBy ? `${row.createdBy.firstName} ${row.createdBy.lastName}` : null,
      aiContent: content,
    }
  }

  /** Persist a generated cahier JSON in Project.aiOutput + notify review teams. */
  async savePersistedCahier(projectId: string, aiContent: unknown, userId: string | null = null): Promise<void> {
    if (!aiContent || typeof aiContent !== 'object') {
      throw new BadRequestException('aiContent manquant ou invalide')
    }
    const payload = JSON.stringify({
      aiContent,
      savedAt: new Date().toISOString(),
    })

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, aiOutput: true },
    })
    if (!project) {
      throw new BadRequestException('Projet introuvable')
    }

    await this.prisma.project.update({
      where: { id: projectId },
      data: { aiOutput: payload },
    })
    this.logger.log(`Saved cahier for project ${projectId} (${payload.length} bytes)`)

    // Snapshot the generated content for rollback / diff.
    void this.snapshotVersion(projectId, aiContent, 'generated', userId).catch((e) =>
      this.logger.warn(`cahier version snapshot failed: ${e instanceof Error ? e.message : e}`),
    )

    // Write an activity row so the admin / project activity feed updates live
    void this.prisma.projectActivity
      .create({
        data: {
          projectId,
          userId,
          action: 'cahier_generated',
          detail: `Cahier des charges généré par l'IA (${Math.round(payload.length / 1024)} Ko)`,
        },
      })
      .catch((e) => this.logger.warn(`activity log failed: ${e instanceof Error ? e.message : e}`))

    // Notify SpecificationTeam (the approvers) that a cahier is ready to review.
    // Only fire notifications on the FIRST save (aiOutput was null) OR on regenerations
    // so reviewers always know fresh content is available.
    void this.notifyReviewTeams(project.id, project.name).catch((e) =>
      this.logger.warn(`notifyReviewTeams failed: ${e instanceof Error ? e.message : String(e)}`),
    )
  }

  /**
   * Notify ONLY SpecificationTeam users who have been added as members of this
   * specific project (via ProjectMember). Generic "all spec team users" no
   * longer fires — the PM controls who reviews each cahier.
   */
  private async notifyReviewTeams(projectId: string, projectName: string): Promise<void> {
    const reviewers = await this.prisma.projectMember.findMany({
      where: {
        projectId,
        user: {
          role: 'SpecificationTeam',
          isActive: true,
        },
      },
      select: { userId: true },
    })
    if (reviewers.length === 0) {
      this.logger.warn(
        `notifyReviewTeams: no SpecificationTeam member assigned to project ${projectId} — no notification sent`,
      )
      return
    }

    await Promise.allSettled(
      reviewers.map((m) =>
        this.notifications.notifyEnhanced({
          userId: m.userId,
          type: 'cahier_ready',
          reason: 'cahier_generated',
          title: 'Cahier des charges à valider',
          message: `Un nouveau cahier des charges a été généré pour « ${projectName} ». À vérifier.`,
          projectId,
          entityType: 'Project',
          entityId: projectId,
          link: `/app/pm/projects/${projectId}/cahier`,
        }),
      ),
    )
    this.logger.log(
      `Notified ${reviewers.length} SpecificationTeam project member(s) about cahier for project ${projectId}`,
    )
  }

  /** Aggregate validation status of the saved cahier for the project overview / banner. */
  async getCahierStatus(projectId: string): Promise<{
    cahierSavedAt: string | null
    status: 'none' | 'pending' | 'approved' | 'rejected'
    lastFeedback: { status: string; comment: string; section: string | null; createdAt: string; userName: string | null } | null
    approverCount: number
    rejectionCount: number
  }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { aiOutput: true },
    })

    let cahierSavedAt: string | null = null
    if (project?.aiOutput) {
      try {
        const parsed = JSON.parse(project.aiOutput) as { savedAt?: string }
        cahierSavedAt = parsed.savedAt ?? null
      } catch { /* ignore */ }
    }

    if (!cahierSavedAt) {
      return { cahierSavedAt: null, status: 'none', lastFeedback: null, approverCount: 0, rejectionCount: 0 }
    }

    // Only consider feedback rows submitted AFTER the latest save.
    const savedDate = new Date(cahierSavedAt)
    const feedback = await this.prisma.cahierFeedback.findMany({
      where: { projectId, createdAt: { gte: savedDate } },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { firstName: true, lastName: true } } },
    })

    const approverCount = feedback.filter((f) => f.status === 'approved').length
    const rejectionCount = feedback.filter((f) => f.status === 'rejected').length

    let status: 'pending' | 'approved' | 'rejected' = 'pending'
    if (rejectionCount > 0) status = 'rejected'
    else if (approverCount > 0) status = 'approved'

    const last = feedback[0] ?? null
    return {
      cahierSavedAt,
      status,
      approverCount,
      rejectionCount,
      lastFeedback: last
        ? {
            status: last.status,
            comment: last.comment,
            section: last.section,
            createdAt: last.createdAt.toISOString(),
            userName: last.user ? `${last.user.firstName} ${last.user.lastName}` : null,
          }
        : null,
    }
  }

  /** Retrieve the previously saved cahier JSON — or null if none. */
  async getPersistedCahier(projectId: string): Promise<{ aiContent: unknown; savedAt: string | null }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { aiOutput: true },
    })
    if (!project?.aiOutput) return { aiContent: null, savedAt: null }
    try {
      const parsed = JSON.parse(project.aiOutput) as { aiContent?: unknown; savedAt?: string }
      return { aiContent: parsed.aiContent ?? null, savedAt: parsed.savedAt ?? null }
    } catch {
      return { aiContent: null, savedAt: null }
    }
  }

  /** Save user feedback (approval or rejection with comment). */
  async saveFeedback(
    projectId: string,
    userId: string,
    status: 'approved' | 'rejected',
    comment: string,
    section?: string,
  ): Promise<void> {
    // Reject self-approval — the project's PM cannot approve their own cahier.
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { projectManagerId: true },
    })
    if (project?.projectManagerId === userId) {
      throw new BadRequestException(
        'Vous ne pouvez pas valider votre propre cahier des charges. Cette action est réservée à l\'équipe de validation.',
      )
    }

    const aiModel = this.config.get<string>('CAHIER_AI_MODEL', 'gpt-4o-mini')
    await this.prisma.cahierFeedback.create({
      data: {
        id: crypto.randomUUID(),
        projectId,
        userId,
        status,
        comment,
        section: section ?? null,
        aiModel,
      },
    })
    this.logger.log(`Cahier feedback saved: ${status} for project ${projectId}`)

    // Notify the project's PM that the cahier was reviewed.
    void this.notifyPmAboutFeedback(projectId, status, comment).catch((e) =>
      this.logger.warn(`notifyPmAboutFeedback failed: ${e instanceof Error ? e.message : String(e)}`),
    )
  }

  /** Fire-and-forget notification to the PM after the SpecificationTeam reviews a cahier. */
  private async notifyPmAboutFeedback(
    projectId: string,
    status: 'approved' | 'rejected',
    comment: string,
  ): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true, projectManagerId: true },
    })
    if (!project?.projectManagerId) return

    const isApproved = status === 'approved'
    const title = isApproved ? 'Cahier des charges approuvé' : 'Cahier des charges rejeté'
    const message = isApproved
      ? `Le cahier des charges de « ${project.name} » a été approuvé.`
      : `Le cahier des charges de « ${project.name} » a été rejeté. Commentaire : ${comment.slice(0, 200)}`

    await this.notifications.notifyEnhanced({
      userId: project.projectManagerId,
      type: isApproved ? 'cahier_approved' : 'cahier_rejected',
      reason: isApproved ? 'cahier_approved' : 'cahier_rejected',
      title,
      message,
      projectId,
      entityType: 'Project',
      entityId: projectId,
      link: `/app/pm/projects/${projectId}/cahier`,
    })
  }

  /**
   * Refuse to generate when fields marked `isBacklogDriver=true` have no
   * answer. Returns 412 Precondition Failed with the missing field labels
   * so the UI can surface a clear "fill these first" error.
   */
  private async assertDriverFieldsFilled(projectId: string): Promise<void> {
    const drivers = await this.prisma.projectField.findMany({
      where: { projectId, isBacklogDriver: true },
      select: { id: true, label: true, values: { select: { value: true } } },
    })
    if (drivers.length === 0) return
    const missing = drivers
      .filter((f) => {
        const v = f.values[0]?.value
        return !v || v.trim() === ''
      })
      .map((f) => f.label)
    if (missing.length > 0) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PRECONDITION_FAILED,
          message: 'Champs IA obligatoires non renseignés. Remplissez le questionnaire avant de générer.',
          missingFields: missing,
        },
        HttpStatus.PRECONDITION_FAILED,
      )
    }
  }

  // ─── 2. Build AI prompt ────────────────────────────────────────────────────

  /**
   * Escape a value for TOON table row (RFC-4180-ish: quote if contains `,`, `|` or newline).
   * TOON = Token-Oriented Object Notation — compact JSON-equivalent that cuts ~50 % of tokens
   * for arrays-of-objects vs verbose "key: value" prose.
   */
  private toonCell(v: string | null | undefined): string {
    const s = String(v ?? '')
    if (!s) return ''
    if (/[,|\n"]/.test(s)) {
      return `"${s.replace(/"/g, '""').replace(/\n/g, '\\n')}"`
    }
    return s
  }

  private buildUserPrompt(
    formData: CahierFormData,
    transcripts: CahierTranscriptInput[],
    pastFeedback?: string[],
    previousCorrectedCahier?: unknown,
  ): string {
    const parts: string[] = []

    // ── Form data — flat key:value pairs (can't beat this for a handful of scalars) ──
    parts.push('# PROJET')
    parts.push(`nom: ${formData.projectName}`)
    parts.push(`client: ${formData.clientName}`)
    parts.push(`pm: ${formData.projectManagerName}`)
    parts.push(`debut: ${formData.startDate}`)
    parts.push(`fin: ${formData.endDate}`)
    parts.push(`priorite: ${formData.priority}`)
    parts.push(`statut: ${formData.status}`)

    // ── Questionnaire fields — TOON table ──
    if (formData.fields.length > 0) {
      parts.push(`\n# QUESTIONNAIRE[${formData.fields.length}]{label,type,value}:`)
      for (const f of formData.fields) {
        parts.push(`${this.toonCell(f.label)},${this.toonCell(f.fieldType)},${this.toonCell(f.value)}`)
      }
    }

    // ── Transcripts — TOON tables per meeting ──
    if (transcripts.length > 0) {
      parts.push(`\n# REUNIONS[${transcripts.length}]`)
      for (const t of transcripts) {
        parts.push(`\n## ${t.title} | ${t.recordedAt} | ${Math.round(t.durationSeconds / 60)}min`)
        if (t.speakers.length > 0) parts.push(`participants: ${t.speakers.join(';')}`)
        if (t.aiSummary) parts.push(`resume: ${t.aiSummary.trim()}`)
        if (t.actionItems.length > 0) {
          parts.push(`actions[${t.actionItems.length}]{desc,assignee,due}:`)
          for (const a of t.actionItems) {
            parts.push(`${this.toonCell(a.description)},${this.toonCell(a.assigneeName)},${this.toonCell(a.dueDate)}`)
          }
        }
        if (t.decisions.length > 0) {
          parts.push(`decisions[${t.decisions.length}]{cat,desc}:`)
          for (const d of t.decisions) {
            parts.push(`${this.toonCell(d.category)},${this.toonCell(d.description)}`)
          }
        }
        // Raw transcript is inherently unstructured free text — keep as-is, truncated
        const maxChars = 8000
        const trimmedText = t.fullText.length > maxChars
          ? t.fullText.slice(0, maxChars) + ' [trunc]'
          : t.fullText
        // Mask emails / phones / IBAN before the transcript leaves our backend.
        const { text: redacted } = redactPii(trimmedText)
        parts.push(`transcript: ${redacted}`)
      }
    }

    // ── Past feedback — compact ──
    if (pastFeedback && pastFeedback.length > 0) {
      parts.push(`\n# FEEDBACK_PRECEDENT[${pastFeedback.length}] (erreurs a corriger, ne pas repeter):`)
      for (const fb of pastFeedback) parts.push(`- ${fb}`)
    }

    // ── Previously-corrected cahier — authoritative reference ──
    // The validation team has manually edited this version. Treat their wording
    // as canonical: keep their sentences verbatim for any section they touched,
    // only refine sections they explicitly flagged in FEEDBACK_PRECEDENT.
    if (previousCorrectedCahier && typeof previousCorrectedCahier === 'object') {
      const json = JSON.stringify(previousCorrectedCahier)
      // Cap to avoid blowing the token budget on a huge previous cahier.
      const MAX = 12000
      const trimmed = json.length > MAX ? json.slice(0, MAX) + ' [trunc]' : json
      parts.push(
        `\n# CAHIER_VALIDE_PAR_EQUIPE (version manuellement corrigee par l'equipe de validation — REFERENCE FAISANT FOI: conserve les phrases exactes pour les sections qu'ils ont corrigees, n'ameliore que les sections explicitement signalees dans FEEDBACK_PRECEDENT):`,
      )
      parts.push(trimmed)
    }

    return parts.join('\n')
  }

  // ─── 3. Call AI provider ───────────────────────────────────────────────────

  /** Rough prompt-token estimate (~4 chars/token) without building the full prompt. */
  private estimateCahierPromptTokens(
    formData: CahierFormData,
    transcripts: CahierTranscriptInput[],
  ): number {
    let chars = 1_000 // baseline overhead for system prompt + form metadata
    for (const f of formData.fields) chars += (f.label?.length ?? 0) + (f.value?.length ?? 0) + 8
    for (const t of transcripts) chars += Math.min(t.fullText?.length ?? 0, 8_000) + 200
    return Math.ceil(chars / 4)
  }

  async generateCahierContent(
    formData: CahierFormData,
    transcripts: CahierTranscriptInput[],
    projectId?: string,
  ): Promise<CahierAiResult> {
    // Pre-flight gates — must run BEFORE the agent-mode branch so turning on
    // AI_AGENT_MODE doesn't silently disable the safety net.
    if (projectId) {
      // Driver-fields gate — block if any "alimente l'IA" field has no answer.
      await this.assertDriverFieldsFilled(projectId)
      // Sized daily-budget assertion — both single-shot and agent loops can
      // burn 30k+ tokens with tools. Estimate generously: prompt + 12k for tools.
      const promptBudget = this.estimateCahierPromptTokens(formData, transcripts)
      await this.aiUsage.assertWithinDailyBudget(projectId, promptBudget + 12_000)
    }

    // Agent mode — model fetches questionnaire/meetings/feedback via tools.
    // Fall through to single-shot only on AgentEmitMissedError. Other agent
    // errors propagate (cost / token / network issues) — same shape the
    // single-shot path produces today.
    //
    // Phase 5 — planner/worker variant. When `CAHIER_USE_PLANNER=on`, replace
    // the agent loop with a single-shot pattern: execute the 6 deterministic
    // reads in parallel, hand the worker a pre-assembled context blob, force
    // emit_cahier in one LLM call. Round-trip count drops from N→1. Falls
    // through to the agent loop on AgentEmitMissedError (same recovery
    // pattern as the agent path itself).
    if (projectId && this.isAgentModeEnabled()) {
      const startedAt = Date.now()
      const agentModel = this.config.get<string>('AI_FALLBACK_MODEL') ?? 'glm-4.5-air'
      const usePlanner = (this.config.get<string>('CAHIER_USE_PLANNER') ?? 'off').toLowerCase() === 'on'
      const semantic = { embeddings: this.embeddings, enabled: this.isSemanticRetrievalEnabled() }
      try {
        const out = usePlanner
          ? await runCahierPlannerWorker(this.agentRunner, this.prisma, this.logger, projectId)
          : await runCahierAgent(this.agentRunner, this.logger, projectId, semantic)
        void this.aiUsage.log({
          projectId,
          provider: usePlanner ? 'planner-worker' : 'agent',
          model: agentModel,
          feature: 'cahier',
          durationMs: Date.now() - startedAt,
          success: true,
        })
        // The agent path previously skipped grounding + critique because it
        // returned `out` directly. Real prod test caught hallucinated tech
        // names (React/Vue.js/etc.) coming out of this branch. Run the same
        // two-layer defence here.
        const agentGrounded = this.applyGroundingCheck(out, this.buildSourceCorpus(formData, transcripts, undefined))
        // Phase 5 follow-up: when the planner-worker path produced the cahier,
        // skipping the self-critique pass becomes defensible — the worker saw
        // a deterministic, fully-assembled context blob in a single LLM call
        // with no opportunity to drift mid-generation. The regex grounding
        // check still runs (catches the canonical named-tech hallucination
        // class). Trade-off: loses the second-pass French-style polish, but
        // saves ~90s on the end-to-end /preview wall time per measurement.
        // Default off — turn on with CAHIER_PLANNER_SKIP_CRITIQUE=on.
        const skipCritique =
          usePlanner &&
          (this.config.get<string>('CAHIER_PLANNER_SKIP_CRITIQUE') ?? 'off').toLowerCase() === 'on'
        if (skipCritique) {
          this.logger.log('Cahier planner-worker path: skipping self-critique per CAHIER_PLANNER_SKIP_CRITIQUE=on')
          return agentGrounded
        }
        return await this.runSelfCritique(agentGrounded, formData, transcripts, projectId).catch(() => agentGrounded)
      } catch (e: unknown) {
        if (e instanceof AgentEmitMissedError) {
          this.logger.warn(`cahier agent emit missed; falling through to single-shot: ${e.message}`)
        } else {
          throw e
        }
      }
    }

    // All AI features default to Z.AI primary (cheap + supports tool-use).
    // AI_FALLBACK_PROVIDER (default 'openai') auto-engages on Z.AI failure.
    const provider = (this.config.get<string>('AI_PROVIDER') ?? 'zai').toLowerCase()

    // Fetch past feedback to inject into prompt (AI learning)
    let pastFeedback: string[] = []
    let previousCorrectedCahier: unknown = null
    if (projectId) {
      pastFeedback = await this.getPastFeedback(projectId)
      if (pastFeedback.length > 0) {
        this.logger.log(`Including ${pastFeedback.length} past feedback items for AI learning`)
      }
      // Pull the last saved cahier (which may carry the validation team's
      // manual edits) so the AI doesn't undo their corrections on the next
      // regeneration.
      try {
        const persisted = await this.getPersistedCahier(projectId)
        if (persisted.aiContent) {
          previousCorrectedCahier = persisted.aiContent
          this.logger.log('Including previous corrected cahier as authoritative reference')
        }
      } catch {
        /* silent — previous cahier is best-effort */
      }
    }

    const userPrompt = this.buildUserPrompt(formData, transcripts, pastFeedback, previousCorrectedCahier)

    // Section-mode (CAHIER_SECTION_MODE=on): fan out 3 parallel focused calls
    // (intro / scope / delivery), each with only its 3 keys to produce. This
    // reduces the "must fill the blanks" pressure that drives hallucination
    // on a single-shot 9-key generation. Each group still gets grounding +
    // critique on the merged result.
    if (this.isSectionModeEnabled()) {
      const sectionResult = await this.generateInThreeGroups(formData, transcripts, userPrompt, projectId).catch((e) => {
        this.logger.warn(`section-mode failed, falling back to single-shot: ${e instanceof Error ? e.message : String(e)}`)
        return null
      })
      if (sectionResult) {
        const grounded = this.applyGroundingCheck(sectionResult, this.buildSourceCorpus(formData, transcripts, previousCorrectedCahier))
        return await this.runSelfCritique(grounded, formData, transcripts, projectId).catch(() => grounded)
      }
    }

    this.logger.log(`Generating cahier des charges (provider: ${provider}, prompt length: ${userPrompt.length} chars)`)

    // Daily-budget assertion was already done in the unified pre-flight gate
    // above (with a generous estimate that covers both single-shot and agent).
    const startedAt = Date.now()
    // Pick model name for logging — Z.AI primary uses AI_FALLBACK_MODEL (kept
    // for backward compat with the env var name), OpenAI/Gemini paths use the
    // older CAHIER_AI_MODEL/AI_MODEL chain.
    const modelName = (() => {
      if (provider === 'zai') {
        return this.config.get<string>('AI_FALLBACK_MODEL') ?? 'glm-4.5-air'
      }
      return this.config.get<string>('CAHIER_AI_MODEL') ?? this.config.get<string>('AI_MODEL') ?? 'gpt-4o-mini'
    })()

    // Pick the secondary provider — never the same as primary.
    const fallbackProvider = (() => {
      if (provider === 'zai') return 'openai'
      // Existing behaviour: any non-Z.AI primary falls back to Z.AI.
      return 'zai'
    })()

    try {
      const { result, promptTokens, completionTokens } = await this.callCahierProvider(provider, userPrompt)
      void this.aiUsage.log({
        projectId: projectId ?? null,
        provider,
        model: modelName,
        feature: 'cahier',
        // Real provider-reported usage when available; fall back to char-based estimate.
        promptTokens: promptTokens > 0 ? promptTokens : Math.ceil(userPrompt.length / 4),
        completionTokens: completionTokens > 0 ? completionTokens : 1_500,
        durationMs: Date.now() - startedAt,
        success: true,
      })
      // Post-generation grounding pass — rewrites ungrounded tech names /
      // capitalised proper nouns to INFO_MANQUANTE markers when they don't
      // appear in the source corpus. Cheap deterministic backstop on top of
      // the prompt-level anti-hallucination rule.
      const grounded = this.applyGroundingCheck(result, this.buildSourceCorpus(formData, transcripts, previousCorrectedCahier))
      return await this.runSelfCritique(grounded, formData, transcripts, projectId).catch(() => grounded)
    } catch (primaryErr: unknown) {
      const fallbackAvailable = fallbackProvider === 'zai'
        ? this.zaiFallback.isConfigured()
        : Boolean(this.config.get<string>('OPENAI_API_KEY') ?? this.config.get<string>('AZURE_OPENAI_ENDPOINT'))
      if (!fallbackAvailable) {
        void this.aiUsage.log({
          projectId: projectId ?? null,
          provider,
          model: modelName,
          feature: 'cahier',
          promptTokens: Math.ceil(userPrompt.length / 4),
          durationMs: Date.now() - startedAt,
          success: false,
          errorMessage: primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
        })
        throw primaryErr
      }
      const msg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr)
      this.logger.warn(`Primary cahier provider (${provider}) failed: ${msg.slice(0, 200)} — falling back to ${fallbackProvider}`)
      const fb = await this.callCahierProvider(fallbackProvider, userPrompt)
      const fallbackModel = fallbackProvider === 'zai'
        ? (this.config.get<string>('AI_FALLBACK_MODEL') ?? 'glm-4.5-air')
        : (this.config.get<string>('CAHIER_AI_MODEL') ?? this.config.get<string>('AI_MODEL') ?? 'gpt-4o-mini')
      void this.aiUsage.log({
        projectId: projectId ?? null,
        provider: `${fallbackProvider}-fallback`,
        model: fallbackModel,
        feature: 'cahier',
        promptTokens: fb.promptTokens > 0 ? fb.promptTokens : Math.ceil(userPrompt.length / 4),
        completionTokens: fb.completionTokens > 0 ? fb.completionTokens : 1_500,
        durationMs: Date.now() - startedAt,
        success: true,
      })
      const groundedFb = this.applyGroundingCheck(fb.result, this.buildSourceCorpus(formData, transcripts, previousCorrectedCahier))
      return await this.runSelfCritique(groundedFb, formData, transcripts, projectId).catch(() => groundedFb)
    }
  }

  /** True when CAHIER_SECTION_MODE=on — splits generation into 3 focused calls. */
  private isSectionModeEnabled(): boolean {
    return (this.config.get<string>('CAHIER_SECTION_MODE') ?? 'off').toLowerCase() === 'on'
  }

  /** Per-group system prompt — shares the anti-hallucination preamble with the
   *  full SYSTEM_PROMPT but narrows the output schema to just the group's keys. */
  private buildGroupSystemPrompt(group: 'intro' | 'scope' | 'delivery'): string {
    const preamble = SYSTEM_PROMPT.split('# RÔLE')[0]
    const schemas: Record<typeof group, string> = {
      intro: `Tu retournes UNIQUEMENT un JSON valide avec ces 3 clés (et rien d'autre) :
- objectifDocument (string markdown court, 2-4 lignes)
- contexte (string markdown, 1-2 paragraphes)
- objectifProjet (string markdown, bullets)`,
      scope: `Tu retournes UNIQUEMENT un JSON valide avec ces 3 clés (et rien d'autre) :
- perimetreInclus (string markdown, bullets)
- perimetreExclus (string markdown, bullets)
- exigencesFonctionnelles (array {title,content} — 3-6 modules; INFO_MANQUANTE si moins de modules sourcés)`,
      delivery: `Tu retournes UNIQUEMENT un JSON valide avec ces 3 clés (et rien d'autre) :
- architectureTechnique (array {title,content} — 2-4 composants; INFO_MANQUANTE si la stack n'est pas dans la source)
- livrables (string markdown, bullets)
- conclusion (string paragraphe synthétique sans liste)`,
    }
    return `${preamble}\n# RÔLE\n\nTu es expert NeoLedge en rédaction contractuelle. Entrée au format TOON.\n\n${schemas[group]}\n\nRespecte les règles d'anti-hallucination ci-dessus à la lettre.`
  }

  /**
   * 3-call mode: parallel fan-out for intro / scope / delivery. Each call
   * shares the full source TOON but only owns 3 keys. The output is merged
   * into a single CahierAiResult.
   */
  private async generateInThreeGroups(
    formData: CahierFormData,
    transcripts: CahierTranscriptInput[],
    userPrompt: string,
    projectId?: string,
  ): Promise<CahierAiResult> {
    if (!this.zaiFallback.isConfigured()) {
      throw new Error('section mode requires Z.AI provider (AI_FALLBACK_API_KEY)')
    }
    const startedAt = Date.now()
    const groups = ['intro', 'scope', 'delivery'] as const
    const responses = await Promise.all(
      groups.map(async (g) => {
        const sys = this.buildGroupSystemPrompt(g)
        const usage = await this.zaiFallback.chatWithUsage(sys, userPrompt, {
          maxTokens: 4096,
          temperature: 0.1,
        })
        return { group: g, content: usage.content, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens }
      }),
    )

    // Aggregate AiUsage across the 3 calls into a single log row.
    const totals = responses.reduce(
      (acc, r) => ({ pt: acc.pt + r.promptTokens, ct: acc.ct + r.completionTokens }),
      { pt: 0, ct: 0 },
    )
    void this.aiUsage.log({
      projectId: projectId ?? null,
      provider: 'zai-section-mode',
      model: this.config.get<string>('AI_FALLBACK_MODEL') ?? 'glm-4.5-air',
      feature: 'cahier',
      promptTokens: totals.pt,
      completionTokens: totals.ct,
      durationMs: Date.now() - startedAt,
      success: true,
    })

    // Parse each group's JSON; coerce missing keys to INFO_MANQUANTE markers.
    const partial: Partial<CahierAiResult> = {}
    for (const r of responses) {
      let parsed: Record<string, unknown> = {}
      try {
        parsed = JSON.parse(this.stripFences(r.content)) as Record<string, unknown>
      } catch (e) {
        this.logger.warn(`section-mode parse failed for ${r.group}: ${e instanceof Error ? e.message : String(e)}`)
      }
      if (r.group === 'intro') {
        partial.objectifDocument = this.coerceToMarkdown(parsed.objectifDocument)
        partial.contexte = this.coerceToMarkdown(parsed.contexte)
        partial.objectifProjet = this.coerceToMarkdown(parsed.objectifProjet)
      } else if (r.group === 'scope') {
        partial.perimetreInclus = this.coerceToMarkdown(parsed.perimetreInclus)
        partial.perimetreExclus = this.coerceToMarkdown(parsed.perimetreExclus)
        partial.exigencesFonctionnelles = Array.isArray(parsed.exigencesFonctionnelles)
          ? (parsed.exigencesFonctionnelles as CahierAiResult['exigencesFonctionnelles'])
          : []
      } else {
        partial.architectureTechnique = Array.isArray(parsed.architectureTechnique)
          ? (parsed.architectureTechnique as CahierAiResult['architectureTechnique'])
          : []
        partial.livrables = this.coerceToMarkdown(parsed.livrables)
        partial.conclusion = this.coerceToMarkdown(parsed.conclusion)
      }
    }

    // Build a final result, defaulting any missing key to INFO_MANQUANTE so
    // a broken group doesn't produce silent empty fields.
    return {
      objectifDocument: partial.objectifDocument ?? 'INFO_MANQUANTE: section absente du retour IA',
      contexte: partial.contexte ?? 'INFO_MANQUANTE: section absente du retour IA',
      objectifProjet: partial.objectifProjet ?? 'INFO_MANQUANTE: section absente du retour IA',
      perimetreInclus: partial.perimetreInclus ?? 'INFO_MANQUANTE: section absente du retour IA',
      perimetreExclus: partial.perimetreExclus ?? 'INFO_MANQUANTE: section absente du retour IA',
      exigencesFonctionnelles: partial.exigencesFonctionnelles ?? [],
      architectureTechnique: partial.architectureTechnique ?? [],
      livrables: partial.livrables ?? 'INFO_MANQUANTE: section absente du retour IA',
      conclusion: partial.conclusion ?? 'INFO_MANQUANTE: section absente du retour IA',
    }
  }

  // ─── Phase 3 — streaming variant of generateInThreeGroups ──────────────────

  /** Parse a single group's content blob into its three keys, falling back
   *  to INFO_MANQUANTE markers on JSON-parse failure. Returns a Partial
   *  CahierAiResult containing only the keys this group owns. */
  private parseGroupContent(group: CahierSectionGroup, content: string): Partial<CahierAiResult> {
    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(this.stripFences(content)) as Record<string, unknown>
    } catch (e) {
      this.logger.warn(`section-stream parse failed for ${group}: ${e instanceof Error ? e.message : String(e)}`)
    }
    if (group === 'intro') {
      return {
        objectifDocument: this.coerceToMarkdown(parsed.objectifDocument),
        contexte: this.coerceToMarkdown(parsed.contexte),
        objectifProjet: this.coerceToMarkdown(parsed.objectifProjet),
      }
    }
    if (group === 'scope') {
      return {
        perimetreInclus: this.coerceToMarkdown(parsed.perimetreInclus),
        perimetreExclus: this.coerceToMarkdown(parsed.perimetreExclus),
        exigencesFonctionnelles: Array.isArray(parsed.exigencesFonctionnelles)
          ? (parsed.exigencesFonctionnelles as CahierAiResult['exigencesFonctionnelles'])
          : [],
      }
    }
    return {
      architectureTechnique: Array.isArray(parsed.architectureTechnique)
        ? (parsed.architectureTechnique as CahierAiResult['architectureTechnique'])
        : [],
      livrables: this.coerceToMarkdown(parsed.livrables),
      conclusion: this.coerceToMarkdown(parsed.conclusion),
    }
  }

  /** True when CAHIER_STREAM_SECTIONS=on — the SSE preview endpoint emits per
   *  group; when off, it falls through to a single complete-event so clients
   *  written against the streaming endpoint still work. Default 'on' — section
   *  mode is the well-tested path and gives the PM partial content faster. */
  isSectionStreamingEnabled(): boolean {
    return (this.config.get<string>('CAHIER_STREAM_SECTIONS') ?? 'on').toLowerCase() === 'on'
  }

  /**
   * Stream the cahier as 3 parallel groups (intro / scope / delivery). Each
   * group's parsed keys are emitted as soon as the LLM call lands; the final
   * grounded result is emitted in a `complete` event after all 3 settle.
   *
   * Trade-offs vs `generateCahierContent`:
   *   - 3× LLM calls instead of one planner-worker single-shot. Costs more
   *     tokens but gives the PM first content in ~7s vs ~25s.
   *   - Skips the self-critique pass (would add ~90s and undo the streaming
   *     UX win). The grounding regex still runs on each group.
   *   - Requires Z.AI; throws if AI_FALLBACK_API_KEY is unset.
   *
   * `onEvent` is invoked synchronously in arrival order — the caller is
   * responsible for serialising writes to the SSE wire. `signal` lets the
   * controller abort early on client disconnect (the in-flight Z.AI calls
   * are not actually cancellable, but the rest of the pipeline stops).
   */
  async streamCahierContent(
    formData: CahierFormData,
    transcripts: CahierTranscriptInput[],
    projectId: string,
    onEvent: (e: CahierStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!this.zaiFallback.isConfigured()) {
      onEvent({ type: 'error', message: 'streaming requires Z.AI provider (AI_FALLBACK_API_KEY)' })
      return
    }
    // Pre-flight gates — same as generateCahierContent. Throw HTTP errors
    // BEFORE opening the stream so the controller can translate them to a
    // normal HTTP 4xx response rather than an aborted SSE stream.
    await this.assertDriverFieldsFilled(projectId)
    const promptBudget = this.estimateCahierPromptTokens(formData, transcripts)
    await this.aiUsage.assertWithinDailyBudget(projectId, promptBudget + 8_000)

    // Build past-feedback + previous-cahier context, same as the non-stream path.
    const pastFeedback = await this.getPastFeedback(projectId).catch(() => [])
    let previousCorrectedCahier: unknown = null
    try {
      const persisted = await this.getPersistedCahier(projectId)
      if (persisted.aiContent) previousCorrectedCahier = persisted.aiContent
    } catch {
      /* best-effort */
    }
    const userPrompt = this.buildUserPrompt(formData, transcripts, pastFeedback, previousCorrectedCahier)
    const corpus = this.buildSourceCorpus(formData, transcripts, previousCorrectedCahier)

    const startedAt = Date.now()
    onEvent({ type: 'started', totalGroups: 3, transcriptCount: transcripts.length })

    const groups: CahierSectionGroup[] = ['intro', 'scope', 'delivery']
    const merged: Partial<CahierAiResult> = {}
    let totalPrompt = 0
    let totalCompletion = 0
    let abortRequested = false
    if (signal) {
      signal.addEventListener('abort', () => { abortRequested = true }, { once: true })
    }

    // Fire the 3 calls in parallel; emit each as it lands. Map promises so we
    // can race them with Promise.allSettled while still preserving group order
    // in the typed merge below.
    const tasks = groups.map(async (g) => {
      const groupStart = Date.now()
      try {
        const sys = this.buildGroupSystemPrompt(g)
        const usage = await this.zaiFallback.chatWithUsage(sys, userPrompt, {
          maxTokens: 4096,
          temperature: 0.1,
        })
        if (abortRequested) return
        totalPrompt += usage.promptTokens
        totalCompletion += usage.completionTokens
        const parsedPartial = this.parseGroupContent(g, usage.content)
        // Apply the deterministic grounding regex on a synthetic full-result
        // restricted to this group's keys, then re-extract just those keys.
        const groundedFull = this.applyGroundingCheck(
          { ...this.emptyResult(), ...parsedPartial },
          corpus,
        )
        const groundedPartial = this.extractGroupKeys(g, groundedFull)
        Object.assign(merged, groundedPartial)
        onEvent({ type: 'section', group: g, partial: groundedPartial, latencyMs: Date.now() - groupStart })
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        this.logger.warn(`stream group ${g} failed: ${message}`)
        onEvent({ type: 'group_error', group: g, message })
      }
    })

    await Promise.allSettled(tasks)

    if (abortRequested) {
      onEvent({ type: 'aborted', reason: 'client_disconnected' })
      return
    }

    // Aggregate AiUsage in one row so the per-project budget tracker doesn't
    // see 3 small writes for a single PM action.
    void this.aiUsage.log({
      projectId,
      provider: 'zai-stream-sections',
      model: this.config.get<string>('AI_FALLBACK_MODEL') ?? 'glm-4.5-air',
      feature: 'cahier',
      promptTokens: totalPrompt,
      completionTokens: totalCompletion,
      durationMs: Date.now() - startedAt,
      success: true,
    })

    // Fill any missing keys with INFO_MANQUANTE so the saved cahier never
    // contains undefined fields (matches generateInThreeGroups behaviour).
    const fullResult: CahierAiResult = {
      objectifDocument: merged.objectifDocument ?? 'INFO_MANQUANTE: section absente du retour IA',
      contexte: merged.contexte ?? 'INFO_MANQUANTE: section absente du retour IA',
      objectifProjet: merged.objectifProjet ?? 'INFO_MANQUANTE: section absente du retour IA',
      perimetreInclus: merged.perimetreInclus ?? 'INFO_MANQUANTE: section absente du retour IA',
      perimetreExclus: merged.perimetreExclus ?? 'INFO_MANQUANTE: section absente du retour IA',
      exigencesFonctionnelles: merged.exigencesFonctionnelles ?? [],
      architectureTechnique: merged.architectureTechnique ?? [],
      livrables: merged.livrables ?? 'INFO_MANQUANTE: section absente du retour IA',
      conclusion: merged.conclusion ?? 'INFO_MANQUANTE: section absente du retour IA',
    }
    onEvent({ type: 'complete', aiContent: fullResult, durationMs: Date.now() - startedAt })
  }

  /** Just the keys belonging to one group, pulled out of a full result. */
  private extractGroupKeys(group: CahierSectionGroup, full: CahierAiResult): Partial<CahierAiResult> {
    if (group === 'intro') {
      return {
        objectifDocument: full.objectifDocument,
        contexte: full.contexte,
        objectifProjet: full.objectifProjet,
      }
    }
    if (group === 'scope') {
      return {
        perimetreInclus: full.perimetreInclus,
        perimetreExclus: full.perimetreExclus,
        exigencesFonctionnelles: full.exigencesFonctionnelles,
      }
    }
    return {
      architectureTechnique: full.architectureTechnique,
      livrables: full.livrables,
      conclusion: full.conclusion,
    }
  }

  /** Empty placeholder result — used to satisfy applyGroundingCheck's signature
   *  when scanning a single group's keys. The unused fields don't affect the
   *  grounding regex output since it only inspects what's there. */
  private emptyResult(): CahierAiResult {
    return {
      objectifDocument: '',
      contexte: '',
      objectifProjet: '',
      perimetreInclus: '',
      perimetreExclus: '',
      exigencesFonctionnelles: [],
      architectureTechnique: [],
      livrables: '',
      conclusion: '',
    }
  }

  // ─── Grounding pass — defensive backstop on the prompt anti-hallucination rule ─

  /**
   * Build a normalized lowercase corpus from every source the model was given.
   * Used to test whether a claim in the AI output is actually sourced.
   */
  private buildSourceCorpus(
    formData: CahierFormData,
    transcripts: CahierTranscriptInput[],
    previousCorrectedCahier?: unknown,
  ): string {
    const parts: string[] = []
    parts.push(formData.projectName, formData.clientName, formData.projectManagerName)
    for (const f of formData.fields) {
      if (f.label) parts.push(f.label)
      if (f.value) parts.push(f.value)
    }
    for (const t of transcripts) {
      if (t.fullText) parts.push(t.fullText)
      if (t.aiSummary) parts.push(t.aiSummary)
      for (const a of t.actionItems) parts.push(a.description)
      for (const d of t.decisions) parts.push(d.description)
    }
    if (previousCorrectedCahier && typeof previousCorrectedCahier === 'object') {
      try {
        parts.push(JSON.stringify(previousCorrectedCahier))
      } catch {
        /* ignore */
      }
    }
    return parts.filter(Boolean).join('\n').toLowerCase()
  }

  /**
   * The list of tech/product names we screen for. The check is one-way: if
   * the AI mentions a name from this list AND it doesn't appear in the
   * source corpus, we rewrite the mention to an INFO_MANQUANTE marker.
   * We never object to a name we don't know about — that's the prompt's job.
   */
  // Tech / product names. Removed bare-3-letter or French-collision names
  // ("vue", "java", "ruby", "rust", "tableau", "express", "remix", "sap",
  // "rails", "sns", "mongo", "saml") that false-positive on common French
  // text. Use the disambiguated long form ("vue.js", "java spring",
  // "tableau software") which is what an actual cahier should say anyway.
  private static readonly KNOWN_TECH_NAMES = [
    // Databases
    'postgresql', 'postgres', 'mysql', 'mariadb', 'sql server', 'mssql',
    'mongodb', 'redis', 'elasticsearch', 'cassandra', 'dynamodb', 'firebase',
    // Cloud
    'aws', 'azure', 'gcp', 'google cloud', 'ovh', 'scaleway', 'digitalocean', 'heroku',
    // Containers
    'docker', 'kubernetes', 'k8s', 'openshift', 'rancher',
    // Frontend frameworks (disambiguated)
    'vue.js', 'reactjs', 'react.js', 'angular', 'svelte', 'next.js', 'nuxt',
    // Backend frameworks
    '.net core', 'asp.net', 'nestjs', 'spring boot', 'django', 'fastapi',
    'laravel', 'symfony',
    // Languages (disambiguated when ambiguous)
    'typescript', 'javascript', 'golang', 'c#',
    // Messaging / streaming
    'kafka', 'rabbitmq',
    // Auth / payment
    'oauth', 'okta', 'auth0', 'stripe', 'paypal', 'adyen',
    // Doc / signature
    'docusign', 'adobe sign', 'yousign',
    // Enterprise
    'salesforce', 'sharepoint', 'oracle erp', 'dynamics 365',
    // Analytics
    'power bi', 'looker', 'metabase', 'grafana',
    // AI providers
    'openai', 'anthropic', 'gemini', 'azure openai', 'mistral',
  ]

  /**
   * Scan a string for ungrounded tech/product names and replace each with
   * an INFO_MANQUANTE marker. Idempotent — running it twice gives the same
   * result.
   *
   * BOTH the corpus and the output use word-boundary matching. Without
   * boundaries on the corpus side, common French words become false
   * positives: "vue" in "point de vue", "tableau" (the French word),
   * "java" inside "javascript". Those would all silently mark a tech
   * mention as "grounded" when nothing tech-related was actually said.
   */
  private rewriteUngroundedString(input: string, corpus: string): string {
    if (!input) return input
    let out = input
    for (const tech of CahierDesChargesService.KNOWN_TECH_NAMES) {
      const escaped = tech.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      // Whole-word check against the corpus: tech must appear as a token,
      // not as a substring of an unrelated French word.
      const corpusRe = new RegExp(`(^|[^a-zA-Z0-9])${escaped}(?=[^a-zA-Z0-9]|$)`, 'i')
      if (corpusRe.test(corpus)) continue
      // Same boundary rule applied to the AI output.
      const outRe = new RegExp(`(^|[^a-zA-Z0-9])(${escaped})(?=[^a-zA-Z0-9]|$)`, 'gi')
      out = out.replace(outRe, (_m, lead) => `${lead}[INFO_MANQUANTE: ${tech} non confirmé dans la source]`)
    }
    return out
  }

  /**
   * Apply the grounding check to every text field in the cahier result.
   * Tech/product names that don't appear in the source corpus are replaced
   * with explicit INFO_MANQUANTE markers so the PM can spot inventions.
   */
  private applyGroundingCheck(result: CahierAiResult, corpus: string): CahierAiResult {
    const groundString = (s: string): string => this.rewriteUngroundedString(s, corpus)
    return {
      objectifDocument: groundString(result.objectifDocument),
      contexte: groundString(result.contexte),
      objectifProjet: groundString(result.objectifProjet),
      perimetreInclus: groundString(result.perimetreInclus),
      perimetreExclus: groundString(result.perimetreExclus),
      exigencesFonctionnelles: result.exigencesFonctionnelles.map((s) => ({
        title: groundString(s.title),
        content: groundString(s.content),
      })),
      architectureTechnique: result.architectureTechnique.map((s) => ({
        title: groundString(s.title),
        content: groundString(s.content),
      })),
      livrables: groundString(result.livrables),
      conclusion: groundString(result.conclusion),
    }
  }

  // ─── Two-pass self-critique — second AI call reviews + corrects the first ────

  /**
   * Send the freshly-generated cahier back to the AI along with the source,
   * with strict "flag anything not in source" instructions. The critique
   * pass returns either the same cahier (no fix needed) or a corrected
   * version with INFO_MANQUANTE markers replacing invented content.
   *
   * Best-effort: failures fall back to the un-critiqued cahier silently.
   * Uses Z.AI by default to keep cost low.
   */
  private async runSelfCritique(
    candidate: CahierAiResult,
    formData: CahierFormData,
    transcripts: CahierTranscriptInput[],
    projectId?: string,
  ): Promise<CahierAiResult> {
    if (!this.zaiFallback.isConfigured()) return candidate

    // Cheap budget gate — critique adds ~one round-trip.
    if (projectId) {
      try {
        await this.aiUsage.assertWithinDailyBudget(projectId, 8_000)
      } catch {
        return candidate
      }
    }

    const sourceBlock = this.buildUserPrompt(formData, transcripts)
    const candidateJson = JSON.stringify(candidate)
    const trimmedSource = sourceBlock.length > 12_000 ? sourceBlock.slice(0, 12_000) + ' [trunc]' : sourceBlock
    const trimmedCandidate = candidateJson.length > 16_000 ? candidateJson.slice(0, 16_000) + ' [trunc]' : candidateJson

    const CRITIQUE_PROMPT = `Tu es un relecteur strict. Tu reçois (1) une SOURCE brute (questionnaire + réunions) et (2) un CAHIER DES CHARGES généré par une IA précédente.

Ta seule tâche : retourner le même JSON 9-clés, MAIS toute affirmation NON présente dans la SOURCE doit être remplacée par exactement \`INFO_MANQUANTE: <sujet>\`.

Sont considérés comme "affirmations à vérifier" : noms d'entreprises tierces, technologies, frameworks, bases de données, volumes chiffrés (utilisateurs, documents, GB...), dates, KPIs, formats de livrables, modules fonctionnels concrets, contraintes réglementaires nommées.

Tu NE supprimes RIEN d'autre. Tu NE reformules PAS le style. Tu remplaces UNIQUEMENT les affirmations non sourcées par le marqueur. Retourne UNIQUEMENT le JSON (pas de code fences).`

    const userMessage = `# SOURCE\n${trimmedSource}\n\n# CAHIER À RELIRE\n${trimmedCandidate}`

    try {
      const usage = await this.zaiFallback.chatWithUsage(CRITIQUE_PROMPT, userMessage, {
        maxTokens: 8192,
        temperature: 0.1,
      })
      void this.aiUsage.log({
        projectId: projectId ?? null,
        provider: 'zai-critique',
        model: this.config.get<string>('AI_FALLBACK_MODEL') ?? 'glm-4.5-air',
        feature: 'cahier',
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        durationMs: 0,
        success: true,
      })
      const corrected = this.parseCahierResult(usage.content)
      // Sanity: if the critique returns something obviously broken (every
      // section is INFO_MANQUANTE because the model misunderstood), fall
      // back to the candidate. The candidate already went through the
      // deterministic tech grounding check, so it's safe.
      const totalLen = Object.values(corrected).reduce<number>((acc, v) => acc + (typeof v === 'string' ? v.length : 0), 0)
      if (totalLen < 200) return candidate
      return corrected
    } catch (e) {
      this.logger.warn(`runSelfCritique failed (using uncritiqued result): ${e instanceof Error ? e.message : String(e)}`)
      return candidate
    }
  }

  /**
   * Dispatch one cahier completion call by provider name. Z.AI uses the
   * existing `chat()` helper (forces JSON mode); OpenAI/Gemini use the
   * older private call helpers below.
   *
   * Returns both the parsed result and the real token usage so AiUsage logs
   * actual spend, not a fixed 1500-token estimate.
   */
  private async callCahierProvider(
    name: string,
    userPrompt: string,
  ): Promise<{ result: CahierAiResult; promptTokens: number; completionTokens: number }> {
    if (name === 'zai') {
      // 0.1 (was the chatWithUsage default of 0.4) — see comment above.
      const usage = await this.zaiFallback.chatWithUsage(SYSTEM_PROMPT, userPrompt, { temperature: 0.1 })
      return {
        result: this.parseCahierResult(usage.content),
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
      }
    }
    if (name === 'gemini') return this.callGemini(userPrompt)
    return this.callOpenAi(userPrompt)
  }

  private async callOpenAi(
    userPrompt: string,
  ): Promise<{ result: CahierAiResult; promptTokens: number; completionTokens: number }> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY')
    if (!apiKey) throw new BadRequestException('OPENAI_API_KEY non configurée')

    // Support Azure OpenAI endpoint if configured
    const azureEndpoint = this.config.get<string>('AZURE_OPENAI_ENDPOINT')
    const azureDeployment = this.config.get<string>('AZURE_OPENAI_DEPLOYMENT')
    const azureApiVersion = this.config.get<string>('AZURE_OPENAI_API_VERSION', '2024-08-01-preview')

    let url: string
    let headers: Record<string, string>

    if (azureEndpoint && azureDeployment) {
      // Azure OpenAI
      url = `${azureEndpoint}/openai/deployments/${azureDeployment}/chat/completions?api-version=${azureApiVersion}`
      headers = { 'Content-Type': 'application/json', 'api-key': apiKey }
      this.logger.log('Using Azure OpenAI endpoint')
    } else {
      // Standard OpenAI or OpenAI-compatible (ZAI, etc.) via OPENAI_BASE_URL
      const baseUrl = this.config.get<string>('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1'
      url = `${baseUrl}/chat/completions`
      headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }
    }

    const model = this.config.get<string>('CAHIER_AI_MODEL', 'gpt-4o-mini')

    const response = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(180_000), // 3 min timeout — big prompt + slow models
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        // 0.1 (was 0.4) — kills most "creative gap-filling" while keeping
        // phrasing flexible. Hallucination drops sharply at low temperature.
        temperature: 0.1,
        max_tokens: 8192,
        response_format: { type: 'json_object' },
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      this.logger.error(`AI API error: ${response.status} ${text.slice(0, 300)}`)
      throw new BadRequestException(`Erreur API IA (${response.status})`)
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const content = data?.choices?.[0]?.message?.content ?? ''
    return {
      result: this.parseCahierResult(content),
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    }
  }

  private async callGemini(
    userPrompt: string,
  ): Promise<{ result: CahierAiResult; promptTokens: number; completionTokens: number }> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY')
    if (!apiKey) throw new BadRequestException('GEMINI_API_KEY non configurée')

    const model = this.config.get<string>('CAHIER_GEMINI_MODEL', 'gemini-1.5-flash')
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

    const response = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(120_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${SYSTEM_PROMPT}\n\n${userPrompt}` }] }],
        // 0.1 (was 0.4) — kills most "creative gap-filling" while keeping
        // phrasing flexible. Hallucination drops sharply at low temperature.
        generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      this.logger.error(`Gemini API error: ${response.status} ${text.slice(0, 300)}`)
      throw new BadRequestException(`Erreur API Gemini (${response.status})`)
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
    }
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    return {
      result: this.parseCahierResult(content),
      promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    }
  }

  /** Coerce AI output (which may be string, array, object) into a markdown string.
   *  The system prompt asks for markdown strings but some models (e.g. glm-4.5-air)
   *  sometimes return arrays/objects — normalize them so downstream consumers see a string. */
  private coerceToMarkdown(v: unknown): string {
    // Anti-hallucination: when the AI omits a key entirely we surface a
    // marker the next preflight catches, instead of a silent "À définir"
    // which masks the gap and lets a half-baked cahier ship.
    if (v === null || v === undefined) return 'INFO_MANQUANTE: section absente du retour IA'
    if (typeof v === 'string') return v
    if (Array.isArray(v)) {
      if (v.length === 0) return 'INFO_MANQUANTE: section vide dans le retour IA'
      // Array of strings → bullet list
      if (v.every((item) => typeof item === 'string')) {
        return v.map((item) => `- ${item}`).join('\n')
      }
      // Array of {title, content} → titled sections
      if (v.every((item) => item && typeof item === 'object' && 'title' in (item as object) && 'content' in (item as object))) {
        return v
          .map((item) => {
            const rec = item as { title: unknown; content: unknown }
            return `**${String(rec.title)}**\n${this.coerceToMarkdown(rec.content)}`
          })
          .join('\n\n')
      }
      // Heterogeneous array → coerce each element
      return v.map((item) => this.coerceToMarkdown(item)).join('\n\n')
    }
    if (typeof v === 'object') {
      try {
        return JSON.stringify(v)
      } catch {
        return String(v)
      }
    }
    return String(v)
  }

  /** Best-effort cleanup of AI output before JSON.parse — strips code fences + trailing noise. */
  private stripFences(content: string): string {
    let s = content.trim()
    // Remove ```json ... ``` or ``` ... ``` wrappers (possibly with leading text)
    const fenceMatch = s.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i)
    if (fenceMatch) s = fenceMatch[1]
    // Keep only from first `{` to last `}` if there's prose before/after
    const firstBrace = s.indexOf('{')
    const lastBrace = s.lastIndexOf('}')
    if (firstBrace >= 0 && lastBrace > firstBrace) s = s.slice(firstBrace, lastBrace + 1)
    return s.trim()
  }

  /**
   * Recover when the AI slips unquoted markdown tokens into JSON. Classic failure:
   *   "perimetreInclus": [
   *     **Déployer la plateforme
   *   ]
   * We salvage by joining array items back into a markdown string, preserving content.
   */
  private tryRecoverJson(raw: string): string {
    let s = raw
    // Replace `key: [ ... ]` where the array contains unquoted/starred bullets, with a joined string
    s = s.replace(
      /"([a-zA-Z]+)":\s*\[\s*([^\[\]]*?)\s*\]/g,
      (match, key, body) => {
        // If body already parses as a valid JSON array content, keep it
        try {
          JSON.parse(`[${body}]`)
          return match
        } catch {
          // Turn bullet-like entries into a single joined string
          const joined = body
            .split(/\n+/)
            .map((line: string) => line.trim().replace(/^-\s*/, ''))
            .filter(Boolean)
            .map((line: string) => `- ${line}`)
            .join('\\n')
            .replace(/"/g, '\\"')
          return `"${key}": "${joined}"`
        }
      },
    )
    return s
  }

  private parseCahierResult(content: string): CahierAiResult {
    const cleaned = this.stripFences(content)

    let parsed: Partial<Record<keyof CahierAiResult, unknown>> | null = null
    // Attempt 1: direct parse
    try {
      parsed = JSON.parse(cleaned) as typeof parsed
    } catch {
      // Attempt 2: recover from unquoted markdown inside arrays
      try {
        parsed = JSON.parse(this.tryRecoverJson(cleaned)) as typeof parsed
        this.logger.warn('Parsed AI response on retry (recovered from malformed arrays)')
      } catch (e2) {
        this.logger.error(`Failed to parse AI response for cahier: ${content.slice(0, 500)}`)
        throw new BadRequestException(`Réponse IA invalide : ${(e2 as Error).message}`)
      }
    }

    const p: Partial<Record<keyof CahierAiResult, unknown>> = parsed ?? {}
    return {
      objectifDocument: this.coerceToMarkdown(p.objectifDocument),
      contexte: this.coerceToMarkdown(p.contexte),
      objectifProjet: this.coerceToMarkdown(p.objectifProjet),
      perimetreInclus: this.coerceToMarkdown(p.perimetreInclus),
      perimetreExclus: this.coerceToMarkdown(p.perimetreExclus),
      exigencesFonctionnelles: Array.isArray(p.exigencesFonctionnelles) ? (p.exigencesFonctionnelles as CahierAiResult['exigencesFonctionnelles']) : [],
      architectureTechnique: Array.isArray(p.architectureTechnique) ? (p.architectureTechnique as CahierAiResult['architectureTechnique']) : [],
      livrables: this.coerceToMarkdown(p.livrables),
      conclusion: this.coerceToMarkdown(p.conclusion),
    }
  }

  // ─── 4. Generate DOCX ─────────────────────────────────────────────────────

  async generateDocx(projectId: string): Promise<{ buffer: Buffer; fileName: string }> {
    // Gather data
    const { formData, transcripts } = await this.gatherProjectData(projectId)

    if (transcripts.length === 0 && formData.fields.length === 0) {
      throw new BadRequestException(
        'Aucune donnée disponible pour générer le cahier des charges. Remplissez le questionnaire ou ajoutez une transcription.',
      )
    }

    // Call AI (with past feedback for learning)
    const aiContent = await this.generateCahierContent(formData, transcripts, projectId)

    // Build DOCX payload
    const payload: CahierDocxPayload = {
      formData,
      aiContent,
      generatedAt: new Date().toISOString(),
    }

    // Generate DOCX via the Node.js docx-js builder
    const { generateCahierDocx } = await import('./docx-builder.js')
    const buffer = await generateCahierDocx(payload)

    const safeName = formData.projectName
      .replace(/[^a-zA-Z0-9àâäéèêëïîôùûüÿçÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 50)

    const fileName = `Cahier-des-charges_${safeName}_${new Date().toISOString().slice(0, 10)}.docx`

    return { buffer: Buffer.from(buffer), fileName }
  }
}
