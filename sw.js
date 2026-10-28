// Service worker: programėlės apvalkalas veikia ir be ryšio.
// API užklausų (Supabase) nesaugo – jos visada eina į tinklą.
const VERSION = 'zt-v15';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'src/app.js',
  'src/config.js',
  'src/icons.js',
  'src/ui.js',
  'src/lib/html.js',
  'src/lib/format.js',
  'src/lib/scoring.js',
  'src/lib/outbox.js',
  'src/lib/device.js',
  'src/lib/ruler.js',
  'src/lib/badges.js',
  'src/lib/weather.js',
  'src/lib/prizes.js',
  'src/lib/records.js',
  'src/lib/seen.js',
  'src/lib/bans.js',
  'src/lib/roles.js',
  'src/lib/push.js',
  'src/backend/index.js',
  'src/backend/demo.js',
  'src/backend/supabase.js',
  'src/backend/species.js',
  'src/views/tournaments.js',
  'src/views/tournament.js',
  'src/views/capture.js',
  'src/views/diary.js',
  'src/views/profile.js',
  'src/views/create.js',
  'src/views/moderation.js',
  'src/views/login.js',
  'src/views/invite.js',
  'src/views/pages.js',
  'src/views/catch.js'
];
const CDN = ['https://cdn.jsdelivr.net', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Push pranešimas: { title, body, url, tag } (siunčia Supabase funkcija send-push).
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Žvejybos turnyrai', body: e.data ? e.data.text() : '' }; }
  const url = typeof d.url === 'string' && /^#\/[\w\-/]*$/.test(d.url) ? d.url : '#/';
  e.waitUntil(self.registration.showNotification(d.title || 'Žvejybos turnyrai', {
    body: d.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: d.tag || undefined,
    data: { url },
    lang: 'lt'
  }));
});

// Paspaudus pranešimą – atidaroma (arba parodoma jau atidaryta) programėlė reikiamame puslapyje.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(self.registration.scope);
  target.hash = (e.notification.data && e.notification.data.url) || '#/';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === target.origin) {
        await w.focus();
        if ('navigate' in w) return w.navigate(target.href);
        return undefined;
      }
    }
    return self.clients.openWindow(target.href);
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !CDN.includes(url.origin)) return;

  // Tinklas pirmiau, atsarginė kopija – talpykloje (naujos versijos pasiekia iškart).
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && (res.type === 'basic' || res.type === 'cors')) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: sameOrigin }).then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
