import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSION_KEY = 'requirePermission';

export interface RequirePermissionMeta {
  /** One or more permission keys — user must have at least one. */
  anyOf: string[];
  /** Route param name holding a projectId, used to scope the check. */
  projectParam?: string;
}

/**
 * Guard a handler or controller with one or more permission keys.
 * If multiple keys are passed, the user passes when ANY one is granted.
 *
 * @example
 *   @RequirePermission('analytics.view')
 *   @RequirePermission(['wp.edit', 'wp.view'], { projectParam: 'id' })
 */
export function RequirePermission(
  keys: string | string[],
  options: { projectParam?: string } = {},
): ClassDecorator & MethodDecorator {
  const anyOf = Array.isArray(keys) ? keys : [keys];
  const meta: RequirePermissionMeta = { anyOf, projectParam: options.projectParam };
  return SetMetadata(REQUIRE_PERMISSION_KEY, meta);
}
