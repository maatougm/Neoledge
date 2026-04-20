import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FieldValueItemDto {
  @ApiProperty()
  @IsUUID()
  projectFieldId: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 10000 })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  value: string | null;

  /**
   * Optimistic-lock token: the `updatedAt` value the client last observed for
   * this specific `ProjectFieldValue`. If the stored row's `updatedAt` is
   * strictly greater, the write is rejected with 409 so the user can refresh.
   * Absent on first-ever write (the row does not yet exist).
   */
  @ApiPropertyOptional({ description: 'ISO-8601 timestamp of the field value the client last saw' })
  @IsOptional()
  @IsDateString()
  expectedUpdatedAt?: string;
}

export class SaveFieldValuesDto {
  @ApiProperty({ type: [FieldValueItemDto], maxItems: 500 })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => FieldValueItemDto)
  fieldValues: FieldValueItemDto[];
}
