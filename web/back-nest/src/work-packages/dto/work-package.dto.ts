import { IsString, IsOptional, IsInt, IsDateString, IsBoolean, IsNumber, Min, Max, IsArray, ValidateNested, ArrayMaxSize, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateWorkPackageDto {
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsString() assigneeId?: string;
  @IsOptional() @IsString() parentId?: string;
  @IsOptional() @IsString() sprintId?: string;
  @IsOptional() @IsString() versionId?: string;
  @IsOptional() @IsString() boardColumnId?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsNumber() estimatedHours?: number;
}

export class UpdateWorkPackageDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsString() assigneeId?: string | null;
  @IsOptional() @IsString() parentId?: string | null;
  @IsOptional() @IsString() sprintId?: string | null;
  @IsOptional() @IsString() versionId?: string | null;
  @IsOptional() @IsString() boardColumnId?: string | null;
  @IsOptional() @IsDateString() startDate?: string | null;
  @IsOptional() @IsDateString() dueDate?: string | null;
  @IsOptional() @IsNumber() estimatedHours?: number | null;
  @IsOptional() @IsNumber() spentHours?: number;
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
