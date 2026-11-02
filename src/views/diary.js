import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { cm, dateTime, count, longDate, plural } from '../lib/format.js';
import { statusChip, thumb, hydratePhotos, empty, loginPrompt } from '../ui.js';
import { feat } from '../lib/clubs.js';
import { weatherLine, fetchWeather } from '../lib/weather.js';
import { recordIds } from '../lib/records.js';
import { weatherEnabled } from './capture.js';
import { checkBanners } from './check.js';

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hoursText = (h) => `${String(Number(h)).replace('.', ',')} val.`;

// Trumpas GPS bandymas tik orui: koordinatės niekur nesaugomos.
function quickPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, maximumAge: 15 * 60e3, timeout: 6000 }
    );
  });
}

const kg = (g) => `${String(Math.round(g / 10) / 100).replace('.', ',')} kg`;
const DISPUTE_LT = { open: 'Ginčas peržiūrimas', accepted: 'Ginčas patenkintas', rejected: 'Ginčas atmestas' };

const MONTH_NAMES = ['Sausis', 'Vasaris', 'Kovas', 'Balandis', 'Gegužė', 'Birželis', 'Liepa', 'Rugpjūtis', 'Rugsėjis', 'Spalis', 'Lapkritis', 'Gruodis'];
const BIG_PAGE = 50;

