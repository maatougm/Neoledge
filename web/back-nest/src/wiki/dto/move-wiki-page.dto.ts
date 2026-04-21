import { IsOptional, IsUUID } from 'class-validator';

export class MoveWikiPageDto {
  @IsOptional()
  @IsUUID()
  parentId?: string | null;
}
