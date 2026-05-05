import { Injectable, Logger, BadGatewayException, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';

export type ChecklistStatus = 'covered' | 'partial' | 'missing';
export type ChecklistCategory =
  | 'context'
  | 'users'
  | 'features'
  | 'constraints'
  | 'integrations'
  | 'security'
  | 'timeline'
  | 'other';

export interface ChecklistItem {
  id: string;
  category: ChecklistCategory;
  question: string;
  status: ChecklistStatus;
  evidence?: string | null;
}

export interface ChecklistResponse {
  checklist: ChecklistItem[];
  readyForCahier: boolean;
  /** Optional one-line nudge to the PM. */
  hint?: string | null;
}

const VALID_STATUSES: ChecklistStatus[] = ['covered', 'partial', 'missing'];
const VALID_CATEGORIES: ChecklistCategory[] = [
  'context',
  'users',
  'features',
  'constraints',
  'integrations',
  'security',
  'timeline',
  'other',
];

const SYSTEM_PROMPT = `Tu es un assistant IA expert en gestion de projet, présent en silence pendant une réunion entre un chef de projet (PM) et un client.

Ton rôle : maintenir une CHECKLIST PERSONNALISÉE des informations à collecter pour produire ensuite un cahier des charges et un backlog parfaits POUR CE PROJET PRÉCIS.

À chaque appel, on te fournit :
- Le contexte du projet (nom, cahier des charges existant)
- La transcription accumulée jusqu'ici
- La checklist précédente (peut être vide au tout premier appel)

Mission :
1. Si la checklist précédente est VIDE : génère 8 à 14 items adaptés au projet, couvrant : utilisateurs cibles, fonctionnalités principales, intégrations, contraintes techniques, sécurité, volumétrie, échéances, livrables, méthode de validation. Ne mets que des items VRAIMENT pertinents pour ce projet.
2. Si la checklist existe : conserve les mêmes "id" (stables), mets à jour le "status" de chaque item :
   - "covered" si la transcription contient une réponse claire et précise
   - "partial" si l'info a été touchée mais reste vague
   - "missing" si rien n'a été dit
   Tu peux AJOUTER 1-2 nouveaux items si la conversation a révélé un sujet imprévu (max 18 items au total). Tu peux aussi reformuler une "question" devenue trop vague.
3. Pour chaque item passant de missing/partial à covered, remplis "evidence" avec une citation courte (≤ 200 caractères) du transcript.
4. "readyForCahier" = true SEULEMENT si TOUS les items sont covered ou partial (aucun missing) ET au moins 70% sont covered.
5. "hint" : 1 phrase courte pour relancer le PM si pertinent (ex : "Demandez les volumes de données.").

Règles strictes :
- Réponds UNIQUEMENT en JSON brut (pas de markdown), au format exact :
  { "checklist": [{ "id": "...", "category": "...", "question": "...", "status": "...", "evidence": "..." }], "readyForCahier": false, "hint": "..." }
- "id" : stable, court (3-12 chars, sans espaces). Réutilise les ids existants quand l'item existe déjà.
- "category" : exactement parmi context | users | features | constraints | integrations | security | timeline | other
- "status" : exactement parmi covered | partial | missing
- Langue : français.`;

@Injectable()
export class LiveMeetingService {
  private readonly logger = new Logger(LiveMeetingService.name);

  /** Per-project cooldown to throttle accidental request bursts. */
  private readonly lastCallAt = new Map<string, number>();
  // Tight enough to feel responsive (the frontend already throttles to once
  // per 6 s) while still catching outright spam from buggy clients.
  private readonly COOLDOWN_MS = 4_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async checklist(
    projectId: string,
    transcript: string,
    previousChecklist: ChecklistItem[] = [],
  ): Promise<ChecklistResponse> {
    const trimmed = (transcript || '').trim();
    if (trimmed.length < 30 && previousChecklist.length === 0) {
      return { checklist: [], readyForCahier: false, hint: 'Démarrez la conversation pour générer la checklist.' };
    }

    const now = Date.now();
    const last = this.lastCallAt.get(projectId) ?? 0;
    if (now - last < this.COOLDOWN_MS) {
      return { checklist: previousChecklist, readyForCahier: false, hint: null };
    }
    // Don't set lastCallAt yet — only after a successful AI call. Otherwise a
    // transient Z.AI 502 burns the cooldown window for 8s, blocking the
    // legitimate retry the client will issue.

    const project = await this.prisma.project.findUnique({
      where: { id: projectId, isDeleted: false },
      select: { id: true, name: true, clientName: true, aiOutput: true },
    });
    if (!project) throw new NotFoundException('Projet non trouvé');

    let cahierExtract = '(aucun cahier des charges existant)';
    if (project.aiOutput) {
      try {
        const parsed = JSON.parse(project.aiOutput) as { aiContent?: unknown };
        if (parsed.aiContent) cahierExtract = JSON.stringify(parsed.aiContent).slice(0, 4000);
      } catch {
        /* ignore */
      }
    }

    const userMessage = [
      `# Projet : ${project.name} (client : ${project.clientName})`,
      '',
      '## Cahier des charges existant (extrait)',
      cahierExtract,
      '',
      '## Transcription accumulée',
      trimmed.slice(-8000),
      '',
      '## Checklist précédente',
      previousChecklist.length === 0
        ? '(vide — c\'est le premier appel, génère la checklist initiale)'
        : JSON.stringify(previousChecklist, null, 2),
    ].join('\n');

    try {
      const raw = await this.callOpenAi(userMessage);
      this.lastCallAt.set(projectId, Date.now()); // success — burn cooldown
      return this.sanitize(raw);
    } catch (e) {
      this.logger.error(`live checklist failed: ${e instanceof Error ? e.message : String(e)}`);
      throw new BadGatewayException("L'assistant IA est temporairement indisponible.");
    }
  }

  private async callOpenAi(userMessage: string): Promise<unknown> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
    const baseUrl = this.config.get<string>('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1';
    const model = this.config.get<string>('AI_MODEL') ?? 'gpt-4o-mini';

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(45_000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.4,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      this.logger.error(`OpenAI checklist error ${response.status}: ${text.slice(0, 200)}`);
      throw new Error(`OpenAI ${response.status}`);
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? '{}';
    try {
      return JSON.parse(content);
    } catch (e) {
      this.logger.error(`OpenAI checklist response was not valid JSON: ${content.slice(0, 200)}`);
      throw new Error(`Réponse IA invalide : ${(e as Error).message}`);
    }
  }

  private sanitize(raw: unknown): ChecklistResponse {
    if (!raw || typeof raw !== 'object') {
      return { checklist: [], readyForCahier: false, hint: null };
    }
    const r = raw as Record<string, unknown>;
    const items = Array.isArray(r.checklist) ? r.checklist : [];
    const checklist: ChecklistItem[] = [];
    for (const it of items.slice(0, 18)) {
      if (!it || typeof it !== 'object') continue;
      const x = it as Record<string, unknown>;
      const id = typeof x.id === 'string' ? x.id.trim().slice(0, 16) : '';
      const question = typeof x.question === 'string' ? x.question.trim().slice(0, 300) : '';
      if (!id || !question) continue;
      const category = (VALID_CATEGORIES as string[]).includes(x.category as string)
        ? (x.category as ChecklistCategory)
        : 'other';
      const status = (VALID_STATUSES as string[]).includes(x.status as string)
        ? (x.status as ChecklistStatus)
        : 'missing';
      const evidence =
        typeof x.evidence === 'string' && x.evidence.trim().length > 0
          ? x.evidence.trim().slice(0, 240)
          : null;
      checklist.push({ id, category, question, status, evidence });
    }
    const readyForCahier =
      checklist.length > 0 &&
      checklist.every((i) => i.status !== 'missing') &&
      checklist.filter((i) => i.status === 'covered').length / checklist.length >= 0.7;
    const hint = typeof r.hint === 'string' ? r.hint.trim().slice(0, 200) : null;
    return { checklist, readyForCahier, hint };
  }

  /**
   * Transcribe a short audio chunk via the local Python Whisper service.
   * Used by the online meeting mode (getDisplayMedia tab capture).
   * Falls back to a plain empty string on service error so the live UI
   * keeps running rather than showing a hard error for every chunk.
   */
  async transcribeChunk(buffer: Buffer, mimeType: string): Promise<{ text: string }> {
    if (!buffer?.length) throw new BadRequestException('Chunk audio vide.');
    if (buffer.length > 25 * 1024 * 1024) {
      throw new BadRequestException('Chunk trop volumineux (> 25 Mo).');
    }

    const serviceUrl = this.config.get<string>('TRANSCRIPTION_URL');
    if (!serviceUrl) throw new BadGatewayException('TRANSCRIPTION_URL non configuré.');

    const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('mp4') ? 'mp4' : 'ogg';
    const form = new FormData();
    form.append('audio', new Blob([buffer as unknown as BlobPart], { type: mimeType }), `chunk.${ext}`);

    const secret = this.config.get<string>('TRANSCRIPTION_SECRET', '');
    const headers: Record<string, string> = {};
    if (secret) headers['x-transcription-secret'] = secret;

    try {
      const response = await fetch(`${serviceUrl}/transcribe`, {
        method: 'POST',
        signal: AbortSignal.timeout(60_000),
        headers,
        body: form,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        this.logger.error(`Transcription chunk error ${response.status}: ${body.slice(0, 200)}`);
        return { text: '' };
      }
      const data = (await response.json()) as { segments?: Array<{ text?: string }> };
      const text = (data.segments ?? []).map((s) => s.text ?? '').join(' ').trim();
      return { text };
    } catch (e) {
      this.logger.warn(`Transcription chunk failed: ${e instanceof Error ? e.message : String(e)}`);
      return { text: '' };
    }
  }

  /** Persist a live-meeting transcript as a regular MeetingTranscript so it
   *  flows through the existing list/AI-analysis pipeline. */
  async saveLiveTranscript(
    projectId: string,
    title: string,
    transcript: string,
    durationSeconds: number,
  ): Promise<{ transcriptId: string }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId, isDeleted: false },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Projet non trouvé');

    const trimmed = transcript.trim().slice(0, 100_000);
    if (trimmed.length < 20) {
      throw new BadRequestException('Transcription trop courte pour être enregistrée.');
    }

    const created = await this.prisma.meetingTranscript.create({
      data: {
        projectId,
        title: title.slice(0, 200) || 'Réunion en direct',
        originalFileName: 'live-meeting.txt',
        durationSeconds: Math.max(0, Math.round(durationSeconds)),
        detectedLanguages: 'fr',
        recordedAt: new Date(),
      },
    });

    await this.prisma.transcriptSegment.create({
      data: {
        transcriptId: created.id,
        speaker: 'PM + invités',
        text: trimmed,
        startTime: 0,
        endTime: Math.max(0, Math.round(durationSeconds)),
        language: 'fr',
        confidence: 1,
      },
    });

    this.logger.log(`saved live meeting transcript ${created.id} for project ${projectId}`);
    return { transcriptId: created.id };
  }
}
