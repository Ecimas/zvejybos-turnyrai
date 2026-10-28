import { createBackend } from './backend/index.js';
import { Outbox, idbStore, memoryStore } from './lib/outbox.js';
import { html } from './lib/html.js';
import { icon } from './icons.js';
import { count } from './lib/format.js';
import { tournamentsView, standingsView } from './views/tournaments.js';
import { tournamentView, boardView, tvView, teamBoardView, duelsView } from './views/tournament.js';
import { leaguesView, leagueView } from './views/leagues.js';
import { statsView } from './views/stats.js';
import { adminLogView } from './views/adminlog.js';
import { startPresence } from './lib/presence.js';
import { captureView } from './views/capture.js';
import { catchView } from './views/catch.js';
import { diaryView } from './views/diary.js';
import { profileView, anglerView } from './views/profile.js';
import { createView } from './views/create.js';
import { moderationView, disputesView, teamView, reportsView, bansView, checksView } from './views/moderation.js';
import { checkView } from './views/check.js';
import { mapView } from './views/map.js';
import { feedView, clubsView, clubView } from './views/social.js';
import { loginView } from './views/login.js';
import { inviteView, takeInvite } from './views/invite.js';
import { privacyView, rulesView } from './views/pages.js';

const ROUTES = [
  [/^\/$/, tournamentsView],
  [/^\/t\/([\w-]+)$/, tournamentView],
  [/^\/t\/([\w-]+)\/lentele$/, boardView],
  [/^\/t\/([\w-]+)\/tv$/, tvView],
  [/^\/t\/([\w-]+)\/klubai$/, teamBoardView],
  [/^\/t\/([\w-]+)\/dvikovos$/, duelsView],
  [/^\/lygos$/, leaguesView],
  [/^\/lyga\/([\w-]+)$/, leagueView],
  [/^\/t\/([\w-]+)\/redaguoti$/, createView],
  [/^\/kvietimas\/(\w+)$/, inviteView],
  [/^\/laimikis$/, captureView],
  [/^\/l\/([\w-]+)$/, catchView],
  [/^\/dienorastis$/, diaryView],
  [/^\/lenteles$/, standingsView],
  [/^\/profilis$/, profileView],
  [/^\/zvejys\/([\w-]+)$/, anglerView],
  [/^\/naujas$/, createView],
  [/^\/moderavimas$/, moderationView],
  [/^\/moderavimas\/gincai$/, disputesView],
  [/^\/moderavimas\/pranesimai$/, reportsView],
  [/^\/moderavimas\/komanda$/, teamView],
  [/^\/moderavimas\/blokuoti$/, bansView],
  [/^\/moderavimas\/patikros$/, checksView],
  [/^\/moderavimas\/statistika$/, statsView],
  [/^\/moderavimas\/turnyrai$/, adminLogView],
  [/^\/patikra\/([\w-]+)$/, checkView],
  [/^\/zemelapis$/, mapView],
  [/^\/sekami$/, feedView],
  [/^\/klubai$/, clubsView],
  [/^\/klubas\/([\w-]+)$/, clubView],
  [/^\/privatumas$/, privacyView],
  [/^\/taisykles$/, rulesView],
  [/^\/prisijungti$/, loginView]
];

const NAV = [
  ['turnyrai', '#/', 'trophy', 'Turnyrai'],
  ['dienorastis', '#/dienorastis', 'book', 'Dienoraštis'],
  ['laimikis', '#/laimikis', 'plus', 'Registruoti laimikį'],
  ['lenteles', '#/lenteles', 'bars', 'Lentelės'],
  ['profilis', '#/profilis', 'user', 'Profilis']
];

const $ = (s) => document.querySelector(s);

function applyTheme() {
  // Numatyta – tamsi tema; „Pagal telefoną“ ir šviesią galima pasirinkti profilyje.
  let t = 'dark';
  try { t = localStorage.getItem('zt-theme') || 'dark'; } catch { /* nėra saugyklos */ }
  document.documentElement.dataset.theme = t;
}

