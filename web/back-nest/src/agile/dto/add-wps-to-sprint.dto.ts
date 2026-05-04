import { IsArray, IsUUID } from 'class-validator';

export class AddWpsToSprintDto {
  @IsArray()
  @IsUUID('all', { each: true })
  workPackageIds!: string[];
}
