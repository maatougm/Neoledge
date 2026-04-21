import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpsertBudgetDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  laborBudget?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  materialBudget?: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
