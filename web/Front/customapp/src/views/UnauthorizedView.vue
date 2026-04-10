<!--
  @file     UnauthorizedView.vue
  @module   NeoLeadge — Deployment Manager
  @desc     403 Forbidden — centered full-page redesign
-->
<template>
  <div class="unauthorized-page">
    <div class="unauthorized-card" role="main">
      <div class="unauthorized-code" aria-hidden="true">403</div>

      <div class="unauthorized-body">
        <h1 class="unauthorized-title">Accès refusé</h1>
        <p class="unauthorized-description">
          Vous n'avez pas les droits nécessaires pour accéder à cette page.
        </p>

        <NeoButton
          label="Retourner à l'accueil"
          icon="pi pi-home"
          class="unauthorized-btn"
          @click="router.push('/')"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { NeoButton } from '@neolibrary/components'

const router = useRouter()
</script>

<style scoped>
.unauthorized-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--nl-bg);
  font-family: var(--nl-font);
  padding: 2rem;
}

.unauthorized-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
  text-align: center;
  animation: fadeInUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}

.unauthorized-code {
  font-size: 10rem;
  font-weight: 800;
  line-height: 1;
  color: var(--nl-text-3);
  opacity: 0.18;
  letter-spacing: -6px;
  user-select: none;
}

.unauthorized-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

.unauthorized-title {
  margin: 0;
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--nl-text-1);
  letter-spacing: -0.4px;
}

.unauthorized-description {
  margin: 0;
  font-size: 1rem;
  color: var(--nl-text-3);
  line-height: 1.6;
  max-width: 400px;
}

.unauthorized-btn {
  margin-top: 0.5rem;
}
</style>
