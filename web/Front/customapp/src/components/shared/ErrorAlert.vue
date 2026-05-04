<!--
  @file     ErrorAlert.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Dismissible error message alert — renders only when message is non-null
-->
<template>
  <NeoMessage
    v-if="message"
    severity="error"
    :text="message"
    :closable="dismissible"
    class="error-alert"
    @close="emit('dismiss')"
  />
</template>

<script setup lang="ts">
import { NeoMessage } from '@neolibrary/components'

interface Props {
  message:      string | null
  dismissible?: boolean
}

withDefaults(defineProps<Props>(), {
  dismissible: true,
})

const emit = defineEmits<{
  dismiss: []
}>()
</script>

<style scoped>
.error-alert {
  width: 100%;
}
</style>
