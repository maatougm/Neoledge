import { Module } from '@nestjs/common';
import { PortalService } from './portal.service.js';
import {
  PortalTokensAdminController,
  PortalTokenRevokeController,
  PortalPublicController,
} from './portal.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [
    PortalTokensAdminController,
    PortalTokenRevokeController,
    PortalPublicController,
  ],
  providers: [PortalService],
})
export class PortalModule {}
