import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/lib/api'

export interface ProposedTask {
  title: string
  description: string
  type: 'Task' | 'Feature' | 'Bug'
  priority: 'Low' | 'Normal' | 'High' | 'Critical'
  estimatedHours: number
  /** Stable client-side ID for v-for keys; assigned at fetch/addTask time. */
  _uid?: string
}

export interface ProposedEpic {
  title: string
  description: string
  priority: 'Low' | 'Normal' | 'High' | 'Critical'
  estimatedHours: number
  children: ProposedTask[]
  /** Stable client-side ID for v-for keys; assigned at fetch time. */
  _uid?: string
}

export interface ProposedBacklog {
  epics: ProposedEpic[]
}

export const useBacklogGeneratorStore = defineStore('backlogGenerator', () => {
  const proposed = ref<ProposedBacklog | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const accepted = ref(false)

  function _errMsg(err: unknown): string {
    if (err && typeof err === 'object' && 'response' in err) {
      const r = (err as { response?: { data?: { message?: string } } }).response
      if (r?.data?.message) return r.data.message
    }
    return err instanceof Error ? err.message : String(err)
  }

  async function generate(projectId: string): Promise<void> {
    loading.value = true
    error.value = null
    accepted.value = false
    try {
      // Backlog generation takes ~1-2 min. Run it as a background job and poll,
      // instead of a single long blocking request that times out / feels hung.
      const { data: started } = await api.post<{ jobId: string }>(
        `/pm/projects/${projectId}/ai/generate-backlog-async`,
      )
      const jobId = started.jobId
      const deadline = Date.now() + 180_000
      let result: ProposedBacklog | null = null
      while (Date.now() < deadline) {
        const { data: job } = await api.get<{ status: string; result?: ProposedBacklog; error?: string }>(
          `/pm/projects/${projectId}/ai/backlog-jobs/${jobId}`,
        )
        if (job.status === 'done') {
          result = job.result ?? { epics: [] }
          break
        }
        if (job.status === 'error') {
          throw new Error(job.error || 'Échec de la génération du backlog.')
        }
        await new Promise((r) => setTimeout(r, 2500))
      }
      if (!result) throw new Error('La génération a expiré. Veuillez réessayer.')
      // Inject a stable client-side `_uid` on every epic and task so v-for keys
      // remain valid across edits / removes (otherwise array-index keys cause Vue
      // to rebind inputs to the wrong card after a delete in the middle).
      proposed.value = {
        epics: (result.epics ?? []).map((e) => ({
          ...e,
          _uid: crypto.randomUUID(),
          children: (e.children ?? []).map((t) => ({ ...t, _uid: crypto.randomUUID() })),
        })),
      }
    } catch (err) {
      error.value = _errMsg(err)
      proposed.value = null
    } finally {
      loading.value = false
    }
  }

  async function accept(projectId: string): Promise<{ created: number }> {
    if (!proposed.value) throw new Error('Aucun backlog à accepter')
    if (accepted.value) throw new Error('Ce backlog a déjà été accepté — régénérez avant de réessayer.')
    error.value = null
    try {
      const { data } = await api.post<{ created: number }>(
        `/pm/projects/${projectId}/ai/accept-backlog`,
        proposed.value,
      )
      accepted.value = true
      return data
    } catch (err) {
      error.value = _errMsg(err)
      throw err
    }
  }

  function updateEpic(epicIdx: number, patch: Partial<ProposedEpic>): void {
    if (!proposed.value) return
    proposed.value = {
      epics: proposed.value.epics.map((e, i) => (i === epicIdx ? { ...e, ...patch } : e)),
    }
  }

  function updateTask(epicIdx: number, taskIdx: number, patch: Partial<ProposedTask>): void {
    if (!proposed.value) return
    proposed.value = {
      epics: proposed.value.epics.map((e, i) => {
        if (i !== epicIdx) return e
        return {
          ...e,
          children: e.children.map((t, ti) => (ti === taskIdx ? { ...t, ...patch } : t)),
        }
      }),
    }
  }

  function removeEpic(epicIdx: number): void {
    if (!proposed.value) return
    proposed.value = { epics: proposed.value.epics.filter((_, i) => i !== epicIdx) }
  }

  function removeTask(epicIdx: number, taskIdx: number): void {
    if (!proposed.value) return
    proposed.value = {
      epics: proposed.value.epics.map((e, i) => {
        if (i !== epicIdx) return e
        return { ...e, children: e.children.filter((_, ti) => ti !== taskIdx) }
      }),
    }
  }

  function addTask(epicIdx: number): void {
    if (!proposed.value) return
    const newTask: ProposedTask = {
      title: 'Nouvelle tâche',
      description: '',
      type: 'Task',
      priority: 'Normal',
      estimatedHours: 4,
      _uid: crypto.randomUUID(),
    }
    proposed.value = {
      epics: proposed.value.epics.map((e, i) =>
        i === epicIdx ? { ...e, children: [...e.children, newTask] } : e,
      ),
    }
  }

  function reset(): void {
    proposed.value = null
    loading.value = false
    error.value = null
    accepted.value = false
  }

  return {
    proposed,
    loading,
    error,
    accepted,
    generate,
    accept,
    updateEpic,
    updateTask,
    removeEpic,
    removeTask,
    addTask,
    reset,
  }
})
