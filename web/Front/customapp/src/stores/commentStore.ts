/**
 * @file     commentStore.ts
 * @module   NeoLeadge — Deployment Manager
 * @desc     Pinia store for project comments — immutable state updates
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import axios from 'axios'
import { useApp } from './useApp'

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

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  const apiBase = (projectId: string) =>
    `${useApp().apiUrl}/api/projects/${projectId}/comments`

  const authHeader = () => {
    const jwt = useApp().jwt
    return jwt ? { Authorization: `Bearer ${jwt}` } : {}
  }

  // ─── Getters ─────────────────────────────────────────────────────────────────
  /** Decode the current user's ID from the JWT `sub` claim. */
  const currentUserId = computed<string | null>(() => {
    const jwt = useApp().jwt
    if (!jwt) return null
    try {
      const payload = JSON.parse(atob(jwt.split('.')[1]))
      return payload['sub'] ?? null
    } catch {
      return null
    }
  })

  // ─── Actions ─────────────────────────────────────────────────────────────────

  const fetchComments = async (projectId: string): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      const { data } = await axios.get<Comment[]>(apiBase(projectId), {
        headers: authHeader(),
      })
      comments.value = [...data]
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors du chargement des commentaires.'
    } finally {
      loading.value = false
    }
  }

  const addComment = async (projectId: string, content: string): Promise<void> => {
    try {
      const { data } = await axios.post<Comment>(
        apiBase(projectId),
        { content },
        { headers: authHeader() },
      )
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
      const { data } = await axios.post<Comment>(
        `${apiBase(projectId)}/${commentId}/replies`,
        { content },
        { headers: authHeader() },
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
      const { data } = await axios.put<Comment>(
        `${apiBase(projectId)}/${commentId}`,
        { content },
        { headers: authHeader() },
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
      await axios.delete(`${apiBase(projectId)}/${commentId}`, { headers: authHeader() })
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
  }
})
