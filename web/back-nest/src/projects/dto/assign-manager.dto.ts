import { Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Relaxed UUID check — accepts any RFC-4122 format (8-4-4-4-12 hex) without
// enforcing a version-nibble value. Required because some seed user IDs use
// `0` in the version position (e.g. `aaaaaaaa-0002-0000-0000-000000000000`).
const UUID_ANY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AssignManagerDto {
  @ApiProperty()
  @Matches(UUID_ANY, { message: 'projectManagerId must be a valid UUID' })
  projectManagerId: string;
}
