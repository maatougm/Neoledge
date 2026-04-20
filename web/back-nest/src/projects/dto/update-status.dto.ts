import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export const PROJECT_STATUSES = [
  'Draft',
  'InProgress',
  'SpecificationValidation',
  'Realization',
  'DeploymentValidation',
  'Completed',
  'Archived',
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export class UpdateStatusDto {
  @ApiProperty({ enum: PROJECT_STATUSES })
  @IsIn(PROJECT_STATUSES as unknown as string[])
  status: ProjectStatus;
}
