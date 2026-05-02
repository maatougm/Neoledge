import { IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator'

const LABEL_PATTERN = /^[\p{L}\p{N}\s\-_]*$/u
const LABEL_MESSAGE = 'Label invalide (lettres, chiffres, espaces, tirets uniquement)'

export class AddProjectMemberDto {
  @IsUUID()
  userId: string

  @IsString()
  @Length(0, 60)
  @MaxLength(60)
  @Matches(LABEL_PATTERN, { message: LABEL_MESSAGE })
  label: string
}

export class UpdateProjectMemberDto {
  @IsString()
  @Length(0, 60)
  @MaxLength(60)
  @Matches(LABEL_PATTERN, { message: LABEL_MESSAGE })
  label: string
}
