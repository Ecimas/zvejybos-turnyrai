import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { phase, timeLabel, describeFormat, cm, dateTime, duration, count } from '../lib/format.js';
import { fitReason, REASON_LT } from '../lib/scoring.js';
import { phaseBadge, statusChip, backButton, thumb, hydratePhotos, empty, avatar, loginPrompt } from '../ui.js';

export const inviteUrl = (t) => `${location.origin}${location.pathname}#/kvietimas/${t.invite_code}`;

// Ar šiam žiūrovui lentelė dabar paslėpta (serveris tokiu atveju grąžina tik jo eilutę be vietos).
export function boardHidden(t, state) {
  if (!t.leaderboard_hidden || phase(t) === 'done') return false;
  return t.organizer_id !== state.user?.id && !state.profile?.is_admin;
}

async function share(ctx, title, url) {
  try {
    if (navigator.share) await navigator.share({ title, url });
    else { await navigator.clipboard.writeText(url); ctx.toast('Nuoroda nukopijuota'); }
  } catch { /* atšaukta */ }
}

const MEDALS = ['🥇', '🥈', '🥉'];

function winners(board, me) {
  const top = board.filter((r) => r.rank !== null && r.rank <= 3).slice(0, 3);
  if (!top.length) return '';
  return html`<section class="card winners stack" aria-label="Nugalėtojai">
    <div class="row gap-8">${icon('trophy', 22)}<h2 class="h2">Nugalėtojai</h2></div>
    <ol class="plain stack-2">${top.map((r) => html`<li class="row gap-10">
      <span class="medal" aria-hidden="true">${MEDALS[r.rank - 1]}</span>
      <a class="grow strong" href="#/zvejys/${r.user_id}">${r.nickname}${r.user_id === me ? ' (tu)' : ''}</a>
      <span class="num-sm">${cm(r.score_mm)}</span>
    </li>`)}</ol>
  </section>`;
}

function prizesBlock(t) {
  if (!t.prizes && !t.sponsor_name) return '';
  return html`<section class="stack">
    <h2 class="h2">Prizai${t.sponsor_name ? ' ir rėmėjas' : ''}</h2>
    ${t.prizes ? html`<div class="card"><p class="prewrap">${t.prizes}</p></div>` : ''}
    ${t.sponsor_name ? html`<p class="small muted">Rėmėjas: ${t.sponsor_url
      ? html`<a class="link" href="${t.sponsor_url}" target="_blank" rel="noopener noreferrer sponsored">${t.sponsor_name}</a>`
      : html`<span class="strong">${t.sponsor_name}</span>`}</p>` : ''}
  </section>`;
}

function countdown(t) {
  const p = phase(t);
  const target = p === 'soon' ? t.starts_at : t.ends_at;
  const ms = new Date(target) - Date.now();
  if (p === 'done') return { label: 'Baigėsi', value: dateTime(t.ends_at) };
  return { label: p === 'soon' ? 'Iki starto' : 'Iki pabaigos', value: duration(ms) };
}

