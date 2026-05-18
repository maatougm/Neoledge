<!-- @file src/layouts/NotificationPanel.vue — Topbar notification bell with dropdown panel -->
<template>
  <div ref="rootRef" class="notif-panel">
    <!-- Bell trigger -->
    <button
      class="topbar-icon-btn"
      :class="{ 'topbar-icon-btn--active': open }"
      :aria-label="`Notifications${notifStore.unreadCount > 0 ? ` (${notifStore.unreadCount} non lues)` : ''}`"
      aria-haspopup="true"
      :aria-expanded="open"
      @click="toggleOpen"
    >
      <i class="pi pi-bell" />
      <span v-if="notifStore.unreadCount > 0" class="notif-panel__badge" aria-hidden="true">
        {{ notifStore.unreadCount > 99 ? '99+' : notifStore.unreadCount }}
      </span>
    </button>

    <!-- Dropdown panel -->
    <transition name="notif-dropdown">
      <div v-if="open" class="notif-panel__dropdown" role="dialog" aria-label="Notifications">
        <!-- Panel header -->
        <div class="notif-panel__header">
          <span class="notif-panel__title">Notifications</span>
          <button
            v-if="notifStore.unreadCount > 0"
            class="notif-panel__mark-all"
            :disabled="markingAll"
            @click="handleMarkAll"
          >
            Tout marquer lu
          </button>
        </div>

        <!-- Notification list -->
        <div class="notif-panel__list" role="list">
          <!-- Loading state -->
          <div v-if="notifStore.loading" class="notif-panel__state">
            <i class="pi pi-spin pi-spinner" />
            <span>Chargement…</span>
          </div>

          <!-- Empty state -->
          <div
            v-else-if="notifStore.notifications.length === 0"
            class="notif-panel__state notif-panel__state--empty"
          >
            <i class="pi pi-bell-slash" />
            <span>Aucune notification</span>
          </div>

          <!-- Items -->
          <div
            v-for="notif in notifStore.notifications"
            v-else
            :key="notif.id"
            class="notif-item"
            :class="{ 'notif-item--unread': !notif.isRead }"
            role="listitem"
            @click="handleItemClick(notif.id, notif.isRead)"
          >
            <!-- Unread indicator dot -->
            <span v-if="!notif.isRead" class="notif-item__dot" aria-label="Non lu" />

            <!-- Content -->
            <div class="notif-item__content">
              <span class="notif-item__title">{{ notif.title }}</span>
              <p class="notif-item__message">{{ notif.message }}</p>
              <time class="notif-item__time" :datetime="notif.createdAt">
                {{ relativeTime(notif.createdAt) }}
              </time>
            </div>

            <!-- Delete button -->
            <button
              class="notif-item__delete"
              :aria-label="`Supprimer la notification: ${notif.title}`"
              @click.stop="notifStore.removeNotification(notif.id)"
            >
              <i class="pi pi-times" />
            </button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useNotificationStore } from '@/stores/notificationStore'
import { useAuthStore } from '@/stores/authStore'

// ─── Store ────────────────────────────────────────────────────────────────────

const notifStore = useNotificationStore()
const authStore  = useAuthStore()
const router     = useRouter()

// ─── State ────────────────────────────────────────────────────────────────────

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)

// ─── Methods ──────────────────────────────────────────────────────────────────

function toggleOpen(): void {
  open.value = !open.value
}

function close(): void {
  open.value = false
}

// Per-id in-flight guard — without this, a rapid double-click sends two
// PATCH /:id/read requests and the second can 404 (already read) which
// the axios 5xx interceptor doesn't toast for, but a refactor of that
// interceptor could surface as a confusing user error.
const markInFlight = new Set<string>()
const markingAll = ref(false)

async function handleMarkAll(): Promise<void> {
  if (markingAll.value) return
  markingAll.value = true
  try {
    await Promise.resolve(notifStore.markAllAsRead())
  } finally {
    markingAll.value = false
  }
}

