import { IsBoolean, IsDateString, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class UpdateTimeEntryDto {
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(24)
  hours?: number;

  @IsOptional()
  @IsDateString()
  spentOn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  activity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;

  @IsOptional()
  @IsBoolean()
  isBillable?: boolean;

  @IsOptional()
  @IsUUID()
  workPackageId?: string | null;
}
