import { HealthController } from './health.controller.js'

describe('HealthController', () => {
  let controller: HealthController
  let mockPrisma: { $queryRaw: jest.Mock }
  const originalEnv = process.env.NODE_ENV

  beforeEach(() => {
    mockPrisma = { $queryRaw: jest.fn() }
    controller = new HealthController(mockPrisma as any)
  })

  afterEach(() => {
    process.env.NODE_ENV = originalEnv
  })

  it('returns rich dev payload when DB reachable', async () => {
    process.env.NODE_ENV = 'development'
    mockPrisma.$queryRaw.mockResolvedValue([{ '1': 1 }])

    const r = await controller.healthCheck()
    expect(r.status).toBe('ok')
    expect(r.checks).toEqual({ db: true, api: true })
    expect(r.uptime_seconds).toBeGreaterThanOrEqual(0)
    expect(typeof r.timestamp).toBe('string')
    expect(r.node).toBe(process.version)
  })

  it('returns degraded status when DB query fails', async () => {
    process.env.NODE_ENV = 'development'
    mockPrisma.$queryRaw.mockRejectedValue(new Error('DB down'))

    const r = await controller.healthCheck()
    expect(r.status).toBe('degraded')
    expect(r.checks).toEqual({ db: false, api: true })
  })

  it('returns minimal payload in production', async () => {
    process.env.NODE_ENV = 'production'
    mockPrisma.$queryRaw.mockResolvedValue([{ '1': 1 }])

    const r = await controller.healthCheck()
    expect(r).toEqual({ status: 'ok' })
    expect((r as any).checks).toBeUndefined()
  })

  it('returns degraded minimal payload in production when DB fails', async () => {
    process.env.NODE_ENV = 'production'
    mockPrisma.$queryRaw.mockRejectedValue(new Error('DB down'))

    const r = await controller.healthCheck()
    expect(r).toEqual({ status: 'degraded' })
  })
})
