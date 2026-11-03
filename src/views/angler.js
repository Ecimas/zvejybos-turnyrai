// Žvejo profilis (#/zvejys/:id): kaip šį žvejį mato kiti.
// Viršus su sekimu ir žinute, turnyrų istorija su vietomis, statistika, ženkliukai, rekordai ir galerija.
import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { cm, count, phase, shortDate, scoreText, size } from '../lib/format.js';
import { fitReason } from '../lib/scoring.js';
import { payouts } from '../lib/prizes.js';
import { thumb, hydratePhotos, empty, avatar, notFound } from '../ui.js';
import { feat } from '../lib/clubs.js';
import { can, isStaff } from '../lib/roles.js';
import { mountFollow } from './social.js';
import { stats, seasonChart, records, badges, modCard, mountModCard, roleBadges } from './profile.js';

const MONTH_GEN = ['sausio', 'vasario', 'kovo', 'balandžio', 'gegužės', 'birželio', 'liepos', 'rugpjūčio', 'rugsėjo', 'spalio', 'lapkričio', 'gruodžio'];
const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };
const HISTORY_MAX = 20;   // tiek naujausių turnyrų skaičiuojama
const HISTORY_SHOW = 5;   // tiek matoma iš karto
const GALLERY_SHOW = 12;

export const memberSince = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `Narys nuo ${d.getFullYear()} m. ${MONTH_GEN[d.getMonth()]}`;
};

// Turnyrų istorija: vieta, rezultatas, prizas. Paslėptos lentelės vieta nerodoma, kol turnyras nesibaigė.
export async function tournamentHistory(backend, state, uid, entries) {
  const joined = new Map(entries.map((e) => [e.tournament_id, e.joined_at]));
  if (!joined.size) return [];
  const all = await backend.tournaments().catch(() => []);
  // Pirma vykstantys, tada baigti (naujausi viršuje), gale – dar neprasidėję.
  const order = { live: 0, done: 1, soon: 2 };
  const list = all.filter((t) => joined.has(t.id))
    .sort((a, b) => order[phase(a)] - order[phase(b)] || String(b.ends_at).localeCompare(String(a.ends_at)))
    .slice(0, HISTORY_MAX);
  return Promise.all(list.map(async (t) => {
    const p = phase(t);
    const hidden = t.leaderboard_hidden && p !== 'done' && t.organizer_id !== state.user?.id && !isStaff(state.profile);
    const board = p === 'soon' || hidden ? [] : await backend.leaderboard(t.id).catch(() => []);
    const row = board.find((r) => r.user_id === uid) || null;
    const pay = row ? payouts(board, t.prize_fund_cents || 0, t.prize_split) : new Map();
    return { t, phase: p, hidden, row, of: board.length, prize: pay.get(uid) || 0, joinedAt: joined.get(t.id) };
  }));
}

export function medalCounts(history) {
  const out = { 1: 0, 2: 0, 3: 0, prizes: 0 };
  for (const h of history) {
    if (h.phase !== 'done' || !h.row) continue;
    if (h.row.rank <= 3) out[h.row.rank]++;
    if (h.prize) out.prizes++;
  }
  return out;
}

function bestPlace(history) {
  return history.filter((h) => h.phase === 'done' && h.row)
    .sort((a, b) => a.row.rank - b.row.rank || b.of - a.of)[0] || null;
}

