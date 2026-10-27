// Kvietimas į (dažniausiai privatų) turnyrą: #/kvietimas/<kodas>
import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { describeFormat, dateTime, cm, count, phase } from '../lib/format.js';
import { backButton, empty, phaseBadge } from '../ui.js';

const KEY = 'zt-invite';

// Prisimenam kvietimą, kad po prisijungimo (laiško nuoroda gali atsidaryti naujame skirtuke) grįžtume čia.
export function rememberInvite(code) {
  try { localStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() })); } catch { /* nėra saugyklos */ }
}

export function takeInvite() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    localStorage.removeItem(KEY);
    return v && Date.now() - v.at < 24 * 3600e3 && /^[0-9a-f]{6,32}$/.test(v.code) ? v.code : null;
  } catch {
    return null;
  }
}

export async function inviteView(ctx, [code]) {
  const { backend, state } = ctx;
  const t = /^[0-9a-f]{6,32}$/i.test(code) ? await backend.getInvite(code) : null;
  if (!t) {
    return { nav: 'turnyrai', title: 'Kvietimas', html: html`<div class="screen">${backButton('#/')}
      <h1 class="sr-only" tabindex="-1">Kvietimas</h1>
      ${empty('Kvietimas negalioja', 'Nuoroda neteisinga arba turnyras jau baigėsi. Paprašyk organizatoriaus naujos nuorodos.')}</div>` };
  }
  if (state.user) {
    const mine = await backend.tournament(t.id).catch(() => null);
    if (mine?.joined) {
      ctx.navigate(`#/t/${t.id}`);
      return { nav: 'turnyrai', html: html`` };
    }
  }
  return {
    nav: 'turnyrai',
    title: `Kvietimas · ${t.title}`,
    html: html`<div class="screen has-cta">
      <header class="top-bar">${backButton('#/')}<span class="muted strong">Kvietimas</span><span></span></header>
      <section class="card hero stack">
        <div class="row gap-8">${phaseBadge(t)}<span class="badge">${icon('lock', 12, 2.6)}Su kvietimu</span></div>
        <h1 class="display-lg" tabindex="-1">${t.title}</h1>
        <p class="muted">${describeFormat(t)}${t.min_length_mm ? ` · nuo ${cm(t.min_length_mm)}` : ''}</p>
        <dl class="list">
          <div class="list-row"><dt class="muted">Pradžia</dt><dd class="strong right">${dateTime(t.starts_at)}</dd></div>
          <div class="list-row"><dt class="muted">Pabaiga</dt><dd class="strong right">${dateTime(t.ends_at)}</dd></div>
          <div class="list-row"><dt class="muted">Dalyviai</dt><dd class="strong right">${count(Number(t.participants), 'dalyvis', 'dalyviai', 'dalyvių')}</dd></div>
        </dl>
      </section>
      <p class="muted small">Tave pakvietė dalyvauti šiame turnyre. Laimikius registruosi programėlės kamera${phase(t) === 'live' ? ' – turnyras jau vyksta' : ''}.</p>
    </div>
    <div class="cta-bar">${state.user
      ? html`<button class="btn btn-primary btn-lg" data-accept>${icon('check', 22, 3)}Dalyvauti</button>`
      : html`<a class="btn btn-primary btn-lg" href="#/prisijungti" data-login>${icon('mail', 22)}Prisijungti ir dalyvauti</a>`}</div>`,
    mount(root) {
      root.querySelector('[data-login]')?.addEventListener('click', () => rememberInvite(code.toLowerCase()));
      root.querySelector('[data-accept]')?.addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        try {
          const id = await backend.joinWithInvite(code);
          ctx.toast('Užsiregistravai į turnyrą');
          ctx.navigate(`#/t/${id}`);
        } catch (err) {
          e.currentTarget.disabled = false;
          ctx.toast(err.message || 'Nepavyko užsiregistruoti');
        }
      });
    }
  };
}
