import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateLineItemDto {
  @IsString()
  @MaxLength(500)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  type?: string;

  @IsNumber()
  @Min(0)
  unitCost!: number;

  @IsNumber()
  @Min(0)
  units!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  position?: number;
}
