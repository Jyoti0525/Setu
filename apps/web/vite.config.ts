import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        // installable from Chrome on Android (PNG 192 + 512 + maskable) and Safari on iPhone (apple-touch-icon, index.html)
        id: '/', name: 'Setu · ସେତୁ — Class 9 study buddy', short_name: 'Setu', description: 'Odia-first tutor for BSE Odisha Class 9 textbooks. Works offline.',
        lang: 'or', dir: 'ltr', start_url: '/', scope: '/', display: 'standalone', orientation: 'portrait', categories: ['education'],
        background_color: '#f5f1e8', theme_color: '#1f5a60',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}', '*.png'],
        // opt-in lesson reminders (P4.31)
        importScripts: ['push-sw.js'],
        // offline photo reading is an opt-in ~3 MB download (data is money, PLAN §8.1): cached on first use, not precached
        // voice clips: the essential ones are fetched with the pack, the rest cached when first played
        globIgnores: ['ocr/**', 'audio/**', 'fonts/noto-sans-devanagari*'],
        navigateFallbackDenylist: [/^\/api/, /^\/trace/, /^\/ocr/, /^\/audio/, /^\/voice/, /^\/figure/],
        runtimeCaching: [
          { urlPattern: ({ url }) => url.pathname.startsWith('/audio/') && url.pathname.endsWith('.json'), handler: 'StaleWhileRevalidate', options: { cacheName: 'setu-audio-index' } },
          { urlPattern: ({ url }) => url.pathname.startsWith('/audio/') && url.pathname.endsWith('.ogg'), handler: 'CacheFirst', options: { cacheName: 'setu-audio', expiration: { maxEntries: 400 } } },
          // the server's recordings of AI-written replies (a 404 = not recorded → device voice; not cached)
          { urlPattern: ({ url }) => url.pathname.startsWith('/voice/'), handler: 'CacheFirst', options: { cacheName: 'setu-voice', expiration: { maxEntries: 200 }, cacheableResponse: { statuses: [200] } } },
          // textbook figures in answer cards: kept once seen, so the picture is there again with no signal
          { urlPattern: ({ url }) => url.pathname.startsWith('/figure/'), handler: 'CacheFirst', options: { cacheName: 'setu-figures', expiration: { maxEntries: 400 }, cacheableResponse: { statuses: [200] } } },
          // a script font not precached (Devanagari for an Odia learner): fetched once if that script ever shows
          { urlPattern: ({ url }) => url.pathname.startsWith('/fonts/'), handler: 'CacheFirst', options: { cacheName: 'setu-fonts', expiration: { maxEntries: 6 } } },
          { urlPattern: ({ url }) => url.pathname.startsWith('/ocr/'), handler: 'CacheFirst', options: { cacheName: 'setu-ocr', expiration: { maxEntries: 10 } } }],
      },
    }),
  ],
  server: { proxy: { '/api': 'http://localhost:8787', '/trace': 'http://localhost:8787', '/voice': 'http://localhost:8787', '/figure': 'http://localhost:8787' } },
  build: { target: 'es2019' },
});
