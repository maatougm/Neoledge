import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { VALID_ROLES } from '../../common/constants/roles.js';

export class CreateUserDto {
  @IsNotEmpty({ message: 'Le prénom est requis.' })
  @IsString()
  @MaxLength(100, { message: 'Le prénom ne doit pas dépasser 100 caractères.' })
  readonly firstName: string;

  @IsNotEmpty({ message: 'Le nom est requis.' })
  @IsString()
  @MaxLength(100, { message: 'Le nom ne doit pas dépasser 100 caractères.' })
  readonly lastName: string;

  @IsNotEmpty({ message: "L'email est requis." })
  @IsEmail({}, { message: "L'email n'est pas valide." })
  @MaxLength(256, {
    message: "L'email ne doit pas dépasser 256 caractères.",
  })
  readonly email: string;

  @IsNotEmpty({ message: 'Le mot de passe est requis.' })
  @IsString()
  @MinLength(8, {
    message: 'Le mot de passe doit contenir au moins 8 caractères.',
  })
  @Matches(/[A-Z]/, {
    message: 'Le mot de passe doit contenir au moins une majuscule.',
  })
  @Matches(/[0-9]/, {
    message: 'Le mot de passe doit contenir au moins un chiffre.',
  })
  readonly password: string;

  @IsIn(VALID_ROLES, { message: 'Le rôle sélectionné est invalide.' })
  readonly role: string;
}
