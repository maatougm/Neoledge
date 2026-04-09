<template>
  <div class="unauth-page">
    <Unauthorized class="unauth-illustration" />
    <p class="unauth-message">
      Vous n'êtes pas autorisé à accéder à cette page. Veuillez recommencer l'action depuis le début.
    </p>
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
const Unauthorized = defineAsyncComponent(() => import('@/assets/svg/unauthorized.svg'))
</script>

<style>
.unauth-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  gap: 1.5rem;
}

.unauth-illustration {
  height: 60vh;
  max-height: 480px;
}

.unauth-message {
  max-width: 70vw;
  text-align: center;
  font-size: 1rem;
  color: var(--nl-text-2);
}

svg#freepik_stories-security-on:not(.animated) .animable { opacity: 0; }
svg#freepik_stories-security-on.animated #freepik--Device--inject-2 {
  animation: 1s 1 forwards cubic-bezier(0.36, -0.01, 0.5, 1.38) zoomIn;
}
svg#freepik_stories-security-on.animated #freepik--character-2--inject-2 {
  animation: 1s 1 forwards cubic-bezier(0.36, -0.01, 0.5, 1.38) lightSpeedLeft,
             1.5s Infinite linear wind;
  animation-delay: 0s, 1s;
}
svg#freepik_stories-security-on.animated #freepik--character-1--inject-2 {
  animation: 1s 1 forwards cubic-bezier(0.36, -0.01, 0.5, 1.38) lightSpeedRight,
             1.5s Infinite linear wind;
  animation-delay: 0s, 1s;
}

@keyframes zoomIn {
  0%   { opacity: 0; transform: scale(0.5); }
  100% { opacity: 1; transform: scale(1); }
}
@keyframes lightSpeedLeft {
  from { transform: translate3d(-50%, 0, 0) skewX(20deg); opacity: 0; }
  60%  { transform: skewX(-10deg); opacity: 1; }
  80%  { transform: skewX(2deg); }
  to   { opacity: 1; transform: translate3d(0, 0, 0); }
}
@keyframes lightSpeedRight {
  from { transform: translate3d(50%, 0, 0) skewX(-20deg); opacity: 0; }
  60%  { transform: skewX(10deg); opacity: 1; }
  80%  { transform: skewX(-2deg); }
  to   { opacity: 1; transform: translate3d(0, 0, 0); }
}
@keyframes wind {
  0%   { transform: rotate(0deg); }
  25%  { transform: rotate(1deg); }
  75%  { transform: rotate(-1deg); }
}
</style>
