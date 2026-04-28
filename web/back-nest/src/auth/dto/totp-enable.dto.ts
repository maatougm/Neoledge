import { IsNotEmpty, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

export class TotpCodeDto {
  @ApiProperty({ example: '123456', description: '6-digit TOTP code' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6, { message: 'Le code doit être composé de 6 chiffres.' })
  code: string;
}

/** Used by POST /auth/2fa/disable — code is optional for orphan-state cleanup */
export class DisableTotpDto {
  @ApiPropertyOptional({ example: '123456', description: '6-digit TOTP code (required when 2FA is active, omit to clear orphan setup)' })
  @IsOptional()
  @IsString()
  @Length(6, 6, { message: 'Le code doit être composé de 6 chiffres.' })
  code?: string;
}

export class TotpLoginDto {
  @ApiProperty({ description: 'Short-lived temp token returned by login step 1' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  tempToken: string;

  @ApiProperty({ example: '123456', description: '6-digit TOTP code' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6, { message: 'Le code doit être composé de 6 chiffres.' })
  code: string;
}
