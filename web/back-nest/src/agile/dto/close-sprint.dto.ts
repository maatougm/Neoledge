import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export type SprintWpDisposition = 'next_sprint' | 'backlog' | 'keep';

export class SprintWpDispositionDto {
  @IsUUID('all')
  workPackageId!: string;

  @IsIn(['next_sprint', 'backlog', 'keep'])
  disposition!: SprintWpDisposition;
}

export class CloseSprintDto {
  /**
   * Per-WP disposition decisions made by the PM in the review modal.
   * Empty list is allowed only when the sprint has no unfinished tasks —
   * the service rejects an empty body otherwise.
   */
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SprintWpDispositionDto)
  dispositions!: SprintWpDispositionDto[];

  /**
   * Optional override — PM picked a specific target sprint for "next_sprint"
   * dispositions instead of the auto-suggested one. Must be a Planning sprint
   * on the same board.
   */
  @IsOptional()
  @IsUUID('all')
  targetSprintId?: string;
}
