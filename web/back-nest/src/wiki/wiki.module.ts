import { Module } from '@nestjs/common';
import { WikiService } from './wiki.service.js';
import { WikiController } from './wiki.controller.js';

@Module({
  controllers: [WikiController],
  providers: [WikiService],
  exports: [WikiService],
})
export class WikiModule {}
