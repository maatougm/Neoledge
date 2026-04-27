import { IsBoolean, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubmitValidationDto {
  @ApiProperty()
  @IsBoolean()
  isApproved: boolean;

  // Comment rules:
  //   • When rejecting (`isApproved === false`): comment is REQUIRED — must
  //     be a non-empty string up to 2000 chars.
  //   • When approving: comment is optional; if provided, must be a string
  //     up to 2000 chars.
  //
  // @ValidateIf skips validation entirely when approving AND no comment is
  // provided, making the field effectively optional on the approval path.
  @ApiPropertyOptional({ maxLength: 2000 })
  @ValidateIf((o) => o.isApproved === false || (o.comment !== undefined && o.comment !== null))
  @IsString()
  @MinLength(1, { message: 'Un commentaire est requis en cas de rejet.' })
  @MaxLength(2000)
  comment?: string;
}
