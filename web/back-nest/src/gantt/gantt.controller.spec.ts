import { BadRequestException } from '@nestjs/common'
import { GanttController } from './gantt.controller.js'

const ok = <T>(value: T) => ({ isSuccess: true, isFailure: false, value, error: undefined })
const fail = (error: string) => ({ isSuccess: false, isFailure: true, value: undefined, error })

describe('GanttController', () => {
  let controller: GanttController
  let mockService: Record<string, jest.Mock>
  const user = { userId: 'u-1' }

  beforeEach(() => {
    mockService = {
      getGanttPayload: jest.fn(),
      listMilestones: jest.fn(),
      createMilestone: jest.fn(),
      updateMilestone: jest.fn(),
      deleteMilestone: jest.fn(),
      markMilestoneReached: jest.fn(),
      listBaselines: jest.fn(),
      captureBaseline: jest.fn(),
      deleteBaseline: jest.fn(),
      compareBaseline: jest.fn(),
    }
    controller = new GanttController(mockService as any)
  })

  it('getGantt returns payload', async () => {
    mockService.getGanttPayload.mockResolvedValue(ok({ tasks: [] }))
    expect(await controller.getGantt('p-1')).toEqual({ tasks: [] })
  })

  it('getGantt throws BadRequest on failure', async () => {
    mockService.getGanttPayload.mockResolvedValue(fail('no'))
    await expect(controller.getGantt('p-1')).rejects.toThrow(BadRequestException)
  })

  it('listMs returns list', async () => {
    mockService.listMilestones.mockResolvedValue(ok([{ id: 'm-1' }]))
    expect(await controller.listMs('p-1')).toEqual([{ id: 'm-1' }])
  })

  describe('createMs', () => {
    it('rejects missing title', async () => {
      await expect(
        controller.createMs('p-1', { title: '', date: '2026-05-01' } as any),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects missing date', async () => {
      await expect(
        controller.createMs('p-1', { title: 'T' } as any),
      ).rejects.toThrow(BadRequestException)
    })

    it('returns row on success', async () => {
      mockService.createMilestone.mockResolvedValue(ok({ id: 'm-1' }))
      expect(
        await controller.createMs('p-1', { title: 'T', date: '2026-05-01' } as any),
      ).toEqual({ id: 'm-1' })
    })

    it('throws BadRequest on service failure', async () => {
      mockService.createMilestone.mockResolvedValue(fail('bad'))
      await expect(
        controller.createMs('p-1', { title: 'T', date: '2026-05-01' } as any),
      ).rejects.toThrow(BadRequestException)
    })
  })

  it('updateMs returns row on success', async () => {
    mockService.updateMilestone.mockResolvedValue(ok({ id: 'm-1' }))
    expect(await controller.updateMs('m-1', { title: 'N' } as any)).toEqual({ id: 'm-1' })
  })

  it('updateMs throws BadRequest on failure', async () => {
    mockService.updateMilestone.mockResolvedValue(fail('no'))
    await expect(controller.updateMs('m-1', {} as any)).rejects.toThrow(BadRequestException)
  })

  it('deleteMs resolves on success', async () => {
    mockService.deleteMilestone.mockResolvedValue(ok(undefined))
    await expect(controller.deleteMs('p-1', 'm-1')).resolves.toBeUndefined()
  })

  it('deleteMs throws BadRequest on failure', async () => {
    mockService.deleteMilestone.mockResolvedValue(fail('no'))
    await expect(controller.deleteMs('p-1', 'm-1')).rejects.toThrow(BadRequestException)
  })

  it('reachMs returns row', async () => {
    mockService.markMilestoneReached.mockResolvedValue(ok({ id: 'm-1', reachedAt: '2026-05-01' }))
    expect(await controller.reachMs('p-1', 'm-1')).toEqual({
      id: 'm-1',
      reachedAt: '2026-05-01',
    })
  })

  it('listBaselines returns list', async () => {
    mockService.listBaselines.mockResolvedValue(ok([{ snapshotName: 'v1' }]))
    expect(await controller.listBaselines('p-1')).toEqual([{ snapshotName: 'v1' }])
  })

  describe('captureBaseline', () => {
    it('rejects missing name', async () => {
      await expect(
        controller.captureBaseline('p-1', { snapshotName: '' } as any, user as any),
      ).rejects.toThrow(BadRequestException)
    })

    it('trims and passes userId through', async () => {
      mockService.captureBaseline.mockResolvedValue(ok({ snapshotName: 'v1' }))
      await controller.captureBaseline('p-1', { snapshotName: '  v1  ' } as any, user as any)
      expect(mockService.captureBaseline).toHaveBeenCalledWith('p-1', 'v1', 'u-1')
    })

    it('throws BadRequest on service failure', async () => {
      mockService.captureBaseline.mockResolvedValue(fail('dup'))
      await expect(
        controller.captureBaseline('p-1', { snapshotName: 'v1' } as any, user as any),
      ).rejects.toThrow(BadRequestException)
    })
  })

  it('deleteBaseline resolves on success', async () => {
    mockService.deleteBaseline.mockResolvedValue(ok(undefined))
    await expect(controller.deleteBaseline('p-1', 'v1')).resolves.toBeUndefined()
  })

  it('compareBaseline returns service value', async () => {
    mockService.compareBaseline.mockResolvedValue(ok({ diff: [] }))
    expect(await controller.compareBaseline('p-1', 'v1')).toEqual({ diff: [] })
  })
})
