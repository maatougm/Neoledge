import { Controller, Get, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { SearchService } from './search.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';

@Controller('api/search')
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(private readonly service: SearchService) {}

  @Get()
  async search(@Query('q') q: string, @Query('limit') limit?: string) {
    const r = await this.service.search(q ?? '', limit ? parseInt(limit, 10) : 8);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }
}
