import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service.js';
import { getJwtSecret } from '../auth/jwt-secret.js';

export interface NotificationPayload {
  id: string;
  type: string;
  title: string;
  message: string;
  projectId: string | null;
  isRead: boolean;
  createdAt: Date;
}

const SESSION_CACHE_TTL_MS = 30_000;

const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

@WebSocketGateway({
  cors: { origin: CORS_ORIGINS, credentials: true },
  namespace: '/notifications',
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() private readonly server: Server;
  private readonly logger = new Logger(NotificationsGateway.name);

  // Map<userId, { tokenVersion, expiresAt }>
  private readonly sessionCache = new Map<string, { tokenVersion: number; expiresAt: number }>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

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
        tokenVersion?: number;
        aud?: string;
        totpPending?: boolean;
      }>(token, { secret });

      // Parity with JwtStrategy: reject 2FA-pending / non-access tokens so a
      // temp token cannot open a real-time channel.
      if ((payload.aud && payload.aud !== 'access') || payload.totpPending) {
        client.disconnect(true);
        return;
      }

      const user = await this.prisma.appUser.findUnique({
        where: { id: payload.sub, isActive: true },
        select: { id: true, tokenVersion: true },
      });
      if (!user) {
        client.disconnect(true);
        return;
      }

      // Reject tokens whose version is behind the DB (role change, password
      // reset, forced logout) — same invariant JwtStrategy enforces on REST.
      const claimed = payload.tokenVersion ?? 0;
      if (claimed !== user.tokenVersion) {
        client.disconnect(true);
        return;
      }

      client.data['userId'] = payload.sub;
      client.data['tokenVersion'] = user.tokenVersion;
      this.sessionCache.set(payload.sub, {
        tokenVersion: user.tokenVersion,
        expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
      });

      void client.join(`user:${payload.sub}`);
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const userId = client.data['userId'] as string | undefined;
    if (userId) this.sessionCache.delete(userId);
  }

  emitToUser(userId: string, payload: NotificationPayload): void {
    try {
      this.server.to(`user:${userId}`).emit('notification', payload);
    } catch (e) {
      this.logger.error(`emitToUser failed for user ${userId}`, e);
    }
  }
}
