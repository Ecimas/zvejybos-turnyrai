import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { cm, dateTime, count, longDate, plural } from '../lib/format.js';
import { statusChip, thumb, hydratePhotos, empty, loginPrompt } from '../ui.js';
import { feat } from '../lib/clubs.js';
import { weatherLine, fetchWeather } from '../lib/weather.js';
import { recordIds } from '../lib/records.js';
import { weatherEnabled } from './capture.js';
import { checkBanners } from './check.js';
import { shortDate } from '../lib/format.js';
import { computeBadges } from '../lib/badges.js';
import { colorFor } from '../lib/map.js';
import {
  seasonStats, speciesCollection, daypartStats, baitStats, weatherRanges, fishingDays, goalProgress, goalTitle, GOAL_KINDS,
  biteForecast, windDir, dayKey
} from '../lib/insights.js';
import { savedLocation, saveLocation, forgetLocation, getForecast } from '../lib/forecast.js';
import { WEATHER_LT } from '../lib/weather.js';

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
  if (trips) parts.push(count(trips, 'išvyka', 'išvykos', 'išvykų'));
  return parts.join(' · ');
}

const DTABS = [['laimikiai', 'Laimikiai', 'fish'], ['kolekcija', 'Kolekcija', 'trophy'], ['izvalgos', 'Įžvalgos', 'bars'], ['tikslai', 'Tikslai', 'star']];
const DAYPART_IN = { morning: 'Ryte', day: 'Dieną', evening: 'Vakare', night: 'Naktį' };
const DAYPART_OFTEN = { morning: 'ryte', day: 'dieną', evening: 'vakare', night: 'naktį' };
const num = (x) => String(x).replace('.', ',');
const hh = (h) => `${h}`;

