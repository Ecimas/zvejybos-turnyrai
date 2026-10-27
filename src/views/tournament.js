import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { phase, timeLabel, describeFormat, cm, dateTime, duration, count, gapText, registrationOpen, registrationLabel } from '../lib/format.js';
import { fitReason, REASON_LT } from '../lib/scoring.js';
import { phaseBadge, statusChip, backButton, thumb, hydratePhotos, empty, avatar, loginPrompt, notFound } from '../ui.js';
import { eur, placeAmounts, payouts } from '../lib/prizes.js';
import { lastSeen, markSeen } from '../lib/seen.js';

// Organizatoriaus pranešimai dalyviams: rašo organizatorius, mato visi, kas mato turnyrą.
function announcementsBlock(t, list, organizer, seenBefore) {
  if (!list.length && !organizer) return '';
  const canPost = organizer && Date.now() < new Date(t.ends_at).getTime() + 7 * 24 * 3600e3;
  return html`<section class="stack" aria-label="Organizatoriaus pranešimai">
    <h2 class="h2">Pranešimai dalyviams</h2>
    ${canPost ? html`<form class="card stack-2" data-ann-form>
      <label class="field"><span class="small muted strong">Naujas pranešimas visiems dalyviams</span>
        <textarea name="message" rows="2" maxlength="500" placeholder="pvz. Rytoj startas 6 val., nepamirškite liniuotės"></textarea></label>
      <button class="btn btn-primary" type="submit">${icon('share', 18)}Siųsti dalyviams</button>
    </form>` : ''}
    ${list.length ? html`<div class="stack-2">${list.map((a) => html`<div class="card ann ${a.created_at > seenBefore && !organizer ? 'ann-new' : ''}" data-ann="${a.id}">
      <div class="row-between"><span class="small muted strong">${dateTime(a.created_at)}${a.created_at > seenBefore && !organizer ? html` · <span class="accent">Nauja</span>` : ''}</span>
        ${organizer ? html`<button class="btn-text" data-ann-delete="${a.id}" aria-label="Ištrinti pranešimą">${icon('x', 16, 2.4)}</button>` : ''}</div>
      <p class="prewrap">${a.message}</p>
    </div>`)}</div>` : html`<p class="small muted">Pranešimų dar nėra. Juos matys visi dalyviai turnyro puslapyje ir pradžios ekrane.</p>`}
  </section>`;
}

const prizeMap = (t, board) => payouts(board, t.prize_fund_cents || 0, t.prize_split);

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

function winners(t, board, me) {
  const pay = prizeMap(t, board);
  const places = Math.max(3, (t.prize_split || []).length);
  const top = board.filter((r) => r.rank !== null && (r.rank <= 3 || pay.has(r.user_id))).slice(0, places);
  if (!top.length) return '';
  return html`<section class="card winners stack" aria-label="Nugalėtojai">
    <div class="row gap-8">${icon('trophy', 22)}<h2 class="h2">Nugalėtojai</h2></div>
    <ol class="plain stack-2">${top.map((r) => html`<li class="row gap-10">
      <span class="medal" aria-hidden="true">${MEDALS[r.rank - 1] || r.rank}</span>
      <a class="grow strong" href="#/zvejys/${r.user_id}">${r.nickname}${r.user_id === me ? ' (tu)' : ''}</a>
      <span class="stack-1 right"><span class="num-sm">${cm(r.score_mm)}</span>
        ${pay.get(r.user_id) ? html`<span class="prize-amt">${eur(pay.get(r.user_id))}</span>` : ''}</span>
    </li>`)}</ol>
    ${pay.size ? html`<p class="small muted">Prizus išmoka organizatorius arba rėmėjai.</p>` : ''}
  </section>`;
}

