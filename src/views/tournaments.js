import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { phase, timeLabel, scoreText, registrationOpen } from '../lib/format.js';
import { phaseBadge, empty, defaultNickname, banNotice } from '../ui.js';
import { eur } from '../lib/prizes.js';
import { hasUnseen } from '../lib/seen.js';
import { checkBanners } from './check.js';
import { sortSponsors, logoTile, trackViews } from '../lib/sponsors.js';
import { feat } from '../lib/clubs.js';

const SEGMENTS = [
  ['visi', 'Visi'],
  ['mano', 'Mano'],
  ['live', 'Vyksta'],
  ['soon', 'Artėja'],
  ['done', 'Baigėsi']
];
const SECTION_MAX = { soon: 2, live: 3 };

function segmentOf(list, key) {
  if (key === 'visi') return list;
  if (key === 'mano') return list.filter((t) => t.joined && phase(t) !== 'done');
  return list.filter((t) => phase(t) === key);
}

const byStart = (a, b) => new Date(a.starts_at) - new Date(b.starts_at);
const byEnd = (a, b) => new Date(a.ends_at) - new Date(b.ends_at);
const MONTHS = ['saus.', 'vas.', 'kov.', 'bal.', 'geg.', 'birž.', 'liep.', 'rugp.', 'rugs.', 'spal.', 'lapkr.', 'gruod.'];
const HOUR = new Intl.DateTimeFormat('lt-LT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vilnius' });
const DM = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'numeric', timeZone: 'Europe/Vilnius' });
// Diena ir mėnuo Lietuvos laiku: { day: 8, month: 'lapkr.' }
export function dayMonth(d) {
  const parts = Object.fromEntries(DM.formatToParts(new Date(d)).map((x) => [x.type, x.value]));
  return { day: Number(parts.day), month: MONTHS[Number(parts.month) - 1] };
}

// Rėmėjų logotipai kortelėje (be atskirų nuorodų – visa kortelė veda į turnyrą).
function logos(t, max = 2, cls = 'logo-xs') {
  const list = sortSponsors(t.sponsors);
  if (!list.length) return '';
  const shown = list.slice(0, max);
  return html`<span class="t-sponsors l-logos" aria-label="Rėmėjai">${shown.map((s) => logoTile(s, cls))}${list.length > shown.length ? html`<span class="small muted strong">+${list.length - shown.length}</span>` : ''}</span>`;
}

const liveDot = (t) => {
  const p = phase(t);
  return html`<span class="l-phase l-${p}">${p === 'live' ? html`<i></i>` : ''}${{ live: 'Vyksta', soon: 'Artėja', done: 'Baigėsi' }[p]}</span>`;
};
const lock = (t) => (t.visibility === 'private' ? html`${icon('lock', 14, 2.6)} ` : '');
const bell = (t) => (hasUnseen(t) ? html`<span class="l-bell" data-ann-dot role="img" aria-label="Naujas organizatoriaus pranešimas">${icon('bell', 20)}</span>` : '');
const href = (t) => `#/t/${t.id}${hasUnseen(t) ? '?skiltis=pranesimai' : ''}`;
const timeShort = (t) => timeLabel(t).replace(/^Liko /, 'liko ').replace(/^Startas po /, 'startas po ');

// „Tavo turnyrai“: didelė vieta kairėje, laikas, rėmėjai, pranešimo varpelis.
function mineRow(t, rank) {
  const place = phase(t) === 'soon' ? '–' : rank === null || rank === undefined ? '–' : `#${rank}`;
  return html`<a class="card-link l-mine t-card" href="${href(t)}">
    <span class="l-place ${place === '–' ? 'muted' : ''}" aria-label="Tavo vieta">${place}</span>
    <span class="grow stack-1">
      <span class="strong l-title">${lock(t)}${t.title}</span>
      <span class="l-line">${liveDot(t)}<span>${timeShort(t)}</span><span>${icon('users', 15)} ${t.participants}</span></span>
      ${logos(t)}
    </span>
    ${bell(t)}<span class="l-chev">${icon('chevron', 20)}</span>
  </a>`;
}

