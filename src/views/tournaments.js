import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { phase, timeLabel, describeFormat, cm, longDate, count } from '../lib/format.js';
import { phaseBadge, empty } from '../ui.js';

const SEGMENTS = [
  ['mano', 'Mano'],
  ['live', 'Vyksta'],
  ['soon', 'Artėja'],
  ['done', 'Baigėsi']
];

function segmentOf(list, key) {
  if (key === 'mano') return list.filter((t) => t.joined && phase(t) !== 'done');
  return list.filter((t) => phase(t) === key);
}

function speciesLine(t, species) {
  if (!t.species_ids.length) return 'Visos rūšys';
  return t.species_ids.map((id) => species.find((s) => s.id === id)?.name_lt).filter(Boolean).join(', ');
}

export function card(t, species) {
  return html`<a class="card card-link t-card" href="#/t/${t.id}">
    <div class="row-between">
      ${phaseBadge(t)}
      <span class="muted small strong">Nemokamas</span>
    </div>
    <div class="stack-2">
      <span class="t-title">${t.title}</span>
      <span class="muted">${describeFormat(t)} · ${speciesLine(t, species)}</span>
    </div>
    <div class="meta">
      <span>${icon('clock', 16)}${timeLabel(t)}</span>
      <span>${icon('users', 16)}${t.participants}</span>
      ${t.min_length_mm ? html`<span>nuo ${cm(t.min_length_mm)}</span>` : ''}
    </div>
    ${t.joined ? html`<span class="accent strong">${phase(t) === 'soon' ? 'Užsiregistravai' : 'Dalyvauji'}</span>` : ''}
  </a>`;
}

async function heroFor(ctx, list) {
  const me = ctx.state.user?.id;
  const live = list.find((t) => t.joined && phase(t) === 'live');
  if (!me || !live) return '';
  const board = await ctx.backend.leaderboard(live.id).catch(() => []);
  const idx = board.findIndex((r) => r.user_id === me);
  const mine = board[idx];
  const above = idx > 0 ? board[idx - 1] : null;
  const gap = mine && above ? above.score_mm - mine.score_mm : 0;
  return html`<a class="card card-link hero" href="#/t/${live.id}">
    <div class="row-between">${phaseBadge(live, 'dalyvauji')}</div>
    <div class="stack-2">
      <h2 class="display-md">${live.title}</h2>
      <span class="muted">${describeFormat(live)}${live.min_length_mm ? ` · nuo ${cm(live.min_length_mm)}` : ''}</span>
    </div>
    <div class="grid-3">
      <div class="stat-box"><span class="stat-label">Tavo vieta</span>
        <span class="stat-value accent">${mine ? `#${mine.rank}` : '–'}</span>
        <span class="stat-label">iš ${live.participants}</span></div>
      <div class="stat-box"><span class="stat-label">Rezultatas</span>
        <span class="stat-value">${mine ? cm(mine.score_mm) : '–'}</span>
        <span class="stat-label">${mine ? count(Number(mine.counted), 'žuvis', 'žuvys', 'žuvų') : 'dar nėra'}</span></div>
      <div class="stat-box"><span class="stat-label">Liko</span>
        <span class="stat-value">${timeLabel(live).replace('Liko ', '').split(' ').slice(0, 2).join(' ')}</span>
        <span class="stat-label">iki ${longDate(live.ends_at)}</span></div>
    </div>
    ${mine && above ? html`<div class="stack-2">
      <div class="row-between small strong"><span>Iki #${above.rank} trūksta ${cm(gap)}</span><span class="muted">${above.nickname}</span></div>
      <div class="progress"><div style="width:${Math.max(4, Math.min(100, Math.round((mine.score_mm / above.score_mm) * 100)))}%"></div></div>
    </div>` : ''}
    ${!mine ? html`<span class="small muted">Užregistruok pirmą laimikį – ir atsirasi lentelėje.</span>` : ''}
  </a>`;
}

export async function tournamentsView(ctx) {
  const [list] = await Promise.all([ctx.backend.tournaments()]);
  const species = ctx.state.species;
  let seg = sessionStorage.getItem('zt-seg') || (list.some((t) => t.joined && phase(t) !== 'done') ? 'mano' : 'live');
  const hero = await heroFor(ctx, list);
  const weekday = new Intl.DateTimeFormat('lt-LT', { weekday: 'long' }).format(new Date());
  const today = `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${longDate(new Date())}`;

  const listHtml = (key) => {
    const items = segmentOf(list, key).sort((a, b) => key === 'done'
      ? new Date(b.ends_at) - new Date(a.ends_at)
      : new Date(a.ends_at) - new Date(b.ends_at));
    if (!items.length) {
      return key === 'mano'
        ? empty('Dar nedalyvauji jokiame turnyre', 'Pasirink vykstantį arba artėjantį turnyrą.')
        : empty('Čia kol kas tuščia', key === 'soon' ? 'Gal sukurk savo turnyrą?' : '');
    }
    return items.map((t) => card(t, species));
  };

  return {
    nav: 'turnyrai',
    title: 'Turnyrai',
    html: html`<div class="screen">
      <header class="page-head">
        <div class="stack-2">
          <p class="muted strong small">${today}</p>
          <h1 class="display-lg" tabindex="-1">Turnyrai</h1>
        </div>
      </header>
      ${ctx.backend.mode === 'demo' ? html`<p class="demo-note">${icon('alert', 16)}Demonstracinis režimas: pavyzdiniai duomenys, saugomi tik šiame telefone.</p>` : ''}
      ${hero}
      <section class="stack">
        <h2 class="h2">Visi turnyrai</h2>
        <div class="seg" role="group" aria-label="Turnyrų filtras">
          ${SEGMENTS.map(([key, label]) => html`<button type="button" data-seg="${key}" aria-pressed="${key === seg}">${label}<span>${segmentOf(list, key).length}</span></button>`)}
        </div>
        <div class="stack" data-list>${listHtml(seg)}</div>
        <a class="btn btn-dashed" href="${ctx.state.user ? '#/naujas' : '#/prisijungti'}">${icon('plus', 20)}Sukurti savo turnyrą</a>
      </section>
    </div>`,
    mount(root) {
      root.querySelectorAll('[data-seg]').forEach((b) => b.addEventListener('click', () => {
        seg = b.dataset.seg;
        sessionStorage.setItem('zt-seg', seg);
        root.querySelectorAll('[data-seg]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        root.querySelector('[data-list]').innerHTML = String(html`${listHtml(seg)}`);
      }));
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
      ${rows.length ? html`<div class="stack">${rows.map(({ t, mine, total }) => html`
        <a class="card card-link row" href="#/t/${t.id}/lentele">
          <span class="rank-big ${mine ? 'accent' : 'muted'}">${mine ? `#${mine.rank}` : '–'}</span>
          <span class="grow stack-1">
            <span class="strong">${t.title}</span>
            <span class="small muted">${mine ? `${cm(mine.score_mm)} · iš ${total} lentelėje` : 'Dar neturi įskaitytų laimikių'}</span>
            <span class="small">${phaseBadge(t)}</span>
          </span>
          ${icon('chevron', 20)}
        </a>`)}</div>`
        : empty('Lentelių dar nėra', 'Kai dalyvausi turnyre, čia matysi savo vietą.', html`<a class="btn" href="#/">Žiūrėti turnyrus</a>`)}
    </div>`
  };
}
