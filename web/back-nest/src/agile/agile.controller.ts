import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, BadRequestException, HttpCode, HttpStatus } from '@nestjs/common';
import { AgileService } from './agile.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js';
import { ProjectAccess } from '../common/decorators/project-access.decorator.js';
import { CreateBoardDto } from './dto/create-board.dto.js';
import { UpdateBoardDto } from './dto/update-board.dto.js';
import { CreateColumnDto } from './dto/create-column.dto.js';
import { UpdateColumnDto } from './dto/update-column.dto.js';
import { ReorderColumnsDto } from './dto/reorder-columns.dto.js';
import { MoveCardDto } from './dto/move-card.dto.js';
import { CreateSprintDto } from './dto/create-sprint.dto.js';
import { UpdateSprintDto } from './dto/update-sprint.dto.js';
import { AddWpsToSprintDto } from './dto/add-wps-to-sprint.dto.js';

@Controller('pm/projects/:projectId')
@UseGuards(JwtAuthGuard, ProjectAccessGuard)
@ProjectAccess('projectId')
export class AgileController {
  constructor(private readonly service: AgileService) {}

  @Get('boards')
  async listBoards(@Param('projectId') projectId: string) {
    const r = await this.service.listBoards(projectId);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Get('boards/:id')
  async getBoard(@Param('id') id: string) {
    const r = await this.service.getBoard(id);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Post('boards')
  @HttpCode(HttpStatus.CREATED)
  async createBoard(
    @Param('projectId') projectId: string,
    @Body() dto: CreateBoardDto,
  ) {
    if (!dto.name?.trim()) throw new BadRequestException('Nom requis.');
    const r = await this.service.createBoard(projectId, dto);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Patch('boards/:id')
  async updateBoard(@Param('id') id: string, @Body() dto: UpdateBoardDto) {
    const r = await this.service.updateBoard(id, dto);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Delete('boards/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteBoard(@Param('id') id: string) {
    const r = await this.service.deleteBoard(id);
    if (r.isFailure) throw new BadRequestException(r.error);
  }

  @Post('boards/:id/columns')
  @HttpCode(HttpStatus.CREATED)
  async createColumn(@Param('id') boardId: string, @Body() dto: CreateColumnDto) {
    const r = await this.service.createColumn(boardId, dto);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Patch('boards/:id/columns/:columnId')
  async updateColumn(@Param('columnId') columnId: string, @Body() dto: UpdateColumnDto) {
    const r = await this.service.updateColumn(columnId, dto);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Delete('boards/:id/columns/:columnId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteColumn(@Param('columnId') columnId: string) {
    const r = await this.service.deleteColumn(columnId);
    if (r.isFailure) throw new BadRequestException(r.error);
  }

  @Patch('boards/:id/columns/reorder')
  async reorderColumns(@Param('id') boardId: string, @Body() body: ReorderColumnsDto) {
    const r = await this.service.reorderColumns(boardId, body.order);
    if (r.isFailure) throw new BadRequestException(r.error);
    return { success: true };
  }

  @Patch('boards/:id/cards/:wpId/move')
  async moveCard(
    @Param('wpId') wpId: string,
    @Body() body: MoveCardDto,
  ) {
    const r = await this.service.moveCard(wpId, body.columnId ?? null, body.position ?? 0);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Get('boards/:id/sprints')
  async listSprints(@Param('id') boardId: string) {
    const r = await this.service.listSprints(boardId);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Post('boards/:id/sprints')
  @HttpCode(HttpStatus.CREATED)
  async createSprint(
    @Param('id') boardId: string,
    @Body() dto: CreateSprintDto,
  ) {
    if (!dto.name?.trim()) throw new BadRequestException('Nom requis.');
    const r = await this.service.createSprint(boardId, dto);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Patch('sprints/:sprintId')
  async updateSprint(
    @Param('sprintId') id: string,
    @Body() dto: UpdateSprintDto,
  ) {
    const r = await this.service.updateSprint(id, dto);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Delete('sprints/:sprintId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSprint(@Param('sprintId') id: string) {
    const r = await this.service.deleteSprint(id);
    if (r.isFailure) throw new BadRequestException(r.error);
  }

  @Post('sprints/:sprintId/start')
  async startSprint(@Param('sprintId') id: string) {
    const r = await this.service.startSprint(id);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Post('sprints/:sprintId/close')
  async closeSprint(@Param('sprintId') id: string) {
    const r = await this.service.closeSprint(id);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Post('sprints/:sprintId/work-packages')
  async addWps(@Param('sprintId') id: string, @Body() body: AddWpsToSprintDto) {
    const r = await this.service.addWpToSprint(id, body.workPackageIds);
    if (r.isFailure) throw new BadRequestException(r.error);
    return { success: true };
  }

  @Delete('sprints/:sprintId/work-packages/:wpId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeWp(@Param('sprintId') id: string, @Param('wpId') wpId: string) {
    const r = await this.service.removeWpFromSprint(id, wpId);
    if (r.isFailure) throw new BadRequestException(r.error);
  }

  @Get('sprints/:sprintId/burndown')
  async getBurndown(@Param('sprintId') id: string) {
    const r = await this.service.getBurndown(id);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }
}
