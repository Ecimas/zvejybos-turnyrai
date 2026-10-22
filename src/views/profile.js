import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { cm, shortDate } from '../lib/format.js';
import { thumb, hydratePhotos, backButton, empty, avatar, loginPrompt } from '../ui.js';

const MONTHS = ['Sau', 'Vas', 'Kov', 'Bal', 'Geg', 'Bir', 'Lie', 'Rgp', 'Rgs', 'Spa', 'Lap', 'Grd'];

function stats(catches, species) {
  const ok = catches.filter((c) => c.status === 'approved');
  const best = new Map();
  for (const c of ok) {
    const cur = best.get(c.species_id);
    if (!cur || c.length_mm > cur.length_mm) best.set(c.species_id, c);
  }
  const records = [...best.values()]
    .sort((a, b) => b.length_mm - a.length_mm)
    .map((c) => ({ ...c, name: species.find((s) => s.id === c.species_id)?.name_lt ?? '' }));
  const year = new Date().getFullYear();
  const byMonth = Array(12).fill(0);
  ok.forEach((c) => {
    const d = new Date(c.captured_at_device);
    if (d.getFullYear() === year) byMonth[d.getMonth()]++;
  });
  const lastMonth = new Date().getMonth();
  const firstMonth = Math.max(0, byMonth.findIndex((n) => n > 0) === -1 ? lastMonth : Math.min(byMonth.findIndex((n) => n > 0), lastMonth));
  const months = byMonth.slice(firstMonth, lastMonth + 1).map((n, i) => ({ n, label: MONTHS[firstMonth + i] }));
  return { ok, records, months, year, speciesCount: best.size };
}

function seasonChart(s) {
  const max = Math.max(1, ...s.months.map((m) => m.n));
  const label = s.months.map((m) => `${m.label} ${m.n}`).join(', ');
  return html`<section class="card hero stack">
    <div class="row-between"><h2 class="h2">${s.year} sezonas</h2><span class="small muted">patvirtinti laimikiai</span></div>
    <div class="bars" role="img" aria-label="Laimikiai per mėnesį: ${label}">
      ${s.months.map((m, i) => html`<div class="bar-col">
        <span class="small strong">${m.n}</span>
        <div class="bar ${i === s.months.length - 1 ? 'now' : ''}" style="height:${Math.round((m.n / max) * 86) + 2}px"></div>
        <span class="small muted">${m.label}</span>
      </div>`)}
    </div>
  </section>`;
}

function records(s) {
  if (!s.records.length) return '';
  return html`<section class="stack">
    <h2 class="h2">Asmeniniai rekordai</h2>
    <div class="list">${s.records.map((r) => html`<div class="list-row">
      ${thumb(r.photo_path, 40)}
      <span class="grow stack-1"><span class="strong">${r.name}</span><span class="small muted">${shortDate(r.captured_at_device)}</span></span>
      <span class="num-md">${cm(r.length_mm)}</span>
    </div>`)}</div>
  </section>`;
}

function statGrid(s, tournaments) {
  return html`<div class="grid-3">
    <div class="stat-box center"><span class="stat-value">${s.ok.length}</span><span class="stat-label">Laimikiai</span></div>
    <div class="stat-box center"><span class="stat-value">${tournaments}</span><span class="stat-label">Turnyrai</span></div>
    <div class="stat-box center"><span class="stat-value">${s.speciesCount}</span><span class="stat-label">Rūšys</span></div>
  </div>`;
}