const SAFE_URL = /^https:\/\/[^\s<>"']{3,200}$/;

// Rėmėjo nuoroda rodoma tik su https:// (serveris tai tikrina, bet tikrinam ir čia – jokių javascript: nuorodų).
function sponsorName(s) {
  return SAFE_URL.test(s.url || '')
    ? html`<a class="link strong" href="${s.url}" target="_blank" rel="noopener noreferrer sponsored">${s.name}</a>`
    : html`<span class="strong">${s.name}</span>`;
}

function prizesBlock(t) {
  const fund = t.prize_fund_cents || 0;
  const sponsors = t.sponsors || [];
  if (!fund && !t.prizes && !sponsors.length) return '';
  const amounts = placeAmounts(fund, t.prize_split);
  return html`<section class="stack" aria-label="Prizai ir rėmėjai">
    <h2 class="h2">Prizai</h2>
    ${fund ? html`<div class="card stack prize-card">
      <div class="row-between baseline"><span class="small muted strong">Prizinis fondas</span><span class="display-md accent" data-fund>${eur(fund)}</span></div>
      <dl class="list">${amounts.map((a, i) => html`<div class="list-row">
        <dt class="grow strong"><span class="medal-sm" aria-hidden="true">${MEDALS[i] || ''}</span>${i + 1} vieta</dt>
        <dd class="muted">${t.prize_split[i]} %</dd>
        <dd class="num-sm right prize-col">${eur(a)}</dd>
      </div>`)}</dl>
    </div>` : ''}
    ${t.prizes ? html`<div class="card"><p class="prewrap">${t.prizes}</p></div>` : ''}
    ${sponsors.length ? html`<div class="stack-2">
      <span class="small muted strong">Rėmėjai</span>
      <div class="list sponsor-list">${sponsors.map((s) => html`<div class="list-row">
        ${icon('star', 18)}<span class="grow">${sponsorName(s)}</span>
        ${s.amount_cents ? html`<span class="num-sm">${eur(s.amount_cents)}</span>` : ''}
      </div>`)}</div>
    </div>` : ''}
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
    return { nav: 'turnyrai', html: notFound('#/', 'Turnyras nerastas', 'Gal jis privatus arba ištrintas.') };
  }
  const me = state.user?.id;
  const [board, mineAll, anns] = await Promise.all([
    backend.leaderboard(id).catch(() => []),
    me ? backend.myCatches().catch(() => []) : [],
    backend.announcements(id).catch(() => [])
  ]);
  const seenBefore = lastSeen(id);
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
    ['Registracija', registrationLabel(t)],
    ['Įrodymas', 'Nuotrauka programėlės kamera'],
    ['Lentelė', t.leaderboard_hidden ? 'Paslėpta iki pabaigos' : 'Gyva'],
    ['Dalyvauti', t.visibility === 'private' ? 'Tik su kvietimu' : 'Visi']
  ];

  let cta = '';
  const regOpen = registrationOpen(t);
  if (!t.joined && p !== 'done' && !regOpen && !organizer) cta = html`<p class="reg-closed strong" role="status">${icon('lock', 18, 2.6)}Registracija baigėsi</p>`;
  else if (!me && p !== 'done') cta = html`<a class="btn btn-primary btn-lg" href="#/prisijungti">${icon('mail', 22)}Prisijungti ir dalyvauti</a>`;
  else if (me && !t.joined && p !== 'done') cta = html`<button class="btn btn-primary btn-lg" data-join>${icon('plus', 22, 2.6)}Dalyvauti</button>`;
  // Dalyvaujant laimikis registruojamas apatinio meniu „+“ mygtuku – atskiro mygtuko nebereikia.

  return {
    nav: 'turnyrai',
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

      ${p === 'done' && !hidden ? winners(t, board, me) : ''}

      ${organizer || (t.visibility === 'private' && t.joined) ? html`<section class="row gap-10 wrap">
        ${t.invite_code && p !== 'done' ? html`<button class="btn" data-invite>${icon('users', 18)}Kviesti draugus</button>` : ''}
        ${organizer && p === 'soon' ? html`<a class="btn" href="#/t/${t.id}/redaguoti">${icon('edit', 18)}Redaguoti</a>` : ''}
      </section>` : ''}

      ${announcementsBlock(t, anns, organizer, seenBefore)}

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
          <div class="row-between small strong"><span>${gapText(above, myRow)}</span><span class="muted">${above.nickname}</span></div>
          <div class="progress"><div style="width:${Math.max(4, Math.round((myRow.score_mm / above.score_mm) * 100))}%"></div></div>
        </div>` : ''}
        ${!myRow ? html`<span class="small muted">Įskaityti bus tik moderatoriaus patvirtinti laimikiai.</span>` : ''}
        ${hidden ? html`<span class="small muted">${icon('lock', 14)} Organizatorius paslėpė lentelę iki pabaigos – vietas sužinosi ${dateTime(t.ends_at)}.</span>` : ''}
      </section>` : ''}

      ${t.joined && myCatches.length ? html`<section class="stack">
        <h2 class="h2">Tavo laimikiai</h2>
        ${myCatches.map((c) => {
          const reason = fitReason(t, t.species_ids, true, c);
          return html`<a class="card card-link row tight" href="#/l/${c.id}">
            ${thumb(c.photo_path)}
            <div class="grow stack-1">
              <span class="num-md">${cm(c.length_mm)}</span>
              <span class="small muted">${state.species.find((s) => s.id === c.species_id)?.name_lt ?? ''} · ${dateTime(c.captured_at_device)}</span>
              ${reason !== 'ok' ? html`<span class="small warn">${REASON_LT[reason]}</span>` : ''}
            </div>
            ${statusChip(c.status)}
          </a>`;
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
          ctx.toast(registrationOpen(t) ? 'Nepavyko užsiregistruoti' : 'Registracija jau baigėsi');
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
      if (anns.length) markSeen(t.id, anns[0].created_at);
      const annForm = root.querySelector('[data-ann-form]');
      annForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = annForm.message.value.trim();
        if (msg.length < 2) { ctx.toast('Parašyk pranešimą'); return; }
        const btn = annForm.querySelector('[type=submit]');
        btn.disabled = true;
        try {
          await backend.postAnnouncement(t.id, msg);
          ctx.toast('Pranešimas išsiųstas dalyviams');
          ctx.rerender();
        } catch (err) {
          btn.disabled = false;
          ctx.toast(err.message || 'Nepavyko išsiųsti');
        }
      });
      root.querySelectorAll('[data-ann-delete]').forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('Ištrinti pranešimą?')) return;
        await backend.deleteAnnouncement(b.dataset.annDelete).catch(() => ctx.toast('Nepavyko ištrinti'));
        ctx.rerender();
      }));
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
  if (!t) return { nav: 'turnyrai', html: notFound('#/', 'Turnyras nerastas') };
  const hidden = boardHidden(t, state);
  const p = phase(t);
  return {
    nav: null,
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
  if (!t) return { nav: 'lenteles', html: notFound('#/lenteles', 'Turnyras nerastas') };
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
  const pay = prizeMap(t, board);
  const prizeTag = (r) => (pay.get(r.user_id) ? html`<span class="prize-amt">${eur(pay.get(r.user_id))}</span>` : '');

  const row = (r) => html`<li>
    <a class="list-row board-row ${r.user_id === me ? 'mine' : ''}" href="#/zvejys/${r.user_id}">
      <span class="rank">${r.rank}</span>
      ${avatar(r.nickname)}
      <span class="grow stack-1">
        <span class="strong ellipsis">${r.user_id === me ? 'Tu' : r.nickname}</span>
        <span class="small muted">${count(Number(r.counted), 'žuvis', 'žuvys', 'žuvų')}${r.region ? ` · ${r.region}` : ''}</span>
      </span>
      <span class="stack-1 right"><span class="num-md">${cm(r.score_mm)}</span>${prizeTag(r)}</span>
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
            ${prizeTag(r)}
            <span class="rank r${r.rank}">${r.rank}</span>
          </a>`)}</div>
        ${rest.length ? html`<ol class="stack-6 plain">${rest.map(row)}</ol>` : ''}
        <p class="center small muted">${count(board.length, 'dalyvis', 'dalyviai', 'dalyvių')} su įskaitytais laimikiais · vietos nerodomos${pay.size && p !== 'done' ? ' · sumos – jei turnyras baigtųsi dabar' : ''}</p>
      ` : empty('Lentelė dar tuščia', p === 'soon' ? `Turnyras prasidės ${dateTime(t.starts_at)}.` : 'Kai moderatorius patvirtins pirmus laimikius, jie atsiras čia.')}
    </div>
    ${mine ? html`<div class="my-sticky">
      <span class="rank-big accent">#${mine.rank}</span>
      <span class="grow stack-1">
        <span class="strong">Tu · ${cm(mine.score_mm)}</span>
        <span class="small">${above ? gapText(above, mine) : 'Tu pirmauji'}${p === 'live' ? ` · ${timeLabel(t).toLowerCase()}` : ''}</span>
      </span>
    </div>` : ''}`,
    mount() {
      if (p !== 'live') return null;
      const timer = setInterval(() => ctx.rerender(), 30000);
      return () => clearInterval(timer);
    }
  };
}
