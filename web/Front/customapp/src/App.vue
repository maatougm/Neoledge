<template>
  <div class="app-root">
    <Loader v-if="app.loading" />
    <div v-show="!app.loading">
      <router-view />
    </div>
    <NeoToast />
  </div>
</template>

<script setup lang="ts">
import { useApp } from './stores/useApp'
import Loader from '@/components/Loader.vue'
import { NeoToast } from '@neolibrary/components'

const app = useApp()
</script>

<style>
.app-root {
  min-height: 100vh;
  background-color: #f5f7fa;
}
</style>
