import { Module } from '@nestjs/common';
import { MeetingsService } from './meetings.service.js';
import { MeetingsController } from './meetings.controller.js';

@Module({
  controllers: [MeetingsController],
  providers: [MeetingsService],
})
export class MeetingsModule {}
