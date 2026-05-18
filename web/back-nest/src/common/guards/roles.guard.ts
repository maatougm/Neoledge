import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator.js';

/**
 * Role gate based on the JWT `role` claim. Used in conjunction with
 * `@Roles('Admin', 'ProjectManager', …)` on a controller class or handler.
 *
 * If the decorator is absent (or empty), the guard passes — guarding is
 * opt-in per route. When present, the user must hold ANY of the listed
 * roles (OR semantics).
 *
 * Project-scoped access is the responsibility of `ProjectAccessGuard` —
 * this guard only checks the global role tier.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
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

    if (!user?.userId || !user.role) {
      return false;
    }

    return requiredRoles.includes(user.role);
  }
}
