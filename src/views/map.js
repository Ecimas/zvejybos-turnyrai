// Mano laimikių žemėlapis (#/zemelapis): matai tik tu.
// Vektorinis žemėlapis (MapLibre + OpenFreeMap): burbulai, „šiluma“, laimikio kortelė, geriausios vietos, sezono atkūrimas.
// Jei telefonas jo nepalaiko ar neįkelia – tas pats ekranas su Leaflet (be „šilumos“).
import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { cm, shortDate, count, dateTime, longDate } from '../lib/format.js';
import { backButton, loginPrompt, empty, thumb, hydratePhotos } from '../ui.js';
import { weatherLine } from '../lib/weather.js';
import { feat } from '../lib/clubs.js';
import {
  loadLeaflet, TILES, CARTO_DARK, CARTO_LIGHT, colorFor, groupSpots, loadMapLibre, STYLE_DARK, STYLE_LIGHT, LT_CENTER,
  DAYPARTS, daypartOf, daypartLabel, inPeriod, bestSpots, toGeoJSON, spotsGeoJSON
} from '../lib/map.js';

const kg = (g) => `${String(Math.round(g / 10) / 100).replace('.', ',')} kg`;

// ---------------------------------------------------------------- Varikliai
async function maplibreEngine(box, { onPick }) {
  const ml = await loadMapLibre();
  const light = document.documentElement.dataset.theme === 'light';
  // Stilių parsisiunčiam patys – jei nepavyks, aiškiai žinosim, kad kalta būtent ši užklausa.
  const styleUrl = light ? STYLE_LIGHT : STYLE_DARK;
  let style;
  try {
    const r = await fetch(styleUrl, { mode: 'cors', credentials: 'omit' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    style = await r.json();
  } catch (e) {
    throw new Error(`stilius: ${e?.message || e}`);
  }
  // Pirmos nepavykusios užklausos adresas – kad būtų aišku, ko trūksta.
  const realFetch = window.fetch;
  let failedUrl = '';
  window.fetch = function (input, init) {
    return realFetch.call(this, input, init).catch((err) => {
      if (!failedUrl) failedUrl = String(input?.url || input).slice(0, 90);
      throw err;
    });
  };
  const restoreFetch = () => { if (window.fetch !== realFetch) window.fetch = realFetch; };
  setTimeout(restoreFetch, 25000);
  const map = new ml.Map({
    container: box,
    style,
    center: LT_CENTER,
    zoom: 6,
    attributionControl: { compact: true },
    fadeDuration: 200
  });
  // Stilius turi įsikelti per 12 s – kitaip pereinam prie atsarginio žemėlapio.
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('style timeout')), 20000);
    // Užtenka įsikėlusio stiliaus – plytelės gali krautis toliau.
    const done = () => { clearTimeout(t); resolve(); };
    map.once('style.load', done);
    map.once('load', done);
    // Atskirų plytelių ar šriftų klaidos žemėlapio nesugadina – atsisakom tik jei neįsikelia pats stilius.
    map.on('error', (e) => {
      if (!e?.sourceId && !e?.tile && !map.isStyleLoaded() && !map.loaded()) {
        clearTimeout(t);
        const m = e?.error?.message || 'style error';
        reject(new Error(failedUrl ? `${m}: ${failedUrl}` : m));
      }
    });
  }).catch((e) => { restoreFetch(); map.remove(); throw e; });
  restoreFetch();

  const empty = toGeoJSON([]);
  // Burbulai: kiek laimikių – suma per visas sugrupuotas vietas.
  map.addSource('catches', { type: 'geojson', data: empty, cluster: true, clusterRadius: 48, clusterMaxZoom: 14,
    clusterProperties: { total: ['+', ['get', 'count']] } });
  map.addSource('heat', { type: 'geojson', data: empty });
  map.addLayer({
    id: 'heat', type: 'heatmap', source: 'heat', layout: { visibility: 'none' },
    paint: {
      'heatmap-weight': ['interpolate', ['linear'], ['get', 'len'], 200, 0.5, 900, 1],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 5, 0.8, 14, 2.2],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 5, 14, 14, 40],
      'heatmap-opacity': 0.85,
      'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
        0, 'rgba(255,213,79,0)', 0.25, 'rgba(255,213,79,0.45)', 0.5, 'rgba(255,166,43,0.75)', 0.8, 'rgba(255,110,40,0.9)', 1, 'rgba(255,72,30,1)']
    }
  });
  map.addLayer({
    id: 'clusters', type: 'circle', source: 'catches', filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#FFA62B',
      'circle-radius': ['step', ['get', 'total'], 18, 5, 22, 15, 28, 40, 34],
      'circle-stroke-width': 5,
      'circle-stroke-color': 'rgba(255,166,43,0.28)',
      'circle-radius-transition': { duration: 400 }
    }
  });
  map.addLayer({
    id: 'cluster-count', type: 'symbol', source: 'catches', filter: ['has', 'point_count'],
    layout: { 'text-field': ['to-string', ['get', 'total']], 'text-font': ['Noto Sans Bold'], 'text-size': 14, 'text-allow-overlap': true },
    paint: { 'text-color': '#1A1206' }
  });
  map.addLayer({
    id: 'points', type: 'circle', source: 'catches', filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': ['case', ['>', ['get', 'count'], 1], ['interpolate', ['linear'], ['zoom'], 6, 12, 14, 15],
        ['interpolate', ['linear'], ['zoom'], 6, 6, 14, 9]],
      'circle-stroke-width': 2.5,
      'circle-stroke-color': light ? '#ffffff' : '#0A1822'
    }
  });
  map.addLayer({
    id: 'point-count', type: 'symbol', source: 'catches', filter: ['all', ['!', ['has', 'point_count']], ['>', ['get', 'count'], 1]],
    layout: { 'text-field': ['to-string', ['get', 'count']], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-allow-overlap': true },
    paint: { 'text-color': '#0A1822' }
  });

  const layers = ['clusters', 'points'];
  map.on('click', 'clusters', async (e) => {
    const f = e.features?.[0];
    if (!f) return;
    try {
      const zoom = await map.getSource('catches').getClusterExpansionZoom(f.properties.cluster_id);
      map.easeTo({ center: f.geometry.coordinates, zoom, duration: 600 });
    } catch { map.easeTo({ center: f.geometry.coordinates, zoom: map.getZoom() + 2, duration: 600 }); }
  });
  map.on('click', 'points', (e) => {
    const f = e.features?.[0];
    if (f) onPick(f.properties.id);
  });
  layers.forEach((l) => {
    map.on('mouseenter', l, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', l, () => { map.getCanvas().style.cursor = ''; });
  });

  let pulse = null;
  let me = null;
  const marker = (cls, lng, lat) => {
    const el = document.createElement('span');
    el.className = cls;
    return new ml.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
  };
  return {
    kind: 'maplibre',
    heat: true,
    setPoints(points) {
      map.getSource('catches').setData(spotsGeoJSON(points));
      map.getSource('heat').setData(toGeoJSON(points));
    },
    setMode(mode) {
      const heat = mode === 'heat';
      map.setLayoutProperty('heat', 'visibility', heat ? 'visible' : 'none');
      ['clusters', 'cluster-count', 'points', 'point-count'].forEach((l) => map.setLayoutProperty(l, 'visibility', heat ? 'none' : 'visible'));
    },
    fit(points, animate = true) {
      if (!points.length) return;
      if (points.length === 1) { map.flyTo({ center: [points[0].lng, points[0].lat], zoom: 13, duration: animate ? 1600 : 0 }); return; }
      const lngs = points.map((p) => p.lng);
      const lats = points.map((p) => p.lat);
      map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
        { padding: { top: 150, bottom: 200, left: 40, right: 60 }, maxZoom: 14, duration: animate ? 1800 : 0 });
    },
    flyTo(lat, lng, zoom = 14) { map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), zoom), duration: 1400, essential: true }); },
    highlight(lat, lng) {
      pulse?.remove();
      pulse = lat === null ? null : marker('mp-pulse', lng, lat);
    },
    showMe(lat, lng) {
      me?.remove();
      me = marker('mp-me', lng, lat);
    },
    resize() { map.resize(); },
    destroy() { map.remove(); }
  };
}

