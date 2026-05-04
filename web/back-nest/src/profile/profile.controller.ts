import { Controller, Get, Put, Post, Body, Param, Res, UseGuards, HttpCode, HttpStatus, BadRequestException, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { ProfileService } from './profile.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import {
  UpdateProfileDto,
  ChangePasswordDto,
  UploadAvatarDto,
  UpdatePreferencesDto,
} from './dto/profile.dto.js';

@Controller('api/userprofile')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(private readonly service: ProfileService) {}

  @Get()
  async getProfile(@CurrentUser() user: { userId: string }) {
    const result = await this.service.getProfile(user.userId);
    if (result.isFailure) throw new NotFoundException(result.error);
    return result.value;
  }

  @Put()
  async updateProfile(@CurrentUser() user: { userId: string }, @Body() dto: UpdateProfileDto) {
    const result = await this.service.updateProfile(user.userId, dto);
    if (result.isFailure) throw new BadRequestException(result.error);
    return result.value;
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(@CurrentUser() user: { userId: string }, @Body() body: ChangePasswordDto) {
    const result = await this.service.changePassword(user.userId, body.currentPassword, body.newPassword);
    if (result.isFailure) throw new BadRequestException(result.error);
  }

  @Post('avatar')
  async uploadAvatar(@CurrentUser() user: { userId: string }, @Body() body: UploadAvatarDto) {
    const result = await this.service.uploadAvatar(user.userId, body.base64Image, body.fileExtension);
    if (result.isFailure) throw new BadRequestException(result.error);
    return result.value;
  }

  @Get('avatar/:userId')
  async serveAvatar(@Param('userId') userId: string, @Res() res: Response) {
    const result = await this.service.getAvatarPath(userId);
    if (result.isFailure) throw new NotFoundException(result.error);
    return res.sendFile(result.value as string, { root: '.' });
  }

  @Get('preferences')
  async getPreferences(@CurrentUser() user: { userId: string }) {
    const result = await this.service.getPreferences(user.userId);
    return result.value;
  }

  @Put('preferences')
  @HttpCode(HttpStatus.NO_CONTENT)
  async updatePreferences(@CurrentUser() user: { userId: string }, @Body() dto: UpdatePreferencesDto) {
    const result = await this.service.updatePreferences(user.userId, { ...dto });
    if (result.isFailure) throw new BadRequestException(result.error);
  }
}
