<!--
  @file     LogsSection.vue
  @module   NeoLeadge — Deployment Manager
  @author   [dev]
  @date     2026-03-26
  @desc     Consulter les logs — tail of the application log file
-->
<template>
  <div class="section">
    <div class="section-header">
      <div>
        <h2 class="section-title">Journal des événements</h2>
        <p class="section-sub">{{ lines.length }} ligne(s) — {{ linesParam }} dernières entrées</p>
      </div>
      <div class="header-actions">
        <NeoButton label="Actualiser" icon="pi pi-refresh" outlined :loading="loading" @click="load" />
      </div>
    </div>

    <div v-if="loading" class="loading-state">
      <i class="pi pi-spin pi-spinner" style="font-size: 1.5rem; color: #0d9488" />
    </div>

    <div v-else-if="error" class="error-state">
      <i class="pi pi-exclamation-circle" />
      <p>{{ error }}</p>
    </div>

    <div v-else class="log-box" ref="logBox">
      <p v-if="lines.length === 0" class="log-empty">Aucune entrée de log.</p>
      <div v-for="(line, i) in lines" :key="i" :class="['log-line', levelClass(line)]">
        {{ line }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import axios from 'axios'
import { NeoButton } from '@neolibrary/components'
import { useApp } from '@/stores/useApp'

const app        = useApp()
const lines      = ref<string[]>([])
const loading    = ref(false)
const error      = ref<string | null>(null)
const logBox     = ref<HTMLElement | null>(null)
const linesParam = 200

const authHeader = () => {
  const jwt = app.jwt
  return jwt ? { Authorization: `Bearer ${jwt}` } : {}
}

const load = async () => {
  loading.value = true
  error.value   = null
  try {
    const { data } = await axios.get<string[]>(
      `${app.apiUrl}/admin/Log?lines=${linesParam}`,
      { headers: authHeader() },
    )
    lines.value = data
    await nextTick()
    if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Erreur lors du chargement des logs.'
  } finally {
    loading.value = false
  }
}

const levelClass = (line: string) => {
  const upper = line.toUpperCase()
  if (upper.includes('[ERROR]') || upper.includes('[FATAL]')) return 'log-error'
  if (upper.includes('[WARN]'))  return 'log-warn'
  if (upper.includes('[DEBUG]')) return 'log-debug'
  return 'log-info'
}

onMounted(load)
</script>

<style scoped>
.section { display: flex; flex-direction: column; gap: 1.5rem; }

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 1rem;
}

.section-title { font-size: 1.25rem; font-weight: 700; color: var(--nl-text-1); margin: 0; }
.section-sub   { font-size: 0.85rem; color: var(--nl-text-3); margin: 0.2rem 0 0; }

.header-actions { display: flex; gap: 0.5rem; }

.loading-state,
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 3rem;
  color: var(--nl-text-3);
}
.error-state { color: var(--nl-danger); }
.error-state i { font-size: 2rem; }

.log-box {
  background: #0f172a;
  border-radius: var(--nl-radius);
  padding: 1rem;
  max-height: 560px;
  overflow-y: auto;
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.78rem;
  line-height: 1.6;
}

.log-empty { color: #475569; text-align: center; padding: 2rem 0; }

.log-line { white-space: pre-wrap; word-break: break-all; color: #94a3b8; }
.log-error { color: #f87171; }
.log-warn  { color: #fbbf24; }
.log-debug { color: #60a5fa; }
.log-info  { color: #94a3b8; }
</style>
