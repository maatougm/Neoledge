import { WikiService } from './wiki.service.js';

describe('WikiService', () => {
  let prisma: {
    wikiPage: {
      findFirst: jest.Mock; findMany: jest.Mock; create: jest.Mock;
      update: jest.Mock;
    };
    wikiRevision: { create: jest.Mock; findUnique: jest.Mock };
  };
  let svc: WikiService;

  beforeEach(() => {
    const pageStore: Record<string, unknown>[] = [];
    let id = 0;
    prisma = {
      wikiPage: {
        findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
          pageStore.find((p) => p.projectId === where.projectId && p.slug === where.slug) ?? null
        ),
        findMany: jest.fn(async () => pageStore.filter((p) => !p.isDeleted)),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const p = { id: `p-${++id}`, isDeleted: false, ...data };
          pageStore.push(p);
          return p;
        }),
        update: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const idx = pageStore.findIndex((p) => p.id === where.id);
          if (idx < 0) throw new Error('not found');
          pageStore[idx] = { ...pageStore[idx], ...data };
          return pageStore[idx];
        }),
      },
      wikiRevision: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'r1', ...data })),
        findUnique: jest.fn(async () => null),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    svc = new WikiService(prisma as any);
  });

  it('creates page with auto-generated slug', async () => {
    const r = await svc.create('p1', { title: 'Bonjour le Monde', content: '# Test' }, 'u1');
    expect(r.isSuccess).toBe(true);
    const page = r.value as { slug: string; version: number };
    expect(page.slug).toBe('bonjour-le-monde');
    expect(page.version).toBe(1);
  });

  it('rejects empty title', async () => {
    const r = await svc.create('p1', { title: '   ', content: 'x' }, 'u1');
    expect(r.isFailure).toBe(true);
  });

  it('writes initial revision on create', async () => {
    await svc.create('p1', { title: 'Test', content: 'content' }, 'u1');
    expect(prisma.wikiRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ version: 1, comment: 'Initial version' }) }),
    );
  });

  it('increments version and writes new revision on update', async () => {
    await svc.create('p1', { title: 'Test', content: 'v1' }, 'u1');
    prisma.wikiRevision.create.mockClear();
    const r = await svc.update('p1', 'test', { content: 'v2 content' }, 'u2');
    expect(r.isSuccess).toBe(true);
    expect((r.value as { version: number }).version).toBe(2);
    expect(prisma.wikiRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ version: 2 }) }),
    );
  });

  it('softDelete marks page as deleted', async () => {
    await svc.create('p1', { title: 'Test', content: 'x' }, 'u1');
    const r = await svc.softDelete('p1', 'test');
    expect(r.isSuccess).toBe(true);
  });
});