export async function profileView(ctx) {
  const { backend, state } = ctx;
  if (!state.user) {
    return { nav: 'profilis', title: 'Profilis', html: html`<div class="screen"><h1 class="display-lg" tabindex="-1">Profilis</h1>${loginPrompt('Prisijunk, kad matytum savo profilį.')}</div>` };
  }
  const p = state.profile || (await backend.myProfile());
  const [catches, tcount, pendingList] = await Promise.all([
    backend.myCatches(),
    backend.userTournamentCount(state.user.id),
    p?.is_admin ? backend.pending().catch(() => []) : []
  ]);
  const s = stats(catches, state.species);
  let theme = 'auto';
  try { theme = localStorage.getItem('zt-theme') || 'auto'; } catch { /* nėra saugyklos */ }

  return {
    nav: 'profilis',
    title: 'Profilis',
    html: html`<div class="screen">
      <header class="profile-head">
        ${avatar(p.nickname, 'avatar-xl')}
        <div class="grow stack-1">
          <h1 class="display-md" tabindex="-1">${p.nickname}</h1>
          <span class="muted">${p.region || 'Regionas nenurodytas'}</span>
        </div>
        <button class="icon-btn" data-edit aria-label="Redaguoti profilį">${icon('edit', 20)}</button>
      </header>

      <form class="card stack" data-form hidden>
        <label class="field"><span class="small muted strong">Slapyvardis (matomas kitiems)</span>
          <input name="nickname" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_ĄČĘĖĮŠŲŪŽąčęėįšųūž.\\-]+" value="${p.nickname}" autocomplete="nickname"></label>
        <label class="field"><span class="small muted strong">Regionas (pvz. Kauno r.)</span>
          <input name="region" maxlength="40" value="${p.region || ''}"></label>
        <p class="small muted">Tikslios laimikių vietos niekam nerodomos.</p>
        <div class="row gap-10"><button class="btn btn-primary grow" type="submit">Išsaugoti</button><button class="btn" type="button" data-cancel>Atšaukti</button></div>
      </form>

      ${statGrid(s, tcount)}
      ${s.ok.length ? seasonChart(s) : ''}
      ${records(s)}

      <section class="stack">
        <h2 class="h2">Daugiau</h2>
        <div class="list">
          ${p.is_admin ? html`<a class="list-row" href="#/moderavimas">${icon('shield', 20)}<span class="grow strong">Moderavimas</span>${pendingList.length ? html`<span class="chip chip-wait">${pendingList.length}</span>` : ''}${icon('chevron', 18)}</a>` : ''}
          <a class="list-row" href="#/naujas">${icon('plus', 20)}<span class="grow strong">Sukurti turnyrą</span>${icon('chevron', 18)}</a>
          <a class="list-row" href="#/zvejys/${p.id}">${icon('user', 20)}<span class="grow strong">Kaip mane mato kiti</span>${icon('chevron', 18)}</a>
          <div class="list-row">${icon('sun', 20)}<span class="grow strong">Tema</span>
            <select data-theme aria-label="Tema">
              <option value="auto" ${theme === 'auto' ? 'selected' : ''}>Pagal telefoną</option>
              <option value="dark" ${theme === 'dark' ? 'selected' : ''}>Tamsi</option>
              <option value="light" ${theme === 'light' ? 'selected' : ''}>Šviesi (lauke)</option>
            </select>
          </div>
          ${backend.mode === 'demo'
            ? html`<button class="list-row" data-reset>${icon('refresh', 20)}<span class="grow strong left">Atstatyti demo duomenis</span></button>`
            : html`<button class="list-row" data-logout>${icon('logout', 20)}<span class="grow strong left">Atsijungti</span></button>`}
        </div>
      </section>
    </div>`,
    mount(root) {
      hydratePhotos(root, backend);
      const form = root.querySelector('[data-form]');
      root.querySelector('[data-edit]').addEventListener('click', () => { form.hidden = !form.hidden; if (!form.hidden) form.nickname.focus(); });
      root.querySelector('[data-cancel]').addEventListener('click', () => { form.hidden = true; });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const nickname = form.nickname.value.trim();
        const region = form.region.value.trim();
        try {
          await backend.updateProfile({ nickname, region });
          ctx.state.profile = await backend.myProfile();
          ctx.toast('Profilis atnaujintas');
          ctx.rerender();
        } catch (err) {
          ctx.toast(err.message || 'Nepavyko išsaugoti');
        }
      });
      root.querySelector('[data-theme]').addEventListener('change', (e) => {
        try { localStorage.setItem('zt-theme', e.target.value); } catch { /* nėra saugyklos */ }
        ctx.applyTheme();
      });
      root.querySelector('[data-reset]')?.addEventListener('click', async () => {
        if (!confirm('Ištrinti visus demo duomenis ir pradėti iš naujo?')) return;
        await backend.signOut();
        ctx.state.profile = await backend.myProfile();
        ctx.toast('Demo duomenys atstatyti');
        ctx.navigate('#/');
      });
      root.querySelector('[data-logout]')?.addEventListener('click', async () => {
        await backend.signOut();
        ctx.state.user = null;
        ctx.state.profile = null;
        ctx.navigate('#/');
      });
    }
  };
}

export async function anglerView(ctx, [id]) {
  const { backend, state } = ctx;
  const p = await backend.profile(id);
  if (!p) return { nav: 'lenteles', html: html`<div class="screen">${backButton('#/lenteles')}${empty('Žvejys nerastas')}</div>` };
  const [catches, tcount] = await Promise.all([backend.userCatches(id), backend.userTournamentCount(id)]);
  const s = stats(catches, state.species);
  const gallery = s.ok.slice().sort((a, b) => b.captured_at_device.localeCompare(a.captured_at_device)).slice(0, 12);

  return {
    nav: 'lenteles',
    title: p.nickname,
    html: html`<div class="screen">
      <header class="top-bar"><button class="icon-btn" data-back aria-label="Atgal">${icon('back', 22, 2.2)}</button><span></span><span></span></header>
      <header class="profile-head">
        ${avatar(p.nickname, 'avatar-xl')}
        <div class="grow stack-1">
          <h1 class="display-md" tabindex="-1">${p.nickname}</h1>
          <span class="muted">${p.region || ''}</span>
        </div>
      </header>
      ${statGrid(s, tcount)}
      ${records(s)}
      ${gallery.length ? html`<section class="stack">
        <h2 class="h2">Laimikiai</h2>
        <div class="gallery">${gallery.map((c) => html`<figure>
          ${thumb(c.photo_path, 104)}
          <figcaption><span class="strong">${cm(c.length_mm)}</span> <span class="muted small">${state.species.find((x) => x.id === c.species_id)?.name_lt ?? ''}</span></figcaption>
        </figure>`)}</div>
      </section>` : empty('Patvirtintų laimikių dar nėra')}
      <p class="center small muted">${icon('lock', 14)} Laimikių vietos nerodomos</p>
    </div>`,
    mount(root) {
      hydratePhotos(root, backend);
      root.querySelector('[data-back]').addEventListener('click', () => {
        if (history.length > 1) history.back();
        else ctx.navigate('#/lenteles');
      });
    }
  };
}
