import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service.js'
import * as fs from 'fs'

const DEFAULT_AUDIO_RETENTION_DAYS = 90

/**
 * Daily audio retention sweep. Deletes meeting-recording files older than
 * MEETING_AUDIO_RETENTION_DAYS unless `audioPreserved = true`. Clears the
 * audioPath column so the UI stops offering replay; the segments and
 * transcripts stay in the DB.
 *
 * Set MEETING_AUDIO_RETENTION_DAYS=0 to disable retention entirely.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get retentionDays(): number {
    const raw = this.config.get<string>('MEETING_AUDIO_RETENTION_DAYS')
    if (raw === undefined || raw === '') return DEFAULT_AUDIO_RETENTION_DAYS
    const n = parseInt(raw, 10)
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_AUDIO_RETENTION_DAYS
  }

  // 03:30 every night — off-peak across both EU and Maghreb business hours.
  @Cron('30 3 * * *', { name: 'audio-retention-purge' })
  async purgeExpiredAudio(): Promise<void> {
    const days = this.retentionDays
    if (days === 0) {
      this.logger.log('Audio retention disabled (MEETING_AUDIO_RETENTION_DAYS=0)')
      return
    }
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const expired = await this.prisma.meetingTranscript.findMany({
      where: {
        audioPath: { not: null },
        audioPreserved: false,
        createdAt: { lt: cutoff },
      },
      select: { id: true, audioPath: true },
    })

    if (expired.length === 0) {
      this.logger.log(`Audio retention sweep: nothing to purge (cutoff ${cutoff.toISOString()})`)
      return
    }

    // File deletion remains per-row (it's filesystem I/O); the DB column nulling
    // collapses to a single updateMany so the cron doesn't hold a connection
    // open for hundreds of sequential UPDATEs.
    for (const t of expired) {
      if (t.audioPath && fs.existsSync(t.audioPath)) {
        try { fs.unlinkSync(t.audioPath) } catch { /* file already gone */ }
      }
    }
    const ids = expired.map((t) => t.id)
    const { count: deleted } = await this.prisma.meetingTranscript.updateMany({
      where: { id: { in: ids } },
      data: { audioPath: null, audioMimeType: null, audioSize: null },
    })
    this.logger.log(
      `Audio retention sweep: purged ${deleted} recording(s) older than ${days} days`,
    )
  }
}
