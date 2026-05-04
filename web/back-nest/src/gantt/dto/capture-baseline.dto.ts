import { IsString, MaxLength } from 'class-validator';

export class CaptureBaselineDto {
  @IsString()
  @MaxLength(200)
  snapshotName!: string;
}
