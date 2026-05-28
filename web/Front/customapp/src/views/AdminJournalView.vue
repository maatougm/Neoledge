<!--
  @file AdminJournalView.vue — admin "Audit sécurité" page.
  Was a tabbed view (Activité projets + Audit & sécurité); the activity tab was
  removed, so this now surfaces only the security/compliance audit trail
  (AuditLogView — mutations before→after, logins, password resets).
  The standalone /app/admin/activity route still exists for deep links, and the
  live System-status dashboard stays separate (it's health, not history).
-->
<template>
  <AuditLogView />
</template>

<script setup lang="ts">
import AuditLogView from '@/views/AuditLogView.vue'
</script>
