import { IsString, MaxLength, Matches, IsOptional } from 'class-validator';

export class UpdateAttachmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^[\w\s.\-()[\]]+$/, { message: 'fileName contains unsafe characters' })
  fileName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;
}