/**
 * Several backend notification producers hardcode `/app/pm/...` deep-links
 * (cahier_ready, work_package_assigned via team-planner, work_package_unassigned,
 * …). Those PM-namespace routes are guarded by `allowedRoles: ['ProjectManager', 'Admin']`,
 * so a SpecificationTeam or Member recipient who clicks the bell lands on
 * `/unauthorized`. We rewrite the link to the role-appropriate team route
 * before navigating, which covers every current and future notification
 * source without forcing a backend change per producer.
 */
function rewriteLinkForRole(link: string, role: string | null | undefined): string {
  if (role === 'Admin' || role === 'ProjectManager') return link
  if (!link.startsWith('/app/pm/')) return link

  // /app/pm/projects/<id>/workpackages[?qs] → /app/team/my-tasks?projectId=<id>[&…]
  // The team-namespace counterpart of the PM workpackages page is the
  // assignee's personal task list.
  const wpMatch = link.match(/^\/app\/pm\/projects\/([^/?#]+)\/workpackages(?:\?(.*))?$/)
  if (wpMatch) {
    const [, projectId, qs] = wpMatch
    const params = new URLSearchParams(qs ?? '')
    params.set('projectId', projectId)
    return `/app/team/my-tasks?${params.toString()}`
  }

  // /app/pm/projects/<id>/<anything> → /app/team/projects/<id>
  // The team-namespace project page is read-only and can host cahier review,
  // validations, meetings, etc. for non-PM roles.
  const projMatch = link.match(/^\/app\/pm\/projects\/([^/?#]+)/)
  if (projMatch) {
    return `/app/team/projects/${projMatch[1]}`
  }

  // Fallback: swap the namespace prefix and let the router decide. If the
  // resulting URL is still unauthorized for this user, the existing route
  // guard surfaces /unauthorized — which is correct for resources the user
  // genuinely cannot access.
  return link.replace(/^\/app\/pm\//, '/app/team/')
}

function handleItemClick(id: string, isRead: boolean): void {
  if (!isRead && !markInFlight.has(id)) {
    markInFlight.add(id)
    void Promise.resolve(notifStore.markAsRead(id)).finally(() => markInFlight.delete(id))
  }

  const notif = notifStore.notifications.find(n => n.id === id)
  if (!notif) return

  // Prefer the explicit deep-link the producer set (e.g. wp_bulk_assigned →
  // /app/team/my-tasks?projectId=…&sprintId=…). Only accept internal paths
  // to prevent open-redirect via crafted notifications.
  if (typeof notif.link === 'string' && notif.link.startsWith('/')) {
    close()
    router.push(rewriteLinkForRole(notif.link, authStore.userRole))
    return
  }

  if (notif.projectId) {
    close()
    const role = authStore.userRole
    if (role === 'Admin') {
      router.push({ name: 'admin-project-detail', params: { id: notif.projectId } })
    } else if (role === 'ProjectManager') {
      router.push({ name: 'pm-project-detail', params: { id: notif.projectId } })
    } else {
      router.push({ name: 'team-project-detail', params: { id: notif.projectId } })
    }
  }
}

/**
 * Returns a human-readable relative time string (e.g. "il y a 3 min").
 * No external library — keeps bundle lean.
 */
function relativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return "À l'instant"
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `il y a ${hours} h`
  const days = Math.floor(hours / 24)
  return `il y a ${days} j`
}

// ─── Click-outside ────────────────────────────────────────────────────────────

function onDocumentClick(event: MouseEvent): void {
  if (rootRef.value && !rootRef.value.contains(event.target as Node)) {
    close()
  }
}

onMounted(() => document.addEventListener('mousedown', onDocumentClick))
onUnmounted(() => document.removeEventListener('mousedown', onDocumentClick))
</script>

<style scoped>
/* ── Wrapper ───────────────────────────────────────────────────────────────── */
.notif-panel {
  position: relative;
}

/* ── Bell button (reuses topbar-icon-btn pattern) ──────────────────────────── */
.topbar-icon-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  background: transparent;
  color: var(--nl-text-2);
  cursor: pointer;
  font-size: 0.9375rem;
  transition: background 0.2s cubic-bezier(0.16, 1, 0.3, 1),
              color 0.2s cubic-bezier(0.16, 1, 0.3, 1),
              border-color 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  outline: none;
}

.topbar-icon-btn:hover,
.topbar-icon-btn--active {
  background: var(--nl-surface-2);
  color: var(--nl-text-1);
  border-color: var(--nl-border-strong);
}

.topbar-icon-btn:focus-visible {
  outline: 2px solid var(--nl-accent);
  outline-offset: 2px;
}

/* ── Unread badge on bell ──────────────────────────────────────────────────── */
.notif-panel__badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 16px;
  height: 16px;
  padding: 0 3px;
  background: var(--nl-danger);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
  border-radius: 8px;
  white-space: nowrap;
  pointer-events: none;
}

/* ── Dropdown panel ────────────────────────────────────────────────────────── */
.notif-panel__dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 360px;
  max-height: 480px;
  display: flex;
  flex-direction: column;
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg);
  box-shadow: var(--nl-shadow-lg);
  overflow: hidden;
  z-index: 9500;
}

/* ── Panel header ──────────────────────────────────────────────────────────── */
.notif-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--nl-border);
  flex-shrink: 0;
}

