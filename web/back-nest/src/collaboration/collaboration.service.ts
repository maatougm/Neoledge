import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmbeddingIndexerService } from '../ai/embeddings/embedding-indexer.service.js';

/**
 * In-process debouncer for the live-editing socket path. We coalesce rapid
 * keystrokes per (projectId, projectFieldId) before re-embedding so we don't
 * spam the FastAPI /embed endpoint while a user is typing.
 *
 * Note: this Map is per-process — incompatible with multi-instance scaling
 * (PM2 cluster, etc.). The Phase 4 design accepts this trade-off because
 * (a) the questionnaire is low-fanout, (b) the saveFieldValues batch path
 * still re-embeds at form-save time, and (c) the eventual horizontal-scale
 * fix is to move debouncing to a Redis queue, not to lose this layer.
 */
const FIELD_EMBED_DEBOUNCE_MS = 1500;

@Injectable()
export class CollaborationService {
  private readonly logger = new Logger(CollaborationService.name);
  private readonly pendingEmbeds = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingIndexer: EmbeddingIndexerService,
  ) {}

  async saveField(
    projectId: string,
    projectFieldId: string,
    value: string,
    userId: string,
  ): Promise<void> {
    const updated = await this.prisma.projectFieldValue.updateMany({
      where: { projectId, projectFieldId },
      data: { value, updatedBy: userId },
    });

    if (updated.count === 0) {
      await this.prisma.projectFieldValue.create({
        data: {
          projectId,
          projectFieldId,
          value,
          updatedBy: userId,
        },
      });
    }

    this.scheduleEmbed(projectId, projectFieldId);
  }

  /** Debounced re-embed: coalesce keystrokes per (projectId,fieldId). */
  private scheduleEmbed(projectId: string, projectFieldId: string): void {
    const key = `${projectId}::${projectFieldId}`;
    const prior = this.pendingEmbeds.get(key);
    if (prior) clearTimeout(prior);
    const handle = setTimeout(() => {
      this.pendingEmbeds.delete(key);
      void this.runEmbed(projectId, projectFieldId).catch((e) =>
        this.logger.warn(
          `live-edit embedding failed for ${projectId}/${projectFieldId}: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }, FIELD_EMBED_DEBOUNCE_MS);
    this.pendingEmbeds.set(key, handle);
  }

  private async runEmbed(projectId: string, projectFieldId: string): Promise<void> {
    const row = await this.prisma.projectFieldValue.findUnique({
      where: { projectId_projectFieldId: { projectId, projectFieldId } },
      select: {
        id: true,
        value: true,
        field: { select: { label: true } },
      },
    });
    if (!row?.value || row.value.trim().length === 0) return;
    await this.embeddingIndexer.indexAndStore(
      'field-value',
      [{ id: row.id, text: `${row.field?.label ?? 'Champ'}: ${row.value}` }],
      { projectId },
    );
  }
}
