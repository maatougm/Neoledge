import {
  IsString,
  IsOptional,
  IsArray,
  IsBoolean,
  IsInt,
  IsIn,
  MaxLength,
  ValidateNested,
  ArrayMaxSize,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

const FIELD_TYPES = ['Text', 'Number', 'Date', 'Select', 'Checkbox', 'Textarea'] as const;
const FIELD_CATEGORIES = ['Static', 'Dynamic', 'Custom'] as const;

export class TemplateFieldDto {
  @IsString() @MaxLength(200) label!: string;

  @IsOptional() @IsString() @IsIn(FIELD_TYPES) type?: string;

  @IsOptional() @IsString() @IsIn(FIELD_CATEGORIES) category?: string;

  @IsOptional() @IsBoolean() isRequired?: boolean;

  @IsOptional() @IsInt() @Min(0) displayOrder?: number;

  // JSON-encoded options string — max 4KB to defend against oversized payloads.
  @IsOptional() @IsString() @MaxLength(4096) options?: string;

  @IsOptional() @IsBoolean() isBacklogDriver?: boolean;

  @IsOptional() @IsString() @MaxLength(500) backlogHint?: string;
}

export class CreateTemplateDto {
  @IsString() @MaxLength(200) name!: string;

  @IsOptional() @IsString() @MaxLength(2000) description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => TemplateFieldDto)
  fields?: TemplateFieldDto[];
}

export class CreateFromProjectDto {
  @IsString() @MaxLength(200) name!: string;

  @IsOptional() @IsString() @MaxLength(2000) description?: string;
}
