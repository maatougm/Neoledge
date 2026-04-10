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
}

interface FieldFocusPayload {
  projectId: string;
  projectFieldId: string;
}

interface FieldBlurPayload {
  projectId: string;
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

// ─── Gateway ──────────────────────────────────────────────────────────────────

@WebSocketGateway({ namespace: '/collaboration', cors: { origin: '*' } })
export class CollaborationGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() private readonly server: Server;

  // Map<projectId, Map<socketId, PresenceUser>>
  private readonly presence = new Map<string, Map<string, PresenceUser>>();
  // Map<userId, name string>
  private readonly userNameCache = new Map<string, string>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly collaborationService: CollaborationService,
    private readonly prisma: PrismaService,
  ) {}

  // ─── Connection lifecycle ──────────────────────────────────────────────────

  handleConnection(client: Socket): void {
    const token: string | undefined = (client.handshake.auth as Record<string, string>)?.token;
    if (!token) {
      client.disconnect(true);
      return;
    }
    try {
      const secret = this.configService.get<string>('JWT_SECRET', 'dev-secret-change-me');
      const payload = this.jwtService.verify<{
        sub: string;
        firstName?: string;
        lastName?: string;
      }>(token, { secret });
      client.data['userId'] = payload.sub;
      client.data['firstName'] = payload.firstName ?? '';
      client.data['lastName'] = payload.lastName ?? '';
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

    for (const projectId of affectedProjects) {
      this.emitPresenceUpdate(projectId);
    }
  }

  // ─── Event handlers ───────────────────────────────────────────────────────

  @SubscribeMessage('join-project')
  async handleJoinProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() projectId: string,
  ): Promise<void> {
    const userId: string = client.data['userId'] as string;
    if (!userId) return;

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
    @MessageBody() projectId: string,
  ): Promise<void> {
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
    const userId: string = client.data['userId'] as string;
    const firstName: string = client.data['firstName'] as string;
    if (!userId) return;

    const { projectId, projectFieldId, value } = payload;

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
  handleFieldFocus(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: FieldFocusPayload,
  ): void {
    const { projectId, projectFieldId } = payload;
    const socketMap = this.presence.get(projectId);
    if (socketMap?.has(client.id)) {
      const existing = socketMap.get(client.id)!;
      socketMap.set(client.id, { ...existing, editingFieldId: projectFieldId });
    }
    this.emitPresenceUpdate(projectId);
  }

  @SubscribeMessage('field-blur')
  handleFieldBlur(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: FieldBlurPayload,
  ): void {
    const { projectId } = payload;
    const socketMap = this.presence.get(projectId);
    if (socketMap?.has(client.id)) {
      const existing = socketMap.get(client.id)!;
      socketMap.set(client.id, { ...existing, editingFieldId: null });
    }
    this.emitPresenceUpdate(projectId);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

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