async function main() {
  applyTheme();
  // Grįžimas iš el. laiško nuorodos: #access_token=... arba #error=... (Supabase implicit flow).
  const authHash = /(^#|&)(access_token|error)=/.test(location.hash) ? location.hash : '';
  const authError = authHash && /error/.test(authHash)
    ? (/otp_expired|expired|invalid/i.test(decodeURIComponent(authHash)) ? 'Nuoroda nebegalioja – paprašyk naujos' : 'Nepavyko prisijungti per nuorodą')
    : '';
  const backend = await createBackend();
  await backend.init();
  if (/[?&]code=/.test(location.search)) history.replaceState(null, '', location.pathname + location.hash);
  if (authHash) {
    const invite = !authError && backend.getUser() ? takeInvite() : null;
    const target = authError ? '#/prisijungti' : (backend.getUser() ? (invite ? `#/kvietimas/${invite}` : '#/profilis') : '#/prisijungti');
    history.replaceState(null, '', location.pathname + target);
  }

  const ctx = {
    backend,
    state: { user: backend.getUser(), profile: null, species: [], outboxPending: 0, outboxFailed: 0 },
    navigate: (path) => { location.hash = path; },
    toast,
    refreshStatus,
    applyTheme,
    rerender: () => render(true),
    afterLogin: () => { const code = takeInvite(); return code ? `#/kvietimas/${code}` : '#/profilis'; }
  };

  let store;
  try { store = typeof indexedDB !== 'undefined' ? idbStore() : memoryStore(); } catch { store = memoryStore(); }
  ctx.outbox = new Outbox(store, { onChange: refreshStatus });
  ctx.flush = async () => {
    if (!ctx.state.user) return;
    const r = await ctx.outbox.flush((item) => backend.submitCatch(item));
    if (r.sent) toast(r.sent === 1 ? 'Laimikis išsiųstas' : `Išsiųsta: ${r.sent}`);
    if (r.failed) toast('Ne visus laimikius pavyko išsiųsti – žiūrėk dienoraštyje');
    if (r.held && !r.sent && !r.failed) toast(r.held);
    if ((r.sent || r.failed || r.held) && typeof ctx.onSynced === 'function') ctx.onSynced();
  };

  async function loadUser() {
    ctx.state.user = backend.getUser();
    ctx.state.profile = ctx.state.user ? await backend.myProfile().catch(() => null) : null;
    ctx.state.ban = ctx.state.user ? await backend.myBan?.().catch(() => null) ?? null : null;
  }

  ctx.state.species = await backend.species().catch(() => []);
  await loadUser();
  const presence = startPresence(ctx);
  backend.onAuth(async () => {
    await loadUser();
    render(true);
    ctx.flush();
    presence.reset();
    presence.touch();
  });

  async function refreshStatus() {
    const items = await ctx.outbox.list().catch(() => []);
    ctx.state.outboxPending = items.filter((x) => x.state === 'queued').length;
    ctx.state.outboxFailed = items.filter((x) => x.state === 'failed').length;
    const el = $('#status');
    const { outboxPending: p, outboxFailed: f } = ctx.state;
    if (!p && !f) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    el.hidden = false;
    el.innerHTML = String(html`<a href="#/dienorastis" class="status-bar ${f ? 'status-bad' : ''}">
      ${icon(f ? 'alert' : 'cloudOff', 18)}
      <span>${p ? `${count(p, 'laimikis laukia', 'laimikiai laukia', 'laimikių laukia')} išsiuntimo` : ''}${p && f ? ' · ' : ''}${f ? `${f} neišsiųsta` : ''}</span>
    </a>`);
  }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  let cleanup = null;
  let token = 0;
  async function render(keepScroll = false) {
    const my = ++token;
    const raw = location.hash.replace(/^#/, '') || '/';
    const [path, qs] = raw.split('?');
    const query = new URLSearchParams(qs || '');
    let match = null;
    let view = null;
    for (const [re, v] of ROUTES) {
      match = path.match(re);
      if (match) { view = v; break; }
    }
    if (!view) { location.hash = '#/'; return; }

    const main = $('#view');
    main.setAttribute('aria-busy', 'true');
    let result;
    try {
      result = await view(ctx, match.slice(1), query);
    } catch (err) {
      console.error(err);
      result = {
        nav: 'turnyrai',
        html: html`<div class="screen"><div class="empty">
          <div class="empty-icon">${icon('alert', 32)}</div>
          <h1 class="empty-title" tabindex="-1">Nepavyko įkelti</h1>
          <p class="muted">${navigator.onLine ? 'Bandyk dar kartą po akimirkos.' : 'Nėra interneto ryšio.'}</p>
          <button class="btn" data-retry>${icon('refresh', 18)}Bandyti dar kartą</button>
        </div></div>`,
        mount: (root) => root.querySelector('[data-retry]').addEventListener('click', () => render(true))
      };
    }
    if (my !== token) return;

    if (typeof cleanup === 'function') cleanup();
    cleanup = null;
    const y = window.scrollY;
    main.innerHTML = String(result.html);
    main.removeAttribute('aria-busy');
    document.title = result.title ? `${result.title} · Žvejybos turnyrai` : 'Žvejybos turnyrai';
    renderNav(result.nav);
    document.body.classList.toggle('no-nav', !result.nav);
    document.body.classList.toggle('dark-screen', !!result.dark);
    window.scrollTo(0, keepScroll ? y : 0);
    if (result.mount) {
      const out = result.mount(main);
      // Asinchroninis mount (pvz. žemėlapis): valymo funkcija ateina vėliau – jei jau išėjome, valom iškart.
      if (out && typeof out.then === 'function') {
        out.then((fn) => { if (typeof fn !== 'function') return; if (my === token) cleanup = fn; else fn(); }).catch(() => {});
      } else {
        cleanup = out || null;
      }
    }
    if (!keepScroll) main.querySelector('h1')?.focus({ preventScroll: true });
  }

  function renderNav(active) {
    const nav = $('#nav');
    if (!active) { nav.hidden = true; return; }
    nav.hidden = false;
    nav.innerHTML = NAV.map(([key, href, ic, label]) => key === 'laimikis'
      ? String(html`<a class="fab" href="${href}" aria-label="${label}">${icon(ic, 28, 2.6)}</a>`)
      : String(html`<a class="nav-item${active === key ? ' active' : ''}" href="${href}"${active === key ? html` aria-current="page"` : ''}>${icon(ic, 24)}<span>${label}</span></a>`)
    ).join('');
  }

  window.addEventListener('hashchange', () => render());
  window.addEventListener('online', () => ctx.flush());
  setInterval(() => { if (ctx.state.outboxPending && navigator.onLine) ctx.flush(); }, 60000);

  await refreshStatus();
  await render();
  if (authError) toast(authError);
  else if (authHash && ctx.state.user) toast('Prisijungei');
  ctx.flush();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  window.__zt = ctx; // testams ir derinimui
}

main().catch((err) => {
  console.error(err);
  document.getElementById('view').innerHTML =
    '<div class="screen"><p class="empty-title">Programėlės paleisti nepavyko.</p><p class="muted">Patikrink ryšį ir perkrauk puslapį.</p></div>';
});
