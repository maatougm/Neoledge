<template>
  <div class="comments-section">
    <!-- New comment input -->
    <div class="compose-box">
      <div class="compose-avatar">{{ currentUserInitials }}</div>
      <div class="compose-right">
        <textarea
          v-model="newContent"
          class="compose-textarea"
          placeholder="Ajouter un commentaire…"
          rows="2"
          @keydown.ctrl.enter.prevent="submitComment"
        />
        <div class="compose-actions">
          <NeoButton
            label="Envoyer"
            icon="pi pi-send"
            size="small"
            :loading="submitting"
            :disabled="!newContent.trim()"
            @click="submitComment"
          />
        </div>
      </div>
    </div>

    <!-- Loading skeleton -->
    <div v-if="store.loading" class="skeleton-list">
      <div v-for="n in 3" :key="n" class="skeleton-item">
        <div class="skeleton-avatar" />
        <div class="skeleton-body">
          <div class="skeleton-line skeleton-line--short" />
          <div class="skeleton-line" />
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else-if="store.comments.length === 0" class="empty-state">
      <i class="pi pi-comments empty-icon" />
      <p>Aucun commentaire pour l'instant.</p>
    </div>

    <!-- Comment list -->
    <div v-else class="comment-list">
      <div
        v-for="comment in store.comments"
        :key="comment.id"
        class="comment-thread"
      >
        <CommentItem
          :comment="comment"
          :current-user-id="store.currentUserId"
          @reply="openReply(comment.id)"
          @edit="startEdit(comment.id, comment.content)"
          @delete="handleDelete(comment.id)"
          @save-edit="(content) => handleEdit(comment.id, content)"
          :editing="editingId === comment.id"
          :edit-draft="editingId === comment.id ? editDraft : ''"
          @update:edit-draft="editDraft = $event"
          @cancel-edit="cancelEdit"
        />

        <!-- Replies -->
        <div v-if="comment.replies.length > 0" class="replies-list">
          <CommentItem
            v-for="reply in comment.replies"
            :key="reply.id"
            :comment="reply"
            :current-user-id="store.currentUserId"
            :is-reply="true"
            @edit="startEdit(reply.id, reply.content)"
            @delete="handleDelete(reply.id)"
            @save-edit="(content) => handleEdit(reply.id, content)"
            :editing="editingId === reply.id"
            :edit-draft="editingId === reply.id ? editDraft : ''"
            @update:edit-draft="editDraft = $event"
            @cancel-edit="cancelEdit"
          />
        </div>

        <!-- Inline reply input -->
        <div v-if="replyingToId === comment.id" class="reply-compose">
          <div class="compose-avatar compose-avatar--sm">{{ currentUserInitials }}</div>
          <div class="compose-right">
            <textarea
              v-model="replyContent"
              class="compose-textarea compose-textarea--sm"
              placeholder="Votre réponse…"
              rows="2"
              @keydown.ctrl.enter.prevent="submitReply(comment.id)"
            />
            <div class="compose-actions">
              <NeoButton
                label="Répondre"
                icon="pi pi-send"
                size="small"
                :loading="submittingReply"
                :disabled="!replyContent.trim()"
                @click="submitReply(comment.id)"
              />
              <NeoButton
                label="Annuler"
                size="small"
                outlined
                @click="replyingToId = null; replyContent = ''"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { NeoButton } from '@neolibrary/components'
import { useNeoToast } from '@neolibrary/components'
import { useCommentStore } from '@/stores/commentStore'
import { useApp } from '@/stores/useApp'
import CommentItem from '@/components/pm/CommentItem.vue'

const props = defineProps<{ projectId: string }>()

const store = useCommentStore()
const appStore = useApp()
const toast = useNeoToast()

// ─── New comment state ───────────────────────────────────────────────────────
const newContent = ref('')
const submitting = ref(false)

// ─── Reply state ──────────────────────────────────────────────────────────────
const replyingToId = ref<string | null>(null)
const replyContent = ref('')
const submittingReply = ref(false)

// ─── Edit state ───────────────────────────────────────────────────────────────
const editingId = ref<string | null>(null)
const editDraft = ref('')

// ─── Current user initials ────────────────────────────────────────────────────
const currentUserInitials = computed<string>(() => {
  const jwt = appStore.jwt
  if (!jwt) return '?'
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1]))
    const first: string = payload['firstName'] ?? payload['given_name'] ?? ''
    const last: string = payload['lastName'] ?? payload['family_name'] ?? ''
    return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase() || '?'
  } catch {
    return '?'
  }
})

