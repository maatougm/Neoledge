<!-- @file src/layouts/UserMenu.vue — Topbar user menu dropdown with profile, dark mode, logout -->
<template>
  <div ref="rootRef" class="user-menu">
    <!-- Trigger button -->
    <button
      class="user-menu__trigger"
      :class="{ 'user-menu__trigger--open': open }"
      aria-haspopup="true"
      :aria-expanded="open"
      :aria-label="`Menu utilisateur: ${authStore.userFullName}`"
      @click="toggleOpen"
    >
      <span class="user-menu__avatar" aria-hidden="true">
        {{ authStore.userInitials }}
      </span>
      <span class="user-menu__info" aria-hidden="true">
        <span class="user-menu__name">{{ authStore.userFullName }}</span>
        <span class="user-menu__role">{{ roleLabel }}</span>
      </span>
      <i class="pi pi-angle-down user-menu__chevron" :class="{ 'user-menu__chevron--open': open }" />
    </button>

    <!-- Dropdown panel -->
    <transition name="dropdown">
      <div v-if="open" class="user-menu__dropdown" role="menu">
        <!-- Header -->
        <div class="user-menu__header">
          <span class="user-menu__avatar user-menu__avatar--lg" aria-hidden="true">
            {{ authStore.userInitials }}
          </span>
          <div class="user-menu__header-info">
            <span class="user-menu__header-name">{{ authStore.userFullName }}</span>
            <span class="user-menu__header-role">{{ roleLabel }}</span>
          </div>
        </div>

        <div class="user-menu__divider" role="separator" />

        <!-- Menu items -->
        <button class="user-menu__item" role="menuitem" @click="goToProfile">
          <i class="pi pi-user user-menu__item-icon" />
          <span>Profil</span>
        </button>

        <button class="user-menu__item" role="menuitem" @click="toggleDark">
          <i :class="`pi ${darkMode.isDark.value ? 'pi-sun' : 'pi-moon'} user-menu__item-icon`" />
          <span>{{ darkMode.isDark.value ? 'Mode clair' : 'Mode sombre' }}</span>
          <span class="user-menu__item-badge" :class="darkMode.isDark.value ? 'badge-on' : 'badge-off'">
            {{ darkMode.isDark.value ? 'On' : 'Off' }}
          </span>
        </button>

        <div class="user-menu__divider" role="separator" />

        <button class="user-menu__item user-menu__item--danger" role="menuitem" @click="handleLogout">
          <i class="pi pi-sign-out user-menu__item-icon" />
          <span>Déconnexion</span>
        </button>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/authStore'
import { useDarkMode } from '@/composables/useDarkMode'
import { USER_ROLE_LABELS } from '@/types/user.types'
import type { UserRole } from '@/types/user.types'

// ─── Composables & stores ─────────────────────────────────────────────────────

const authStore = useAuthStore()
const darkMode = useDarkMode()
const router = useRouter()

// ─── State ────────────────────────────────────────────────────────────────────

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)

// ─── Computed ─────────────────────────────────────────────────────────────────

const roleLabel = computed<string>(() => {
  const role = authStore.userRole as UserRole | null
  if (!role) return ''
  return USER_ROLE_LABELS[role] ?? role
})

// ─── Methods ──────────────────────────────────────────────────────────────────

function toggleOpen(): void {
  open.value = !open.value
}

function close(): void {
  open.value = false
}

function goToProfile(): void {
  close()
  router.push('/app/profile')
}

function toggleDark(): void {
  darkMode.toggle()
}

async function handleLogout(): Promise<void> {
  close()
  await authStore.logout()
  router.push('/login')
}

// ─── Click-outside to close ───────────────────────────────────────────────────

function onDocumentClick(event: MouseEvent): void {
  if (rootRef.value && !rootRef.value.contains(event.target as Node)) {
    close()
  }
}

onMounted(() => document.addEventListener('mousedown', onDocumentClick))
onUnmounted(() => document.removeEventListener('mousedown', onDocumentClick))
</script>

<style scoped>
/* ── Container ─────────────────────────────────────────────────────────────── */
.user-menu {
  position: relative;
}

/* ── Trigger button ────────────────────────────────────────────────────────── */
.user-menu__trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 8px;
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  background: transparent;
  cursor: pointer;
  font-family: var(--nl-font);
  color: var(--nl-text-1);
  transition: background 0.2s cubic-bezier(0.16, 1, 0.3, 1),
              border-color 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  outline: none;
}

.user-menu__trigger:hover,
.user-menu__trigger--open {
  background: var(--nl-surface-2);
  border-color: var(--nl-border-strong);
}

.user-menu__trigger:focus-visible {
  outline: 2px solid var(--nl-accent);
  outline-offset: 2px;
}

/* ── Avatar circle ─────────────────────────────────────────────────────────── */
.user-menu__avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--nl-accent);
  color: #fff;
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  flex-shrink: 0;
  user-select: none;
}

.user-menu__avatar--lg {
  width: 38px;
  height: 38px;
  font-size: 0.8125rem;
}

/* ── Trigger text info ─────────────────────────────────────────────────────── */
.user-menu__info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.2;
}

.user-menu__name {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--nl-text-1);
  white-space: nowrap;
}

.user-menu__role {
  font-size: 0.6875rem;
  color: var(--nl-text-3);
  white-space: nowrap;
}

/* ── Chevron ───────────────────────────────────────────────────────────────── */
.user-menu__chevron {
  font-size: 0.75rem;
  color: var(--nl-text-3);
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.user-menu__chevron--open {
  transform: rotate(180deg);
}

/* ── Dropdown panel ────────────────────────────────────────────────────────── */
.user-menu__dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 220px;
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg);
  box-shadow: var(--nl-shadow-lg);
  overflow: hidden;
  /* Lifted so it escapes the topbar's stacking context (z-index: 50) and
     clears the sidebar (z-index: 100), row menus (9500), etc. */
  z-index: 9500;
}

/* ── Header ────────────────────────────────────────────────────────────────── */
.user-menu__header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 14px 10px;
}

.user-menu__header-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.user-menu__header-name {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--nl-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-menu__header-role {
  font-size: 0.6875rem;
  color: var(--nl-text-3);
}

/* ── Divider ───────────────────────────────────────────────────────────────── */
.user-menu__divider {
  height: 1px;
  background: var(--nl-border);
  margin: 4px 0;
}

/* ── Menu items ────────────────────────────────────────────────────────────── */
.user-menu__item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 14px;
  border: none;
  background: transparent;
  color: var(--nl-text-2);
  font-family: var(--nl-font);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s cubic-bezier(0.16, 1, 0.3, 1),
              color 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  outline: none;
}

.user-menu__item:hover {
  background: var(--nl-surface-2);
  color: var(--nl-text-1);
}

.user-menu__item:focus-visible {
  outline: 2px solid var(--nl-accent);
  outline-offset: -2px;
}

.user-menu__item--danger {
  color: var(--nl-danger);
}

.user-menu__item--danger:hover {
  background: var(--nl-danger-light);
  color: var(--nl-danger);
}

.user-menu__item-icon {
  font-size: 0.875rem;
  flex-shrink: 0;
  width: 16px;
  text-align: center;
}

.user-menu__item-badge {
  margin-left: auto;
  font-size: 0.625rem;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 10px;
}

.badge-on {
  background: var(--nl-accent-light);
  color: var(--nl-accent);
}

.badge-off {
  background: var(--nl-surface-2);
  color: var(--nl-text-3);
}

/* ── Dropdown animation ────────────────────────────────────────────────────── */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1),
              transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.97);
}
</style>
