import { IsString, MaxLength, MinLength } from 'class-validator';

/** Consume a magic-link token to obtain a session JWT (or a TOTP challenge). */
export class MagicLoginDto {
  // The raw token is 64 hex chars (randomBytes(32).toString('hex')). Bound the
  // length so a hostile client can't push a megabyte through the SHA256 path.
  @IsString()
  @MinLength(16)
  @MaxLength(512)
  token!: string;
}
