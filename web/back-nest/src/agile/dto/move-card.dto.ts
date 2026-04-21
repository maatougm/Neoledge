import { IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

export class MoveCardDto {
  @IsOptional()
  @IsUUID()
  columnId?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  position?: number;
}
