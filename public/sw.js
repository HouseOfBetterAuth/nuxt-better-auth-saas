globalThis.addEventListener('install', (event) => {
  event.waitUntil(globalThis.skipWaiting())
})

globalThis.addEventListener('activate', (event) => {
  event.waitUntil(globalThis.clients.claim())
})
