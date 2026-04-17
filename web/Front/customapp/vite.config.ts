import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
//import basicSsl from '@vitejs/plugin-basic-ssl'
import svgLoader from 'vite-svg-loader'
import { resolve, dirname } from 'node:path'
// https://vitejs.dev/config/

export default defineConfig({
  server: {
    https: false,
    port: 5173
  },
  plugins: [
    vue(),
    vueJsx(),
    svgLoader({
      svgo: false,
      defaultImport: 'component'
    })
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '~@neoledge': resolve(dirname(fileURLToPath(import.meta.url)),
      'node_modules/@neoledge'
    ),
    }
  },

  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name].js`,
        chunkFileNames: `assets/[name].js`,
        assetFileNames: `assets/[name].[ext]`,
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return
          if (id.includes('chart.js')) return 'chart'
          if (id.includes('vue-chartjs')) return 'chart'
          if (id.includes('@neolibrary')) return 'neolibrary'
          if (id.includes('primevue') || id.includes('primeicons')) return 'primevue'
          if (id.includes('axios')) return 'axios'
          if (id.includes('socket.io-client')) return 'socket'
          if (id.includes('/vue/') || id.includes('vue-router') || id.includes('pinia')) return 'vue'
        }
      }
    }
  },
  // Dev + Elise iframe use the /Sample/Front/ base; prod build for
  // neoleadge.pythagore-init.com ships at the root. Override via VITE_BASE.
  base: process.env.VITE_BASE ?? '/Sample/Front/'
})