export async function tournamentView(ctx, [id]) {
  const { backend, state } = ctx;
  const t = await backend.tournament(id);
  if (!t) {
    return { nav: 'turnyrai', html: html`<div class="screen">${backButton('#/')}${empty('Turnyras nerastas', 'Gal jis privatus arba ištrintas.')}</div>` };
  }
  const me = state.user?.id;
  const [board, mineAll] = await Promise.all([
    backend.leaderboard(id).catch(() => []),
    me ? backend.myCatches().catch(() => []) : []
  ]);
  const p = phase(t);
  const speciesNames = t.species_ids.length
    ? t.species_ids.map((sid) => state.species.find((s) => s.id === sid)?.name_lt).filter(Boolean).join(', ')
    : 'Visos rūšys';
  const hidden = boardHidden(t, state);
  const organizer = !!me && t.organizer_id === me;
  const myRow = board.find((r) => r.user_id === me);
  const myIdx = board.indexOf(myRow);
  const above = !hidden && myIdx > 0 ? board[myIdx - 1] : null;
  const startMs = new Date(t.starts_at).getTime();
  const endMs = new Date(t.ends_at).getTime();
  const myCatches = mineAll
    .filter((c) => {
      const at = new Date(c.captured_at_device).getTime();
      return at >= startMs && at < endMs;
    })
    .slice(0, 8);
  const cd = countdown(t);

  const rules = [
    ['Formatas', describeFormat(t)],
    ['Rūšys', speciesNames],
    ['Įskaitoma', t.min_length_mm ? `nuo ${cm(t.min_length_mm)}` : 'bet koks ilgis'],
    ['Pradžia', dateTime(t.starts_at)],
    ['Pabaiga', dateTime(t.ends_at)],
    ['Įrodymas', 'Nuotrauka programėlės kamera'],
    ['Lentelė', t.leaderboard_hidden ? 'Paslėpta iki pabaigos' : 'Gyva'],
    ['Dalyvauti', t.visibility === 'private' ? 'Tik su kvietimu' : 'Visi']
  ];

  let cta = '';
  if (!me && p !== 'done') cta = html`<a class="btn btn-primary btn-lg" href="#/prisijungti">${icon('mail', 22)}Prisijungti ir dalyvauti</a>`;
  else if (me && !t.joined && p !== 'done') cta = html`<button class="btn btn-primary btn-lg" data-join>${icon('plus', 22, 2.6)}Dalyvauti</button>`;
  else if (me && t.joined && p === 'live') cta = html`<a class="btn btn-primary btn-lg" href="#/laimikis">${icon('plus', 22, 2.6)}Registruoti laimikį</a>`;

  return {
    nav: cta ? null : 'turnyrai',
    title: t.title,
    html: html`<div class="screen ${cta ? 'has-cta' : ''}">
      <header class="top-bar">
        ${backButton('#/')}
        <span class="muted strong">Turnyras</span>
        <button class="icon-btn" data-share aria-label="Dalintis turnyru">${icon('share', 20)}</button>
      </header>

      <section class="stack-2">
        <div class="row gap-8 wrap">${phaseBadge(t)}${t.joined ? html`<span class="badge badge-mine">Dalyvauji</span>` : ''}${t.visibility === 'private' ? html`<span class="badge">${icon('lock', 12, 2.6)}Privatus</span>` : ''}${organizer ? html`<span class="badge">Organizuoji</span>` : ''}</div>
        <h1 class="display-lg" tabindex="-1">${t.title}</h1>
        <p class="muted">${describeFormat(t)} · ${speciesNames}${t.min_length_mm ? ` · nuo ${cm(t.min_length_mm)}` : ''}</p>
        ${t.description ? html`<p>${t.description}</p>` : ''}
      </section>

      ${p === 'done' && !hidden ? winners(board, me) : ''}

      ${organizer || (t.visibility === 'private' && t.joined) ? html`<section class="row gap-10 wrap">
        ${t.invite_code && p !== 'done' ? html`<button class="btn" data-invite>${icon('users', 18)}Kviesti draugus</button>` : ''}
        ${organizer && p === 'soon' ? html`<a class="btn" href="#/t/${t.id}/redaguoti">${icon('edit', 18)}Redaguoti</a>` : ''}
      </section>` : ''}

      <section class="card row-between" aria-label="${cd.label}">
        <div class="stack-1">
          <span class="small muted strong">${cd.label}</span>
          <span class="display-md" data-countdown>${cd.value}</span>
        </div>
        <span class="small muted right">${count(t.participants, 'dalyvis', 'dalyviai', 'dalyvių')}</span>
      </section>

      ${t.joined && p !== 'soon' ? html`<section class="card hero stack">
        <div class="row-between">
          <div class="row gap-8 baseline">
            <span class="rank-huge accent">${myRow && myRow.rank !== null ? `#${myRow.rank}` : '–'}</span>
            <span class="muted">${hidden ? 'vieta paslėpta' : `iš ${board.length || t.participants}`}</span>
          </div>
          <div class="stack-1 right">
            <span class="small muted strong">Tavo rezultatas</span>
            <span class="display-md">${myRow ? cm(myRow.score_mm) : '0 cm'}</span>
          </div>
        </div>
        ${myRow && above ? html`<div class="stack-2">
          <div class="row-between small strong"><span>Iki #${above.rank} trūksta ${cm(above.score_mm - myRow.score_mm)}</span><span class="muted">${above.nickname}</span></div>
          <div class="progress"><div style="width:${Math.max(4, Math.round((myRow.score_mm / above.score_mm) * 100))}%"></div></div>
        </div>` : ''}
        ${!myRow ? html`<span class="small muted">Įskaityti bus tik moderatoriaus patvirtinti laimikiai.</span>` : ''}
        ${hidden ? html`<span class="small muted">${icon('lock', 14)} Organizatorius paslėpė lentelę iki pabaigos – vietas sužinosi ${dateTime(t.ends_at)}.</span>` : ''}
      </section>` : ''}

      ${t.joined && myCatches.length ? html`<section class="stack">
        <h2 class="h2">Tavo laimikiai</h2>
        ${myCatches.map((c) => {
          const reason = fitReason(t, t.species_ids, true, c);
          return html`<div class="card row tight">
            ${thumb(c.photo_path)}
            <div class="grow stack-1">
              <span class="num-md">${cm(c.length_mm)}</span>
              <span class="small muted">${state.species.find((s) => s.id === c.species_id)?.name_lt ?? ''} · ${dateTime(c.captured_at_device)}</span>
              ${reason !== 'ok' ? html`<span class="small warn">${REASON_LT[reason]}</span>` : ''}
            </div>
            ${statusChip(c.status)}
          </div>`;
        })}
      </section>` : ''}

      <section class="stack">
        <div class="row-between">
          <h2 class="h2">Lyderiai</h2>
          ${hidden ? '' : html`<a class="link" href="#/t/${t.id}/lentele">Visa lentelė${icon('chevron', 18)}</a>`}
        </div>
        ${hidden ? html`<p class="muted">${icon('lock', 14)} Lentelė paslėpta iki turnyro pabaigos.</p>`
        : board.length ? html`<div class="list">${board.slice(0, 3).map((r) => html`
          <a class="list-row" href="#/zvejys/${r.user_id}">
            <span class="rank r${r.rank}">${r.rank}</span>
            <span class="grow strong">${r.nickname}${r.user_id === me ? ' (tu)' : ''}</span>
            <span class="num-sm">${cm(r.score_mm)}</span>
          </a>`)}</div>` : html`<p class="muted">Patvirtintų laimikių dar nėra.</p>`}
        ${!hidden && t.leaderboard_hidden && p !== 'done' ? html`<p class="small muted">Dalyviams lentelė paslėpta iki pabaigos – tu ją matai kaip ${organizer ? 'organizatorius' : 'moderatorius'}.</p>` : ''}
        ${!hidden && board.length ? html`<a class="btn btn-ghost" href="#/t/${t.id}/tv">${icon('bars', 18)}Rodyti dideliame ekrane</a>` : ''}
      </section>

      ${prizesBlock(t)}

      <section class="stack">
        <h2 class="h2">Taisyklės</h2>
        <dl class="list">${rules.map(([k, v]) => html`<div class="list-row"><dt class="muted">${k}</dt><dd class="strong right">${v}</dd></div>`)}</dl>
        ${t.joined && p === 'soon' && me ? html`<button class="btn btn-ghost" data-leave>Atšaukti registraciją</button>` : ''}
      </section>

      ${!me && p !== 'done' ? loginPrompt() : ''}
    </div>
    ${cta ? html`<div class="cta-bar">${cta}</div>` : ''}`,
    mount(root) {
      hydratePhotos(root, backend);
      root.querySelector('[data-join]')?.addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        try {
          await backend.join(t.id);
          ctx.toast('Užsiregistravai į turnyrą');
          ctx.rerender();
        } catch (err) {
          e.currentTarget.disabled = false;
          ctx.toast('Nepavyko užsiregistruoti');
        }
      });
      root.querySelector('[data-leave]')?.addEventListener('click', async () => {
        await backend.leave(t.id).catch(() => ctx.toast('Nepavyko'));
        ctx.rerender();
      });
      root.querySelector('[data-share]')?.addEventListener('click', () => {
        share(ctx, t.title, t.visibility === 'private' && t.invite_code ? inviteUrl(t) : location.href);
      });
      root.querySelector('[data-invite]')?.addEventListener('click', () => share(ctx, `Kvietimas: ${t.title}`, inviteUrl(t)));
      const timer = setInterval(() => {
        const el = root.querySelector('[data-countdown]');
        if (el) el.textContent = countdown(t).value;
      }, 30000);
      return () => clearInterval(timer);
    }
  };
}

