<!-- @file src/layouts/AppSidebar.vue — Workspace sidebar (labelled nav + recents + pinned projects) -->
<template>
  <aside
    class="sidebar"
    :class="{ 'sidebar--expanded': isExpanded, 'sidebar--pinned': uiStore.sidebarPinned }"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
  >
    <!-- Logo -->
    <div class="sidebar__logo">
      <div class="sidebar__logo-pill"><NeoMark class="sidebar__logo-mark" /></div>
      <transition name="fade-slide">
        <img v-if="isExpanded" :src="logoUrl" alt="NeoLeadge" class="sidebar__logo-img" />
      </transition>
    </div>

    <!-- Nav sections — scrollable -->
    <nav class="sidebar__nav" aria-label="Navigation principale">
      <!-- Role-based nav sections -->
      <template v-for="(section, sIdx) in navSections" :key="`nav-${sIdx}`">
        <div v-if="sIdx > 0" class="sidebar__separator" role="separator" />
        <transition name="fade-slide">
          <p v-if="isExpanded && section.heading" class="sidebar__section-heading">
            {{ section.heading }}
          </p>
        </transition>
        <SidebarNavItem
          v-for="item in section.items"
          :key="item.key"
          :item="item"
          :collapsed="!isExpanded"
        />
      </template>

      <!-- Pinned projects — only when expanded & we have any -->
      <template v-if="isExpanded && pinned.length > 0">
        <div class="sidebar__separator" role="separator" />
        <p class="sidebar__section-heading">Épinglés</p>
        <RouterLink
          v-for="proj in pinned"
          :key="`pin-${proj.id}`"
          :to="`/app/pm/projects/${proj.id}`"
          class="sidebar__project-link"
          :title="proj.name"
        >
          <i class="pi pi-thumbtack sidebar__project-icon" aria-hidden="true" />
          <span class="sidebar__project-name">{{ proj.name }}</span>
        </RouterLink>
      </template>

      <!-- Recent projects — only when expanded & we have any -->
      <template v-if="isExpanded && recentsToShow.length > 0">
        <div class="sidebar__separator" role="separator" />
        <p class="sidebar__section-heading">Récents</p>
        <RouterLink
          v-for="proj in recentsToShow"
          :key="`recent-${proj.id}`"
          :to="`/app/pm/projects/${proj.id}`"
          class="sidebar__project-link"
          :title="proj.name"
        >
          <i class="pi pi-clock sidebar__project-icon" aria-hidden="true" />
          <span class="sidebar__project-name">{{ proj.name }}</span>
        </RouterLink>
      </template>
    </nav>

    <!-- Footer — pin toggle + Cmd-K hint -->
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
            {{ uiStore.sidebarPinned ? 'Réduire' : 'Épingler' }}
          </span>
        </transition>
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, inject, computed } from 'vue'
import { useUiStore } from '@/stores/uiStore'
import logoUrl from '@/assets/neoledge-logo.png'
import NeoMark from '@/components/common/NeoMark.vue'
import SidebarNavItem from './SidebarNavItem.vue'
import type { NavSection } from '@/types/nav.types'
import type { RecentProject } from '@/stores/uiStore'

const uiStore = useUiStore()
const navSections = inject<NavSection[]>('navItems', [])
const hovered = ref(false)

const isExpanded = computed<boolean>(() => hovered.value || uiStore.sidebarPinned)

// Split: show pinned projects above recents; recents excludes anything already pinned.
const pinned = computed<RecentProject[]>(() =>
  uiStore.recentProjects.filter((r) => uiStore.pinnedProjectIds.includes(r.id)),
)

const recentsToShow = computed<RecentProject[]>(() =>
  uiStore.recentProjects
    .filter((r) => !uiStore.pinnedProjectIds.includes(r.id))
    .slice(0, 4),
)
</script>

