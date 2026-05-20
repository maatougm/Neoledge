import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

import api from '@/lib/api'
import { useNotificationStore } from './notificationStore'

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
  patch: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

const makeN = (over: Partial<{ id: string; isRead: boolean }> = {}) => ({
  id: 'n1',
  userId: 'u1',
  type: 'project_assigned',
  title: 'Hi',
  message: 'hello',
  projectId: null,
  isRead: false,
  createdAt: '2026-01-01',
  ...over,
})

beforeEach(() => {
  setActivePinia(createPinia())
  mockedApi.get.mockReset()
  mockedApi.patch.mockReset()
  mockedApi.delete.mockReset()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('notificationStore', () => {
  it('initial state', () => {
    const s = useNotificationStore()
    expect(s.notifications).toEqual([])
    expect(s.nextCursor).toBeNull()
    expect(s.unreadCount).toBe(0)
  })

  it('unreadCount reflects unread notifications', () => {
    const s = useNotificationStore()
    s.notifications = [makeN({ id: 'a' }), makeN({ id: 'b', isRead: true }), makeN({ id: 'c' })] as never
    expect(s.unreadCount).toBe(2)
  })

  it('fetchNotifications stores items + nextCursor', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { items: [makeN()], nextCursor: 'cur-1' } })
    const s = useNotificationStore()
    await s.fetchNotifications()
    expect(s.notifications).toHaveLength(1)
    expect(s.nextCursor).toBe('cur-1')
  })

  it('fetchNotifications tolerates non-array body (network glitch)', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: null })
    const s = useNotificationStore()
    await s.fetchNotifications()
    expect(s.notifications).toEqual([])
    expect(s.nextCursor).toBeNull()
  })

  it('fetchNotifications writes error on rejection', async () => {
    mockedApi.get.mockRejectedValueOnce(new Error('down'))
    const s = useNotificationStore()
    await s.fetchNotifications()
    expect(s.error).toBe('down')
  })

  it('fetchUnreadCount no-ops when count matches', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { count: 0 } })
    const s = useNotificationStore()
    await s.fetchUnreadCount()
    expect(mockedApi.get).toHaveBeenCalledTimes(1)
  })

  it('fetchUnreadCount triggers a full refetch when count differs', async () => {
    mockedApi.get
      .mockResolvedValueOnce({ data: { count: 3 } })
      .mockResolvedValueOnce({ data: { items: [makeN()], nextCursor: null } })
    const s = useNotificationStore()
    await s.fetchUnreadCount()
    expect(mockedApi.get).toHaveBeenCalledTimes(2)
    expect(s.notifications).toHaveLength(1)
  })

  it('fetchUnreadCount swallows errors silently', async () => {
    mockedApi.get.mockRejectedValueOnce(new Error('x'))
    const s = useNotificationStore()
    await s.fetchUnreadCount()
    expect(s.error).toBeNull()
  })

  it('markAsRead flips the matching row', async () => {
    mockedApi.patch.mockResolvedValueOnce({})
    const s = useNotificationStore()
    s.notifications = [makeN()] as never
    await s.markAsRead('n1')
    expect(s.notifications[0].isRead).toBe(true)
  })

  it('markAllAsRead flips every row', async () => {
    mockedApi.patch.mockResolvedValueOnce({})
    const s = useNotificationStore()
    s.notifications = [makeN({ id: 'a' }), makeN({ id: 'b' })] as never
    await s.markAllAsRead()
    expect(s.notifications.every((n: { isRead: boolean }) => n.isRead)).toBe(true)
  })

  it('removeNotification filters out the row', async () => {
    mockedApi.delete.mockResolvedValueOnce({})
    const s = useNotificationStore()
    s.notifications = [makeN({ id: 'a' }), makeN({ id: 'b' })] as never
    await s.removeNotification('a')
    expect(s.notifications.map((n: { id: string }) => n.id)).toEqual(['b'])
  })

  it('addNotification dedupes by id', () => {
    const s = useNotificationStore()
    s.addNotification(makeN({ id: 'a' }) as never)
    s.addNotification(makeN({ id: 'a' }) as never)
    expect(s.notifications).toHaveLength(1)
  })

  it('addNotification prepends to the list', () => {
    const s = useNotificationStore()
    s.notifications = [makeN({ id: 'a' })] as never
    s.addNotification(makeN({ id: 'b' }) as never)
    expect(s.notifications.map((n: { id: string }) => n.id)).toEqual(['b', 'a'])
  })

  it('startPolling fires an initial fetch and sets an interval', async () => {
    // Sequence-aware: 1st call (fetchNotifications) returns the list shape;
    // 2nd call (fetchUnreadCount fired by the timer) returns count=0 which
    // matches the current unreadCount and short-circuits without a refetch.
    mockedApi.get
      .mockResolvedValueOnce({ data: { items: [], nextCursor: null } })
      .mockResolvedValueOnce({ data: { count: 0 } })
    const s = useNotificationStore()
    s.startPolling()
    expect(mockedApi.get).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mockedApi.get).toHaveBeenCalledTimes(2)
    s.stopPolling()
  })

  it('startPolling is idempotent — second call is a no-op while a timer is set', () => {
    mockedApi.get.mockResolvedValueOnce({ data: { items: [], nextCursor: null } })
    const s = useNotificationStore()
    s.startPolling()
    s.startPolling()
    expect(mockedApi.get).toHaveBeenCalledTimes(1)
    s.stopPolling()
  })

  it('reset stops polling and clears state', () => {
    mockedApi.get.mockResolvedValue({ data: { items: [], nextCursor: null } })
    const s = useNotificationStore()
    s.startPolling()
    s.notifications = [makeN()] as never
    s.error = 'x'
    s.reset()
    expect(s.notifications).toEqual([])
    expect(s.error).toBeNull()
  })
})
