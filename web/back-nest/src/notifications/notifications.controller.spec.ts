import { InternalServerErrorException, NotFoundException } from '@nestjs/common'
import { NotificationsController } from './notifications.controller.js'

const ok = <T>(value: T) => ({ isSuccess: true, isFailure: false, value, error: undefined })
const fail = (error: string) => ({ isSuccess: false, isFailure: true, value: undefined, error })

describe('NotificationsController', () => {
  let controller: NotificationsController
  let mockService: {
    getForUser: jest.Mock
    getUnreadCount: jest.Mock
    markAsRead: jest.Mock
    markAllAsRead: jest.Mock
    delete: jest.Mock
  }

  beforeEach(() => {
    mockService = {
      getForUser: jest.fn(),
      getUnreadCount: jest.fn(),
      markAsRead: jest.fn(),
      markAllAsRead: jest.fn(),
      delete: jest.fn(),
    }
    controller = new NotificationsController(mockService as any)
  })

  describe('getMyNotifications', () => {
    it('passes cursor + parsed take through', async () => {
      mockService.getForUser.mockResolvedValue(ok({ items: [], nextCursor: null }))
      await controller.getMyNotifications({ userId: 'u-1', role: 'Member' }, 'cur-1', '20')
      expect(mockService.getForUser).toHaveBeenCalledWith('u-1', { cursor: 'cur-1', take: 20 })
    })

    it('clamps take to 100', async () => {
      mockService.getForUser.mockResolvedValue(ok({ items: [], nextCursor: null }))
      await controller.getMyNotifications({ userId: 'u-1', role: 'Member' }, undefined, '500')
      expect(mockService.getForUser).toHaveBeenCalledWith('u-1', { cursor: undefined, take: 100 })
    })

    it('passes take: undefined when missing', async () => {
      mockService.getForUser.mockResolvedValue(ok({ items: [], nextCursor: null }))
      await controller.getMyNotifications({ userId: 'u-1', role: 'Member' }, undefined, undefined)
      expect(mockService.getForUser).toHaveBeenCalledWith('u-1', { cursor: undefined, take: undefined })
    })

    it('throws 500 when service fails', async () => {
      mockService.getForUser.mockResolvedValue(fail('DB down'))
      await expect(
        controller.getMyNotifications({ userId: 'u-1', role: 'Member' }, undefined, undefined),
      ).rejects.toThrow(InternalServerErrorException)
    })
  })

  describe('getUnreadCount', () => {
    it('returns { count } shape', async () => {
      mockService.getUnreadCount.mockResolvedValue(ok(7))
      expect(await controller.getUnreadCount({ userId: 'u-1', role: 'Member' })).toEqual({ count: 7 })
    })

    it('throws 500 when service fails', async () => {
      mockService.getUnreadCount.mockResolvedValue(fail('boom'))
      await expect(
        controller.getUnreadCount({ userId: 'u-1', role: 'Member' }),
      ).rejects.toThrow(InternalServerErrorException)
    })
  })

  describe('markAsRead', () => {
    it('resolves on success', async () => {
      mockService.markAsRead.mockResolvedValue(ok(undefined))
      await expect(
        controller.markAsRead('n-1', { userId: 'u-1', role: 'Member' }),
      ).resolves.toBeUndefined()
    })

    it('throws 404 on failure', async () => {
      mockService.markAsRead.mockResolvedValue(fail('not found'))
      await expect(
        controller.markAsRead('n-1', { userId: 'u-1', role: 'Member' }),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('markAllAsRead', () => {
    it('resolves on success', async () => {
      mockService.markAllAsRead.mockResolvedValue(ok(undefined))
      await expect(
        controller.markAllAsRead({ userId: 'u-1', role: 'Member' }),
      ).resolves.toBeUndefined()
    })

    it('throws 500 on failure', async () => {
      mockService.markAllAsRead.mockResolvedValue(fail('boom'))
      await expect(
        controller.markAllAsRead({ userId: 'u-1', role: 'Member' }),
      ).rejects.toThrow(InternalServerErrorException)
    })
  })

  describe('delete', () => {
    it('resolves on success', async () => {
      mockService.delete.mockResolvedValue(ok(undefined))
      await expect(
        controller.delete('n-1', { userId: 'u-1', role: 'Member' }),
      ).resolves.toBeUndefined()
    })

    it('throws 404 on failure', async () => {
      mockService.delete.mockResolvedValue(fail('not found'))
      await expect(
        controller.delete('n-1', { userId: 'u-1', role: 'Member' }),
      ).rejects.toThrow(NotFoundException)
    })
  })
})
