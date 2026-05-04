import { IsString, IsOptional, IsBoolean, IsIn, MaxLength, MinLength, Matches } from 'class-validator';

/**
 * Fields a user is allowed to self-update via PUT /api/userprofile.
 * email, role, passwordHash, avatarPath are intentionally excluded — those
 * require dedicated endpoints with their own authorization rules.
 */
export class UpdateProfileDto {
  @IsOptional() @IsString() @MaxLength(100) firstName?: string;
  @IsOptional() @IsString() @MaxLength(100) lastName?: string;
  @IsOptional() @IsString() @MaxLength(120) jobTitle?: string;
  @IsOptional() @IsString() @MaxLength(40) phoneNumber?: string;
  @IsOptional() @IsString() @MaxLength(120) department?: string;
}

export class ChangePasswordDto {
  @IsString() currentPassword!: string;
  @IsString() @MinLength(8) @MaxLength(128) newPassword!: string;
}

export class UploadAvatarDto {
  // Base64 payload — further size/magic-bytes validation happens in ProfileService.
  @IsString() base64Image!: string;

  @IsString()
  @MaxLength(10)
  @Matches(/^\.?[a-zA-Z0-9]{1,8}$/, { message: 'fileExtension must be a short alphanumeric extension' })
  fileExtension!: string;
}

/**
 * User preferences — kept narrow. Unknown keys get stripped by ValidationPipe
 * whitelist, which is exactly the hardening we want.
 */
export class UpdatePreferencesDto {
  @IsOptional() @IsBoolean() emailNotificationsEnabled?: boolean;
  @IsOptional() @IsBoolean() darkMode?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(['fr', 'en'])
  language?: string;

  @IsOptional() @IsString() @MaxLength(64) timeZone?: string;

  @IsOptional() @IsString() @MaxLength(4000) customSettings?: string;
}
