import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ToggleManagerFieldsDto {
  @ApiProperty()
  @IsBoolean()
  allow: boolean;
}
