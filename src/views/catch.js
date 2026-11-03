// Laimikio peržiūra: didelė nuotrauka (paspaudus – per visą ekraną), duomenys ir turnyrai.
// Kiti mato tik patvirtintus laimikius; masalą, pastabas ir vietą – tik savininkas (ir vietą – moderatorius).
import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { cm, dateTime, phase, size } from '../lib/format.js';
import { fitReason, REASON_LT } from '../lib/scoring.js';
import { weatherLine } from '../lib/weather.js';
import { statusChip, avatar, notFound, hydratePhotos, openPhoto } from '../ui.js';
import { checkRequestBox, mountCheckRequest } from './check.js';
import { can } from '../lib/roles.js';
import { feat, REACTIONS } from '../lib/clubs.js';
import { commentsHtml, bindComments } from './clubs.js';
import { makeShareCard, shareImage } from '../lib/share.js';
import { daypartOf, daypartLabel } from '../lib/map.js';
import { WEATHER_LT } from '../lib/weather.js';
import { shortDate } from '../lib/format.js';

export const REPORT_REASONS = [
  ['old_photo', 'Sena ar svetima nuotrauka'],
  ['wrong_length', 'Netikslus ilgis'],
  ['wrong_species', 'Ne ta rūšis'],
  ['not_own', 'Ne jo pagauta žuvis'],
  ['other', 'Kita']
];

export const kg = (g) => `${String(Math.round(g / 10) / 100).replace('.', ',')} kg`;