function heroCard(p, ctx, { follow, clubs, medals, best, isMe }) {
  const { state } = ctx;
  const loggedIn = !!state.user && !state.ban;
  // Tik kai serveryje jau įdiegta (jungiklis aiškiai įjungtas) – kitaip mygtuko nerodom.
  const canWrite = loggedIn && !isMe && state.features?.direct_messages === true;
  return html`<section class="card ap-hero" data-ap-hero>
    <div class="ap-top">
      ${avatar(p.nickname, 'avatar-xl')}
      <div class="grow stack-1 min0">
        <h1 class="display-md ellipsis" tabindex="-1">${p.nickname}</h1>
        ${p.region ? html`<span class="muted ellipsis">${p.region}</span>` : ''}
        <span class="small muted">${memberSince(p.created_at)}</span>
        ${roleBadges(p)}
      </div>
    </div>
    ${follow ? html`<p class="small muted ap-follow" data-follow-counts><b>${follow.followers}</b> ${follow.followers === 1 ? 'sekėjas' : 'sekėjai'} · seka <b>${follow.following}</b></p>` : ''}
    ${isMe ? html`<a class="btn btn-ghost" href="#/profilis" data-ap-own>${icon('edit', 18)}Tai tavo profilis – redaguoti</a>`
      : loggedIn ? html`<div class="ap-actions">
        ${follow ? html`<button class="btn ${follow.i_follow ? 'btn-ghost' : 'btn-primary'}" type="button" data-follow aria-pressed="${follow.i_follow}">
          ${follow.i_follow ? html`${icon('check', 18, 3)}Seki` : html`${icon('plus', 18, 2.6)}Sekti`}</button>` : ''}
        ${canWrite ? html`<button class="btn btn-ghost" type="button" data-ap-write>${icon('chat', 18)}Rašyti</button>` : ''}
      </div>` : ''}
    ${medals.prizes || medals[1] || medals[2] || medals[3] ? html`<div class="ap-medals" data-ap-medals aria-label="Turnyrų apdovanojimai">
      ${[1, 2, 3].filter((n) => medals[n]).map((n) => html`<span class="ap-medal" data-medal="${n}"><span aria-hidden="true">${MEDAL[n]}</span><b>×${medals[n]}</b><span class="sr-only">${n} vieta</span></span>`)}
      ${medals.prizes ? html`<span class="ap-medal prize">${icon('trophy', 16)}<span class="small">${count(medals.prizes, 'prizinė vieta', 'prizinės vietos', 'prizinių vietų')}</span></span>` : ''}
    </div>` : ''}
    ${best ? html`<p class="small ap-best" data-ap-best>Geriausias rezultatas: <b>${best.row.rank} vieta</b> iš ${best.of} · ${best.t.title}</p>` : ''}
    ${clubs.length ? html`<p class="row gap-8 wrap">${clubs.map((c) => html`<a class="badge badge-mine club-badge" href="#/klubas/${c.id}">${icon('users', 12, 2.6)}${c.name}</a>`)}</p>` : ''}
  </section>`;
}

function statGrid4(s, tournaments) {
  const big = s.records[0];
  return html`<div class="grid-2" data-ap-stats>
    <div class="stat-box center"><span class="stat-value">${s.ok.length}</span><span class="stat-label">Laimikiai</span></div>
    <div class="stat-box center"><span class="stat-value">${tournaments}</span><span class="stat-label">Turnyrai</span></div>
    <div class="stat-box center"><span class="stat-value">${s.speciesCount}</span><span class="stat-label">Rūšys</span></div>
    <div class="stat-box center"><span class="stat-value">${big ? size(big) : '–'}</span><span class="stat-label">${big ? `Didžiausia · ${big.name}` : 'Didžiausia'}</span></div>
  </div>`;
}

function historySection(history, uid) {
  if (!history.length) return '';
  const more = history.length > HISTORY_SHOW;
  return html`<section class="stack-2" aria-labelledby="ap-hist-h">
    <div class="row-between"><h2 class="h2" id="ap-hist-h">Turnyrų istorija</h2>
      ${more ? html`<button type="button" class="link-btn small muted strong" data-hist-more>Visi (${history.length})</button>` : ''}</div>
    <ol class="plain list" data-ap-history>${history.map((h, i) => {
      const r = h.row;
      const place = h.phase === 'soon' ? html`<span class="ap-place soon" aria-hidden="true">${icon('clock', 18)}</span>`
        : h.hidden ? html`<span class="ap-place" aria-hidden="true">${icon('lock', 18)}</span>`
        : r && h.phase === 'done' && r.rank <= 3 ? html`<span class="ap-place medal" aria-hidden="true">${MEDAL[r.rank]}</span>`
        : html`<span class="ap-place" aria-hidden="true">${r ? `#${r.rank}` : '–'}</span>`;
      const sub = h.phase === 'soon' ? `Prasidės ${shortDate(h.t.starts_at)}`
        : h.hidden ? 'Vieta paslėpta iki pabaigos'
        : r ? `${r.rank} vieta iš ${h.of} · ${scoreText(h.t, r.score_mm)}`
        : 'Įskaitytų laimikių nebuvo';
      return html`<li ${more && i >= HISTORY_SHOW ? html`hidden data-hist-extra` : ''}><a class="list-row" href="#/t/${h.t.id}/dalyvis/${uid}" data-ap-tour="${h.t.id}">
        ${place}
        <span class="grow stack-1 min0"><span class="strong ellipsis">${h.t.title}</span><span class="small muted ellipsis">${sub}</span></span>
        ${h.phase === 'live' ? html`<span class="chip chip-ok">Vyksta</span>` : h.prize ? html`<span class="chip chip-prize" data-ap-prize>${icon('trophy', 13, 2.6)}Prizas</span>` : ''}
        ${icon('chevron', 18)}
      </a></li>`;
    })}</ol>
  </section>`;
}