.notif-panel__title {
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--nl-text-1);
}

.notif-panel__mark-all {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--nl-accent);
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  font-family: var(--nl-font);
  transition: background 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  outline: none;
}

.notif-panel__mark-all:hover {
  background: var(--nl-accent-light);
}

.notif-panel__mark-all:focus-visible {
  outline: 2px solid var(--nl-accent);
  outline-offset: 2px;
}

/* ── List container ────────────────────────────────────────────────────────── */
.notif-panel__list {
  flex: 1;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--nl-border-strong) transparent;
}

.notif-panel__list::-webkit-scrollbar {
  width: 4px;
}

.notif-panel__list::-webkit-scrollbar-thumb {
  background: var(--nl-border-strong);
  border-radius: 2px;
}

/* ── Empty / loading state ─────────────────────────────────────────────────── */
.notif-panel__state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 16px;
  color: var(--nl-text-3);
  font-size: 0.8125rem;
}

.notif-panel__state .pi {
  font-size: 1.5rem;
}

/* ── Notification item ─────────────────────────────────────────────────────── */
.notif-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--nl-border);
  cursor: pointer;
  transition: background 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  position: relative;
}

.notif-item:last-child {
  border-bottom: none;
}

.notif-item:hover {
  background: var(--nl-surface-2);
}

.notif-item--unread {
  background: var(--nl-accent-light);
}

.notif-item--unread:hover {
  background: var(--nl-accent-light);
  filter: brightness(0.96);
}

/* ── Unread dot ────────────────────────────────────────────────────────────── */
.notif-item__dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--nl-accent);
  margin-top: 5px;
}

/* ── Item content ──────────────────────────────────────────────────────────── */
.notif-item__content {
  flex: 1;
  min-width: 0;
}

.notif-item__title {
  display: block;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--nl-text-1);
  margin-bottom: 2px;
}

.notif-item__message {
  font-size: 0.75rem;
  color: var(--nl-text-2);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-bottom: 4px;
}

.notif-item__time {
  font-size: 0.6875rem;
  color: var(--nl-text-3);
}

/* ── Delete button ─────────────────────────────────────────────────────────── */
.notif-item__delete {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  color: var(--nl-text-3);
  cursor: pointer;
  border-radius: 4px;
  opacity: 0;
  transition: opacity 0.15s cubic-bezier(0.16, 1, 0.3, 1),
              background 0.15s cubic-bezier(0.16, 1, 0.3, 1),
              color 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  font-size: 0.625rem;
  outline: none;
}

.notif-item:hover .notif-item__delete {
  opacity: 1;
}

.notif-item__delete:hover {
  background: var(--nl-danger-light);
  color: var(--nl-danger);
}

.notif-item__delete:focus-visible {
  outline: 2px solid var(--nl-accent);
  outline-offset: 2px;
  opacity: 1;
}

/* ── Dropdown animation ────────────────────────────────────────────────────── */
.notif-dropdown-enter-active,
.notif-dropdown-leave-active {
  transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1),
              transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.notif-dropdown-enter-from,
.notif-dropdown-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.97);
}
</style>