// Artėjantis turnyras – reklaminė kortelė: data, startas, fondas, rėmėjai, kvietimas registruotis.
function promoCard(t, me) {
  const d = new Date(t.starts_at);
  const dm = dayMonth(d);
  const own = me && t.organizer_id === me;
  return html`<a class="card-link l-promo t-card" href="${href(t)}">
    <span class="row gap-12 l-top">
      <span class="l-date" aria-hidden="true"><b>${dm.day}</b><span>${dm.month}</span></span>
      <span class="grow stack-1">
        <span class="l-title-lg">${lock(t)}${t.title}</span>
        <span class="l-soon">${timeLabel(t)} · ${HOUR.format(d)}</span>
        <span class="l-line">
          <span>${icon('users', 15)} ${t.participants} užsiregistravo</span>
          ${t.prize_fund_cents ? html`<span class="accent strong">${icon('trophy', 15)} ${eur(t.prize_fund_cents)}</span>` : t.prizes ? html`<span>${icon('trophy', 15)} Prizai</span>` : ''}
        </span>
      </span>
    </span>
    ${t.sponsors?.length ? html`<span class="l-remia"><span class="small muted strong">Remia</span>${logos(t, 3, 'logo-sm')}</span>` : ''}
    ${t.joined ? html`<span class="l-cta l-cta-done">${icon('check', 18, 2.6)}Užsiregistravai</span>`
      : own ? html`<span class="l-cta l-cta-done">${icon('edit', 18)}Tavo turnyras</span>`
      : html`<span class="l-cta">${icon('plus', 18, 2.6)}Registruotis</span>`}
  </a>`;
}