export async function diaryView(ctx, params, query) {
  const { backend, state } = ctx;
  if (!state.user) {
    return { nav: 'dienorastis', title: 'Dienoraštis', html: html`<div class="screen"><h1 class="display-lg" tabindex="-1">Dienoraštis</h1>${loginPrompt('Prisijunk, kad matytum savo laimikius.')}</div>` };
  }
  const [queued, catches, disputes, trips, checks, goals, tcount] = await Promise.all([
    ctx.outbox.list(), backend.myCatches(), backend.myDisputes().catch(() => []), backend.blankTrips().catch(() => []),
    backend.myChecks ? backend.myChecks().catch(() => []) : [],
    backend.myGoals ? backend.myGoals().catch(() => []) : [],
    backend.userTournamentCount ? backend.userTournamentCount(state.user.id).catch(() => 0) : 0
  ]);
  const wanted = query?.get?.('skiltis');
  let saved = null;
  try { saved = sessionStorage.getItem('zt-dtab'); } catch { /* nėra */ }
  const tab = DTABS.some(([k]) => k === wanted) ? wanted : DTABS.some(([k]) => k === saved) ? saved : 'laimikiai';
  const season = seasonStats(catches, trips);
  const fishOnDay = new Map();
  catches.filter((c) => c.status !== 'rejected').forEach((c) => { const k = dayKey(c.captured_at_device); fishOnDay.set(k, (fishOnDay.get(k) || 0) + 1); });
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

  // Išvyka: jei tą dieną pagauta žuvų – jos priskiriamos išvykai, kitaip – „Nieko nekibo“.
  const tripRow = (b) => {
    const n = fishOnDay.get(b.trip_date) || 0;
    return html`<div class="d-item trip-card ${n ? 'trip-ok' : ''}" data-trip="${b.id}"><div class="d-row">
      <span class="d-trip" aria-hidden="true">${icon(n ? 'pin' : 'minus', 22, 2.4)}</span>
      <span class="grow stack-1">
        <span class="d-sp">${n ? `Išvyka${b.place ? `: ${b.place}` : ''}` : `Nieko nekibo${b.place ? ` · ${b.place}` : ''}`}${b.hours ? ` · ${hoursText(b.hours)}` : ''}</span>
        <span class="d-meta">${longDate(`${b.trip_date}T12:00:00`)}${n ? ` · ${count(n, 'laimikis', 'laimikiai', 'laimikių')}` : ''}${b.weather ? ` · ${weatherLine(b.weather)}` : ''}</span>
        ${b.notes ? html`<span class="small">„${b.notes}“</span>` : ''}
      </span>
      <button class="icon-btn small-btn" data-trip-delete="${b.id}" aria-label="Ištrinti išvyką">${icon('x', 16, 2.4)}</button>
    </div></div>`;
  };

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

  // ---------------------------------------------------------------- Kolekcija
  const collectionHtml = () => {
    const col = speciesCollection(catches, state.species);
    const badges = computeBadges(catches, Number(tcount) || 0);
    const nextSp = badges.find((b) => !b.earned && (b.key === 'species5' || b.key === 'species10'));
    return html`<section class="card stack-2" data-collection>
        <div class="row-between"><h2 class="h2">Rūšių kolekcija</h2><b class="accent-ink">${col.caught} / ${col.total}</b></div>
        <div class="pbar" role="progressbar" aria-label="Pagautos rūšys" aria-valuemin="0" aria-valuemax="${col.total}" aria-valuenow="${col.caught}"><i style="width:${Math.round((col.caught / Math.max(1, col.total)) * 100)}%"></i></div>
        <span class="small muted">${nextSp ? `Kitas ženklelis – „${nextSp.name}“ (${nextSp.desc.toLowerCase()})` : col.caught ? 'Pagauk visas rūšis – tikras žvejas!' : 'Kiekviena nauja rūšis atsiras čia.'}</span>
      </section>
      <div class="alb" data-album>${col.items.map(({ species: sp1, best }) => (best
        ? html`<a class="alb-t" href="#/l/${best.id}" data-album-sp="${sp1.id}"><span class="alb-ic" style="background:${colorFor(sp1.id)}33;color:${colorFor(sp1.id)}">${icon('fish', 24)}</span>
            <b>${sp1.name_lt}</b><small>${cm(best.length_mm)} · ${shortDate(best.captured_at_device)}</small></a>`
        : html`<div class="alb-t alb-lk" data-album-sp="${sp1.id}"><span class="alb-ic">${icon('lock', 20)}</span><b>${sp1.name_lt}</b><small>dar nepagauta</small></div>`))}</div>
      <section class="card stack-2"><h2 class="h2">Ženkleliai</h2>
        <div class="row gap-8 wrap" data-diary-badges>${badges.map((b) => html`<span class="chip ${b.earned ? 'chip-ok' : 'chip-off'}" title="${b.desc}">${b.earned ? icon('check', 14, 2.6) : ''}${b.name}</span>`)}</div>
      </section>`;
  };

  // ---------------------------------------------------------------- Įžvalgos
  const insightsHtml = () => {
    const dp = daypartStats(catches);
    const baits = baitStats(catches);
    const wr = weatherRanges(catches);
    const days = fishingDays(catches, trips);
    const max = Math.max(1, ...dp.rows.map((r) => r.count));
    const enough = dp.total >= 3;
    return html`${enough ? html`<section class="card stack-2" data-insight="daypart"><h2 class="h2">Kada tau kimba</h2>
        <div class="bars" aria-hidden="true">${dp.rows.map((r) => html`<div><i class="${dp.top && r.key === dp.top.key ? '' : 'lo'}" style="height:${Math.max(6, Math.round((r.count / max) * 96))}px"></i><span>${r.label}</span><b>${r.count}</b></div>`)}</div>
        <p class="small">${DAYPART_IN[dp.top.key]} pagauta <b>${Math.round(dp.top.share * 100)} %</b> visų tavo žuvų.</p></section>`
      : html`<section class="card stack-2" data-insight="empty"><h2 class="h2">Įžvalgos ruošiamos</h2>
        <p class="small muted">Kai užregistruosi bent 3 laimikius, čia matysi, kada tau geriausiai kimba, kokie masalai veikia ir kokiu oru sekasi.</p></section>`}
      <section class="card stack-2" data-insight="baits"><h2 class="h2">Geriausi masalai</h2>
        ${baits.length ? baits.map((b) => html`<div class="row-between gap-8"><span class="min0"><b>${b.bait}</b> <span class="small muted">· ${b.species.map((id) => sp(id).toLowerCase()).join(', ')}</span></span>
          <span class="small nowrap"><b>${b.count}</b> ${plural(b.count, 'žuvis', 'žuvys', 'žuvų')} · vid. ${cm(b.avgMm)}</span></div>`)
          : html`<p class="small muted">Prie laimikio įrašyk masalą (atidaryk laimikį → „Masalas ir pastabos“) – čia matysi, kas veikia geriausiai.</p>`}
      </section>
      <section class="card stack-2" data-insight="weather"><h2 class="h2">Orai per laimikius</h2>
        ${wr ? html`<p class="small">Dažniausiai kibo, kai ${[wr.pressure ? html`<b>slėgis ${wr.pressure[0]}–${wr.pressure[1]} hPa</b>` : '', wr.windMax ? html`vėjas <b>iki ${wr.windMax} m/s</b>` : '', wr.temp ? html`oras <b>${wr.temp[0]}–${wr.temp[1]}°</b>` : ''].filter(Boolean).map((x, i, a) => html`${x}${i < a.length - 1 ? ', ' : '.'}`)}</p>`
          : html`<p class="small muted">Kai bent 3 laimikiai turės orų duomenis, pamatysi, kokiu oru tau sekasi geriausiai.</p>`}
      </section>
      <section class="card stack-2" data-insight="days"><div class="row-between"><h2 class="h2">Žvejybos dienos</h2><span class="small muted">12 sav.</span></div>
        <div class="hm" role="img" aria-label="Per 12 savaičių žvejota ${days.active} d.">${days.cells.map((c) => html`<i class="hm-${c.kind}${c.n > 1 ? ' hm-many' : ''}" title="${c.date}"></i>`)}</div>
        <p class="small muted"><span class="hm-key hm-catch"></span> su laimikiu <span class="hm-key hm-blank"></span> „nieko nekibo“ · Per 12 sav. – ${count(days.active, 'diena', 'dienos', 'dienų')}${days.streak > 1 ? `, ilgiausia serija – ${days.streak} d. iš eilės` : ''}</p>
      </section>`;
  };

  // ---------------------------------------------------------------- Tikslai
  const now = new Date();
  const goalRows = goals.map((g) => ({ g, p: goalProgress(g, catches, trips, now, sp) }));
  const goalsHtml = () => html`${goalRows.length ? html`<div class="stack-2" data-goals>${goalRows.map(({ g, p }) => {
      const left = g.period === 'month' ? Math.ceil((new Date(now.getFullYear(), now.getMonth() + 1, 1) - now) / 864e5) : null;
      return html`<section class="card goal ${p.done ? 'goal-done' : ''}" data-goal="${g.id}">
        <div class="row-between gap-8"><b class="min0">${goalTitle(g, sp, now)}</b>
          ${p.done ? html`<span class="chip chip-ok">Pasiekta ${icon('check', 14, 2.6)}</span>` : left !== null ? html`<span class="small muted nowrap">liko ${left} d.</span>` : ''}</div>
        <div class="pbar" role="progressbar" aria-label="${goalTitle(g, sp, now)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p.pct * 100)}"><i style="width:${Math.round(p.pct * 100)}%"></i></div>
        <div class="row-between gap-8"><span class="small muted">${p.done && g.kind !== 'new_species' ? `Pasiekta ${shortDate(p.doneAt)}` : p.detail}</span>
          <button type="button" class="btn-text small" data-goal-del="${g.id}" aria-label="Ištrinti tikslą „${goalTitle(g, sp, now)}“">Ištrinti</button></div>
      </section>`;
    })}</div>` : html`<p class="small muted" data-goals-empty>Išsikelk tikslą – pvz. lydeka nuo 80 cm šį sezoną ar 10 laimikių per mėnesį. Pažanga skaičiuojama automatiškai.</p>`}
    ${goals.length < 12 ? html`<section class="card stack-2" data-goal-new><h2 class="h2">Naujas tikslas</h2>
      <div class="row gap-8 wrap">${GOAL_KINDS.map(([k, label]) => html`<button type="button" class="chipx" data-goal-kind="${k}">+ ${label}</button>`)}</div>
      <form class="stack-2" data-goal-form hidden></form>
    </section>` : ''}`;

  // ---------------------------------------------------------------- Šiandien prie vandens
  const showForecast = feat(state, 'weather');
  const loc = showForecast ? savedLocation() : null;
  const forecastShell = () => (!showForecast ? '' : !loc
    ? html`<section class="fc fc-empty" data-forecast><div class="stack-1"><span class="fc-kicker">Šiandien prie vandens</span>
        <span class="strong">Kibimo prognozė tavo vietoje</span><span class="small muted">Orai, slėgis, vėjas, mėnulis ir geriausias laikas žvejoti.</span></div>
        <button type="button" class="btn btn-primary" data-fc-locate>${icon('pin', 18)}Rodyti prognozę</button></section>`
    : html`<section class="fc" data-forecast aria-live="polite"><p class="small muted">Įkeliama prognozė…</p></section>`);
  const personal = (() => { const d = daypartStats(catches); return d.total >= 3 ? d.top : null; })();
  const forecastBody = (res) => {
    if (!res) return html`<span class="fc-kicker">Šiandien prie vandens</span><p class="small">Prognozės nepavyko gauti – patikrink ryšį.</p>
      <div class="row gap-8"><button type="button" class="btn btn-ghost" data-fc-retry>${icon('refresh', 18)}Bandyti dar</button><button type="button" class="btn-text small" data-fc-forget>Keisti vietą</button></div>`;
    const f = biteForecast(res.data, new Date(), personal);
    if (!f) return html`<p class="small">Prognozės dar nėra.</p>`;
    const trend = f.trend < -1.5 ? '↘' : f.trend > 1.5 ? '↗' : '→';
    const wx = WEATHER_LT[f.now.code] || '';
    const upd = new Intl.DateTimeFormat('lt-LT', { hour: '2-digit', minute: '2-digit' }).format(new Date(res.at));
    return html`<div class="fc-top"><div class="fc-ring" style="--p:${f.score * 10}%" aria-hidden="true"><b>${f.score}</b></div>
        <div class="stack-1 min0"><span class="fc-kicker">Šiandien prie vandens</span><span class="h2" data-fc-label>Kibimas – ${f.label}</span>
          <span class="small">Geriausias laikas: ${f.windows.map(([a, b], i) => html`${i ? ' ir ' : ''}<b>${hh(a)}–${hh(b)} val.</b>`)}</span></div></div>
      <div class="fc-grid">
        <span>${icon('sun', 18)}<b>${Math.round(f.now.temp)}°</b>${wx.toLowerCase() || 'oras'}</span>
        <span>${icon('bars', 18)}<b>${Math.round(f.now.pressure)}</b>slėgis ${trend}</span>
        <span>${icon('share', 18)}<b>${num(Math.round(f.now.wind * 10) / 10)} m/s</b>${windDir(f.now.dir)} vėjas</span>
        <span><span class="fc-moon" aria-hidden="true">${f.moon.emoji}</span><b class="sr-only">Mėnulis:</b>${f.moon.name}</span>
      </div>
      <p class="small muted">Orientacinė: pagal orų prognozę${personal ? ` ir tavo laimikius (tau dažniausiai kimba ${DAYPART_OFTEN[personal.key]})` : ''}.</p>
      <div class="row-between fc-foot"><span class="small muted">Atnaujinta ${upd}${res.cached && Date.now() - res.at > 3600e3 ? ' (be ryšio)' : ''}</span>
        <button type="button" class="btn-text small" data-fc-forget>Keisti vietą</button></div>`;
  };

  const tabsHtml = html`<nav class="t-tabs d-tabs" role="tablist" aria-label="Dienoraščio skiltys">${DTABS.map(([k, label, ic]) => html`<button type="button" role="tab" id="dt-${k}" aria-controls="dp-${k}" aria-selected="${k === tab}" data-dtab="${k}">
      <span class="t-tab-ic">${icon(ic, 20)}</span><span class="t-tab-l">${label}</span></button>`)}</nav>`;

  return {
    nav: 'dienorastis',
    title: 'Dienoraštis',
    html: html`<div class="screen">
      <header class="page-head d-head">
        <h1 class="display-lg" tabindex="-1">Dienoraštis</h1>
        <button class="d-btn" data-blank-open aria-expanded="false" aria-label="Išvyka – įrašyti žvejybos išvyką" ${feat(ctx.state, 'blank_trips') ? '' : 'hidden'}>${icon('plus', 16, 2.6)}Išvyka</button>
      </header>
      ${checkBanners(checks)}

      <form class="card stack" data-blank-form hidden>
        <p class="strong">Žvejybos išvyka</p>
        <p class="small muted">Tos dienos laimikiai priskiriami išvykai automatiškai. Nieko nepagavai? Vis tiek įrašyk – įžvalgos parodys, kada geriau sekasi. Šių įrašų niekas kitas nemato.</p>
        <label class="field"><span class="small muted strong">Vieta (nebūtina)</span>
          <input name="place" maxlength="60" autocomplete="off" placeholder="pvz. Kauno marios"></label>
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

      ${forecastShell()}

      ${catches.length || queued.length || trips.length ? html`<section class="d-stats" aria-label="${season.year} sezonas">
        <div class="d-stat" data-stat="count"><b>${season.count}</b><span>${plural(season.count, 'laimikis', 'laimikiai', 'laimikių')} ${season.year}</span></div>
        <div class="d-stat" data-stat="days"><b>${season.days}</b><span>${plural(season.days, 'žvejybos diena', 'žvejybos dienos', 'žvejybos dienų')}</span></div>
        <div class="d-stat" data-stat="biggest"><b class="accent">${season.biggest ? cm(season.biggest.length_mm) : biggest ? cm(biggest.length_mm) : '–'}</b><span>didžiausia${season.biggest ? ` · ${sp(season.biggest.species_id).toLowerCase()}` : biggest ? ' (visų laikų)' : ''}</span></div>
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

      ${tabsHtml}

      <div class="stack" role="tabpanel" id="dp-laimikiai" aria-labelledby="dt-laimikiai" data-dpanel="laimikiai" ${tab === 'laimikiai' ? '' : 'hidden'}>
      ${catches.length > 3 ? html`<div class="d-tools">
        <label class="d-sel"><span class="sr-only">Rūšis</span><select data-filter-sp aria-label="Rūšis">
          <option value="">Visos rūšys</option>${speciesHere.map((x) => html`<option value="${x.id}" ${String(x.id) === filterSp ? 'selected' : ''}>${x.name}</option>`)}
        </select></label>
        <label class="d-sel"><span class="sr-only">Rikiavimas</span><select data-sort aria-label="Rikiavimas">
          <option value="new" ${sortBy === 'new' ? 'selected' : ''}>Naujausi</option><option value="big" ${sortBy === 'big' ? 'selected' : ''}>Didžiausi</option>
        </select></label>
      </div>` : ''}

      <div class="stack" data-diary-list>${listHtml()}</div>
      </div>
      <div class="stack" role="tabpanel" id="dp-kolekcija" aria-labelledby="dt-kolekcija" data-dpanel="kolekcija" ${tab === 'kolekcija' ? '' : 'hidden'}>${collectionHtml()}</div>
      <div class="stack" role="tabpanel" id="dp-izvalgos" aria-labelledby="dt-izvalgos" data-dpanel="izvalgos" ${tab === 'izvalgos' ? '' : 'hidden'}>${insightsHtml()}</div>
      <div class="stack" role="tabpanel" id="dp-tikslai" aria-labelledby="dt-tikslai" data-dpanel="tikslai" ${tab === 'tikslai' ? '' : 'hidden'}>${goalsHtml()}</div>
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
        if (show) blankForm.place.focus();
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
          const place = blankForm.place.value.trim();
          await backend.addBlankTrip({ trip_date: date, hours: hours ? Math.round(hours * 10) / 10 : null,
            notes: blankForm.notes.value.trim() || null, weather, ...(place ? { place } : {}) });
          ctx.toast(fishOnDay.get(date) ? 'Išvyka išsaugota' : 'Išsaugota. Kitą kartą tikrai užkibs!');
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
      // --- Skiltys ---
      const setTab = (k) => {
        root.querySelectorAll('[data-dtab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.dtab === k)));
        root.querySelectorAll('[data-dpanel]').forEach((p) => { p.hidden = p.dataset.dpanel !== k; });
        try { sessionStorage.setItem('zt-dtab', k); } catch { /* */ }
        history.replaceState(null, '', `#/dienorastis${k === 'laimikiai' ? '' : `?skiltis=${k}`}`);
      };
      root.querySelectorAll('[data-dtab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.dtab)));

      // --- Prognozė ---
      const fc = root.querySelector('[data-forecast]');
      const loadForecast = async () => {
        const l = savedLocation();
        if (!fc || !l) return;
        const res = await getForecast(l.lat, l.lng);
        if (!fc.isConnected) return;
        fc.classList.remove('fc-empty');
        fc.innerHTML = String(forecastBody(res));
        bindForecast();
      };
      const bindForecast = () => {
        fc?.querySelector('[data-fc-retry]')?.addEventListener('click', loadForecast);
        fc?.querySelector('[data-fc-forget]')?.addEventListener('click', () => { forgetLocation(); ctx.rerender(); });
        fc?.querySelector('[data-fc-locate]')?.addEventListener('click', async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          const pos = await quickPosition();
          if (!pos) { btn.disabled = false; ctx.toast('Nepavyko nustatyti vietos – leisk ją naršyklės nustatymuose'); return; }
          saveLocation(pos.lat, pos.lng);
          fc.innerHTML = String(html`<p class="small muted">Įkeliama prognozė…</p>`);
          loadForecast();
        });
      };
      bindForecast();
      loadForecast();

      // --- Tikslai ---
      const goalForm = root.querySelector('[data-goal-form]');
      const periodSeg = (opts, def) => html`<div class="seg" role="group" aria-label="Laikotarpis">${opts.map(([v, l]) => html`<button type="button" data-goal-period="${v}" aria-pressed="${v === def}">${l}</button>`)}</div>`;
      const GOAL_FORM = {
        length: () => html`<label class="field"><span class="small muted strong">Rūšis</span><select name="species_id"><option value="">Bet kuri</option>${state.species.map((x) => html`<option value="${x.id}">${x.name_lt}</option>`)}</select></label>
          <label class="field"><span class="small muted strong">Ilgis nuo, cm</span><input name="target" inputmode="numeric" value="80"></label>${periodSeg([['season', 'Šį sezoną'], ['ever', 'Visada']], 'season')}`,
        count: () => html`<label class="field"><span class="small muted strong">Kiek laimikių</span><input name="target" inputmode="numeric" value="10"></label>${periodSeg([['month', 'Šį mėnesį'], ['season', 'Šį sezoną']], 'month')}`,
        species: () => html`<label class="field"><span class="small muted strong">Kiek skirtingų rūšių</span><input name="target" inputmode="numeric" value="5"></label>${periodSeg([['season', 'Šį sezoną'], ['ever', 'Visada']], 'season')}`,
        days: () => html`<label class="field"><span class="small muted strong">Kiek žvejybos dienų</span><input name="target" inputmode="numeric" value="8"></label>${periodSeg([['month', 'Šį mėnesį'], ['season', 'Šį sezoną']], 'month')}`,
        new_species: () => html`<p class="small muted">Tikslas pasiekiamas, kai pagausi rūšį, kurios dar nesi gaudęs.</p>`
      };
      let goalKind = null;
      let goalPeriod = null;
      root.querySelectorAll('[data-goal-kind]').forEach((b) => b.addEventListener('click', () => {
        goalKind = b.dataset.goalKind;
        root.querySelectorAll('[data-goal-kind]').forEach((x) => x.classList.toggle('on', x === b));
        goalForm.hidden = false;
        goalForm.innerHTML = String(html`${GOAL_FORM[goalKind]()}<div class="row gap-8"><button class="btn btn-primary grow" type="submit">Išsaugoti tikslą</button><button class="btn" type="button" data-goal-cancel>Atšaukti</button></div>`);
        goalPeriod = goalForm.querySelector('[data-goal-period][aria-pressed="true"]')?.dataset.goalPeriod || 'ever';
        goalForm.querySelectorAll('[data-goal-period]').forEach((x) => x.addEventListener('click', () => {
          goalPeriod = x.dataset.goalPeriod;
          goalForm.querySelectorAll('[data-goal-period]').forEach((y) => y.setAttribute('aria-pressed', String(y === x)));
        }));
        goalForm.querySelector('[data-goal-cancel]').addEventListener('click', () => { goalForm.hidden = true; goalForm.innerHTML = ''; });
        goalForm.querySelector('input,select')?.focus();
      }));
      goalForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const target = goalKind === 'new_species' ? 1 : Number(String(goalForm.target?.value || '').trim());
        if (!Number.isInteger(target) || target < 1) { ctx.toast('Įrašyk sveiką skaičių'); return; }
        const btn = goalForm.querySelector('[type=submit]');
        btn.disabled = true;
        try {
          await backend.addGoal({ kind: goalKind, species_id: goalForm.species_id?.value ? Number(goalForm.species_id.value) : null, target,
            period: goalKind === 'new_species' ? 'ever' : goalPeriod });
          ctx.toast('Tikslas išsaugotas');
          ctx.rerender();
        } catch (err) {
          btn.disabled = false;
          ctx.toast(err.message || 'Nepavyko išsaugoti');
        }
      });
      root.querySelectorAll('[data-goal-del]').forEach((b) => b.addEventListener('click', async () => {
        try { await backend.deleteGoal(b.dataset.goalDel); ctx.toast('Tikslas ištrintas'); ctx.rerender(); } catch (err) { ctx.toast(err.message || 'Nepavyko ištrinti'); }
      }));
      // Naujai pasiektas tikslas – pasveikinam vieną kartą.
      try {
        const seen = new Set(JSON.parse(localStorage.getItem('zt-goals-seen') || '[]'));
        const fresh = goalRows.filter(({ g, p }) => p.done && !seen.has(g.id));
        if (fresh.length) {
          ctx.toast(`Tikslas pasiektas: ${goalTitle(fresh[0].g, sp, now)}!`);
          fresh.forEach(({ g }) => seen.add(g.id));
          localStorage.setItem('zt-goals-seen', JSON.stringify([...seen]));
        }
      } catch { /* nėra saugyklos */ }

      ctx.onSynced = () => ctx.rerender();
      return () => {
        urls.forEach((u) => URL.revokeObjectURL(u));
        ctx.onSynced = null;
      };
    }
  };
}
