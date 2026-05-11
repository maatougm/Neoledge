import { Injectable, Logger, NotFoundException, BadGatewayException, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  generateBacklogViaOpenAi,
  sanitizeBacklog,
  type ProposedBacklog,
  type ProposedEpic,
} from './backlog-generator.js';
import { AgentRunnerService } from './agent/agent-runner.service.js';
import { runBacklogAgent } from './backlog-agent.js';
import { AgentEmitMissedError } from './agent/agent-errors.js';

const AI_GENERATED_TAG = 'questionnaire+cahier+meeting';

@Injectable()
export class BacklogService {
  private readonly logger = new Logger(BacklogService.name);

  /**
   * In-memory cooldown per project to prevent burning OpenAI calls on
   * accidental double-clicks or malicious request floods. Cheaper than a
   * full ThrottlerModule reinstall and project-scoped is the right grain
   * here (the same PM might preview multiple projects in parallel).
   */
  private readonly lastPreviewAt = new Map<string, number>();
  private readonly PREVIEW_COOLDOWN_MS = 30_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly agentRunner: AgentRunnerService,
  ) {}

  /** True when the backlog agent loop should run instead of the legacy single-shot path. */
  private isAgentModeEnabled(): boolean {
    const raw = (this.config.get<string>('AI_AGENT_MODE') ?? 'off').toLowerCase()
    return raw === 'all' || raw.split(/[,\s]+/).includes('backlog')
  }

  /**
   * Assemble the context from (a) backlog-driver field answers, (b) latest
   * saved cahier des charges, (c) latest meeting AI summary, then call the
   * AI provider. Returns a sanitized preview — NO DB writes.
   */
  async preview(projectId: string): Promise<ProposedBacklog> {
    const now = Date.now();
    const last = this.lastPreviewAt.get(projectId) ?? 0;
    if (now - last < this.PREVIEW_COOLDOWN_MS) {
      const wait = Math.ceil((this.PREVIEW_COOLDOWN_MS - (now - last)) / 1000);
      throw new HttpException(
        `Patientez ${wait}s avant de relancer la génération.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.lastPreviewAt.set(projectId, now);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId, isDeleted: false },
      select: { id: true, name: true, aiOutput: true },
    });
    if (!project) throw new NotFoundException('Projet non trouvé');

    // Driver-fields gate — refuse to call the AI if any field marked
    // "alimente l'IA" has no answer. The PM gets a clear list of what's
    // missing instead of a degraded AI output.
    await this.assertDriverFieldsFilled(projectId);

    // Agent mode — model fetches what it needs via tools, no pre-built context.
    if (this.isAgentModeEnabled()) {
      try {
        return await runBacklogAgent(this.agentRunner, this.logger, projectId);
      } catch (e) {
        // AgentEmitMissedError → fall through to single-shot. Other errors
        // surface as 502 like before.
        if (e instanceof AgentEmitMissedError) {
          this.logger.warn(`backlog agent emit missed; falling back to single-shot: ${e.message}`);
        } else {
          this.logger.error(`backlog agent failed: ${e instanceof Error ? e.message : String(e)}`);
          throw new BadGatewayException('La génération IA a échoué. Réessayez dans un instant.');
        }
      }
    }

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

    // Pre-generate parent IDs client-side so we can batch tasks under each epic
    // with a single createMany — was previously 1 insert per epic + 1 insert
    // per task, holding the transaction open for dozens of round-trips.
    const epicsWithIds = safe.epics.map((epic) => ({ epic, id: randomUUID() }));

    let created = 0;
    await this.prisma.$transaction(async (tx) => {
      // 1. All epics in one shot.
      const epicRows = epicsWithIds.map(({ epic, id }) => ({
        id,
        ...this.toWpCreate(projectId, authorId, epic, 'Epic', null),
      }));
      const epicResult = await tx.workPackage.createMany({ data: epicRows });
      created += epicResult.count;

      // 2. All tasks in one shot (with the epic id we generated above as parentId).
      const taskRows: ReturnType<typeof this.toWpCreate>[] = [];
      for (const { epic, id: epicId } of epicsWithIds) {
        for (const task of epic.children) {
          taskRows.push(this.toWpCreate(projectId, authorId, task, task.type, epicId));
        }
      }
      if (taskRows.length > 0) {
        const taskResult = await tx.workPackage.createMany({ data: taskRows });
        created += taskResult.count;
      }
    });
    this.logger.log(`accepted backlog for project ${projectId}: ${created} WP(s) created`);
    return { created };
  }

  /**
   * Refuse to call the AI when fields marked `isBacklogDriver=true` have no
   * answer. Returns 412 Precondition Failed with the missing field labels so
   * the UI can ask the PM to fill them first.
   */
  private async assertDriverFieldsFilled(projectId: string): Promise<void> {
    const drivers = await this.prisma.projectField.findMany({
      where: { projectId, isBacklogDriver: true },
      select: { id: true, label: true, values: { select: { value: true } } },
    });
    if (drivers.length === 0) return; // no drivers configured → nothing to enforce
    const missing = drivers
      .filter((f) => {
        const v = f.values[0]?.value;
        return !v || v.trim() === '';
      })
      .map((f) => f.label);
    if (missing.length > 0) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PRECONDITION_FAILED,
          message: 'Champs IA obligatoires non renseignés. Remplissez le questionnaire avant de générer.',
          missingFields: missing,
        },
        HttpStatus.PRECONDITION_FAILED,
      );
    }
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
