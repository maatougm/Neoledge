import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { MailModule } from '../mail/mail.module.js';
import { DeadlinesService } from './deadlines.service.js';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, NotificationsModule, MailModule],
  providers: [DeadlinesService],
})
export class DeadlinesModule {}
