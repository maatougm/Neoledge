<!--
  ValidationComparisonPanel — 3-column view for the validation tab.
  Shows Questionnaire / Réunions / Cahier side by side so the validator
  can compare the source inputs against the AI-generated output.
-->
<template>
  <section class="vcmp">
    <header class="vcmp-head">
      <h4 class="vcmp-title">
        <i class="pi pi-list-check" />
        Comparaison : questionnaire · réunions · cahier
      </h4>
      <p class="vcmp-sub">
        Trois sources affichées côte à côte pour vérifier que le cahier des charges reflète fidèlement le questionnaire et les réunions.
      </p>
    </header>

    <div class="vcmp-grid">
      <!-- Column 1 — Questionnaire -->
      <article class="vcmp-col">
        <header class="vcmp-col-head">
          <i class="pi pi-list-check" />
          <span>Questionnaire</span>
          <NeoTag v-if="questionnaireLoading" value="…" severity="secondary" />
          <NeoTag v-else :value="`${questionnaire.length} réponses`" severity="info" />
        </header>
        <div class="vcmp-col-body">
          <div v-if="questionnaireLoading" class="vcmp-placeholder">Chargement…</div>
          <div v-else-if="questionnaire.length === 0" class="vcmp-empty">
            <i class="pi pi-inbox" /> Aucune réponse enregistrée
          </div>
          <div v-for="(q, i) in questionnaire" v-else :key="i" class="vcmp-q">
            <div class="vcmp-q-label">{{ q.label }}</div>
            <div class="vcmp-q-value" :class="{ 'vcmp-q-empty': !q.value }">
              {{ q.value || '— non renseigné —' }}
            </div>
          </div>
        </div>
      </article>

      <!-- Column 2 — Réunions -->
      <article class="vcmp-col">
        <header class="vcmp-col-head">
          <i class="pi pi-microphone" />
          <span>Réunions</span>
          <NeoTag :value="`${meetings.length} transcripts`" severity="info" />
        </header>
        <div class="vcmp-col-body">
          <div v-if="meetingsLoading" class="vcmp-placeholder">Chargement…</div>
          <div v-else-if="meetings.length === 0" class="vcmp-empty">
            <i class="pi pi-microphone" /> Aucune réunion transcrite
          </div>
          <div v-for="m in meetings" v-else :key="m.id" class="vcmp-m">
            <div class="vcmp-m-head">
              <strong>{{ m.title || 'Réunion sans titre' }}</strong>
              <span class="vcmp-m-date">{{ formatDate(m.recordedAt) }}</span>
            </div>
            <div class="vcmp-m-meta">
              {{ Math.round((m.durationSeconds ?? 0) / 60) }} min
              <span v-if="m.aiSummary"> • résumé IA disponible</span>
            </div>
            <p v-if="m.aiSummary" class="vcmp-m-summary">
              {{ truncate(m.aiSummary, 300) }}
            </p>
          </div>
        </div>
      </article>

      <!-- Column 3 — Cahier des charges (AI) -->
      <article class="vcmp-col">
        <header class="vcmp-col-head">
          <i class="pi pi-file-word" />
          <span>Cahier des charges</span>
          <NeoTag v-if="cahierLoading" value="…" severity="secondary" />
          <NeoTag v-else-if="cahier" value="Généré" severity="success" />
          <NeoTag v-else value="À générer" severity="warn" />
        </header>
        <div class="vcmp-col-body">
          <div v-if="cahierLoading" class="vcmp-placeholder">Chargement…</div>
          <div v-else-if="!cahier" class="vcmp-empty">
            <i class="pi pi-sparkles" />
            Pas encore généré.<br>
            Le chef de projet doit cliquer sur « Générer l'analyse » dans l'onglet <strong>Résultat IA</strong>.
          </div>
          <template v-else>
            <section v-if="cahier.objectifDocument" class="vcmp-s">
              <h5>Objectif du document</h5>
              <p>{{ cahier.objectifDocument }}</p>
            </section>
            <section v-if="cahier.contexte" class="vcmp-s">
              <h5>Contexte</h5>
              <p>{{ truncate(cahier.contexte, 500) }}</p>
            </section>
            <section v-if="cahier.objectifProjet" class="vcmp-s">
              <h5>Objectif du projet</h5>
              <p class="pre">{{ toText(cahier.objectifProjet) }}</p>
            </section>
            <section v-if="cahier.perimetreInclus" class="vcmp-s">
              <h5>Périmètre inclus</h5>
              <p class="pre">{{ truncate(toText(cahier.perimetreInclus), 600) }}</p>
            </section>
            <section v-if="Array.isArray(cahier.exigencesFonctionnelles) && cahier.exigencesFonctionnelles.length" class="vcmp-s">
              <h5>Exigences fonctionnelles ({{ cahier.exigencesFonctionnelles.length }})</h5>
              <ul class="vcmp-mods">
                <li v-for="(ef, i) in cahier.exigencesFonctionnelles" :key="`ef-${i}`">
                  <strong>{{ ef.title }}</strong>
                </li>
              </ul>
            </section>
            <section v-if="Array.isArray(cahier.architectureTechnique) && cahier.architectureTechnique.length" class="vcmp-s">
              <h5>Architecture technique ({{ cahier.architectureTechnique.length }})</h5>
              <ul class="vcmp-mods">
                <li v-for="(at, i) in cahier.architectureTechnique" :key="`at-${i}`">
                  <strong>{{ at.title }}</strong>
                </li>
              </ul>
            </section>
          </template>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { NeoTag } from '@neolibrary/components'
import api from '@/lib/api'

