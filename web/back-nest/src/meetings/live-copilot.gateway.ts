/**
 * @file live-copilot.gateway.ts — socket.io namespace `/live-meeting`.
 * Pushes copilot suggestion cards to clients joined in a project room.
 *
 * Auth pattern mirrors collaboration.gateway.ts: JWT on handshake,
 * tokenVersion check, per-socket rate bucket. The agent loop does NOT
 * run inside the gateway — the controller calls LiveCopilotService.fire
 * via runDetached and the service emits to this gateway when results
 * are ready.
 */

import { Logger } from '@nestjs/common'
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../prisma/prisma.service.js'
import { getJwtSecret } from '../auth/jwt-secret.js'
import type { SuggestionCard } from './live-copilot.types.js'

const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

interface JoinSessionPayload {
  projectId: string
  liveSessionId: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

@WebSocketGateway({
  namespace: '/live-meeting',
  cors: { origin: CORS_ORIGINS, credentials: true },
})
export class LiveCopilotGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(LiveCopilotGateway.name)
  @WebSocketServer() private readonly server!: Server

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  // ─── Connection lifecycle ──────────────────────────────────────────────────

  async handleConnection(client: Socket): Promise<void> {
    const token: string | undefined = (client.handshake.auth as Record<string, string>)?.token
    if (!token) {
      client.disconnect(true)
      return
    }
    try {
      const secret = getJwtSecret(this.configService)
      const payload = this.jwtService.verify<{
        sub: string
        tokenVersion?: number
        aud?: string
        totpPending?: boolean
      }>(token, { secret })

      if ((payload.aud && payload.aud !== 'access') || payload.totpPending) {
        client.disconnect(true)
        return
      }

      const user = await this.prisma.appUser.findUnique({
        where: { id: payload.sub, isActive: true },
        select: { id: true, tokenVersion: true },
      })
      if (!user) {
        client.disconnect(true)
        return
      }
      if ((payload.tokenVersion ?? 0) !== user.tokenVersion) {
        client.disconnect(true)
        return
      }

      client.data['userId'] = payload.sub
    } catch {
      client.disconnect(true)
    }
  }

  handleDisconnect(_client: Socket): void {
    // No per-socket state to clean up — rooms are released automatically.
  }

  // ─── Subscriptions ─────────────────────────────────────────────────────────

  @SubscribeMessage('copilot:join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinSessionPayload,
  ): Promise<{ ok: boolean; reason?: string }> {
    const userId = client.data['userId'] as string | undefined
    if (!userId) return { ok: false, reason: 'unauthenticated' }
    if (!payload?.projectId || !UUID_RE.test(payload.projectId)) {
      return { ok: false, reason: 'invalid_project_id' }
    }
    if (!payload?.liveSessionId || payload.liveSessionId.length > 80) {
      return { ok: false, reason: 'invalid_session_id' }
    }

    // Verify the user has access to the project (PM, Member, or Admin).
    const accessOk = await this.userCanAccessProject(userId, payload.projectId)
    if (!accessOk) return { ok: false, reason: 'forbidden' }

    const room = this.roomKey(payload.projectId, payload.liveSessionId)
    client.join(room)
    return { ok: true }
  }

  @SubscribeMessage('copilot:leave')
  handleLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinSessionPayload,
  ): { ok: boolean } {
    if (payload?.projectId && payload?.liveSessionId) {
      client.leave(this.roomKey(payload.projectId, payload.liveSessionId))
    }
    return { ok: true }
  }

  // ─── Server-side broadcasts (called from LiveCopilotService) ────────────

  /** Push new cards to everyone joined in the session's room. */
  emitSuggestions(projectId: string, liveSessionId: string, cards: SuggestionCard[]): void {
    if (cards.length === 0) return
    this.server.to(this.roomKey(projectId, liveSessionId)).emit('copilot:suggestions', { cards })
  }

  /** Push a "fire skipped" notice (cooldown / cap / budget) so the UI can show why nothing arrived. */
  emitFireSkipped(projectId: string, liveSessionId: string, reason: string): void {
    this.server.to(this.roomKey(projectId, liveSessionId)).emit('copilot:fire-skipped', { reason })
  }

  /** Push a status update (sub-tab like "thinking…", "summary updated") if needed. */
  emitStatus(projectId: string, liveSessionId: string, status: string): void {
    this.server.to(this.roomKey(projectId, liveSessionId)).emit('copilot:status', { status })
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private roomKey(projectId: string, liveSessionId: string): string {
    return `live:${projectId}:${liveSessionId}`
  }

  private async userCanAccessProject(userId: string, projectId: string): Promise<boolean> {
    const [user, asPm, asMember] = await Promise.all([
      this.prisma.appUser.findUnique({ where: { id: userId }, select: { role: true } }),
      this.prisma.project.count({ where: { id: projectId, projectManagerId: userId, isDeleted: false } }),
      this.prisma.projectMember.count({ where: { projectId, userId } }),
    ])
    if (!user) return false
    if (user.role === 'Admin') return true
    return asPm > 0 || asMember > 0
  }
}
