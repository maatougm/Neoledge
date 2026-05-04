import { Module } from '@nestjs/common';
import { AttachmentsService } from './attachments.service.js';
import { AttachmentsController, AttachmentAdminController } from './attachments.controller.js';
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js';

@Module({
  controllers: [AttachmentsController, AttachmentAdminController],
  providers: [AttachmentsService, ProjectAccessGuard],
})
export class AttachmentsModule {}
