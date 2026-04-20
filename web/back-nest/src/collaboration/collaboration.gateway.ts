import { Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { CollaborationService } from './collaboration.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { getJwtSecret } from '../auth/jwt-secret.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PresenceUser {
  userId: string;
  name: string;
  color: string;
  editingFieldId: string | null;
}

interface FieldUpdatePayload {
  projectId: string;
  projectFieldId: string;
  value: string;
  userId?: string;
}

interface FieldFocusPayload {
  projectId: string;
  projectFieldId: string;
  userId?: string;
}

interface FieldBlurPayload {
  projectId: string;
  userId?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COLOR_PALETTE = [
  '#0d9488',
  '#7c3aed',
  '#dc2626',
  '#d97706',
  '#0284c7',
  '#059669',
  '#db2777',
  '#65a30d',
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FIELD_ID_LEN = 128;
const MAX_VALUE_LEN = 100_000;

const SESSION_CACHE_TTL_MS = 30_000;
const RATE_LIMIT_CAPACITY = 30; // tokens
const RATE_LIMIT_REFILL_PER_SEC = 30;

const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// ─── Gateway ──────────────────────────────────────────────────────────────────

@WebSocketGateway({
  namespace: '/collaboration',
  cors: { origin: CORS_ORIGINS, credentials: true },
})
export class CollaborationGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(CollaborationGateway.name);
  @WebSocketServer() private readonly server: Server;

  // Map<projectId, Map<socketId, PresenceUser>>
  private readonly presence = new Map<string, Map<string, PresenceUser>>();
  // Map<userId, name string>
  private readonly userNameCache = new Map<string, string>();
  // Map<userId, { tokenVersion, expiresAt }>
  private readonly sessionCache = new Map<string, { tokenVersion: number; expiresAt: number }>();
  // Map<socketId, { tokens, lastRefill }>
  private readonly rateBuckets = new Map<string, { tokens: number; lastRefill: number }>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly collaborationService: CollaborationService,
    private readonly prisma: PrismaService,
  ) {}

  // ─── Connection lifecycle ──────────────────────────────────────────────────

  async handleConnection(client: Socket): Promise<void> {
    const token: string | undefined = (client.handshake.auth as Record<string, string>)?.token;
    if (!token) {
      client.disconnect(true);
      return;
    }
    try {
      const secret = getJwtSecret(this.configService);
      const payload = this.jwtService.verify<{
        sub: string;
        firstName?: string;
        lastName?: string;
      }>(token, { secret });

      const user = await this.prisma.appUser.findUnique({
        where: { id: payload.sub, isActive: true },
        select: { id: true, tokenVersion: true },
      });
      if (!user) {
        client.disconnect(true);
        return;
      }

      client.data['userId'] = payload.sub;
      client.data['tokenVersion'] = user.tokenVersion;
      client.data['firstName'] = payload.firstName ?? '';
      client.data['lastName'] = payload.lastName ?? '';

      this.sessionCache.set(payload.sub, {
        tokenVersion: user.tokenVersion,
        expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
      });
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const affectedProjects: string[] = [];

    for (const [projectId, socketMap] of this.presence) {
      if (socketMap.has(client.id)) {
        socketMap.delete(client.id);
        affectedProjects.push(projectId);
        if (socketMap.size === 0) {
          this.presence.delete(projectId);
        }
      }
    }

    // Drop cached session + rate bucket for this socket
    const userId = client.data['userId'] as string | undefined;
    if (userId) this.sessionCache.delete(userId);
    this.rateBuckets.delete(client.id);

    for (const projectId of affectedProjects) {
      this.emitPresenceUpdate(projectId);
    }
  }

  // ─── Event handlers ───────────────────────────────────────────────────────

  @SubscribeMessage('join-project')
  async handleJoinProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() projectId: unknown,
  ): Promise<void> {
    if (!this.allowEvent(client)) return;
    const userId = await this.requireValidSession(client);
    if (!userId) return;

    if (typeof projectId !== 'string' || !UUID_RE.test(projectId)) {
      client.emit('error', { message: 'Invalid projectId' });
      return;
    }

    // Project-membership check — user must have a role assignment for this
    // project OR a global assignment (projectId === null).
    const hasAccess = await this.prisma.userRoleAssignment.findFirst({
      where: { userId, OR: [{ projectId }, { projectId: null }] },
      select: { id: true },
    });
    if (!hasAccess) {
      client.emit('error', { message: 'Not a member of this project' });
      return;
    }

    const name = await this.resolveUserName(userId, client);

    if (!this.presence.has(projectId)) {
      this.presence.set(projectId, new Map());
    }

    const color = COLOR_PALETTE[userId.charCodeAt(0) % COLOR_PALETTE.length];
    const presenceUser: PresenceUser = { userId, name, color, editingFieldId: null };

    this.presence.get(projectId)!.set(client.id, presenceUser);
    await client.join(`project:${projectId}`);
    this.emitPresenceUpdate(projectId);
  }

  @SubscribeMessage('leave-project')
  async handleLeaveProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() projectId: unknown,
  ): Promise<void> {
    if (!this.allowEvent(client)) return;
    const userId = await this.requireValidSession(client);
    if (!userId) return;

    if (typeof projectId !== 'string' || !UUID_RE.test(projectId)) return;

    const socketMap = this.presence.get(projectId);
    if (socketMap) {
      socketMap.delete(client.id);
      if (socketMap.size === 0) {
        this.presence.delete(projectId);
      }
    }
    await client.leave(`project:${projectId}`);
    this.emitPresenceUpdate(projectId);
  }

  @SubscribeMessage('field-update')
  async handleFieldUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: FieldUpdatePayload,
  ): Promise<void> {
    if (!this.allowEvent(client)) return;
    const userId = await this.requireValidSession(client);
    if (!userId) return;

    if (!this.validateFieldPayload(payload) || typeof payload.value !== 'string' || payload.value.length > MAX_VALUE_LEN) {
      return;
    }

    const { projectId, projectFieldId, value } = payload;

    // Must be joined to the project room (and membership was checked on join)
    if (!client.rooms.has(`project:${projectId}`)) return;

    // Never trust client-supplied userId — always use the socket's authenticated id
    if (payload.userId !== undefined && payload.userId !== userId) return;

    const firstName: string = (client.data['firstName'] as string) ?? '';

    try {
      await this.collaborationService.saveField(projectId, projectFieldId, value, userId);
    } catch {
      // Best-effort — do not crash the socket connection on DB errors
    }

    client.to(`project:${projectId}`).emit('field-changed', {
      projectFieldId,
      value,
      updatedBy: userId,
      updatedByName: firstName,
    });

    const socketMap = this.presence.get(projectId);
    if (socketMap?.has(client.id)) {
      const existing = socketMap.get(client.id)!;
      socketMap.set(client.id, { ...existing, editingFieldId: projectFieldId });
    }

    this.emitPresenceUpdate(projectId);
  }

  @SubscribeMessage('field-focus')
  async handleFieldFocus(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: FieldFocusPayload,
  ): Promise<void> {
    if (!this.allowEvent(client)) return;
    const userId = await this.requireValidSession(client);
    if (!userId) return;

    if (!this.validateFieldPayload(payload)) return;

    const { projectId, projectFieldId } = payload;
    if (!client.rooms.has(`project:${projectId}`)) return;
    if (payload.userId !== undefined && payload.userId !== userId) return;

    const socketMap = this.presence.get(projectId);
    if (socketMap?.has(client.id)) {
      const existing = socketMap.get(client.id)!;
      socketMap.set(client.id, { ...existing, editingFieldId: projectFieldId });
    }
    this.emitPresenceUpdate(projectId);
  }

  @SubscribeMessage('field-blur')
  async handleFieldBlur(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: FieldBlurPayload,
  ): Promise<void> {
    if (!this.allowEvent(client)) return;
    const userId = await this.requireValidSession(client);
    if (!userId) return;

    if (!payload || typeof payload !== 'object') return;
    if (typeof payload.projectId !== 'string' || !UUID_RE.test(payload.projectId)) return;

    const { projectId } = payload;
    if (!client.rooms.has(`project:${projectId}`)) return;
    if (payload.userId !== undefined && payload.userId !== userId) return;

    const socketMap = this.presence.get(projectId);
    if (socketMap?.has(client.id)) {
      const existing = socketMap.get(client.id)!;
      socketMap.set(client.id, { ...existing, editingFieldId: null });
    }
    this.emitPresenceUpdate(projectId);
  }

  // ─── Public broadcast helpers (called from services after mutations) ──────

  /** Broadcast a kanban card move to all other clients watching this project. */
  broadcastCardMoved(projectId: string, payload: { workPackageId: string; boardColumnId: string | null; status: string }): void {
    if (!this.server) return;
    this.server.to(`project:${projectId}`).emit('card-moved', payload);
  }

  /** Broadcast a work-package mutation (create/update/delete) for any subscriber. */
  broadcastWpChanged(projectId: string, payload: { workPackageId: string; action: 'created' | 'updated' | 'deleted' }): void {
    if (!this.server) return;
    this.server.to(`project:${projectId}`).emit('wp-changed', payload);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Re-validate session on every event: verify token, confirm AppUser still
   * exists + active, and that the token's version matches the DB. Cached for
   * 30s per userId to avoid a DB round-trip on every message.
   */
  private async requireValidSession(client: Socket): Promise<string | null> {
    const token: string | undefined = (client.handshake.auth as Record<string, string>)?.token;
    if (!token) {
      client.disconnect(true);
      return null;
    }

    let payload: { sub: string };
    try {
      const secret = getJwtSecret(this.configService);
      payload = this.jwtService.verify<{ sub: string }>(token, { secret });
    } catch {
      client.disconnect(true);
      return null;
    }

    const userId = payload.sub;
    const now = Date.now();
    const cached = this.sessionCache.get(userId);

    if (cached && cached.expiresAt > now) {
      const socketTv = client.data['tokenVersion'];
      if (typeof socketTv === 'number' && socketTv !== cached.tokenVersion) {
        client.disconnect(true);
        return null;
      }
      return userId;
    }

    const user = await this.prisma.appUser.findUnique({
      where: { id: userId, isActive: true },
      select: { id: true, tokenVersion: true },
    });
    if (!user) {
      this.sessionCache.delete(userId);
      client.disconnect(true);
      return null;
    }

    const socketTv = client.data['tokenVersion'];
    if (typeof socketTv === 'number' && socketTv !== user.tokenVersion) {
      this.sessionCache.delete(userId);
      client.disconnect(true);
      return null;
    }

    this.sessionCache.set(userId, {
      tokenVersion: user.tokenVersion,
      expiresAt: now + SESSION_CACHE_TTL_MS,
    });
    return userId;
  }

  /** Per-socket token bucket: 30 tokens, refilled at 30/s. */
  private allowEvent(client: Socket): boolean {
    const now = Date.now();
    const bucket = this.rateBuckets.get(client.id);
    if (!bucket) {
      this.rateBuckets.set(client.id, { tokens: RATE_LIMIT_CAPACITY - 1, lastRefill: now });
      return true;
    }
    const elapsedSec = (now - bucket.lastRefill) / 1000;
    const refilled = Math.min(RATE_LIMIT_CAPACITY, bucket.tokens + elapsedSec * RATE_LIMIT_REFILL_PER_SEC);
    if (refilled < 1) {
      bucket.tokens = refilled;
      bucket.lastRefill = now;
      return false;
    }
    bucket.tokens = refilled - 1;
    bucket.lastRefill = now;
    return true;
  }

  private validateFieldPayload(payload: unknown): payload is { projectId: string; projectFieldId: string } {
    if (!payload || typeof payload !== 'object') return false;
    const p = payload as Record<string, unknown>;
    if (typeof p['projectId'] !== 'string' || !UUID_RE.test(p['projectId'] as string)) return false;
    if (
      typeof p['projectFieldId'] !== 'string' ||
      (p['projectFieldId'] as string).length === 0 ||
      (p['projectFieldId'] as string).length > MAX_FIELD_ID_LEN
    ) {
      return false;
    }
    return true;
  }

  private emitPresenceUpdate(projectId: string): void {
    const list = Array.from(this.presence.get(projectId)?.values() ?? []);
    this.server.to(`project:${projectId}`).emit('presence-update', list);
  }

  private async resolveUserName(userId: string, client: Socket): Promise<string> {
    if (this.userNameCache.has(userId)) {
      return this.userNameCache.get(userId)!;
    }

    const firstName = (client.data['firstName'] as string) ?? '';
    const lastName = (client.data['lastName'] as string) ?? '';

    let name = [firstName, lastName].filter(Boolean).join(' ');

    if (!name) {
      try {
        const user = await this.prisma.appUser.findUnique({
          where: { id: userId },
          select: { firstName: true, lastName: true },
        });
        if (user) {
          name = [user.firstName, user.lastName].filter(Boolean).join(' ');
        }
      } catch {
        name = userId;
      }
    }

    if (!name) name = userId;
    this.userNameCache.set(userId, name);
    return name;
  }
}
