import { BadRequestException } from '@nestjs/common'
import { SearchController } from './search.controller.js'

const ok = <T>(value: T) => ({ isSuccess: true, isFailure: false, value, error: undefined })
const fail = (error: string) => ({ isSuccess: false, isFailure: true, value: undefined, error })

describe('SearchController', () => {
  let controller: SearchController
  let mockService: { search: jest.Mock }

  beforeEach(() => {
    mockService = { search: jest.fn() }
    controller = new SearchController(mockService as any)
  })

  it('passes q, userId, and parsed limit', async () => {
    mockService.search.mockResolvedValue(ok([]))
    await controller.search({ userId: 'u-1', role: 'Admin' }, 'hello', '20')
    expect(mockService.search).toHaveBeenCalledWith('hello', 'u-1', 20)
  })

  it('defaults limit to 8 when undefined', async () => {
    mockService.search.mockResolvedValue(ok([]))
    await controller.search({ userId: 'u-1', role: 'Member' }, 'x', undefined)
    expect(mockService.search).toHaveBeenCalledWith('x', 'u-1', 8)
  })

  it('substitutes empty string when q is missing', async () => {
    mockService.search.mockResolvedValue(ok([]))
    await controller.search({ userId: 'u-1', role: 'Member' }, undefined as any, undefined)
    expect(mockService.search).toHaveBeenCalledWith('', 'u-1', 8)
  })

  it('returns service value on success', async () => {
    mockService.search.mockResolvedValue(ok([{ id: 'h-1' }]))
    expect(await controller.search({ userId: 'u-1', role: 'Member' }, 'q', '8')).toEqual([{ id: 'h-1' }])
  })

  it('throws BadRequest when service fails', async () => {
    mockService.search.mockResolvedValue(fail('bad query'))
    await expect(
      controller.search({ userId: 'u-1', role: 'Member' }, 'q', '8'),
    ).rejects.toThrow(BadRequestException)
  })
})
