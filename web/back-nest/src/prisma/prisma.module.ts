import { Global, Module, Logger, OnApplicationShutdown } from '@nestjs/common';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
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

        // Parse mysql://user:pass@host:port/db
        const parsed = new URL(url);
        const factory = new PrismaMariaDb({
          host: parsed.hostname,
          port: Number(parsed.port) || 3306,
          database: parsed.pathname.replace(/^\//, ''),
          user: parsed.username || undefined,
          password: parsed.password || undefined,
        });

        const client = new PrismaClient({ adapter: factory }) as PrismaService;
        await client.$connect();
        logger.log('Connected to MariaDB');
        return client;
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
