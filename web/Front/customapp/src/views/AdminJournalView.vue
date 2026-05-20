<!--
  @file AdminJournalView.vue — unified admin "Journal" page.
  Folds the two near-identical admin log pages into one tabbed view:
    • Activité  — business/project event feed (ProjectActivity)
    • Audit     — security/compliance trail with before→after diffs (AuditLog)
  The live System-status dashboard stays separate (it's health, not history).
-->
<template>
  <div class="journal">
    <div class="journal__tabs" role="tablist">
      <button
        type="button"
        role="tab"
        class="journal__tab"
        :class="{ 'journal__tab--active': tab === 'activity' }"
        :aria-selected="tab === 'activity'"
        @click="setTab('activity')"
      >
        <i class="pi pi-history" /> Activité projets
      </button>
      <button
        type="button"
        role="tab"
        class="journal__tab"
        :class="{ 'journal__tab--active': tab === 'audit' }"
        :aria-selected="tab === 'audit'"
        @click="setTab('audit')"
      >
        <i class="pi pi-shield" /> Audit &amp; sécurité
      </button>
    </div>

    <p class="journal__hint">
      <template v-if="tab === 'activity'">
        Journal métier des actions sur les projets (créations, changements de phase, validations…).
      </template>
      <template v-else>
        Traçabilité de sécurité et conformité : mutations (avant → après), connexions, réinitialisations.
      </template>
    </p>

    <ActivitySection v-if="tab === 'activity'" />
    <AuditLogView v-else />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ActivitySection from '@/components/admin/sections/ActivitySection.vue'
import AuditLogView from '@/views/AuditLogView.vue'

type Tab = 'activity' | 'audit'

const route = useRoute()
const router = useRouter()

const tab = ref<Tab>(route.query.tab === 'audit' ? 'audit' : 'activity')

function setTab(t: Tab): void {
  tab.value = t
  // Keep the tab in the URL so it's deep-linkable / refresh-safe.
  void router.replace({ query: { ...route.query, tab: t } })
}
</script>

<style scoped>
.journal {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.journal__tabs {
  display: flex;
  gap: 0.25rem;
  border-bottom: 1px solid var(--nl-border, #e5e7eb);
}

.journal__tab {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.65rem 1.1rem;
  border: none;
  background: transparent;
  border-bottom: 2px solid transparent;
  color: var(--nl-text-2, #6b7280);
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  margin-bottom: -1px;
}

.journal__tab:hover {
  color: var(--nl-text-1, #111827);
}

.journal__tab--active {
  color: var(--nl-accent, #0d9488);
  border-bottom-color: var(--nl-accent, #0d9488);
}

.journal__hint {
  margin: 0;
  font-size: 0.8rem;
  color: var(--nl-text-3, #9ca3af);
}
</style>
