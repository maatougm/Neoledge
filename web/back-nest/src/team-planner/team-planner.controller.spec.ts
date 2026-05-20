import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { TeamPlannerController } from './team-planner.controller.js'

const ok = <T>(value: T) => ({ isSuccess: true, isFailure: false, value, error: undefined })
const fail = (error: string) => ({ isSuccess: false, isFailure: true, value: undefined, error })

describe('TeamPlannerController', () => {
  let controller: TeamPlannerController
  let mockService: {
    getAssignments: jest.Mock
    getCapacity: jest.Mock
    getConflicts: jest.Mock
    reassign: jest.Mock
  }

  beforeEach(() => {
    mockService = {
      getAssignments: jest.fn(),
      getCapacity: jest.fn(),
      getConflicts: jest.fn(),
      reassign: jest.fn(),
    }
    controller = new TeamPlannerController(mockService as any)
  })

  describe('getAssignments', () => {
    it('rejects missing from', async () => {
      await expect(controller.getAssignments('', '2026-05-31')).rejects.toThrow(BadRequestException)
    })

    it('rejects missing to', async () => {
      await expect(controller.getAssignments('2026-05-01', '')).rejects.toThrow(BadRequestException)
    })

    it('parses comma lists and passes through', async () => {
      mockService.getAssignments.mockResolvedValue(ok([]))
      await controller.getAssignments('2026-05-01', '2026-05-31', 'u-1,u-2', 'p-1')
      expect(mockService.getAssignments).toHaveBeenCalledWith({
        from: '2026-05-01',
        to: '2026-05-31',
        userIds: ['u-1', 'u-2'],
        projectIds: ['p-1'],
      })
    })

    it('passes undefined when no filters', async () => {
      mockService.getAssignments.mockResolvedValue(ok([]))
      await controller.getAssignments('2026-05-01', '2026-05-31', undefined, undefined)
      expect(mockService.getAssignments).toHaveBeenCalledWith({
        from: '2026-05-01',
        to: '2026-05-31',
        userIds: undefined,
        projectIds: undefined,
      })
    })

    it('throws on service failure', async () => {
      mockService.getAssignments.mockResolvedValue(fail('boom'))
      await expect(
        controller.getAssignments('2026-05-01', '2026-05-31'),
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('getCapacity', () => {
    it('rejects missing dates', async () => {
      await expect(controller.getCapacity('', '2026-05-31')).rejects.toThrow(BadRequestException)
    })

    it('returns service value on success', async () => {
      mockService.getCapacity.mockResolvedValue(ok([{ userId: 'u', hours: 40 }]))
      expect(await controller.getCapacity('2026-05-01', '2026-05-31')).toEqual([
        { userId: 'u', hours: 40 },
      ])
    })

    it('throws on failure', async () => {
      mockService.getCapacity.mockResolvedValue(fail('bad'))
      await expect(controller.getCapacity('2026-05-01', '2026-05-31')).rejects.toThrow(
        BadRequestException,
      )
    })
  })

  describe('getConflicts', () => {
    it('rejects missing dates', async () => {
      await expect(controller.getConflicts('2026-05-01', '')).rejects.toThrow(BadRequestException)
    })

    it('returns service value', async () => {
      mockService.getConflicts.mockResolvedValue(ok([]))
      expect(await controller.getConflicts('2026-05-01', '2026-05-31')).toEqual([])
    })
  })

  describe('reassign', () => {
    it('throws Forbidden when no userId on req', async () => {
      await expect(
        controller.reassign('wp-1', { assigneeId: 'u-2' }, { user: undefined } as any),
      ).rejects.toThrow(ForbiddenException)
    })

    it('passes through on success', async () => {
      mockService.reassign.mockResolvedValue(ok({ id: 'wp-1', assigneeId: 'u-2' }))
      const req = { user: { userId: 'pm-1', role: 'ProjectManager' } } as any
      const dto = { assigneeId: 'u-2', startDate: '2026-05-10' }
      expect(await controller.reassign('wp-1', dto, req)).toEqual({ id: 'wp-1', assigneeId: 'u-2' })
      expect(mockService.reassign).toHaveBeenCalledWith('wp-1', dto, 'pm-1', 'ProjectManager')
    })

    it('throws on service failure', async () => {
      mockService.reassign.mockResolvedValue(fail('quota'))
      await expect(
        controller.reassign('wp-1', { assigneeId: 'u-2' }, { user: { userId: 'pm-1' } } as any),
      ).rejects.toThrow(BadRequestException)
    })
  })
})
