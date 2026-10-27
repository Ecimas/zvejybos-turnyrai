// Laimikio peržiūra: didelė nuotrauka (paspaudus – per visą ekraną), duomenys ir turnyrai.
// Kiti mato tik patvirtintus laimikius; masalą, pastabas ir vietą – tik savininkas (ir vietą – moderatorius).
import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { cm, dateTime, phase } from '../lib/format.js';
import { fitReason, REASON_LT } from '../lib/scoring.js';
import { weatherLine } from '../lib/weather.js';
import { statusChip, avatar, notFound, hydratePhotos, openPhoto } from '../ui.js';

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
  const canReport = !!me && !own && c.status === 'approved';
  const [tournaments, entered, myReport] = await Promise.all([
    backend.tournaments().catch(() => []),
    backend.userEntries(c.user_id).catch(() => []),
    canReport ? backend.myReport(c.id).catch(() => null) : null
  ]);
  const at = new Date(c.captured_at_device).getTime();
  const joinedAt = new Map(entered.map((e) => [e.tournament_id, e.joined_at]));
  const relevant = tournaments
    .filter((t) => joinedAt.has(t.id) && at >= new Date(t.starts_at).getTime() && at < new Date(t.ends_at).getTime())
    .map((t) => ({ t, reason: fitReason(t, t.species_ids, joinedAt.get(t.id) || true, c) }));

  const rows = [
    ['Rūšis', sp],
    ['Ilgis', cm(c.length_mm)],
    c.weight_g ? ['Svoris', kg(c.weight_g)] : null,
    ['Pagauta', dateTime(c.captured_at_device)],
    c.weather ? ['Oras', weatherLine(c.weather)] : null
  ].filter(Boolean);

  return {
    nav: own ? 'dienorastis' : 'lenteles',
    title: `${sp} ${cm(c.length_mm)}`,
    html: html`<div class="screen">
      <header class="top-bar">
        <button class="icon-btn" data-back aria-label="Atgal">${icon('back', 22, 2.2)}</button>
        <span class="muted strong">Laimikis</span>
        ${c.photo_path ? html`<button class="icon-btn" data-share aria-label="Dalintis laimikiu">${icon('share', 20)}</button>` : html`<span></span>`}
      </header>

      <button class="photo-big" data-zoom aria-label="Rodyti nuotrauką per visą ekraną">
        ${icon('fish', 72, 1.4)}
        ${c.photo_path ? html`<img alt="${sp} ${cm(c.length_mm)}" data-photo="${c.photo_path}">` : ''}
        <span class="photo-hint">${icon('plus', 16, 2.4)}Padidinti</span>
      </button>

      <section class="row-between">
        <div class="stack-1">
          <h1 class="display-lg" tabindex="-1">${cm(c.length_mm)}</h1>
          <span class="muted strong">${sp}</span>
        </div>
        ${c.status !== 'approved' || own ? statusChip(c.status) : ''}
      </section>
      ${own && c.status === 'rejected' && c.reject_reason ? html`<p class="warn-box">${icon('alert', 18)}${c.reject_reason}</p>` : ''}

      <section class="card row tight">
        ${avatar(c.nickname)}
        <div class="grow stack-1"><a class="strong link" href="#/zvejys/${c.user_id}">${c.nickname}${own ? ' (tu)' : ''}</a>
          <span class="small muted">${c.region || ''}</span></div>
      </section>

      <dl class="list">${rows.map(([k, v]) => html`<div class="list-row"><dt class="muted">${k}</dt><dd class="strong right">${v}</dd></div>`)}</dl>

      ${relevant.length ? html`<section class="stack">
        <h2 class="h2">Turnyruose</h2>
        <div class="list">${relevant.map(({ t, reason }) => html`<a class="list-row" href="#/t/${t.id}">
          <span class="dot-icon ${reason === 'ok' && c.status === 'approved' ? 'ok' : 'off'}">${icon(reason === 'ok' ? 'check' : 'minus', 15, 3)}</span>
          <span class="grow stack-1"><span class="strong">${t.title}</span>
            <span class="small muted">${reason !== 'ok' ? REASON_LT[reason] : c.status === 'approved' ? 'Įskaitytas' : 'Bus įskaitytas po patvirtinimo'}${phase(t) === 'done' ? ' · turnyras baigėsi' : ''}</span></span>
          ${icon('chevron', 18)}
        </a>`)}</div>
      </section>` : ''}

      ${own ? html`<section class="stack">
        <h2 class="h2">Tik tau</h2>
        <dl class="list">
          <div class="list-row"><dt class="muted">Masalas</dt><dd class="strong right">${c.bait || '–'}</dd></div>
          <div class="list-row"><dt class="muted">Pastabos</dt><dd class="right prewrap">${c.notes || '–'}</dd></div>
          <div class="list-row"><dt class="muted">Vieta</dt><dd class="right">${c.location
            ? html`<a class="link" target="_blank" rel="noopener noreferrer" href="https://www.openstreetmap.org/?mlat=${c.location.lat.toFixed(5)}&amp;mlon=${c.location.lng.toFixed(5)}#map=14/${c.location.lat.toFixed(5)}/${c.location.lng.toFixed(5)}">žemėlapis (±${Math.round(c.location.accuracy ?? 0)} m)</a>`
            : 'nėra'}</dd></div>
        </dl>
        <p class="small muted">${icon('lock', 14)} Masalo, pastabų ir vietos kiti nemato. Pakeisti masalą ir pastabas gali <a class="link" href="#/dienorastis">dienoraštyje</a>.</p>
      </section>` : html`<p class="center small muted">${icon('lock', 14)} Laimikio vieta nerodoma</p>`}

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
      root.querySelector('[data-back]').addEventListener('click', () => {
        if (history.length > 1) history.back();
        else ctx.navigate('#/');
      });
      root.querySelector('[data-zoom]').addEventListener('click', () => {
        const img = root.querySelector('.photo-big img.loaded');
        if (img) openPhoto(img.src, img.alt);
        else ctx.toast(c.photo_path ? 'Nuotrauka dar kraunasi' : 'Šis laimikis be nuotraukos');
      });
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
      root.querySelector('[data-share]')?.addEventListener('click', async () => {
        const url = location.href;
        try {
          if (navigator.share) await navigator.share({ title: `${sp} ${cm(c.length_mm)}`, url });
          else { await navigator.clipboard.writeText(url); ctx.toast('Nuoroda nukopijuota'); }
        } catch { /* atšaukta */ }
      });
    }
  };
}
