import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AnalyticsCacheService {
  constructor(private readonly prisma: PrismaService) {}

  async get<T>(key: string, ttlMinutes: number): Promise<T | null> {
    const entry = await this.prisma.analyticsCache.findUnique({
      where: { cacheKey: key },
    });

    if (!entry) return null;

    const ageMs = Date.now() - entry.computedAt.getTime();
    const ttlMs = ttlMinutes * 60 * 1000;

    if (ageMs > ttlMs) return null;

    try {
      return JSON.parse(entry.data) as T;
    } catch {
      return null;
    }
  }

  async set(key: string, data: unknown): Promise<void> {
    const serialized = JSON.stringify(data);
    const id = crypto.randomUUID();

    await this.prisma.analyticsCache.upsert({
      where: { cacheKey: key },
      create: { id, cacheKey: key, data: serialized, computedAt: new Date() },
      update: { data: serialized, computedAt: new Date() },
    });
  }

  /**
   * Bust one or all analytics cache entries.
   * Pass a key to invalidate a single entry; omit key to wipe all entries.
   * Swallows errors so it never breaks the calling service.
   */
  async invalidate(key?: string): Promise<void> {
    try {
      if (key) {
        await this.prisma.analyticsCache.deleteMany({ where: { cacheKey: key } });
      } else {
        await this.prisma.analyticsCache.deleteMany({});
      }
    } catch {
      // Best-effort: cache invalidation must not break mutations.
    }
  }
}
