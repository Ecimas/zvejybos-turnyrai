import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { cm, shortDate } from '../lib/format.js';
import { thumb, hydratePhotos, backButton, empty, avatar, loginPrompt, notFound, defaultNickname, banNotice } from '../ui.js';
import { computeBadges } from '../lib/badges.js';
import { weatherEnabled } from './capture.js';
import { BAN_DAYS, BAN_REASONS, banUntilText } from '../lib/bans.js';
import { permsOf, rolesOf, roleLabel, isStaff, can } from '../lib/roles.js';
import { pushSupport, currentSubscription, enablePush, disablePush, NOTIFY_KINDS } from '../lib/push.js';
import { followBlock, mountFollow } from './social.js';

function badges(catches, tcount) {
  const list = computeBadges(catches, tcount);
  const earned = list.filter((b) => b.earned).length;
  return html`<section class="stack">
    <div class="row-between"><h2 class="h2">Ženkliukai</h2><span class="small muted">${earned} iš ${list.length}</span></div>
    <ul class="badges plain">${list.map((b) => html`<li class="badge-tile ${b.earned ? 'earned' : ''}" title="${b.desc}">
      <span class="badge-ico" aria-hidden="true">${icon(b.earned ? 'star' : 'lock', 20, 2.2)}</span>
      <span class="small strong">${b.name}</span>
      <span class="sr-only">${b.earned ? 'gautas' : `dar negautas, ${Math.round(b.progress * 100)} %`}: ${b.desc}</span>
      ${b.earned ? '' : html`<span class="mini-progress" aria-hidden="true"><span style="width:${Math.round(b.progress * 100)}%"></span></span>`}
    </li>`)}</ul>
  </section>`;
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

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
  // Visada visi 12 mėnesių: vienas mėnuo su laimikiais nebeišsitempia per visą plotį.
  const nowMonth = new Date().getMonth();
  const months = byMonth.map((n, i) => ({ n, label: MONTHS[i], now: i === nowMonth, future: i > nowMonth }));
  return { ok, records, months, year, speciesCount: best.size };
}

function seasonChart(s) {
  const max = Math.max(1, ...s.months.map((m) => m.n));
  const label = s.months.filter((m) => !m.future).map((m) => `${m.label} ${m.n}`).join(', ');
  return html`<section class="card hero stack">
    <div class="row-between"><h2 class="h2">${s.year} sezonas</h2><span class="small muted">patvirtinti laimikiai</span></div>
    <div class="bars" role="img" aria-label="Laimikiai per mėnesį: ${label}">
      ${s.months.map((m) => html`<div class="bar-col ${m.future ? 'future' : ''}">
        <span class="bar-n">${m.n || ''}</span>
        <div class="bar ${m.now ? 'now' : ''} ${m.n ? '' : 'zero'}" style="height:${m.n ? Math.round((m.n / max) * 86) + 4 : 2}px"></div>
        <span class="bar-label">${m.label}</span>
      </div>`)}
    </div>
  </section>`;
}

