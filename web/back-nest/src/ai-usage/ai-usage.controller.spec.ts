import { AiUsageController } from './ai-usage.controller.js'

describe('AiUsageController', () => {
  let controller: AiUsageController
  let service: { summaryByProject: jest.Mock }

  beforeEach(() => {
    service = { summaryByProject: jest.fn().mockResolvedValue([]) }
    controller = new AiUsageController(service as unknown as never)
  })

  it('defaults to 30 days when no query param is supplied', async () => {
    await controller.summary(undefined)
    expect(service.summaryByProject).toHaveBeenCalledWith(30)
  })

  it('parses the days query param', async () => {
    await controller.summary('7')
    expect(service.summaryByProject).toHaveBeenCalledWith(7)
  })

  it('clamps days to 30 when value is non-numeric', async () => {
    await controller.summary('xyz')
    expect(service.summaryByProject).toHaveBeenCalledWith(30)
  })

  it('clamps days to 30 when value is <= 0', async () => {
    await controller.summary('0')
    expect(service.summaryByProject).toHaveBeenCalledWith(30)
    await controller.summary('-5')
    expect(service.summaryByProject).toHaveBeenLastCalledWith(30)
  })

  it('clamps days to 30 when value exceeds 365 (upper bound)', async () => {
    await controller.summary('1000')
    expect(service.summaryByProject).toHaveBeenCalledWith(30)
  })

  it('accepts the boundary value 365', async () => {
    await controller.summary('365')
    expect(service.summaryByProject).toHaveBeenCalledWith(365)
  })

  it('returns the service payload as-is', async () => {
    const rows = [{ projectId: 'p1', feature: 'cahier', calls: 3, totalTokens: 100, audioSeconds: 0, costEstimateUsd: 0.01 }]
    service.summaryByProject.mockResolvedValue(rows)
    const out = await controller.summary('14')
    expect(out).toBe(rows)
  })
})
