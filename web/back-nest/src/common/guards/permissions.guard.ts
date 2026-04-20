import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsService } from '../../permissions/permissions.service.js';
import {
  REQUIRE_PERMISSION_KEY,
  type RequirePermissionMeta,
} from '../decorators/require-permission.decorator.js';

@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<RequirePermissionMeta | undefined>(
      REQUIRE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!meta || meta.anyOf.length === 0) {
      return true;
    }

    const req = context.switchToHttp().getRequest<{
      user?: { userId?: string };
      params?: Record<string, string>;
    }>();

    const userId = req.user?.userId;
    if (!userId) {
      throw new ForbiddenException('Not authenticated');
    }

    const projectId = meta.projectParam ? req.params?.[meta.projectParam] : undefined;

    for (const key of meta.anyOf) {
      const allowed = await this.permissions.userHasPermission(userId, key, projectId);
      if (allowed) return true;
    }

    this.logger.debug(
      `Permission denied for user ${userId}: needs any of [${meta.anyOf.join(', ')}] (project=${projectId ?? 'global'})`,
    );
    throw new ForbiddenException(
      `Missing permission (requires: ${meta.anyOf.join(' | ')})`,
    );
  }
}
