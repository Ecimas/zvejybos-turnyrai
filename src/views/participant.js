// Dalyvis turnyre (#/t/:id/dalyvis/:userId): vieta, rezultatas, statistika ir to turnyro laimikiai.
// Atidaroma paspaudus žvejį turnyro lentelėje; iš čia – į bendrą žvejo profilį.
import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { cm, dateTime, count, gapText, scoreText, isPoints, describeFormat, phase } from '../lib/format.js';
import { fitReason, catchPoints, catchTime } from '../lib/scoring.js';
import { backButton, thumb, hydratePhotos, avatar, notFound, statusChip, phaseBadge } from '../ui.js';
import { eur, payouts } from '../lib/prizes.js';
import { boardHidden } from './tournament.js';

// Kurie laimikiai sudaro rezultatą (ne savų taisyklių formatams): geriausi pagal taškus, lygūs – ankstesnis.
export function countedIds(t, approved) {
  if (t.format === 'custom') return null;
  const limit = t.format === 'biggest' ? 1 : t.top_n || 1;
  const pts = (c) => catchPoints(t, c, t.species_pct || {});
  return new Set([...approved].sort((a, b) => pts(b) - pts(a) || catchTime(a) - catchTime(b)).slice(0, limit).map((c) => c.id));
}

// Turnyro laimikiai: įskaitomi pagal taisykles; kitiems – tik patvirtinti, sau – ir laukiantys.
export function tournamentCatches(t, joinedAt, catches, own) {
  return catches
    .filter((c) => (own ? c.status !== 'rejected' : c.status === 'approved'))
    .filter((c) => fitReason(t, t.species_ids || [], joinedAt || true, c) === 'ok')
    .sort((a, b) => catchTime(b) - catchTime(a));
}

