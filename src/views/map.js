// Mano laimikių žemėlapis (#/zemelapis): matai tik tu. Filtrai pagal rūšį ir metus.
import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { cm, shortDate, count } from '../lib/format.js';
import { backButton, loginPrompt, empty } from '../ui.js';
import { loadLeaflet, TILES, colorFor, groupSpots } from '../lib/map.js';

export async function mapView(ctx) {
  const { backend, state } = ctx;
  if (!state.user) {
    return { nav: 'profilis', title: 'Mano žemėlapis', html: html`<div class="screen"><h1 class="display-lg" tabindex="-1">Mano žemėlapis</h1>${loginPrompt('Prisijunk, kad matytum savo laimikių žemėlapį.')}</div>` };
  }
  const { catches, keep } = await backend.myMap();
  const withLoc = catches.filter((c) => c.location && c.status !== 'rejected');
  const noLoc = catches.filter((c) => !c.location && c.status !== 'rejected').length;
  const sp = (id) => state.species.find((s) => s.id === id)?.name_lt ?? '';
  const speciesIds = [...new Set(withLoc.map((c) => c.species_id))];
  const years = [...new Set(withLoc.map((c) => new Date(c.captured_at_device).getFullYear()))].sort((a, b) => b - a);

  return {
    nav: 'profilis',
    title: 'Mano žemėlapis',
    html: html`<div class="screen">
      <header class="top-bar">${backButton('#/profilis')}<span class="muted strong">Mano žemėlapis</span><span></span></header>
      <h1 class="sr-only" tabindex="-1">Mano laimikių žemėlapis</h1>
      <p class="small muted">${icon('lock', 14)} Šį žemėlapį matai tik tu. ${count(withLoc.length, 'laimikis', 'laimikiai', 'laimikių')} su vieta${noLoc ? ` · ${noLoc} be vietos` : ''}.</p>
      ${withLoc.length ? html`
        <div class="chips" role="group" aria-label="Rūšys">
          <button type="button" class="sp-chip" data-sp="all" aria-pressed="true">Visos</button>
          ${speciesIds.map((id) => html`<button type="button" class="sp-chip" data-sp="${id}" aria-pressed="false"><span class="dot" style="background:${colorFor(id)}" aria-hidden="true"></span>${sp(id)}</button>`)}
        </div>
        ${years.length > 1 ? html`<label class="field"><span class="small muted strong">Metai</span>
          <select data-year><option value="all">Visi</option>${years.map((y) => html`<option value="${y}">${y}</option>`)}</select></label>` : ''}
        <div class="map-box" data-map role="region" aria-label="Laimikių žemėlapis"><p class="small muted center" data-map-msg>Įkeliamas žemėlapis…</p></div>
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
      let L;
      try {
        L = await loadLeaflet();
      } catch {
        root.querySelector('[data-map-msg]').textContent = 'Žemėlapio nepavyko įkelti – patikrink ryšį.';
        return undefined;
      }
      if (!box.isConnected) return undefined;
      box.innerHTML = '';
      const map = L.map(box, { zoomControl: true, attributionControl: true });
      L.tileLayer(TILES, { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(map);
      const layer = L.layerGroup().addTo(map);
      let species = 'all';
      let year = 'all';

      const draw = () => {
        layer.clearLayers();
        const pts = withLoc.filter((c) => (species === 'all' || String(c.species_id) === species)
          && (year === 'all' || String(new Date(c.captured_at_device).getFullYear()) === year))
          .map((c) => ({ ...c, lat: c.location.lat, lng: c.location.lng }));
        const groups = groupSpots(pts);
        for (const g of groups) {
          const best = g.items.slice().sort((a, b) => b.length_mm - a.length_mm)[0];
          const m = L.circleMarker([g.lat, g.lng], {
            radius: Math.min(16, 7 + g.items.length * 2), color: '#0A1822', weight: 2,
            fillColor: colorFor(best.species_id), fillOpacity: 0.9
          });
          const lines = g.items.slice(0, 6).map((c) => `<a href="#/l/${c.id}">${esc(sp(c.species_id))} ${esc(cm(c.length_mm))}</a> · ${esc(shortDate(c.captured_at_device))}`);
          if (g.items.length > 6) lines.push(`ir dar ${g.items.length - 6}`);
          m.bindPopup(`<strong>${g.items.length > 1 ? `${g.items.length} laimikiai čia` : 'Laimikis'}</strong><br>${lines.join('<br>')}`);
          m.addTo(layer);
        }
        root.querySelector('[data-map-count]').textContent = `Rodoma: ${count(pts.length, 'laimikis', 'laimikiai', 'laimikių')}, ${count(groups.length, 'vieta', 'vietos', 'vietų')}.`;
        if (pts.length) map.fitBounds(pts.map((p) => [p.lat, p.lng]), { padding: [30, 30], maxZoom: 14 });
      };

      root.querySelectorAll('[data-sp]').forEach((b) => b.addEventListener('click', () => {
        species = b.dataset.sp;
        root.querySelectorAll('[data-sp]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        draw();
      }));
      root.querySelector('[data-year]')?.addEventListener('change', (e) => { year = e.target.value; draw(); });
      draw();
      return () => map.remove();
    }
  };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
