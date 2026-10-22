// Moderavimo eilė: viena nuotrauka per ekraną, visi patikros signalai šalia.
import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { cm, dateTime } from '../lib/format.js';
import { SKEW_MS } from '../lib/scoring.js';
import { backButton, empty, thumb, hydratePhotos } from '../ui.js';

const REASONS = ['Nesimato matavimo', 'Ne ta rūšis', 'Netikslus ilgis', 'Pakartota nuotrauka'];

export async function moderationView(ctx) {
  const { backend, state } = ctx;
  if (!state.profile?.is_admin) {
    return { nav: 'profilis', html: html`<div class="screen">${backButton('#/profilis')}${empty('Prieiga tik moderatoriams')}</div>` };
  }
  const list = await backend.pending();
  const c = list[0];
  if (!c) {
    return { nav: 'profilis', title: 'Moderavimas', html: html`<div class="screen">
      <header class="top-bar">${backButton('#/profilis')}<span class="muted strong">Moderavimas</span><span></span></header>
      <h1 class="sr-only" tabindex="-1">Moderavimas</h1>
      ${empty('Eilė tuščia', 'Visi laimikiai peržiūrėti.')}
    </div>` };
  }
  const sp = state.species.find((s) => s.id === c.species_id)?.name_lt ?? '';
  const skew = new Date(c.captured_at_device) - new Date(c.received_at);
  const delayMin = Math.round(-skew / 60000);
  const signals = [
    ['Dalyvis', `${c.nickname} · patikimumas ${c.trust_score}`],
    ['Rūšis ir ilgis', `${sp} · ${cm(c.length_mm)}`],
    ['Nufotografuota', dateTime(c.captured_at_device)],
    ['Gauta serveryje', delayMin > 1 ? `${dateTime(c.received_at)} (po ${delayMin} min.)` : dateTime(c.received_at)]
  ];
  const warnings = [];
  if (skew > SKEW_MS) warnings.push('Telefono laikas skuba – nuotrauka „iš ateities“');
  if (!c.location) warnings.push('Be GPS vietos');
  else if (c.location.accuracy > 100) warnings.push(`Netiksli vieta (±${Math.round(c.location.accuracy)} m)`);

  return {
    nav: null,
    title: 'Moderavimas',
    html: html`<div class="screen has-cta">
      <header class="top-bar">${backButton('#/profilis')}<span class="muted strong">Liko: ${list.length}</span><span></span></header>
      <h1 class="sr-only" tabindex="-1">Moderavimas</h1>
      <div class="mod-photo">${thumb(c.photo_path, 358)}</div>
      ${warnings.length ? html`<div class="stack-2">${warnings.map((w) => html`<p class="warn-box">${icon('alert', 18)}${w}</p>`)}</div>` : ''}
      <dl class="list">
        ${signals.map(([k, v]) => html`<div class="list-row"><dt class="muted">${k}</dt><dd class="strong right">${v}</dd></div>`)}
        ${c.location ? html`<div class="list-row"><dt class="muted">Vieta</dt><dd class="right">
          <a class="link" target="_blank" rel="noopener noreferrer" href="https://www.openstreetmap.org/?mlat=${c.location.lat.toFixed(5)}&amp;mlon=${c.location.lng.toFixed(5)}#map=14/${c.location.lat.toFixed(5)}/${c.location.lng.toFixed(5)}">±${Math.round(c.location.accuracy ?? 0)} m · žemėlapis</a>
        </dd></div>` : ''}
      </dl>
      <fieldset class="field" data-reject-box hidden>
        <legend class="small muted strong">Atmetimo priežastis (matys dalyvis)</legend>
        <div class="chips">${REASONS.map((r) => html`<button type="button" class="sp-chip" data-reason="${r}">${r}</button>`)}</div>
        <input data-reason-text maxlength="200" placeholder="Arba parašyk savo">
        <button class="btn btn-danger" data-reject-confirm>Atmesti laimikį</button>
      </fieldset>
    </div>
    <div class="cta-bar row gap-10">
      <button class="btn btn-outline btn-lg" data-reject>${icon('x', 22, 2.6)}Atmesti</button>
      <button class="btn btn-primary btn-lg grow" data-approve>${icon('check', 22, 3)}Patvirtinti</button>
    </div>`,
    mount(root) {
      hydratePhotos(root, backend);
      const act = async (approve, reason) => {
        root.querySelectorAll('button').forEach((b) => { b.disabled = true; });
        try {
          await backend.review(c.id, approve, reason);
          ctx.toast(approve ? 'Patvirtinta' : 'Atmesta');
          ctx.rerender();
        } catch (err) {
          ctx.toast(err.message || 'Nepavyko');
          root.querySelectorAll('button').forEach((b) => { b.disabled = false; });
        }
      };
      root.querySelector('[data-approve]').addEventListener('click', () => act(true));
      const box = root.querySelector('[data-reject-box]');
      const text = root.querySelector('[data-reason-text]');
      root.querySelector('[data-reject]').addEventListener('click', () => {
        box.hidden = false;
        box.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      root.querySelectorAll('[data-reason]').forEach((b) => b.addEventListener('click', () => { text.value = b.dataset.reason; }));
      root.querySelector('[data-reject-confirm]').addEventListener('click', () => {
        if (!text.value.trim()) { ctx.toast('Nurodyk priežastį'); text.focus(); return; }
        act(false, text.value.trim());
      });
    }
  };
}
