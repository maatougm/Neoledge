<!-- @file MemberInboxView.vue — Member-tuned notifications inbox. -->
<template>
  <div class="mi">
    <header class="mi__head">
      <h1 class="mi__title">Notifications</h1>
      <NeoButton
        v-if="hasUnread"
        label="Tout marquer comme lu"
        icon="pi pi-check"
        size="small"
        severity="secondary"
        outlined
        @click="markAllRead"
      />
    </header>

    <NeoMessage v-if="store.error" severity="error" :text="store.error" class="mb-3" />

    <div v-if="store.loading && store.notifications.length === 0" class="mi__loading">
      <i class="pi pi-spin pi-spinner" /> Chargement…
    </div>
    <div v-else-if="filtered.length === 0" class="mi__empty">
      <i class="pi pi-inbox" />
      <p>Aucune notification.</p>
    </div>
    <ul v-else class="mi__list">
      <li
        v-for="n in filtered"
        :key="n.id"
        class="mi__row"
        :class="{ 'mi__row--unread': !n.isRead }"
        @click="onOpen(n)"
      >
        <span class="mi__dot" :class="{ 'mi__dot--read': n.isRead }" />
        <div class="mi__row-body">
          <div class="mi__row-top">
            <span class="mi__row-title">{{ n.title }}</span>
            <span class="mi__row-time">{{ formatRelative(n.createdAt) }}</span>
          </div>
          <p class="mi__row-msg">{{ n.message }}</p>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { NeoButton, NeoMessage } from '@neolibrary/components'
import { useNotificationStore } from '@/stores/notificationStore'

const router = useRouter()
const store = useNotificationStore()

const filtered = computed(() => store.notifications ?? [])
const hasUnread = computed(() => filtered.value.some((n) => !n.isRead))

async function onOpen(n: { id: string; isRead: boolean }): Promise<void> {
  if (!n.isRead) await store.markAsRead(n.id)
  const link = (n as unknown as { link?: string | null }).link
  if (typeof link === 'string' && link.length > 0) void router.push(link)
}

async function markAllRead(): Promise<void> { await store.markAllAsRead() }

function formatRelative(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime()
    if (ms < 60_000) return 'il y a un instant'
    if (ms < 3_600_000) return `il y a ${Math.floor(ms / 60_000)} min`
    if (ms < 86_400_000) return `il y a ${Math.floor(ms / 3_600_000)} h`
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
  } catch { return '' }
}

onMounted(() => { void store.fetchNotifications() })
</script>

<style scoped>
.mi { padding: 1.75rem; max-width: 900px; margin: 0 auto; display: flex; flex-direction: column; gap: 1rem; }

.mi__head { display: flex; align-items: center; justify-content: space-between; }
.mi__title { margin: 0; font-size: 1.5rem; color: var(--nl-text-1); }

.mi__loading,
.mi__empty {
  display: flex; align-items: center; justify-content: center;
  flex-direction: column; gap: 0.5rem;
  padding: 3rem 2rem;
  background: var(--nl-card-bg, #fff);
  border: 1px dashed var(--nl-border);
  border-radius: 8px;
  color: var(--nl-text-3);
}
.mi__empty i { font-size: 1.75rem; }

.mi__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.mi__row {
  display: flex; align-items: flex-start; gap: 0.75rem;
  padding: 0.85rem 1rem;
  background: var(--nl-card-bg, #fff);
  border: 1px solid var(--nl-border);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.mi__row:hover { border-color: var(--nl-accent); }
.mi__row--unread { background: var(--nl-accent-light, #ecfdf5); }
.mi__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--nl-accent); margin-top: 0.5rem; flex-shrink: 0; }
.mi__dot--read { background: var(--nl-text-3, #9ca3af); }
.mi__row-body { flex: 1; min-width: 0; }
.mi__row-top { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.mi__row-title { font-weight: 600; font-size: 0.9375rem; color: var(--nl-text-1); }
.mi__row-time { font-size: 0.75rem; color: var(--nl-text-3); white-space: nowrap; }
.mi__row-msg {
  margin: 0.2rem 0 0 0;
  font-size: 0.8125rem; color: var(--nl-text-2);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
</style>
