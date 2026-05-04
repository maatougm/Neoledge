<!-- @file src/components/common/WpStatusTag.vue — Renders a NeoTag for a work package status -->
<template>
  <NeoTag :value="label" :severity="severity" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NeoTag } from '@neolibrary/components'
import { getWpStatus } from '@/lib/wpStatusMap'

const props = defineProps<{ status: string }>()

const entry    = computed(() => getWpStatus(props.status))
const label    = computed(() => entry.value.label || props.status)
const severity = computed(() => entry.value.severity)
</script>
