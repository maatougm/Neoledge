import { IsString, IsOptional, IsObject } from 'class-validator';

export class CreateRuleDto {
  @IsString() name!: string;
  @IsString() triggerEvent!: string;
  @IsOptional() @IsObject() triggerCondition?: Record<string, unknown> | null;
  @IsString() actionType!: string;
  @IsObject() actionConfig!: Record<string, unknown>;
}

export class UpdateRuleDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() triggerEvent?: string;
  @IsOptional() @IsObject() triggerCondition?: Record<string, unknown> | null;
  @IsOptional() @IsString() actionType?: string;
  @IsOptional() @IsObject() actionConfig?: Record<string, unknown>;
}