interface Section { title: string; content: string }
interface CahierContent {
  objectifDocument?: string
  contexte?: string
  objectifProjet?: string | unknown
  perimetreInclus?: string | unknown
  perimetreExclus?: string | unknown
  exigencesFonctionnelles?: Section[]
  architectureTechnique?: Section[]
  livrables?: string | unknown
  conclusion?: string
}
interface Meeting {
  id: string
  title?: string | null
  recordedAt: string
  durationSeconds?: number | null
  aiSummary?: string | null
}
interface ProjectField { id: string; label: string }
interface ProjectFieldValue { projectFieldId: string; value: string | null }
interface ProjectDetail { fields?: ProjectField[]; fieldValues?: ProjectFieldValue[] }

const props = defineProps<{ projectId: string }>()

const questionnaire = ref<{ label: string; value: string | null }[]>([])
const meetings = ref<Meeting[]>([])
const cahier = ref<CahierContent | null>(null)

const questionnaireLoading = ref(true)
const meetingsLoading = ref(true)
const cahierLoading = ref(true)

function truncate(s: string, n: number): string {
  if (!s) return ''
  return s.length > n ? `${s.slice(0, n)}…` : s
}
function toText(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? `- ${x}` : JSON.stringify(x))).join('\n')
  return JSON.stringify(v)
}
function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

onMounted(async () => {
  // Questionnaire (via the admin/project endpoint — works for admins)
  try {
    const { data } = await api.get<ProjectDetail>(`/pm/projects/${props.projectId}`)
    const fieldById = new Map<string, ProjectField>((data.fields ?? []).map((f) => [f.id, f]))
    questionnaire.value = (data.fieldValues ?? [])
      .map((v) => ({ label: fieldById.get(v.projectFieldId)?.label ?? '?', value: v.value }))
      .filter((q) => q.label !== '?')
  } catch {
    questionnaire.value = []
  } finally {
    questionnaireLoading.value = false
  }

  // Meetings
  try {
    const { data } = await api.get<Meeting[] | { items: Meeting[] }>(`/pm/projects/${props.projectId}/meetings`, {
      suppressErrorToast: true,
    } as never)
    meetings.value = Array.isArray(data) ? data : (data?.items ?? [])
  } catch {
    meetings.value = []
  } finally {
    meetingsLoading.value = false
  }

  // Saved cahier
  try {
    const { data } = await api.get<{ aiContent: CahierContent | null }>(
      `/pm/projects/${props.projectId}/cahier-des-charges/saved`,
      { suppressErrorToast: true } as never,
    )
    cahier.value = data?.aiContent ?? null
  } catch {
    cahier.value = null
  } finally {
    cahierLoading.value = false
  }
})
</script>

<style scoped>
.vcmp {
  margin-bottom: 1.5rem;
  background: var(--nl-surface-1, #fff);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  padding: 1rem 1.25rem 1.25rem;
}
.vcmp-head { margin-bottom: 1rem; }
.vcmp-title {
  font-size: 1rem;
  font-weight: 700;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--nl-text-1);
}
.vcmp-sub {
  margin: 0.3rem 0 0;
  font-size: 0.8125rem;
  color: var(--nl-text-3);
}
.vcmp-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.9rem;
}
@media (max-width: 1100px) { .vcmp-grid { grid-template-columns: 1fr; } }

.vcmp-col {
  background: var(--nl-surface-2, #f8fafc);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  display: flex;
  flex-direction: column;
  min-height: 400px;
  max-height: 70vh;
  overflow: hidden;
}
.vcmp-col-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.9rem;
  background: #fff;
  border-bottom: 1px solid var(--nl-border);
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--nl-text-1);
}
.vcmp-col-head > span { flex: 1; }
.vcmp-col-body {
  padding: 0.75rem 0.9rem;
  overflow-y: auto;
  flex: 1;
  font-size: 0.82rem;
  line-height: 1.55;
  color: var(--nl-text-2);
}

.vcmp-empty, .vcmp-placeholder {
  text-align: center;
  padding: 2rem 1rem;
  color: var(--nl-text-3);
  font-size: 0.82rem;
  line-height: 1.6;
}
.vcmp-empty i, .vcmp-placeholder i { display: block; font-size: 1.5rem; margin-bottom: 0.4rem; opacity: 0.5; }

.vcmp-q { margin-bottom: 0.8rem; padding-bottom: 0.7rem; border-bottom: 1px dashed var(--nl-border); }
.vcmp-q:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
.vcmp-q-label { font-weight: 600; color: var(--nl-text-1); margin-bottom: 0.2rem; }
.vcmp-q-value { white-space: pre-wrap; }
.vcmp-q-empty { color: var(--nl-text-3); font-style: italic; }

.vcmp-m { margin-bottom: 0.9rem; padding-bottom: 0.8rem; border-bottom: 1px dashed var(--nl-border); }
.vcmp-m:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
.vcmp-m-head { display: flex; justify-content: space-between; align-items: baseline; gap: 0.5rem; }
.vcmp-m-date { font-size: 0.75rem; color: var(--nl-text-3); }
.vcmp-m-meta { font-size: 0.75rem; color: var(--nl-text-3); margin-top: 0.1rem; }
.vcmp-m-summary { margin: 0.4rem 0 0; font-size: 0.8rem; }

.vcmp-s { margin-bottom: 0.75rem; }
.vcmp-s h5 {
  margin: 0 0 0.25rem;
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--nl-accent);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.vcmp-s p { margin: 0; }
.vcmp-s .pre { white-space: pre-wrap; }
.vcmp-mods { margin: 0; padding-left: 1.2rem; }
.vcmp-mods li { margin-bottom: 0.15rem; }
</style>
