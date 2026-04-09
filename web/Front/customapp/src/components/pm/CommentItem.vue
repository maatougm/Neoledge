<template>
  <div :class="['comment-item', { 'comment-item--reply': isReply }]">
    <div class="comment-avatar">{{ initials }}</div>
    <div class="comment-body">
      <div class="comment-header">
        <span class="comment-author">{{ authorName }}</span>
        <span class="comment-time">{{ relativeTime(comment.createdAt) }}</span>
        <span v-if="comment.updatedAt" class="comment-edited">(modifié)</span>
      </div>

      <!-- View mode -->
      <p v-if="!editing" class="comment-text">{{ comment.content }}</p>

      <!-- Edit mode -->
      <div v-else class="edit-box">
        <textarea
          :value="editDraft"
          class="edit-textarea"
          rows="2"
          @input="$emit('update:editDraft', ($event.target as HTMLTextAreaElement).value)"
          @keydown.escape.prevent="$emit('cancelEdit')"
          @keydown.ctrl.enter.prevent="$emit('saveEdit', editDraft)"
        />
        <div class="edit-actions">
          <NeoButton
            label="Enregistrer"
            size="small"
            :disabled="!editDraft.trim()"
            @click="$emit('saveEdit', editDraft)"
          />
          <NeoButton
            label="Annuler"
            size="small"
            outlined
            @click="$emit('cancelEdit')"
          />
        </div>
      </div>

      <!-- Actions (view mode only) -->
      <div v-if="!editing" class="comment-actions">
        <button
          v-if="!isReply"
          class="action-btn"
          @click="$emit('reply')"
        >
          <i class="pi pi-reply" /> Répondre
        </button>
        <template v-if="isOwner">
          <button class="action-btn" @click="$emit('edit')">
            <i class="pi pi-pencil" /> Modifier
          </button>
          <button class="action-btn action-btn--danger" @click="$emit('delete')">
            <i class="pi pi-trash" /> Supprimer
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NeoButton } from '@neolibrary/components'
import type { Comment } from '@/stores/commentStore'

const props = defineProps<{
  comment: Comment
  currentUserId: string | null
  isReply?: boolean
  editing: boolean
  editDraft: string
}>()

defineEmits<{
  reply: []
  edit: []
  delete: []
  saveEdit: [content: string]
  cancelEdit: []
  'update:editDraft': [value: string]
}>()

const isOwner = computed(() => props.comment.userId === props.currentUserId)

const authorName = computed(() => {
  if (!props.comment.user) return 'Utilisateur inconnu'
  return `${props.comment.user.firstName} ${props.comment.user.lastName}`
})

const initials = computed(() => {
  if (!props.comment.user) return '?'
  const f = props.comment.user.firstName.charAt(0)
  const l = props.comment.user.lastName.charAt(0)
  return `${f}${l}`.toUpperCase()
})

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return "À l'instant"
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `Il y a ${diffMin} min`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `Il y a ${diffH} h`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 7) return `Il y a ${diffD} j`
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}
</script>

<style scoped>
.comment-item {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--nl-border);
}

.comment-item:last-child {
  border-bottom: none;
}

.comment-item--reply {
  padding: 0.6rem 0;
}

/* ── Avatar ──────────────────────────────────────────────────── */
.comment-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--nl-accent-light);
  color: var(--nl-accent);
  font-size: 0.75rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 1px solid var(--nl-accent);
}

.comment-item--reply .comment-avatar {
  width: 28px;
  height: 28px;
  font-size: 0.65rem;
}

/* ── Body ────────────────────────────────────────────────────── */
.comment-body {
  flex: 1;
  min-width: 0;
}

.comment-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.25rem;
}

.comment-author {
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--nl-text-1);
}

.comment-time {
  font-size: 0.78rem;
  color: var(--nl-text-3);
}

.comment-edited {
  font-size: 0.75rem;
  color: var(--nl-text-3);
  font-style: italic;
}

.comment-text {
  font-size: 0.875rem;
  color: var(--nl-text-2);
  line-height: 1.55;
  margin: 0 0 0.4rem;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ── Actions ─────────────────────────────────────────────────── */
.comment-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 0.25rem;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--nl-text-3);
  padding: 0.15rem 0;
  transition: color 0.15s;
}

.action-btn:hover {
  color: var(--nl-accent);
}

.action-btn--danger:hover {
  color: var(--nl-danger);
}

/* ── Edit box ────────────────────────────────────────────────── */
.edit-box {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 0.4rem;
}

.edit-textarea {
  width: 100%;
  resize: vertical;
  border: 1px solid var(--nl-accent);
  border-radius: var(--nl-radius);
  padding: 0.5rem 0.65rem;
  font-family: var(--nl-font);
  font-size: 0.875rem;
  color: var(--nl-text-1);
  background: var(--nl-surface);
  outline: none;
  line-height: 1.5;
}

.edit-actions {
  display: flex;
  gap: 0.5rem;
}
</style>
