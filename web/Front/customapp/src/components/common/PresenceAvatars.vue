<template>
  <div class="presence-avatars">
    <div
      v-for="user in visibleUsers"
      :key="user.userId"
      class="avatar"
      :style="{ background: user.color }"
      :title="user.name"
      :aria-label="user.name"
    >
      {{ user.name[0]?.toUpperCase() ?? '?' }}
    </div>
    <div
      v-if="hiddenCount > 0"
      class="avatar avatar--more"
      :title="`+${hiddenCount} autres`"
      :aria-label="`${hiddenCount} autres utilisateurs`"
    >
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
}

.avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  cursor: default;
  flex-shrink: 0;
  border: 2px solid var(--nl-surface);
  user-select: none;
  transition: transform 0.15s ease, z-index 0s;
  position: relative;
  margin-left: -8px;
}

.avatar:first-child {
  margin-left: 0;
}

.avatar:hover {
  transform: scale(1.15);
  z-index: 10;
}

.avatar--more {
  background: var(--nl-surface-2);
  color: var(--nl-text-2);
  font-size: 11px;
  font-weight: 600;
  border-color: var(--nl-surface);
}
</style>
