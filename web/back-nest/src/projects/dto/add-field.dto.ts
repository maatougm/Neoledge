import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const FIELD_TYPES = ['Text', 'Number', 'Select', 'Checkbox', 'Date'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export class AddFieldDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  label: string;

  @ApiPropertyOptional({ enum: FIELD_TYPES })
  @IsOptional()
  @IsIn(FIELD_TYPES as unknown as string[])
  fieldType?: FieldType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  options?: string;
}
