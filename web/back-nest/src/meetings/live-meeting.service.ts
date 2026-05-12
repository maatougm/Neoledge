import { Injectable, Logger, BadGatewayException, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class LiveMeetingService {
  private readonly logger = new Logger(LiveMeetingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Transcribe a short audio chunk via the local Python Whisper service.
   * Used by the online meeting mode (getDisplayMedia tab capture).
   * Falls back to a plain empty string on service error so the live UI
   * keeps running rather than showing a hard error for every chunk.
   */
  async transcribeChunk(buffer: Buffer, mimeType: string): Promise<{ text: string; language: string | null }> {
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
        return { text: '', language: null };
      }
      const data = (await response.json()) as {
        segments?: Array<{ text?: string; language?: string }>
        detected_languages?: string[]
      };
      const text = (data.segments ?? []).map((s) => s.text ?? '').join(' ').trim();
      // Whisper detects per-segment language; surface whichever appears most often
      // in this chunk so the frontend can aggregate the meeting-level set.
      const langCount = new Map<string, number>();
      for (const s of data.segments ?? []) {
        if (s.language) langCount.set(s.language, (langCount.get(s.language) ?? 0) + 1);
      }
      let dominant: string | null = null;
      let bestCount = 0;
      for (const [l, c] of langCount) {
        if (c > bestCount) { dominant = l; bestCount = c; }
      }
      // Fallback: if no segment-level language, take the first from detected_languages.
      if (!dominant && data.detected_languages?.length) dominant = data.detected_languages[0];
      return { text, language: dominant };
    } catch (e) {
      this.logger.warn(`Transcription chunk failed: ${e instanceof Error ? e.message : String(e)}`);
      return { text: '', language: null };
    }
  }

  /** Persist a live-meeting transcript as a regular MeetingTranscript so it
   *  flows through the existing list/AI-analysis pipeline. */
  async saveLiveTranscript(
    projectId: string,
    title: string,
    transcript: string,
    durationSeconds: number,
    meetingType?: string,
    detectedLanguages?: string[],
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

    const VALID_TYPES = new Set(['kickoff', 'cadrage', 'validation', 'standup', 'retrospective', 'other']);
    const safeType = meetingType && VALID_TYPES.has(meetingType) ? meetingType : null;

    // Sanitize the language list — keep only "ar" / "fr" / "en" tokens the
    // Whisper backend actually emits. Falls back to "fr" when nothing valid
    // arrived (better than mis-tagging the meeting as no-language).
    const VALID_LANGS = new Set(['ar', 'fr', 'en']);
    const cleanLangs = (detectedLanguages ?? [])
      .map((l) => (typeof l === 'string' ? l.toLowerCase().slice(0, 2) : ''))
      .filter((l) => VALID_LANGS.has(l));
    const uniqueLangs = [...new Set(cleanLangs)];
    const detectedLangsCsv = uniqueLangs.length > 0 ? uniqueLangs.join(',') : 'fr';
    const primaryLang = uniqueLangs[0] ?? 'fr';

    const created = await this.prisma.meetingTranscript.create({
      data: {
        projectId,
        title: title.slice(0, 200) || 'Réunion en direct',
        originalFileName: 'live-meeting.txt',
        durationSeconds: Math.max(0, Math.round(durationSeconds)),
        detectedLanguages: detectedLangsCsv,
        recordedAt: new Date(),
        meetingType: safeType,
      },
    });

    await this.prisma.transcriptSegment.create({
      data: {
        transcriptId: created.id,
        speaker: 'PM + invités',
        text: trimmed,
        startTime: 0,
        endTime: Math.max(0, Math.round(durationSeconds)),
        language: primaryLang,
        confidence: 1,
      },
    });

    this.logger.log(`saved live meeting transcript ${created.id} for project ${projectId} (langs: ${detectedLangsCsv})`);
    return { transcriptId: created.id };
  }
}
