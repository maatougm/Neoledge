import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ALL_PERMISSION_KEYS } from '../../permissions/permission-keys.js';

const ROLE_NAME_PATTERN = /^[a-zA-Z0-9 \-_]+$/;
const PERMISSION_KEY_WHITELIST = ALL_PERMISSION_KEYS as unknown as string[];

export class CreateRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(ROLE_NAME_PATTERN, {
    message: 'name may only contain letters, digits, spaces, hyphens, and underscores',
  })
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsArray()
  @IsString({ each: true })
  @IsIn(PERMISSION_KEY_WHITELIST, {
    each: true,
    message: 'permissionKeys must only contain keys from the permission catalog',
  })
  permissionKeys!: string[];
}

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(ROLE_NAME_PATTERN, {
    message: 'name may only contain letters, digits, spaces, hyphens, and underscores',
  })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsIn(PERMISSION_KEY_WHITELIST, {
    each: true,
    message: 'permissionKeys must only contain keys from the permission catalog',
  })
  permissionKeys?: string[];
}

export class ClonePresetDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(ROLE_NAME_PATTERN, {
    message: 'newName may only contain letters, digits, spaces, hyphens, and underscores',
  })
  newName!: string;
}

export class AssignRoleDto {
  @IsUUID()
  userId!: string;

  @IsUUID()
  roleId!: string;

  @IsOptional()
  @IsUUID()
  projectId?: string | null;
}

export class UnassignRoleDto {
  @IsUUID()
  assignmentId!: string;
}
