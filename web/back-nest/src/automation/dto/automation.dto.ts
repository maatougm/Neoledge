import {
  IsString,
  IsOptional,
  IsObject,
  IsIn,
  ValidateNested,
  IsUUID,
  IsBoolean,
  MaxLength,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─── Known enums ─────────────────────────────────────────────────────────────

export const KNOWN_TRIGGER_EVENTS = [
  'status_changed',
  'validation_submitted',
  'work_package_created',
  'work_package_status_changed',
  'milestone_reached',
] as const;

export const KNOWN_ACTION_TYPES = ['send_notification', 'update_field'] as const;

export const KNOWN_OPERATORS = ['equals', 'not_equals', 'contains'] as const;

// ─── Trigger condition ───────────────────────────────────────────────────────

const UNSAFE_KEY_REGEX = /^(__proto__|constructor|prototype)$/;
const SAFE_FIELD_REGEX = /^[a-zA-Z0-9_]+$/;

export class TriggerConditionDto {
  @IsOptional()
  @IsString()
  @Matches(SAFE_FIELD_REGEX, { message: 'field must only contain alphanumeric and underscore characters' })
  field?: string;

  @IsOptional()
  @IsIn(KNOWN_OPERATORS as unknown as string[])
  operator?: (typeof KNOWN_OPERATORS)[number];

  // `value` is unknown — we allow string/number/boolean/null; block prototype keys at service layer.
  @IsOptional()
  value?: unknown;
}

// ─── Action configs (discriminated by actionType) ────────────────────────────

export class SendNotificationConfig {
  @IsOptional()
  @IsUUID('all')
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}

export class UpdateFieldConfig {
  @IsUUID('all')
  fieldId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  value?: string;
}

// ─── Rule DTOs ───────────────────────────────────────────────────────────────

export class CreateRuleDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsIn(KNOWN_TRIGGER_EVENTS as unknown as string[])
  triggerEvent!: (typeof KNOWN_TRIGGER_EVENTS)[number];

  @IsOptional()
  @ValidateNested()
  @Type(() => TriggerConditionDto)
  triggerCondition?: TriggerConditionDto | null;

  @IsIn(KNOWN_ACTION_TYPES as unknown as string[])
  actionType!: (typeof KNOWN_ACTION_TYPES)[number];

  // Per-actionType discriminated union validation is enforced in the service.
  // `@IsObject()` keeps the shape a plain object; controller's ValidationPipe
  // with whitelist:true + forbidNonWhitelisted strips top-level junk.
  @IsObject()
  actionConfig!: Record<string, unknown>;
}

export class UpdateRuleDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsIn(KNOWN_TRIGGER_EVENTS as unknown as string[])
  triggerEvent?: (typeof KNOWN_TRIGGER_EVENTS)[number];

  @IsOptional()
  @ValidateNested()
  @Type(() => TriggerConditionDto)
  triggerCondition?: TriggerConditionDto | null;

  @IsOptional()
  @IsIn(KNOWN_ACTION_TYPES as unknown as string[])
  actionType?: (typeof KNOWN_ACTION_TYPES)[number];

  @IsOptional()
  @IsObject()
  actionConfig?: Record<string, unknown>;
}

export class ToggleRuleDto {
  @IsBoolean()
  isActive!: boolean;
}

// ─── Helpers used by the service ─────────────────────────────────────────────

/** True if the key could trigger prototype-pollution when used as a bracket-access key. */
export function isUnsafeKey(key: string): boolean {
  return UNSAFE_KEY_REGEX.test(key);
}

/** True if the field name is a safe alphanumeric identifier. */
export function isSafeField(key: string): boolean {
  return SAFE_FIELD_REGEX.test(key) && !UNSAFE_KEY_REGEX.test(key);
}
