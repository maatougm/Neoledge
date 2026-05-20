import { LogController } from './log.controller.js'

describe('LogController', () => {
  let controller: LogController
  let mockPrisma: { auditLog: { findMany: jest.Mock } }

  const sampleRow = (overrides: Record<string, unknown> = {}) => ({
    createdAt: new Date('2026-05-01T10:11:12Z'),
    action: 'CREATE',
    entityType: 'Project',
    entityId: 'p-1',
    user: { firstName: 'Alice', lastName: 'Pm', email: 'alice@x.com' },
    ...overrides,
  })

  beforeEach(() => {
    mockPrisma = { auditLog: { findMany: jest.fn() } }
    controller = new LogController(mockPrisma as any)
  })

  it('defaults to 100 lines and orders desc but reverses for display', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([
      sampleRow({ action: 'A' }),
      sampleRow({ action: 'B' }),
    ])
    const r = await controller.getLogs(undefined, { userId: 'u', role: 'Admin' } as any)
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100, orderBy: { createdAt: 'desc' } }),
    )
    // After .reverse(): action 'B' (the older) appears first then 'A'
    expect(r[0]).toContain('[INFO] B ')
    expect(r[1]).toContain('[INFO] A ')
  })

  it('clamps lines to 500 maximum', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([])
    await controller.getLogs('9000')
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 500 }),
    )
  })

  it('falls back to 100 when parse fails', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([])
    await controller.getLogs('not-a-number')
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    )
  })

  it('exposes email only to Admin callers', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([sampleRow()])
    const adminLine = (await controller.getLogs('10', { userId: 'u', role: 'Admin' } as any))[0]
    expect(adminLine).toContain('alice@x.com')

    const nonAdminLine = (await controller.getLogs('10', { userId: 'u', role: 'Member' } as any))[0]
    expect(nonAdminLine).not.toContain('alice@x.com')
    expect(nonAdminLine).toContain('Alice Pm')
  })

  it('renders "system" when user is null', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([sampleRow({ user: null })])
    const line = (await controller.getLogs('10', { userId: 'u', role: 'Admin' } as any))[0]
    expect(line).toContain('by system')
  })

  it('format includes timestamp and entity reference', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([sampleRow()])
    const line = (await controller.getLogs('10', { userId: 'u', role: 'Admin' } as any))[0]
    expect(line).toMatch(/^\[2026-05-01 10:11:12\] \[INFO\] CREATE \| Project:p-1 \| by Alice Pm/)
  })
})
