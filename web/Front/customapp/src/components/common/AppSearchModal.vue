<!-- @file AppSearchModal.vue — Global Ctrl+K command palette. -->
<template>
  <Teleport to="body">
    <Transition name="cmdk">
      <div v-if="visible" class="cmdk-scrim" @mousedown.self="close">
        <div class="cmdk-box" role="dialog" aria-modal="true" aria-label="Palette de commandes">
          <!-- Input -->
          <div class="cmdk-input-wrap">
            <i class="pi pi-search cmdk-icon" />
            <input
              ref="inputRef"
              v-model="query"
              class="cmdk-input"
              type="text"
              role="combobox"
              aria-autocomplete="list"
              aria-controls="cmdk-listbox"
              :aria-activedescendant="selIdx >= 0 ? `cmdk-option-${selIdx}` : undefined"
              :aria-expanded="flatItems.length > 0"
              placeholder="Tapez une commande ou recherchez…"
              @input="onInput"
              @keydown.down.prevent="moveSel(1)"
              @keydown.up.prevent="moveSel(-1)"
              @keydown.enter.prevent="openSelected"
              @keydown.esc="close"
            />
            <span class="nl-kbd">Esc</span>
          </div>

          <!-- Results -->
          <div id="cmdk-listbox" class="cmdk-results" role="listbox" aria-label="Résultats de recherche">
            <div v-if="loading" class="cmdk-state" aria-live="polite">Recherche…</div>
            <div v-else-if="flatItems.length === 0" class="cmdk-state" aria-live="polite">Aucun résultat.</div>
            <template v-else>
              <div v-for="group in groupedItems" :key="group.label" class="cmdk-group">
                <div class="cmdk-group-label">{{ group.label }}</div>
                <ul class="cmdk-list" role="presentation">
                  <li
                    v-for="item in group.items"
                    :id="`cmdk-option-${item._idx}`"
                    :key="item._idx"
                    role="option"
                    :aria-selected="item._idx === selIdx"
                    class="cmdk-item"
                    :class="{ 'cmdk-item--active': item._idx === selIdx }"
                    @mouseenter="selIdx = item._idx"
                    @click="openItem(item)"
                  >
                    <i :class="['pi', item.icon, 'cmdk-item__icon']" :style="item.iconColor ? { color: item.iconColor } : {}" />
                    <div class="cmdk-item__body">
                      <div class="cmdk-item__title">{{ item.title }}</div>
                      <div v-if="item.subtitle" class="cmdk-item__subtitle">{{ item.subtitle }}</div>
                    </div>
                    <span v-if="item.kbd" class="cmdk-item__kbd">
                      <span v-for="k in item.kbd.split('+')" :key="k" class="nl-kbd">{{ k }}</span>
                    </span>
                  </li>
                </ul>
              </div>
            </template>
          </div>

          <!-- Footer -->
          <div class="cmdk-foot">
            <span><span class="nl-kbd">↑</span><span class="nl-kbd">↓</span> naviguer</span>
            <span><span class="nl-kbd">↵</span> ouvrir</span>
            <span><span class="nl-kbd">Esc</span> fermer</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@/lib/api'
import { useDarkMode } from '@/composables/useDarkMode'
import { useAuthStore } from '@/stores/authStore'

type ItemKind = 'command' | 'project' | 'work_package' | 'wiki_page' | 'user' | 'recent'

interface PaletteItem {
  kind: ItemKind
  id: string
  title: string
  subtitle?: string
  icon: string
  iconColor?: string
  kbd?: string
  action?: () => void
  link?: string
  _idx: number
}

const props = defineProps<{ visible: boolean }>()
const emit  = defineEmits<{ (e: 'update:visible', v: boolean): void }>()

const route     = useRoute()
const router    = useRouter()
const authStore = useAuthStore()
const dark      = useDarkMode()

const inputRef = ref<HTMLInputElement | null>(null)
const query    = ref<string>('')
const selIdx   = ref<number>(0)
const loading  = ref<boolean>(false)
const searchHits = ref<PaletteItem[]>([])

let debounceTimer: ReturnType<typeof setTimeout> | null = null

function clearDebounce(): void {
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
}

watch(() => props.visible, async (v) => {
  if (v) {
    await nextTick()
    inputRef.value?.focus()
    inputRef.value?.select()
  } else {
    clearDebounce()
    query.value = ''
    searchHits.value = []
    selIdx.value = 0
  }
})

onUnmounted(clearDebounce)