function records(s) {
  if (!s.records.length) return '';
  return html`<section class="stack">
    <h2 class="h2">Asmeniniai rekordai</h2>
    <div class="list">${s.records.map((r) => html`<a class="list-row" href="#/l/${r.id}">
      ${thumb(r.photo_path, 40)}
      <span class="grow stack-1"><span class="strong">${r.name}</span><span class="small muted">${shortDate(r.captured_at_device)}</span></span>
      <span class="num-md">${cm(r.length_mm)}</span>
      ${icon('chevron', 18)}
    </a>`)}</div>
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
  const perms = permsOf(p);
  const [catches, tcount, pendingList, disputes, reports, trips, follow, clubs] = await Promise.all([
    backend.myCatches(),
    backend.userTournamentCount(state.user.id),
    perms.has('review') ? backend.pending().catch(() => []) : [],
    perms.has('disputes') ? backend.openDisputes().catch(() => []) : [],
    perms.has('disputes') ? backend.openReports().catch(() => []) : [],
    backend.blankTrips().catch(() => []),
    backend.followStats ? backend.followStats(state.user.id).catch(() => null) : null,
    backend.myClubs ? backend.myClubs().catch(() => []) : []
  ]);
  const reportedCatches = new Set(reports.map((r) => r.catch_id)).size;
  // Žvejybos dienos: dienos su laimikiu (bet kokios būsenos, išskyrus atmestus) ir dienos be laimikio.
  const dayOf = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
  const catchDays = new Set(catches.filter((c) => c.status !== 'rejected').map((c) => dayOf(c.captured_at_device)));
  const allDays = new Set([...catchDays, ...trips.map((b) => dayOf(`${b.trip_date}T12:00:00`))]);
  const luck = allDays.size ? Math.round((catchDays.size / allDays.size) * 100) : 0;
  const s = stats(catches, state.species);
  let theme = 'dark';
  try { theme = localStorage.getItem('zt-theme') || 'dark'; } catch { /* nėra saugyklos */ }

  return {
    nav: 'profilis',
    title: 'Profilis',
    html: html`<div class="screen">
      <header class="profile-head">
        ${avatar(p.nickname, 'avatar-xl')}
        <div class="grow stack-1">
          <h1 class="display-md" tabindex="-1">${p.nickname}</h1>
          <span class="muted">${p.region || 'Regionas nenurodytas'}</span>
          ${roleBadges(p)}
          ${follow ? followBlock(follow, true, true) : ''}
        </div>
        ${state.ban ? '' : html`<button class="icon-btn" data-edit aria-label="Redaguoti profilį">${icon('edit', 20)}</button>`}
      </header>

      ${banNotice(state.ban)}
      ${!state.ban && defaultNickname(p.nickname) ? html`<div class="card stack-2 nick-card">
        <p class="strong">Pasirink slapyvardį</p>
        <p class="small muted">Jį matys kiti žvejai lentelėse. Dabar rodomas automatiškai sukurtas „${p.nickname}“.</p>
        <button class="btn btn-primary" data-pick-nick>${icon('edit', 18)}Pasirinkti slapyvardį</button>
      </div>` : ''}

      <form class="card stack" data-form hidden>
        <label class="field"><span class="small muted strong">Slapyvardis (matomas kitiems)</span>
          <input name="nickname" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_ĄČĘĖĮŠŲŪŽąčęėįšųūž.\\-]+" value="${p.nickname}" autocomplete="nickname"></label>
        <label class="field"><span class="small muted strong">Regionas (pvz. Kauno r.)</span>
          <input name="region" maxlength="40" value="${p.region || ''}"></label>
        <p class="small muted">Tikslios laimikių vietos niekam nerodomos.</p>
        <div class="row gap-10"><button class="btn btn-primary grow" type="submit">Išsaugoti</button><button class="btn" type="button" data-cancel>Atšaukti</button></div>
      </form>

      ${statGrid(s, tcount)}
      ${trips.length ? html`<p class="card small" data-luck>${icon('book', 16)} Žvejybos dienų: <strong>${allDays.size}</strong> · su laimikiu <strong>${catchDays.size}</strong> (${luck} %)</p>` : ''}
      ${s.ok.length ? seasonChart(s) : ''}
      ${records(s)}
      ${badges(catches, tcount)}

      <section class="card stack push-card" data-push aria-labelledby="push-h">
        <h2 class="h2 row gap-8" id="push-h">${icon('bell', 20)}Pranešimai į telefoną</h2>
        <p class="small muted" data-push-body>Tikrinama…</p>
      </section>

      <section class="stack">
        <h2 class="h2">Daugiau</h2>
        <div class="list">
          ${perms.has('review') ? html`<a class="list-row" href="#/moderavimas">${icon('shield', 20)}<span class="grow strong">Moderavimas</span>${pendingList.length ? html`<span class="chip chip-wait">${pendingList.length}</span>` : ''}${icon('chevron', 18)}</a>` : ''}
          ${perms.has('disputes') ? html`<a class="list-row" href="#/moderavimas/pranesimai">${icon('alert', 20)}<span class="grow strong">Pranešimai apie laimikius</span>${reportedCatches ? html`<span class="chip chip-wait">${reportedCatches}</span>` : ''}${icon('chevron', 18)}</a>` : ''}
          ${perms.has('disputes') ? html`<a class="list-row" href="#/moderavimas/gincai">${icon('alert', 20)}<span class="grow strong">Ginčai</span>${disputes.length ? html`<span class="chip chip-wait">${disputes.length}</span>` : ''}${icon('chevron', 18)}</a>` : ''}
          ${perms.has('ban') ? html`<a class="list-row" href="#/moderavimas/blokuoti">${icon('lock', 20)}<span class="grow strong">Užblokuoti žvejai</span>${icon('chevron', 18)}</a>` : ''}
          ${perms.has('tournaments') ? html`<a class="list-row" href="#/moderavimas/turnyrai">${icon('trophy', 20)}<span class="grow strong">Turnyrų žurnalas</span>${icon('chevron', 18)}</a>` : ''}
          ${perms.has('roles') ? html`<a class="list-row" href="#/moderavimas/komanda">${icon('user', 20)}<span class="grow strong">Komanda ir rolės</span>${icon('chevron', 18)}</a>` : ''}
          ${perms.has('roles') ? html`<a class="list-row" href="#/moderavimas/statistika">${icon('bars', 20)}<span class="grow strong">Statistika</span>${icon('chevron', 18)}</a>` : ''}
          <a class="list-row" href="#/naujas">${icon('plus', 20)}<span class="grow strong">Sukurti turnyrą</span>${icon('chevron', 18)}</a>
          <a class="list-row" href="#/sekami">${icon('star', 20)}<span class="grow strong">Sekamų žvejų laimikiai</span>${icon('chevron', 18)}</a>
          <a class="list-row" href="#/klubai">${icon('users', 20)}<span class="grow strong">Klubai</span>${clubs.length ? html`<span class="small muted">${clubs.map((c) => c.name).join(', ')}</span>` : ''}${icon('chevron', 18)}</a>
          <a class="list-row" href="#/zemelapis">${icon('pin', 20)}<span class="grow strong">Mano laimikių žemėlapis</span>${icon('chevron', 18)}</a>
          <a class="list-row" href="#/zvejys/${p.id}">${icon('user', 20)}<span class="grow strong">Kaip mane mato kiti</span>${icon('chevron', 18)}</a>
          <div class="list-row">${icon('sun', 20)}<span class="grow strong">Tema</span>
            <select data-theme aria-label="Tema">
              <option value="auto" ${theme === 'auto' ? 'selected' : ''}>Pagal telefoną</option>
              <option value="dark" ${theme === 'dark' ? 'selected' : ''}>Tamsi</option>
              <option value="light" ${theme === 'light' ? 'selected' : ''}>Šviesi (lauke)</option>
            </select>
          </div>
          <label class="list-row">${icon('sun', 20)}<span class="grow stack-1"><span class="strong">Oras prie laimikio</span><span class="small muted">Temperatūra, vėjas ir slėgis iš Open-Meteo</span></span>
            <input type="checkbox" data-weather-toggle ${weatherEnabled() ? 'checked' : ''}></label>
          <a class="list-row" href="#/taisykles">${icon('book', 20)}<span class="grow strong">Turnyrų taisyklės</span>${icon('chevron', 18)}</a>
          <a class="list-row" href="#/privatumas">${icon('lock', 20)}<span class="grow strong">Privatumo politika</span>${icon('chevron', 18)}</a>
          <button class="list-row" data-export>${icon('share', 20)}<span class="grow strong left">Atsisiųsti mano duomenis</span></button>
          ${backend.mode === 'demo'
            ? html`<button class="list-row" data-reset>${icon('refresh', 20)}<span class="grow strong left">Atstatyti demo duomenis</span></button>`
            : html`<button class="list-row" data-logout>${icon('logout', 20)}<span class="grow strong left">Atsijungti</span></button>`}
          <button class="list-row bad" data-delete-open>${icon('x', 20)}<span class="grow strong left">Ištrinti paskyrą</span></button>
        </div>
        <div class="card stack danger-box" data-delete-box hidden>
          <p class="strong">Ištrinti paskyrą visam laikui?</p>
          <p class="small muted">Bus ištrinti tavo laimikiai, nuotraukos, vietos, sukurti turnyrai ir registracijos. Atkurti nebus galima. Prieš tai gali atsisiųsti savo duomenis.</p>
          <label class="field"><span class="small muted strong">Patvirtinimui įrašyk IŠTRINTI</span><input data-delete-word autocomplete="off"></label>
          <p class="small" data-delete-status aria-live="polite"></p>
          <button class="btn btn-danger" data-delete-confirm>Ištrinti paskyrą</button>
        </div>
      </section>
    </div>`,
    mount(root) {
      hydratePhotos(root, backend);
      mountPush(root.querySelector('[data-push]'), ctx);
      const form = root.querySelector('[data-form]');
      root.querySelector('[data-edit]')?.addEventListener('click', () => { form.hidden = !form.hidden; if (!form.hidden) form.nickname.focus(); });
      root.querySelector('[data-pick-nick]')?.addEventListener('click', () => {
        form.hidden = false;
        form.nickname.select();
        form.nickname.focus();
      });
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
      root.querySelector('[data-weather-toggle]').addEventListener('change', (e) => {
        try { localStorage.setItem('zt-weather', e.target.checked ? 'on' : 'off'); } catch { /* nėra saugyklos */ }
      });
      root.querySelector('[data-export]').addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        try {
          const data = await backend.exportData();
          const day = new Date().toISOString().slice(0, 10);
          download(`zvejybos-turnyrai-${day}.json`, JSON.stringify(data, null, 2));
          ctx.toast('Duomenys atsisiųsti');
        } catch {
          ctx.toast('Nepavyko paruošti duomenų');
        } finally {
          e.currentTarget.disabled = false;
        }
      });
      const delBox = root.querySelector('[data-delete-box]');
      root.querySelector('[data-delete-open]').addEventListener('click', () => {
        delBox.hidden = !delBox.hidden;
        if (!delBox.hidden) delBox.scrollIntoView({ block: 'center' });
      });
      root.querySelector('[data-delete-confirm]').addEventListener('click', async (e) => {
        const word = root.querySelector('[data-delete-word]').value.trim().toUpperCase();
        const status = root.querySelector('[data-delete-status]');
        if (word !== 'IŠTRINTI' && word !== 'ISTRINTI') { status.textContent = 'Įrašyk žodį IŠTRINTI.'; return; }
        const btn = e.currentTarget;
        btn.disabled = true;
        const STEPS = { data: 'Trinami duomenys…', photos: 'Trinamos nuotraukos…', account: 'Trinama paskyra…' };
        try {
          await backend.deleteAccount((step) => { status.textContent = STEPS[step] || ''; });
          for (const item of await ctx.outbox.list()) await ctx.outbox.dismiss(item.clientId);
          ctx.state.user = backend.getUser();
          ctx.state.profile = ctx.state.user ? await backend.myProfile().catch(() => null) : null;
          ctx.toast(backend.mode === 'demo' ? 'Demo paskyra ištrinta ir sukurta iš naujo' : 'Paskyra ištrinta');
          ctx.navigate('#/');
        } catch (err) {
          btn.disabled = false;
          status.textContent = err.message || 'Nepavyko ištrinti – bandyk dar kartą';
        }
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
  if (!p) return { nav: 'lenteles', html: notFound('#/lenteles', 'Žvejys nerastas') };
  const moderating = can(state, 'ban') && id !== state.user?.id;
  const [catches, tcount, ban, follow, clubs] = await Promise.all([
    backend.userCatches(id), backend.userTournamentCount(id),
    moderating ? backend.userBan(id).catch(() => null) : null,
    backend.followStats ? backend.followStats(id).catch(() => null) : null,
    backend.userClubs ? backend.userClubs(id).catch(() => []) : []
  ]);
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
          ${roleBadges(p)}
          ${follow ? followBlock(follow, id === state.user?.id, !!state.user && !state.ban) : ''}
        </div>
      </header>
      ${clubs.length ? html`<p class="row gap-8 wrap">${clubs.map((c) => html`<a class="badge badge-mine club-badge" href="#/klubas/${c.id}">${icon('users', 12, 2.6)}${c.name}</a>`)}</p>` : ''}
      ${statGrid(s, tcount)}
      ${records(s)}
      ${gallery.length ? html`<section class="stack">
        <h2 class="h2">Laimikiai</h2>
        <div class="gallery">${gallery.map((c) => html`<a href="#/l/${c.id}"><figure>
          ${thumb(c.photo_path, 104)}
          <figcaption><span class="strong">${cm(c.length_mm)}</span> <span class="muted small">${state.species.find((x) => x.id === c.species_id)?.name_lt ?? ''}</span></figcaption>
        </figure></a>`)}</div>
      </section>` : empty('Patvirtintų laimikių dar nėra')}
      <p class="center small muted">${icon('lock', 14)} Laimikių vietos nerodomos</p>
      ${moderating ? modCard(p, ban) : ''}
    </div>`,
    mount(root) {
      hydratePhotos(root, backend);
      if (moderating) mountModCard(root, ctx, p);
      mountFollow(root, ctx, id);
      root.querySelector('[data-back]').addEventListener('click', () => {
        if (history.length > 1) history.back();
        else ctx.navigate('#/lenteles');
      });
    }
  };
}

