import { BudgetingService } from './budgeting.service.js';

describe('BudgetingService', () => {
  let prisma: {
    projectBudget: { findUnique: jest.Mock; upsert: jest.Mock; create: jest.Mock };
    budgetLineItem: { aggregate: jest.Mock; create: jest.Mock; findUnique: jest.Mock; update: jest.Mock; delete: jest.Mock };
    timeEntry: { findMany: jest.Mock };
  };
  let tt: { getEffectiveRate: jest.Mock };
  let svc: BudgetingService;

  beforeEach(() => {
    prisma = {
      projectBudget: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => ({ id: 'b1', ...create, lineItems: [] })),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'b1', ...data })),
      },
      budgetLineItem: {
        aggregate: jest.fn(async () => ({ _max: { position: 0 } })),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'li1', ...data })),
        findUnique: jest.fn(async () => ({ id: 'li1', unitCost: 100, units: 3 })),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'li1', ...data })),
        delete: jest.fn(async () => undefined),
      },
      timeEntry: {
        findMany: jest.fn(async () => []),
      },
    };
    tt = { getEffectiveRate: jest.fn(async () => ({ rate: 80 })) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    svc = new BudgetingService(prisma as any, tt as any);
  });

  it('upsertBudget creates with defaults', async () => {
    const r = await svc.upsertBudget('p1', {});
    expect(r.isSuccess).toBe(true);
    expect(prisma.projectBudget.upsert).toHaveBeenCalled();
  });

  it('createLineItem computes total = unitCost * units', async () => {
    prisma.projectBudget.findUnique.mockResolvedValueOnce({ id: 'b1' });
    const r = await svc.createLineItem('p1', { description: 'Server', unitCost: 100, units: 12 });
    expect(r.isSuccess).toBe(true);
    expect(prisma.budgetLineItem.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ total: 1200 }) }),
    );
  });

  it('updateLineItem recomputes total when unitCost changes', async () => {
    const r = await svc.updateLineItem('p1', 'li1', { unitCost: 200 });
    expect(r.isSuccess).toBe(true);
    expect(prisma.budgetLineItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ total: 600 }) }),
    );
  });

  it('getBurnReport computes spent from time entries at effective rate', async () => {
    prisma.projectBudget.findUnique.mockResolvedValueOnce({
      id: 'b1', laborBudget: 10000, materialBudget: 0, currency: 'EUR',
    });
    prisma.timeEntry.findMany.mockResolvedValueOnce([
      { id: 't1', userId: 'u1', hours: 10, spentOn: new Date(), isBillable: true },
      { id: 't2', userId: 'u2', hours: 5, spentOn: new Date(), isBillable: true },
    ]);
    prisma.budgetLineItem.aggregate.mockResolvedValueOnce({ _sum: { total: 0 } });

    const r = await svc.getBurnReport('p1');
    expect(r.isSuccess).toBe(true);
    // 10h + 5h = 15h × 80/h = 1200
    expect(r.value).toMatchObject({ spent: 1200, remaining: 8800, percentUsed: 12 });
  });

  it('returns 0% used when budget is 0', async () => {
    prisma.projectBudget.findUnique.mockResolvedValueOnce({
      id: 'b1', laborBudget: 0, materialBudget: 0, currency: 'EUR',
    });
    prisma.budgetLineItem.aggregate.mockResolvedValueOnce({ _sum: { total: 0 } });
    const r = await svc.getBurnReport('p1');
    expect((r.value as { percentUsed: number } | undefined)?.percentUsed).toBe(0);
  });
});
