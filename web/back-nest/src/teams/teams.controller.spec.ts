import { InternalServerErrorException } from '@nestjs/common'
import { TeamsController } from './teams.controller.js'

const ok = <T>(value: T) => ({ isSuccess: true, isFailure: false, value, error: undefined })
const fail = (error: string) => ({ isSuccess: false, isFailure: true, value: undefined, error })

describe('TeamsController', () => {
  let controller: TeamsController
  let mockService: { findAll: jest.Mock }

  beforeEach(() => {
    mockService = { findAll: jest.fn() }
    controller = new TeamsController(mockService as any)
  })

  it('returns the four canonical teams on success', async () => {
    const teams = [{ id: 'R' }, { id: 'A' }, { id: 'C' }, { id: 'I' }]
    mockService.findAll.mockResolvedValue(ok(teams))
    expect(await controller.findAll()).toBe(teams)
  })

  it('throws 500 InternalServerErrorException when the service fails', async () => {
    mockService.findAll.mockResolvedValue(fail('DB down'))
    await expect(controller.findAll()).rejects.toThrow(InternalServerErrorException)
  })
})
