<!--
  @file     NotificationBell.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Self-contained bell icon with dropdown notification panel
-->
<template>
  <div class="notif-wrap" ref="wrapRef">
    <!-- Bell trigger -->
    <button
      class="bell-btn"
      :aria-label="`Notifications${unreadCount > 0 ? ` (${unreadCount} non lues)` : ''}`"
      :aria-expanded="open"
      aria-haspopup="true"
      @click="togglePanel"
    >
      <i class="pi pi-bell bell-icon" aria-hidden="true" />
      <span v-if="unreadCount > 0" class="bell-badge" aria-hidden="true">
        {{ unreadCount > 9 ? '9+' : unreadCount }}
      </span>
    </button>

    <!-- Dropdown panel -->
    <div v-if="open" class="notif-panel" role="dialog" aria-label="Notifications">
      <!-- Panel header -->
      <div class="panel-header">
        <span class="panel-title">Notifications</span>
        <button
          v-if="unreadCount > 0"
          class="mark-all-btn"
          @click="handleMarkAllAsRead"
        >
          Tout marquer lu
        </button>
      </div>

      <!-- Notification list -->
      <div class="panel-body">
        <div v-if="recentNotifications.length === 0" class="empty-state">
          <i class="pi pi-bell-slash empty-icon" aria-hidden="true" />
          <span>Aucune notification</span>
        </div>

        <ul v-else class="notif-list" role="list">
          <li
            v-for="notif in recentNotifications"
            :key="notif.id"
            :class="['notif-item', { 'notif-item--unread': !notif.isRead }]"
            role="listitem"
          >
            <!-- Unread indicator dot -->
            <span
              v-if="!notif.isRead"
              class="unread-dot"
              aria-label="Non lue"
            />
            <span v-else class="unread-dot-placeholder" />

            <!-- Content -->
            <button
              class="notif-content"
              :title="notif.isRead ? '' : 'Marquer comme lue'"
              @click="handleMarkAsRead(notif.id, notif.isRead)"
            >
              <span class="notif-title">{{ notif.title }}</span>
              <span class="notif-message">{{ notif.message }}</span>
              <span class="notif-time">{{ relativeTime(notif.createdAt) }}</span>
            </button>

            <!-- Delete button -->
            <button
              class="delete-btn"
              aria-label="Supprimer la notification"
              title="Supprimer"
              @click.stop="handleRemove(notif.id)"
            >
              <i class="pi pi-times" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useNotificationStore } from '@/stores/notificationStore'

const store = useNotificationStore()
const open = ref(false)
const wrapRef = ref<HTMLElement | null>(null)

const MAX_VISIBLE = 10

const unreadCount = computed(() => store.unreadCount)

const recentNotifications = computed(() =>
  [...store.notifications]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, MAX_VISIBLE),
)

// ── Helpers ────────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return "il y a quelques secondes"
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `il y a ${diffMin} min`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `il y a ${diffH} h`
  const diffD = Math.floor(diffH / 24)
  return `il y a ${diffD} j`
}

// ── Handlers ───────────────────────────────────────────────────────────────────

function togglePanel(): void {
  open.value = !open.value
}

async function handleMarkAsRead(id: string, alreadyRead: boolean): Promise<void> {
  if (alreadyRead) return
  await store.markAsRead(id)
}

async function handleMarkAllAsRead(): Promise<void> {
  await store.markAllAsRead()
}

async function handleRemove(id: string): Promise<void> {
  await store.removeNotification(id)
}

// ── Click-outside to close ─────────────────────────────────────────────────────

function onDocumentClick(event: MouseEvent): void {
  if (wrapRef.value && !wrapRef.value.contains(event.target as Node)) {
    open.value = false
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onDocumentClick)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', onDocumentClick)
})
</script>

<style scoped>
/* ── Wrapper ──────────────────────────────────────────────────────────────── */
.notif-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}

/* ── Bell button ─────────────────────────────────────────────────────────── */
.bell-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: var(--nl-radius);
  color: #64748b;
  font-size: 0.9rem;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  font-family: var(--nl-font);
  flex-shrink: 0;
}

