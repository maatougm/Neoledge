import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PRESET_ROLE_PERMISSIONS } from '../../permissions/permission-keys.js';

const VALID_ROLES = Object.keys(PRESET_ROLE_PERMISSIONS);

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Le prénom ne doit pas dépasser 100 caractères.' })
  readonly firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Le nom ne doit pas dépasser 100 caractères.' })
  readonly lastName?: string;

  @IsOptional()
  @IsEmail({}, { message: "L'email n'est pas valide." })
  @MaxLength(256, {
    message: "L'email ne doit pas dépasser 256 caractères.",
  })
  readonly email?: string;

  @IsOptional()
  @IsIn(VALID_ROLES, { message: 'Le rôle sélectionné est invalide.' })
  readonly role?: string;

  @IsOptional()
  @IsBoolean()
  readonly isActive?: boolean;
}
