<!-- @file AppSkeleton.vue — Shimmering placeholder lines used during loading -->
<template>
  <div class="skeleton" :class="`skeleton--${variant}`" :style="{ width, height }" />
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  /** 'line' (default) | 'block' | 'circle' */
  variant?: 'line' | 'block' | 'circle'
  width?: string
  height?: string
}>(), {
  variant: 'line',
  width: '100%',
  height: '16px',
})
</script>

<style scoped>
.skeleton {
  display: inline-block;
  border-radius: 4px;
  background: linear-gradient(
    90deg,
    var(--nl-surface-2, #eef2f7) 25%,
    var(--nl-border, #e5e7eb) 50%,
    var(--nl-surface-2, #eef2f7) 75%
  );
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.4s infinite linear;
}
.skeleton--block { display: block; border-radius: 6px; }
.skeleton--circle { border-radius: 50%; aspect-ratio: 1/1; }

@keyframes skeleton-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
