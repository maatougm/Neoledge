import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import CommentsSection from '@/components/pm/CommentsSection.vue'
import type { Comment } from '@/stores/commentStore'

// ── Mock NeoLibrary ───────────────────────────────────────────────────────────
vi.mock('@neolibrary/components', () => ({
  NeoButton: {
    name: 'NeoButton',
    template: '<button :disabled="disabled" @click="$emit(\'click\')">{{ label }}</button>',
    props: ['label', 'icon', 'loading', 'disabled', 'outlined', 'size'],
    emits: ['click'],
  },
  useNeoToast: () => ({
    add: vi.fn(),
  }),
}))

// ── Mock CommentItem to isolate CommentsSection ───────────────────────────────
vi.mock('@/components/pm/CommentItem.vue', () => ({
  default: {
    name: 'CommentItem',
    template: '<div class="comment-item-stub">{{ comment.content }}</div>',
    props: ['comment', 'currentUserId', 'isReply', 'editing', 'editDraft'],
    emits: ['reply', 'edit', 'delete', 'saveEdit', 'cancelEdit', 'update:editDraft'],
  },
}))

// ── Mock useApp ───────────────────────────────────────────────────────────────
vi.mock('@/stores/useApp', () => ({
  useApp: () => ({
    jwt: '',
    apiUrl: 'http://test-api',
  }),
}))

// ── Mock commentStore ─────────────────────────────────────────────────────────
const mockFetchComments = vi.fn()
const mockAddComment = vi.fn()

const mockComment: Comment = {
  id: 'c1',
  userId: 'u1',
  content: 'Premier commentaire',
  createdAt: new Date().toISOString(),
  updatedAt: null,
  isDeleted: false,
  parentCommentId: null,
  mentions: null,
  user: { id: 'u1', firstName: 'Alice', lastName: 'Martin' },
  replies: [],
}

vi.mock('@/stores/commentStore', () => ({
  useCommentStore: vi.fn(),
}))

const buildStoreMock = (overrides: Partial<{
  comments: Comment[]
  loading: boolean
  currentUserId: string | null
}> = {}) => ({
  comments: overrides.comments ?? [],
  loading: overrides.loading ?? false,
  error: null,
  currentUserId: overrides.currentUserId ?? 'u1',
  fetchComments: mockFetchComments,
  addComment: mockAddComment,
  addReply: vi.fn(),
  editComment: vi.fn(),
  removeComment: vi.fn(),
})

async function mountSection(storeOverrides = {}) {
  const { useCommentStore } = await import('@/stores/commentStore')
  vi.mocked(useCommentStore).mockReturnValue(buildStoreMock(storeOverrides) as ReturnType<typeof useCommentStore>)

  return mount(CommentsSection, {
    props: { projectId: 'p1' },
    global: { plugins: [createPinia()] },
  })
}

// ─────────────────────────────────────────────────────────────────────────────

describe('CommentsSection', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  // ── Renders comment list ──────────────────────────────────────────────────
  describe('when the store has comments', () => {
    it('renders a CommentItem for each root comment', async () => {
      const wrapper = await mountSection({ comments: [mockComment] })
      const stubs = wrapper.findAll('.comment-item-stub')
      expect(stubs).toHaveLength(1)
      expect(stubs[0].text()).toContain('Premier commentaire')
    })

    it('does not show the empty state', async () => {
      const wrapper = await mountSection({ comments: [mockComment] })
      expect(wrapper.find('.empty-state').exists()).toBe(false)
    })
  })

  // ── Empty state ───────────────────────────────────────────────────────────
  describe('when the store has no comments', () => {
    it('renders the empty state message', async () => {
      const wrapper = await mountSection({ comments: [] })
      expect(wrapper.find('.empty-state').exists()).toBe(true)
      expect(wrapper.find('.empty-state').text()).toContain('Aucun commentaire pour l\'instant')
    })

    it('does not render the comment list', async () => {
      const wrapper = await mountSection({ comments: [] })
      expect(wrapper.find('.comment-list').exists()).toBe(false)
    })
  })

  // ── Loading skeleton ──────────────────────────────────────────────────────
  describe('when loading is true', () => {
    it('shows the skeleton and hides the empty state', async () => {
      const wrapper = await mountSection({ loading: true, comments: [] })
      expect(wrapper.find('.skeleton-list').exists()).toBe(true)
      expect(wrapper.find('.empty-state').exists()).toBe(false)
    })
  })

  // ── Submit calls addComment ───────────────────────────────────────────────
  describe('submit behaviour', () => {
    it('calls addComment with correct projectId and content on button click', async () => {
      mockAddComment.mockResolvedValueOnce(undefined)

      const wrapper = await mountSection({ comments: [] })
      const textarea = wrapper.find('textarea')
      await textarea.setValue('Nouveau commentaire')

      const sendBtn = wrapper.find('button')
      await sendBtn.trigger('click')

      expect(mockAddComment).toHaveBeenCalledWith('p1', 'Nouveau commentaire')
    })

    it('does not call addComment when content is empty', async () => {
      const wrapper = await mountSection({ comments: [] })
      const sendBtn = wrapper.find('button')
      await sendBtn.trigger('click')
      expect(mockAddComment).not.toHaveBeenCalled()
    })

    it('clears the textarea after successful submit', async () => {
      mockAddComment.mockResolvedValueOnce(undefined)

      const wrapper = await mountSection({ comments: [] })
      const textarea = wrapper.find('textarea')
      await textarea.setValue('Un commentaire')

      await wrapper.find('button').trigger('click')
      await wrapper.vm.$nextTick()

      expect((textarea.element as HTMLTextAreaElement).value).toBe('')
    })
  })
})
