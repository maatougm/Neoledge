import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateLineItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  type?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitCost?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  units?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  position?: number;
}
