import { BacklogController } from './backlog.controller.js'

describe('BacklogController', () => {
  let controller: BacklogController
  let service: { preview: jest.Mock; accept: jest.Mock }

  beforeEach(() => {
    service = { preview: jest.fn(), accept: jest.fn() }
    controller = new BacklogController(service as unknown as never)
  })

  describe('preview', () => {
    it('delegates to service.preview with the projectId', async () => {
      const proposed = { epics: [{ title: 'E1', priority: 'Normal', estimatedHours: 10, children: [] }] }
      service.preview.mockResolvedValue(proposed)

      const out = await controller.preview('proj-1')

      expect(service.preview).toHaveBeenCalledWith('proj-1')
      expect(out).toBe(proposed)
    })

    it('propagates service errors', async () => {
      service.preview.mockRejectedValue(new Error('429'))
      await expect(controller.preview('proj-1')).rejects.toThrow('429')
    })
  })

  describe('accept', () => {
    it('extracts userId from req.user and forwards the backlog body', async () => {
      service.accept.mockResolvedValue({ created: 7 })
      const req = { user: { userId: 'u-42' } } as unknown as never
      const body = { epics: [{ title: 'E', priority: 'Normal', estimatedHours: 8, children: [] }] }

      const out = await controller.accept('proj-1', body, req)

      expect(service.accept).toHaveBeenCalledWith('proj-1', 'u-42', body)
      expect(out).toEqual({ created: 7 })
    })

    it("defaults userId to '' when req.user is missing", async () => {
      service.accept.mockResolvedValue({ created: 0 })
      await controller.accept('proj-1', {}, {} as unknown as never)
      expect(service.accept).toHaveBeenCalledWith('proj-1', '', {})
    })

    it('passes through unknown body unchanged (sanitization happens in the service)', async () => {
      service.accept.mockResolvedValue({ created: 0 })
      const malicious = { epics: 'not-an-array' }
      const req = { user: { userId: 'u-1' } } as unknown as never
      await controller.accept('proj-1', malicious, req)
      expect(service.accept).toHaveBeenCalledWith('proj-1', 'u-1', malicious)
    })
  })
})
