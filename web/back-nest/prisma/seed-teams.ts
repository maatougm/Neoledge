/**
 * @file  prisma/seed-teams.ts
 * @desc  Idempotent seeder — upserts the 4 canonical RACI teams.
 *        Safe to re-run: uses upsert on the unique `code` field.
 *
 * Usage:
 *   cd web/back-nest && npx tsx prisma/seed-teams.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEAMS = [
  { code: 'Cloud',       name: 'Équipe Cloud' },
  { code: 'PS',          name: 'Équipe PS' },
  { code: 'Integration', name: 'Équipe Intégration' },
  { code: 'Delivery',    name: 'Équipe Delivery' },
] as const;

async function main() {
  console.log('Seeding RACI teams…');

  for (const team of TEAMS) {
    const result = await prisma.team.upsert({
      where:  { code: team.code },
      update: { name: team.name },
      create: { code: team.code, name: team.name },
    });
    console.log(`  ✓ Team "${result.code}" — ${result.name} (id: ${result.id})`);
  }

  console.log('Done.');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
