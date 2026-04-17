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

        // Provider is picked at runtime from DATABASE_URL scheme:
        //   mysql://…   → MariaDB adapter (local dev w/ XAMPP)
        //   postgres…   → native Prisma engine (prod container)
        let client: PrismaClient;
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
          client = new PrismaClient({ adapter });
          logger.log('Connected via MariaDB adapter');
        } else {
          // Postgres (prod) — Prisma 7 requires a driver adapter. Use pg.
          const { PrismaPg } = await import('@prisma/adapter-pg');
          const adapter = new PrismaPg({ connectionString: url });
          client = new PrismaClient({ adapter });
          logger.log('Connected via Postgres (pg) adapter');
        }

        await client.$connect();
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
