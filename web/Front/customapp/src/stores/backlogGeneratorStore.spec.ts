import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

// crypto.randomUUID deterministic per call so we can assert v-for keys.
let uuidCounter = 0
vi.stubGlobal('crypto', { randomUUID: () => `uuid-${++uuidCounter}` })

import api from '@/lib/api'
import { useBacklogGeneratorStore } from './backlogGeneratorStore'

const mockedApi = api as unknown as { post: ReturnType<typeof vi.fn> }

beforeEach(() => {
  setActivePinia(createPinia())
  mockedApi.post.mockReset()
  uuidCounter = 0
})

const epicRow = {
  title: 'Epic 1', description: 'd', priority: 'High' as const, estimatedHours: 40,
  children: [{ title: 'T1', description: 't', type: 'Feature' as const, priority: 'Normal' as const, estimatedHours: 8 }],
}

describe('backlogGeneratorStore', () => {
  it('initial state is empty', () => {
    const s = useBacklogGeneratorStore()
    expect(s.proposed).toBeNull()
    expect(s.loading).toBe(false)
    expect(s.error).toBeNull()
    expect(s.accepted).toBe(false)
  })

  it('generate populates proposed with _uid on every epic + task', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { epics: [epicRow] } })
    const s = useBacklogGeneratorStore()
    await s.generate('p1')
    expect(s.proposed).not.toBeNull()
    expect(s.proposed!.epics[0]._uid).toMatch(/^uuid-/)
    expect(s.proposed!.epics[0].children[0]._uid).toMatch(/^uuid-/)
    expect(s.loading).toBe(false)
    expect(s.error).toBeNull()
  })

  it('generate keeps proposed null + sets error on api failure', async () => {
    mockedApi.post.mockRejectedValueOnce(new Error('quota'))
    const s = useBacklogGeneratorStore()
    await s.generate('p1')
    expect(s.proposed).toBeNull()
    expect(s.error).toBe('quota')
  })

  it('generate prefers backend message when error has response.data.message', async () => {
    mockedApi.post.mockRejectedValueOnce({ response: { data: { message: 'Champs IA non remplis' } } })
    const s = useBacklogGeneratorStore()
    await s.generate('p1')
    expect(s.error).toBe('Champs IA non remplis')
  })

  it('accept throws when proposed is null', async () => {
    const s = useBacklogGeneratorStore()
    await expect(s.accept('p1')).rejects.toThrow(/Aucun backlog/)
  })

  it('accept throws when already accepted', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { epics: [epicRow] } })
    const s = useBacklogGeneratorStore()
    await s.generate('p1')
    mockedApi.post.mockResolvedValueOnce({ data: { created: 5 } })
    await s.accept('p1')
    await expect(s.accept('p1')).rejects.toThrow(/déjà été accepté/)
  })

  it('accept happy path flips accepted + returns created count', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { epics: [epicRow] } })
    const s = useBacklogGeneratorStore()
    await s.generate('p1')
    mockedApi.post.mockResolvedValueOnce({ data: { created: 7 } })
    const out = await s.accept('p1')
    expect(out).toEqual({ created: 7 })
    expect(s.accepted).toBe(true)
  })

  it('accept rethrows on api failure', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { epics: [epicRow] } })
    const s = useBacklogGeneratorStore()
    await s.generate('p1')
    mockedApi.post.mockRejectedValueOnce(new Error('persist-fail'))
    await expect(s.accept('p1')).rejects.toThrow('persist-fail')
    expect(s.accepted).toBe(false)
    expect(s.error).toBe('persist-fail')
  })

  it('updateEpic patches a single epic immutably', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { epics: [epicRow, { ...epicRow, title: 'Epic 2' }] } })
    const s = useBacklogGeneratorStore()
    await s.generate('p1')
    const before = s.proposed!
    s.updateEpic(1, { title: 'Epic 2 — renamed' })
    expect(s.proposed!.epics[1].title).toBe('Epic 2 — renamed')
    expect(s.proposed!.epics[0].title).toBe('Epic 1')
    expect(s.proposed).not.toBe(before)
  })

  it('updateEpic is no-op when proposed is null', () => {
    const s = useBacklogGeneratorStore()
    expect(() => s.updateEpic(0, { title: 'x' })).not.toThrow()
  })

  it('updateTask patches a single task immutably', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { epics: [epicRow] } })
    const s = useBacklogGeneratorStore()
    await s.generate('p1')
    s.updateTask(0, 0, { estimatedHours: 16 })
    expect(s.proposed!.epics[0].children[0].estimatedHours).toBe(16)
  })

  it('removeEpic filters out the epic', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { epics: [epicRow, { ...epicRow, title: 'Epic 2' }] } })
    const s = useBacklogGeneratorStore()
    await s.generate('p1')
    s.removeEpic(0)
    expect(s.proposed!.epics).toHaveLength(1)
    expect(s.proposed!.epics[0].title).toBe('Epic 2')
  })

  it('removeTask filters out the task in its epic', async () => {
    const e = { ...epicRow, children: [...epicRow.children, { ...epicRow.children[0], title: 'T2' }] }
    mockedApi.post.mockResolvedValueOnce({ data: { epics: [e] } })
    const s = useBacklogGeneratorStore()
    await s.generate('p1')
    s.removeTask(0, 0)
    expect(s.proposed!.epics[0].children).toHaveLength(1)
    expect(s.proposed!.epics[0].children[0].title).toBe('T2')
  })

  it('addTask appends a default-shaped task with a _uid', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { epics: [epicRow] } })
    const s = useBacklogGeneratorStore()
    await s.generate('p1')
    s.addTask(0)
    const added = s.proposed!.epics[0].children[s.proposed!.epics[0].children.length - 1]
    expect(added.title).toBe('Nouvelle tâche')
    expect(added.estimatedHours).toBe(4)
    expect(added._uid).toMatch(/^uuid-/)
  })

  it('reset clears everything', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { epics: [epicRow] } })
    const s = useBacklogGeneratorStore()
    await s.generate('p1')
    s.error = 'x'
    s.accepted = true
    s.reset()
    expect(s.proposed).toBeNull()
    expect(s.error).toBeNull()
    expect(s.accepted).toBe(false)
  })
})
