import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';
import { AnalyticsCacheService } from './analytics-cache.service.js';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsCacheService],
  exports: [AnalyticsCacheService],
})
export class AnalyticsModule {}
