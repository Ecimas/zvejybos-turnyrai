// Moderavimo eilė: viena nuotrauka per ekraną, visi patikros signalai šalia.
import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { cm, dateTime } from '../lib/format.js';
import { SKEW_MS } from '../lib/scoring.js';
import { backButton, empty, thumb, hydratePhotos } from '../ui.js';

const REASONS = ['Nesimato matavimo', 'Ne ta rūšis', 'Netikslus ilgis', 'Pakartota nuotrauka'];

function tabs(active) {
  const items = [['#/moderavimas', 'queue', 'Laimikiai'], ['#/moderavimas/gincai', 'disputes', 'Ginčai'], ['#/moderavimas/komanda', 'team', 'Komanda']];
  return html`<nav class="seg" aria-label="Moderavimo skiltys">${items.map(([href, key, label]) =>
    html`<a href="${href}" role="button" aria-pressed="${key === active}"${key === active ? html` aria-current="page"` : ''}>${label}</a>`)}</nav>`;
}

const denied = () => ({ nav: 'profilis', html: html`<div class="screen">${backButton('#/profilis')}<h1 class="sr-only" tabindex="-1">Moderavimas</h1>${empty('Prieiga tik moderatoriams')}</div>` });

export async function moderationView(ctx) {
  const { backend, state } = ctx;
  if (!state.profile?.is_admin) return denied();
  const list = await backend.pending();
  const c = list[0];
  if (!c) {
    return { nav: 'profilis', title: 'Moderavimas', html: html`<div class="screen">
      <header class="top-bar">${backButton('#/profilis')}<span class="muted strong">Moderavimas</span><span></span></header>
      <h1 class="sr-only" tabindex="-1">Moderavimas</h1>
      ${tabs('queue')}
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
      ${tabs('queue')}
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
        <input data-reason-text maxlength="200" placeholder="Arba parašyk savo" aria-label="Atmetimo priežastis">
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

export async function disputesView(ctx) {
  const { backend, state } = ctx;
  if (!state.profile?.is_admin) return denied();
  const list = await backend.openDisputes();
  const sp = (id) => state.species.find((s) => s.id === id)?.name_lt ?? '';
  return {
    nav: 'profilis',
    title: 'Ginčai',
    html: html`<div class="screen">
      <header class="top-bar">${backButton('#/profilis')}<span class="muted strong">Ginčai: ${list.length}</span><span></span></header>
      <h1 class="sr-only" tabindex="-1">Ginčai</h1>
      ${tabs('disputes')}
      ${list.length ? list.map((d) => html`<article class="card stack" data-d="${d.id}">
        <div class="row tight">
          ${thumb(d.catch?.photo_path, 72)}
          <div class="grow stack-1">
            <span class="strong">${d.nickname} · patikimumas ${d.trust_score}</span>
            <span class="small muted">${d.catch ? `${sp(d.catch.species_id)} · ${cm(d.catch.length_mm)} · ${dateTime(d.catch.captured_at_device)}` : 'Laimikis ištrintas'}</span>
            ${d.catch?.reject_reason ? html`<span class="small bad">Atmesta: ${d.catch.reject_reason}</span>` : ''}
          </div>
        </div>
        <blockquote class="quote">${d.message}</blockquote>
        <input data-note maxlength="500" placeholder="Atsakymas dalyviui (nebūtina)" aria-label="Atsakymas dalyviui">
        <div class="row gap-10">
          <button class="btn btn-outline grow" data-resolve="0">${icon('x', 18, 2.6)}Palikti atmestą</button>
          <button class="btn btn-primary grow" data-resolve="1">${icon('check', 18, 3)}Įskaityti</button>
        </div>
      </article>`) : empty('Ginčų nėra', 'Kai dalyvis nesutiks su atmetimu, jo paaiškinimas atsiras čia.')}
    </div>`,
    mount(root) {
      hydratePhotos(root, backend);
      root.querySelectorAll('[data-d]').forEach((card) => card.querySelectorAll('[data-resolve]').forEach((b) => b.addEventListener('click', async () => {
        card.querySelectorAll('button').forEach((x) => { x.disabled = true; });
        const accept = b.dataset.resolve === '1';
        try {
          await backend.resolveDispute(card.dataset.d, accept, card.querySelector('[data-note]').value.trim());
          ctx.toast(accept ? 'Laimikis įskaitytas' : 'Palikta atmesta');
          ctx.rerender();
        } catch (err) {
          card.querySelectorAll('button').forEach((x) => { x.disabled = false; });
          ctx.toast(err.message || 'Nepavyko');
        }
      })));
    }
  };
}

export async function teamView(ctx) {
  const { backend, state } = ctx;
  if (!state.profile?.is_admin) return denied();
  const mods = await backend.moderators();
  return {
    nav: 'profilis',
    title: 'Moderatoriai',
    html: html`<div class="screen">
      <header class="top-bar">${backButton('#/profilis')}<span class="muted strong">Moderatoriai</span><span></span></header>
      <h1 class="sr-only" tabindex="-1">Moderatoriai</h1>
      ${tabs('team')}
      <div class="list">${mods.map((m) => html`<div class="list-row">
        ${icon('shield', 20)}<span class="grow strong">${m.nickname}${m.id === state.user.id ? ' (tu)' : ''}</span>
        <button class="btn-text bad" data-remove="${m.nickname}">Pašalinti</button>
      </div>`)}</div>
      <form class="card stack" data-add>
        <label class="field"><span class="small muted strong">Pridėti moderatorių pagal slapyvardį</span>
          <input name="nickname" required minlength="3" maxlength="24" autocomplete="off" placeholder="Slapyvardis"></label>
        <button class="btn btn-primary" type="submit">${icon('plus', 18, 2.6)}Paskirti moderatoriumi</button>
        <p class="small muted">Moderatorius mato tikslias laimikių vietas ir tvirtina rezultatus – skirk tik žmones, kuriais pasitiki.</p>
      </form>
    </div>`,
    mount(root) {
      const set = async (nickname, admin) => {
        try {
          await backend.setModerator(nickname, admin);
          if (!admin && nickname.toLowerCase() === state.profile.nickname.toLowerCase()) {
            ctx.state.profile = await backend.myProfile();
            ctx.toast('Nebesi moderatorius');
            ctx.navigate('#/profilis');
            return;
          }
          ctx.toast(admin ? 'Moderatorius paskirtas' : 'Moderatorius pašalintas');
          ctx.rerender();
        } catch (err) {
          ctx.toast(err.message || 'Nepavyko');
        }
      };
      root.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
        if (confirm(`Pašalinti ${b.dataset.remove} iš moderatorių?`)) set(b.dataset.remove, false);
      }));
      root.querySelector('[data-add]').addEventListener('submit', (e) => {
        e.preventDefault();
        const n = e.currentTarget.nickname.value.trim();
        if (n) set(n, true);
      });
    }
  };
}
