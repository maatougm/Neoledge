<!-- @file src/layouts/SidebarNavItem.vue — Individual nav item for the sidebar rail -->
<template>
  <router-link
    :to="item.to"
    class="nav-item"
    :class="{ 'nav-item--active': isActive }"
    :title="collapsed ? item.label : undefined"
    @click.prevent="navigate"
  >
    <!-- Icon wrapper with optional badge -->
    <span class="nav-item__icon-wrap">
      <i :class="`pi ${item.icon}`" class="nav-item__icon" />
      <span v-if="badgeValue && badgeValue > 0" class="nav-item__badge" aria-label="badge">
        {{ badgeValue > 99 ? '99+' : badgeValue }}
      </span>
    </span>

    <!-- Label — only rendered in expanded mode -->
    <span v-if="!collapsed" class="nav-item__label">{{ item.label }}</span>

    <!-- Collapsed tooltip — accessible label shown on hover via CSS -->
    <span v-if="collapsed" class="nav-item__tooltip" role="tooltip">{{ item.label }}</span>
  </router-link>
</template>

<script setup lang="ts">
import { computed, isRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { NavItem } from '@/types/nav.types'

// ─── Props ────────────────────────────────────────────────────────────────────

const props = defineProps<{
  item: NavItem
  collapsed: boolean
}>()

// ─── Composables ─────────────────────────────────────────────────────────────

const route = useRoute()
const router = useRouter()

// ─── Computed ─────────────────────────────────────────────────────────────────

/**
 * Active highlight rule — avoids the "Aperçu" (project index) staying highlighted
 * on every sub-route of the project.
 *
 * - /app/pm/projects/X              → exact match only (index route)
 * - Everything else                 → prefix match (so a sub-route stays active
 *   on any of its nested pages, e.g. /workpackages?wpId=…)
 *
 * Heuristic: a "leaf" item ends in a segment with a slash (e.g. "/workpackages").
 * The project-overview item is the only one whose `to` is the bare project path
 * (ends with the projectId UUID, no trailing segment).
 */
const isActive = computed<boolean>(() => {
  const to = props.item.to
  const path = route.path
  // Project overview (bare /app/pm/projects/:id) must be EXACT — otherwise it would
  // stay highlighted on every sub-route (workpackages, gantt, etc.)
  const PROJECT_OVERVIEW_RE = /^\/app\/pm\/projects\/[^/]+$/
  if (PROJECT_OVERVIEW_RE.test(to)) return path === to
  // List pages (`/app/pm/projects`, `/app/admin/projects`, `/app/team/projects`) must NOT
  // stay highlighted while the user is inside a specific project — the per-project
  // contextual sidebar already shows where they are. Otherwise both the list link AND
  // the contextual project items light up at the same time.
  const LIST_PAGES = ['/app/pm/projects', '/app/admin/projects', '/app/team/projects']
  if (LIST_PAGES.includes(to)) return path === to
  return path === to || path.startsWith(to + '/')
})

const badgeValue = computed<number>(() => {
  if (props.item.badge === undefined) return 0
  if (isRef(props.item.badge)) return props.item.badge.value
  return props.item.badge as number
})

// ─── Methods ──────────────────────────────────────────────────────────────────

function navigate(): void {
  router.push(props.item.to)
}
</script>

<style scoped>
.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 40px;
  /* 2px transparent left border so layout doesn't shift on active */
  padding: 0 0 0 16px;
  border: none;
  border-left: 2px solid transparent;
  background: transparent;
  color: var(--nl-nav-text);
  text-decoration: none;
  cursor: pointer;
  border-radius: 0 var(--nl-radius) var(--nl-radius) 0;
  transition: background 0.2s cubic-bezier(0.16, 1, 0.3, 1),
              color 0.2s cubic-bezier(0.16, 1, 0.3, 1),
              border-color 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  margin: 1px 8px 1px 0;
  outline: none;
}

.nav-item:hover {
  background: var(--nl-nav-item-hover-bg);
  color: var(--nl-nav-text-active);
}

.nav-item:focus-visible {
  outline: 2px solid var(--nl-accent);
  outline-offset: 2px;
}

.nav-item--active {
  border-left: 2px solid var(--nl-nav-active-border);
  background: var(--nl-nav-item-active-bg);
  color: var(--nl-nav-text-active);
}

.nav-item--active:hover {
  background: var(--nl-nav-item-active-bg);
}

/* Icon wrapper */
.nav-item__icon-wrap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
}

.nav-item__icon {
  font-size: 1rem;
  line-height: 1;
}

/* Badge */
.nav-item__badge {
  position: absolute;
  top: -6px;
  right: -8px;
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

/* Label */
.nav-item__label {
  font-size: 0.8125rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

/* Collapsed tooltip */
.nav-item__tooltip {
  position: absolute;
  left: calc(100% + 12px);
  top: 50%;
  transform: translateY(-50%);
  background: #1E293B;
  color: #F8FAFC;
  font-size: 0.75rem;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: var(--nl-radius);
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  z-index: 200;
  box-shadow: var(--nl-shadow-lg);
}

.nav-item__tooltip::before {
  content: '';
  position: absolute;
  right: 100%;
  top: 50%;
  transform: translateY(-50%);
  border: 5px solid transparent;
  border-right-color: #1E293B;
}

.nav-item:hover .nav-item__tooltip {
  opacity: 1;
}
</style>
