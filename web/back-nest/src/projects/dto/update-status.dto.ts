import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export const PROJECT_STATUSES = [
  'Draft',
  'Kickoff',
  'CadrageTechnique',
  'Environnement',
  'Parametrage',
  'Integration',
  'Recette',
  'MEP',
  'Cloture',
  'Archived',
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export class UpdateStatusDto {
  @ApiProperty({ enum: PROJECT_STATUSES })
  @IsIn(PROJECT_STATUSES as unknown as string[])
  status: ProjectStatus;
}
