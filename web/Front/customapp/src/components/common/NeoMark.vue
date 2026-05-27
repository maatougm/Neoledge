<!--
  @file NeoMark.vue — NeoLeadge brand mark (split circle: solid left half + ring right half).

  Pure vector, transparent background, single-colour via `currentColor` — the parent
  decides the colour through CSS `color`, so it can be accent-yellow on a dark surface
  or sit as a yellow mark on a dark "app-icon" tile on a light surface. Replaces the
  old neo-mark.png, which carried a baked-in white background.

  Geometry traced from the original asset: 200×200 canvas, centre (100,100),
  outer radius 69, ring inner radius 54. The fill-rule="evenodd" subtracts the
  right-hand inner half-disc, leaving the left half solid and the right half a ring.
-->
<template>
  <svg
    class="neo-mark"
    viewBox="0 0 200 200"
    fill="currentColor"
    role="img"
    :aria-label="title ?? 'NeoLeadge'"
  >
    <path
      fill-rule="evenodd"
      d="M31 100a69 69 0 1 0 138 0a69 69 0 1 0-138 0ZM100 46A54 54 0 0 1 100 154L100 46Z"
    />
  </svg>
</template>

<script setup lang="ts">
defineProps<{ title?: string }>()
</script>

<style scoped>
.neo-mark {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
