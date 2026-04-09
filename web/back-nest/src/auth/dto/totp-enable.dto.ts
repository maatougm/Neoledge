import { IsNotEmpty, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TotpCodeDto {
  @ApiProperty({ example: '123456', description: '6-digit TOTP code' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6, { message: 'Le code doit être composé de 6 chiffres.' })
  code: string;
}

export class TotpLoginDto {
  @ApiProperty({ description: 'Short-lived temp token returned by login step 1' })
  @IsString()
  @IsNotEmpty()
  tempToken: string;

  @ApiProperty({ example: '123456', description: '6-digit TOTP code' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6, { message: 'Le code doit être composé de 6 chiffres.' })
  code: string;
}