// Moderatoriaus veiksmai kito žvejo profilyje: blokuoti / atblokuoti, netinkamą slapyvardį pakeisti automatiniu.
function modCard(p, ban) {
  return html`<section class="card stack mod-card" aria-labelledby="mod-h">
    <h2 class="h2 row gap-8" id="mod-h">${icon('shield', 20)}Moderatoriui</h2>
    ${isStaff(p) ? html`<p class="small muted">Tai komandos narys – blokuoti negalima. Pirma atimk jo roles (Komanda ir rolės).</p>`
      : ban ? html`<div class="stack-2" data-ban-status>
          <p class="strong bad">Užblokuotas ${banUntilText(ban)}</p>
          <p class="small">Priežastis: ${ban.reason}</p>
          <button class="btn btn-ghost" type="button" data-unban>Atblokuoti</button>
        </div>`
      : html`<form class="stack" data-ban-form novalidate>
          <label class="field"><span class="small muted strong">Trukmė</span>
            <select name="days">${BAN_DAYS.map(([d, label]) => html`<option value="${d === null ? '' : d}" ${d === 7 ? 'selected' : ''}>${label}</option>`)}</select></label>
          <label class="field"><span class="small muted strong">Priežastis (matys pats žvejys)</span>
            <input name="reason" maxlength="300" autocomplete="off" list="ban-reasons" placeholder="pvz. Sukčiavimas su laimikiais"></label>
          <datalist id="ban-reasons">${BAN_REASONS.map((r) => html`<option value="${r}"></option>`)}</datalist>
          <button class="btn btn-danger" type="submit">${icon('lock', 18, 2.6)}Užblokuoti</button>
          <p class="small muted">Užblokuotas negalės registruoti laimikių, dalyvauti turnyruose, kurti jų ir rašyti pranešimų. Kol blokavimas galioja, jo rezultatai lentelėse nerodomi.</p>
        </form>`}
    <button class="btn btn-ghost" type="button" data-reset-nick>Pakeisti slapyvardį į automatinį</button>
  </section>`;
}

