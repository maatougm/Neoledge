import {
  IsString,
  IsOptional,
  IsArray,
  IsBoolean,
  IsObject,
  IsDateString,
  ArrayMaxSize,
  MaxLength,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class FilterDateRangeDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class FilterCriteriaDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  status?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  priority?: string[];

  @IsOptional() @IsBoolean() assignedToMe?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  tags?: string[];

  @IsOptional() @IsString() @MaxLength(200) search?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => FilterDateRangeDto)
  dateRange?: FilterDateRangeDto;
}

export class CreateSavedFilterDto {
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-zA-Z0-9 \-_]+$/, { message: 'name must contain only letters, numbers, spaces, hyphens and underscores' })
  name!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => FilterCriteriaDto)
  filters!: FilterCriteriaDto;

  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpdateSavedFilterDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-zA-Z0-9 \-_]+$/, { message: 'name must contain only letters, numbers, spaces, hyphens and underscores' })
  name?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => FilterCriteriaDto)
  filters?: FilterCriteriaDto;

  @IsOptional() @IsBoolean() isDefault?: boolean;
}
