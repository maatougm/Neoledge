import { ConfigService } from '@nestjs/config';

const MIN_JWT_SECRET_LENGTH = 32;

/**
 * Returns the configured JWT_SECRET. Throws at startup if it is missing,
 * empty, or shorter than 32 characters. This is the single source of truth —
 * every call site (AuthModule, AuthService login/TOTP, JwtStrategy,
 * CollaborationGateway, NotificationsGateway) must go through this helper so
 * the process cannot boot with a default / weak secret.
 */
export function getJwtSecret(configService: ConfigService): string {
  const secret = configService.get<string>('JWT_SECRET');
  if (!secret || secret.trim().length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET is missing or shorter than ${MIN_JWT_SECRET_LENGTH} characters. ` +
        `Set it in the environment (e.g. .env) before starting the server.`,
    );
  }
  return secret;
}
