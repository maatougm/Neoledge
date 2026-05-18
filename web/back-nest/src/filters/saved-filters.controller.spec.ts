import { BadRequestException, NotFoundException } from '@nestjs/common'
import { SavedFiltersController } from './saved-filters.controller.js'

const ok = <T>(value: T) => ({ isSuccess: true, isFailure: false, value, error: undefined })
const fail = (error: string) => ({ isSuccess: false, isFailure: true, value: undefined, error })

describe('SavedFiltersController', () => {
  let controller: SavedFiltersController
  let mockService: {
    getAll: jest.Mock
    create: jest.Mock
    update: jest.Mock
    delete: jest.Mock
    setDefault: jest.Mock
  }

  beforeEach(() => {
    mockService = {
      getAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      setDefault: jest.fn(),
    }
    controller = new SavedFiltersController(mockService as any)
  })

  it('getAll → returns rows', async () => {
    mockService.getAll.mockResolvedValue(ok([{ id: 'f-1' }]))
    expect(await controller.getAll({ userId: 'u-1' })).toEqual([{ id: 'f-1' }])
  })

  it('getAll → 404 on failure', async () => {
    mockService.getAll.mockResolvedValue(fail('no'))
    await expect(controller.getAll({ userId: 'u-1' })).rejects.toThrow(NotFoundException)
  })

  it('create → returns the new row', async () => {
    mockService.create.mockResolvedValue(ok({ id: 'f-1', name: 'My' }))
    expect(await controller.create({ userId: 'u-1' }, { name: 'My', filters: {} } as any)).toEqual({
      id: 'f-1',
      name: 'My',
    })
  })

  it('create → 400 on failure', async () => {
    mockService.create.mockResolvedValue(fail('Invalid'))
    await expect(
      controller.create({ userId: 'u-1' }, { name: '', filters: {} } as any),
    ).rejects.toThrow(BadRequestException)
  })

  it('update → returns updated row', async () => {
    mockService.update.mockResolvedValue(ok({ id: 'f-1', name: 'N' }))
    expect(await controller.update({ userId: 'u-1' }, 'f-1', { name: 'N' } as any)).toEqual({
      id: 'f-1',
      name: 'N',
    })
  })

  it('update → 404 when not owned by user', async () => {
    mockService.update.mockResolvedValue(fail('not found'))
    await expect(
      controller.update({ userId: 'u-1' }, 'f-1', { name: 'N' } as any),
    ).rejects.toThrow(NotFoundException)
  })

  it('delete → returns void on success', async () => {
    mockService.delete.mockResolvedValue(ok(undefined))
    await expect(controller.delete({ userId: 'u-1' }, 'f-1')).resolves.toBeUndefined()
  })

  it('delete → 404 on failure', async () => {
    mockService.delete.mockResolvedValue(fail('no'))
    await expect(controller.delete({ userId: 'u-1' }, 'f-1')).rejects.toThrow(NotFoundException)
  })

  it('setDefault → returns void on success', async () => {
    mockService.setDefault.mockResolvedValue(ok(undefined))
    await expect(controller.setDefault({ userId: 'u-1' }, 'f-1')).resolves.toBeUndefined()
  })

  it('setDefault → 404 on failure', async () => {
    mockService.setDefault.mockResolvedValue(fail('no'))
    await expect(controller.setDefault({ userId: 'u-1' }, 'f-1')).rejects.toThrow(NotFoundException)
  })
})
