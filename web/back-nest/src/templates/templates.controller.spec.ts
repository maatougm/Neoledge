import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { TemplatesController } from './templates.controller.js'

const ok = <T>(value: T) => ({ isSuccess: true, isFailure: false, value, error: undefined })
const fail = (error: string) => ({ isSuccess: false, isFailure: true, value: undefined, error })

describe('TemplatesController', () => {
  let controller: TemplatesController
  let mockService: {
    getAll: jest.Mock
    getById: jest.Mock
    create: jest.Mock
    createFromProject: jest.Mock
    deleteTemplate: jest.Mock
    applyToProject: jest.Mock
  }
  let mockPrisma: { project: { findFirst: jest.Mock } }
  const pmUser = { userId: 'pm-1', role: 'ProjectManager' }
  const otherPm = { userId: 'pm-other', role: 'ProjectManager' }

  beforeEach(() => {
    mockService = {
      getAll: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      createFromProject: jest.fn(),
      deleteTemplate: jest.fn(),
      applyToProject: jest.fn(),
    }
    mockPrisma = { project: { findFirst: jest.fn() } }
    controller = new TemplatesController(mockService as any, mockPrisma as any)
  })

  it('getAll returns service value', async () => {
    mockService.getAll.mockResolvedValue(ok([{ id: 't-1' }]))
    expect(await controller.getAll()).toEqual([{ id: 't-1' }])
  })

  it('getById returns row on success', async () => {
    mockService.getById.mockResolvedValue(ok({ id: 't-1' }))
    expect(await controller.getById('t-1')).toEqual({ id: 't-1' })
  })

  it('getById throws 404 on failure', async () => {
    mockService.getById.mockResolvedValue(fail('not found'))
    await expect(controller.getById('t-1')).rejects.toThrow(NotFoundException)
  })

  it('create returns new template', async () => {
    mockService.create.mockResolvedValue(ok({ id: 't-new' }))
    expect(await controller.create(pmUser, { name: 'X', fields: [] } as any)).toEqual({ id: 't-new' })
    expect(mockService.create).toHaveBeenCalledWith({ name: 'X', fields: [] }, 'pm-1')
  })

  it('create throws 400 on failure', async () => {
    mockService.create.mockResolvedValue(fail('bad'))
    await expect(controller.create(pmUser, { name: 'X' } as any)).rejects.toThrow(BadRequestException)
  })

  describe('createFromProject', () => {
    it('rejects missing name', async () => {
      await expect(
        controller.createFromProject('p-1', { name: '' } as any, pmUser),
      ).rejects.toThrow(BadRequestException)
    })

    it('throws 404 when project missing', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(null)
      await expect(
        controller.createFromProject('p-1', { name: 'X' } as any, pmUser),
      ).rejects.toThrow(NotFoundException)
    })

    it('forbids non-owner PM', async () => {
      mockPrisma.project.findFirst.mockResolvedValue({ projectManagerId: 'pm-1' })
      await expect(
        controller.createFromProject('p-1', { name: 'X' } as any, otherPm),
      ).rejects.toThrow(ForbiddenException)
    })

    it('returns the new template on success', async () => {
      mockPrisma.project.findFirst.mockResolvedValue({ projectManagerId: 'pm-1' })
      mockService.createFromProject.mockResolvedValue(ok({ id: 't-new' }))
      expect(await controller.createFromProject('p-1', { name: 'X' } as any, pmUser)).toEqual({
        id: 't-new',
      })
    })

    it('throws 400 when service fails', async () => {
      mockPrisma.project.findFirst.mockResolvedValue({ projectManagerId: 'pm-1' })
      mockService.createFromProject.mockResolvedValue(fail('bad'))
      await expect(
        controller.createFromProject('p-1', { name: 'X' } as any, pmUser),
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('delete', () => {
    it('resolves on success', async () => {
      mockService.deleteTemplate.mockResolvedValue(ok(undefined))
      await expect(controller.delete('t-1')).resolves.toBeUndefined()
    })

    it('throws 404 on failure', async () => {
      mockService.deleteTemplate.mockResolvedValue(fail('not found'))
      await expect(controller.delete('t-1')).rejects.toThrow(NotFoundException)
    })
  })

  describe('apply', () => {
    it('throws 404 when project missing', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(null)
      await expect(controller.apply('t-1', 'p-1', pmUser)).rejects.toThrow(NotFoundException)
    })

    it('forbids non-owner PM', async () => {
      mockPrisma.project.findFirst.mockResolvedValue({ projectManagerId: 'pm-1' })
      await expect(controller.apply('t-1', 'p-1', otherPm)).rejects.toThrow(ForbiddenException)
    })

    it('resolves on success', async () => {
      mockPrisma.project.findFirst.mockResolvedValue({ projectManagerId: 'pm-1' })
      mockService.applyToProject.mockResolvedValue(ok(undefined))
      await expect(controller.apply('t-1', 'p-1', pmUser)).resolves.toBeUndefined()
    })

    it('throws 400 on service failure', async () => {
      mockPrisma.project.findFirst.mockResolvedValue({ projectManagerId: 'pm-1' })
      mockService.applyToProject.mockResolvedValue(fail('mismatch'))
      await expect(controller.apply('t-1', 'p-1', pmUser)).rejects.toThrow(BadRequestException)
    })
  })
})
