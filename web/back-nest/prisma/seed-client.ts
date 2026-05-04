/**
 * @file prisma/seed-client.ts
 * @desc PrismaClient factory for seed scripts. Postgres-only since the
 *       MySQL/MariaDB migration was completed.
 */

import { PrismaClient } from '@prisma/client';

export async function createSeedClient(): Promise<PrismaClient> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL env var is not set');
  if (!url.startsWith('postgres')) {
    throw new Error(
      `DATABASE_URL must use postgres:// — the project is Postgres-only.`,
    );
  }

  const { PrismaPg } = await import('@prisma/adapter-pg');
  const adapter = new PrismaPg({ connectionString: url });
  return new PrismaClient({ adapter });
}
