import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'

export class StartCopilotSessionDto {
  @IsString()
  @MaxLength(80)
  liveSessionId!: string
}

export class AppendCopilotChunkDto {
  @IsString()
  @MaxLength(80)
  liveSessionId!: string

  @IsString()
  @MaxLength(8000)
  chunk!: string
}

export class FireCopilotDto {
  @IsString()
  @MaxLength(80)
  liveSessionId!: string
}

export class EndCopilotSessionDto {
  @IsString()
  @MaxLength(80)
  liveSessionId!: string

  @IsOptional()
  @IsUUID()
  meetingTranscriptId?: string
}