function mountModCard(root, ctx, p) {
  const { backend } = ctx;
  const form = root.querySelector('[data-ban-form]');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const reason = form.reason.value.trim();
    const days = form.days.value === '' ? null : Number(form.days.value);
    if (reason.length < 3) { ctx.toast('Įrašyk priežastį (bent 3 simboliai)'); form.reason.focus(); return; }
    if (!confirm(`Užblokuoti ${p.nickname}?`)) return;
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await backend.banUser(p.id, days, reason);
      ctx.toast(`${p.nickname} užblokuotas`);
      ctx.rerender();
    } catch (err) {
      btn.disabled = false;
      ctx.toast(err.message || 'Nepavyko užblokuoti');
    }
  });
  root.querySelector('[data-unban]')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      await backend.unbanUser(p.id);
      ctx.toast(`${p.nickname} atblokuotas`);
      ctx.rerender();
    } catch {
      e.currentTarget.disabled = false;
      ctx.toast('Nepavyko atblokuoti');
    }
  });
  root.querySelector('[data-reset-nick]').addEventListener('click', async (e) => {
    if (!confirm(`Pakeisti slapyvardį „${p.nickname}“ į automatinį? Žvejys galės pasirinkti naują.`)) return;
    e.currentTarget.disabled = true;
    try {
      const nick = await backend.resetNickname(p.id);
      ctx.toast(`Slapyvardis pakeistas į ${nick}`);
      ctx.rerender();
    } catch (err) {
      e.currentTarget.disabled = false;
      ctx.toast(err.message || 'Nepavyko pakeisti slapyvardžio');
    }
  });
}

