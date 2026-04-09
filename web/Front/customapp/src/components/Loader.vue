<template>
  <div class="loader-overlay">
    <div class="loader-spinner"></div>
  </div>
</template>

<style scoped>
.loader-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--nl-overlay-bg);
  z-index: 9999;
}

.loader-spinner {
  width: 56px;
  height: 56px;
  border: 6px solid var(--nl-border);
  border-top-color: var(--nl-accent);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