export async function participantView(ctx, [tid, uid]) {
  const { backend, state } = ctx;
  const me = state.user?.id;
  const own = uid === me;
  const [t, board, prof, entries, catches] = await Promise.all([
    backend.tournament(tid),
    backend.leaderboard(tid).catch(() => []),
    backend.profile(uid).catch(() => null),
    backend.userEntries(uid).catch(() => []),
    backend.userCatches(uid).catch(() => [])
  ]);
  if (!t) return { nav: 'lenteles', html: notFound('#/lenteles', 'Turnyras nerastas') };
  if (!prof) return { nav: 'lenteles', html: notFound(`#/t/${tid}/lentele`, 'Žvejys nerastas') };

  const back = backButton(`#/t/${tid}/lentele`, 'Atgal į lentelę');
  const name = own ? `${prof.nickname} (tu)` : prof.nickname;
  const profileBtn = html`<a class="btn btn-ghost" href="#/zvejys/${uid}" data-to-profile>${icon('user', 18)}Žvejo profilis</a>`;
  const header = html`<header class="top-bar">${back}
    <div class="grow stack-1 pad-x min0"><span class="small muted">Turnyro dalyvis</span>
      <span class="strong ellipsis">${t.title}</span></div>${phaseBadge(t)}</header>`;
  const title = html`<h1 class="display-md ellipsis" tabindex="-1">${name}</h1>`;
  const entry = entries.find((e) => e.tournament_id === tid);

  if (!entry) {
    return {
      nav: 'lenteles',
      title: `${prof.nickname} · ${t.title}`,
      html: html`<div class="screen">${header}${title}
        <div class="card stack center" data-pt-none><p class="empty-title">Šiame turnyre nedalyvauja</p>
          <p class="muted">${prof.nickname} į „${t.title}“ neužsiregistravo arba buvo pašalintas.</p></div>
        ${profileBtn}</div>`
    };
  }

  if (boardHidden(t, state) && !own) {
    return {
      nav: 'lenteles',
      title: `${prof.nickname} · ${t.title}`,
      html: html`<div class="screen">${header}${title}
        <div class="card hero stack center" data-pt-hidden>
          <span class="empty-icon">${icon('lock', 30)}</span>
          <p class="empty-title">Rezultatai paslėpti iki pabaigos</p>
          <p class="muted">Organizatorius paslėpė lentelę – dalyvių laimikius ir vietas pamatysi ${dateTime(t.ends_at)}.</p>
        </div>
        ${profileBtn}</div>`
    };
  }

  const list = tournamentCatches(t, entry.joined_at, catches, own);
  const approved = list.filter((c) => c.status === 'approved');
  const counted = countedIds(t, approved);
  const idx = board.findIndex((r) => r.user_id === uid);
  const row = board[idx] || null;
  const above = idx > 0 ? board[idx - 1] : null;
  const pay = payouts(board, t.prize_fund_cents || 0, t.prize_split);
  const prize = pay.get(uid) || 0;
  const biggest = approved.reduce((b, c) => (!b || c.length_mm > b.length_mm ? c : b), null);
  const species = new Set(approved.map((c) => c.species_id));
  const spName = (id) => state.species.find((s) => s.id === id)?.name_lt ?? '';
  const pts = isPoints(t);
  const limit = t.format === 'custom' ? null : t.format === 'biggest' ? 1 : t.top_n || 1;
  const p = phase(t);
  const ring = row && row.rank <= 3 ? `ring-${row.rank}` : '';
  const gap = row && above ? gapText(above, row, t) : row && row.rank === 1 ? (p === 'done' ? 'Turnyro nugalėtojas' : 'Pirmauja') : null;

  const stat = (value, label, key) => html`<div class="stat-box center" data-pt-stat="${key}"><span class="stat-value">${value}</span><span class="stat-label">${label}</span></div>`;

  return {
    nav: 'lenteles',
    title: `${prof.nickname} · ${t.title}`,
    html: html`<div class="screen">
      ${header}

      <section class="card pt-hero ${prize ? 'pt-prize' : ''}" data-pt-hero aria-label="Vieta ir rezultatas">
        <div class="row gap-12">
          ${avatar(prof.nickname, `avatar-lg ${ring}`)}
          <span class="grow stack-1 min0">
            ${title}
            <span class="small muted ellipsis">${prof.region || 'Regionas nenurodytas'}</span>
          </span>
          ${row ? html`<span class="pt-rank" data-pt-rank><span class="small muted">vieta</span><b>#${row.rank}</b></span>` : ''}
        </div>
        ${row ? html`<div class="pt-score">
          <span class="num-lg" data-pt-score>${scoreText(t, row.score_mm)}</span>
          <span class="small muted">iš ${count(board.length, 'dalyvio', 'dalyvių', 'dalyvių')} · ${describeFormat(t)}</span>
        </div>
        ${prize ? html`<p class="pt-prize-tag" data-pt-prize>${icon('trophy', 16)}<span>Prizinė vieta · ${eur(prize)}</span>${p === 'done' ? '' : html`<span class="small muted">jei baigtųsi dabar</span>`}</p>` : ''}
        ${gap ? html`<p class="small" data-pt-gap>${gap}</p>` : ''}`
        : html`<p class="muted" data-pt-norank>Įskaitytų laimikių dar nėra – lentelėje nerodomas.</p>`}
        ${profileBtn}
      </section>

      <div class="grid-2" data-pt-stats>
        ${stat(limit ? `${row ? row.counted : 0}/${limit}` : String(row ? row.counted : 0), limit ? 'Įskaityta į rezultatą' : 'Įskaitytos žuvys', 'counted')}
        ${stat(String(approved.length), 'Patvirtinti laimikiai', 'total')}
        ${stat(biggest ? cm(biggest.length_mm) : '–', biggest ? `Didžiausia · ${spName(biggest.species_id)}` : 'Didžiausia', 'biggest')}
        ${stat(String(species.size), count(species.size, 'rūšis', 'rūšys', 'rūšių').replace(/^\d+\s/, ''), 'species')}
      </div>

      <section class="stack-2" aria-labelledby="pt-list-h">
        <h2 class="h2" id="pt-list-h">Laimikiai šiame turnyre</h2>
        ${list.length ? html`<ol class="plain stack-2" data-pt-catches>${list.map((c) => {
          const inScore = counted ? counted.has(c.id) : c.status === 'approved';
          return html`<li><a class="card card-link row tight ${inScore && counted ? 'pt-in' : ''}" href="#/l/${c.id}" data-pt-catch="${c.id}">
            ${thumb(c.photo_path)}
            <span class="grow stack-1 min0">
              <span class="num-md">${cm(c.length_mm)}${pts && c.status === 'approved' ? html` <span class="small muted">· ${scoreText(t, catchPoints(t, c, t.species_pct || {}))}</span>` : ''}</span>
              <span class="small muted ellipsis">${spName(c.species_id)} · ${dateTime(c.captured_at_device)}</span>
            </span>
            ${c.status !== 'approved' ? statusChip(c.status)
              : counted ? (inScore ? html`<span class="chip chip-ok" data-pt-in>${icon('check', 14, 2.8)}Rezultate</span>` : html`<span class="small muted right">Ne TOP-${limit}</span>`) : ''}
          </a></li>`;
        })}</ol>`
        : html`<p class="muted" data-pt-empty>${own ? 'Šiame turnyre laimikių dar neįkėlei.' : 'Patvirtintų laimikių šiame turnyre dar nėra.'}</p>`}
      </section>

      <p class="small muted center">${icon('lock', 14)} Laimikių vietos nerodomos</p>
    </div>`,
    mount(root) {
      hydratePhotos(root, backend);
    }
  };
}