async function leafletEngine(box, { onPick }) {
  const L = await loadLeaflet();
  box.innerHTML = '';
  const map = L.map(box, { zoomControl: false, attributionControl: true });
  // OpenStreetMap plytelės; jei jos neįsikelia (blokuoja ar nepasiekiamos) – CARTO plytelės.
  const osm = L.tileLayer(TILES, { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(map);
  let ok = 0;
  let bad = 0;
  osm.on?.('tileload', () => { ok += 1; });
  osm.on?.('tileerror', () => {
    bad += 1;
    if (bad === 4 && ok === 0) {
      map.removeLayer?.(osm);
      const light = document.documentElement.dataset.theme === 'light';
      L.tileLayer(light ? CARTO_LIGHT : CARTO_DARK, { maxZoom: 19, subdomains: 'abcd', attribution: '© OpenStreetMap, © CARTO' }).addTo(map);
    }
  });
  requestAnimationFrame(() => map.invalidateSize?.());
  const layer = L.layerGroup().addTo(map);
  let extra = null;
  let me = null;
  return {
    kind: 'leaflet',
    heat: false,
    setPoints(points) {
      layer.clearLayers();
      for (const g of groupSpots(points)) {
        const best = g.items.slice().sort((a, b) => b.length_mm - a.length_mm)[0];
        // Kelios žuvys vienoje vietoje – burbulas su skaičiumi.
        const m = g.items.length > 1 && L.divIcon && L.marker
          ? L.marker([g.lat, g.lng], { icon: L.divIcon({ className: 'mp-lf-bubble', iconSize: [32, 32],
            html: `<span style="background:${colorFor(best.species_id)}">${g.items.length}</span>` }) })
          : L.circleMarker([g.lat, g.lng], { radius: 8, color: '#0A1822', weight: 2, fillColor: colorFor(best.species_id), fillOpacity: 0.95 });
        m.on?.('click', () => onPick(best.id));
        m.addTo(layer);
      }
    },
    setMode() {},
    fit(points) {
      if (points.length) map.fitBounds(points.map((p) => [p.lat, p.lng]), { padding: [40, 40], maxZoom: 14 });
    },
    flyTo(lat, lng, zoom = 14) { (map.flyTo || map.setView)?.call(map, [lat, lng], zoom); },
    highlight(lat, lng) {
      if (extra) layer.removeLayer?.(extra);
      extra = lat === null ? null : L.circleMarker([lat, lng], { radius: 20, color: '#FFA62B', weight: 3, fill: false }).addTo(layer);
    },
    showMe(lat, lng) {
      if (me) layer.removeLayer?.(me);
      me = L.circleMarker([lat, lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#4FC3F7', fillOpacity: 1 }).addTo(layer);
    },
    resize() { map.invalidateSize?.(); },
    destroy() { map.remove(); }
  };
}

// Pirmiausia vektorinis (jei įjungtas), nepavykus – Leaflet.
// Kodėl nepavyko vektorinis žemėlapis – rodoma po žemėlapiu, kad būtų lengva pataisyti.
export let mapFailReason = '';
export async function mapEngine(box, { onPick, state }) {
  mapFailReason = '';
  if (feat(state, 'map_vector')) {
    const csp = [];
    const onCsp = (e) => csp.push(`${e.violatedDirective} ${String(e.blockedURI || '').slice(0, 40)}`);
    document.addEventListener('securitypolicyviolation', onCsp);
    try {
      return await maplibreEngine(box, { onPick });
    } catch (err) {
      await new Promise((r) => setTimeout(r, 400)); // CSP pranešimai ateina šiek tiek vėliau
      mapFailReason = [String(err?.message || err?.type || err || 'klaida').slice(0, 140), ...csp.slice(0, 2)].join(' · ');
      box.innerHTML = '';
    } finally {
      document.removeEventListener('securitypolicyviolation', onCsp);
    }
  }
  return leafletEngine(box, { onPick });
}

// ---------------------------------------------------------------- Ekranas
export async function mapView(ctx) {
  const { backend, state } = ctx;
  if (!state.user) {
    return { nav: 'profilis', title: 'Mano žemėlapis', html: html`<div class="screen"><h1 class="display-lg" tabindex="-1">Mano žemėlapis</h1>${loginPrompt('Prisijunk, kad matytum savo laimikių žemėlapį.')}</div>` };
  }
  const [{ catches, keep }, mine] = await Promise.all([backend.myMap(), backend.myCatches().catch(() => [])]);
  const notes = new Map(mine.map((c) => [c.id, c]));
  const withLoc = catches.filter((c) => c.location && c.status !== 'rejected')
    .map((c) => ({ ...c, bait: c.bait ?? notes.get(c.id)?.bait ?? null, lat: c.location.lat, lng: c.location.lng }));
  const noLoc = catches.filter((c) => !c.location && c.status !== 'rejected').length;
  const sp = (id) => state.species.find((s) => s.id === id)?.name_lt ?? '';
  const speciesIds = [...new Set(withLoc.map((c) => c.species_id))];
  const years = [...new Set(withLoc.map((c) => new Date(c.captured_at_device).getFullYear()))].sort((a, b) => b - a);
  const byId = new Map(withLoc.map((c) => [c.id, c]));

  const chip = (attr, val, label, on, dot) => html`<button type="button" class="mp-chip" ${attr}="${val}" aria-pressed="${on}">${dot ? html`<i style="background:${dot}" aria-hidden="true"></i>` : ''}${label}</button>`;

  return {
    nav: 'profilis',
    title: 'Mano žemėlapis',
    html: html`<div class="screen">
      <header class="top-bar">${backButton('#/profilis')}<span class="muted strong">Mano žemėlapis</span><span></span></header>
      <h1 class="sr-only" tabindex="-1">Mano laimikių žemėlapis</h1>
      <p class="small muted">${icon('lock', 14)} Šį žemėlapį matai tik tu. ${count(withLoc.length, 'laimikis', 'laimikiai', 'laimikių')} su vieta${noLoc ? ` · ${noLoc} be vietos` : ''}.</p>
      ${withLoc.length ? html`
        <div class="mp-wrap" data-map-wrap>
          <div class="mp-canvas" data-map role="region" aria-label="Laimikių žemėlapis"><p class="small muted center mp-msg" data-map-msg>Įkeliamas žemėlapis…</p></div>
          <div class="mp-top">
            <div class="mp-chips" role="group" aria-label="Rūšys">
              ${chip('data-sp', 'all', 'Visos', true)}
              ${speciesIds.map((id) => chip('data-sp', id, sp(id), false, colorFor(id)))}
            </div>
            <div class="mp-chips">
              <label class="mp-chip mp-select">${icon('clock', 14)}<span class="sr-only">Laikotarpis</span><select data-period aria-label="Laikotarpis">
                <option value="all">Visas laikas</option><option value="30d">30 dienų</option>${years.map((y) => html`<option value="${y}">${y} m.</option>`)}
              </select></label>
              <label class="mp-chip mp-select"><span class="sr-only">Paros laikas</span><select data-daypart aria-label="Paros laikas">
                <option value="all">Visa para</option>${DAYPARTS.map(([k, label]) => html`<option value="${k}">${label}</option>`)}
              </select></label>
              <div class="mp-seg" role="group" aria-label="Rodymas" data-mode-seg hidden>
                <button type="button" data-mode="points" aria-pressed="true">Taškai</button><button type="button" data-mode="heat" aria-pressed="false">Šiluma</button>
              </div>
            </div>
          </div>
          <button type="button" class="mp-fab mp-fab-locate" data-locate aria-label="Rodyti, kur aš esu">${icon('pin', 20)}</button>
          <button type="button" class="mp-fab mp-fab-play" data-replay aria-label="Sezono atkūrimas">${icon('play', 20)}</button>
          <div class="mp-replay" data-replay-bar hidden>
            <button type="button" class="mp-mini" data-replay-toggle aria-label="Pristabdyti">${icon('pause', 16)}</button>
            <span class="mp-track" aria-hidden="true"><i data-replay-fill></i></span>
            <span class="small strong" data-replay-date></span>
            <button type="button" class="mp-mini" data-replay-close aria-label="Baigti atkūrimą">${icon('x', 16, 2.4)}</button>
          </div>
          <section class="mp-sheet" data-sheet aria-live="polite"></section>
        </div>
        <p class="small muted" data-map-count></p>` : empty('Vietų dar nėra', 'Registruojant laimikį telefonas užfiksuoja vietą – ji atsiras čia.')}
      <section class="card stack-2">
        <label class="check-row"><input type="checkbox" data-keep ${keep ? 'checked' : ''}>
          <span class="stack-1"><span class="strong">Saugoti vietas mano žemėlapiui ilgiau nei 90 d.</span>
          <span class="small muted">Tikslios vietos ištrinamos praėjus 90 dienų – taip žadame. Įjungus jų kopijos išsaugomos tik tau: jų nemato niekas, net moderatoriai. Išjungus kopijos ištrinamos.</span></span></label>
      </section>
    </div>`,
    async mount(root) {
      const keepBox = root.querySelector('[data-keep]');
      keepBox.addEventListener('change', async () => {
        keepBox.disabled = true;
        try {
          const n = await backend.setKeepSpots(keepBox.checked);
          ctx.toast(keepBox.checked ? `Vietos bus saugomos${n ? ` (išsaugota ${n})` : ''}` : 'Išsaugotos vietos ištrintos');
        } catch {
          keepBox.checked = !keepBox.checked;
          ctx.toast('Nepavyko išsaugoti');
        }
        keepBox.disabled = false;
      });
      const box = root.querySelector('[data-map]');
      if (!box) return undefined;
      const sheet = root.querySelector('[data-sheet]');
      const filters = { species: 'all', period: 'all', daypart: 'all' };
      let current = [];
      let engine = null;
      let dead = false;
      let replay = null;

      const filtered = () => withLoc.filter((c) => (filters.species === 'all' || String(c.species_id) === filters.species)
        && inPeriod(c.captured_at_device, filters.period)
        && (filters.daypart === 'all' || daypartOf(c.captured_at_device) === filters.daypart));

      // Apatinė kortelė: geriausios vietos arba pasirinkto taško laimikiai.
      const showSpots = () => {
        engine?.highlight(null);
        const spots = bestSpots(current).slice(0, 5);
        sheet.innerHTML = String(html`<div class="mp-handle" aria-hidden="true"></div>
          <div class="row-between"><h2 class="mp-h">Mano geriausios vietos</h2><span class="small muted">${count(current.length, 'laimikis', 'laimikiai', 'laimikių')} · ${count(groupSpots(current, 300).length, 'vieta', 'vietos', 'vietų')}</span></div>
          ${spots.length ? html`<ol class="mp-spots plain">${spots.map((s, i) => html`<li><button type="button" class="mp-spot" data-spot="${i}">
            <b>${i + 1}</b><span class="grow stack-1 left"><span class="strong">${count(s.items.length, 'laimikis', 'laimikiai', 'laimikių')} · ${sp(s.best.species_id)} ${cm(s.best.length_mm)}</span>
            <span class="small muted">${s.often || `paskutinis ${shortDate(s.items.map((c) => c.captured_at_device).sort().pop())}`}</span></span>${icon('chevron', 18)}</button></li>`)}</ol>`
            : html`<p class="small muted">Pagal pasirinktus filtrus laimikių nėra.</p>`}`);
        sheet.querySelectorAll('[data-spot]').forEach((b) => b.addEventListener('click', () => {
          const s = spots[Number(b.dataset.spot)];
          engine?.flyTo(s.lat, s.lng, 14);
          showGroup(s.items, s.lat, s.lng);
        }));
      };
      const showGroup = (items, lat, lng) => {
        const list = items.slice().sort((a, b) => b.length_mm - a.length_mm);
        engine?.highlight(lat, lng);
        sheet.innerHTML = String(html`<div class="mp-handle" aria-hidden="true"></div>
          <div class="row-between"><span class="small muted strong">${list.length > 1 ? `Šioje vietoje ${count(list.length, 'laimikis', 'laimikiai', 'laimikių')}` : 'Laimikis'}</span>
            <button type="button" class="mp-mini" data-sheet-close aria-label="Uždaryti">${icon('x', 16, 2.4)}</button></div>
          <div class="mp-cards" data-cards>${list.map((c) => html`<article class="mp-card">
            ${thumb(c.photo_path, 120)}
            <div class="stack-1 grow min0">
              <span class="row gap-8 mp-card-top"><span class="mp-len">${cm(c.length_mm)}</span><span class="strong">${sp(c.species_id)}</span></span>
              <span class="small muted">${dateTime(c.captured_at_device)} · ${daypartLabel(daypartOf(c.captured_at_device)).toLowerCase()}</span>
              ${c.weight_g || c.bait ? html`<span class="small">${[c.weight_g ? kg(c.weight_g) : '', c.bait || ''].filter(Boolean).join(' · ')}</span>` : ''}
              ${c.weather ? html`<span class="small muted">${weatherLine(c.weather)}</span>` : ''}
              <a class="small strong accent mp-open" href="#/l/${c.id}">Atidaryti laimikį ›</a>
            </div>
          </article>`)}</div>
          ${list.length > 1 ? html`<div class="mp-dots" aria-hidden="true">${list.map((_, i) => html`<i class="${i ? '' : 'on'}"></i>`)}</div>` : ''}`);
        hydratePhotos(sheet, backend);
        sheet.querySelector('[data-sheet-close]').addEventListener('click', showSpots);
        const cards = sheet.querySelector('[data-cards]');
        cards.addEventListener('scroll', () => {
          const i = Math.round(cards.scrollLeft / Math.max(1, cards.clientWidth));
          sheet.querySelectorAll('.mp-dots i').forEach((d, k) => d.classList.toggle('on', k === i));
        }, { passive: true });
      };
      const pick = (id) => {
        const c = byId.get(id);
        if (!c) return;
        const near = current.filter((x) => groupSpots([c, x], 50).length === 1);
        showGroup(near.length ? near : [c], c.lat, c.lng);
      };

      const draw = (fit = true) => {
        current = filtered();
        engine?.setPoints(current);
        if (fit) engine?.fit(current);
        root.querySelector('[data-map-count]').textContent = `Rodoma: ${count(current.length, 'laimikis', 'laimikiai', 'laimikių')}, ${count(groupSpots(current).length, 'vieta', 'vietos', 'vietų')}. Žemėlapis: ${engine?.kind === 'maplibre' ? 'naujas' : 'paprastas'}.`;
        showSpots();
      };

      // Variklis: pirmiausia MapLibre, nepavykus – Leaflet.
      const msg = root.querySelector('[data-map-msg]');
      try {
        engine = await mapEngine(box, { onPick: pick, state });
      } catch {
        if (msg && msg.isConnected) msg.textContent = 'Žemėlapio nepavyko įkelti – patikrink ryšį.';
        else if (box.isConnected) box.innerHTML = String(html`<p class="small muted center mp-msg">Žemėlapio nepavyko įkelti – patikrink ryšį.</p>`);
        return undefined;
      }
      if (dead || !box.isConnected) { engine.destroy(); return undefined; }
      root.querySelector('[data-map-wrap]').dataset.engine = engine.kind;
      // Laikinai: jei naujas žemėlapis neįsikėlė – priežastis matoma iškart virš žemėlapio.
      if (engine.kind !== 'maplibre' && mapFailReason) {
        const why = document.createElement('p');
        why.className = 'small muted mp-why';
        why.dataset.mapWhy = '';
        why.textContent = `Naujas žemėlapis neįsikėlė: ${mapFailReason}`;
        root.querySelector('[data-map-wrap]').before(why);
      }
      root.querySelector('[data-mode-seg]').hidden = !engine.heat;
      const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => engine?.resize()) : null;
      ro?.observe(box);
      draw();

      root.querySelectorAll('[data-sp]').forEach((b) => b.addEventListener('click', () => {
        filters.species = b.dataset.sp;
        root.querySelectorAll('[data-sp]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        draw();
      }));
      root.querySelector('[data-period]').addEventListener('change', (e) => { filters.period = e.target.value; draw(); });
      root.querySelector('[data-daypart]').addEventListener('change', (e) => { filters.daypart = e.target.value; draw(); });
      root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
        root.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        engine.setMode(b.dataset.mode);
      }));

      root.querySelector('[data-locate]').addEventListener('click', (e) => {
        if (!navigator.geolocation) { ctx.toast('Šis telefonas vietos nenustato'); return; }
        const btn = e.currentTarget;
        btn.classList.add('busy');
        navigator.geolocation.getCurrentPosition((p) => {
          btn.classList.remove('busy');
          engine.showMe(p.coords.latitude, p.coords.longitude);
          engine.flyTo(p.coords.latitude, p.coords.longitude, 12);
        }, () => {
          btn.classList.remove('busy');
          ctx.toast('Nepavyko nustatyti vietos – leisk ją naršyklės nustatymuose');
        }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
      });

      // Sezono atkūrimas: laimikiai iškyla tokia tvarka, kaip buvo pagauti.
      const bar = root.querySelector('[data-replay-bar]');
      const fill = root.querySelector('[data-replay-fill]');
      const dateEl = root.querySelector('[data-replay-date]');
      const toggleBtn = root.querySelector('[data-replay-toggle]');
      const stopReplay = (restore = true) => {
        if (!replay) return;
        cancelAnimationFrame(replay.raf);
        replay = null;
        bar.hidden = true;
        sheet.hidden = false;
        if (restore) draw(false);
      };
      const frame = (ts) => {
        if (!replay) return;
        if (!replay.paused) {
          replay.elapsed += replay.last ? ts - replay.last : 0;
          const k = Math.min(1, replay.elapsed / replay.duration);
          const cut = replay.from + (replay.to - replay.from) * k;
          const shown = replay.list.filter((c) => new Date(c.captured_at_device).getTime() <= cut);
          if (shown.length !== replay.count) { replay.count = shown.length; engine.setPoints(shown); }
          fill.style.width = `${Math.round(k * 100)}%`;
          dateEl.textContent = longDate(new Date(cut));
          if (k >= 1) { replay.paused = true; toggleBtn.innerHTML = String(icon('play', 16)); toggleBtn.setAttribute('aria-label', 'Iš naujo'); replay.done = true; }
        }
        replay.last = ts;
        replay.raf = requestAnimationFrame(frame);
      };
      root.querySelector('[data-replay]').addEventListener('click', () => {
        const list = filtered().slice().sort((a, b) => (a.captured_at_device < b.captured_at_device ? -1 : 1));
        if (!list.length) { ctx.toast('Nėra laimikių atkūrimui'); return; }
        stopReplay(false);
        engine.fit(list);
        engine.setPoints([]);
        sheet.hidden = true;
        bar.hidden = false;
        toggleBtn.innerHTML = String(icon('pause', 16));
        toggleBtn.setAttribute('aria-label', 'Pristabdyti');
        replay = { list, from: new Date(list[0].captured_at_device).getTime() - 1, to: new Date(list[list.length - 1].captured_at_device).getTime(),
          duration: Math.min(14000, Math.max(5000, list.length * 350)), elapsed: 0, last: 0, count: -1, paused: false };
        replay.raf = requestAnimationFrame(frame);
      });
      toggleBtn.addEventListener('click', () => {
        if (!replay) return;
        if (replay.done) { replay.done = false; replay.elapsed = 0; replay.count = -1; }
        replay.paused = !replay.paused;
        replay.last = 0;
        toggleBtn.innerHTML = String(icon(replay.paused ? 'play' : 'pause', 16));
        toggleBtn.setAttribute('aria-label', replay.paused ? 'Tęsti' : 'Pristabdyti');
      });
      root.querySelector('[data-replay-close]').addEventListener('click', () => stopReplay(true));

      return () => { dead = true; stopReplay(false); ro?.disconnect(); engine?.destroy(); };
    }
  };
}
