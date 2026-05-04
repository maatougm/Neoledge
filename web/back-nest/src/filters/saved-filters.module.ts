import { Module } from '@nestjs/common';
import { SavedFiltersService } from './saved-filters.service.js';
import { SavedFiltersController } from './saved-filters.controller.js';

@Module({
  controllers: [SavedFiltersController],
  providers: [SavedFiltersService],
  exports: [SavedFiltersService],
})
export class SavedFiltersModule {}