// Galerija: filtras pagal rūšį, rikiavimas, turnyro žymė (laimikis įskaitytas bent viename turnyre).
function gallerySection(s, state, history) {
  if (!s.ok.length) return empty('Patvirtintų laimikių dar nėra');
  const tourOf = (c) => history.find((h) => h.phase !== 'soon' && !h.hidden && fitReason(h.t, h.t.species_ids || [], h.joinedAt || true, c) === 'ok');
  const spName = (id) => state.species.find((x) => x.id === id)?.name_lt ?? '';
  const species = [...new Set(s.ok.map((c) => c.species_id))]
    .map((id) => ({ id, n: s.ok.filter((c) => c.species_id === id).length })).sort((a, b) => b.n - a.n);
  const items = s.ok.slice().sort((a, b) => String(b.captured_at_device).localeCompare(String(a.captured_at_device))).slice(0, 60);
  return html`<section class="stack-2" data-ap-gallery aria-labelledby="ap-gal-h">
    <div class="row-between"><h2 class="h2" id="ap-gal-h">Laimikiai <span class="muted">(${s.ok.length})</span></h2></div>
    <div class="seg ap-sort" role="group" aria-label="Rikiuoti">
      <button type="button" data-sort="new" aria-pressed="true">Naujausi</button>
      <button type="button" data-sort="big" aria-pressed="false">Didžiausi</button>
    </div>
    ${species.length > 1 ? html`<div class="ap-chips" role="group" aria-label="Rūšis">
      <button type="button" class="ap-chip" data-sp="" aria-pressed="true">Visos</button>
      ${species.map((x) => html`<button type="button" class="ap-chip" data-sp="${x.id}" aria-pressed="false">${spName(x.id)} <span class="muted">${x.n}</span></button>`)}
    </div>` : ''}
    <div class="gallery" data-ap-grid>${items.map((c) => {
      const tour = tourOf(c);
      return html`<a href="#/l/${c.id}" data-gi data-sp-id="${c.species_id}" data-len="${c.length_mm || 0}" data-w="${c.weight_g || 0}" data-at="${c.captured_at_device}"><figure>
        <span class="ap-ph">${thumb(c.photo_path, 104)}${tour ? html`<span class="ap-tag" title="${tour.t.title}" data-ap-tag>${icon('trophy', 12, 2.6)}<span class="sr-only">Turnyre: ${tour.t.title}</span></span>` : ''}</span>
        <figcaption><span class="strong">${size(c)}</span> <span class="muted small">${spName(c.species_id)}</span></figcaption>
      </figure></a>`;
    })}</div>
    <button type="button" class="btn btn-ghost" data-gal-more hidden>Rodyti daugiau</button>
    <p class="small muted row gap-8">${icon('trophy', 14)}– laimikis įskaitytas turnyre</p>
  </section>`;
}

