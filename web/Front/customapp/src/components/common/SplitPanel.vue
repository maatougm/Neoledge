<!-- @file src/components/common/SplitPanel.vue — 35/65 list+detail responsive split layout -->
<template>
  <div class="split-panel" :class="{ 'split-panel--has-detail': showDetail }">
    <div class="split-panel__list">
      <slot name="list" />
    </div>
    <div v-if="showDetail" class="split-panel__detail">
      <slot name="detail" />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ showDetail: boolean }>()
</script>

<style scoped>
.split-panel {
  display: flex;
  height: 100%;
  overflow: hidden;
}
.split-panel__list {
  flex: 1;
  overflow-y: auto;
  min-width: 0;
}
.split-panel--has-detail .split-panel__list {
  width: 35%;
  flex: none;
  border-right: 1px solid var(--nl-border, #e5e7eb);
}
.split-panel__detail {
  flex: 1;
  overflow-y: auto;
  background: var(--nl-card-bg, #ffffff);
  min-width: 0;
}
@media (max-width: 900px) {
  .split-panel--has-detail .split-panel__list { display: none; }
  .split-panel__detail { width: 100%; }
}
</style>
