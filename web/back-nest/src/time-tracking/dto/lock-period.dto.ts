import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class LockPeriodDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @IsUUID()
  userId?: string;
}
