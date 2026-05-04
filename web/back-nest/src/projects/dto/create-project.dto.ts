import {
  IsString,
  IsNotEmpty,
  IsDateString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateProjectDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  clientName: string;

  @ApiProperty({ description: 'ISO 8601 date string' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: 'ISO 8601 date string' })
  @IsDateString()
  endDate: string;

  @ApiProperty({ description: 'UUID of the assigned project manager (required)' })
  @IsString()
  @IsNotEmpty({ message: 'projectManagerId is required — a PM must be assigned on creation' })
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    message: 'projectManagerId must be a valid UUID',
  })
  projectManagerId: string;
}
