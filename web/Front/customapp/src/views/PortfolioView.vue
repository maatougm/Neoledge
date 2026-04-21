<!-- @file src/views/PortfolioView.vue — Admin portfolio management -->
<template>
  <div class="pf-view">
    <ModulePageHeader title="Portefeuille">
      <template #actions>
        <NeoButton label="Nouveau portefeuille" icon="pi pi-plus" @click="showCreate = true" />
      </template>
    </ModulePageHeader>

    <div v-if="!portfolioStore.currentPortfolio" class="pf-content">
      <div class="pf-cards">
        <div
          v-for="p in portfolioStore.portfolios"
          :key="p.id"
          class="pf-card"
          @click="openPortfolio(p.id)"
        >
          <h3>{{ p.name }}</h3>
          <p class="pf-card__desc">{{ p.description ?? 'Pas de description.' }}</p>
          <div class="pf-card__meta">
            <NeoTag :value="`${p._count?.projects ?? 0} projets`" severity="info" />
          </div>
        </div>
        <div v-if="!portfolioStore.portfolios.length" class="pf-empty">Aucun portefeuille.</div>
      </div>
    </div>

    <div v-else class="pf-content">
      <div class="pf-detail-header">
        <NeoButton icon="pi pi-arrow-left" text label="Retour" @click="portfolioStore.currentPortfolio = null" />
        <h2>{{ portfolioStore.currentPortfolio.name }}</h2>
      </div>
      <p>{{ portfolioStore.currentPortfolio.description }}</p>
      <table class="pf-table">
        <thead>
          <tr><th>Projet</th><th>Statut</th></tr>
        </thead>
        <tbody>
          <tr v-for="pp in portfolioStore.currentPortfolio.projects" :key="pp.id">
            <td>{{ pp.project.name }}</td>
            <td><NeoTag :value="pp.project.status" severity="info" /></td>
          </tr>
        </tbody>
      </table>
    </div>

    <AppModal v-model:visible="showCreate" header="Nouveau portefeuille" width="480px">
      <div class="pf-form">
        <NeoInputText v-model="form.name" label="Nom" placeholder="Nom du portefeuille" />
        <NeoInputText v-model="form.description" label="Description" />
      </div>
      <template #footer>
        <NeoButton label="Annuler" severity="secondary" outlined @click="showCreate = false" />
        <NeoButton label="Créer" icon="pi pi-check" @click="submit" />
      </template>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { NeoButton, NeoInputText, NeoTag, useNeoToast } from '@neolibrary/components'
import AppModal from '@/components/common/AppModal.vue'
import ModulePageHeader from '@/components/common/ModulePageHeader.vue'
import { usePortfolioStore } from '@/stores/portfolioStore'

const toast = useNeoToast()
const portfolioStore = usePortfolioStore()

const showCreate = ref(false)
const form = reactive({ name: '', description: '' })

async function openPortfolio(id: string) {
  await portfolioStore.fetchOne(id)
}

async function submit() {
  if (!form.name.trim()) return
  await portfolioStore.create({ name: form.name.trim(), description: form.description || undefined })
  showCreate.value = false
  form.name = ''
  form.description = ''
  toast.add({ severity: 'success', detail: 'Portefeuille créé.', life: 3000 })
}

onMounted(() => portfolioStore.fetchAll())
</script>

<style scoped>
.pf-view { display: flex; flex-direction: column; height: 100%; background: var(--nl-bg, #f5f7f9); }
.pf-content { flex: 1; overflow-y: auto; padding: 1.5rem; }
.pf-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; }
.pf-card {
  background: var(--nl-card-bg, #fff);
  padding: 1.25rem;
  border-radius: 8px;
  border: 1px solid var(--nl-border, #e5e7eb);
  cursor: pointer;
  transition: box-shadow 0.15s;
}
.pf-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
.pf-card h3 { margin: 0 0 0.5rem; font-size: 1.125rem; }
.pf-card__desc { color: var(--nl-text-muted, #6b7280); font-size: 0.875rem; margin: 0 0 0.75rem; }
.pf-card__meta { display: flex; gap: 0.5rem; }
.pf-empty { text-align: center; color: var(--nl-text-muted, #9ca3af); padding: 3rem; }
.pf-detail-header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }
.pf-detail-header h2 { margin: 0; }
.pf-table { width: 100%; background: var(--nl-card-bg, #fff); border-radius: 8px; overflow: hidden; border: 1px solid var(--nl-border, #e5e7eb); border-collapse: collapse; }
.pf-table th, .pf-table td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid var(--nl-border, #f3f4f6); }
.pf-table th { background: var(--nl-table-header-bg, #f3f4f6); font-size: 0.75rem; font-weight: 600; text-transform: uppercase; }
.pf-form { display: flex; flex-direction: column; gap: 0.75rem; }
</style>