export async function catchView(ctx, [id]) {
  const { backend, state } = ctx;
  const c = await backend.catchDetail(id);
  if (!c) return { nav: 'turnyrai', title: 'Laimikis', html: notFound('#/', 'Laimikis nerastas', 'Gal jis dar nepatvirtintas arba ištrintas.') };
  const me = state.user?.id;
  const own = !!me && c.user_id === me;
  const sp = state.species.find((s) => s.id === c.species_id)?.name_lt ?? '';
  const canReport = !!me && !own && c.status === 'approved' && !state.ban;
  const canCheck = !own && can(state, 'review') && ['pending', 'approved'].includes(c.status);
  const socialOn = c.status === 'approved' && !!me && (feat(state, 'club_reactions') || feat(state, 'club_comments')) && !!backend.catchSocial;
  const [tournaments, entered, myReport, activeCheck, myClubs, theirClubs] = await Promise.all([
    backend.tournaments().catch(() => []),
    backend.userEntries(c.user_id).catch(() => []),
    canReport ? backend.myReport(c.id).catch(() => null) : null,
    canCheck && backend.catchCheck ? backend.catchCheck(c.id).catch(() => null) : null,
    socialOn && !own ? backend.myClubs().catch(() => []) : [],
    socialOn && !own ? backend.userClubs(c.user_id).catch(() => []) : []
  ]);
  // Reakcijos ir komentarai – tik klubo draugams (ir pačiam savininkui).
  const friends = socialOn && (own || myClubs.some((x) => theirClubs.some((y) => y.id === x.id)));
  const [social, comments] = friends ? await Promise.all([
    backend.catchSocial([c.id]).then((x) => x[c.id]).catch(() => null),
    feat(state, 'club_comments') ? backend.catchComments(c.id).catch(() => []) : []
  ]) : [null, []];
  const at = new Date(c.captured_at_device).getTime();
  const joinedAt = new Map(entered.map((e) => [e.tournament_id, e.joined_at]));
  const relevant = tournaments
    .filter((t) => joinedAt.has(t.id) && at >= new Date(t.starts_at).getTime() && at < new Date(t.ends_at).getTime())
    .map((t) => ({ t, reason: fitReason(t, t.species_ids, joinedAt.get(t.id) || true, c) }));

  // Vieta turnyruose (patvirtintam ir įskaitomam) ir palyginimas su savo tos rūšies žuvimis.
  const okRows = c.status === 'approved' ? relevant.filter((x) => x.reason === 'ok') : [];
  const [boards, mine] = await Promise.all([
    Promise.all(okRows.map(({ t }) => (t.leaderboard_hidden && !own ? null : backend.leaderboard(t.id).catch(() => null)))),
    own ? backend.myCatches().catch(() => []) : []
  ]);
  const rankIn = new Map(okRows.map(({ t }, i) => [t.id, boards[i]?.find((r) => r.user_id === c.user_id)?.rank ?? null]));
  // Palyginimas su savo tos rūšies laimikiais – tik pagal ilgį (tik pasverti neįeina).
  const same = c.length_mm ? mine.filter((x) => x.species_id === c.species_id && x.status !== 'rejected' && x.length_mm) : [];
  const sorted = same.slice().sort((a, b) => b.length_mm - a.length_mm);
  const pos = sorted.findIndex((x) => x.id === c.id) + 1;
  const prevBest = same.filter((x) => x.id !== c.id && new Date(x.captured_at_device) < new Date(c.captured_at_device)).reduce((m, x) => Math.max(m, x.length_mm), 0);
  const avg = same.length ? Math.round(same.reduce((s1, x) => s1 + x.length_mm, 0) / same.length) : 0;
  const isRecord = own && pos === 1 && same.length > 1;
  const maxLen = sorted[0]?.length_mm || c.length_mm;
  const w = c.weather;
  const rows = [
    ['Pagauta', html`${shortDate(c.captured_at_device)}<small>${dateTime(c.captured_at_device).split(', ').pop()} · ${daypartLabel(daypartOf(c.captured_at_device)).toLowerCase()}</small>`],
    w ? ['Oras', html`${[w.temp_c !== null && w.temp_c !== undefined ? `${String(w.temp_c).replace('.', ',')} °C` : '', w.pressure_hpa ? `${w.pressure_hpa} hPa` : ''].filter(Boolean).join(' · ')}<small>${(WEATHER_LT[w.code] || '').toLowerCase()}${w.wind_ms !== null && w.wind_ms !== undefined ? ` · vėjas ${String(w.wind_ms).replace('.', ',')} m/s` : ''}</small>`] : null,
    (c.weight_g && c.length_mm) || (own && c.bait) ? [own && c.bait ? 'Masalas' : 'Svoris', html`${own && c.bait ? c.bait : kg(c.weight_g)}<small>${own && c.bait && c.weight_g && c.length_mm ? kg(c.weight_g) : ''}</small>`] : null
  ].filter(Boolean);

  return {
    nav: own ? 'dienorastis' : 'lenteles',
    title: `${sp} ${size(c)}`,
    html: html`<div class="screen">
      <header class="top-bar">
        <button class="icon-btn" data-back aria-label="Atgal">${icon('back', 22, 2.2)}</button>
        <span class="muted strong">Laimikis</span>
        ${c.photo_path ? html`<button class="icon-btn" data-share aria-label="Dalintis laimikiu">${icon('share', 20)}</button>` : html`<span></span>`}
      </header>

      <div class="c-hero">
        <button class="photo-big" data-zoom aria-label="Rodyti nuotrauką per visą ekraną">
          ${icon('fish', 72, 1.4)}
          ${c.photo_path ? html`<img alt="${sp} ${size(c)}" data-photo="${c.photo_path}">` : ''}
          <span class="photo-hint">${icon('plus', 16, 2.4)}Padidinti</span>
        </button>
        ${isRecord ? html`<span class="c-tag" data-pb>🏆 Asmeninis rekordas</span>` : ''}
        <div class="c-ov"><h1 class="c-len" tabindex="-1">${size(c)}</h1><span class="c-sp">${sp}</span></div>
      </div>
      ${c.status !== 'approved' || own ? html`<div class="row gap-8">${statusChip(c.status)}</div>` : ''}
      ${own && c.status === 'rejected' && c.reject_reason ? html`<p class="warn-box">${icon('alert', 18)}${c.reject_reason}</p>` : ''}

      <section class="card row tight">
        ${avatar(c.nickname)}
        <div class="grow stack-1"><a class="strong link" href="#/zvejys/${c.user_id}">${c.nickname}${own ? ' (tu)' : ''}</a>
          <span class="small muted">${c.region || ''}</span></div>
      </section>

      <dl class="c-facts" data-facts>${rows.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>

      ${own && same.length > 1 ? html`<section class="card stack-2" data-compare>
        <div class="row-between"><b>${sp}: tavo laimikiai</b><span class="small muted">${pos} vieta iš ${same.length}</span></div>
        <div class="cmpbar" aria-hidden="true"><i style="width:${Math.round((c.length_mm / maxLen) * 100)}%"></i>${prevBest ? html`<u style="left:${Math.round((prevBest / maxLen) * 100)}%"></u>` : ''}</div>
        <span class="small muted">${prevBest ? (c.length_mm > prevBest ? `Ankstesnis rekordas – ${cm(prevBest)} (+${cm(c.length_mm - prevBest)})` : `Tuo metu rekordas buvo ${cm(prevBest)}`) : 'Pirma šios rūšies žuvis'} · vidurkis ${cm(avg)}</span>
      </section>` : ''}

      ${relevant.length ? html`<section class="stack">
        <h2 class="h2">Turnyruose</h2>
        <div class="list">${relevant.map(({ t, reason }) => html`<a class="list-row" href="#/t/${t.id}">
          <span class="dot-icon ${reason === 'ok' && c.status === 'approved' ? 'ok' : 'off'}">${icon(reason === 'ok' ? 'check' : 'minus', 15, 3)}</span>
          <span class="grow stack-1"><span class="strong">${t.title}</span>
            <span class="small muted">${reason !== 'ok' ? REASON_LT[reason] : c.status === 'approved' ? 'Įskaitytas' : 'Bus įskaitytas po patvirtinimo'}${phase(t) === 'done' ? ' · turnyras baigėsi' : ''}</span></span>
          ${rankIn.get(t.id) ? html`<span class="c-rank" title="${c.nickname} vieta lentelėje">#${rankIn.get(t.id)}</span>` : ''}
          ${icon('chevron', 18)}
        </a>`)}</div>
      </section>` : ''}

      ${own ? html`<section class="stack">
        <h2 class="h2">Tik tau</h2>
        <dl class="list">
          <div class="list-row"><dt class="muted">Masalas</dt><dd class="strong right">${c.bait || '–'}</dd></div>
          <div class="list-row"><dt class="muted">Pastabos</dt><dd class="right prewrap">${c.notes || '–'}</dd></div>
          <div class="list-row"><dt class="muted">Vieta</dt><dd class="right">${c.location
            ? html`<a class="link" href="#/zemelapis">Mano žemėlapyje</a> · <a class="link" target="_blank" rel="noopener noreferrer" href="https://www.openstreetmap.org/?mlat=${c.location.lat.toFixed(5)}&amp;mlon=${c.location.lng.toFixed(5)}#map=14/${c.location.lat.toFixed(5)}/${c.location.lng.toFixed(5)}">žemėlapis (±${Math.round(c.location.accuracy ?? 0)} m)</a>`
            : 'nėra'}</dd></div>
        </dl>
        <button class="btn btn-ghost" data-edit-catch aria-expanded="false">${icon('edit', 18)}Redaguoti masalą ir pastabas</button>
        <form class="card stack-2" data-extra-form hidden>
          <label class="field"><span class="small muted strong">Masalas</span><input name="bait" maxlength="80" value="${c.bait || ''}"></label>
          <label class="field"><span class="small muted strong">Pastabos</span><textarea name="notes" rows="3" maxlength="500">${c.notes || ''}</textarea></label>
          <div class="row gap-10"><button class="btn btn-primary grow" type="submit">Išsaugoti</button><button class="btn" type="button" data-extra-cancel>Atšaukti</button></div>
        </form>
        <p class="small muted">${icon('lock', 14)} Masalo, pastabų ir vietos kiti nemato.</p>
      </section>` : html`<p class="center small muted">${icon('lock', 14)} Laimikio vieta nerodoma</p>`}

      ${social ? html`<section class="stack-2" data-catch-social>
        <h2 class="h2">Klubo draugai</h2>
        ${feat(state, 'club_reactions') ? html`<div class="cl-react" data-social="${c.id}">${REACTIONS.map(([k, e, label]) => html`<button type="button" class="cl-chip ${social.mine.includes(k) ? 'on' : ''}"
          data-react="${k}" aria-pressed="${social.mine.includes(k)}" aria-label="${label}: ${social[k]}" ${own ? 'disabled' : ''}>${e} <span>${social[k]}</span></button>`)}</div>` : ''}
        ${feat(state, 'club_comments') ? html`<div class="stack-2" data-comment-box>${commentsHtml(comments, me, can(state, 'review'), own)}</div>` : ''}
      </section>` : ''}

      ${canCheck ? checkRequestBox(activeCheck) : ''}
      ${canReport ? (myReport
        ? html`<p class="small muted center" data-reported>${icon('alert', 14)} Tu pranešei apie šį laimikį – ${myReport.status === 'open' ? 'moderatorius peržiūrės' : 'pranešimas jau išnagrinėtas'}.</p>`
        : html`<button class="btn btn-ghost" data-report-open>${icon('alert', 18)}Pranešti apie įtartiną laimikį</button>
          <form class="card stack" data-report-form hidden>
            <p class="strong">Kas atrodo įtartina?</p>
            <div class="chips" role="radiogroup" aria-label="Pranešimo priežastis">
              ${REPORT_REASONS.map(([key, label]) => html`<button type="button" class="sp-chip" role="radio" aria-checked="false" data-reason="${key}">${label}</button>`)}
            </div>
            <label class="field"><span class="small muted strong">Paaiškinimas (nebūtina)</span>
              <textarea name="message" rows="2" maxlength="300" placeholder="pvz. ši nuotrauka buvo kitoje grupėje pernai"></textarea></label>
            <p class="small muted">Tavo vardo žvejys nematys. Pranešimą peržiūrės moderatorius.</p>
            <div class="row gap-10"><button class="btn btn-primary grow" type="submit">Pranešti</button><button class="btn" type="button" data-report-cancel>Atšaukti</button></div>
          </form>`) : ''}
    </div>`,
    mount(root) {
      hydratePhotos(root, backend);
      if (canCheck) mountCheckRequest(root, ctx, c.id);
      root.querySelectorAll('[data-react]').forEach((b) => b.addEventListener('click', async () => {
        const on = b.getAttribute('aria-pressed') !== 'true';
        const n = b.querySelector('span');
        b.disabled = true;
        try {
          await backend.react(c.id, b.dataset.react, on);
          b.setAttribute('aria-pressed', String(on));
          b.classList.toggle('on', on);
          n.textContent = String(Number(n.textContent) + (on ? 1 : -1));
        } catch (err) { ctx.toast(err.message || 'Nepavyko'); }
        b.disabled = false;
      }));
      const cbox = root.querySelector('[data-comment-box]');
      if (cbox) bindComments(cbox, c.id, () => ctx.rerender(), ctx);
      root.querySelector('[data-back]').addEventListener('click', () => {
        if (history.length > 1) history.back();
        else ctx.navigate('#/');
      });
      root.querySelector('[data-zoom]').addEventListener('click', () => {
        const img = root.querySelector('.photo-big img.loaded');
        if (img) openPhoto(img.src, img.alt);
        else ctx.toast(c.photo_path ? 'Nuotrauka dar kraunasi' : 'Šis laimikis be nuotraukos');
      });
      const extra = root.querySelector('[data-extra-form]');
      if (extra) {
        const opener = root.querySelector('[data-edit-catch]');
        const toggle = (show) => { extra.hidden = !show; opener.hidden = show; opener.setAttribute('aria-expanded', String(show)); if (show) extra.bait.focus(); };
        opener.addEventListener('click', () => toggle(true));
        root.querySelector('[data-extra-cancel]').addEventListener('click', () => toggle(false));
        extra.addEventListener('submit', async (e) => {
          e.preventDefault();
          const btn = extra.querySelector('[type=submit]');
          btn.disabled = true;
          try {
            await backend.updateCatch(c.id, { bait: extra.bait.value.trim(), notes: extra.notes.value.trim() });
            ctx.toast('Išsaugota');
            ctx.rerender();
          } catch (err) {
            btn.disabled = false;
            ctx.toast(err.message || 'Nepavyko išsaugoti');
          }
        });
      }
      const form = root.querySelector('[data-report-form]');
      if (form) {
        let reason = null;
        const opener = root.querySelector('[data-report-open]');
        opener.addEventListener('click', () => { opener.hidden = true; form.hidden = false; form.scrollIntoView({ block: 'center', behavior: 'smooth' }); });
        root.querySelector('[data-report-cancel]').addEventListener('click', () => { form.hidden = true; opener.hidden = false; });
        form.querySelectorAll('[data-reason]').forEach((b) => b.addEventListener('click', () => {
          reason = b.dataset.reason;
          form.querySelectorAll('[data-reason]').forEach((x) => {
            x.setAttribute('aria-checked', String(x === b));
            x.setAttribute('aria-pressed', String(x === b));
          });
        }));
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!reason) { ctx.toast('Pasirink priežastį'); return; }
          const btn = form.querySelector('[type=submit]');
          btn.disabled = true;
          try {
            await backend.reportCatch(c.id, reason, form.message.value.trim());
            ctx.toast('Ačiū! Moderatorius peržiūrės laimikį');
            ctx.rerender();
          } catch (err) {
            btn.disabled = false;
            ctx.toast(err.message || 'Nepavyko pranešti');
          }
        });
      }
      // Pasidalinimas: paveikslėlio kortelė (nuotrauka + ilgis + rūšis); nepavykus – nuoroda.
      root.querySelector('[data-share]')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const img = root.querySelector('.photo-big img.loaded');
          const card = await makeShareCard({ photo: img?.src || null, length: size(c), species: sp,
            line: `${new Date(c.captured_at_device).toLocaleDateString('lt-LT')} · ${c.nickname}`, badge: isRecord ? '🏆 Asmeninis rekordas' : '' });
          const how = await shareImage(card, { title: `${sp} ${size(c)}` });
          if (how === 'downloaded') ctx.toast('Paveikslėlis išsaugotas');
        } catch {
          try {
            if (navigator.share) await navigator.share({ title: `${sp} ${size(c)}`, url: location.href });
            else { await navigator.clipboard.writeText(location.href); ctx.toast('Nuoroda nukopijuota'); }
          } catch { /* atšaukta */ }
        }
        btn.disabled = false;
      });
    }
  };
}
