import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const UserRoleValues = ['Admin', 'ProjectManager', 'SpecificationTeam', 'RealizationTeam', 'DeploymentTeam', 'Viewer'] as const;

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
  @IsEnum(UserRoleValues, { message: 'Le rôle sélectionné est invalide.' })
  readonly role?: string;
}
