import { BacklogController } from './backlog.controller.js'

describe('BacklogController', () => {
  let controller: BacklogController
  let service: { preview: jest.Mock; accept: jest.Mock }
  let jobs: { start: jest.Mock; get: jest.Mock }

  beforeEach(() => {
    service = { preview: jest.fn(), accept: jest.fn() }
    jobs = { start: jest.fn(), get: jest.fn() }
    controller = new BacklogController(service as unknown as never, jobs as unknown as never)
  })

  describe('generateAsync', () => {
    it('starts a background job and returns its id', () => {
      jobs.start.mockReturnValue('job-1')
      const out = controller.generateAsync('proj-1')
      expect(jobs.start).toHaveBeenCalledTimes(1)
      expect(out).toEqual({ jobId: 'job-1' })
    })
  })

  describe('jobStatus', () => {
    it('returns the job snapshot when present', () => {
      jobs.get.mockReturnValue({ status: 'done', result: { epics: [] } })
      expect(controller.jobStatus('job-1')).toEqual({ status: 'done', result: { epics: [] } })
    })

    it('throws NotFound when the job is missing/expired', () => {
      jobs.get.mockReturnValue(null)
      expect(() => controller.jobStatus('nope')).toThrow()
    })
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
