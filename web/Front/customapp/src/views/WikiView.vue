<!-- @file src/views/WikiView.vue — Wiki tree + editor -->
<template>
  <ProjectModuleShell :project-id="id" title="Wiki">
    <template #actions>
      <NeoButton label="Nouvelle page" icon="pi pi-plus" @click="showCreate = true" />
    </template>

    <div class="wiki">
      <!-- Tree -->
      <div class="wiki__tree">
        <NeoInputText v-model="searchQ" placeholder="Rechercher..." @input="onSearch" />
        <div class="wiki__tree-list">
          <div
            v-for="page in displayedPages"
            :key="page.id"
            class="wiki__tree-item"
            :class="{ 'wiki__tree-item--active': currentSlug === page.slug }"
            @click="loadPage(page.slug)"
          >
            <i class="pi pi-file" />
            <span>{{ page.title }}</span>
          </div>
          <div v-if="!displayedPages.length" class="wiki__tree-empty">Aucune page.</div>
        </div>
      </div>

      <!-- Content -->
      <div class="wiki__content">
        <div v-if="wikiStore.currentPage">
          <div class="wiki__content-header">
            <h2>{{ wikiStore.currentPage.title }}</h2>
            <div class="wiki__content-actions">
              <NeoButton v-if="!editing" label="Éditer" icon="pi pi-pencil" outlined @click="enterEdit" />
              <NeoButton v-if="editing" label="Annuler" severity="secondary" outlined @click="cancelEdit" />
              <NeoButton v-if="editing" label="Enregistrer" icon="pi pi-check" :loading="saving" @click="savePage" />
              <NeoButton v-if="!editing" label="Supprimer" icon="pi pi-trash" severity="danger" text @click="confirmDelete" />
            </div>
          </div>

          <div v-if="!editing" class="wiki__content-body" v-html="renderedContent" />
          <div v-else class="wiki__content-edit">
            <NeoInputText v-model="editTitle" label="Titre" />
            <textarea v-model="editContent" class="wiki__editor" placeholder="Markdown..." />
          </div>

          <div class="wiki__content-meta">
            v{{ wikiStore.currentPage.version }} · Modifié {{ formatDate(wikiStore.currentPage.updatedAt) }}
          </div>
        </div>
        <div v-else class="wiki__empty">
          Sélectionnez une page ou créez-en une nouvelle.
        </div>
      </div>
    </div>

  </ProjectModuleShell>

  <AppModal v-model:visible="showCreate" header="Nouvelle page" width="480px">
      <div class="wiki__form">
        <NeoInputText v-model="newPage.title" label="Titre" placeholder="Titre de la page" />
        <textarea v-model="newPage.content" class="wiki__editor" placeholder="Contenu (Markdown)..." />
      </div>
      <template #footer>
        <NeoButton label="Annuler" severity="secondary" outlined @click="showCreate = false" />
        <NeoButton label="Créer" icon="pi pi-check" @click="submitCreate" />
      </template>
    </AppModal>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NeoButton, NeoInputText, useNeoToast, useNeoConfirm } from '@neolibrary/components'
import AppModal from '@/components/common/AppModal.vue'
import ProjectModuleShell from '@/components/common/ProjectModuleShell.vue'
import { formatDate } from '@/lib/formatDate'
import { useWikiStore } from '@/stores/wikiStore'
import type { WikiPage } from '@/stores/wikiStore'

const props = defineProps<{ id: string; slug?: string }>()
const route = useRoute()
const router = useRouter()
const toast = useNeoToast()
const confirm = useNeoConfirm()
const wikiStore = useWikiStore()

const currentSlug = ref<string | null>(props.slug ?? (route.params.slug as string) ?? null)
const editing = ref(false)
const saving = ref(false)
const showCreate = ref(false)
const searchQ = ref('')
const searchResults = ref<WikiPage[]>([])

const editTitle = ref('')
const editContent = ref('')

const newPage = reactive<{ title: string; content: string }>({ title: '', content: '' })

const displayedPages = computed(() => (searchQ.value ? searchResults.value : wikiStore.tree))

const renderedContent = computed(() => renderMarkdown(wikiStore.currentPage?.content ?? ''))

function renderMarkdown(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return escaped
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    .replace(/\n/g, '<br>')
}

async function loadPage(slug: string) {
  currentSlug.value = slug
  router.replace({ name: 'pm-wiki-page', params: { id: props.id, slug } })
  await wikiStore.fetchPage(props.id, slug)
}

