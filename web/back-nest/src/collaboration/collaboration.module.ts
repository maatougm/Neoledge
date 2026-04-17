import { Module } from '@nestjs/common';
import { CollaborationGateway } from './collaboration.gateway.js';
import { CollaborationService } from './collaboration.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [PrismaModule, AuthModule],
  providers: [CollaborationGateway, CollaborationService],
  exports: [CollaborationGateway],
})
export class CollaborationModule {}
