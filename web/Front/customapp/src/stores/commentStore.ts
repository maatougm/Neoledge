/**
 * @file     commentStore.ts
 * @module   NeoLeadge — Deployment Manager
 * @desc     Pinia store for project comments — immutable state updates
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/lib/api'
import { useAuthStore } from './authStore'
import { onLogout } from './logoutBus'

export interface CommentUser {
  id: string
  firstName: string
  lastName: string
}

export interface Comment {
  id: string
  userId: string
  content: string
  createdAt: string
  updatedAt: string | null
  isDeleted: boolean
  parentCommentId: string | null
  mentions: string | null
  user: CommentUser | null
  replies: Comment[]
}

export const useCommentStore = defineStore('comments', () => {
  // ─── State ──────────────────────────────────────────────────────────────────
  const comments = ref<Comment[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // ─── Getters ─────────────────────────────────────────────────────────────────
  /** Current user ID from authStore — avoids duplicating JWT decode logic. */
  const currentUserId = computed<string | null>(() => useAuthStore().userId)

  // ─── Actions ─────────────────────────────────────────────────────────────────

  const fetchComments = async (projectId: string): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.get<Comment[]>(`/api/projects/${projectId}/comments`)
      comments.value = [...data]
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors du chargement des commentaires.'
    } finally {
      loading.value = false
    }
  }

  const addComment = async (projectId: string, content: string): Promise<void> => {
    try {
      const { data } = await api.post<Comment>(`/api/projects/${projectId}/comments`, { content })
      comments.value = [data, ...comments.value]
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : "Erreur lors de l'ajout du commentaire."
      throw e
    }
  }

  const addReply = async (
    projectId: string,
    commentId: string,
    content: string,
  ): Promise<void> => {
    try {
      const { data } = await api.post<Comment>(
        `/api/projects/${projectId}/comments/${commentId}/replies`,
        { content },
      )
      comments.value = comments.value.map((c) =>
        c.id === commentId
          ? { ...c, replies: [...c.replies, data] }
          : c,
      )
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : "Erreur lors de l'ajout de la réponse."
      throw e
    }
  }

  const editComment = async (
    projectId: string,
    commentId: string,
    content: string,
  ): Promise<void> => {
    try {
      const { data } = await api.put<Comment>(
        `/api/projects/${projectId}/comments/${commentId}`,
        { content },
      )
      comments.value = comments.value.map((c) => {
        if (c.id === commentId) return { ...c, ...data }
        const updatedReplies = c.replies.map((r) =>
          r.id === commentId ? { ...r, ...data } : r,
        )
        return { ...c, replies: updatedReplies }
      })
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la modification du commentaire.'
      throw e
    }
  }

  const removeComment = async (projectId: string, commentId: string): Promise<void> => {
    try {
      await api.delete(`/api/projects/${projectId}/comments/${commentId}`)
      comments.value = comments.value
        .filter((c) => c.id !== commentId)
        .map((c) => ({
          ...c,
          replies: c.replies.filter((r) => r.id !== commentId),
        }))
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la suppression du commentaire.'
      throw e
    }
  }

  // ─── Logout reset ────────────────────────────────────────────────────────────

  /** Wipe per-user state on logout. */
  const reset = (): void => {
    comments.value = []
    loading.value = false
    error.value = null
  }

  onLogout(reset)

  return {
    comments,
    loading,
    error,
    currentUserId,
    fetchComments,
    addComment,
    addReply,
    editComment,
    removeComment,
    reset,
  }
})
