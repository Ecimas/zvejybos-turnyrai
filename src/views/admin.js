// Administravimo panelė (#/moderavimas/funkcijos): funkcijų jungikliai ir skelbimas visiems. Tik savininkui (teisė „roles“).
import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { dateTime } from '../lib/format.js';
import { backButton, empty } from '../ui.js';
import { can } from '../lib/roles.js';
import { FEATURE_GROUPS, FEATURES, featureLabel } from '../lib/features.js';
import { moderationTabs } from './moderation.js';

const BANNER_MAX = 240;
const STORAGE_LIMIT = 1024 ** 3; // nemokamas Supabase planas – 1 GB failams
const BUCKET_LT = { 'catch-photos': 'Laimikių nuotraukos', 'sponsor-logos': 'Rėmėjų logotipai', 'tournament-covers': 'Turnyrų viršeliai', 'club-images': 'Klubų nuotraukos' };
const nf = (n, d = 0) => n.toLocaleString('lt-LT', { maximumFractionDigits: d, minimumFractionDigits: 0 });
export function fmtBytes(b) {
  if (b >= 1024 ** 3) return `${nf(b / 1024 ** 3, 2)} GB`;
  const mb = b / 1024 ** 2;
  return `${nf(mb, mb < 1 ? 2 : mb < 100 ? 1 : 0)} MB`;
}

// Vietos skaitiklis: kiek užimta iš 1 GB, kiek dar nuotraukų tilps, kas kiek užima.
export function storageCard(rows) {
  const total = rows.reduce((a, r) => a + r.bytes, 0);
  const pct = Math.min(100, (total / STORAGE_LIMIT) * 100);
  const level = pct >= 95 ? 'bad' : pct >= 80 ? 'warn' : 'ok';
  const photos = rows.find((r) => r.bucket === 'catch-photos');
  const avg = photos && photos.files >= 20 ? photos.bytes / photos.files : 110 * 1024;
  const fits = Math.max(0, Math.floor((STORAGE_LIMIT - total) / avg / 100) * 100);
  const sorted = [...rows].sort((a, b) => (a.bucket === 'catch-photos' ? -1 : b.bucket === 'catch-photos' ? 1 : b.bytes - a.bytes));
  return html`<section class="card st-card st-${level}" data-storage aria-labelledby="st-h">
    <h2 class="af-h" id="st-h">Vieta serveryje</h2>
    <div class="st-top"><span class="st-big" data-storage-used>${fmtBytes(total)}</span><span class="st-of">iš 1 GB</span>
      <span class="st-pct" data-storage-pct>${nf(pct, pct < 10 ? 1 : 0)} %</span></div>
    <div class="st-bar" role="progressbar" aria-label="Užimta vieta" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><i style="width:${Math.max(1.5, pct)}%"></i></div>
    ${level !== 'ok' ? html`<div class="st-note" role="status" data-storage-warn><b aria-hidden="true">!</b><span>${level === 'bad'
      ? 'Vieta beveik baigėsi. Pilnai užpildžius nauji laimikiai neįsikels – reikia rinktis Pro planą (25 $/mėn., 100 GB) arba senų turnyrų nuotraukų tvarkymą.'
      : 'Liko mažiau nei 20 %. Pilnai užpildžius nauji laimikiai neįsikels – laikas rinktis Pro planą (25 $/mėn., 100 GB) arba senų turnyrų nuotraukų tvarkymą.'}</span></div>` : ''}
    <p class="small muted">Telpa dar apie <b class="st-em" data-storage-fits>${nf(fits)}</b> laimikių nuotraukų (vidutiniškai ~${nf(Math.round(avg / 1024))} KB${photos?.thumbs ? ' su maža kopija' : ''}).</p>
    <div class="st-rows">${sorted.map((r) => html`<div class="st-row" data-storage-row="${r.bucket}"><span>${BUCKET_LT[r.bucket] || r.bucket}</span><span class="muted">${nf(r.files)} · ${fmtBytes(r.bytes)}</span></div>
      ${r.bucket === 'catch-photos' ? html`<div class="st-row st-sub"><span>iš jų mažos kopijos sąrašams</span><span class="muted">${nf(r.thumbs)} · ${fmtBytes(r.thumb_bytes)}</span></div>` : ''}`)}</div>
    <p class="small muted">Atsisiuntimo srautą (nemokamai 5 GB/mėn.) rodo tik Supabase skydelis → <b class="st-em">Usage</b>.</p>
  </section>`;
}

