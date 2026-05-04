import { Module, forwardRef } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsGateway } from './notifications.gateway.js';
import { MailModule } from '../mail/mail.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [MailModule, AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsGateway],
  exports: [NotificationsService],
})
export class NotificationsModule {}