// ─── Handlers ────────────────────────────────────────────────────────────────

async function submitComment(): Promise<void> {
  if (submitting.value) return
  const content = newContent.value.trim()
  if (!content) return
  submitting.value = true
  try {
    await store.addComment(props.projectId, content)
    newContent.value = ''
    toast.add({ severity: 'success', detail: 'Commentaire ajouté.', life: 3000 })
  } catch {
    toast.add({ severity: 'error', detail: "Impossible d'envoyer le commentaire.", life: 4000 })
  } finally {
    submitting.value = false
  }
}

function openReply(commentId: string): void {
  replyingToId.value = commentId
  replyContent.value = ''
}

async function submitReply(commentId: string): Promise<void> {
  const content = replyContent.value.trim()
  if (!content) return
  submittingReply.value = true
  try {
    await store.addReply(props.projectId, commentId, content)
    replyContent.value = ''
    replyingToId.value = null
    toast.add({ severity: 'success', detail: 'Réponse ajoutée.', life: 3000 })
  } catch {
    toast.add({ severity: 'error', detail: "Impossible d'envoyer la réponse.", life: 4000 })
  } finally {
    submittingReply.value = false
  }
}

function startEdit(commentId: string, currentContent: string): void {
  editingId.value = commentId
  editDraft.value = currentContent
}

function cancelEdit(): void {
  editingId.value = null
  editDraft.value = ''
}

async function handleEdit(commentId: string, content: string): Promise<void> {
  if (!content.trim()) return
  try {
    await store.editComment(props.projectId, commentId, content)
    cancelEdit()
    toast.add({ severity: 'success', detail: 'Commentaire modifié.', life: 3000 })
  } catch {
    toast.add({ severity: 'error', detail: 'Impossible de modifier le commentaire.', life: 4000 })
  }
}

async function handleDelete(commentId: string): Promise<void> {
  try {
    await store.removeComment(props.projectId, commentId)
    toast.add({ severity: 'success', detail: 'Commentaire supprimé.', life: 3000 })
  } catch {
    toast.add({ severity: 'error', detail: 'Impossible de supprimer le commentaire.', life: 4000 })
  }
}
</script>

<style scoped>
.comments-section {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

/* ── Compose box ─────────────────────────────────────────────── */
.compose-box {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
}

.compose-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--nl-accent);
  color: #fff;
  font-size: 0.75rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.compose-avatar--sm {
  width: 28px;
  height: 28px;
  font-size: 0.65rem;
}

.compose-right {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.compose-textarea {
  width: 100%;
  resize: vertical;
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  padding: 0.6rem 0.75rem;
  font-family: var(--nl-font);
  font-size: 0.875rem;
  color: var(--nl-text-1);
  background: var(--nl-surface);
  outline: none;
  transition: border-color 0.15s;
  line-height: 1.5;
}

.compose-textarea:focus {
  border-color: var(--nl-accent);
}

.compose-textarea--sm {
  font-size: 0.82rem;
}

.compose-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

/* ── Skeleton ────────────────────────────────────────────────── */
.skeleton-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.skeleton-item {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
}

.skeleton-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--nl-border);
  flex-shrink: 0;
  animation: pulse 1.4s ease-in-out infinite;
}

.skeleton-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding-top: 0.25rem;
}

.skeleton-line {
  height: 12px;
  border-radius: 6px;
  background: var(--nl-border);
  animation: pulse 1.4s ease-in-out infinite;
}

.skeleton-line--short {
  width: 35%;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.45; }
}

/* ── Empty state ─────────────────────────────────────────────── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 2.5rem;
  color: var(--nl-text-3);
  font-size: 0.875rem;
  background: var(--nl-surface-2);
  border-radius: var(--nl-radius);
  border: 1px dashed var(--nl-border);
}

.empty-icon {
  font-size: 2rem;
  color: var(--nl-text-3);
}

.empty-state p {
  margin: 0;
}

/* ── Comment list ────────────────────────────────────────────── */
.comment-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.comment-thread {
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* ── Replies ─────────────────────────────────────────────────── */
.replies-list {
  margin-left: 2.75rem;
  border-left: 2px solid var(--nl-border);
  padding-left: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* ── Reply compose ───────────────────────────────────────────── */
.reply-compose {
  display: flex;
  gap: 0.6rem;
  align-items: flex-start;
  margin-left: 2.75rem;
  margin-top: 0.5rem;
  padding: 0.75rem;
  background: var(--nl-surface-2);
  border-radius: var(--nl-radius);
  border: 1px solid var(--nl-border);
}
</style>
