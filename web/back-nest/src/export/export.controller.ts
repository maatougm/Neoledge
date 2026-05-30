import { Controller, Get, Param, Query, Res, UseGuards, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { ExportService } from './export.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js';
import { ProjectAccess } from '../common/decorators/project-access.decorator.js';

@Controller('api/export')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin', 'ProjectManager')
export class ExportController {
  constructor(private readonly service: ExportService) {}

  @Get('projects/csv')
  async exportCsv(@Query('ids') ids: string, @Res() res: Response) {
    const idList = ids ? ids.split(',').filter(Boolean) : undefined;
    const result = await this.service.exportCsv(idList);
    if (result.isFailure) throw new NotFoundException(result.error);
    const { content, contentType, fileName } = result.value!;
    res.set({ 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="${fileName}"` });
    res.send(content);
  }

  @Get('projects/json')
  async exportJson(@Query('ids') ids: string) {
    const idList = ids ? ids.split(',').filter(Boolean) : undefined;
    const result = await this.service.exportJson(idList);
    return result.value;
  }

  @Get('projects/:projectId/report')
  async getReport(@Param('projectId') projectId: string) {
    const result = await this.service.generateReport(projectId);
    if (result.isFailure) throw new NotFoundException(result.error);
    return result.value;
  }

  /**
   * Structured single-project report (JSON) the frontend renders to CSV/PDF.
   * Project-scoped: the class-level @Roles already limits this to Admin/PM, and
   * ProjectAccessGuard additionally requires the caller to actually own/belong
   * to THIS project — closing the IDOR where any PM could export any project.
   */
  @Get('projects/:projectId/report-data')
  @UseGuards(ProjectAccessGuard)
  @ProjectAccess('projectId')
  async getReportData(@Param('projectId') projectId: string) {
    const result = await this.service.generateReportData(projectId);
    if (result.isFailure) throw new NotFoundException(result.error);
    return result.value;
  }
}
