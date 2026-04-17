import { IsString, IsOptional, IsBoolean, IsEmail, IsInt, Min } from 'class-validator';

export class GenerateTokenDto {
  @IsOptional() @IsString() label?: string;
  @IsInt() @Min(1) expiresInDays!: number;
}

export class SubmitSignoffDto {
  @IsString() clientName!: string;
  @IsOptional() @IsEmail() clientEmail?: string;
  @IsOptional() @IsString() comment?: string;
  @IsBoolean() isApproved!: boolean;
}
