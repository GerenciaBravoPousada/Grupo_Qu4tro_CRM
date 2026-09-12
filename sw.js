/* Service Worker para GRUPO QU4TRO CRM - PWA Offline-First */
const CACHE_NAME = 'qu4tro-crm-v1.0.16';
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './qrcode.min.js',
  './icon-192.png',
  './icon-512.png',
  './favicon.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// Instalação: Baixa os arquivos essenciais para o cache local
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Precaching shell do app...');
      return cache.addAll(PRECACHE_ASSETS).catch(err => {
        console.warn('[SW] Aviso durante precache:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Ativação: Limpa caches antigos e assume controle imediato
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Removendo cache obsoleto:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Interceptação de requisições:
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. Chamadas à API do Supabase:
  // Se for uma requisição para o backend do Supabase, tenta a rede.
  // Se a rede falhar, retorna resposta adequada para não quebrar a aplicação.
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        // Se for GET, retorna array vazio para o cliente operar offline
        if (event.request.method === 'GET') {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        // Se for POST/PUT/DELETE, retorna erro 503 controlado para ativar a fila Outbox
        return new Response(JSON.stringify({ offline: true, message: 'Dispositivo sem internet' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // 2. CDNs externas (Supabase SDK, fontes): Cache First com fallback de rede
  if (url.hostname.includes('jsdelivr.net') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const respClone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, respClone));
          }
          return response;
        }).catch(() => cached);
      })
    );
    return;
  }

  // 3. Arquivos locais do CRM (index.html, imagens, etc.): Stale-While-Revalidate
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      const fetchPromise = fetch(event.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const respClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, respClone));
        }
        return networkResponse;
      }).catch(() => {
        // Se falhou e não temos cachedResponse, fallback para index.html para SPAs
        if (!cachedResponse && event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });

      return cachedResponse || fetchPromise;
    })
  );
});
