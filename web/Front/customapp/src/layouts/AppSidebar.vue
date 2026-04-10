<!-- @file src/layouts/AppSidebar.vue — Fixed sidebar nav rail with collapse/expand/pin -->
<template>
  <aside
    class="sidebar"
    :class="{ 'sidebar--expanded': isExpanded, 'sidebar--pinned': uiStore.sidebarPinned }"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
  >
    <!-- Logo area -->
    <div class="sidebar__logo">
      <div class="sidebar__logo-pill">
        <span class="sidebar__logo-text-short">NL</span>
      </div>
      <transition name="fade-slide">
        <span v-if="isExpanded" class="sidebar__logo-name">NeoLeadge</span>
      </transition>
    </div>

    <!-- Nav sections — scrollable -->
    <nav class="sidebar__nav" aria-label="Navigation principale">
      <template v-for="(section, sIdx) in navSections" :key="sIdx">
        <!-- Section separator -->
        <div v-if="sIdx > 0" class="sidebar__separator" role="separator" />

        <!-- Section heading (expanded only) -->
        <transition name="fade-slide">
          <p v-if="isExpanded && section.heading" class="sidebar__section-heading">
            {{ section.heading }}
          </p>
        </transition>

        <!-- Nav items -->
        <SidebarNavItem
          v-for="item in section.items"
          :key="item.key"
          :item="item"
          :collapsed="!isExpanded"
        />
      </template>
    </nav>

    <!-- Footer — pin button -->
    <div class="sidebar__footer">
      <button
        class="sidebar__pin-btn"
        :class="{ 'sidebar__pin-btn--pinned': uiStore.sidebarPinned }"
        :title="uiStore.sidebarPinned ? 'Désépingler le menu' : 'Épingler le menu'"
        @click="uiStore.toggleSidebarPinned()"
      >
        <i class="pi pi-thumbtack sidebar__pin-icon" />
        <transition name="fade-slide">
          <span v-if="isExpanded" class="sidebar__pin-label">
            {{ uiStore.sidebarPinned ? 'Désépingler' : 'Épingler' }}
          </span>
        </transition>
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, inject, computed } from 'vue'
import { useUiStore } from '@/stores/uiStore'
import SidebarNavItem from './SidebarNavItem.vue'
import type { NavSection } from '@/types/nav.types'

// ─── Stores ───────────────────────────────────────────────────────────────────

const uiStore = useUiStore()

// ─── Injected nav sections ────────────────────────────────────────────────────

const navSections = inject<NavSection[]>('navItems', [])

// ─── Local state ──────────────────────────────────────────────────────────────

const hovered = ref(false)

// ─── Computed ─────────────────────────────────────────────────────────────────

const isExpanded = computed<boolean>(() => hovered.value || uiStore.sidebarPinned)
</script>

<style scoped>
/* ── Shell ─────────────────────────────────────────────────────────────────── */
.sidebar {
  position: fixed;
  left: 0;
  top: 0;
  bottom: 0;
  width: var(--nl-rail-width);
  background: var(--nl-nav-bg);
  display: flex;
  flex-direction: column;
  z-index: 100;
  overflow: hidden;
  transition: width 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  border-right: 1px solid var(--nl-nav-separator);
}

.sidebar--expanded {
  width: var(--nl-rail-expanded-width);
}

/* ── Logo ──────────────────────────────────────────────────────────────────── */
.sidebar__logo {
  display: flex;
  align-items: center;
  gap: 10px;
  height: var(--nl-topbar-height);
  padding: 0 8px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--nl-nav-separator);
  overflow: hidden;
}

.sidebar__logo-pill {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--nl-accent);
  display: flex;
  align-items: center;
  justify-content: center;
}

.sidebar__logo-text-short {
  font-size: 0.875rem;
  font-weight: 800;
  color: #fff;
  letter-spacing: -0.02em;
}

.sidebar__logo-name {
  font-size: 0.9375rem;
  font-weight: 700;
  color: var(--nl-nav-text-active);
  white-space: nowrap;
  letter-spacing: -0.01em;
}

/* ── Nav ───────────────────────────────────────────────────────────────────── */
.sidebar__nav {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px 0;
  /* Subtle scrollbar */
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
}

.sidebar__nav::-webkit-scrollbar {
  width: 4px;
}

.sidebar__nav::-webkit-scrollbar-track {
  background: transparent;
}

.sidebar__nav::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
}

/* ── Section heading ───────────────────────────────────────────────────────── */
.sidebar__section-heading {
  padding: 12px 16px 4px 16px;
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(148, 163, 184, 0.5);
  white-space: nowrap;
  overflow: hidden;
}

/* ── Separator ─────────────────────────────────────────────────────────────── */
.sidebar__separator {
  height: 1px;
  background: var(--nl-nav-separator);
  margin: 6px 12px;
}

/* ── Footer ────────────────────────────────────────────────────────────────── */
.sidebar__footer {
  flex-shrink: 0;
  padding: 8px 0;
  border-top: 1px solid var(--nl-nav-separator);
  overflow: hidden;
}

.sidebar__pin-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 40px;
  padding: 0 0 0 18px;
  border: none;
  background: transparent;
  color: var(--nl-nav-text);
  cursor: pointer;
  font-family: var(--nl-font);
  font-size: 0.8125rem;
  font-weight: 500;
  transition: background 0.25s cubic-bezier(0.16, 1, 0.3, 1),
              color 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  outline: none;
}

.sidebar__pin-btn:hover {
  background: var(--nl-nav-item-hover-bg);
  color: var(--nl-nav-text-active);
}

.sidebar__pin-btn:focus-visible {
  outline: 2px solid var(--nl-accent);
  outline-offset: 2px;
}

.sidebar__pin-icon {
  font-size: 0.875rem;
  flex-shrink: 0;
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.sidebar__pin-btn--pinned .sidebar__pin-icon {
  transform: rotate(-45deg);
  color: var(--nl-accent);
}

.sidebar__pin-label {
  white-space: nowrap;
}

/* ── Transitions ───────────────────────────────────────────────────────────── */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1),
              transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.fade-slide-enter-from,
.fade-slide-leave-to {
  opacity: 0;
  transform: translateX(-6px);
}
</style>
