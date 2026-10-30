import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'

// Versi aplikasi diambil dari package.json (sinkron dengan /VERSION di root repo,
// dijaga oleh scripts/check-version.mjs).
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  plugins: [
    react(),
    // PWA: precache app shell (JS/CSS/HTML/ikon) supaya UI tetap terbuka offline.
    // Endpoint data (/api/*, /uploads/*, /terima-sensor) sengaja TIDAK di-cache:
    // data sensor harus selalu dari jaringan agar tidak tampil basi palsu.
    VitePWA({
      registerType: 'prompt',
      injectRegister: 'auto',
      // Ikon manifest sudah otomatis di-precache plugin; tambahkan sisa aset
      // statis yang tidak tercantum di manifest.
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'icon.svg'],
      devOptions: { enabled: false },
      manifest: {
        name: 'Monitor Hidroponik',
        short_name: 'Hidroponik',
        description: 'Monitoring sensor IoT, listrik, dan plan tanam hidroponik.',
        lang: 'id',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#121212',
        theme_color: '#121212',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Ikon PNG di-precache lewat manifest; glob hanya untuk app shell.
        globPatterns: ['**/*.{js,css,html,woff2}'],
        navigateFallback: '/index.html',
        // Route non-SPA tidak boleh dibalas index.html dari cache SW.
        navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//, /^\/terima-sensor$/],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 3000,
    host: true
  }
})
