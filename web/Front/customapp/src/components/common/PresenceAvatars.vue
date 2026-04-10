<template>
  <div class="presence-avatars">
    <div
      v-for="user in visibleUsers"
      :key="user.userId"
      class="avatar"
      :style="{ background: user.color }"
      :title="user.name"
    >
      {{ user.name[0]?.toUpperCase() ?? '?' }}
    </div>
    <div v-if="hiddenCount > 0" class="avatar avatar--more" :title="`+${hiddenCount} autres`">
      +{{ hiddenCount }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { PresenceUser } from '@/composables/useCollaborationSocket'

const MAX_VISIBLE = 5

const props = defineProps<{ presenceList: PresenceUser[] }>()

const visibleUsers = computed<PresenceUser[]>(() => props.presenceList.slice(0, MAX_VISIBLE))
const hiddenCount = computed<number>(() =>
  Math.max(0, props.presenceList.length - MAX_VISIBLE),
)
</script>

<style scoped>
.presence-avatars {
  display: flex;
  align-items: center;
  gap: 4px;
}

.avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  font-weight: 700;
  color: #fff;
  cursor: default;
  flex-shrink: 0;
  border: 2px solid var(--nl-surface-1, #fff);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  user-select: none;
  transition: transform 0.15s ease;
}

.avatar:hover {
  transform: scale(1.1);
  z-index: 1;
}

.avatar--more {
  background: var(--nl-surface-3, #cbd5e1);
  color: var(--nl-text-2, #475569);
  font-size: 0.65rem;
}
</style>