function close(): void { emit('update:visible', false) }

function onInput(): void {
  clearDebounce()
  selIdx.value = 0  // reset selection on input change (#19)
  if (query.value.trim().length < 2) { searchHits.value = []; return }
  debounceTimer = setTimeout(runServerSearch, 180)
}

async function runServerSearch(): Promise<void> {
  loading.value = true
  try {
    interface SearchHit { type: string; id: string; title: string; subtitle?: string; link: string }
    const { data } = await api.get<SearchHit[]>(`/api/search?q=${encodeURIComponent(query.value)}`)
    searchHits.value = data.map((hit, i) => ({
      kind: hit.type as ItemKind,
      id: hit.id,
      title: hit.title,
      subtitle: hit.subtitle,
      icon: iconFor(hit.type as ItemKind),
      link: hit.link,
      _idx: i,
    }))
  } catch {
    searchHits.value = []
  } finally {
    loading.value = false
  }
}

// ── Built-in commands (always available) ───────────────────────────────────
const COMMANDS = computed<Omit<PaletteItem, '_idx'>[]>(() => {
  const isInProject = /^\/app\/pm\/projects\/[^/]+/.test(route.path)
  const projectId   = isInProject ? route.path.split('/')[4] : null
  const cmds: Omit<PaletteItem, '_idx'>[] = [
    { kind: 'command', id: 'home',   title: 'Aller à l\'accueil',     icon: 'pi-inbox',     action: () => router.push('/app') },
    { kind: 'command', id: 'projs',  title: 'Mes projets',              icon: 'pi-briefcase', action: () => router.push(authStore.userRole === 'Admin' ? '/app/admin/projects' : '/app/pm/projects') },
    { kind: 'command', id: 'tasks',  title: 'Mes tâches',               icon: 'pi-list',      action: () => router.push('/app/pm/my-tasks') },
    { kind: 'command', id: 'notif',  title: 'Notifications',            icon: 'pi-bell' },
    { kind: 'command', id: 'dark',   title: dark.isDark.value ? 'Thème clair' : 'Thème sombre', icon: dark.isDark.value ? 'pi-sun' : 'pi-moon', action: () => { void dark.toggle() } },
    { kind: 'command', id: 'prof',   title: 'Mon profil',               icon: 'pi-user',      action: () => router.push('/app/profile') },
  ]
  if (authStore.can('team_planner.view')) {
    cmds.push({ kind: 'command', id: 'planner', title: 'Planif. équipe', icon: 'pi-calendar', action: () => router.push(authStore.userRole === 'Admin' ? '/app/admin/team-planner' : '/app/pm/team-planner') })
  }
  if (isInProject && projectId) {
    const b = `/app/pm/projects/${projectId}`
    cmds.push(
      { kind: 'command', id: 'proj-wp',     title: 'Projet courant → Work Packages', icon: 'pi-list',       action: () => router.push(`${b}/workpackages`) },
      { kind: 'command', id: 'proj-gantt',  title: 'Projet courant → Gantt',         icon: 'pi-chart-bar',  action: () => router.push(`${b}/gantt`) },
      { kind: 'command', id: 'proj-board',  title: 'Projet courant → Board',         icon: 'pi-th-large',   action: () => router.push(`${b}/board`) },
      { kind: 'command', id: 'proj-wiki',   title: 'Projet courant → Wiki',          icon: 'pi-book',       action: () => router.push(`${b}/wiki`) },
    )
  }
  return cmds
})

function iconFor(t: ItemKind): string {
  switch (t) {
    case 'project':      return 'pi-briefcase'
    case 'work_package': return 'pi-list'
    case 'wiki_page':    return 'pi-book'
    case 'user':         return 'pi-user'
    case 'recent':       return 'pi-clock'
    default:             return 'pi-arrow-right'
  }
}

// ── Filter commands by query client-side; server search handles the rest ──
const filteredCommands = computed<Omit<PaletteItem, '_idx'>[]>(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return COMMANDS.value
  return COMMANDS.value.filter((c) => c.title.toLowerCase().includes(q))
})

const flatItems = computed<PaletteItem[]>(() => {
  let i = 0
  const cmds: PaletteItem[] = filteredCommands.value.map((c) => ({ ...c, _idx: i++ }))
  const hits: PaletteItem[] = searchHits.value.map((h) => ({ ...h, _idx: i++ }))
  return [...cmds, ...hits]
})

