import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { phase, timeLabel, describeFormat, cm, dateTime, duration, count } from '../lib/format.js';
import { fitReason, REASON_LT } from '../lib/scoring.js';
import { phaseBadge, statusChip, backButton, thumb, hydratePhotos, empty, avatar, loginPrompt } from '../ui.js';

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
  const myRow = board.find((r) => r.user_id === me);
  const myIdx = board.indexOf(myRow);
  const above = myIdx > 0 ? board[myIdx - 1] : null;
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
    ['Lentelė', 'Gyva']
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
        <div class="row gap-8">${phaseBadge(t)}${t.joined ? html`<span class="badge badge-mine">Dalyvauji</span>` : ''}</div>
        <h1 class="display-lg" tabindex="-1">${t.title}</h1>
        <p class="muted">${describeFormat(t)} · ${speciesNames}${t.min_length_mm ? ` · nuo ${cm(t.min_length_mm)}` : ''}</p>
        ${t.description ? html`<p>${t.description}</p>` : ''}
      </section>

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
            <span class="rank-huge accent">${myRow ? `#${myRow.rank}` : '–'}</span>
            <span class="muted">iš ${board.length || t.participants}</span>
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
          <a class="link" href="#/t/${t.id}/lentele">Visa lentelė${icon('chevron', 18)}</a>
        </div>
        ${board.length ? html`<div class="list">${board.slice(0, 3).map((r) => html`
          <a class="list-row" href="#/zvejys/${r.user_id}">
            <span class="rank r${r.rank}">${r.rank}</span>
            <span class="grow strong">${r.nickname}${r.user_id === me ? ' (tu)' : ''}</span>
            <span class="num-sm">${cm(r.score_mm)}</span>
          </a>`)}</div>` : html`<p class="muted">Patvirtintų laimikių dar nėra.</p>`}
      </section>

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
      root.querySelector('[data-share]')?.addEventListener('click', async () => {
        const url = location.href;
        try {
          if (navigator.share) await navigator.share({ title: t.title, url });
          else { await navigator.clipboard.writeText(url); ctx.toast('Nuoroda nukopijuota'); }
        } catch { /* atšaukta */ }
      });
      const timer = setInterval(() => {
        const el = root.querySelector('[data-countdown]');
        if (el) el.textContent = countdown(t).value;
      }, 30000);
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
