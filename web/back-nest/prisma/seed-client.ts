/**
 * @file prisma/seed-client.ts
 * @desc Adapter-agnostic PrismaClient factory for seed scripts. Reads
 *       DATABASE_URL and picks MariaDB or Postgres adapter accordingly —
 *       same logic as src/prisma/prisma.module.ts.
 */

import { PrismaClient } from '@prisma/client';

export async function createSeedClient(): Promise<PrismaClient> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL env var is not set');

  if (url.startsWith('mysql://') || url.startsWith('mariadb://')) {
    const { PrismaMariaDb } = await import('@prisma/adapter-mariadb');
    const parsed = new URL(url);
    const adapter = new PrismaMariaDb({
      host: parsed.hostname,
      port: Number(parsed.port) || 3306,
      database: parsed.pathname.replace(/^\//, ''),
      user: parsed.username || undefined,
      password: parsed.password || undefined,
    });
    return new PrismaClient({ adapter });
  }

  const { PrismaPg } = await import('@prisma/adapter-pg');
  const adapter = new PrismaPg({ connectionString: url });
  return new PrismaClient({ adapter });
}