function mountGallery(root) {
  const box = root.querySelector('[data-ap-gallery]');
  if (!box) return;
  const grid = box.querySelector('[data-ap-grid]');
  const more = box.querySelector('[data-gal-more]');
  let sort = 'new';
  let sp = '';
  let limit = GALLERY_SHOW;
  const apply = () => {
    const items = [...grid.querySelectorAll('[data-gi]')];
    items.sort((a, b) => (sort === 'big' ? Number(b.dataset.len) - Number(a.dataset.len) || Number(b.dataset.w) - Number(a.dataset.w) : b.dataset.at.localeCompare(a.dataset.at)));
    items.forEach((el) => grid.appendChild(el));
    const match = items.filter((el) => !sp || el.dataset.spId === sp);
    items.forEach((el) => { el.hidden = true; });
    match.slice(0, limit).forEach((el) => { el.hidden = false; });
    more.hidden = match.length <= limit;
  };
  box.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
    sort = b.dataset.sort;
    box.querySelectorAll('[data-sort]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    apply();
  }));
  box.querySelectorAll('[data-sp]').forEach((b) => b.addEventListener('click', () => {
    sp = b.dataset.sp;
    limit = GALLERY_SHOW;
    box.querySelectorAll('[data-sp]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    apply();
  }));
  more.addEventListener('click', () => { limit += GALLERY_SHOW; apply(); });
  apply();
}

export async function anglerView(ctx, [id]) {
  const { backend, state } = ctx;
  const p = await backend.profile(id);
  if (!p) return { nav: 'lenteles', html: notFound('#/lenteles', 'Žvejys nerastas') };
  const isMe = id === state.user?.id;
  const moderating = can(state, 'ban') && !isMe;
  const [catches, entries, ban, follow, clubs] = await Promise.all([
    backend.userCatches(id), backend.userEntries(id).catch(() => []),
    moderating ? backend.userBan(id).catch(() => null) : null,
    backend.followStats && feat(state, 'social_follow') ? backend.followStats(id).catch(() => null) : null,
    backend.userClubs ? backend.userClubs(id).catch(() => []) : []
  ]);
  const hist = await tournamentHistory(backend, state, id, entries);
  const s = stats(catches, state.species);
  const medals = medalCounts(hist);

  return {
    nav: 'lenteles',
    title: p.nickname,
    html: html`<div class="screen">
      <header class="top-bar"><button class="icon-btn" data-back aria-label="Atgal">${icon('back', 22, 2.2)}</button><span></span><span></span></header>
      ${heroCard(p, ctx, { follow, clubs, medals, best: bestPlace(hist), isMe })}
      ${statGrid4(s, entries.length)}
      ${historySection(hist, id)}
      ${s.ok.length ? seasonChart(s) : ''}
      ${badges(s.ok, entries.length, true)}
      ${records(s, 3)}
      ${gallerySection(s, state, hist)}
      <p class="center small muted">${icon('lock', 14)} Laimikių vietos nerodomos</p>
      ${moderating ? modCard(p, ban) : ''}
    </div>`,
    mount(root) {
      hydratePhotos(root, backend);
      if (moderating) mountModCard(root, ctx, p);
      mountFollow(root, ctx, id);
      mountGallery(root);
      root.querySelector('[data-ap-write]')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const cid = await backend.startDirect(id);
          ctx.navigate(`#/zinutes/${cid}`);
        } catch (err) {
          btn.disabled = false;
          ctx.toast(err.message || 'Nepavyko pradėti pokalbio');
        }
      });
      root.querySelector('[data-hist-more]')?.addEventListener('click', (e) => {
        root.querySelectorAll('[data-hist-extra]').forEach((x) => { x.hidden = false; });
        e.currentTarget.remove();
      });
      root.querySelector('[data-rec-more]')?.addEventListener('click', (e) => {
        root.querySelectorAll('[data-rec-extra]').forEach((x) => { x.hidden = false; });
        e.currentTarget.remove();
      });
      root.querySelector('[data-badges-open]')?.addEventListener('click', (e) => {
        const grid = root.querySelector('#badge-grid');
        grid.hidden = !grid.hidden;
        e.currentTarget.setAttribute('aria-expanded', String(!grid.hidden));
      });
      root.querySelector('[data-back]').addEventListener('click', () => {
        if (history.length > 1) history.back();
        else ctx.navigate('#/lenteles');
      });
    }
  };
}
