// Note: Add <meta name="robots" content="noindex"> to the frontend ClientPortalView.vue
// to prevent search engines from indexing client portal pages.

import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { PortalService } from './portal.service.js';
import { GenerateTokenDto, SubmitSignoffDto } from './dto/portal.dto.js';

// ─── Admin routes (JWT required) ─────────────────────────────────────────────

@Controller('admin/projects/:projectId/portal-tokens')
@UseGuards(JwtAuthGuard)
export class PortalTokensAdminController {
  constructor(private readonly portalService: PortalService) {}

  @Post()
  async generate(
    @Param('projectId') projectId: string,
    @Body() dto: GenerateTokenDto,
    @Req() req: Request & { user?: { userId?: string } },
  ) {
    const userId = req.user?.userId ?? '';
    if (!userId) {
      throw new HttpException('Authenticated user id missing.', HttpStatus.UNAUTHORIZED);
    }
    const result = await this.portalService.generateToken(projectId, userId, dto);
    if (result.isFailure) {
      throw new HttpException(result.error ?? 'Erreur interne.', HttpStatus.BAD_REQUEST);
    }
    return result.value;
  }

  @Get()
  async list(@Param('projectId') projectId: string) {
    const result = await this.portalService.listTokens(projectId);
    if (result.isFailure) {
      throw new HttpException(result.error ?? 'Erreur interne.', HttpStatus.BAD_REQUEST);
    }
    return result.value;
  }
}

@Controller('admin/portal-tokens')
@UseGuards(JwtAuthGuard)
export class PortalTokenRevokeController {
  constructor(private readonly portalService: PortalService) {}

  @Delete(':id')
  async revoke(@Param('id') id: string) {
    const result = await this.portalService.revokeToken(id);
    if (result.isFailure) {
      throw new HttpException(result.error ?? 'Erreur interne.', HttpStatus.BAD_REQUEST);
    }
    return { revoked: true };
  }
}

// ─── Public portal routes (NO guard) ─────────────────────────────────────────

@Controller('api/portal')
export class PortalPublicController {
  constructor(private readonly portalService: PortalService) {}

  @Get(':token')
  async getPortalView(@Param('token') token: string) {
    try {
      return await this.portalService.validateAndFetchProject(token);
    } catch (err: unknown) {
      if (err instanceof HttpException) throw err;
      throw new HttpException('Erreur interne.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':token/signoff')
  async submitSignoff(
    @Param('token') token: string,
    @Body() dto: SubmitSignoffDto,
    @Req() req: Request,
  ) {
    const ipAddress =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
      req.socket.remoteAddress;

    const result = await this.portalService.submitSignoff(token, dto, ipAddress);
    if (result.isFailure) {
      throw new HttpException(result.error ?? 'Erreur interne.', HttpStatus.BAD_REQUEST);
    }
    return result.value;
  }
}

// ─── Composite controller export for module ──────────────────────────────────

export const PortalController = [
  PortalTokensAdminController,
  PortalTokenRevokeController,
  PortalPublicController,
];
