/* ============================================================================
 * FILE: backlog.service.ts  —  AI backlog generator service (worker)
 *                               Service générateur de backlog IA (ouvrier)
 * ============================================================================
 * EN — The "worker" for the AI backlog feature. Two public methods:
 *   `preview(projectId)` — gathers project context (questionnaire answers,
 *     cahier des charges JSON, recent meeting summaries), calls the AI, and
 *     returns a proposed list of Epics + Tasks WITHOUT writing to the DB.
 *     An in-memory cooldown (30 seconds) prevents accidental double-calls.
 *   `accept(projectId, authorId, backlog)` — takes the PM-reviewed backlog
 *     and writes it as WorkPackage rows in one Prisma transaction.
 *     A concurrency guard (60-second window) prevents duplicate acceptance.
 *   Both methods sanitize the backlog through `sanitizeBacklog()` to strip
 *   unknown keys and clamp out-of-range numbers.
 *
 * FR — L'« ouvrier » du backlog IA. Deux méthodes publiques :
 *   `preview(projectId)` — rassemble le contexte projet (réponses questionnaire,
 *     JSON du cahier des charges, résumés de réunions récentes), appelle l'IA,
 *     et renvoie une proposition d'Epics + Tâches SANS écrire en BD.
 *     Un cooldown en mémoire (30 secondes) évite les doubles appels accidentels.
 *   `accept(projectId, authorId, backlog)` — prend le backlog relu par le PM
 *     et l'écrit en lignes WorkPackage dans une transaction Prisma.
 *     Une garde de concurrence (fenêtre 60 secondes) évite la double acceptation.
 *   Les deux méthodes assainissent le backlog via `sanitizeBacklog()` pour
 *   retirer les clés inconnues et borner les nombres hors limites.
 *
 * SEE ALSO / VOIR AUSSI: docs/handbook/00-programming-fundamentals.md
 *   → §4 async/await, §6 Classes, §9 public/private, §13 Decorators,
 *     §14 NestJS DI, §15 Result, §17 Prisma
 * ========================================================================== */

import { Injectable, Logger, NotFoundException, BadGatewayException, HttpException, HttpStatus, ConflictException } from '@nestjs/common';
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
import { runBacklogAgent, runBacklogPlannerWorker } from './backlog-agent.js';
import { AgentEmitMissedError } from './agent/agent-errors.js';

// A tag string written to every WorkPackage created from the AI backlog.
// Used in the concurrency guard to detect recent AI acceptances.
// FR: une chaîne d'étiquette écrite sur chaque WorkPackage créé depuis le backlog IA.
//     Utilisée dans la garde de concurrence pour détecter les acceptations récentes.
const AI_GENERATED_TAG = 'questionnaire+cahier+meeting';

// `@Injectable()` marks this as a NestJS-managed service (§13, §14).
// FR: `@Injectable()` marque cette classe comme un service géré par NestJS (§13, §14).
@Injectable()
export class BacklogService {
  // Private logger for server-side log messages (§9).
  // FR: logger privé pour les messages de log côté serveur (§9).
  private readonly logger = new Logger(BacklogService.name);

  /**
   * In-memory cooldown per project to prevent burning OpenAI calls on
   * accidental double-clicks or malicious request floods. Cheaper than a
   * full ThrottlerModule reinstall and project-scoped is the right grain
   * here (the same PM might preview multiple projects in parallel).
   */
  // `Map<string, number>` maps projectId → timestamp of the last preview call.
  // FR: `Map<string, number>` associe projectId → horodatage du dernier appel preview.
  private readonly lastPreviewAt = new Map<string, number>();
  private readonly PREVIEW_COOLDOWN_MS = 30_000; // 30 seconds / 30 secondes

