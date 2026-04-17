import { Module } from '@nestjs/common';
import { PortfolioService } from './portfolio.service.js';
import { PortfolioController, VersionsController } from './portfolio.controller.js';

@Module({
  controllers: [PortfolioController, VersionsController],
  providers: [PortfolioService],
  exports: [PortfolioService],
})
export class PortfolioModule {}
