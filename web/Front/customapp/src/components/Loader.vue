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
  background: rgba(255, 255, 255, 0.75);
  z-index: 9999;
}

.loader-spinner {
  width: 56px;
  height: 56px;
  border: 6px solid #e5e7eb;
  border-top-color: #0a6e89;
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
