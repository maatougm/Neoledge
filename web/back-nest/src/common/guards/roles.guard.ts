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

    // 2. Permission path: resolve required roles into the INTERSECTION of
    //    their exclusive permission keys, then check that the user holds ALL
    //    of those keys.  Using a union + any-match was wrong: any role that
    //    shares even one permission key with Admin (e.g. attachment.upload)
    //    would pass an @Roles('Admin') check, allowing Member/PM to reach
    //    admin-only endpoints.
    //
    //    Correct semantics: a user passes @Roles('Admin') only when their live
    //    permission set is a superset of the Admin preset — i.e. they hold
    //    *every* key the required roles define collectively.
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
      if (!(await this.permissions.userHasPermission(user.userId, key))) {
        this.logger.debug(
          `Legacy @Roles shim denied user ${user.userId} — missing permission "${key}" (needed for roles [${requiredRoles.join(', ')}])`,
        );
        return false;
      }
    }

    return true;
  }
}
