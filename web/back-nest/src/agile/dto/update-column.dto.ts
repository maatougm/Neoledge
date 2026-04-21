import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateColumnDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  wipLimit?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  mapStatus?: string | null;
}
