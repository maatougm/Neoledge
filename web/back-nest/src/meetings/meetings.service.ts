import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';

@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async transcribe(projectId: string, audioBuffer: Buffer, fileName: string, title: string, speakerMap?: string) {
    const serviceUrl = this.config.get<string>('TRANSCRIPTION_URL', 'http://localhost:8000');

    try {
      const formData = new FormData();
      formData.append('audio', new Blob([audioBuffer as unknown as BlobPart]), fileName);

      const response = await fetch(`${serviceUrl}/transcribe`, { method: 'POST', body: formData });

      if (!response.ok) {
        const text = await response.text();
        this.logger.error(`Transcription service error: ${response.status} ${text}`);
        return Result.fail<any>(`Erreur de transcription : ${text}`);
      }

      const data: any = await response.json();

      const transcript = await this.prisma.meetingTranscript.create({
        data: {
          projectId,
          title,
          originalFileName: fileName,
          durationSeconds: Math.round(data.duration_seconds ?? 0),
          detectedLanguages: (data.detected_languages ?? []).join(','),
          recordedAt: new Date(),
        },
      });

      const segments = (data.segments ?? []).map((s: any) => ({
        transcriptId: transcript.id,
        speaker: s.speaker ?? 'Unknown',
        text: s.text ?? '',
        startTime: s.start_time ?? 0,
        endTime: s.end_time ?? 0,
        language: s.language ?? '',
        confidence: s.confidence ?? 0,
      }));

      if (segments.length > 0) {
        await this.prisma.transcriptSegment.createMany({ data: segments });
      }

      return this.getById(transcript.id);
    } catch (err: any) {
      this.logger.error(`Transcription failed: ${err.message}`, err.stack);
      return Result.fail<any>(`Erreur de transcription : ${err.message}`);
    }
  }

  async getByProject(projectId: string) {
    const transcripts = await this.prisma.meetingTranscript.findMany({
      where: { projectId },
      include: { _count: { select: { segments: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return Result.ok(
      transcripts.map((t) => ({
        id: t.id,
        title: t.title,
        durationSeconds: t.durationSeconds,
        detectedLanguages: t.detectedLanguages,
        segmentCount: t._count.segments,
        recordedAt: t.recordedAt,
        createdAt: t.createdAt,
      })),
    );
  }

  async getById(id: string) {
    const t = await this.prisma.meetingTranscript.findUnique({
      where: { id },
      include: { segments: { orderBy: { startTime: 'asc' } } },
    });
    if (!t) return Result.fail<any>('Transcription non trouvée.');

    return Result.ok({
      id: t.id,
      projectId: t.projectId,
      title: t.title,
      durationSeconds: t.durationSeconds,
      detectedLanguages: t.detectedLanguages,
      recordedAt: t.recordedAt,
      createdAt: t.createdAt,
      segments: t.segments.map((s) => ({
        id: s.id,
        speaker: s.speaker,
        text: s.text,
        startTime: s.startTime,
        endTime: s.endTime,
        language: s.language,
        confidence: s.confidence,
      })),
    });
  }

  async deleteTranscript(id: string) {
    const t = await this.prisma.meetingTranscript.findUnique({ where: { id } });
    if (!t) return Result.fail('Transcription non trouvée.');
    await this.prisma.meetingTranscript.delete({ where: { id } });
    return Result.ok();
  }

  async renameSpeaker(id: string, oldName: string, newName: string) {
    const t = await this.prisma.meetingTranscript.findUnique({ where: { id } });
    if (!t) return Result.fail('Transcription non trouvée.');

    await this.prisma.transcriptSegment.updateMany({
      where: { transcriptId: id, speaker: oldName },
      data: { speaker: newName },
    });

    return Result.ok();
  }
}
