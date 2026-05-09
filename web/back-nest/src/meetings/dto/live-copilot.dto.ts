import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'
import { VALID_MEETING_TYPES, type MeetingType } from '../live-copilot.types.js'

export class StartCopilotSessionDto {
  @IsString()
  @MaxLength(80)
  liveSessionId!: string

  @IsOptional()
  @IsString()
  @IsIn([...VALID_MEETING_TYPES])
  meetingType?: MeetingType
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
