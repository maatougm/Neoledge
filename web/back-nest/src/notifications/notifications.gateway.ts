import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

export interface NotificationPayload {
  id: string;
  type: string;
  title: string;
  message: string;
  projectId: string | null;
  isRead: boolean;
  createdAt: Date;
}

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/notifications' })
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() private readonly server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  handleConnection(client: Socket): void {
    const token: string | undefined = (client.handshake.auth as Record<string, string>)?.token;
    if (!token) {
      client.disconnect(true);
      return;
    }
    try {
      const secret = this.configService.get<string>('JWT_SECRET', 'dev-secret-change-me');
      const payload = this.jwtService.verify<{ sub: string }>(token, { secret });
      void client.join(`user:${payload.sub}`);
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(_client: Socket): void {}

  emitToUser(userId: string, payload: NotificationPayload): void {
    try {
      this.server.to(`user:${userId}`).emit('notification', payload);
    } catch {
      /* best-effort */
    }
  }
}
