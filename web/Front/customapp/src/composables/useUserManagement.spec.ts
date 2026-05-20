/**
 * @file useUserManagement.spec.ts
 * Tests the user-management composable: dialog state, CRUD handlers,
 * confirmation flow for deactivate / delete, and the 30 s auto-hide
 * on the temp-password reveal.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const toastAddSpy = vi.fn()
let lastConfirmOpts: { accept?: () => void; reject?: () => void } = {}
const confirmRequireSpy = vi.fn((opts: { accept?: () => void; reject?: () => void }) => {
  lastConfirmOpts = opts
})

vi.mock('@neolibrary/components', () => ({
  useNeoToast: () => ({ add: toastAddSpy }),
  useNeoConfirm: () => ({ require: confirmRequireSpy }),
}))

const fetchAllSpy = vi.fn()
const createUserSpy = vi.fn()
const updateUserSpy = vi.fn()
const resetPasswordSpy = vi.fn()
const deactivateSpy = vi.fn()
const reactivateSpy = vi.fn()
const deleteUserSpy = vi.fn()
const storeState = { error: null as string | null }

vi.mock('@/stores/userStore', () => ({
  useUserStore: () => ({
    fetchAll: fetchAllSpy,
    createUser: createUserSpy,
    updateUser: updateUserSpy,
    resetPassword: resetPasswordSpy,
    deactivateUser: deactivateSpy,
    reactivateUser: reactivateSpy,
    deleteUser: deleteUserSpy,
    get error() { return storeState.error },
  }),
}))

import { useUserManagement } from './useUserManagement'

interface HostExposed {
  store: unknown
  showCreateDialog: boolean
  showEditDialog: boolean
  editingUser: { id: string; firstName: string; lastName: string; email: string } | null
  tempPassword: string | null
  showTempPasswordDialog: boolean
  openCreate: () => void
  openEdit: (u: { id: string; firstName: string; lastName: string; email: string }) => void
  handleCreate: (p: object) => Promise<void>
  handleUpdate: (id: string, p: object) => Promise<void>
  handleResetPassword: (id: string) => Promise<void>
  handleDeactivate: (u: { id: string; firstName: string; lastName: string; email: string }) => void
  handleReactivate: (id: string) => Promise<void>
  handleDelete: (u: { id: string; firstName: string; lastName: string; email: string }) => void
}

function mountHost(): VueWrapper<HostExposed> {
  const Host = defineComponent({
    setup() {
      return useUserManagement()
    },
    render() { return h('div') },
  })
  return mount(Host) as unknown as VueWrapper<HostExposed>
}

const mockUser = { id: 'u1', firstName: 'Alice', lastName: 'Doe', email: 'alice@x.com' }

describe('useUserManagement', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    toastAddSpy.mockReset()
    confirmRequireSpy.mockClear()
    fetchAllSpy.mockReset()
    createUserSpy.mockReset()
    updateUserSpy.mockReset()
    resetPasswordSpy.mockReset()
    deactivateSpy.mockReset()
    reactivateSpy.mockReset()
    deleteUserSpy.mockReset()
    storeState.error = null
    lastConfirmOpts = {}
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fetches the user list on mount', () => {
    mountHost()
    expect(fetchAllSpy).toHaveBeenCalled()
  })

  it('openCreate / openEdit toggle the dialog refs', () => {
    const wrapper = mountHost()
    expect(wrapper.vm.showCreateDialog).toBe(false)
    wrapper.vm.openCreate()
    expect(wrapper.vm.showCreateDialog).toBe(true)

    wrapper.vm.openEdit(mockUser)
    expect(wrapper.vm.showEditDialog).toBe(true)
    expect(wrapper.vm.editingUser?.email).toBe('alice@x.com')
  })

  describe('handleCreate', () => {
    it('emits success toast + closes dialog when store returns the new row', async () => {
      const wrapper = mountHost()
      createUserSpy.mockResolvedValueOnce(mockUser)
      wrapper.vm.showCreateDialog = true
      await wrapper.vm.handleCreate({ firstName: 'Alice' })
      expect(toastAddSpy).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'success' }),
      )
      expect(wrapper.vm.showCreateDialog).toBe(false)
    })

    it('emits error toast when store returns null', async () => {
      const wrapper = mountHost()
      createUserSpy.mockResolvedValueOnce(null)
      storeState.error = 'duplicate'
      await wrapper.vm.handleCreate({ firstName: 'Alice' })
      expect(toastAddSpy).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error', detail: 'duplicate' }),
      )
    })
  })

  describe('handleUpdate', () => {
    it('emits success toast + closes the edit dialog', async () => {
      const wrapper = mountHost()
      wrapper.vm.editingUser = mockUser
      wrapper.vm.showEditDialog = true
      updateUserSpy.mockResolvedValueOnce(mockUser)
      await wrapper.vm.handleUpdate('u1', { firstName: 'Alice2' })
      expect(toastAddSpy).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'success' }),
      )
      expect(wrapper.vm.showEditDialog).toBe(false)
      expect(wrapper.vm.editingUser).toBeNull()
    })
  })

  describe('handleResetPassword', () => {
    it('shows the temp-password dialog when store returns a password', async () => {
      vi.useFakeTimers()
      const wrapper = mountHost()
      resetPasswordSpy.mockResolvedValueOnce('Temp@123')
      await wrapper.vm.handleResetPassword('u1')
      expect(wrapper.vm.tempPassword).toBe('Temp@123')
      expect(wrapper.vm.showTempPasswordDialog).toBe(true)
    })

    it('auto-hides the temp-password dialog after 30 s', async () => {
      vi.useFakeTimers()
      const wrapper = mountHost()
      resetPasswordSpy.mockResolvedValueOnce('Temp@123')
      await wrapper.vm.handleResetPassword('u1')
      expect(wrapper.vm.showTempPasswordDialog).toBe(true)
      vi.advanceTimersByTime(30_000)
      expect(wrapper.vm.showTempPasswordDialog).toBe(false)
      expect(wrapper.vm.tempPassword).toBeNull()
    })

    it('emits error toast when store returns null', async () => {
      const wrapper = mountHost()
      resetPasswordSpy.mockResolvedValueOnce(null)
      storeState.error = 'denied'
      await wrapper.vm.handleResetPassword('u1')
      expect(toastAddSpy).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error' }),
      )
    })
  })

  describe('handleDeactivate (confirmation dialog)', () => {
    it('shows confirm, then on accept calls store.deactivateUser and toasts success', async () => {
      const wrapper = mountHost()
      wrapper.vm.handleDeactivate(mockUser)
      expect(confirmRequireSpy).toHaveBeenCalled()
      expect(lastConfirmOpts.accept).toBeDefined()

      deactivateSpy.mockResolvedValueOnce(undefined)
      lastConfirmOpts.accept?.()
      // Wait for the async callback inside `accept` to settle.
      await new Promise((r) => setTimeout(r, 0))
      expect(deactivateSpy).toHaveBeenCalledWith('u1')
      expect(toastAddSpy).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'success' }),
      )
    })

    it('toasts error when store sets error during deactivate', async () => {
      const wrapper = mountHost()
      wrapper.vm.handleDeactivate(mockUser)
      storeState.error = 'fail'
      deactivateSpy.mockResolvedValueOnce(undefined)
      lastConfirmOpts.accept?.()
      await new Promise((r) => setTimeout(r, 0))
      expect(toastAddSpy).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error', detail: 'fail' }),
      )
    })
  })

  describe('handleDelete (confirmation dialog)', () => {
    it('shows confirm, on accept calls deleteUser and toasts success', async () => {
      const wrapper = mountHost()
      wrapper.vm.handleDelete(mockUser)
      expect(confirmRequireSpy).toHaveBeenCalled()
      deleteUserSpy.mockResolvedValueOnce(true)
      lastConfirmOpts.accept?.()
      await new Promise((r) => setTimeout(r, 0))
      expect(deleteUserSpy).toHaveBeenCalledWith('u1')
      expect(toastAddSpy).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'success' }),
      )
    })

    it('toasts error when deleteUser returns false', async () => {
      const wrapper = mountHost()
      wrapper.vm.handleDelete(mockUser)
      storeState.error = 'orphans exist'
      deleteUserSpy.mockResolvedValueOnce(false)
      lastConfirmOpts.accept?.()
      await new Promise((r) => setTimeout(r, 0))
      expect(toastAddSpy).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error', detail: 'orphans exist' }),
      )
    })
  })

  describe('handleReactivate', () => {
    it('toasts success on no-error path', async () => {
      const wrapper = mountHost()
      reactivateSpy.mockResolvedValueOnce(undefined)
      await wrapper.vm.handleReactivate('u1')
      expect(toastAddSpy).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'success' }),
      )
    })

    it('toasts error when store sets error', async () => {
      const wrapper = mountHost()
      storeState.error = 'nope'
      reactivateSpy.mockResolvedValueOnce(undefined)
      await wrapper.vm.handleReactivate('u1')
      expect(toastAddSpy).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error' }),
      )
    })
  })
})
