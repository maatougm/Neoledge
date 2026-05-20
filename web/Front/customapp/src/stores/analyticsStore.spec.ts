import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

import api from '@/lib/api'
import { useAnalyticsStore } from './analyticsStore'

const mockedApi = api as unknown as { get: ReturnType<typeof vi.fn> }

beforeEach(() => {
  setActivePinia(createPinia())
  mockedApi.get.mockReset()
})

describe('analyticsStore', () => {
  it('initial state is empty', () => {
    const s = useAnalyticsStore()
    expect(s.phaseVelocity).toEqual([])
    expect(s.bottleneck).toEqual([])
    expect(s.deadlineRisk).toEqual([])
    expect(s.teamWorkload).toEqual([])
    expect(s.loading).toBe(false)
    expect(s.error).toBeNull()
  })

  it('fetchPhaseVelocity stores rows', async () => {
    const rows = [{ phase: 'Init', avgDays: 5, minDays: 2, maxDays: 10, projectCount: 3 }]
    mockedApi.get.mockResolvedValueOnce({ data: rows })
    const s = useAnalyticsStore()
    await s.fetchPhaseVelocity()
    expect(s.phaseVelocity).toEqual(rows)
    expect(s.phaseVelocityError).toBeNull()
  })

  it('fetchPhaseVelocity sets per-metric error AND global error, then rethrows', async () => {
    mockedApi.get.mockRejectedValueOnce(new Error('net'))
    const s = useAnalyticsStore()
    await expect(s.fetchPhaseVelocity()).rejects.toThrow('net')
    expect(s.phaseVelocityError).toBe('net')
    expect(s.error).toBe('net')
  })

  it('fetchBottleneck stores rows', async () => {
    const rows = [{ phase: 'Dev', currentCount: 2, avgDays: 4, severity: 'high' as const }]
    mockedApi.get.mockResolvedValueOnce({ data: rows })
    const s = useAnalyticsStore()
    await s.fetchBottleneck()
    expect(s.bottleneck).toEqual(rows)
  })

  it('fetchBottleneck error', async () => {
    mockedApi.get.mockRejectedValueOnce(new Error('boom'))
    const s = useAnalyticsStore()
    await expect(s.fetchBottleneck()).rejects.toThrow('boom')
    expect(s.bottleneckError).toBe('boom')
  })

  it('fetchDeadlineRisk happy path', async () => {
    const rows = [{ projectId: 'p1', projectName: 'X', status: 'Active', pmName: 'A', daysRemaining: 3, riskScore: 0.8 }]
    mockedApi.get.mockResolvedValueOnce({ data: rows })
    const s = useAnalyticsStore()
    await s.fetchDeadlineRisk()
    expect(s.deadlineRisk).toEqual(rows)
  })

  it('fetchDeadlineRisk error', async () => {
    mockedApi.get.mockRejectedValueOnce(new Error('x'))
    const s = useAnalyticsStore()
    await expect(s.fetchDeadlineRisk()).rejects.toThrow('x')
    expect(s.deadlineRiskError).toBe('x')
  })

  it('fetchTeamWorkload happy path', async () => {
    const rows = [{ pmId: 'p1', pmName: 'PM', active: 3, overdue: 1, completed: 4, upcoming: 2 }]
    mockedApi.get.mockResolvedValueOnce({ data: rows })
    const s = useAnalyticsStore()
    await s.fetchTeamWorkload()
    expect(s.teamWorkload).toEqual(rows)
  })

  it('fetchTeamWorkload error', async () => {
    mockedApi.get.mockRejectedValueOnce(new Error('y'))
    const s = useAnalyticsStore()
    await expect(s.fetchTeamWorkload()).rejects.toThrow('y')
    expect(s.teamWorkloadError).toBe('y')
  })

  it('fetchAll runs all 4 with allSettled — partial failures still fill the others', async () => {
    mockedApi.get
      .mockResolvedValueOnce({ data: [{ phase: 'P', avgDays: 1, minDays: 1, maxDays: 1, projectCount: 1 }] })
      .mockRejectedValueOnce(new Error('bottleneck-down'))
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
    const s = useAnalyticsStore()
    await s.fetchAll()
    expect(s.phaseVelocity).toHaveLength(1)
    expect(s.bottleneck).toEqual([])
    expect(s.error).toBe('bottleneck-down')
    expect(s.loading).toBe(false)
  })

  it('fetchAll happy path clears global error', async () => {
    mockedApi.get.mockResolvedValue({ data: [] })
    const s = useAnalyticsStore()
    s.error = 'prev'
    await s.fetchAll()
    expect(s.error).toBeNull()
  })

  it('reset wipes every field', () => {
    const s = useAnalyticsStore()
    s.phaseVelocity = [{} as never]
    s.bottleneck = [{} as never]
    s.deadlineRisk = [{} as never]
    s.teamWorkload = [{} as never]
    s.error = 'x'
    s.phaseVelocityError = 'x'
    s.reset()
    expect(s.phaseVelocity).toEqual([])
    expect(s.bottleneck).toEqual([])
    expect(s.deadlineRisk).toEqual([])
    expect(s.teamWorkload).toEqual([])
    expect(s.error).toBeNull()
    expect(s.phaseVelocityError).toBeNull()
  })
})
