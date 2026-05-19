import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountOptions, initPinia } from '../__test-utils'
import CommentItem from './CommentItem.vue'

beforeEach(() => initPinia())

function makeComment(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'c1',
    userId: 'u1',
    content: 'hello world',
    createdAt: new Date().toISOString(),
    updatedAt: null,
    user: { firstName: 'Alice', lastName: 'Martin' },
    ...over,
  } as never
}

describe('CommentItem', () => {
  it('renders author name + content', () => {
    const w = mount(CommentItem, mountOptions({
      props: { comment: makeComment(), currentUserId: 'u-other', editing: false, editDraft: '' },
    }))
    expect(w.text()).toContain('Alice Martin')
    expect(w.text()).toContain('hello world')
  })

  it('renders initials in the avatar', () => {
    const w = mount(CommentItem, mountOptions({
      props: { comment: makeComment(), currentUserId: 'u-other', editing: false, editDraft: '' },
    }))
    expect(w.find('.comment-avatar').text()).toBe('AM')
  })

  it('falls back when user is missing', () => {
    const w = mount(CommentItem, mountOptions({
      props: {
        comment: makeComment({ user: null }),
        currentUserId: 'u-other',
        editing: false,
        editDraft: '',
      },
    }))
    expect(w.text()).toContain('Utilisateur inconnu')
    expect(w.find('.comment-avatar').text()).toBe('?')
  })

  it('shows the (modifié) tag when updatedAt is set', () => {
    const w = mount(CommentItem, mountOptions({
      props: {
        comment: makeComment({ updatedAt: new Date().toISOString() }),
        currentUserId: 'u-other',
        editing: false,
        editDraft: '',
      },
    }))
    expect(w.text()).toContain('(modifié)')
  })

  it('hides edit/delete buttons for non-owners', () => {
    const w = mount(CommentItem, mountOptions({
      props: {
        comment: makeComment({ userId: 'u-other' }),
        currentUserId: 'u-me',
        editing: false,
        editDraft: '',
      },
    }))
    expect(w.text()).not.toContain('Modifier')
    expect(w.text()).not.toContain('Supprimer')
  })

  it('shows edit/delete buttons for the owner', () => {
    const w = mount(CommentItem, mountOptions({
      props: {
        comment: makeComment({ userId: 'u-me' }),
        currentUserId: 'u-me',
        editing: false,
        editDraft: '',
      },
    }))
    expect(w.text()).toContain('Modifier')
    expect(w.text()).toContain('Supprimer')
  })

  it('hides reply button when isReply=true', () => {
    const w = mount(CommentItem, mountOptions({
      props: {
        comment: makeComment(),
        currentUserId: 'u-other',
        isReply: true,
        editing: false,
        editDraft: '',
      },
    }))
    expect(w.text()).not.toContain('Répondre')
  })

  it('emits reply event when the reply button is clicked', async () => {
    const w = mount(CommentItem, mountOptions({
      props: { comment: makeComment(), currentUserId: 'u-other', editing: false, editDraft: '' },
    }))
    const replyBtn = w.findAll('button').find((b) => b.text().includes('Répondre'))
    await replyBtn!.trigger('click')
    expect(w.emitted('reply')).toBeTruthy()
  })

  it('shows the textarea + save/cancel buttons in edit mode', () => {
    const w = mount(CommentItem, mountOptions({
      props: {
        comment: makeComment({ userId: 'u-me' }),
        currentUserId: 'u-me',
        editing: true,
        editDraft: 'updated draft',
      },
    }))
    expect(w.find('textarea').exists()).toBe(true)
    expect(w.find('textarea').element.value).toBe('updated draft')
    // Save / Cancel are rendered via NeoButton's `label` prop. The shared
    // passthroughStub forwards attrs to the wrapper div but does NOT render
    // the prop as text content, so we assert on the button stubs themselves.
    const buttons = w.findAll('[data-stub="NeoButton"]')
    const labels = buttons.map((b) => b.attributes('label'))
    expect(labels).toContain('Enregistrer')
    expect(labels).toContain('Annuler')
  })
})
