<!-- @file AppSearchModal.vue — Global Ctrl+K omnibox -->
<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="search-scrim" @mousedown.self="close">
        <div class="search-box" role="dialog" aria-modal="true" aria-label="Recherche globale">
          <div class="search-input-wrap">
            <i class="pi pi-search search-icon" />
            <input
              ref="inputRef"
              v-model="query"
              class="search-input"
              type="text"
              placeholder="Rechercher projets, work packages, wiki, utilisateurs…"
              @input="debouncedSearch"
              @keydown.down.prevent="moveSel(1)"
              @keydown.up.prevent="moveSel(-1)"
              @keydown.enter.prevent="openSelected"
              @keydown.esc="close"
            />
            <kbd class="search-hint">Esc</kbd>
          </div>

          <div class="search-results" v-if="query.length >= 2">
            <div v-if="loading" class="search-state">Recherche…</div>
            <div v-else-if="hits.length === 0" class="search-state">Aucun résultat.</div>
            <ul v-else class="search-list">
              <li
                v-for="(hit, idx) in hits"
                :key="`${hit.type}-${hit.id}`"
                class="search-item"
                :class="{ 'search-item--active': idx === selIdx }"
                @mouseenter="selIdx = idx"
                @click="openHit(hit)"
              >
                <i :class="['pi', iconFor(hit.type), 'search-item__icon']" />
                <div class="search-item__body">
                  <div class="search-item__title">{{ hit.title }}</div>
                  <div v-if="hit.subtitle" class="search-item__subtitle">{{ hit.subtitle }}</div>
                </div>
                <span class="search-item__type">{{ typeLabel(hit.type) }}</span>
              </li>
            </ul>
          </div>
          <div v-else class="search-hint-row">
            <kbd>↑</kbd><kbd>↓</kbd> naviguer · <kbd>Entrée</kbd> ouvrir · <kbd>Esc</kbd> fermer
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/lib/api'

interface SearchHit {
  type: 'project' | 'work_package' | 'wiki_page' | 'user'
  id: string
  title: string
  subtitle?: string
  link: string
}

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ (e: 'update:visible', v: boolean): void }>()

const router = useRouter()
const inputRef = ref<HTMLInputElement | null>(null)
const query = ref('')
const hits = ref<SearchHit[]>([])
const selIdx = ref(0)
const loading = ref(false)

let debounceTimer: ReturnType<typeof setTimeout> | null = null

watch(() => props.visible, async (v) => {
  if (v) {
    await nextTick()
    inputRef.value?.focus()
    inputRef.value?.select()
  } else {
    query.value = ''
    hits.value = []
    selIdx.value = 0
  }
})

function close() { emit('update:visible', false) }

function debouncedSearch() {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (query.value.length < 2) { hits.value = []; return }
  debounceTimer = setTimeout(async () => {
    loading.value = true
    try {
      const { data } = await api.get<SearchHit[]>(`/api/search?q=${encodeURIComponent(query.value)}`)
      hits.value = data
      selIdx.value = 0
    } catch {
      hits.value = []
    } finally {
      loading.value = false
    }
  }, 180)
}

function moveSel(delta: number) {
  if (hits.value.length === 0) return
  selIdx.value = (selIdx.value + delta + hits.value.length) % hits.value.length
}

function openSelected() {
  const hit = hits.value[selIdx.value]
  if (hit) openHit(hit)
}

function openHit(hit: SearchHit) {
  if (hit.link) router.push(hit.link).catch(() => {})
  close()
}

const TYPE_LABEL: Record<SearchHit['type'], string> = {
  project: 'Projet',
  work_package: 'Work Package',
  wiki_page: 'Wiki',
  user: 'Utilisateur',
}
function typeLabel(t: SearchHit['type']): string { return TYPE_LABEL[t] }

function iconFor(t: SearchHit['type']): string {
  switch (t) {
    case 'project': return 'pi-briefcase'
    case 'work_package': return 'pi-list'
    case 'wiki_page': return 'pi-book'
    case 'user': return 'pi-user'
  }
}
</script>

<style scoped>
.search-scrim {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: 10vh;
  z-index: 1100;
}
.search-box {
  background: var(--nl-card-bg, #fff);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  width: min(640px, 90vw);
  max-height: 70vh;
  display: flex; flex-direction: column;
  overflow: hidden;
}
.search-input-wrap {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.875rem 1rem;
  border-bottom: 1px solid var(--nl-border, #e5e7eb);
}
.search-icon { color: var(--nl-text-muted, #9ca3af); font-size: 1rem; }
.search-input {
  flex: 1; border: none; outline: none;
  font-size: 0.9375rem;
  background: transparent;
  color: var(--nl-text, #111827);
}
.search-hint {
  padding: 0.125rem 0.5rem;
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 4px;
  font-family: 'SF Mono', Consolas, monospace;
  font-size: 0.6875rem;
  color: var(--nl-text-muted, #9ca3af);
  background: var(--nl-surface-2, #f3f4f6);
}
.search-results { overflow-y: auto; max-height: 50vh; }
.search-state { padding: 2rem; text-align: center; color: var(--nl-text-muted, #9ca3af); }
.search-list { list-style: none; padding: 0.25rem; margin: 0; }
.search-item {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  cursor: pointer;
}
.search-item--active, .search-item:hover { background: var(--nl-surface-2, rgba(30,158,143,0.08)); }
.search-item__icon { color: var(--nl-accent, #1e9e8f); width: 20px; text-align: center; }
.search-item__body { flex: 1; min-width: 0; }
.search-item__title { font-weight: 500; font-size: 0.875rem; color: var(--nl-text, #111827); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.search-item__subtitle { font-size: 0.75rem; color: var(--nl-text-muted, #6b7280); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.search-item__type {
  font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--nl-text-muted, #9ca3af);
  padding: 0.125rem 0.5rem;
  background: var(--nl-surface-2, #f3f4f6);
  border-radius: 4px;
  flex-shrink: 0;
}
.search-hint-row {
  padding: 0.75rem 1rem;
  font-size: 0.75rem;
  color: var(--nl-text-muted, #9ca3af);
  border-top: 1px solid var(--nl-border, #e5e7eb);
  text-align: center;
}
.search-hint-row kbd {
  display: inline-block;
  padding: 0.0625rem 0.375rem;
  margin: 0 0.125rem;
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 3px;
  font-family: 'SF Mono', Consolas, monospace;
  font-size: 0.6875rem;
}
.modal-enter-active, .modal-leave-active { transition: opacity 0.15s; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
</style>
