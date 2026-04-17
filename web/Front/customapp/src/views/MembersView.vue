<!-- @file src/views/MembersView.vue — Project members table (read-only) -->
<template>
  <ProjectModuleShell :project-id="id" title="Membres">
    <div class="mem-content">
      <table class="mem-table">
        <thead>
          <tr>
            <th>Nom</th>
            <th>Email</th>
            <th>Rôle</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td>{{ u.firstName }} {{ u.lastName }}</td>
            <td>{{ u.email }}</td>
            <td><NeoTag :value="u.role" severity="info" /></td>
          </tr>
          <tr v-if="!users.length"><td colspan="3" class="mem-empty">Aucun membre.</td></tr>
        </tbody>
      </table>
    </div>
  </ProjectModuleShell>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { NeoTag } from '@neolibrary/components'
import ProjectModuleShell from '@/components/common/ProjectModuleShell.vue'
import api from '@/lib/api'

const props = defineProps<{ id: string }>()
void props

interface User { id: string; firstName: string; lastName: string; email: string; role: string }

const users = ref<User[]>([])

onMounted(async () => {
  try {
    const { data } = await api.get<User[] | { items: User[] }>('/pm/users')
    users.value = Array.isArray(data) ? data : (data.items ?? [])
  } catch {
    users.value = []
  }
})
</script>

<style scoped>
.mem-view { display: flex; flex-direction: column; height: 100%; background: var(--nl-bg, #f5f7f9); }
.mem-content { flex: 1; overflow-y: auto; padding: 1.5rem; }
.mem-table { width: 100%; background: var(--nl-card-bg, #fff); border-radius: 8px; overflow: hidden; border: 1px solid var(--nl-border, #e5e7eb); border-collapse: collapse; }
.mem-table th, .mem-table td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid var(--nl-border, #f3f4f6); }
.mem-table th { background: var(--nl-table-header-bg, #f3f4f6); font-size: 0.75rem; font-weight: 600; text-transform: uppercase; color: var(--nl-text-muted, #6b7280); }
.mem-empty { text-align: center; color: var(--nl-text-muted, #9ca3af); padding: 2rem !important; }
</style>
