import { IsDateString, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreateHourlyRateDto {
  @IsUUID()
  userId!: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsNumber()
  @Min(0)
  @Max(100_000)
  rate!: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsDateString()
  validFrom!: string;

  @IsOptional()
  @IsDateString()
  validTo?: string;
}