.bell-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #e2e8f0;
}

.bell-btn:focus-visible {
  outline: 2px solid var(--nl-accent);
  outline-offset: 2px;
}

.bell-icon {
  font-size: 0.875rem;
}

/* ── Badge ────────────────────────────────────────────────────────────────── */
.bell-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 16px;
  height: 16px;
  padding: 0 3px;
  background: #e11d48;
  color: #fff;
  font-size: 0.6rem;
  font-weight: 700;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  pointer-events: none;
  border: 1.5px solid #0f172a;
}

/* ── Panel ────────────────────────────────────────────────────────────────── */
.notif-panel {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  width: 340px;
  background: #1e293b;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--nl-radius-lg);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.3);
  z-index: 1000;
  overflow: hidden;
  animation: panel-in 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes panel-in {
  from { opacity: 0; transform: translateY(6px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0)   scale(1); }
}

/* ── Panel header ─────────────────────────────────────────────────────────── */
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.875rem 1rem 0.625rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.panel-title {
  font-size: 0.8125rem;
  font-weight: 700;
  color: #f1f5f9;
  letter-spacing: 0.01em;
}

.mark-all-btn {
  background: none;
  border: none;
  color: var(--nl-accent);
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  padding: 0.15rem 0.35rem;
  border-radius: 4px;
  transition: background 0.1s;
  font-family: var(--nl-font);
}

.mark-all-btn:hover {
  background: rgba(13, 148, 136, 0.12);
}

.mark-all-btn:focus-visible {
  outline: 2px solid var(--nl-accent);
  outline-offset: 2px;
}

/* ── Body ─────────────────────────────────────────────────────────────────── */
.panel-body {
  max-height: 340px;
  overflow-y: auto;
}

.panel-body::-webkit-scrollbar { width: 4px; }
.panel-body::-webkit-scrollbar-track { background: transparent; }
.panel-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }

/* ── Empty state ──────────────────────────────────────────────────────────── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2.5rem 1rem;
  color: #64748b;
  font-size: 0.8125rem;
}

.empty-icon { font-size: 1.5rem; color: #334155; }

/* ── Notification list ────────────────────────────────────────────────────── */
.notif-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.notif-item {
  display: flex;
  align-items: flex-start;
  gap: 0.375rem;
  padding: 0.625rem 0.75rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  transition: background 0.12s;
}

.notif-item:last-child { border-bottom: none; }

.notif-item:hover { background: rgba(255, 255, 255, 0.03); }

.notif-item--unread { background: rgba(13, 148, 136, 0.05); }
.notif-item--unread:hover { background: rgba(13, 148, 136, 0.09); }

/* ── Unread dot ───────────────────────────────────────────────────────────── */
.unread-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--nl-accent);
  flex-shrink: 0;
  margin-top: 0.35rem;
  box-shadow: 0 0 6px rgba(13, 148, 136, 0.6);
}

.unread-dot-placeholder {
  width: 7px;
  height: 7px;
  flex-shrink: 0;
}

/* ── Notification content (clickable area) ────────────────────────────────── */
.notif-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  text-align: left;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-family: var(--nl-font);
}

.notif-content:focus-visible {
  outline: 2px solid var(--nl-accent);
  outline-offset: 2px;
  border-radius: 4px;
}

.notif-title {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #e2e8f0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
}

.notif-message {
  font-size: 0.75rem;
  color: #94a3b8;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.4;
}

.notif-time {
  font-size: 0.68rem;
  color: #475569;
  margin-top: 0.1rem;
  display: block;
}

/* ── Delete button ────────────────────────────────────────────────────────── */
.delete-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  background: none;
  border: none;
  border-radius: 4px;
  color: #475569;
  font-size: 0.65rem;
  cursor: pointer;
  flex-shrink: 0;
  margin-top: 0.125rem;
  transition: background 0.1s, color 0.1s;
  font-family: var(--nl-font);
}

.delete-btn:hover {
  background: rgba(239, 68, 68, 0.12);
  color: #f87171;
}

.delete-btn:focus-visible {
  outline: 2px solid var(--nl-accent);
  outline-offset: 2px;
}
</style>
