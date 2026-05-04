import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsUUID,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PROJECT_STATUSES, type ProjectStatus } from './update-status.dto.js';

/** Hard cap on how many projects one bulk call may touch. */
export const BULK_MAX = 500;

export class BulkIdsDto {
  @ApiProperty({ type: [String], maxItems: BULK_MAX })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_MAX)
  @IsUUID('4', { each: true })
  projectIds: string[];
}

export class BulkStatusDto extends BulkIdsDto {
  @ApiProperty({ enum: PROJECT_STATUSES })
  @IsIn(PROJECT_STATUSES as unknown as string[])
  status: ProjectStatus;
}

export class BulkAssignManagerDto extends BulkIdsDto {
  @ApiProperty()
  @IsUUID('all')
  managerId: string;
}
