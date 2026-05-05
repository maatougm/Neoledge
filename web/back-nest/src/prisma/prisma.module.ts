import { Global, Module, Logger, OnApplicationShutdown } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      useFactory: async (): Promise<PrismaService> => {
        const logger = new Logger('PrismaModule');
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error('DATABASE_URL env var is not set');
        if (!url.startsWith('postgres')) {
          throw new Error(
            `DATABASE_URL must use postgres:// — got "${url.split(':')[0]}://". MySQL/MariaDB support was removed; the project is Postgres-only.`,
          );
        }

        // Prisma 7 requires a driver adapter for non-rust engines.
        const { PrismaPg } = await import('@prisma/adapter-pg');
        const adapter = new PrismaPg({ connectionString: url });
        const client = new PrismaClient({ adapter });
        logger.log('Connected via Postgres (pg) adapter');

        await client.$connect();

        // TODO(soft-delete-middleware): Prisma 7 with driver adapters uses $extends for
        // query interception instead of the removed $use API. However, $extends returns a
        // new extended type that is incompatible with `PrismaService extends PrismaClient`,
        // requiring a full type-cast refactor across all services.  Deferred to a dedicated
        // refactor ticket.  In the meantime, every service/controller that performs reads on
        // soft-deletable models (WorkPackage, Project, ProjectComment, etc.) adds
        // `isDeleted: false` to its `where` clause explicitly — see audit in docs/qa/.

        return client as PrismaService;
      },
    },
  ],
  exports: [PrismaService],
})
export class PrismaModule implements OnApplicationShutdown {
  async onApplicationShutdown() {
    // clients disconnect on their own via PrismaClient lifecycle
  }
}
