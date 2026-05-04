import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateColumnDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  wipLimit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  mapStatus?: string;
}
