import {
  Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, HttpCode, HttpStatus, BadRequestException,
} from '@nestjs/common';
import { ChecklistsService } from './checklists.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@Controller('api/projects/:projectId/checklists')
@UseGuards(JwtAuthGuard)
export class ChecklistsController {
  constructor(private readonly service: ChecklistsService) {}

  @Get(':phase')
  async getPhase(@Param('projectId') projectId: string, @Param('phase') phase: string) {
    const result = await this.service.getForProjectPhase(projectId, phase);
    return result.value;
  }

  @Get(':phase/progress')
  async getProgress(@Param('projectId') projectId: string) {
    const result = await this.service.getProgress(projectId);
    return result.value;
  }

  @Patch(':itemId/toggle')
  async toggle(
    @Param('itemId') itemId: string,
    @CurrentUser() user: any,
    @Body() body: { isChecked: boolean },
  ) {
    const result = await this.service.toggle(itemId, user.userId, body.isChecked);
    if (result.isFailure) throw new BadRequestException(result.error);
    return result.value;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async addItem(
    @Param('projectId') projectId: string,
    @Body() body: { phase: string; label: string },
  ) {
    if (!body.label?.trim()) throw new BadRequestException('Label requis.');
    if (!body.phase?.trim()) throw new BadRequestException('Phase requise.');
    const result = await this.service.addItem(projectId, body.phase, body.label);
    if (result.isFailure) throw new BadRequestException(result.error);
    return result.value;
  }

  @Delete(':itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteItem(@Param('itemId') itemId: string) {
    const result = await this.service.deleteItem(itemId);
    if (result.isFailure) throw new BadRequestException(result.error);
  }
}
