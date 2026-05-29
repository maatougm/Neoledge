import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service.js';
import { getJwtSecret } from './jwt-secret.js';

interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  firstName: string;
  lastName: string;
  tokenVersion?: number;
  aud?: string;
  totpPending?: boolean;
  iat?: number;
  exp?: number;
}

export interface AuthedUser {
  userId: string;
  email: string;
  role: string;
  firstName: string;
  lastName: string;
  tokenVersion: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(configService),
      // Pin the algorithm to HS256 to prevent algorithm-confusion attacks
      // (e.g. an attacker forging a token signed with `none` or with `RS256`
      // using the secret as a public key).
      algorithms: ['HS256'],
    });
  }

  async validate(payload: JwtPayload): Promise<AuthedUser> {
    // Reject step-1 (2FA pending) tokens — they are only valid for the
    // `/auth/login/totp` exchange and must never grant access to protected
    // routes. The `aud` claim is the primary defence; `totpPending` is a
    // belt-and-braces check for forward-compatibility.
    if (payload.aud && payload.aud !== 'access') {
      throw new UnauthorizedException('Invalid token audience');
    }
    if (payload.totpPending) {
      throw new UnauthorizedException('TOTP challenge not completed');
    }

    // Reject tokens whose tokenVersion is behind the DB — happens when the
    // password is reset, the account is deactivated, or session-invalidation
    // is otherwise triggered (users.service bumps the counter).
    const tokenVersion = payload.tokenVersion ?? 0;
    const dbUser = await this.prisma.appUser.findUnique({
      where: { id: payload.sub },
      select: { tokenVersion: true, isDeleted: true },
    });
    // Reject stale tokens (version bumped on reset/deactivate/delete) AND any
    // soft-deleted account (defence-in-depth — delete() also bumps the version).
    if (!dbUser || dbUser.isDeleted || tokenVersion !== dbUser.tokenVersion) {
      throw new UnauthorizedException('Session invalidated — please log in again');
    }
    return {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      firstName: payload.firstName,
      lastName: payload.lastName,
      tokenVersion,
    };
  }
}
