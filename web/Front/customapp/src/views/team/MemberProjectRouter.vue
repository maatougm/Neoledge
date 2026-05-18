<!-- @file MemberProjectRouter.vue — branches by role. Member gets the new
     Member-tuned project view; SpecificationTeam keeps the existing
     read-only PMProjectFullView wrapper. -->
<template>
  <component :is="resolvedComponent" :id="id" />
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'
import { useAuthStore } from '@/stores/authStore'

const props = defineProps<{ id: string }>()
const auth = useAuthStore()

const MemberProjectView = defineAsyncComponent(() => import('@/views/team/MemberProjectView.vue'))
const PMProjectFullView = defineAsyncComponent(() => import('@/views/PMProjectFullView.vue'))

const resolvedComponent = computed(() =>
  auth.userRole === 'Member' ? MemberProjectView : PMProjectFullView,
)
// Silence unused-warning on hot reload (id is forwarded via :id binding).
void props
</script>
