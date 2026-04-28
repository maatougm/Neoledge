import { Injectable, Logger, NotFoundException, BadRequestException, HttpException, HttpStatus } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service.js'
import { ZaiFallbackProvider } from '../ai/providers/zai-fallback.provider.js'
import type {
  CahierFormData,
  CahierTranscriptInput,
  CahierAiResult,
  CahierDocxPayload,
} from './cahier-des-charges.types.js'

// ─── System prompt for cahier des charges generation ─────────────────────────

const SYSTEM_PROMPT = `Tu es expert NeoLedge/Archimed en rédaction de cahiers des charges contractuels (modèle Elise). Entrée au format TOON compact. Retourne UNIQUEMENT un JSON valide (pas de code fences) avec ces 9 clés :
objectifDocument (string), contexte (string), objectifProjet (string, bullets markdown), perimetreInclus (string, bullets), perimetreExclus (string, bullets), exigencesFonctionnelles (array {title,content} — un objet par module fonctionnel), architectureTechnique (array {title,content} — Frontend, Backend, Module IA, etc.), livrables (string, bullets), conclusion (string paragraphe).

STRUCTURE ATTENDUE (inspiré du modèle NeoLedge interne) :
- exigencesFonctionnelles : 4–6 modules, chacun = phrase d'intro + bullets. Exemples courants : "Gestion des projets", "Gestion des tâches", "Visualisation et suivi", "Alertes et notifications", "Module IA générative".
- architectureTechnique : 3–4 composants, chacun = phrase d'intro + technos concrètes. Exemples : "Frontend" (Neoform, PrimeVue / Vue 3 / React), "Backend" (Elise.Automate C#, .NET Core Web API, ou Node/NestJS), "Module IA" (Azure OpenAI, service d'orchestration des prompts), "Base de données" (PostgreSQL / SQL Server).
- livrables : module intégré (Frontend + Backend), base de données + scripts, documentation technique + guide utilisateur, rapport de projet.

RÈGLES JSON STRICTES : tous les textes sont des strings JSON échappées. Pas de \`**\` ni de \`-\` en dehors des strings. Markdown (\`**gras**\`, listes \`- \`, sauts de ligne \\n) autorisé À L'INTÉRIEUR des strings uniquement.
RÈGLES CONTENU : français, ton contractuel professionnel, exhaustif. Réutilise le vocabulaire Elise/GED/Neoform/Elise.Automate si le type de projet le justifie. "À définir" si info manquante. Conclusion = paragraphe synthétique sans liste.`

@Injectable()
export class CahierDesChargesService {
  private readonly logger = new Logger(CahierDesChargesService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly zaiFallback: ZaiFallbackProvider,
  ) {}

  // ─── 1. Gather all project data ────────────────────────────────────────────