// Komandos nario rolės – matomos visiems, kad žvejai žinotų, kas tikrina.
function roleBadges(p) {
  const roles = rolesOf(p);
  if (!roles.length) return '';
  return html`<span class="row gap-8 wrap" data-roles>${roles.map((r) => html`<span class="badge badge-role">${icon('shield', 12, 2.6)}${roleLabel(r)}</span>`)}</span>`;
}

// Push pranešimų kortelė: būsena šiame telefone, įjungimas, rūšys, bandomasis pranešimas.
async function mountPush(card, ctx) {
  if (!card) return;
  const { backend } = ctx;
  const head = html`<h2 class="h2 row gap-8" id="push-h">${icon('bell', 20)}Pranešimai į telefoną</h2>`;
  const support = pushSupport();
  const say = (text) => { card.innerHTML = String(html`${head}<p class="small muted" data-push-body>${text}</p>`); };
  if (support === 'unsupported') return say('Ši naršyklė pranešimų nepalaiko. Atidaryk programėlę per Chrome (Android) arba įdiegtą į pradžios ekraną (iPhone).');
  if (support === 'ios-install') return say('iPhone telefone pranešimai veikia tik įdiegtoje programėlėje: Safari → Bendrinti → „Pridėti į pradžios ekraną“, tada atidaryk ją iš pradžios ekrano.');
  if (support === 'denied') return say('Pranešimai užblokuoti telefono nustatymuose. Leisk juos šios svetainės nustatymuose ir grįžk čia.');
  const [sub, settings] = await Promise.all([currentSubscription(), backend.notificationSettings().catch(() => null)]);
  if (!card.isConnected) return;
  const on = !!sub;
  const s = settings || { review: true, overtaken: true, start: true, announcements: true };
  const inner = on
    ? html`<p class="small ok strong" data-push-state>Įjungta šiame telefone</p>
      <div class="stack-1">${NOTIFY_KINDS.map(([k, label]) => html`<label class="check-row"><input type="checkbox" data-kind="${k}" ${s[k] ? 'checked' : ''}><span>${label}</span></label>`)}</div>
      <div class="row gap-8 wrap">
        <button class="btn btn-ghost" type="button" data-push-test>Siųsti bandomąjį</button>
        <button class="btn-text" type="button" data-push-off>Išjungti šiame telefone</button>
      </div>`
    : html`<p class="small muted" data-push-state>Sužinok iškart, kai laimikis patvirtinamas, kai kas nors tave aplenkia ar rytoj startuoja turnyras.</p>
      <button class="btn btn-primary" type="button" data-push-on>${icon('bell', 18)}Įjungti pranešimus</button>`;
  card.innerHTML = String(html`${head}${inner}`);
  card.querySelector('[data-push-on]')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      await enablePush(backend);
      ctx.toast('Pranešimai įjungti');
    } catch (err) {
      ctx.toast(err.message || 'Nepavyko įjungti pranešimų');
    }
    mountPush(card, ctx);
  });
  card.querySelector('[data-push-off]')?.addEventListener('click', async () => {
    await disablePush(backend);
    ctx.toast('Pranešimai šiame telefone išjungti');
    mountPush(card, ctx);
  });
  card.querySelector('[data-push-test]')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      const queued = await backend.sendTestPush();
      ctx.toast(queued ? 'Išsiųsta – pranešimas ateis per kelias sekundes' : 'Šis telefonas neužregistruotas – išjunk ir vėl įjunk');
    } catch {
      ctx.toast('Nepavyko išsiųsti');
    }
    setTimeout(() => { if (e.target.isConnected) e.target.disabled = false; }, 30000);
  });
  card.querySelectorAll('[data-kind]').forEach((cb) => cb.addEventListener('change', async () => {
    const next = { ...s };
    card.querySelectorAll('[data-kind]').forEach((x) => { next[x.dataset.kind] = x.checked; });
    try {
      await backend.saveNotificationSettings(next);
      Object.assign(s, next);
      ctx.toast('Išsaugota');
    } catch {
      cb.checked = !cb.checked;
      ctx.toast('Nepavyko išsaugoti');
    }
  }));
}
