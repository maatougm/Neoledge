import { BadRequestException } from '@nestjs/common'
import { ChecklistsController } from './checklists.controller.js'

const ok = <T>(value: T) => ({ isSuccess: true, isFailure: false, value, error: undefined })
const fail = (error: string) => ({ isSuccess: false, isFailure: true, value: undefined, error })

describe('ChecklistsController', () => {
  let controller: ChecklistsController
  let mockService: {
    getForProjectPhase: jest.Mock
    getProgress: jest.Mock
    toggle: jest.Mock
    addItem: jest.Mock
    deleteItem: jest.Mock
  }

  beforeEach(() => {
    mockService = {
      getForProjectPhase: jest.fn(),
      getProgress: jest.fn(),
      toggle: jest.fn(),
      addItem: jest.fn(),
      deleteItem: jest.fn(),
    }
    controller = new ChecklistsController(mockService as any)
  })

  it('getPhase forwards projectId and phase', async () => {
    mockService.getForProjectPhase.mockResolvedValue(ok([]))
    await controller.getPhase('p-1', 'Cadrage')
    expect(mockService.getForProjectPhase).toHaveBeenCalledWith('p-1', 'Cadrage')
  })

  it('getProgress returns service value', async () => {
    mockService.getProgress.mockResolvedValue(ok({ done: 1, total: 4 }))
    expect(await controller.getProgress('p-1')).toEqual({ done: 1, total: 4 })
  })

  describe('toggle', () => {
    it('returns updated item on success', async () => {
      mockService.toggle.mockResolvedValue(ok({ id: 'i-1', isChecked: true }))
      const r = await controller.toggle('i-1', { userId: 'u-1' }, { isChecked: true })
      expect(r).toEqual({ id: 'i-1', isChecked: true })
      expect(mockService.toggle).toHaveBeenCalledWith('i-1', 'u-1', true)
    })

    it('throws BadRequest on failure', async () => {
      mockService.toggle.mockResolvedValue(fail('not found'))
      await expect(
        controller.toggle('i-1', { userId: 'u-1' }, { isChecked: true }),
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('addItem', () => {
    it('rejects empty label', async () => {
      await expect(
        controller.addItem('p-1', { phase: 'P', label: '   ' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects empty phase', async () => {
      await expect(
        controller.addItem('p-1', { phase: '', label: 'X' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('returns the new item on success', async () => {
      mockService.addItem.mockResolvedValue(ok({ id: 'new', label: 'X' }))
      const r = await controller.addItem('p-1', { phase: 'P', label: 'X' })
      expect(r).toEqual({ id: 'new', label: 'X' })
      expect(mockService.addItem).toHaveBeenCalledWith('p-1', 'P', 'X')
    })

    it('throws BadRequest on service failure', async () => {
      mockService.addItem.mockResolvedValue(fail('quota'))
      await expect(
        controller.addItem('p-1', { phase: 'P', label: 'X' }),
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('deleteItem', () => {
    it('resolves on success', async () => {
      mockService.deleteItem.mockResolvedValue(ok(undefined))
      await expect(controller.deleteItem('i-1')).resolves.toBeUndefined()
    })

    it('throws BadRequest on failure', async () => {
      mockService.deleteItem.mockResolvedValue(fail('not found'))
      await expect(controller.deleteItem('i-1')).rejects.toThrow(BadRequestException)
    })
  })
})