// Laiko juostos grupės: šių metų mėnesiai atskirai, ankstesni metai – po vieną grupę.
export function groupTimeline(items, now = new Date()) {
  const year = now.getFullYear();
  const groups = [];
  const byKey = new Map();
  for (const it of items) {
    const d = new Date(it.at);
    const y = d.getFullYear();
    const key = y === year ? `${y}-${pad(d.getMonth() + 1)}` : String(y);
    let g = byKey.get(key);
    if (!g) {
      g = { key, year: y, title: y === year ? MONTH_NAMES[d.getMonth()] : `Visi ${y} m. laimikiai`, items: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.items.push(it);
  }
  return groups;
}

function foldSummary(g) {
  const fish = g.items.filter((i) => i.kind === 'catch').map((i) => i.c);
  const trips = g.items.length - fish.length;
  const parts = [];
  if (fish.length) parts.push(count(fish.length, 'laimikis', 'laimikiai', 'laimikių'));
  const big = fish.filter((c) => c.status !== 'rejected').reduce((m, c) => Math.max(m, c.length_mm), 0);
  if (big) parts.push(`didžiausia ${cm(big)}`);
  if (trips) parts.push(count(trips, 'išvyka be laimikio', 'išvykos be laimikio', 'išvykų be laimikio'));
  return parts.join(' · ');
}

export async function diaryView(ctx) {
  const { backend, state } = ctx;
  if (!state.user) {
    return { nav: 'dienorastis', title: 'Dienoraštis', html: html`<div class="screen"><h1 class="display-lg" tabindex="-1">Dienoraštis</h1>${loginPrompt('Prisijunk, kad matytum savo laimikius.')}</div>` };
  }
  const [queued, catches, disputes, trips, checks] = await Promise.all([
    ctx.outbox.list(), backend.myCatches(), backend.myDisputes().catch(() => []), backend.blankTrips().catch(() => []),
    backend.myChecks ? backend.myChecks().catch(() => []) : []
  ]);
  const records = recordIds(catches);
  const disputeOf = new Map(disputes.map((d) => [d.catch_id, d]));
  const sp = (id) => state.species.find((s) => s.id === id)?.name_lt ?? '';
  const needsAction = (c) => c.status === 'pending' || (c.status === 'rejected' && !disputeOf.has(c.id));
  const biggest = catches.filter((c) => c.status !== 'rejected').reduce((m, c) => (!m || c.length_mm > m.length_mm ? c : m), null);
  const speciesHere = [...new Set(catches.map((c) => c.species_id))].map((id) => ({ id, name: sp(id) })).filter((x) => x.name)
    .sort((x, y) => x.name.localeCompare(y.name, 'lt'));

  let filterSp = sessionStorage.getItem('zt-diary-sp') || '';
  if (filterSp && !speciesHere.some((x) => String(x.id) === filterSp)) filterSp = '';
  let sortBy = sessionStorage.getItem('zt-diary-sort') === 'big' ? 'big' : 'new';
  const opened = new Set();
  let bigShown = BIG_PAGE;

  const timeline = () => {
    const fish = catches.filter((c) => !filterSp || String(c.species_id) === filterSp);
    if (sortBy === 'big') return fish.slice().sort((x, y) => y.length_mm - x.length_mm || (y.captured_at_device > x.captured_at_device ? 1 : -1)).map((c) => ({ kind: 'catch', at: c.captured_at_device, c }));
    return [
      ...fish.map((c) => ({ kind: 'catch', at: c.captured_at_device, c })),
      ...(filterSp ? [] : trips.map((b) => ({ kind: 'trip', at: `${b.trip_date}T23:59:59`, b })))
    ].sort((x, y) => (y.at > x.at ? 1 : y.at < x.at ? -1 : 0));
  };

  const tripRow = (b) => html`<div class="d-item trip-card" data-trip="${b.id}"><div class="d-row">
      <span class="d-trip" aria-hidden="true">${icon('minus', 22, 2.4)}</span>
      <span class="grow stack-1">
        <span class="d-sp">Nieko nekibo${b.hours ? ` · ${hoursText(b.hours)}` : ''}</span>
        <span class="d-meta">${longDate(`${b.trip_date}T12:00:00`)}${b.weather ? ` · ${weatherLine(b.weather)}` : ''}</span>
        ${b.notes ? html`<span class="small">${b.notes}</span>` : ''}
      </span>
      <button class="icon-btn small-btn" data-trip-delete="${b.id}" aria-label="Ištrinti išvyką be laimikio">${icon('x', 16, 2.4)}</button>
    </div></div>`;

  const catchRow = (c) => {
    const d = disputeOf.get(c.id);
    const meta = [dateTime(c.captured_at_device), c.weight_g ? kg(c.weight_g) : '', c.bait || ''].filter(Boolean).join(' · ');
    return html`<div class="d-item" data-catch="${c.id}">
      <a class="d-row catch-link" href="#/l/${c.id}">
        ${thumb(c.photo_path, 52)}
        <span class="grow stack-1 min0">
          <span class="d-top"><span class="d-len">${cm(c.length_mm)}</span><span class="d-sp">${sp(c.species_id)}</span>
            ${records.has(c.id) ? html`<span class="d-rec">${icon('trophy', 16, 2.4)}<span class="sr-only">Asmeninis rekordas</span></span>` : ''}</span>
          <span class="d-meta ellipsis">${meta}</span>
        </span>
        ${c.status !== 'approved' ? statusChip(c.status) : ''}
        <span class="d-chev">${icon('chevron', 18)}</span>
      </a>
      ${c.status === 'rejected' && c.reject_reason || d || (c.status === 'rejected' && !state.ban) ? html`<div class="d-sub">
        ${c.status === 'rejected' && c.reject_reason ? html`<span class="small bad">${c.reject_reason}</span>` : ''}
        ${d ? html`<span class="small ${d.status === 'accepted' ? 'ok' : d.status === 'rejected' ? 'bad' : 'muted'}">${DISPUTE_LT[d.status]}${d.resolution ? `: ${d.resolution}` : ''}</span>`
          : c.status === 'rejected' && !state.ban ? html`<button class="btn btn-ghost btn-sm" data-dispute="${c.id}">Nesutinku su sprendimu</button>
            <form class="stack-2" data-dispute-form="${c.id}" hidden>
              <label class="field"><span class="small muted strong">Kodėl laimikis turėtų būti įskaitytas?</span>
                <textarea name="message" rows="3" minlength="3" maxlength="500" required placeholder="pvz. liniuotė matosi antroje nuotraukos pusėje"></textarea></label>
              <button class="btn btn-primary" type="submit">Pateikti moderatoriui</button>
            </form>` : ''}
      </div>` : ''}
    </div>`;
  };
  const rows = (items) => html`<div class="d-list">${items.map((it) => (it.kind === 'trip' ? tripRow(it.b) : catchRow(it.c)))}</div>`;

  const listHtml = () => {
    const items = timeline();
    if (!items.length) {
      if (filterSp) return empty('Šios rūšies laimikių nėra', '');
      return !queued.length ? empty('Dar neturi laimikių', 'Paspausk didelį mygtuką apačioje ir užregistruok pirmą žuvį.', html`<a class="btn btn-primary" href="#/laimikis">${icon('camera', 20)}Užregistruoti pirmą laimikį</a>`) : '';
    }
    if (sortBy === 'big') {
      return html`${rows(items.slice(0, bigShown))}${items.length > bigShown ? html`<button type="button" class="d-more" data-more>Rodyti daugiau (${items.length - bigShown})</button>` : ''}`;
    }
    const groups = groupTimeline(items);
    let lastYear = new Date().getFullYear();
    return groups.map((g, i) => {
      const open = i === 0 || opened.has(g.key) || g.items.some((it) => it.kind === 'catch' && needsAction(it.c));
      const yearHead = g.year !== lastYear ? html`<h2 class="d-year">${g.year}</h2>` : '';
      lastYear = g.year;
      if (!open) {
        return html`${yearHead}<button type="button" class="d-fold" data-fold="${g.key}" aria-expanded="false">
          <span class="grow stack-1"><span class="strong">${g.title}</span><span class="d-meta">${foldSummary(g)}</span></span>
          <span class="d-chev">${icon('chevron', 18)}</span></button>`;
      }
      if (/^\d{4}$/.test(g.key)) {
        const months = new Map();
        g.items.forEach((it) => { const m = new Date(it.at).getMonth(); if (!months.has(m)) months.set(m, []); months.get(m).push(it); });
        return html`${yearHead}${[...months].map(([m, its]) => html`<section class="stack-2" data-group="${g.key}-${m}">
          <h3 class="d-month"><span>${MONTH_NAMES[m]}</span><span>${its.length}</span></h3>${rows(its)}</section>`)}`;
      }
      return html`${yearHead}<section class="stack-2" data-group="${g.key}"><h2 class="d-month"><span>${g.title}</span><span>${g.items.length}</span></h2>${rows(g.items)}</section>`;
    });
  };

  return {
    nav: 'dienorastis',
    title: 'Dienoraštis',
    html: html`<div class="screen">
      <header class="page-head d-head">
        <h1 class="display-lg" tabindex="-1">Dienoraštis</h1>
        <button class="d-btn" data-blank-open aria-expanded="false" aria-label="Nieko nekibo – įrašyti žvejybą be laimikio" ${feat(ctx.state, 'blank_trips') ? '' : 'hidden'}>${icon('minus', 16, 2.6)}Nieko nekibo</button>
      </header>
      ${checkBanners(checks)}

      <form class="card stack" data-blank-form hidden>
        <p class="strong">Žvejojai, bet nieko nepagavai?</p>
        <p class="small muted">Įrašyk – statistika parodys, kur ir kada geriau sekasi. Šių įrašų niekas kitas nemato.</p>
        <div class="grid-2">
          <label class="field"><span class="small muted strong">Data</span>
            <input type="date" name="trip_date" required value="${localDate()}" max="${localDate()}"></label>
          <label class="field"><span class="small muted strong">Kiek valandų</span>
            <input name="hours" inputmode="decimal" maxlength="4" placeholder="pvz. 3"></label>
        </div>
        <label class="field"><span class="small muted strong">Pastabos (nebūtina)</span>
          <textarea name="notes" rows="2" maxlength="300" placeholder="pvz. stiprus vėjas, drumstas vanduo"></textarea></label>
        <div class="row gap-10"><button class="btn btn-primary grow" type="submit">Išsaugoti</button><button class="btn" type="button" data-blank-cancel>Atšaukti</button></div>
      </form>

      ${catches.length || queued.length ? html`<section class="d-stats" aria-label="Santrauka">
        <div class="d-stat" data-stat="count"><b>${catches.length + queued.length}</b><span>${plural(catches.length + queued.length, 'laimikis', 'laimikiai', 'laimikių')}</span></div>
        <div class="d-stat" data-stat="biggest"><b class="accent">${biggest ? cm(biggest.length_mm) : '–'}</b><span>didžiausia${biggest ? ` · ${sp(biggest.species_id).toLowerCase()}` : ''}</span></div>
        <div class="d-stat" data-stat="records"><b>${records.size}</b><span>asm. rekordai</span></div>
      </section>` : ''}

      ${queued.length ? html`<section class="stack">
        <h2 class="h2">Telefone</h2>
        ${queued.map((q) => html`<div class="card row tight">
          <span class="thumb">${icon('fish', 32, 1.8)}<img alt="" data-blob="${q.clientId}" class="loaded"></span>
          <div class="grow stack-1">
            <span class="num-md">${cm(q.lengthMm)}</span>
            <span class="small muted">${sp(q.speciesId)} · ${dateTime(q.capturedAt)}</span>
            ${q.error ? html`<span class="small bad">${q.error}</span>` : html`<span class="small muted">Išsiųsime, kai bus ryšys</span>`}
          </div>
          <div class="stack-2 right">
            ${statusChip(q.state)}
            ${q.state === 'failed' ? html`<button class="btn-text" data-dismiss="${q.clientId}">Pašalinti</button>` : ''}
          </div>
        </div>`)}
        ${queued.some((q) => q.state === 'queued') ? html`<button class="btn" data-sync>${icon('refresh', 18)}Siųsti dabar</button>` : ''}
      </section>` : ''}

      ${catches.length > 3 ? html`<div class="d-tools">
        <label class="d-sel"><span class="sr-only">Rūšis</span><select data-filter-sp aria-label="Rūšis">
          <option value="">Visos rūšys</option>${speciesHere.map((x) => html`<option value="${x.id}" ${String(x.id) === filterSp ? 'selected' : ''}>${x.name}</option>`)}
        </select></label>
        <label class="d-sel"><span class="sr-only">Rikiavimas</span><select data-sort aria-label="Rikiavimas">
          <option value="new" ${sortBy === 'new' ? 'selected' : ''}>Naujausi</option><option value="big" ${sortBy === 'big' ? 'selected' : ''}>Didžiausi</option>
        </select></label>
      </div>` : ''}

      <div class="stack" data-diary-list>${listHtml()}</div>
    </div>`,
    mount(root) {
      const urls = [];
      const byId = new Map(queued.map((q) => [q.clientId, q]));
      root.querySelectorAll('img[data-blob]').forEach((img) => {
        const q = byId.get(img.dataset.blob);
        if (q?.photo instanceof Blob) {
          const u = URL.createObjectURL(q.photo);
          urls.push(u);
          img.src = u;
        }
      });
      const blankForm = root.querySelector('[data-blank-form]');
      const blankOpen = root.querySelector('[data-blank-open]');
      const toggleBlank = (show) => {
        blankForm.hidden = !show;
        blankOpen.setAttribute('aria-expanded', String(show));
        if (show) blankForm.hours.focus();
      };
      blankOpen.addEventListener('click', () => toggleBlank(blankForm.hidden));
      root.querySelector('[data-blank-cancel]').addEventListener('click', () => toggleBlank(false));
      blankForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const date = blankForm.trip_date.value;
        const hRaw = blankForm.hours.value.replace(',', '.').trim();
        const hours = hRaw ? Number(hRaw) : null;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { ctx.toast('Nurodyk datą'); return; }
        if (date > localDate()) { ctx.toast('Data negali būti ateityje'); return; }
        if (hours !== null && !(hours > 0 && hours <= 24)) { ctx.toast('Valandų: nuo 0,5 iki 24'); return; }
        const btn = blankForm.querySelector('[type=submit]');
        btn.disabled = true;
        let weather = null;
        if (date === localDate() && weatherEnabled()) {
          const pos = await quickPosition();
          if (pos) weather = await fetchWeather(pos.lat, pos.lng);
        }
        try {
          await backend.addBlankTrip({ trip_date: date, hours: hours ? Math.round(hours * 10) / 10 : null,
            notes: blankForm.notes.value.trim() || null, weather });
          ctx.toast('Išsaugota. Kitą kartą tikrai užkibs!');
          ctx.rerender();
        } catch (err) {
          btn.disabled = false;
          ctx.toast(err.message || 'Nepavyko išsaugoti');
        }
      });
      const listEl = root.querySelector('[data-diary-list]');
      const bindList = () => {
        hydratePhotos(listEl, backend);
        listEl.querySelectorAll('[data-trip-delete]').forEach((b) => b.addEventListener('click', async () => {
          await backend.deleteBlankTrip(b.dataset.tripDelete).catch(() => ctx.toast('Nepavyko ištrinti'));
          ctx.rerender();
        }));
        listEl.querySelectorAll('[data-fold]').forEach((b) => b.addEventListener('click', () => {
          opened.add(b.dataset.fold);
          redraw();
          listEl.querySelector(`[data-group^="${b.dataset.fold}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }));
        listEl.querySelector('[data-more]')?.addEventListener('click', () => { bigShown += BIG_PAGE; redraw(); });
        listEl.querySelectorAll('[data-dispute]').forEach((b) => b.addEventListener('click', () => {
          b.hidden = true;
          const f = listEl.querySelector(`[data-dispute-form="${b.dataset.dispute}"]`);
          f.hidden = false;
          f.message.focus();
        }));
        listEl.querySelectorAll('[data-dispute-form]').forEach((f) => f.addEventListener('submit', async (e) => {
          e.preventDefault();
          const message = f.message.value.trim();
          if (message.length < 3) { ctx.toast('Parašyk bent kelis žodžius'); return; }
          f.querySelector('button').disabled = true;
          try {
            await backend.openDispute(f.dataset.disputeForm, message);
            ctx.toast('Ginčas pateiktas moderatoriui');
            ctx.rerender();
          } catch (err) {
            f.querySelector('button').disabled = false;
            ctx.toast(err.message || 'Nepavyko pateikti');
          }
        }));
      };
      const redraw = () => { listEl.innerHTML = String(html`${listHtml()}`); bindList(); };
      bindList();
      root.querySelector('[data-filter-sp]')?.addEventListener('change', (e) => {
        filterSp = e.target.value;
        sessionStorage.setItem('zt-diary-sp', filterSp);
        bigShown = BIG_PAGE;
        redraw();
      });
      root.querySelector('[data-sort]')?.addEventListener('change', (e) => {
        sortBy = e.target.value;
        sessionStorage.setItem('zt-diary-sort', sortBy);
        bigShown = BIG_PAGE;
        redraw();
      });
      root.querySelectorAll('[data-dismiss]').forEach((b) => b.addEventListener('click', async () => {
        await ctx.outbox.dismiss(b.dataset.dismiss);
        ctx.rerender();
      }));
      root.querySelector('[data-sync]')?.addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        await ctx.flush();
        // Tikrinam pačią eilę, ne ctx.state – jis atnaujinamas asinchroniškai ir gali būti pasenęs.
        if (await ctx.outbox.pendingCount()) ctx.toast(navigator.onLine ? 'Nepavyko išsiųsti – bandysime vėliau' : 'Nėra ryšio');
        ctx.rerender();
      });
      ctx.onSynced = () => ctx.rerender();
      return () => {
        urls.forEach((u) => URL.revokeObjectURL(u));
        ctx.onSynced = null;
      };
    }
  };
}