// Vykstantis ar pasibaigęs – glausta kortelė.
function rowCard(t, rank) {
  const p = phase(t);
  return html`<a class="card-link l-row t-card" href="${href(t)}">
    <span class="grow stack-1">
      <span class="strong l-title">${lock(t)}${t.title}</span>
      <span class="l-line">${liveDot(t)}<span>${p === 'done' ? timeLabel(t) : timeShort(t)}</span><span>${icon('users', 15)} ${t.participants}</span>
        ${t.prize_fund_cents ? html`<span class="accent strong">${icon('trophy', 15)} ${eur(t.prize_fund_cents)}</span>` : ''}
        ${t.joined && rank ? html`<span class="l-rank">#${rank}</span>` : ''}</span>
      ${logos(t)}
    </span>
    ${bell(t)}<span class="l-chev">${icon('chevron', 20)}</span>
  </a>`;
}

async function ranksFor(ctx, list) {
  const me = ctx.state.user?.id;
  const ranks = {};
  if (!me) return ranks;
  const mine = list.filter((t) => t.joined && phase(t) !== 'soon').slice(0, 8);
  await Promise.all(mine.map(async (t) => {
    const board = await ctx.backend.leaderboard(t.id).catch(() => []);
    ranks[t.id] = board.find((r) => r.user_id === me)?.rank ?? null;
  }));
  return ranks;
}

export async function tournamentsView(ctx) {
  const [list, checks] = await Promise.all([
    ctx.backend.tournaments(),
    ctx.state.user && ctx.backend.myChecks ? ctx.backend.myChecks().catch(() => []) : []
  ]);
  const me = ctx.state.user?.id;
  const savedSeg = sessionStorage.getItem('zt-seg');
  let seg = SEGMENTS.some(([k]) => k === savedSeg) ? savedSeg : 'visi';
  const ranks = await ranksFor(ctx, list);

  const mineList = () => list.filter((t) => t.joined && phase(t) !== 'done')
    .sort((a, b) => (phase(a) === 'live' ? 0 : 1) - (phase(b) === 'live' ? 0 : 1) || byEnd(a, b));
  const soonOpen = () => list.filter((t) => phase(t) === 'soon' && !t.joined).sort(byStart);
  const liveOpen = () => list.filter((t) => phase(t) === 'live' && !t.joined && registrationOpen(t)).sort(byEnd);
  const sectionHead = (title, key, n) => html`<div class="l-sec"><h2 class="h2">${title}</h2>${n > SECTION_MAX[key] ? html`<button type="button" class="link-btn accent strong" data-seg-go="${key}">Visi (${n})</button>` : ''}</div>`;

  const homeHtml = () => {
    const mine = mineList();
    const soon = soonOpen();
    const live = liveOpen();
    const done = segmentOf(list, 'done');
    if (!mine.length && !soon.length && !live.length) {
      return html`${empty('Šiuo metu turnyrų nėra', 'Sukurk savo ir pakviesk draugus.')}
        ${done.length ? html`<button type="button" class="l-more" data-seg-go="done"><span>Pasibaigę turnyrai ir nugalėtojai</span>${icon('chevron', 18)}</button>` : ''}`;
    }
    return html`
      ${mine.length ? html`<section class="stack-2" data-sec="mano"><div class="l-sec"><h2 class="h2">Tavo turnyrai</h2></div>
        <div class="l-list">${mine.map((t) => mineRow(t, ranks[t.id]))}</div></section>` : ''}
      ${soon.length ? html`<section class="stack-2" data-sec="soon">${sectionHead('Artėja – registruokis', 'soon', soon.length)}
        <div class="l-list">${soon.slice(0, SECTION_MAX.soon).map((t) => promoCard(t, me))}</div></section>` : ''}
      ${live.length ? html`<section class="stack-2" data-sec="live">${sectionHead('Vyksta – dar gali prisijungti', 'live', live.length)}
        <div class="l-list">${live.slice(0, SECTION_MAX.live).map((t) => rowCard(t, ranks[t.id]))}</div></section>` : ''}
      ${done.length ? html`<button type="button" class="l-more" data-seg-go="done"><span>Pasibaigę turnyrai ir nugalėtojai</span>${icon('chevron', 18)}</button>` : ''}`;
  };

  const listHtml = (key) => {
    if (key === 'visi') return homeHtml();
    if (key === 'mano') {
      const items = mineList();
      return items.length ? html`<div class="l-list">${items.map((t) => mineRow(t, ranks[t.id]))}</div>`
        : empty('Dar nedalyvauji jokiame turnyre', 'Pasirink vykstantį arba artėjantį turnyrą.');
    }
    const items = segmentOf(list, key).sort(key === 'done' ? (a, b) => byEnd(b, a) : key === 'soon' ? byStart : byEnd);
    if (!items.length) return empty('Čia kol kas tuščia', key === 'soon' ? 'Gal sukurk savo turnyrą?' : '');
    return html`<div class="l-list">${items.map((t) => (key === 'soon' ? promoCard(t, me) : rowCard(t, ranks[t.id])))}</div>`;
  };
  // Kurių turnyrų rėmėjai matomi ekrane – parodymams skaičiuoti.
  const shownFor = (key) => {
    if (key !== 'visi') return segmentOf(list, key);
    return [...mineList(), ...soonOpen().slice(0, SECTION_MAX.soon), ...liveOpen().slice(0, SECTION_MAX.live)];
  };

  return {
    nav: 'turnyrai',
    title: 'Turnyrai',
    html: html`<div class="screen">
      <header class="page-head l-head">
        <h1 class="display-lg" tabindex="-1">Turnyrai</h1>
        <a class="l-new" href="${ctx.state.user ? '#/naujas' : '#/prisijungti'}" aria-label="Sukurti naują turnyrą">${icon('plus', 18, 2.6)}Naujas</a>
      </header>
      ${ctx.backend.mode === 'demo' ? html`<p class="demo-note">${icon('alert', 16)}Demonstracinis režimas: pavyzdiniai duomenys, saugomi tik šiame telefone.</p>` : ''}
      ${banNotice(ctx.state.ban)}
      ${checkBanners(checks)}
      ${ctx.state.user && !ctx.state.ban && defaultNickname(ctx.state.profile?.nickname) ? html`<a class="card card-link row ann-banner" href="#/profilis" data-nick-banner>
        ${icon('user', 22)}<span class="grow stack-1"><span class="strong">Pasirink slapyvardį</span><span class="small muted">Jį matys kiti žvejai lentelėse</span></span>${icon('chevron', 18)}
      </a>` : ''}
      <div class="l-seg" role="group" aria-label="Turnyrų filtras">
        ${SEGMENTS.map(([key, label]) => html`<button type="button" data-seg="${key}" aria-pressed="${key === seg}">${label}</button>`)}
      </div>
      <div class="stack-lg" data-list>${listHtml(seg)}</div>
    </div>`,
    mount(root) {
      const listEl = root.querySelector('[data-list]');
      const pick = (key, scroll) => {
        seg = key;
        sessionStorage.setItem('zt-seg', seg);
        root.querySelectorAll('[data-seg]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.seg === key)));
        listEl.innerHTML = String(html`${listHtml(seg)}`);
        bindGo();
        trackViews(ctx.backend, shownFor(seg).flatMap((t) => t.sponsors || []));
        if (scroll) root.querySelector('.l-seg')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      };
      const bindGo = () => listEl.querySelectorAll('[data-seg-go]').forEach((b) => b.addEventListener('click', () => pick(b.dataset.segGo, true)));
      root.querySelectorAll('[data-seg]').forEach((b) => b.addEventListener('click', () => pick(b.dataset.seg, false)));
      bindGo();
      trackViews(ctx.backend, shownFor(seg).flatMap((t) => t.sponsors || []));
    }
  };
}

export async function standingsView(ctx) {
  const me = ctx.state.user?.id;
  const list = (await ctx.backend.tournaments()).filter((t) => t.joined && phase(t) !== 'soon');
  const rows = await Promise.all(list.map(async (t) => {
    const board = await ctx.backend.leaderboard(t.id).catch(() => []);
    return { t, mine: board.find((r) => r.user_id === me), total: board.length };
  }));
  rows.sort((a, b) => (phase(a.t) === 'live' ? 0 : 1) - (phase(b.t) === 'live' ? 0 : 1) || new Date(b.t.ends_at) - new Date(a.t.ends_at));

  return {
    nav: 'lenteles',
    title: 'Lentelės',
    html: html`<div class="screen">
      <header class="page-head"><h1 class="display-lg" tabindex="-1">Lentelės</h1></header>
      <nav class="grid-2 social-links" aria-label="Bendruomenė">
        ${feat(ctx.state, 'social_follow') ? html`<a class="card card-link row gap-8" href="#/sekami" data-follow-link>${icon('star', 20)}<span class="strong grow">Sekami</span>${icon('chevron', 16)}</a>` : ''}
        <a class="card card-link row gap-8 ${feat(ctx.state, 'social_follow') ? '' : 'span-2'}" href="#/klubai">${icon('users', 20)}<span class="strong grow">Klubai</span>${icon('chevron', 16)}</a>
        ${feat(ctx.state, 'leagues') ? html`<a class="card card-link row gap-8 span-2" href="#/lygos" data-leagues-link>${icon('trophy', 20)}<span class="strong grow">Sezono lygos</span>${icon('chevron', 16)}</a>` : ''}
      </nav>
      ${rows.length ? html`<div class="stack">${rows.map(({ t, mine, total }) => html`
        <a class="card card-link row" href="#/t/${t.id}/lentele">
          <span class="rank-big ${mine ? 'accent' : 'muted'}">${mine && mine.rank !== null ? `#${mine.rank}` : '–'}</span>
          <span class="grow stack-1">
            <span class="strong">${t.title}</span>
            <span class="small muted">${mine ? `${scoreText(t, mine.score_mm)} · ${mine.rank === null ? 'lentelė paslėpta iki pabaigos' : `iš ${total} lentelėje`}` : 'Dar neturi įskaitytų laimikių'}</span>
            <span class="small">${phaseBadge(t)}</span>
          </span>
          ${icon('chevron', 20)}
        </a>`)}</div>`
        : empty('Lentelių dar nėra', 'Kai dalyvausi turnyre, čia matysi savo vietą.', html`<a class="btn" href="#/">Žiūrėti turnyrus</a>`)}
    </div>`
  };
}