<style scoped>
.sidebar {
  position: fixed; left: 0; top: 0; bottom: 0;
  width: var(--nl-rail-width);
  background: var(--nl-nav-bg);
  display: flex; flex-direction: column;
  z-index: 100; overflow: hidden;
  transition: width 0.25s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s ease;
  border-right: 1px solid var(--nl-nav-separator);
}
.sidebar--expanded { width: var(--nl-rail-expanded-width); }

@media (max-width: 768px) {
  .sidebar {
    width: var(--nl-rail-expanded-width);
    transform: translateX(-100%);
  }
  .sidebar--open { transform: translateX(0); }
}

.sidebar__logo {
  display: flex; align-items: center; gap: 10px;
  height: var(--nl-topbar-height); padding: 0 8px;
  flex-shrink: 0; border-bottom: 1px solid var(--nl-nav-separator);
  overflow: hidden;
}
.sidebar__logo-pill {
  flex-shrink: 0; width: 40px; height: 40px;
  display: flex; align-items: center; justify-content: center;
}
/* Transparent vector mark — inherits this colour as its fill (no white tile). */
.sidebar__logo-mark {
  width: 100%; height: 100%; display: block;
  color: var(--nl-accent);
}
.sidebar__logo-name {
  font-size: 0.9375rem; font-weight: 700;
  color: var(--nl-nav-text-active); white-space: nowrap; letter-spacing: -0.01em;
}
.sidebar__logo-img {
  height: 26px; width: auto; display: block; object-fit: contain;
}

.sidebar__nav {
  flex: 1; overflow-y: auto; overflow-x: hidden; padding: 8px 0;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
}
.sidebar__nav::-webkit-scrollbar { width: 4px; }
.sidebar__nav::-webkit-scrollbar-track { background: transparent; }
.sidebar__nav::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 2px; }

.sidebar__section-heading {
  padding: 12px 16px 4px 16px;
  font-size: 0.625rem; font-weight: 700;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: rgba(148, 163, 184, 0.5);
  white-space: nowrap; overflow: hidden; margin: 0;
}

.sidebar__separator {
  height: 1px; background: var(--nl-nav-separator); margin: 6px 12px;
}

.sidebar__project-link {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 16px; color: var(--nl-nav-text);
  font-size: 0.8125rem; font-weight: 500; line-height: 1.3;
  text-decoration: none; white-space: nowrap; overflow: hidden;
  transition: background 0.15s, color 0.15s;
}
.sidebar__project-link:hover {
  background: var(--nl-nav-item-hover-bg); color: var(--nl-nav-text-active);
}
.sidebar__project-link.router-link-active {
  color: var(--nl-nav-text-active);
  background: var(--nl-nav-item-active-bg);
}
.sidebar__project-icon { font-size: 0.75rem; flex-shrink: 0; opacity: 0.65; }
.sidebar__project-name { overflow: hidden; text-overflow: ellipsis; }

.sidebar__footer {
  flex-shrink: 0; padding: 8px 0;
  border-top: 1px solid var(--nl-nav-separator); overflow: hidden;
}
.sidebar__pin-btn {
  display: flex; align-items: center; gap: 10px;
  width: 100%; min-height: 40px; padding: 0 0 0 18px;
  border: none; background: transparent;
  color: var(--nl-nav-text); cursor: pointer;
  font-family: var(--nl-font); font-size: 0.8125rem; font-weight: 500;
  transition: background 0.25s, color 0.25s;
  outline: none;
}
.sidebar__pin-btn:hover {
  background: var(--nl-nav-item-hover-bg); color: var(--nl-nav-text-active);
}
.sidebar__pin-btn:focus-visible { outline: 2px solid var(--nl-accent); outline-offset: 2px; }
.sidebar__pin-icon {
  font-size: 0.875rem; flex-shrink: 0;
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.sidebar__pin-btn--pinned .sidebar__pin-icon { transform: rotate(-45deg); color: var(--nl-accent); }
.sidebar__pin-label { white-space: nowrap; }

.fade-slide-enter-active, .fade-slide-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.fade-slide-enter-from, .fade-slide-leave-to { opacity: 0; transform: translateX(-6px); }
</style>
