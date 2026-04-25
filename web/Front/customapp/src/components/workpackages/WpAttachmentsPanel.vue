<!-- @file src/components/workpackages/WpAttachmentsPanel.vue
     Sprint 7 — file upload/download/delete for a Work Package. -->
<template>
  <div class="wp-att">
    <div class="wp-att__upload">
      <input
        ref="fileInputRef"
        type="file"
        class="wp-att__input"
        :disabled="uploading"
        @change="onFilePick"
      />
      <span v-if="uploading" class="wp-att__progress">
        <i class="pi pi-spin pi-cog" /> Envoi en cours…
      </span>
      <span v-else class="wp-att__hint">Max 25 Mo — PDF, image, Office, ZIP</span>
    </div>

    <div v-if="loading" class="wp-att__muted">Chargement…</div>
    <ul v-else-if="attachments.length" class="wp-att__list">
      <li v-for="a in attachments" :key="a.id" class="wp-att__row">
        <i class="pi pi-paperclip" />
        <button
          class="wp-att__name"
          type="button"
          :disabled="downloadingId === a.id"
          @click="downloadFile(a)"
        >{{ a.fileName }}</button>
        <span class="wp-att__meta">
          {{ formatSize(a.fileSize) }} · {{ a.uploadedByName }} · {{ formatDateShort(a.uploadedAt) }}
        </span>
        <NeoButton
          icon="pi pi-trash"
          text
          severity="danger"
          aria-label="Supprimer la pièce jointe"
          @click="confirmDelete(a)"
        />
      </li>
    </ul>
    <div v-else class="wp-att__muted">Aucune pièce jointe.</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { NeoButton, useNeoToast, useNeoConfirm } from '@neolibrary/components'
import api from '@/lib/api'
import { formatDateShort } from '@/lib/formatDate'

interface Attachment {
  id: string
  fileName: string
  contentType: string
  fileSize: number
  uploadedAt: string
  uploadedByName: string
}

const props = defineProps<{ workPackageId: string }>()

const toast = useNeoToast()
const confirm = useNeoConfirm()
const attachments = ref<Attachment[]>([])
const loading = ref(false)
const uploading = ref(false)
const downloadingId = ref<string | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

async function load(): Promise<void> {
  loading.value = true
  try {
    const { data } = await api.get<Attachment[]>(`/pm/work-packages/${props.workPackageId}/attachments`)
    attachments.value = data
  } catch {
    toast.add({ severity: 'error', detail: 'Échec du chargement des pièces jointes.', life: 4000 })
  } finally {
    loading.value = false
  }
}

async function onFilePick(e: Event): Promise<void> {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  if (file.size > 25 * 1024 * 1024) {
    toast.add({ severity: 'error', detail: 'Fichier trop volumineux (max 25 Mo).', life: 4000 })
    target.value = ''
    return
  }
  uploading.value = true
  try {
    const formData = new FormData()
    formData.append('file', file)
    await api.post(`/pm/work-packages/${props.workPackageId}/attachments`, formData)
    toast.add({ severity: 'success', detail: 'Pièce jointe ajoutée.', life: 2500 })
    await load()
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : 'Erreur inconnue'
    toast.add({ severity: 'error', detail: `Échec de l'envoi : ${detail}`, life: 4000 })
  } finally {
    uploading.value = false
    if (fileInputRef.value) fileInputRef.value.value = ''
  }
}

function confirmDelete(a: Attachment): void {
  confirm.require({
    message: `Supprimer « ${a.fileName} » ?`,
    header: 'Confirmer la suppression',
    icon: 'pi pi-exclamation-triangle',
    accept: async () => {
      try {
        await api.delete(`/pm/work-packages/${props.workPackageId}/attachments/${a.id}`)
        toast.add({ severity: 'success', detail: 'Pièce jointe supprimée.', life: 2500 })
        await load()
      } catch {
        toast.add({ severity: 'error', detail: 'Suppression refusée.', life: 4000 })
      }
    },
  })
}

async function downloadFile(a: Attachment): Promise<void> {
  // Browsers don't carry the JWT auth header on plain <a href> clicks, so
  // we fetch via axios (Authorization interceptor wired) then trigger a
  // synthetic anchor click on the resulting blob URL.
  downloadingId.value = a.id
  try {
    const resp = await api.get<Blob>(
      `/pm/work-packages/${props.workPackageId}/attachments/${a.id}/download`,
      { responseType: 'blob' },
    )
    const url = URL.createObjectURL(resp.data)
    const link = document.createElement('a')
    link.href = url
    link.download = a.fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  } catch {
    toast.add({ severity: 'error', detail: 'Téléchargement échoué.', life: 4000 })
  } finally {
    downloadingId.value = null
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

onMounted(load)
watch(() => props.workPackageId, load)
</script>

<style scoped>
.wp-att { display: flex; flex-direction: column; gap: 12px; }

.wp-att__upload {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
  background: var(--nl-surface-2, #f9fafb);
  border-radius: var(--nl-radius);
}
.wp-att__input { font-size: 0.875rem; flex: 1; }
.wp-att__hint { color: var(--nl-text-3); font-size: 0.8125rem; }
.wp-att__progress { color: var(--nl-text-2); font-size: 0.8125rem; }
.wp-att__progress .pi { margin-right: 4px; }

.wp-att__list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
.wp-att__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  background: var(--nl-surface);
}
.wp-att__name {
  flex: 1;
  color: var(--nl-accent);
  background: transparent;
  border: none;
  padding: 0;
  text-align: left;
  text-decoration: none;
  font-weight: 500;
  font-family: inherit;
  font-size: 0.875rem;
  cursor: pointer;
  word-break: break-all;
}
.wp-att__name:hover:not(:disabled) { text-decoration: underline; }
.wp-att__name:disabled { opacity: 0.6; cursor: wait; }
.wp-att__meta { color: var(--nl-text-3); font-size: 0.75rem; white-space: nowrap; }
.wp-att__muted { color: var(--nl-text-3); font-size: 0.875rem; padding: 8px 0; }
</style>