function enterEdit() {
  if (!wikiStore.currentPage) return
  editTitle.value = wikiStore.currentPage.title
  editContent.value = wikiStore.currentPage.content
  editing.value = true
}

function cancelEdit() {
  editing.value = false
}

async function savePage() {
  if (!wikiStore.currentPage) return
  saving.value = true
  try {
    await wikiStore.updatePage(props.id, wikiStore.currentPage.slug, {
      title: editTitle.value,
      content: editContent.value,
    })
    editing.value = false
    toast.add({ severity: 'success', detail: 'Page enregistrée.', life: 3000 })
  } finally {
    saving.value = false
  }
}

function confirmDelete() {
  if (!wikiStore.currentPage) return
  confirm.require({
    message: 'Supprimer cette page ?',
    header: 'Confirmation',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await wikiStore.deletePage(props.id, wikiStore.currentPage!.slug)
      currentSlug.value = null
      toast.add({ severity: 'success', detail: 'Supprimée.', life: 3000 })
    },
  })
}

async function submitCreate() {
  if (!newPage.title.trim()) return
  const page = await wikiStore.createPage(props.id, { title: newPage.title.trim(), content: newPage.content })
  showCreate.value = false
  newPage.title = ''
  newPage.content = ''
  toast.add({ severity: 'success', detail: 'Page créée.', life: 3000 })
  await loadPage(page.slug)
}

let searchDebounce: ReturnType<typeof setTimeout> | null = null
function onSearch() {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(async () => {
    if (!searchQ.value) {
      searchResults.value = []
      return
    }
    searchResults.value = await wikiStore.search(props.id, searchQ.value)
  }, 300)
}

watch(() => props.slug, async (s) => {
  if (s) {
    currentSlug.value = s
    await wikiStore.fetchPage(props.id, s)
  }
})

onMounted(async () => {
  await wikiStore.fetchTree(props.id)
  if (currentSlug.value) {
    await wikiStore.fetchPage(props.id, currentSlug.value)
  }
})
</script>

<style scoped>
.wiki-view { display: flex; flex-direction: column; height: 100%; background: var(--nl-bg, #f5f7f9); }
.wiki { flex: 1; display: grid; grid-template-columns: 260px 1fr; gap: 0; overflow: hidden; }
.wiki__tree {
  background: var(--nl-card-bg, #fff);
  border-right: 1px solid var(--nl-border, #e5e7eb);
  display: flex;
  flex-direction: column;
  padding: 0.75rem;
  gap: 0.5rem;
  overflow: hidden;
}
.wiki__tree-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.wiki__tree-item {
  padding: 0.5rem 0.75rem;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
}
.wiki__tree-item:hover { background: var(--nl-bg, #f3f4f6); }
.wiki__tree-item--active { background: rgba(30,158,143,0.10); color: var(--nl-accent, #1e9e8f); font-weight: 500; }
.wiki__tree-empty { padding: 1rem; text-align: center; color: var(--nl-text-muted, #9ca3af); font-size: 0.8125rem; }

.wiki__content { padding: 1.5rem 2rem; overflow-y: auto; background: var(--nl-card-bg, #fff); }
.wiki__content-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem; gap: 1rem; }
.wiki__content-header h2 { margin: 0; font-size: 1.5rem; }
.wiki__content-actions { display: flex; gap: 0.5rem; }
.wiki__content-body { line-height: 1.6; color: var(--nl-text, #111827); }
.wiki__content-body :deep(h1) { font-size: 1.5rem; margin: 1rem 0 0.5rem; }
.wiki__content-body :deep(h2) { font-size: 1.25rem; margin: 0.75rem 0 0.5rem; }
.wiki__content-body :deep(code) { background: #f3f4f6; padding: 0.125rem 0.375rem; border-radius: 3px; font-family: monospace; font-size: 0.875rem; }
.wiki__content-edit { display: flex; flex-direction: column; gap: 0.75rem; }
.wiki__content-meta { margin-top: 2rem; font-size: 0.75rem; color: var(--nl-text-muted, #9ca3af); }
.wiki__empty { text-align: center; padding: 3rem; color: var(--nl-text-muted, #9ca3af); }

.wiki__editor {
  width: 100%;
  min-height: 300px;
  padding: 0.75rem;
  border: 1px solid var(--nl-border, #d1d5db);
  border-radius: 6px;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  font-size: 0.875rem;
  resize: vertical;
}
.wiki__form { display: flex; flex-direction: column; gap: 0.75rem; }
</style>
