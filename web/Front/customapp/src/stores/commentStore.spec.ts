import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

import api from '@/lib/api'
import { useCommentStore } from './commentStore'
import { useAuthStore } from './authStore'

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

const baseComment = (over: Partial<{ id: string; userId: string; replies: never[] }> = {}) => ({
  id: 'c1',
  userId: 'u1',
  content: 'Hi',
  createdAt: '2026-01-01',
  updatedAt: null,
  isDeleted: false,
  parentCommentId: null,
  mentions: null,
  user: { id: 'u1', firstName: 'Ann', lastName: 'Doe' },
  replies: [],
  ...over,
})

beforeEach(() => {
  setActivePinia(createPinia())
  mockedApi.get.mockReset()
  mockedApi.post.mockReset()
  mockedApi.put.mockReset()
  mockedApi.delete.mockReset()
})

describe('commentStore', () => {
  it('initial state', () => {
    const s = useCommentStore()
    expect(s.comments).toEqual([])
    expect(s.loading).toBe(false)
    expect(s.error).toBeNull()
  })

  it('currentUserId is null when no JWT is in the authStore', () => {
    const s = useCommentStore()
    // authStore.userId is a computed off the JWT payload. With no token,
    // currentUserId proxies that null through.
    expect(s.currentUserId).toBeNull()
  })

  it('fetchComments stores rows', async () => {
    const rows = [baseComment()]
    mockedApi.get.mockResolvedValueOnce({ data: rows })
    const s = useCommentStore()
    await s.fetchComments('p1')
    expect(s.comments).toEqual(rows)
    expect(s.loading).toBe(false)
  })

  it('fetchComments error sets error.value', async () => {
    mockedApi.get.mockRejectedValueOnce(new Error('boom'))
    const s = useCommentStore()
    await s.fetchComments('p1')
    expect(s.error).toBe('boom')
  })

  it('addComment prepends to list', async () => {
    const c = baseComment({ id: 'c2' })
    mockedApi.post.mockResolvedValueOnce({ data: c })
    const s = useCommentStore()
    s.comments = [baseComment({ id: 'c1' })] as never
    await s.addComment('p1', 'hello')
    expect(s.comments[0].id).toBe('c2')
    expect(s.comments).toHaveLength(2)
  })

  it('addComment rethrows on error', async () => {
    mockedApi.post.mockRejectedValueOnce(new Error('x'))
    const s = useCommentStore()
    await expect(s.addComment('p1', 'h')).rejects.toThrow('x')
    expect(s.error).toBe('x')
  })

  it('addReply appends to the parent comment replies array', async () => {
    const parent = baseComment({ id: 'c1' })
    const reply = baseComment({ id: 'r1', parentCommentId: 'c1' } as never)
    mockedApi.post.mockResolvedValueOnce({ data: reply })
    const s = useCommentStore()
    s.comments = [parent] as never
    await s.addReply('p1', 'c1', 'reply')
    expect(s.comments[0].replies).toHaveLength(1)
    expect(s.comments[0].replies[0].id).toBe('r1')
  })

  it('editComment patches the comment AND any matching reply', async () => {
    const r = baseComment({ id: 'r1', parentCommentId: 'c1' } as never)
    const patched = { ...r, content: 'edited' }
    mockedApi.put.mockResolvedValueOnce({ data: patched })
    const s = useCommentStore()
    s.comments = [{ ...baseComment({ id: 'c1' }), replies: [r] }] as never
    await s.editComment('p1', 'r1', 'edited')
    expect(s.comments[0].replies[0].content).toBe('edited')
  })

  it('removeComment filters both top-level and replies', async () => {
    mockedApi.delete.mockResolvedValueOnce({})
    const s = useCommentStore()
    const r = baseComment({ id: 'r1' })
    s.comments = [
      { ...baseComment({ id: 'c1' }), replies: [r] },
      baseComment({ id: 'c2' }),
    ] as never
    await s.removeComment('p1', 'r1')
    expect(s.comments[0].replies).toHaveLength(0)
  })

  it('removeComment can also remove a top-level comment', async () => {
    mockedApi.delete.mockResolvedValueOnce({})
    const s = useCommentStore()
    s.comments = [baseComment({ id: 'c1' }), baseComment({ id: 'c2' })] as never
    await s.removeComment('p1', 'c1')
    expect(s.comments.map((c: { id: string }) => c.id)).toEqual(['c2'])
  })

  it('reset wipes state', () => {
    const s = useCommentStore()
    s.comments = [baseComment()] as never
    s.error = 'x'
    s.reset()
    expect(s.comments).toEqual([])
    expect(s.error).toBeNull()
  })
})
