import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CahierFeedbackDto {
  @IsIn(['approved', 'rejected'])
  status!: 'approved' | 'rejected';

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  comment!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  section?: string;
}
