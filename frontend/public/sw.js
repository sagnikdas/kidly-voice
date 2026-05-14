// Minimal service worker — required for Chrome/Android install prompt.
// No offline caching: TTS audio is served from the backend, not precacheable.
const CACHE = 'kidly-shell-v1'

self.addEventListener('install', e => e.waitUntil(self.skipWaiting()))
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})
