import { IsArray, IsUUID } from 'class-validator';

export class ReorderColumnsDto {
  @IsArray()
  @IsUUID('all', { each: true })
  order!: string[];
}
