import { IsString, IsOptional, IsInt, IsDateString, IsBoolean, IsNumber, Min, Max, IsArray, ValidateNested, ArrayMaxSize, MaxLength, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

// Allowed enum values, derived from existing code (seed-openproject.ts, agile.service.ts).
export const VALID_WP_STATUSES = ['New', 'InProgress', 'AwaitingReview', 'OnHold', 'Resolved', 'Closed'] as const;
export const VALID_WP_TYPES = ['Task', 'Feature', 'Bug', 'Epic', 'Incident'] as const;

export class CreateWorkPackageDto {
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() @IsIn(VALID_WP_TYPES as unknown as string[]) type?: string;
  @IsOptional() @IsString() @IsIn(VALID_WP_STATUSES as unknown as string[]) status?: string;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsString() assigneeId?: string;
  @IsOptional() @IsString() parentId?: string;
  @IsOptional() @IsString() sprintId?: string;
  @IsOptional() @IsString() versionId?: string;
  @IsOptional() @IsString() boardColumnId?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsNumber() @Min(0) estimatedHours?: number;
}

export class UpdateWorkPackageDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() @IsIn(VALID_WP_TYPES as unknown as string[]) type?: string;
  @IsOptional() @IsString() @IsIn(VALID_WP_STATUSES as unknown as string[]) status?: string;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsString() assigneeId?: string | null;
  @IsOptional() @IsString() parentId?: string | null;
  @IsOptional() @IsString() sprintId?: string | null;
  @IsOptional() @IsString() versionId?: string | null;
  @IsOptional() @IsString() boardColumnId?: string | null;
  @IsOptional() @IsDateString() startDate?: string | null;
  @IsOptional() @IsDateString() dueDate?: string | null;
  @IsOptional() @IsNumber() @Min(0) estimatedHours?: number | null;
  @IsOptional() @IsNumber() @Min(0) spentHours?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) percentDone?: number;
  @IsOptional() @IsInt() position?: number;
}

export class MoveWorkPackageDto {
  @IsOptional() @IsString() boardColumnId?: string | null;
  @IsOptional() @IsString() sprintId?: string | null;
  @IsOptional() @IsString() parentId?: string | null;
  @IsOptional() @IsInt() position?: number;
}

export class AddDependencyDto {
  @IsString() toWpId!: string;
  @IsOptional() @IsString() type?: string;
}

export class CustomValueDto {
  @IsString() customFieldId!: string;
  @IsOptional() @IsString() @MaxLength(4096) value?: string;
}

export class UpsertCustomValuesDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CustomValueDto)
  values!: CustomValueDto[];
}

export class AssignmentItemDto {
  @IsString() wpId!: string;
  @IsOptional() @IsString() assigneeId!: string | null;
}

export class BulkAssignDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AssignmentItemDto)
  assignments!: AssignmentItemDto[];

  /**
   * Optional context. When provided, the grouped assignment notification
   * mentions the sprint name, and its deep-link carries `sprintId` so the
   * assignee lands on a pre-filtered "Mes tâches" view.
   */
  @IsOptional() @IsString() sprintId?: string;
}
