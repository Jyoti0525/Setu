import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Setu', short_name: 'Setu', lang: 'or', start_url: '/', display: 'standalone',
        background_color: '#DAC8AE', theme_color: '#DAC8AE',
        icons: [{ src: '/setu-learning-bridge.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // opt-in lesson reminders (P4.31)
        importScripts: ['push-sw.js'],
        // offline photo reading is an opt-in ~3 MB download (data is money, PLAN §8.1): cached on first use, not precached
        // voice clips: the essential ones are fetched with the pack, the rest cached when first played
        globIgnores: ['ocr/**', 'audio/**', 'fonts/noto-sans-devanagari*'],
        navigateFallbackDenylist: [/^\/api/, /^\/trace/, /^\/ocr/, /^\/audio/, /^\/voice/],
        runtimeCaching: [
          { urlPattern: ({ url }) => url.pathname.startsWith('/audio/') && url.pathname.endsWith('.json'), handler: 'StaleWhileRevalidate', options: { cacheName: 'setu-audio-index' } },
          { urlPattern: ({ url }) => url.pathname.startsWith('/audio/') && url.pathname.endsWith('.ogg'), handler: 'CacheFirst', options: { cacheName: 'setu-audio', expiration: { maxEntries: 400 } } },
          // the server's recordings of AI-written replies (a 404 = not recorded → device voice; not cached)
          { urlPattern: ({ url }) => url.pathname.startsWith('/voice/'), handler: 'CacheFirst', options: { cacheName: 'setu-voice', expiration: { maxEntries: 200 }, cacheableResponse: { statuses: [200] } } },
          // a script font not precached (Devanagari for an Odia learner): fetched once if that script ever shows
          { urlPattern: ({ url }) => url.pathname.startsWith('/fonts/'), handler: 'CacheFirst', options: { cacheName: 'setu-fonts', expiration: { maxEntries: 6 } } },
          { urlPattern: ({ url }) => url.pathname.startsWith('/ocr/'), handler: 'CacheFirst', options: { cacheName: 'setu-ocr', expiration: { maxEntries: 10 } } }],
      },
    }),
  ],
  server: { proxy: { '/api': 'http://localhost:8787', '/trace': 'http://localhost:8787', '/voice': 'http://localhost:8787' } },
  build: { target: 'es2019' },
});
