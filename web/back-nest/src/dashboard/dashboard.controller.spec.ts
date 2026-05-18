import { DashboardController } from './dashboard.controller.js'

const ok = <T>(value: T) => ({ isSuccess: true, isFailure: false, value, error: undefined })

describe('DashboardController', () => {
  let controller: DashboardController
  let mockService: Record<string, jest.Mock>

  beforeEach(() => {
    mockService = {
      getStats: jest.fn(),
      getProjectsByStatus: jest.fn(),
      getWorkloads: jest.fn(),
      getRecentActivity: jest.fn(),
      getActivityStats: jest.fn(),
      getOverdueProjects: jest.fn(),
    }
    controller = new DashboardController(mockService as any)
  })

  it('stats returns service value', async () => {
    mockService.getStats.mockResolvedValue(ok({ total: 5 }))
    expect(await controller.getStats()).toEqual({ total: 5 })
  })

  it('projects-by-status returns service value', async () => {
    mockService.getProjectsByStatus.mockResolvedValue(ok([]))
    expect(await controller.getByStatus()).toEqual([])
  })

  it('pm-workloads returns service value', async () => {
    mockService.getWorkloads.mockResolvedValue(ok([{ pmId: 'x', count: 2 }]))
    expect(await controller.getWorkloads()).toEqual([{ pmId: 'x', count: 2 }])
  })

  it('recent-activity defaults count to 10', async () => {
    mockService.getRecentActivity.mockResolvedValue(ok([]))
    await controller.getRecentActivity()
    expect(mockService.getRecentActivity).toHaveBeenCalledWith(10)
  })

  it('recent-activity clamps to 500', async () => {
    mockService.getRecentActivity.mockResolvedValue(ok([]))
    await controller.getRecentActivity('9999')
    expect(mockService.getRecentActivity).toHaveBeenCalledWith(500)
  })

  it('recent-activity rejects non-numeric and falls back to 10', async () => {
    mockService.getRecentActivity.mockResolvedValue(ok([]))
    await controller.getRecentActivity('abc')
    expect(mockService.getRecentActivity).toHaveBeenCalledWith(10)
  })

  it('recent-activity rejects zero/negative and falls back to 10', async () => {
    mockService.getRecentActivity.mockResolvedValue(ok([]))
    await controller.getRecentActivity('0')
    expect(mockService.getRecentActivity).toHaveBeenCalledWith(10)
  })

  it('activity-stats returns service value', async () => {
    mockService.getActivityStats.mockResolvedValue(ok({ today: 1 }))
    expect(await controller.getActivityStats()).toEqual({ today: 1 })
  })

  it('overdue-projects returns service value', async () => {
    mockService.getOverdueProjects.mockResolvedValue(ok([]))
    expect(await controller.getOverdue()).toEqual([])
  })
})
