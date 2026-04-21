import {
  Controller,
  Get,
  InternalServerErrorException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { TeamsService } from './teams.service.js';

@Controller('admin/teams')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  /**
   * GET /admin/teams
   * Returns all 4 canonical RACI teams.
   * Admin-only.
   */
  @Get()
  async findAll() {
    const result = await this.teamsService.findAll();

    if (result.isFailure) {
      throw new InternalServerErrorException(result.error);
    }

    return result.value;
  }
}