export async function adminFeaturesView(ctx) {
  const { backend, state } = ctx;
  if (!can(state, 'roles')) {
    return { nav: 'profilis', html: html`<div class="screen">${backButton('#/profilis')}<h1 class="sr-only" tabindex="-1">Funkcijos</h1>${empty('Šiai skilčiai neturi teisių', 'Funkcijas valdo programėlės savininkas.')}</div>` };
  }
  const [admin, banner, usage] = await Promise.all([backend.featureAdmin(), backend.banner?.().catch(() => null) ?? null,
    backend.storageUsage?.().catch(() => null) ?? null]);
  const byKey = new Map(admin.features.map((f) => [f.key, f]));
  const known = FEATURES.filter(([key]) => byKey.has(key));
  const on = known.filter(([key]) => byKey.get(key).enabled).length;

  const row = ([key, label, desc]) => {
    const f = byKey.get(key);
    if (!f) {
      return html`<div class="af-row" data-feature-row="${key}"><span class="grow stack-1"><span class="strong">${label}</span><span class="small muted">${desc}</span>
        <span class="small muted">Dar neįdiegta serveryje</span></span><input type="checkbox" class="switch" role="switch" checked disabled aria-label="${label}"></div>`;
    }
    return html`<label class="af-row" data-feature-row="${key}"><span class="grow stack-1"><span class="strong">${label}</span><span class="small muted">${desc}</span>
      ${!f.enabled ? html`<span class="small af-off">Išjungta${f.by ? ` · ${f.by}` : ''}${f.updated_at ? ` · ${dateTime(f.updated_at)}` : ''}</span>` : ''}</span>
      <input type="checkbox" class="switch" role="switch" data-feature="${key}" ${f.enabled ? 'checked' : ''} aria-label="${label}"></label>`;
  };

  return {
    nav: 'profilis',
    title: 'Funkcijos',
    html: html`<div class="screen">
      <header class="top-bar">${backButton('#/profilis')}<span class="muted strong">Funkcijos</span><span></span></header>
      <h1 class="sr-only" tabindex="-1">Programėlės funkcijos</h1>
      ${moderationTabs(state, 'features')}

      ${usage ? storageCard(usage) : ''}

      <section class="card stack-2" data-banner-card aria-labelledby="ban-h">
        <h2 class="h2 row gap-8" id="ban-h">${icon('megaphone', 20)}Skelbimas visiems</h2>
        ${banner ? html`<div class="app-banner app-banner-${banner.tone} app-banner-preview" data-banner-current><span class="grow">${banner.body}</span></div>
          <p class="small muted">Rodomas visiems nuo ${dateTime(banner.updated_at)}.</p>`
          : html`<p class="small muted">Juosta programėlės viršuje visiems – pvz. apie atnaujinimą, renginį ar svarbią naujieną. Kiekvienas gali ją paslėpti sau.</p>`}
        <form class="stack-2" data-banner-form novalidate>
          <label class="field"><span class="small muted strong">Tekstas</span>
            <textarea name="body" rows="3" maxlength="${BANNER_MAX}" placeholder="pvz. Šeštadienį 9–10 val. atnaujinimas – programėlė gali neveikti">${banner?.body ?? ''}</textarea>
            <span class="small muted right" data-banner-left>${BANNER_MAX - (banner?.body?.length ?? 0)}</span></label>
          <div class="seg" role="group" aria-label="Skelbimo tipas">
            <button type="button" data-tone="info" aria-pressed="${(banner?.tone ?? 'info') === 'info'}">Informacija</button>
            <button type="button" data-tone="warn" aria-pressed="${banner?.tone === 'warn'}">Įspėjimas</button>
          </div>
          <div class="row gap-8">
            <button class="btn btn-primary grow" type="submit">${banner ? 'Atnaujinti' : 'Rodyti visiems'}</button>
            ${banner ? html`<button class="btn btn-ghost" type="button" data-banner-clear>Nuimti</button>` : ''}
          </div>
        </form>
      </section>

      <section class="card af-sum" data-feature-sum>
        <span class="af-big">${on}/${known.length}</span>
        <span class="stack-1"><span class="strong">funkcijų įjungta</span>
          <span class="small muted">Išjungta funkcija dingsta visiems iškart. Duomenys neištrinami – įjungus viskas grįžta.</span></span>
      </section>

      ${FEATURE_GROUPS.map(([title, list]) => html`<section class="card af-group" aria-label="${title}">
        <h2 class="af-h">${title}</h2>${list.map(row)}</section>`)}

      <section class="card stack-1" data-feature-log>
        <h2 class="af-h">Paskutiniai pakeitimai</h2>
        ${admin.log.length ? html`<ol class="plain af-log small">${admin.log.map((x) => html`<li><b>${x.by || 'Kažkas'}</b>
          ${x.key === 'banner' ? (x.enabled ? 'paskelbė skelbimą' : 'nuėmė skelbimą') : html`${x.enabled ? 'įjungė' : 'išjungė'} „${featureLabel(x.key)}“`}
          · ${dateTime(x.at)}</li>`)}</ol>`
          : html`<p class="small muted">Pakeitimų dar nebuvo.</p>`}
      </section>
    </div>`,
    mount(root) {
      root.querySelectorAll('[data-feature]').forEach((box) => box.addEventListener('change', async () => {
        const key = box.dataset.feature;
        const want = box.checked;
        box.disabled = true;
        try {
          await backend.setFeature(key, want);
          state.features = { ...(state.features || {}), [key]: want };
          ctx.toast(want ? `Įjungta: ${featureLabel(key)}` : `Išjungta visiems: ${featureLabel(key)}`);
          ctx.rerender();
        } catch (err) {
          box.checked = !want;
          box.disabled = false;
          ctx.toast(err.message || 'Nepavyko pakeisti');
        }
      }));

      const form = root.querySelector('[data-banner-form]');
      let tone = banner?.tone ?? 'info';
      form.querySelectorAll('[data-tone]').forEach((b) => b.addEventListener('click', () => {
        tone = b.dataset.tone;
        form.querySelectorAll('[data-tone]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      }));
      const left = form.querySelector('[data-banner-left]');
      form.body.addEventListener('input', () => { left.textContent = String(BANNER_MAX - form.body.value.length); });
      const save = async (body) => {
        const btns = form.querySelectorAll('button');
        btns.forEach((b) => { b.disabled = true; });
        try {
          await backend.setBanner(body, tone);
          state.banner = body ? { body, tone, updated_at: new Date().toISOString() } : null;
          ctx.showBanner?.();
          ctx.toast(body ? 'Skelbimas rodomas visiems' : 'Skelbimas nuimtas');
          ctx.rerender();
        } catch (err) {
          btns.forEach((b) => { b.disabled = false; });
          ctx.toast(err.message || 'Nepavyko išsaugoti');
        }
      };
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const body = form.body.value.trim();
        if (body.length < 3) { ctx.toast('Įrašyk skelbimo tekstą (bent 3 simboliai)'); form.body.focus(); return; }
        save(body);
      });
      root.querySelector('[data-banner-clear]')?.addEventListener('click', () => save(''));
    }
  };
}
