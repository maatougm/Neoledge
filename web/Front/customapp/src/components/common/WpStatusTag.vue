<!-- @file src/components/common/WpStatusTag.vue — Renders a NeoTag for a work package status -->
<template>
  <NeoTag :value="value" :severity="severity" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NeoTag } from '@neolibrary/components'

const props = defineProps<{ status: string }>()

const severity = computed<'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast'>(() => {
  switch (props.status) {
    case 'New':        return 'secondary'
    case 'InProgress': return 'info'
    case 'Resolved':   return 'success'
    case 'Closed':     return 'success'
    case 'OnHold':     return 'warn'
    case 'Rejected':   return 'danger'
    default:           return 'secondary'
  }
})

const value = computed(() => {
  switch (props.status) {
    case 'InProgress': return 'In Progress'
    case 'OnHold':     return 'On Hold'
    default:           return props.status
  }
})
</script>
