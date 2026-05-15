const CACHE_NAME = 'geoportal-v1';
const TILE_CACHE = 'geoportal-tiles-v1';
const STATIC_CACHE = 'geoportal-static-v1';

// Recursos estáticos del frontend (cache permanente)
const PRECACHE = [
  'index.html',
  'map.html',
  'admin.html',
  'ayuda.html',
  'chart.min.js',
  'icon-192.png'
];

// Clasificar tipo de recurso
function getResourceType(url) {
  const path = new URL(url).pathname;
  // Recursos estáticos de NextGIS (JS, CSS, fuentes)
  if (/\.(js|css|woff|woff2|ttf|eot)(\?|$)/i.test(path)) return 'static';
  // Imágenes estáticas y SVG
  if (/\.(png|jpg|jpeg|gif|svg|ico)(\?|$)/i.test(path)) return 'static';
  // Tiles del mapa
  if (path.includes('/render/tile') || path.includes('/render/image')) return 'tile';
  // Datos dinámicos — nunca cachear
  if (path.includes('/feature/') || path.includes('/identify') || 
      path.includes('/login') || path.includes('/admin/') ||
      path.includes('/map-token') || path.includes('/change-password') ||
      path.includes('/accept-terms') || path.includes('/cache-purge') ||
      path.includes('/settings')) return 'dynamic';
  // Página del mapa (HTML de NextGIS) — no cachear
  if (path === '/map') return 'dynamic';
  // API calls
  if (path.startsWith('/api/') && (path.includes('/feature') || path.includes('/identify'))) return 'dynamic';
  // Otros recursos del proxy
  if (path.startsWith('/nproxy/') || path.startsWith('/api/')) return 'static';
  return 'dynamic';
}

// Instalar — precachear recursos del frontend
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

// Activar — limpiar caches antiguos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME && k !== TILE_CACHE && k !== STATIC_CACHE)
        .map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// Fetch — estrategia según tipo de recurso
self.addEventListener('fetch', event => {
  const { request } = event;
  
  // Solo cachear GET requests
  if (request.method !== 'GET') return;
  
  const type = getResourceType(request.url);
  
  if (type === 'dynamic') return; // No interceptar, dejar pasar al network
  
  if (type === 'tile') {
    // Tiles: cache-first, 2 horas máximo
    event.respondWith(
      caches.open(TILE_CACHE).then(cache =>
        cache.match(request).then(cached => {
          if (cached) {
            // Verificar edad del cache
            const dateHeader = cached.headers.get('sw-cached-at');
            if (dateHeader) {
              const age = Date.now() - parseInt(dateHeader);
              if (age < 14400000) return cached; // 4 horas
            } else {
              return cached; // Sin fecha, usar como está
            }
          }
          // No en cache o expirado — ir a red
          return fetch(request).then(response => {
            if (response.ok) {
              const cloned = response.clone();
              // Agregar timestamp al guardar
              cloned.blob().then(blob => {
                const headers = new Headers(cloned.headers);
                headers.set('sw-cached-at', Date.now().toString());
                cache.put(request, new Response(blob, { status: 200, headers }));
              });
            }
            return response;
          }).catch(() => cached || new Response('', { status: 408 }));
        })
      )
    );
    return;
  }
  
  if (type === 'static') {
    // Estáticos: cache-first, larga duración
    event.respondWith(
      caches.open(STATIC_CACHE).then(cache =>
        cache.match(request).then(cached => {
          if (cached) return cached;
          return fetch(request).then(response => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          }).catch(() => cached || new Response('', { status: 408 }));
        })
      )
    );
    return;
  }
});

// Escuchar mensaje para limpiar cache (desde el admin)
self.addEventListener('message', event => {
  if (event.data === 'PURGE_CACHE') {
    caches.delete(TILE_CACHE).then(() => {
      caches.delete(STATIC_CACHE).then(() => {
        self.clients.matchAll().then(clients => {
          clients.forEach(c => c.postMessage('CACHE_PURGED'));
        });
      });
    });
  }
});
