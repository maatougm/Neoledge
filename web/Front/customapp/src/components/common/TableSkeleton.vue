<!-- @file TableSkeleton.vue — N rows × M columns placeholder for data tables -->
<template>
  <div class="table-skel">
    <div v-for="row in rows" :key="row" class="table-skel__row">
      <AppSkeleton
        v-for="col in cols"
        :key="col"
        :width="colWidth(col)"
        height="14px"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import AppSkeleton from './AppSkeleton.vue'

const props = withDefaults(defineProps<{ rows?: number; cols?: number }>(), {
  rows: 6,
  cols: 5,
})

function colWidth(col: number): string {
  // Varied widths per column to mimic realistic table content
  const widths = ['40%', '15%', '12%', '18%', '15%', '20%']
  return widths[(col - 1) % widths.length]
}
</script>

<style scoped>
.table-skel { display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem 1.25rem; }
.table-skel__row {
  display: flex;
  gap: 1.5rem;
  align-items: center;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--nl-border, #f3f4f6);
}
</style>
