import { SystemStatusController } from './system-status.controller.js'

describe('SystemStatusController', () => {
  let controller: SystemStatusController
  let mockService: { getStatus: jest.Mock }

  beforeEach(() => {
    mockService = { getStatus: jest.fn() }
    controller = new SystemStatusController(mockService as any)
  })

  it('returns service.getStatus() result verbatim', async () => {
    const payload = { ok: true, uptime: 123 }
    mockService.getStatus.mockResolvedValue(payload)
    expect(await controller.getStatus()).toBe(payload)
    expect(mockService.getStatus).toHaveBeenCalledTimes(1)
  })
})