// Didelis ekranas (televizorius, projektorius renginyje): tik lentelė, atsinaujina kas 30 s.
export async function tvView(ctx, [id]) {
  const { backend, state } = ctx;
  const [t, board] = await Promise.all([backend.tournament(id), backend.leaderboard(id)]);
  if (!t) return { nav: null, html: html`<div class="screen">${backButton('#/')}${empty('Turnyras nerastas')}</div>` };
  const hidden = boardHidden(t, state);
  const p = phase(t);
  return {
    nav: null,
    dark: true,
    title: `Ekranas · ${t.title}`,
    html: html`<div class="tv">
      <header class="tv-head">
        <div class="stack-1"><h1 class="tv-title" tabindex="-1">${t.title}</h1>
          <span class="muted">${describeFormat(t)} · ${p === 'done' ? 'baigėsi' : timeLabel(t).toLowerCase()}</span></div>
        <a class="icon-btn" href="#/t/${t.id}" aria-label="Uždaryti ekrano režimą">${icon('x', 22, 2.2)}</a>
      </header>
      ${hidden ? html`<p class="tv-empty">${icon('lock', 40)} Lentelė paslėpta iki pabaigos</p>`
      : board.length ? html`<ol class="tv-list plain">${board.slice(0, 10).map((r) => html`<li class="tv-row r${r.rank}">
          <span class="tv-rank">${r.rank}</span><span class="tv-name ellipsis">${r.nickname}</span>
          <span class="tv-meta">${count(Number(r.counted), 'žuvis', 'žuvys', 'žuvų')}</span><span class="tv-score">${cm(r.score_mm)}</span>
        </li>`)}</ol>`
        : html`<p class="tv-empty">Patvirtintų laimikių dar nėra</p>`}
      <footer class="tv-foot muted small">Žvejybos turnyrai · atnaujinama automatiškai</footer>
    </div>`,
    mount() {
      if (p === 'done') return null;
      const timer = setInterval(() => ctx.rerender(), 30000);
      return () => clearInterval(timer);
    }
  };
}

