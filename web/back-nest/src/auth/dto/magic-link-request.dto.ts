import { IsEmail } from 'class-validator';

/** Request a passwordless sign-in link by email. */
export class MagicLinkRequestDto {
  @IsEmail()
  email!: string;
}
