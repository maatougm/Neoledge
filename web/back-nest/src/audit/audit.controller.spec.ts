import { AuditController } from './audit.controller.js'

const ok = <T>(value: T) => ({ isSuccess: true, isFailure: false, value, error: undefined })

describe('AuditController', () => {
  let controller: AuditController
  let mockService: { getRecent: jest.Mock; getForEntity: jest.Mock }

  beforeEach(() => {
    mockService = { getRecent: jest.fn(), getForEntity: jest.fn() }
    controller = new AuditController(mockService as any)
  })

  describe('getRecent', () => {
    it('passes parsed limit clamped to 200', async () => {
      mockService.getRecent.mockResolvedValue(ok([]))
      await controller.getRecent('500')
      expect(mockService.getRecent).toHaveBeenCalledWith(200)
    })

    it('honours small numeric limit', async () => {
      mockService.getRecent.mockResolvedValue(ok([]))
      await controller.getRecent('20')
      expect(mockService.getRecent).toHaveBeenCalledWith(20)
    })

    it('defaults to 50 when no limit provided', async () => {
      mockService.getRecent.mockResolvedValue(ok([]))
      await controller.getRecent(undefined)
      expect(mockService.getRecent).toHaveBeenCalledWith(50)
    })

    it('returns the service value', async () => {
      const rows = [{ id: 'a-1' }]
      mockService.getRecent.mockResolvedValue(ok(rows))
      expect(await controller.getRecent('10')).toBe(rows)
    })
  })

  describe('getForEntity', () => {
    it('passes entityType + entityId through', async () => {
      mockService.getForEntity.mockResolvedValue(ok([]))
      await controller.getForEntity('Project', 'p-1')
      expect(mockService.getForEntity).toHaveBeenCalledWith('Project', 'p-1')
    })

    it('returns the service value', async () => {
      const rows = [{ id: 'a-2' }]
      mockService.getForEntity.mockResolvedValue(ok(rows))
      expect(await controller.getForEntity('Project', 'p-1')).toBe(rows)
    })
  })
})