export async function boardView(ctx, [id]) {
  const { backend, state } = ctx;
  const me = state.user?.id;
  const [t, board] = await Promise.all([backend.tournament(id), backend.leaderboard(id)]);
  if (!t) return { nav: 'lenteles', html: html`<div class="screen">${backButton('#/lenteles')}${empty('Turnyras nerastas')}</div>` };
  const p = phase(t);
  if (boardHidden(t, state)) {
    const mine = board.find((r) => r.user_id === me);
    return {
      nav: 'lenteles',
      title: `Lentelė · ${t.title}`,
      html: html`<div class="screen">
        <header class="top-bar">${backButton(`#/t/${t.id}`, 'Atgal į turnyrą')}
          <div class="grow stack-1 pad-x"><h1 class="display-md" tabindex="-1">Lentelė</h1><span class="small muted ellipsis">${t.title}</span></div>${phaseBadge(t)}</header>
        <div class="card hero stack center">
          <span class="empty-icon">${icon('lock', 30)}</span>
          <p class="empty-title">Paslėpta iki pabaigos</p>
          <p class="muted">Organizatorius nori intrigos: vietos paaiškės ${dateTime(t.ends_at)}.</p>
          <p class="display-md">${mine ? `Tavo rezultatas: ${cm(mine.score_mm)}` : 'Tavo įskaitytų laimikių dar nėra'}</p>
        </div>
      </div>`
    };
  }
  const podium = [board[1], board[0], board[2]].filter(Boolean);
  const rest = board.slice(3);
  const myIdx = board.findIndex((r) => r.user_id === me);
  const mine = board[myIdx];
  const above = myIdx > 0 ? board[myIdx - 1] : null;

  const row = (r) => html`<li>
    <a class="list-row board-row ${r.user_id === me ? 'mine' : ''}" href="#/zvejys/${r.user_id}">
      <span class="rank">${r.rank}</span>
      ${avatar(r.nickname)}
      <span class="grow stack-1">
        <span class="strong ellipsis">${r.user_id === me ? 'Tu' : r.nickname}</span>
        <span class="small muted">${count(Number(r.counted), 'žuvis', 'žuvys', 'žuvų')}${r.region ? ` · ${r.region}` : ''}</span>
      </span>
      <span class="num-md">${cm(r.score_mm)}</span>
    </a>
  </li>`;

  return {
    nav: 'lenteles',
    title: `Lentelė · ${t.title}`,
    html: html`<div class="screen ${mine ? 'has-sticky' : ''}">
      <header class="top-bar">
        ${backButton(`#/t/${t.id}`, 'Atgal į turnyrą')}
        <div class="grow stack-1 pad-x">
          <h1 class="display-md" tabindex="-1">Lentelė</h1>
          <span class="small muted ellipsis">${t.title} · ${describeFormat(t)}</span>
        </div>
        ${phaseBadge(t)}
      </header>

      ${board.length ? html`
        <div class="podium">${podium.map((r) => html`
          <a class="podium-col p${r.rank}" href="#/zvejys/${r.user_id}">
            ${avatar(r.nickname, `ring-${r.rank}`)}
            <span class="small strong ellipsis">${r.user_id === me ? 'Tu' : r.nickname}</span>
            <span class="num-md">${cm(r.score_mm)}</span>
            <span class="rank r${r.rank}">${r.rank}</span>
          </a>`)}</div>
        ${rest.length ? html`<ol class="stack-6 plain">${rest.map(row)}</ol>` : ''}
        <p class="center small muted">${count(board.length, 'dalyvis', 'dalyviai', 'dalyvių')} su įskaitytais laimikiais · vietos nerodomos</p>
      ` : empty('Lentelė dar tuščia', p === 'soon' ? `Turnyras prasidės ${dateTime(t.starts_at)}.` : 'Kai moderatorius patvirtins pirmus laimikius, jie atsiras čia.')}
    </div>
    ${mine ? html`<div class="my-sticky">
      <span class="rank-big accent">#${mine.rank}</span>
      <span class="grow stack-1">
        <span class="strong">Tu · ${cm(mine.score_mm)}</span>
        <span class="small">${above ? `Iki #${above.rank} trūksta ${cm(above.score_mm - mine.score_mm)}` : 'Tu pirmauji'}${p === 'live' ? ` · ${timeLabel(t).toLowerCase()}` : ''}</span>
      </span>
      ${p === 'live' && t.joined ? html`<a class="icon-btn icon-btn-accent" href="#/laimikis" aria-label="Registruoti laimikį">${icon('plus', 22, 2.6)}</a>` : ''}
    </div>` : ''}`,
    mount() {
      if (p !== 'live') return null;
      const timer = setInterval(() => ctx.rerender(), 30000);
      return () => clearInterval(timer);
    }
  };
}
