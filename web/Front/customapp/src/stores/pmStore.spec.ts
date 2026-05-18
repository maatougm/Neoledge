import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

import api from '@/lib/api'
import { usePmStore } from './pmStore'
import { _clearHandlers } from './logoutBus'

const mockedApi = api as unknown as Record<'get' | 'post' | 'put' | 'patch' | 'delete', ReturnType<typeof vi.fn>>

beforeEach(() => {
  setActivePinia(createPinia())
  _clearHandlers()
  for (const m of Object.values(mockedApi)) m.mockReset()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('pmStore', () => {
  it('starts empty + view=mine', () => {
    const s = usePmStore()
    expect(s.myProjects).toEqual([])
    expect(s.teamProjects).toEqual([])
    expect(s.projectsView).toBe('mine')
    expect(s.projects).toEqual([])
  })

  describe('fetchMyProjects / fetchTeamProjects', () => {
    it('fetchMyProjects fills myProjects + flips view to mine', async () => {
      mockedApi.get.mockResolvedValue({ data: [{ id: 'p1' }, { id: 'p2' }] })
      const s = usePmStore()
      await s.fetchMyProjects()
      expect(s.myProjects).toHaveLength(2)
      expect(s.projectsView).toBe('mine')
      expect(s.projects).toHaveLength(2)
    })

    it('fetchTeamProjects fills teamProjects + flips view to team', async () => {
      mockedApi.get.mockResolvedValue({ data: [{ id: 'p1' }] })
      const s = usePmStore()
      await s.fetchTeamProjects()
      expect(s.teamProjects).toHaveLength(1)
      expect(s.projectsView).toBe('team')
      expect(s.projects).toEqual(s.teamProjects)
    })

    it('captures error on failure', async () => {
      mockedApi.get.mockRejectedValue(new Error('500'))
      const s = usePmStore()
      await s.fetchMyProjects()
      expect(s.error).toBe('500')
    })
  })

  describe('fetchProject', () => {
    it('parallel-loads detail + validations', async () => {
      mockedApi.get
        .mockResolvedValueOnce({ data: { id: 'p1', name: 'Proj' } })
        .mockResolvedValueOnce({ data: [{ id: 'v1' }] })
      const s = usePmStore()
      await s.fetchProject('p1')
      expect(s.currentProject?.id).toBe('p1')
      expect(s.validations).toHaveLength(1)
    })
  })

  describe('saveQuestionnaire', () => {
    it('returns true on success', async () => {
      mockedApi.patch.mockResolvedValue({ data: undefined })
      const s = usePmStore()
      const r = await s.saveQuestionnaire('p1', { fieldValues: [] } as never)
      expect(r).toBe(true)
    })

    it('returns false + sets error on failure', async () => {
      mockedApi.patch.mockRejectedValue(new Error('400'))
      const s = usePmStore()
      const r = await s.saveQuestionnaire('p1', {} as never)
      expect(r).toBe(false)
      expect(s.error).toBe('400')
    })
  })

  describe('submitValidation', () => {
    it('prepends new validation to the list', async () => {
      mockedApi.post.mockResolvedValue({ data: { id: 'v-new' } })
      const s = usePmStore()
      s.validations = [{ id: 'v1' } as never]
      const r = await s.submitValidation('p1', {} as never)
      expect(r).toBe(true)
      expect(s.validations.map((v) => v.id)).toEqual(['v-new', 'v1'])
    })
  })

  describe('fetchActivity / fetchMeetings (silent failures)', () => {
    it('fetchActivity resets to [] on failure', async () => {
      mockedApi.get.mockRejectedValue(new Error('no'))
      const s = usePmStore()
      s.activities = [{ id: 'a1' } as never]
      await s.fetchActivity('p1')
      expect(s.activities).toEqual([])
    })

    it('fetchMeetings resets to [] on failure', async () => {
      mockedApi.get.mockRejectedValue(new Error('no'))
      const s = usePmStore()
      s.meetings = [{ id: 'm1' } as never]
      await s.fetchMeetings('p1')
      expect(s.meetings).toEqual([])
    })
  })

  describe('deleteMeeting', () => {
    it('removes meeting + returns true', async () => {
      mockedApi.delete.mockResolvedValue({ data: undefined })
      const s = usePmStore()
      s.meetings = [{ id: 'm1' } as never, { id: 'm2' } as never]
      const r = await s.deleteMeeting('p1', 'm1')
      expect(r).toBe(true)
      expect(s.meetings.map((m) => m.id)).toEqual(['m2'])
    })

    it('returns false on failure', async () => {
      mockedApi.delete.mockRejectedValue(new Error('no'))
      const s = usePmStore()
      const r = await s.deleteMeeting('p1', 'm1')
      expect(r).toBe(false)
      expect(s.error).toBe('no')
    })
  })

  describe('AI polling', () => {
    it('triggerAiAnalysis sets processing then polls every 5s', async () => {
      mockedApi.post.mockResolvedValue({ data: undefined })
      mockedApi.get.mockResolvedValue({ data: { aiStatus: 'processing', actionItems: [], decisions: [] } })
      const s = usePmStore()
      await s.triggerAiAnalysis('p1', 'm1')
      expect(s.aiResults?.aiStatus).toBe('processing')
      // Tick once → polling fires
      vi.advanceTimersByTime(5000)
      await Promise.resolve()
      expect(mockedApi.get).toHaveBeenCalled()
    })

    it('fetchAiResults stops polling on terminal status', async () => {
      const s = usePmStore()
      // Arm a polling interval first
      mockedApi.get.mockResolvedValue({ data: { aiStatus: 'processing', actionItems: [], decisions: [] } })
      s.resumeAiPolling('p1', 'm1')
      // Now respond with completed
      mockedApi.get.mockResolvedValueOnce({ data: { aiStatus: 'completed', actionItems: [], decisions: [] } })
      await s.fetchAiResults('p1', 'm1')
      expect(s.aiResults?.aiStatus).toBe('completed')
      // No further calls after stopAiPolling
      const callsBefore = mockedApi.get.mock.calls.length
      vi.advanceTimersByTime(5000)
      expect(mockedApi.get.mock.calls.length).toBe(callsBefore)
    })

    it('stopAiPolling clears the interval', () => {
      const s = usePmStore()
      mockedApi.get.mockResolvedValue({ data: { aiStatus: 'processing', actionItems: [], decisions: [] } })
      s.resumeAiPolling('p1', 'm1')
      s.stopAiPolling()
      const before = mockedApi.get.mock.calls.length
      vi.advanceTimersByTime(10_000)
      expect(mockedApi.get.mock.calls.length).toBe(before)
    })
  })

  describe('renameSpeaker', () => {
    it('updates segments of the current transcript', async () => {
      mockedApi.patch.mockResolvedValue({ data: undefined })
      const s = usePmStore()
      s.currentTranscript = {
        id: 'm1',
        segments: [
          { speaker: 'A', text: 'x' },
          { speaker: 'B', text: 'y' },
        ],
      } as never
      const r = await s.renameSpeaker('p1', 'm1', 'A', 'Alice')
      expect(r).toBe(true)
      expect(s.currentTranscript?.segments[0].speaker).toBe('Alice')
      expect(s.currentTranscript?.segments[1].speaker).toBe('B')
    })
  })

  describe('clearCurrent / reset', () => {
    it('clearCurrent wipes only the current project + validations', () => {
      const s = usePmStore()
      s.currentProject = { id: 'p1' } as never
      s.validations = [{ id: 'v1' } as never]
      s.myProjects = [{ id: 'p1' } as never]
      s.clearCurrent()
      expect(s.currentProject).toBeNull()
      expect(s.validations).toEqual([])
      expect(s.myProjects).toHaveLength(1)
    })

    it('reset wipes everything + stops polling', () => {
      const s = usePmStore()
      mockedApi.get.mockResolvedValue({ data: { aiStatus: 'processing', actionItems: [], decisions: [] } })
      s.resumeAiPolling('p1', 'm1')
      s.myProjects = [{ id: 'p1' } as never]
      s.aiResults = { aiStatus: 'processing' } as never
      s.reset()
      expect(s.myProjects).toEqual([])
      expect(s.aiResults).toBeNull()
      const before = mockedApi.get.mock.calls.length
      vi.advanceTimersByTime(10_000)
      expect(mockedApi.get.mock.calls.length).toBe(before)
    })
  })
})
