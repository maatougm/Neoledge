import { Module } from '@nestjs/common';
import { AutomationService } from './automation.service.js';
import { AutomationController } from './automation.controller.js';

@Module({
  controllers: [AutomationController],
  providers: [AutomationService],
  exports: [AutomationService],
})
export class AutomationModule {}
