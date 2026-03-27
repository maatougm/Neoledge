<template>
  <ul>
    <li v-for="item in props.messages" :key="item">
      {{ item }}
    </li>
  </ul>
</template>

<script setup lang="ts">
import { defineProps } from 'vue'
const props = defineProps({
  messages: {
    type: Array<string>,
    default: () => []
  }
})
</script>
