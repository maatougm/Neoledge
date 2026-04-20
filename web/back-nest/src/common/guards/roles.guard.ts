import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsService } from '../../permissions/permissions.service.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import { PRESET_ROLE_PERMISSIONS } from '../../permissions/permission-keys.js';

/**
 * Back-compat shim for the legacy `@Roles('Admin', 'ProjectManager')` decorator.
 *
 * We keep the decorator alive during the Phase 1 migration so every controller
 * does not have to flip at once. The shim resolves the user's JWT `role` claim
 * into the corresponding preset permission set and grants access when the
 * current request's handler was protected by any role the user holds.
 *
 * Once every `@Roles()` site has been rewritten to `@RequirePermission()`, this
 * guard (and the decorator itself) can be deleted.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const req = context.switchToHttp().getRequest<{
      user?: { userId?: string; role?: string };
    }>();
    const user = req.user;

    if (!user?.userId) {
      return false;
    }

    // 1. Legacy path: JWT still carries `role` — accept if any required role
    //    matches, matching the pre-migration behaviour.
    if (user.role && requiredRoles.includes(user.role)) {
      return true;
    }

    // 2. Permission path: resolve required roles into a union of permission
    //    keys, then check the user's live permission set.
    const wantedKeys = new Set<string>();
    for (const role of requiredRoles) {
      const preset = PRESET_ROLE_PERMISSIONS[role];
      if (preset) {
        for (const k of preset) wantedKeys.add(k);
      }
    }

    if (wantedKeys.size === 0) {
      return false;
    }

    for (const key of wantedKeys) {
      if (await this.permissions.userHasPermission(user.userId, key)) {
        return true;
      }
    }

    this.logger.debug(
      `Legacy @Roles shim denied user ${user.userId} — needed one of [${requiredRoles.join(', ')}]`,
    );
    return false;
  }
}
