import { Injectable, Logger, NotFoundException, BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  generateBacklogViaOpenAi,
  sanitizeBacklog,
  type ProposedBacklog,
  type ProposedEpic,
} from './backlog-generator.js';

const AI_GENERATED_TAG = 'questionnaire+cahier+meeting';

@Injectable()
export class BacklogService {
  private readonly logger = new Logger(BacklogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Assemble the context from (a) backlog-driver field answers, (b) latest
   * saved cahier des charges, (c) latest meeting AI summary, then call the
   * AI provider. Returns a sanitized preview — NO DB writes.
   */
  async preview(projectId: string): Promise<ProposedBacklog> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId, isDeleted: false },
      select: { id: true, name: true, aiOutput: true },
    });
    if (!project) throw new NotFoundException('Projet non trouvé');

    const context = await this.buildContext(projectId, project.name, project.aiOutput);
    if (context.length < 40) {
      // Not enough signal — return empty rather than burning an AI call.
      this.logger.warn(`backlog preview aborted: context too short (${context.length} chars)`);
      return { epics: [] };
    }

    try {
      const raw = await generateBacklogViaOpenAi(this.config, this.logger, context);
      return sanitizeBacklog(raw);
    } catch (e) {
      this.logger.error(`backlog preview failed: ${e instanceof Error ? e.message : String(e)}`);
      throw new BadGatewayException('La génération IA a échoué. Réessayez dans un instant.');
    }
  }

  /**
   * Persist an approved backlog as WorkPackages. Each Epic becomes a WP of
   * type='Epic' with children as type='Task'. All are marked aiGeneratedFrom
   * for traceability. Idempotency is the caller's responsibility — we do not
   * dedupe; the UI is expected to let the PM accept ONCE.
   */
  async accept(projectId: string, authorId: string, backlog: ProposedBacklog): Promise<{ created: number }> {
    const safe = sanitizeBacklog(backlog);
    if (safe.epics.length === 0) return { created: 0 };

    let created = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const epic of safe.epics) {
        const epicRow = await tx.workPackage.create({
          data: this.toWpCreate(projectId, authorId, epic, 'Epic', null),
        });
        created += 1;
        for (const task of epic.children) {
          await tx.workPackage.create({
            data: this.toWpCreate(projectId, authorId, task, task.type, epicRow.id),
          });
          created += 1;
        }
      }
    });
    this.logger.log(`accepted backlog for project ${projectId}: ${created} WP(s) created`);
    return { created };
  }

  private toWpCreate(
    projectId: string,
    authorId: string,
    src: { title: string; description: string; priority: string; estimatedHours: number },
    type: string,
    parentId: string | null,
  ) {
    return {
      projectId,
      authorId,
      parentId,
      title: src.title,
      description: src.description,
      type,
      status: 'New',
      priority: src.priority,
      estimatedHours: src.estimatedHours || null,
      aiGeneratedFrom: AI_GENERATED_TAG,
    };
  }

  private async buildContext(
    projectId: string,
    projectName: string,
    aiOutput: string | null,
  ): Promise<string> {
    const driverFields = await this.prisma.projectField.findMany({
      where: { projectId, isBacklogDriver: true },
      orderBy: { orderIndex: 'asc' },
      include: { values: { select: { value: true } } },
    });

    const answersBlock = driverFields.length
      ? driverFields
          .map((f) => {
            const answer = f.values[0]?.value ?? '(sans réponse)';
            const hint = f.backlogHint ? ` [indication: ${f.backlogHint}]` : '';
            return `- ${f.label}${hint}: ${answer}`;
          })
          .join('\n')
      : '(aucune question "backlog-driver" marquée)';

    let cahierBlock = '(aucun cahier des charges enregistré)';
    if (aiOutput) {
      try {
        const parsed = JSON.parse(aiOutput) as { aiContent?: unknown };
        if (parsed.aiContent) {
          cahierBlock = JSON.stringify(parsed.aiContent).slice(0, 8000);
        }
      } catch {
        /* ignore malformed cahier */
      }
    }

    const transcripts = await this.prisma.meetingTranscript.findMany({
      where: { projectId, aiStatus: 'completed', aiSummary: { not: null } },
      select: { aiSummary: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });
    const meetingsBlock = transcripts.length
      ? transcripts
          .map((t, i) => `Réunion ${i + 1}:\n${(t.aiSummary ?? '').slice(0, 2500)}`)
          .join('\n\n')
      : '(aucune réunion analysée)';

    return [
      `# Projet : ${projectName}`,
      '',
      '## Réponses questionnaire (champs marqués comme alimentant le backlog)',
      answersBlock,
      '',
      '## Cahier des charges',
      cahierBlock,
      '',
      '## Résumés des réunions récentes',
      meetingsBlock,
    ].join('\n');
  }
}

export type { ProposedBacklog, ProposedEpic };
