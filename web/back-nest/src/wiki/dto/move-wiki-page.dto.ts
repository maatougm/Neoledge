import { IsOptional, IsUUID } from 'class-validator';

export class MoveWikiPageDto {
  @IsOptional()
  @IsUUID('all')
  parentId?: string | null;
}
