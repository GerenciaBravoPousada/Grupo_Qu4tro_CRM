/* Service Worker para GRUPO QU4TRO CRM - PWA Offline-First */
const CACHE_NAME = 'qu4tro-crm-release-1';
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './crm-journal-browser.js?v=crm-release',
  './crm-journal.js?v=crm-release',
  './crm-phone-privacy.js?v=crm-release',
  './crm-action-readiness.js?v=crm-release',
  './crm-sync.js?v=crm-release',
  './reservation-attendance.js?v=crm-release',
  './pwa-update.js?v=crm-release',
  './manifest.json',
  './qrcode.min.js?v=crm-release',
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
      return cache.addAll(PRECACHE_ASSETS.map(asset => new Request(asset, {cache:'reload'}))).catch(err => {
        console.warn('[SW] Aviso durante precache:', err);
      });
    })
  );
});

// Ativação: Limpa caches antigos e assume controle imediato
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME && key.startsWith('qu4tro-crm-')) {
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
            status: 503,
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

  // Probes must never fall back to an old publication.
  if (url.origin === self.location.origin && (url.pathname.endsWith('/version.json') ||
      (url.pathname.endsWith('/release.html') && event.request.mode !== 'navigate'))) {
    event.respondWith(fetch(event.request, {cache:'no-store'}));
    return;
  }

  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('/index.html')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(event.request, {cache:'no-cache'});
        if(response.ok){
          const key = url.pathname.endsWith('/release.html') ? './release.html' :
            (url.search ? event.request : './index.html');
          await cache.put(key, response.clone()).catch(() => {});
        }
        return response;
      } catch {
        if(url.pathname.endsWith('/release.html')) return await cache.match('./release.html') ||
          await cache.match('./index.html') || Response.error();
        return await cache.match(event.request) || await cache.match('./index.html') || Response.error();
      }
    })());
    return;
  }

  // Código local: prioriza a rede para não combinar HTML novo com JavaScript antigo.
  if (url.origin === self.location.origin && url.pathname.endsWith('.js')) {
    event.respondWith(
      fetch(event.request, {cache:url.searchParams.has('v') ? 'no-store' : 'no-cache'}).then(response => {
        if (response && response.status === 200) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // 4. Arquivos estáticos locais (imagens, qrcode, ícones): Stale-While-Revalidate
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      const fetchPromise = fetch(event.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const respClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, respClone));
        }
        return networkResponse;
      }).catch(() => {});

      return cachedResponse || fetchPromise;
    })
  );
});

