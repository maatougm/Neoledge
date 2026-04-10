<!--
  @file     RoleTag.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Maps UserRole to NeoTag severity + French label
-->
<template>
  <NeoTag :value="label" :severity="severity" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NeoTag } from '@neolibrary/components'
import { USER_ROLE_LABELS } from '@/types/user.types'
import type { UserRole } from '@/types/user.types'

interface Props {
  role: string
}

const props = defineProps<Props>()

const ROLE_SEVERITY: Record<UserRole, string> = {
  Admin:             'danger',
  ProjectManager:    'info',
  SpecificationTeam: 'success',
  RealizationTeam:   'warn',
  DeploymentTeam:    'secondary',
  Viewer:            'contrast',
}

const label = computed(
  () => USER_ROLE_LABELS[props.role as UserRole] ?? props.role,
)

type NeoTagSeverity = 'primary' | 'secondary' | 'success' | 'info' | 'warn' | 'danger' | 'contrast'
const severity = computed(
  () => (ROLE_SEVERITY[props.role as UserRole] ?? 'secondary') as NeoTagSeverity,
)
</script>
