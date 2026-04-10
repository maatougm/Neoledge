import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { AutomationService, CreateRuleDto, UpdateRuleDto } from './automation.service.js';

@Controller('pm/projects/:projectId/automation')
@UseGuards(JwtAuthGuard)
export class AutomationController {
  constructor(private readonly automationService: AutomationService) {}

  /** Verify caller is Admin or the project's assigned manager */
  private async assertAccess(projectId: string, req: { user: { userId: string; role: string } }) {
    const { userId, role } = req.user;
    if (role === 'Admin') return;
    const allowed = await this.automationService.isProjectManager(projectId, userId);
    if (!allowed) throw new ForbiddenException('Accès refusé à ce projet.');
  }

  @Post('rules')
  async createRule(
    @Param('projectId') projectId: string,
    @Body() dto: CreateRuleDto,
    @Request() req: { user: { userId: string; role: string } },
  ) {
    await this.assertAccess(projectId, req);
    const result = await this.automationService.createRule(projectId, dto);
    if (result.isFailure) return { success: false, error: result.error };
    return { success: true, data: result.value };
  }

  @Get('rules')
  async listRules(
    @Param('projectId') projectId: string,
    @Request() req: { user: { userId: string; role: string } },
  ) {
    await this.assertAccess(projectId, req);
    const result = await this.automationService.listRules(projectId);
    if (result.isFailure) return { success: false, error: result.error };
    return { success: true, data: result.value };
  }

  @Patch('rules/:ruleId')
  async updateRule(
    @Param('projectId') projectId: string,
    @Param('ruleId') ruleId: string,
    @Body() dto: UpdateRuleDto,
    @Request() req: { user: { userId: string; role: string } },
  ) {
    await this.assertAccess(projectId, req);
    const result = await this.automationService.updateRule(ruleId, dto);
    if (result.isFailure) return { success: false, error: result.error };
    return { success: true, data: result.value };
  }

  @Delete('rules/:ruleId')
  async deleteRule(
    @Param('projectId') projectId: string,
    @Param('ruleId') ruleId: string,
    @Request() req: { user: { userId: string; role: string } },
  ) {
    await this.assertAccess(projectId, req);
    const result = await this.automationService.deleteRule(ruleId);
    if (result.isFailure) return { success: false, error: result.error };
    return { success: true };
  }

  @Patch('rules/:ruleId/toggle')
  async toggleRule(
    @Param('projectId') projectId: string,
    @Param('ruleId') ruleId: string,
    @Body() body: { isActive: boolean },
    @Request() req: { user: { userId: string; role: string } },
  ) {
    await this.assertAccess(projectId, req);
    const result = await this.automationService.toggleRule(ruleId, body.isActive);
    if (result.isFailure) return { success: false, error: result.error };
    return { success: true, data: result.value };
  }

  @Get('logs')
  async getLogs(
    @Param('projectId') projectId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Request() req: { user: { userId: string; role: string } },
  ) {
    await this.assertAccess(projectId, req);
    const result = await this.automationService.getLogs(projectId, Math.min(limit, 200));
    if (result.isFailure) return { success: false, error: result.error };
    return { success: true, data: result.value };
  }
}
