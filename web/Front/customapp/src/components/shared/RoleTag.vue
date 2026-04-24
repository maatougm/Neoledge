<!--
  @file     RoleTag.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Pill-shaped role badge with per-role color mapping
-->
<template>
  <span :class="['role-tag', colorClass]" :aria-label="label">
    {{ label }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { USER_ROLE_LABELS } from '@/types/user.types'
import type { UserRole } from '@/types/user.types'

interface Props {
  role: string
}

const props = defineProps<Props>()

const label = computed(
  () => USER_ROLE_LABELS[props.role as UserRole] ?? props.role,
)

const colorClass = computed(() => {
  const map: Record<string, string> = {
    Admin:             'role-tag--admin',
    ProjectManager:    'role-tag--pm',
    SpecificationTeam: 'role-tag--team',
    Member:            'role-tag--team',
    DeploymentTeam:    'role-tag--team',
  }
  return map[props.role] ?? 'role-tag--unknown'
})
</script>

<style scoped>
/* ── Base pill ──────────────────────────────────────────────────────────────── */
.role-tag {
  display: inline-flex;
  align-items: center;
  border-radius: var(--nl-radius-pill, 9999px);
  padding: 2px 10px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.6;
  white-space: nowrap;
  font-family: var(--nl-font, Inter, system-ui, sans-serif);
}

/* ── Color variants ─────────────────────────────────────────────────────────── */
.role-tag--admin {
  background: #EFF4FF;
  color: #0F62FE;
}

.role-tag--pm {
  background: #F5F3FF;
  color: #7C3AED;
}

.role-tag--team {
  background: #F0FDF4;
  color: #16A34A;
}

.role-tag--unknown {
  background: #F4F4F5;
  color: #71717A;
}
</style>
