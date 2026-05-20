import { AnalyticsController } from './analytics.controller.js'

const ok = <T>(value: T) => ({ isSuccess: true, isFailure: false, value, error: undefined })

describe('AnalyticsController', () => {
  let controller: AnalyticsController
  let mockService: {
    getPhaseVelocity: jest.Mock
    getBottleneckHeatmap: jest.Mock
    getDeadlineRisk: jest.Mock
    getTeamWorkload: jest.Mock
  }

  beforeEach(() => {
    mockService = {
      getPhaseVelocity: jest.fn(),
      getBottleneckHeatmap: jest.fn(),
      getDeadlineRisk: jest.fn(),
      getTeamWorkload: jest.fn(),
    }
    controller = new AnalyticsController(mockService as any)
  })

  it('phase-velocity returns service value', async () => {
    mockService.getPhaseVelocity.mockResolvedValue(ok([{ phase: 'Build', count: 3 }]))
    expect(await controller.getPhaseVelocity()).toEqual([{ phase: 'Build', count: 3 }])
  })

  it('bottleneck returns service value', async () => {
    mockService.getBottleneckHeatmap.mockResolvedValue(ok({ heat: [] }))
    expect(await controller.getBottleneck()).toEqual({ heat: [] })
  })

  it('deadline-risk returns service value', async () => {
    mockService.getDeadlineRisk.mockResolvedValue(ok([]))
    expect(await controller.getDeadlineRisk()).toEqual([])
  })

  it('team-workload returns service value', async () => {
    mockService.getTeamWorkload.mockResolvedValue(ok({ workloads: [] }))
    expect(await controller.getTeamWorkload()).toEqual({ workloads: [] })
  })
})
