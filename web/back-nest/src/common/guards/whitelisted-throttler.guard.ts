import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { ExecutionContext } from '@nestjs/common';

/**
 * Extends the default ThrottlerGuard with an IP allow-list read from the
 * `THROTTLER_WHITELIST` env var (comma-separated). Whitelisted IPs bypass all
 * per-route rate limits. Use sparingly — meant for operator / office IPs.
 *
 * The guard walks the usual reverse-proxy chain: `x-forwarded-for` (first hop),
 * `x-real-ip`, then the socket address.
 */
@Injectable()
export class WhitelistedThrottlerGuard extends ThrottlerGuard {
  private readonly whitelist: Set<string> = new Set(
    (process.env.THROTTLER_WHITELIST ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (this.whitelist.size === 0) return false;
    const req = context.switchToHttp().getRequest<{
      headers?: Record<string, string | string[] | undefined>;
      ip?: string;
      socket?: { remoteAddress?: string };
    }>();

    const ips = this.extractIps(req);
    for (const ip of ips) {
      if (this.whitelist.has(ip)) return true;
    }
    return false;
  }

  private extractIps(req: {
    headers?: Record<string, string | string[] | undefined>;
    ip?: string;
    socket?: { remoteAddress?: string };
  }): string[] {
    const out: string[] = [];
    const xff = req.headers?.['x-forwarded-for'];
    if (typeof xff === 'string') {
      out.push(
        ...xff
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      );
    } else if (Array.isArray(xff)) {
      out.push(...xff.map((s) => s.trim()));
    }
    const real = req.headers?.['x-real-ip'];
    if (typeof real === 'string') out.push(real.trim());
    if (typeof req.ip === 'string') out.push(req.ip);
    if (typeof req.socket?.remoteAddress === 'string') out.push(req.socket.remoteAddress);
    return out;
  }
}
