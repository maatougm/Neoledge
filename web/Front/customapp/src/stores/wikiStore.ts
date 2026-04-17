/** @file src/stores/wikiStore.ts — Wiki pages + revisions */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/lib/api'

export interface WikiPage {
  id: string
  projectId: string
  title: string
  slug: string
  content: string
  authorId: string
  parentId: string | null
  version: number
  isDeleted: boolean
  createdAt: string
  updatedAt: string
  author?: { id: string; firstName: string; lastName: string }
  children?: { id: string; slug: string; title: string }[]
  parent?: { id: string; slug: string; title: string }
}

export interface WikiRevision {
  id: string
  wikiPageId: string
  version: number
  title: string
  content: string
  authorId: string
  comment: string | null
  createdAt: string
  author?: { id: string; firstName: string; lastName: string }
}

export const useWikiStore = defineStore('wiki', () => {
  const tree = ref<WikiPage[]>([])
  const currentPage = ref<WikiPage | null>(null)
  const revisions = ref<WikiRevision[]>([])
  const loading = ref(false)

  async function fetchTree(projectId: string) {
    loading.value = true
    try {
      const { data } = await api.get<WikiPage[]>(`/pm/projects/${projectId}/wiki`)
      tree.value = data
    } finally {
      loading.value = false
    }
  }

  async function fetchPage(projectId: string, slug: string) {
    const { data } = await api.get<WikiPage>(`/pm/projects/${projectId}/wiki/pages/${slug}`)
    currentPage.value = data
    return data
  }

  async function createPage(projectId: string, payload: { title: string; content: string; parentId?: string }) {
    const { data } = await api.post<WikiPage>(`/pm/projects/${projectId}/wiki/pages`, payload)
    tree.value = [...tree.value, data]
    return data
  }

  async function updatePage(projectId: string, slug: string, payload: { title?: string; content?: string; comment?: string }) {
    const { data } = await api.patch<WikiPage>(`/pm/projects/${projectId}/wiki/pages/${slug}`, payload)
    currentPage.value = data
    return data
  }

  async function deletePage(projectId: string, slug: string) {
    await api.delete(`/pm/projects/${projectId}/wiki/pages/${slug}`)
    tree.value = tree.value.filter((p) => p.slug !== slug)
    if (currentPage.value?.slug === slug) currentPage.value = null
  }

  async function fetchRevisions(projectId: string, slug: string) {
    const { data } = await api.get<WikiRevision[]>(`/pm/projects/${projectId}/wiki/pages/${slug}/revisions`)
    revisions.value = data
  }

  async function restoreRevision(projectId: string, slug: string, version: number) {
    const { data } = await api.post<WikiPage>(`/pm/projects/${projectId}/wiki/pages/${slug}/restore/${version}`)
    currentPage.value = data
    return data
  }

  async function search(projectId: string, q: string) {
    const { data } = await api.get<WikiPage[]>(`/pm/projects/${projectId}/wiki/search?q=${encodeURIComponent(q)}`)
    return data
  }

  return { tree, currentPage, revisions, loading, fetchTree, fetchPage, createPage, updatePage, deletePage, fetchRevisions, restoreRevision, search }
})
