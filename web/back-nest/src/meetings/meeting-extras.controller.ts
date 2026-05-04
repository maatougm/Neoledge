import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, BadRequestException, HttpCode, HttpStatus } from '@nestjs/common';
import { AgendaService } from './agenda.service.js';
import { AttendeesService } from './attendees.service.js';
import { OutcomesService } from './outcomes.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ProjectAccess } from '../common/decorators/project-access.decorator.js';

interface AuthUser { userId: string }

@Controller('pm/projects/:projectId/meetings/:meetingId')
@UseGuards(JwtAuthGuard, ProjectAccessGuard)
@ProjectAccess('projectId')
export class MeetingExtrasController {
  constructor(
    private readonly agenda: AgendaService,
    private readonly attendees: AttendeesService,
    private readonly outcomes: OutcomesService,
  ) {}

  // ── Agenda ────────────────────────────────────────
  @Get('agenda')
  async listAgenda(@Param('meetingId') meetingId: string) {
    const r = await this.agenda.list(meetingId);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Post('agenda')
  @HttpCode(HttpStatus.CREATED)
  async addAgenda(
    @Param('meetingId') meetingId: string,
    @Body() dto: { title: string; duration?: number; responsibleId?: string; notes?: string },
  ) {
    if (!dto.title?.trim()) throw new BadRequestException('Titre requis.');
    const r = await this.agenda.create(meetingId, dto);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Patch('agenda/:itemId')
  async updateAgenda(
    @Param('itemId') itemId: string,
    @Body() dto: { title?: string; duration?: number | null; responsibleId?: string | null; notes?: string; position?: number },
  ) {
    const r = await this.agenda.update(itemId, dto);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Delete('agenda/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAgenda(@Param('itemId') itemId: string) {
    const r = await this.agenda.delete(itemId);
    if (r.isFailure) throw new BadRequestException(r.error);
  }

  @Patch('agenda/reorder')
  async reorderAgenda(@Param('meetingId') meetingId: string, @Body() body: { order: string[] }) {
    const r = await this.agenda.reorder(meetingId, body.order);
    if (r.isFailure) throw new BadRequestException(r.error);
    return { success: true };
  }

  // ── Attendees ────────────────────────────────────
  @Get('attendees')
  async listAttendees(@Param('meetingId') meetingId: string) {
    const r = await this.attendees.list(meetingId);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Post('attendees')
  @HttpCode(HttpStatus.CREATED)
  async addAttendee(
    @Param('meetingId') meetingId: string,
    @Body() dto: { userId?: string; externalName?: string; externalEmail?: string; role?: string; isPresent?: boolean },
  ) {
    const r = await this.attendees.add(meetingId, dto);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Patch('attendees/:attendeeId')
  async updateAttendee(@Param('attendeeId') id: string, @Body() dto: { isPresent?: boolean; role?: string | null }) {
    const r = await this.attendees.update(id, dto);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Delete('attendees/:attendeeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeAttendee(@Param('attendeeId') id: string) {
    const r = await this.attendees.remove(id);
    if (r.isFailure) throw new BadRequestException(r.error);
  }

  @Post('attendees/bulk-mark')
  async bulkMark(
    @Param('meetingId') meetingId: string,
    @Body() body: { ids: string[]; isPresent: boolean },
  ) {
    const r = await this.attendees.bulkMarkPresent(meetingId, body.ids, body.isPresent);
    if (r.isFailure) throw new BadRequestException(r.error);
    return { success: true };
  }

  // ── Outcomes ─────────────────────────────────────
  @Get('outcomes')
  async listOutcomes(@Param('meetingId') meetingId: string, @Query('type') type?: string) {
    const r = await this.outcomes.list(meetingId, type);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Post('outcomes')
  @HttpCode(HttpStatus.CREATED)
  async addOutcome(
    @Param('meetingId') meetingId: string,
    @Body() dto: { type: string; description: string; ownerId?: string; dueDate?: string },
  ) {
    if (!dto.description?.trim()) throw new BadRequestException('Description requise.');
    if (!dto.type) throw new BadRequestException('Type requis.');
    const r = await this.outcomes.create(meetingId, dto);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Patch('outcomes/:outcomeId')
  async updateOutcome(
    @Param('outcomeId') id: string,
    @Body() dto: { type?: string; description?: string; ownerId?: string | null; dueDate?: string | null },
  ) {
    const r = await this.outcomes.update(id, dto);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Delete('outcomes/:outcomeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeOutcome(@Param('outcomeId') id: string) {
    const r = await this.outcomes.delete(id);
    if (r.isFailure) throw new BadRequestException(r.error);
  }

  @Post('outcomes/:outcomeId/convert-to-wp')
  async convertToWp(
    @Param('projectId') projectId: string,
    @Param('outcomeId') outcomeId: string,
    @CurrentUser() user: AuthUser,
  ) {
    const r = await this.outcomes.convertToWorkPackage(outcomeId, projectId, user.userId);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }
}
