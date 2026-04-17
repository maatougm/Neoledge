import { Controller, Get, Post, Patch, Delete, Put, Param, Body, UseGuards, BadRequestException, HttpCode, HttpStatus } from '@nestjs/common';
import { BudgetingService } from './budgeting.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@Controller('pm/projects/:projectId/budget')
@UseGuards(JwtAuthGuard)
export class BudgetingController {
  constructor(private readonly service: BudgetingService) {}

  @Get()
  async get(@Param('projectId') projectId: string) {
    const r = await this.service.getBudget(projectId);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Put()
  async upsert(
    @Param('projectId') projectId: string,
    @Body() dto: { laborBudget?: number; materialBudget?: number; currency?: string; notes?: string },
  ) {
    const r = await this.service.upsertBudget(projectId, dto);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Post('line-items')
  @HttpCode(HttpStatus.CREATED)
  async createLine(
    @Param('projectId') projectId: string,
    @Body() dto: { description: string; type?: string; unitCost: number; units: number; position?: number },
  ) {
    if (!dto.description?.trim()) throw new BadRequestException('Description requise.');
    const r = await this.service.createLineItem(projectId, dto);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Patch('line-items/:id')
  async updateLine(
    @Param('id') id: string,
    @Body() dto: { description?: string; type?: string; unitCost?: number; units?: number; position?: number },
  ) {
    const r = await this.service.updateLineItem(id, dto);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Delete('line-items/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteLine(@Param('id') id: string) {
    const r = await this.service.deleteLineItem(id);
    if (r.isFailure) throw new BadRequestException(r.error);
  }

  @Get('burn')
  async burn(@Param('projectId') projectId: string) {
    const r = await this.service.getBurnReport(projectId);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }
}

@Controller('admin/budgets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin')
export class AdminBudgetsController {
  constructor(private readonly service: BudgetingService) {}

  @Get('overview')
  async overview() {
    const r = await this.service.getOverview();
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }
}
