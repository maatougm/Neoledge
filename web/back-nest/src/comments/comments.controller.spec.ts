import { BadRequestException, NotFoundException } from '@nestjs/common'
import { CommentsController } from './comments.controller.js'

const ok = <T>(value: T) => ({ isSuccess: true, isFailure: false, value, error: undefined })
const fail = (error: string) => ({ isSuccess: false, isFailure: true, value: undefined, error })

describe('CommentsController', () => {
  let controller: CommentsController
  let mockService: {
    getProjectComments: jest.Mock
    create: jest.Mock
    getById: jest.Mock
    update: jest.Mock
    deleteComment: jest.Mock
  }

  beforeEach(() => {
    mockService = {
      getProjectComments: jest.fn(),
      create: jest.fn(),
      getById: jest.fn(),
      update: jest.fn(),
      deleteComment: jest.fn(),
    }
    controller = new CommentsController(mockService as any)
  })

  it('getAll → returns service value', async () => {
    mockService.getProjectComments.mockResolvedValue(ok([{ id: 'c-1' }]))
    expect(await controller.getAll('p-1')).toEqual([{ id: 'c-1' }])
  })

  describe('create', () => {
    it('rejects empty content', async () => {
      await expect(
        controller.create('p-1', { userId: 'u-1' }, { content: '   ' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects > 20k chars', async () => {
      await expect(
        controller.create('p-1', { userId: 'u-1' }, { content: 'x'.repeat(20_001) }),
      ).rejects.toThrow(BadRequestException)
    })

    it('returns new row on success', async () => {
      mockService.create.mockResolvedValue(ok({ id: 'c-1' }))
      expect(await controller.create('p-1', { userId: 'u-1' }, { content: 'hi' })).toEqual({ id: 'c-1' })
      expect(mockService.create).toHaveBeenCalledWith('p-1', 'u-1', 'hi')
    })

    it('throws 400 when service fails', async () => {
      mockService.create.mockResolvedValue(fail('blocked'))
      await expect(
        controller.create('p-1', { userId: 'u-1' }, { content: 'hi' }),
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('getById', () => {
    it('returns row on success', async () => {
      mockService.getById.mockResolvedValue(ok({ id: 'c-1' }))
      expect(await controller.getById('c-1')).toEqual({ id: 'c-1' })
    })

    it('throws 404 on failure', async () => {
      mockService.getById.mockResolvedValue(fail('not found'))
      await expect(controller.getById('c-1')).rejects.toThrow(NotFoundException)
    })
  })

  describe('update', () => {
    it('passes isAdmin=true when user role is Admin', async () => {
      mockService.update.mockResolvedValue(ok({ id: 'c-1' }))
      await controller.update('c-1', { userId: 'u-1', role: 'Admin' }, { content: 'edit' })
      expect(mockService.update).toHaveBeenCalledWith('c-1', 'u-1', true, 'edit')
    })

    it('passes isAdmin=false for non-Admin', async () => {
      mockService.update.mockResolvedValue(ok({ id: 'c-1' }))
      await controller.update('c-1', { userId: 'u-1', role: 'Member' }, { content: 'edit' })
      expect(mockService.update).toHaveBeenCalledWith('c-1', 'u-1', false, 'edit')
    })

    it('throws 400 on failure', async () => {
      mockService.update.mockResolvedValue(fail('forbidden'))
      await expect(
        controller.update('c-1', { userId: 'u-1', role: 'Member' }, { content: 'x' }),
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('delete', () => {
    it('resolves on success', async () => {
      mockService.deleteComment.mockResolvedValue(ok(undefined))
      await expect(
        controller.delete('c-1', { userId: 'u-1', role: 'Admin' }),
      ).resolves.toBeUndefined()
      expect(mockService.deleteComment).toHaveBeenCalledWith('c-1', 'u-1', true)
    })

    it('throws 400 on failure', async () => {
      mockService.deleteComment.mockResolvedValue(fail('forbidden'))
      await expect(
        controller.delete('c-1', { userId: 'u-1', role: 'Member' }),
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('reply', () => {
    it('rejects empty content', async () => {
      await expect(
        controller.reply('p-1', 'c-1', { userId: 'u-1' }, { content: '' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects > 20k chars', async () => {
      await expect(
        controller.reply('p-1', 'c-1', { userId: 'u-1' }, { content: 'x'.repeat(20_001) }),
      ).rejects.toThrow(BadRequestException)
    })

    it('passes parentCommentId to service.create', async () => {
      mockService.create.mockResolvedValue(ok({ id: 'r-1' }))
      await controller.reply('p-1', 'c-1', { userId: 'u-1' }, { content: 'hi' })
      expect(mockService.create).toHaveBeenCalledWith('p-1', 'u-1', 'hi', 'c-1')
    })

    it('throws 400 on failure', async () => {
      mockService.create.mockResolvedValue(fail('blocked'))
      await expect(
        controller.reply('p-1', 'c-1', { userId: 'u-1' }, { content: 'hi' }),
      ).rejects.toThrow(BadRequestException)
    })
  })
})
