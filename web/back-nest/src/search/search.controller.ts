import { Controller, Get, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { SearchService } from './search.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

interface JwtUser {
  userId: string;
  role: string;
}

@Controller('api/search')
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(private readonly service: SearchService) {}

  @Get()
  async search(
    @CurrentUser() user: JwtUser,
    @Query('q') q: string,
    @Query('limit') limit?: string,
  ) {
    const r = await this.service.search(
      q ?? '',
      user.userId,
      limit ? parseInt(limit, 10) : 8,
    );
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }
}
