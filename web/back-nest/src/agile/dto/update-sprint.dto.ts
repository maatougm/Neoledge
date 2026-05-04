import { IsDateString, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdateSprintDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  goal?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10_000)
  capacity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  status?: string;
}
