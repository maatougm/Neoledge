<!-- @file src/components/workpackages/WpCommentsPanel.vue
     Comments thread for a Work Package. Used in the task detail panel so the
     PM can read the note a Member leaves when submitting for validation, and
     either side can discuss. Posts to
     /pm/projects/:projectId/work-packages/:wpId/comments. -->
<template>
  <div class="wp-cmt">
    <div v-if="loading" class="wp-cmt__muted">Chargement…</div>
    <ul v-else-if="comments.length" class="wp-cmt__list">
      <li v-for="c in comments" :key="c.id" class="wp-cmt__row">
        <span class="wp-cmt__avatar">{{ initials(c.user) }}</span>
        <div class="wp-cmt__body">
          <div class="wp-cmt__head">
            <span class="wp-cmt__author">{{ c.user.firstName }} {{ c.user.lastName }}</span>
            <span class="wp-cmt__date">{{ formatRelative(c.createdAt) }}</span>
          </div>
          <p class="wp-cmt__text">{{ c.content }}</p>
        </div>
      </li>
    </ul>
    <div v-else class="wp-cmt__muted">Aucun commentaire.</div>

    <div class="wp-cmt__compose">
      <textarea
        v-model="draft"
        class="wp-cmt__textarea"
        rows="2"
        placeholder="Ajouter un commentaire…"
        :disabled="posting"
      />
      <NeoButton
        label="Commenter"
        icon="pi pi-send"
        size="small"
        :loading="posting"
        :disabled="!draft.trim()"
        @click="post"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { NeoButton, useNeoToast } from '@neolibrary/components'
import api, { extractErrorMessage } from '@/lib/api'
import { formatRelative } from '@/lib/formatDate'

interface CommentUser {
  id: string
  firstName: string
  lastName: string
  email?: string
  avatarPath?: string | null
}
interface WpComment {
  id: string
  content: string
  createdAt: string
  user: CommentUser
}

const props = defineProps<{ projectId: string; workPackageId: string }>()

const toast = useNeoToast()
const comments = ref<WpComment[]>([])
const loading = ref(false)
const posting = ref(false)
const draft = ref('')

function base(): string {
  return `/pm/projects/${props.projectId}/work-packages/${props.workPackageId}/comments`
}

function initials(u: CommentUser): string {
  return ((u.firstName?.[0] ?? '') + (u.lastName?.[0] ?? '')).toUpperCase() || '?'
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const { data } = await api.get<WpComment[]>(base())
    comments.value = data
  } catch {
    toast.add({ severity: 'error', detail: 'Échec du chargement des commentaires.', life: 4000 })
  } finally {
    loading.value = false
  }
}

async function post(): Promise<void> {
  const content = draft.value.trim()
  if (!content) return
  posting.value = true
  try {
    const { data } = await api.post<WpComment>(base(), { content })
    comments.value = [...comments.value, data]
    draft.value = ''
  } catch (err: unknown) {
    toast.add({ severity: 'error', detail: extractErrorMessage(err) ?? 'Échec de l\'envoi du commentaire.', life: 4000 })
  } finally {
    posting.value = false
  }
}

onMounted(load)
watch(() => props.workPackageId, load)
</script>

<style scoped>
.wp-cmt { display: flex; flex-direction: column; gap: 12px; }
.wp-cmt__list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
.wp-cmt__row { display: flex; gap: 10px; }
.wp-cmt__avatar {
  flex-shrink: 0;
  width: 28px; height: 28px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--nl-accent, #1e9e8f); color: #fff;
  font-size: 0.7rem; font-weight: 600;
}
.wp-cmt__body { flex: 1; min-width: 0; }
.wp-cmt__head { display: flex; align-items: baseline; gap: 0.5rem; }
.wp-cmt__author { font-weight: 600; font-size: 0.8125rem; color: var(--nl-text-1); }
.wp-cmt__date { font-size: 0.72rem; color: var(--nl-text-3); }
.wp-cmt__text { margin: 0.15rem 0 0; font-size: 0.875rem; color: var(--nl-text-2); white-space: pre-wrap; word-break: break-word; }
.wp-cmt__muted { color: var(--nl-text-3); font-size: 0.875rem; padding: 8px 0; }

.wp-cmt__compose { display: flex; flex-direction: column; gap: 0.5rem; border-top: 1px solid var(--nl-border); padding-top: 0.75rem; }
.wp-cmt__textarea {
  width: 100%;
  border: 1px solid var(--nl-border, #d1d5db);
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  font-family: inherit;
  font-size: 0.875rem;
  resize: vertical;
}
</style>
