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
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name].js`,
        chunkFileNames: `assets/[name].js`,
        assetFileNames: `assets/[name].[ext]`
      }
    }
  },
  base: '/Sample/Front/'
})