  async gatherProjectData(projectId: string): Promise<{
    formData: CahierFormData
    transcripts: CahierTranscriptInput[]
  }> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, isDeleted: false },
      include: {
        projectManager: { select: { firstName: true, lastName: true } },
        fields: { orderBy: { orderIndex: 'asc' } },
        fieldValues: { include: { field: true } },
        transcripts: {
          include: {
            segments: { orderBy: { startTime: 'asc' } },
            actionItems: true,
            decisions: true,
          },
          orderBy: { createdAt: 'desc' },
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
      budget: project.budget?.toString() ?? null,
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

  /** Persist a generated cahier JSON in Project.aiOutput + notify review teams. */
  async savePersistedCahier(projectId: string, aiContent: unknown): Promise<void> {
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

    // Write an activity row so the admin / project activity feed updates live
    void this.prisma.projectActivity
      .create({
        data: {
          projectId,
          userId: null,
          action: 'cahier_generated',
          detail: `Cahier des charges généré par l'IA (${Math.round(payload.length / 1024)} Ko)`,
        },
      })
      .catch((e) => this.logger.warn(`activity log failed: ${e instanceof Error ? e.message : e}`))

    // Notify SpecificationTeam (the approvers) that a cahier is ready to review.
    // We also include Member + DeploymentTeam since they validate downstream phases.
    // Only fire notifications on the FIRST save (aiOutput was null) OR on regenerations
    // so reviewers always know fresh content is available.
    void this.notifyReviewTeams(project.id, project.name).catch((e) =>
      this.logger.warn(`notifyReviewTeams failed: ${e instanceof Error ? e.message : String(e)}`),
    )
  }

  /** Notify only the SpecificationTeam — they're the sole approvers of the cahier. */
  private async notifyReviewTeams(projectId: string, projectName: string): Promise<void> {
    const reviewers = await this.prisma.appUser.findMany({
      where: {
        role: 'SpecificationTeam',
        isActive: true,
      },
      select: { id: true },
    })
    if (reviewers.length === 0) return

    const rows = reviewers.map((u) => ({
      id: crypto.randomUUID(),
      userId: u.id,
      type: 'cahier_ready',
      reason: 'cahier_generated',
      title: 'Cahier des charges à valider',
      message: `Un nouveau cahier des charges a été généré pour « ${projectName} ». À vérifier.`,
      projectId,
      entityType: 'Project',
      entityId: projectId,
      link: `/app/pm/projects/${projectId}`,
      isRead: false,
    }))
    await this.prisma.notification.createMany({ data: rows })
    this.logger.log(`Notified ${reviewers.length} SpecificationTeam user(s) about cahier for project ${projectId}`)
  }

  /**
   * When the SpecificationTeam APPROVES the cahier, hand the full package over to
   * the DeploymentTeam (questionnaire + transcripts + approved cahier). They get
   * one notification per active DeploymentTeam user.
   */
  async notifyDeploymentOnApproval(projectId: string): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true },
    })
    const deployers = await this.prisma.appUser.findMany({
      where: { role: 'DeploymentTeam', isActive: true },
      select: { id: true },
    })
    if (deployers.length === 0 || !project) return

    const rows = deployers.map((u) => ({
      id: crypto.randomUUID(),
      userId: u.id,
      type: 'cahier_approved',
      reason: 'cahier_approved',
      title: 'Cahier des charges approuvé — à déployer',
      message: `Le cahier de « ${project.name} » a été approuvé par l'équipe de spécification. Questionnaire, transcriptions et cahier consultables.`,
      projectId,
      entityType: 'Project',
      entityId: projectId,
      link: `/app/pm/projects/${projectId}`,
      isRead: false,
    }))
    await this.prisma.notification.createMany({ data: rows })
    this.logger.log(`Notified ${deployers.length} DeploymentTeam user(s) about approval for project ${projectId}`)
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
    if (formData.budget) parts.push(`budget: ${formData.budget}`)

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
        const txt = t.fullText.length > maxChars
          ? t.fullText.slice(0, maxChars) + ' [trunc]'
          : t.fullText
        parts.push(`transcript: ${txt}`)
      }
    }

    // ── Past feedback — compact ──
    if (pastFeedback && pastFeedback.length > 0) {
      parts.push(`\n# FEEDBACK_PRECEDENT[${pastFeedback.length}] (erreurs a corriger, ne pas repeter):`)
      for (const fb of pastFeedback) parts.push(`- ${fb}`)
    }

    return parts.join('\n')
  }

  // ─── 3. Call AI provider ───────────────────────────────────────────────────

  async generateCahierContent(
    formData: CahierFormData,
    transcripts: CahierTranscriptInput[],
    projectId?: string,
  ): Promise<CahierAiResult> {
    const provider = this.config.get<string>('AI_PROVIDER', 'openai').toLowerCase()

    // Driver-fields gate — block if any field marked "alimente l'IA" has no answer.
    if (projectId) {
      await this.assertDriverFieldsFilled(projectId)
    }

    // Fetch past feedback to inject into prompt (AI learning)
    let pastFeedback: string[] = []
    if (projectId) {
      pastFeedback = await this.getPastFeedback(projectId)
      if (pastFeedback.length > 0) {
        this.logger.log(`Including ${pastFeedback.length} past feedback items for AI learning`)
      }
    }

    const userPrompt = this.buildUserPrompt(formData, transcripts, pastFeedback)

    this.logger.log(`Generating cahier des charges (provider: ${provider}, prompt length: ${userPrompt.length} chars)`)

    try {
      if (provider === 'gemini') {
        return await this.callGemini(userPrompt)
      }
      return await this.callOpenAi(userPrompt)
    } catch (primaryErr: unknown) {
      if (!this.zaiFallback.isConfigured()) throw primaryErr
      const msg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr)
      this.logger.warn(`Primary cahier provider (${provider}) failed: ${msg.slice(0, 200)} — falling back to Z.AI`)
      const content = await this.zaiFallback.chat(SYSTEM_PROMPT, userPrompt)
      return this.parseCahierResult(content)
    }
  }

  private async callOpenAi(userPrompt: string): Promise<CahierAiResult> {
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
        temperature: 0.4,
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
    }
    const content = data?.choices?.[0]?.message?.content ?? ''
    return this.parseCahierResult(content)
  }

  private async callGemini(userPrompt: string): Promise<CahierAiResult> {
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
        generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      this.logger.error(`Gemini API error: ${response.status} ${text.slice(0, 300)}`)
      throw new BadRequestException(`Erreur API Gemini (${response.status})`)
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    return this.parseCahierResult(content)
  }

  /** Coerce AI output (which may be string, array, object) into a markdown string.
   *  The system prompt asks for markdown strings but some models (e.g. glm-4.5-air)
   *  sometimes return arrays/objects — normalize them so downstream consumers see a string. */
  private coerceToMarkdown(v: unknown): string {
    if (v === null || v === undefined) return 'À définir'
    if (typeof v === 'string') return v
    if (Array.isArray(v)) {
      if (v.length === 0) return 'À définir'
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
