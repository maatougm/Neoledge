import { IsString, IsUUID, Length } from 'class-validator'

export class AddProjectMemberDto {
  @IsUUID()
  userId: string

  @IsString()
  @Length(0, 150)
  label: string
}

export class UpdateProjectMemberDto {
  @IsString()
  @Length(0, 150)
  label: string
}
