import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateWikiPageDto {
  @IsString()
  @MaxLength(500)
  title!: string;

  @IsString()
  @MaxLength(200_000)
  content!: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}
