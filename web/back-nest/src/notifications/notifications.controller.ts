import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

interface JwtUser {
  userId: string;
  role: string;
}

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  async getMyNotifications(
    @CurrentUser() user: JwtUser,
    @Query('cursor') cursor?: string,
    @Query('take') take?: string,
  ) {
    const result = await this.service.getForUser(user.userId, {
      cursor,
      take: take ? Math.min(parseInt(take, 10) || 50, 100) : undefined,
    });
    if (result.isFailure) throw new InternalServerErrorException(result.error);
    return result.value;
  }

  @Get('unread-count')
  async getUnreadCount(@CurrentUser() user: JwtUser) {
    const result = await this.service.getUnreadCount(user.userId);
    if (result.isFailure) throw new InternalServerErrorException(result.error);
    return { count: result.value };
  }

  /** Throttle write mutations: max 30 per minute per user. */
  @Patch(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markAsRead(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const result = await this.service.markAsRead(id, user.userId);
    if (result.isFailure) throw new NotFoundException(result.error);
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markAllAsRead(@CurrentUser() user: JwtUser) {
    const result = await this.service.markAllAsRead(user.userId);
    if (result.isFailure) throw new InternalServerErrorException(result.error);
  }

  /** Throttle write mutations: max 30 per minute per user. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const result = await this.service.delete(id, user.userId);
    if (result.isFailure) throw new NotFoundException(result.error);
  }
}