  // Constructor injection (§14 DI): NestJS supplies prisma, config, and agentRunner.
  // FR: injection dans le constructeur (§14 DI) : NestJS fournit prisma, config et agentRunner.
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly agentRunner: AgentRunnerService,
  ) {}

  /** True when the backlog agent loop should run instead of the legacy single-shot path. */
  // Reads AI_AGENT_MODE env var. 'all' or a comma-list containing 'backlog' enables agent mode.
  // FR: lit AI_AGENT_MODE. 'all' ou une liste contenant 'backlog' active le mode agent.
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
    // ── In-memory cooldown guard ─────────────────────────────────────────────
    const now = Date.now();
    const last = this.lastPreviewAt.get(projectId) ?? 0;
    if (now - last < this.PREVIEW_COOLDOWN_MS) {
      // Too soon — calculate remaining wait time in whole seconds.
      // FR: trop tôt — calculer le temps d'attente restant en secondes entières.
      const wait = Math.ceil((this.PREVIEW_COOLDOWN_MS - (now - last)) / 1000);
      // `HttpException` with a custom status code (429 Too Many Requests).
      // FR: `HttpException` avec un code de statut personnalisé (429 Trop de requêtes).
      throw new HttpException(
        `Patientez ${wait}s avant de relancer la génération.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.lastPreviewAt.set(projectId, now); // Record this call's timestamp / Enregistrer l'horodatage

    // Fetch the project (must exist and not be soft-deleted, §17).
    // FR: récupérer le projet (doit exister et ne pas être supprimé soft, §17).
    const project = await this.prisma.project.findUnique({
      where: { id: projectId, isDeleted: false },
      select: { id: true, name: true, aiOutput: true },
    });
    if (!project) throw new NotFoundException('Projet non trouvé');

    // Driver-fields gate — refuse to call the AI if any field marked
    // "alimente l'IA" has no answer. The PM gets a clear list of what's
    // missing instead of a degraded AI output.
    // FR: vérification des champs driver — refuser d'appeler l'IA si un champ marqué
    //     « alimente l'IA » n'a pas de réponse. Le PM reçoit une liste claire des
    //     champs manquants plutôt qu'une sortie IA dégradée.
    await this.assertDriverFieldsFilled(projectId);

    // ── Agent mode path ──────────────────────────────────────────────────────
    // Agent mode — model fetches what it needs via tools, no pre-built context.
    // BACKLOG_USE_PLANNER=on routes to the planner-worker variant (deterministic
    // parallel reads + single-shot worker emit) which cut the cahier path's
    // wall time by 81% — same architecture, same expected win profile here.
    // FR: mode agent — le modèle récupère ce dont il a besoin via des outils.
    //     BACKLOG_USE_PLANNER=on utilise la variante planner-worker (lectures
    //     parallèles déterministes + émission en un seul appel) qui a réduit
    //     le temps mur du cahier de 81%.
    if (this.isAgentModeEnabled()) {
      const usePlanner = (this.config.get<string>('BACKLOG_USE_PLANNER') ?? 'off').toLowerCase() === 'on';
      try {
        return usePlanner
          ? await runBacklogPlannerWorker(this.agentRunner, this.prisma, this.logger, projectId)
          : await runBacklogAgent(this.agentRunner, this.logger, projectId);
      } catch (e) {
        // AgentEmitMissedError → fall through to single-shot. Other errors
        // surface as 502 like before.
        // FR: AgentEmitMissedError → passer au chemin classique. D'autres erreurs
        //     remontent comme 502.
        if (e instanceof AgentEmitMissedError) {
          this.logger.warn(`backlog agent emit missed; falling back to single-shot: ${e.message}`);
        } else {
          this.logger.error(`backlog agent failed: ${e instanceof Error ? e.message : String(e)}`);
          throw new BadGatewayException('La génération IA a échoué. Réessayez dans un instant.');
        }
      }
    }

    // ── Single-shot path: build context, then call OpenAI ───────────────────
    const context = await this.buildContext(projectId, project.name, project.aiOutput);
    if (context.length < 40) {
      // Not enough signal — return empty rather than burning an AI call.
      // FR: pas assez de signal — renvoyer vide plutôt que de gaspiller un appel IA.
      this.logger.warn(`backlog preview aborted: context too short (${context.length} chars)`);
      return { epics: [] };
    }

    try {
      // Call OpenAI and sanitize the result before returning to the controller.
      // FR: appeler OpenAI et assainir le résultat avant de le renvoyer au controller.
      const raw = await generateBacklogViaOpenAi(this.config, this.logger, context);
      return sanitizeBacklog(raw);
    } catch (e) {
      this.logger.error(`backlog preview failed: ${e instanceof Error ? e.message : String(e)}`);
      // `BadGatewayException` = HTTP 502 (upstream service failed) (§16).
      // FR: `BadGatewayException` = HTTP 502 (service en amont a échoué) (§16).
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
    // Sanitize first — `sanitizeBacklog` strips unknown keys and clamps numbers.
    // FR: assainir d'abord — `sanitizeBacklog` retire les clés inconnues et borne les nombres.
    const safe = sanitizeBacklog(backlog);
    if (safe.epics.length === 0) return { created: 0 };

    // Concurrency guard. A PM double-clicking "Accept" used to generate two
    // parallel transactions, each creating the full Epic + Task tree. Any
    // AI-generated WorkPackage created on this project in the last 60s means
    // an accept just landed — reject the duplicate with 409. The
    // `aiGeneratedFrom` tag is set on every accept-created row (see
    // `toWpCreate`), so this catches both backlog-accept and any other
    // AI write path that uses the same tag.
    // FR: garde de concurrence. Un PM double-cliquant « Accepter » créait deux
    //     transactions parallèles, chacune créant l'arbre complet Epic + Tâches.
    //     Tout WorkPackage généré par IA sur ce projet dans les 60 dernières secondes
    //     signifie qu'une acceptation vient d'avoir lieu — rejeter le doublon avec 409.
    const recentAcceptCount = await this.prisma.workPackage.count({
      where: {
        projectId,
        aiGeneratedFrom: AI_GENERATED_TAG,
        createdAt: { gte: new Date(Date.now() - 60_000) }, // within last 60s / dans les 60 dernières secondes
      },
    });
    if (recentAcceptCount > 0) {
      // `ConflictException` = HTTP 409 (§16).
      // FR: `ConflictException` = HTTP 409 (§16).
      throw new ConflictException(
        'Backlog déjà accepté récemment. Veuillez patienter avant de réessayer.',
      );
    }

    // Pre-generate parent IDs client-side so we can batch tasks under each epic
    // with a single createMany — was previously 1 insert per epic + 1 insert
    // per task, holding the transaction open for dozens of round-trips.
    // FR: pré-générer les IDs parents côté serveur pour regrouper les tâches sous
    //     chaque epic en un seul createMany — était précédemment 1 insertion par epic
    //     + 1 par tâche, gardant la transaction ouverte pour des dizaines d'aller-retours.
    const epicsWithIds = safe.epics.map((epic) => ({ epic, id: randomUUID() }));

    let created = 0;
    // `$transaction` wraps all writes so they all succeed or all fail (§17).
    // FR: `$transaction` regroupe toutes les écritures pour qu'elles réussissent
    //     ou échouent ensemble (§17).
    await this.prisma.$transaction(async (tx) => {
      // 1. All epics in one shot.
      // FR: 1. Tous les epics en un seul appel.
      const epicRows = epicsWithIds.map(({ epic, id }) => ({
        id,
        ...this.toWpCreate(projectId, authorId, epic, 'Epic', null),
      }));
      const epicResult = await tx.workPackage.createMany({ data: epicRows });
      created += epicResult.count;

      // 2. All tasks in one shot (with the epic id we generated above as parentId).
      // FR: 2. Toutes les tâches en un seul appel (avec l'id epic généré comme parentId).
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
  // `private async` = only usable within this class, and asynchronous (§4, §9).
  // FR: `private async` = seulement utilisable dans cette classe, et asynchrone (§4, §9).
  private async assertDriverFieldsFilled(projectId: string): Promise<void> {
    // `findMany` reads all driver fields for this project (§17).
    // FR: `findMany` lit tous les champs driver de ce projet (§17).
    const drivers = await this.prisma.projectField.findMany({
      where: { projectId, isBacklogDriver: true },
      select: { id: true, label: true, values: { select: { value: true } } },
    });
    if (drivers.length === 0) return; // no drivers configured → nothing to enforce / aucun driver → rien à vérifier

    // Filter to fields that have no answer (value is empty/null/whitespace).
    // FR: filtrer les champs sans réponse (valeur vide/null/espaces).
    const missing = drivers
      .filter((f) => {
        const v = f.values[0]?.value; // `?.` = optional chaining: safe if values is empty (§20)
        return !v || v.trim() === '';
      })
      .map((f) => f.label);
    if (missing.length > 0) {
      // HTTP 412 Precondition Failed — with a custom body listing missing fields.
      // FR: HTTP 412 Précondition échouée — avec un corps personnalisé listant les champs manquants.
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

  // Private helper that builds the data object for a WorkPackage `create`/`createMany`.
  // Shared by both epics and tasks — `type` differentiates them.
  // `src` uses an inline structural type: only these four fields are needed.
  // FR: aide privée qui construit l'objet data pour un WorkPackage `create`/`createMany`.
  //     Partagé entre epics et tâches — `type` les distingue.
  private toWpCreate(
    projectId: string,
    authorId: string,
    src: { title: string; description: string; priority: string; estimatedHours: number },
    type: string,
    parentId: string | null, // null = top-level Epic / null = Epic de premier niveau
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
      // `|| null` = store null if estimatedHours is 0 (falsy) to keep DB clean.
      // FR: `|| null` = stocker null si estimatedHours vaut 0 (falsy) pour garder la BD propre.
      estimatedHours: src.estimatedHours || null,
      aiGeneratedFrom: AI_GENERATED_TAG, // traceability tag / étiquette de traçabilité
    };
  }

  // Private helper: assembles a context string from DB data that the single-shot
  // AI call receives as its "user message". Includes questionnaire answers,
  // cahier JSON, and meeting summaries.
  // FR: aide privée : assemble une chaîne de contexte depuis les données BD que
  //     l'appel IA classique reçoit comme « message utilisateur ».
  private async buildContext(
    projectId: string,
    projectName: string,
    aiOutput: string | null,
  ): Promise<string> {
    // Fetch only backlog-driver fields, ordered by their display order.
    // FR: récupérer seulement les champs driver, ordonnés par leur ordre d'affichage.
    const driverFields = await this.prisma.projectField.findMany({
      where: { projectId, isBacklogDriver: true },
      orderBy: { orderIndex: 'asc' },
      include: { values: { select: { value: true } } },
    });

    // Build a bullet-list of "label: answer" lines (or a note if none).
    // FR: construire une liste à puces "label : réponse" (ou une note si aucun).
    const answersBlock = driverFields.length
      ? driverFields
          .map((f) => {
            const answer = f.values[0]?.value ?? '(sans réponse)';
            const hint = f.backlogHint ? ` [indication: ${f.backlogHint}]` : '';
            return `- ${f.label}${hint}: ${answer}`;
          })
          .join('\n')
      : '(aucune question "backlog-driver" marquée)';

    // Extract aiContent from the saved cahier JSON (§17 JSON column rule:
    // JSON.parse in try/catch to handle corrupt rows without crashing).
    // FR: extraire aiContent du JSON du cahier sauvegardé (règle §17 JSON colonne :
    //     JSON.parse dans try/catch pour gérer les lignes corrompues sans plantage).
    let cahierBlock = '(aucun cahier des charges enregistré)';
    if (aiOutput) {
      try {
        const parsed = JSON.parse(aiOutput) as { aiContent?: unknown };
        if (parsed.aiContent) {
          // Limit to 8000 chars so the AI context stays manageable.
          // FR: limiter à 8000 caractères pour que le contexte IA reste gérable.
          cahierBlock = JSON.stringify(parsed.aiContent).slice(0, 8000);
        }
      } catch {
        /* ignore malformed cahier / ignorer un cahier malformé */
      }
    }

    // Get up to 3 most recent completed meeting summaries.
    // FR: obtenir jusqu'à 3 résumés de réunions récentes terminées.
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

    // Assemble the final context string using an array joined by newlines.
    // FR: assembler la chaîne de contexte finale en joignant un tableau par retours à la ligne.
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

// Re-export the types that the controller imports from here.
// FR: ré-exporter les types que le controller importe depuis ici.
export type { ProposedBacklog, ProposedEpic };
