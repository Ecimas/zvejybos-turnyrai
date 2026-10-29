// Tapti organizatoriumi (#/organizatorius, 0028): vieši turnyrai – tik patvirtintiems organizatoriams.
import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { dateTime } from '../lib/format.js';
import { backButton, loginPrompt } from '../ui.js';
import { can } from '../lib/roles.js';

const COOLDOWN = 7 * 24 * 3600e3;

export async function organizerView(ctx) {
  const { backend, state } = ctx;
  const head = html`<header class="top-bar">${backButton('#/profilis')}<span class="muted strong">Organizatorius</span><span></span></header>
    <h1 class="display-lg" tabindex="-1">Vieši turnyrai</h1>`;
  if (!state.user) return { nav: 'profilis', html: html`<div class="screen">${head}${loginPrompt('Prisijunk, kad galėtum rengti turnyrus.')}</div>` };
  const explain = html`<div class="card stack-2">
    <p class="row gap-8 strong">${icon('lock', 18)}Su kvietimu – visiems</p>
    <p class="small muted">Turnyrą draugams, klubui ar kompanijai gali sukurti kiekvienas: jis nerodomas bendrame sąraše, dalyviai prisijungia per tavo nuorodą.</p>
    <p class="row gap-8 strong">${icon('trophy', 18)}Viešas – organizatoriams</p>
    <p class="small muted">Vieši turnyrai matomi visiems žvejams sąraše, todėl juos kuria patvirtinti organizatoriai. Taip sąraše lieka tikri, gerai paruošti turnyrai – to nori ir dalyviai, ir rėmėjai.</p>
  </div>`;
  if (can(state, 'publish')) {
    return { nav: 'profilis', title: 'Organizatorius', html: html`<div class="screen">${head}
      <div class="card stack-2" data-org-ok><p class="strong row gap-8">${icon('check', 18, 2.6)}Tu – organizatorius</p>
        <p class="small muted">Gali kurti viešus turnyrus, matomus visų sąraše.</p>
        <a class="btn btn-primary" href="#/naujas">${icon('plus', 18, 2.6)}Sukurti turnyrą</a></div>${explain}</div>` };
  }
  const req = await backend.myOrganizerRequest().catch(() => null);
  const pending = req?.status === 'pending';
  const coolUntil = req?.status === 'rejected' && req.decided_at ? Date.parse(req.decided_at) + COOLDOWN : 0;
  const cooling = coolUntil > Date.now();
  return {
    nav: 'profilis',
    title: 'Tapti organizatoriumi',
    html: html`<div class="screen">${head}
      ${explain}
      ${pending ? html`<div class="card stack-2" data-org-pending>
        <p class="strong row gap-8">${icon('clock', 18)}Prašymas išsiųstas</p>
        <p class="small muted">${dateTime(req.created_at)} · laukia patvirtinimo. Kai patvirtinsime, gausi pranešimą.</p>
        ${req.message ? html`<p class="small prewrap">„${req.message}“</p>` : ''}
      </div>`
      : cooling ? html`<div class="card stack-2" data-org-rejected>
        <p class="strong">Prašymas kol kas nepatvirtintas</p>
        <p class="small muted">Pakartotinai paprašyti galėsi nuo ${dateTime(new Date(coolUntil))}. Tuo metu gali rengti turnyrus su kvietimu.</p>
      </div>`
      : html`<form class="card stack" data-org-form>
        <h2 class="h2">Tapti organizatoriumi</h2>
        <label class="field"><span class="small muted strong">Trumpai apie save (nebūtina)</span>
          <textarea name="message" rows="3" maxlength="300" placeholder="pvz. Rengiu Kauno marių lydekų turnyrus, klubas „…“"></textarea></label>
        <p class="form-error bad small" data-error hidden role="alert"></p>
        <button class="btn btn-primary" type="submit">${icon('check', 18, 2.6)}Siųsti prašymą</button>
      </form>`}
      <a class="btn btn-ghost" href="#/naujas">${icon('plus', 18, 2.6)}Sukurti turnyrą su kvietimu</a>
    </div>`,
    mount(root) {
      root.querySelector('[data-org-form]')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.currentTarget;
        const btn = f.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
          await backend.requestOrganizer(f.message.value.trim());
          ctx.toast('Prašymas išsiųstas');
          ctx.rerender();
        } catch (err) {
          btn.disabled = false;
          const el = f.querySelector('[data-error]');
          el.hidden = false;
          el.textContent = err.message || 'Nepavyko išsiųsti';
        }
      });
    }
  };
}