const groupedItems = computed(() => {
  const groups: { label: string; items: PaletteItem[] }[] = []
  const cmds  = flatItems.value.filter((x) => x.kind === 'command')
  const projs = flatItems.value.filter((x) => x.kind === 'project')
  const wps   = flatItems.value.filter((x) => x.kind === 'work_package')
  const wiki  = flatItems.value.filter((x) => x.kind === 'wiki_page')
  const users = flatItems.value.filter((x) => x.kind === 'user')
  if (cmds.length)  groups.push({ label: 'Commandes', items: cmds })
  if (projs.length) groups.push({ label: 'Projets', items: projs })
  if (wps.length)   groups.push({ label: 'Work Packages', items: wps })
  if (wiki.length)  groups.push({ label: 'Wiki', items: wiki })
  if (users.length) groups.push({ label: 'Utilisateurs', items: users })
  return groups
})

function moveSel(delta: number): void {
  const len = flatItems.value.length
  if (!len) return
  selIdx.value = (selIdx.value + delta + len) % len
}

function openSelected(): void {
  const item = flatItems.value[selIdx.value]
  if (item) openItem(item)
}

function openItem(item: PaletteItem): void {
  if (item.action) item.action()
  else if (item.link) router.push(item.link).catch(() => {})
  close()
}
</script>

<style scoped>
.cmdk-scrim {
  position: fixed; inset: 0;
  background: rgba(15, 15, 17, 0.55);
  backdrop-filter: blur(4px);
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: 10vh;
  /* Above UserMenu/NotificationPanel (9500) + row menus (9500), below PrimeVue overlays (10000). */
  z-index: 9800;
}
.cmdk-box {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg);
  box-shadow: var(--nl-shadow-lg);
  width: min(640px, 90vw);
  max-height: 70vh;
  display: flex; flex-direction: column;
  overflow: hidden;
}
.cmdk-input-wrap {
  display: flex; align-items: center; gap: var(--nl-sp-3);
  padding: var(--nl-sp-3) var(--nl-sp-4);
  border-bottom: 1px solid var(--nl-border);
}
.cmdk-icon { color: var(--nl-text-3); font-size: 16px; }
.cmdk-input {
  flex: 1; border: none; outline: none;
  font-size: var(--nl-fs-md);
  background: transparent; color: var(--nl-text-1);
  font-family: var(--nl-font);
}
.cmdk-input::placeholder { color: var(--nl-text-3); }

.cmdk-results { overflow-y: auto; max-height: 55vh; padding: var(--nl-sp-1); }
.cmdk-state { padding: var(--nl-sp-6); text-align: center; color: var(--nl-text-3); font-size: var(--nl-fs-sm); }
.cmdk-group { margin-bottom: var(--nl-sp-1); }
.cmdk-group-label {
  padding: var(--nl-sp-2) var(--nl-sp-3) var(--nl-sp-1);
  font-size: var(--nl-fs-xs); font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--nl-text-3);
}
.cmdk-list { list-style: none; padding: 0; margin: 0; }
.cmdk-item {
  display: flex; align-items: center; gap: var(--nl-sp-3);
  padding: var(--nl-sp-2) var(--nl-sp-3);
  border-radius: var(--nl-radius); cursor: pointer;
  transition: background 0.1s;
}
.cmdk-item--active, .cmdk-item:hover { background: var(--nl-row-hover); }
.cmdk-item__icon {
  width: 18px; text-align: center;
  color: var(--nl-text-3); font-size: 14px;
}
.cmdk-item--active .cmdk-item__icon { color: var(--nl-accent); }
.cmdk-item__body { flex: 1; min-width: 0; }
.cmdk-item__title {
  font-size: var(--nl-fs-base); font-weight: 500; color: var(--nl-text-1);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cmdk-item__subtitle {
  font-size: var(--nl-fs-sm); color: var(--nl-text-3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cmdk-item__kbd { display: flex; gap: 3px; }

.cmdk-foot {
  display: flex; justify-content: center; gap: var(--nl-sp-4);
  padding: var(--nl-sp-2) var(--nl-sp-3);
  font-size: var(--nl-fs-xs); color: var(--nl-text-3);
  border-top: 1px solid var(--nl-border);
}
.cmdk-foot > span { display: inline-flex; align-items: center; gap: 4px; }

.cmdk-enter-active, .cmdk-leave-active { transition: opacity 0.15s, transform 0.2s; }
.cmdk-enter-from, .cmdk-leave-to { opacity: 0; transform: translateY(-8px); }
</style>
