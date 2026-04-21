import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateWikiPageDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  content?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
