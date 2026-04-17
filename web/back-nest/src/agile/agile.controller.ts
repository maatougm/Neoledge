import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, BadRequestException, HttpCode, HttpStatus } from '@nestjs/common';
import { AgileService } from './agile.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';

@Controller('pm/projects/:projectId')
@UseGuards(JwtAuthGuard)
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
    @Body() dto: { name: string; type?: string; isDefault?: boolean },
  ) {
    if (!dto.name?.trim()) throw new BadRequestException('Nom requis.');
    const r = await this.service.createBoard(projectId, dto);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Patch('boards/:id')
  async updateBoard(@Param('id') id: string, @Body() dto: { name?: string; type?: string; isDefault?: boolean }) {
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
  async createColumn(@Param('id') boardId: string, @Body() dto: { name: string; wipLimit?: number; mapStatus?: string }) {
    const r = await this.service.createColumn(boardId, dto);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Patch('boards/:id/columns/:columnId')
  async updateColumn(@Param('columnId') columnId: string, @Body() dto: { name?: string; wipLimit?: number | null; mapStatus?: string | null }) {
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
  async reorderColumns(@Param('id') boardId: string, @Body() body: { order: string[] }) {
    const r = await this.service.reorderColumns(boardId, body.order);
    if (r.isFailure) throw new BadRequestException(r.error);
    return { success: true };
  }

  @Patch('boards/:id/cards/:wpId/move')
  async moveCard(
    @Param('wpId') wpId: string,
    @Body() body: { columnId: string | null; position?: number },
  ) {
    const r = await this.service.moveCard(wpId, body.columnId, body.position ?? 0);
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
    @Body() dto: { name: string; startDate: string; endDate: string; goal?: string; capacity?: number },
  ) {
    if (!dto.name?.trim()) throw new BadRequestException('Nom requis.');
    const r = await this.service.createSprint(boardId, dto);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Patch('sprints/:sprintId')
  async updateSprint(
    @Param('sprintId') id: string,
    @Body() dto: { name?: string; startDate?: string; endDate?: string; goal?: string; capacity?: number; status?: string },
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
  async addWps(@Param('sprintId') id: string, @Body() body: { workPackageIds: string[] }) {
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
