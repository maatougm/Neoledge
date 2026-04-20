import { Module } from '@nestjs/common';
import { PortfolioService } from './portfolio.service.js';
import { PortfolioController, VersionsController } from './portfolio.controller.js';
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js';

@Module({
  controllers: [PortfolioController, VersionsController],
  providers: [PortfolioService, ProjectAccessGuard],
  exports: [PortfolioService],
})
export class PortfolioModule {}
