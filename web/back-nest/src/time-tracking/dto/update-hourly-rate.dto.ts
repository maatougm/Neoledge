import { IsDateString, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdateHourlyRateDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100_000)
  rate?: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsDateString()
  validTo?: string | null;
}
