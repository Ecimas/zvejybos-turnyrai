// Administravimo panelė (#/moderavimas/funkcijos): funkcijų jungikliai ir skelbimas visiems. Tik savininkui (teisė „roles“).
import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { dateTime } from '../lib/format.js';
import { backButton, empty } from '../ui.js';
import { can } from '../lib/roles.js';
import { FEATURE_GROUPS, FEATURES, featureLabel } from '../lib/features.js';
import { moderationTabs } from './moderation.js';

const BANNER_MAX = 240;

export async function adminFeaturesView(ctx) {
  const { backend, state } = ctx;
  if (!can(state, 'roles')) {
    return { nav: 'profilis', html: html`<div class="screen">${backButton('#/profilis')}<h1 class="sr-only" tabindex="-1">Funkcijos</h1>${empty('Šiai skilčiai neturi teisių', 'Funkcijas valdo programėlės savininkas.')}</div>` };
  }
  const [admin, banner] = await Promise.all([backend.featureAdmin(), backend.banner?.().catch(() => null) ?? null]);
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
