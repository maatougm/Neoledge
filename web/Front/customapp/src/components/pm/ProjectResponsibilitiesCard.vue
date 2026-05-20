<!--
  @file ProjectResponsibilitiesCard.vue — assign the team responsibles on a project.
  Wraps GET/PATCH /pm/projects/:id/responsibilities:
    • Responsable validation  → a SpecificationTeam user (owns cahier review)
    • Responsable déploiement → a Member user
  PM/Admin only (the parent gates rendering). Self-contained: loads its own
  options + current values and saves on change.
-->
<template>
  <div class="resp nl-card">
    <div class="resp__head">
      <h2 class="resp__title"><i class="pi pi-users" /> Responsabilités équipe</h2>
      <span v-if="saving" class="resp__saving"><i class="pi pi-spin pi-spinner" /> Enregistrement…</span>
    </div>

    <p class="resp__hint">
      Désignez l'équipe de spécification (validation du cahier) et le responsable du déploiement.
    </p>

    <div class="resp__field">
      <label class="resp__label">Responsable validation (spécification)</label>
      <NeoSelect
        v-model="validationResponsibleId"
        :options="specOptions"
        optionLabel="fullName"
        optionValue="id"
        placeholder="Choisir un membre de l'équipe spécification…"
        showClear
        filter
        :disabled="saving"
        @change="onSave"
      />
      <p v-if="!specOptions.length" class="resp__empty">Aucun utilisateur « Équipe spécification » actif.</p>
    </div>

    <div class="resp__field">
      <label class="resp__label">Responsable déploiement</label>
      <NeoSelect
        v-model="deploymentResponsibleId"
        :options="memberOptions"
        optionLabel="fullName"
        optionValue="id"
        placeholder="Choisir un membre…"
        showClear
        filter
        :disabled="saving"
        @change="onSave"
      />
      <p v-if="!memberOptions.length" class="resp__empty">Aucun membre actif.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { NeoSelect, useNeoToast } from '@neolibrary/components'
import api, { extractErrorMessage } from '@/lib/api'

const props = defineProps<{ projectId: string }>()
const toast = useNeoToast()

interface DirUser { id: string; firstName: string; lastName: string; email: string; role: string }
type UserOption = DirUser & { fullName: string }

interface ResponsibilitiesPayload {
  validationResponsibleId: string | null
  deploymentResponsibleId: string | null
}

const users = ref<UserOption[]>([])
const validationResponsibleId = ref<string | null>(null)
const deploymentResponsibleId = ref<string | null>(null)
const saving = ref(false)

const specOptions = computed<UserOption[]>(() => users.value.filter((u) => u.role === 'SpecificationTeam'))
const memberOptions = computed<UserOption[]>(() => users.value.filter((u) => u.role === 'Member'))

async function load(): Promise<void> {
  try {
    const [dir, current] = await Promise.all([
      api.get<DirUser[] | { items: DirUser[] }>('/pm/users?forMembers=true'),
      api.get<ResponsibilitiesPayload>(`/pm/projects/${props.projectId}/responsibilities`),
    ])
    const list = Array.isArray(dir.data) ? dir.data : (dir.data.items ?? [])
    users.value = list.map((u) => ({ ...u, fullName: `${u.firstName} ${u.lastName} (${u.email})` }))
    validationResponsibleId.value = current.data.validationResponsibleId
    deploymentResponsibleId.value = current.data.deploymentResponsibleId
  } catch (err) {
    toast.add({ severity: 'error', detail: extractErrorMessage(err) ?? 'Chargement des responsabilités impossible.', life: 4000 })
  }
}

async function onSave(): Promise<void> {
  saving.value = true
  try {
    await api.patch(`/pm/projects/${props.projectId}/responsibilities`, {
      validationResponsibleId: validationResponsibleId.value || null,
      deploymentResponsibleId: deploymentResponsibleId.value || null,
    })
    toast.add({ severity: 'success', detail: 'Responsabilités mises à jour.', life: 2500 })
  } catch (err) {
    toast.add({ severity: 'error', detail: extractErrorMessage(err) ?? 'Échec de l\'enregistrement.', life: 4000 })
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.resp { display: flex; flex-direction: column; gap: 0.75rem; }
.resp__head { display: flex; align-items: center; justify-content: space-between; }
.resp__title {
  margin: 0; font-size: 1rem; font-weight: 600; color: var(--nl-text-1);
  display: inline-flex; align-items: center; gap: 0.5rem;
}
.resp__title i { color: var(--nl-accent, #1e9e8f); }
.resp__saving { font-size: 0.78rem; color: var(--nl-text-3); display: inline-flex; align-items: center; gap: 0.35rem; }
.resp__hint { margin: 0; font-size: 0.8rem; color: var(--nl-text-3); }
.resp__field { display: flex; flex-direction: column; gap: 0.35rem; }
.resp__label { font-size: 0.8125rem; font-weight: 500; color: var(--nl-text-2, #374151); }
.resp__empty { margin: 0; font-size: 0.75rem; color: var(--nl-text-muted, #9ca3af); font-style: italic; }
</style>
