import { SetMetadata } from '@nestjs/common';

export const PROJECT_ACCESS_PARAM_KEY = 'projectAccessParam';

/** Mark a handler or controller as requiring project-scoped access.
 *  The param name is the route param that holds the projectId (default "id"). */
export const ProjectAccess = (paramName: string = 'id') =>
  SetMetadata(PROJECT_ACCESS_PARAM_KEY, paramName);
