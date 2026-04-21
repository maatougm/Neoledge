import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { HealthController } from './../src/health/health.controller';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const prismaMock = {
      $queryRaw: async () => [{ 1: 1 }],
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PrismaService, useValue: prismaMock }],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns 200 and status ok', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body).toHaveProperty('checks');
    expect(res.body.checks.db).toBe(true);
    expect(res.body.checks.api).toBe(true);
  });

  it('GET /health reports degraded when DB is unreachable', async () => {
    const failingPrisma = {
      $queryRaw: async () => {
        throw new Error('simulated db failure');
      },
    };
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PrismaService, useValue: failingPrisma }],
    }).compile();
    const localApp = mod.createNestApplication();
    await localApp.init();

    const res = await request(localApp.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks.db).toBe(false);

    await localApp.close();
  });
});
