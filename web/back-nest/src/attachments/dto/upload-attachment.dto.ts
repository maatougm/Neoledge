import { IsString, MaxLength, Matches, IsIn, IsBase64, IsOptional } from 'class-validator';

const ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/x-zip-compressed',
];

export class UploadAttachmentDto {
  @IsString()
  @MaxLength(255)
  @Matches(/^[\w\s.\-()[\]]+$/, { message: 'fileName contains unsafe characters' })
  fileName!: string;

  @IsString()
  @IsIn(ALLOWED_CONTENT_TYPES, { message: 'contentType is not permitted' })
  contentType!: string;

  @IsBase64()
  base64Content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;
}
