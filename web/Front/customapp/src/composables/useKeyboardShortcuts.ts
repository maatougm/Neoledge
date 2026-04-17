/**
 * @file src/composables/useKeyboardShortcuts.ts
 * @desc Global keyboard shortcuts. Composable pattern — call once from AppShell.
 *
 * Shortcuts:
 *   ?        → Show help dialog
 *   /        → Focus global search
 *   c        → Create work package (when on /workpackages)
 *   g g      → Go to Gantt
 *   g b      → Go to Board
 *   g w      → Go to Wiki
 *   g t      → Go to Time
 *   g l      → Go to Project list (admin) / My projects (PM)
 *
 * Ignored when the focused element is an input, textarea, or contentEditable.
 */

import { onMounted, onUnmounted, ref, type Ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'

const IGNORED_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (IGNORED_TAGS.has(target.tagName)) return true
  if (target.isContentEditable) return true
  return false
}

export interface KeyboardShortcutState {
  helpVisible: Ref<boolean>
  searchVisible: Ref<boolean>
}

export function useKeyboardShortcuts(): KeyboardShortcutState {
  const router = useRouter()
  const route = useRoute()

  const helpVisible = ref<boolean>(false)
  const searchVisible = ref<boolean>(false)
  let pendingG = false
  let pendingGTimer: ReturnType<typeof setTimeout> | null = null

  function projectId(): string | null {
    const id = route.params.id
    return typeof id === 'string' ? id : null
  }

  function goTo(path: string) {
    router.push(path).catch(() => {})
  }

  function clearPendingG() {
    pendingG = false
    if (pendingGTimer) { clearTimeout(pendingGTimer); pendingGTimer = null }
  }

  function handleKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) {
      // Ctrl+K / Cmd+K → global search
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchVisible.value = true
      }
      return
    }
    if (isTypingTarget(e.target)) return

    const k = e.key

    // Second key of a "g _" sequence
    if (pendingG) {
      clearPendingG()
      const pid = projectId()
      if (!pid) return
      const base = `/app/pm/projects/${pid}`
      switch (k.toLowerCase()) {
        case 'g': goTo(`${base}/gantt`); e.preventDefault(); return
        case 'b': goTo(`${base}/board`); e.preventDefault(); return
        case 'w': goTo(`${base}/wiki`); e.preventDefault(); return
        case 't': goTo(`${base}/time`); e.preventDefault(); return
        case 'p': goTo(`${base}`); e.preventDefault(); return
        case 'u': goTo(`${base}/budget`); e.preventDefault(); return
        case 'l': goTo('/app/pm/projects'); e.preventDefault(); return
      }
      return
    }

    switch (k) {
      case '?':
        e.preventDefault()
        helpVisible.value = !helpVisible.value
        return
      case '/':
        e.preventDefault()
        searchVisible.value = true
        return
      case 'g':
        pendingG = true
        pendingGTimer = setTimeout(clearPendingG, 800)
        return
      case 'c':
        if (route.name === 'pm-workpackages') {
          // Dispatch a custom event — WorkPackagesView listens for this.
          window.dispatchEvent(new CustomEvent('neoleadge:create-wp'))
          e.preventDefault()
        }
        return
      case 'Escape':
        helpVisible.value = false
        searchVisible.value = false
        return
    }
  }

  onMounted(() => window.addEventListener('keydown', handleKey))
  onUnmounted(() => {
    window.removeEventListener('keydown', handleKey)
    clearPendingG()
  })

  return { helpVisible, searchVisible }
}
