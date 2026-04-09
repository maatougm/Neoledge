import { Module } from '@nestjs/common';
import { AttachmentsService } from './attachments.service.js';
import { AttachmentsController, AttachmentAdminController } from './attachments.controller.js';

@Module({
  controllers: [AttachmentsController, AttachmentAdminController],
  providers: [AttachmentsService],
})
export class AttachmentsModule {}
