// Laimikio registracija: kamera -> ilgis -> rūšis -> išsaugoti.
// Tikslas: ~8 sekundės nuo mygtuko iki išsaugojimo, viena ranka.
import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { phase, cm } from '../lib/format.js';
import { fitReason, REASON_LT } from '../lib/scoring.js';
import { startCamera, stopCamera, captureFrame, sha256Hex, watchLocation, uuid, vibrate } from '../lib/device.js';
import { mountRuler } from '../lib/ruler.js';
import { loginPrompt } from '../ui.js';

const COMMON = ['lydeka', 'eserys', 'starkis', 'karsis', 'kuoja', 'karpis'];
const MIN_CM = 10;
const MAX_CM = 200;

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

function lastUsed() {
  try { return JSON.parse(localStorage.getItem('zt-last') || '{}'); } catch { return {}; }
}

export async function captureView(ctx) {
  const { state, backend } = ctx;
  if (!state.user) {
    return { nav: 'turnyrai', title: 'Naujas laimikis', html: html`<div class="screen"><h1 class="display-lg" tabindex="-1">Naujas laimikis</h1>${loginPrompt('Prisijunk, kad galėtum registruoti laimikius.')}</div>` };
  }
  const tournaments = (await backend.tournaments().catch(() => [])).filter((t) => t.joined && phase(t) === 'live');
  const species = state.species;
  const last = lastUsed();
  const commonIds = COMMON.map((c) => species.find((s) => s.code === c)?.id).filter(Boolean);
  if (last.speciesId && !commonIds.includes(last.speciesId)) commonIds.unshift(last.speciesId);
  const nickname = state.profile?.nickname || 'zvejys';

  return {
    nav: null,
    dark: true,
    title: 'Naujas laimikis',
    html: html`<div class="capture">
      <header class="cap-top">
        <button class="icon-btn" data-close aria-label="Uždaryti">${icon('x', 22, 2.2)}</button>
        <h1 class="cap-title" tabindex="-1">Naujas laimikis</h1>
        <span class="chip chip-queue" data-gps>${icon('pin', 14, 2.4)}Ieškoma GPS…</span>
      </header>

      <section data-step="camera" class="cam-step">
        <div class="cam-wrap">
          <video data-video playsinline muted></video>
          <div class="cam-guide" aria-hidden="true"></div>
          <p class="cam-hint">Padėk žuvį ant liniuotės. Visa žuvis turi matytis kadre.</p>
        </div>
        <div class="cam-error" data-cam-error hidden></div>
        <div class="cam-bar">
          <button class="shutter" data-shoot aria-label="Fotografuoti" disabled><span></span></button>
        </div>
      </section>

      <section data-step="details" class="details" hidden>
        <div class="photo-wrap">
          <img data-photo-preview alt="Laimikio nuotrauka">
          <button class="pill-btn" data-retake>Perfotografuoti</button>
        </div>
        <div class="sheet stack-lg">
          <div class="stack">
            <div class="row-between">
              <div class="stack-1">
                <span class="small muted strong">Ilgis</span>
                <span class="len-readout" aria-live="polite"><span data-len>50</span> <span class="unit">cm</span></span>
              </div>
              <div class="row gap-8">
                <button class="sq-btn" data-dec aria-label="Sumažinti 1 cm">${icon('minus', 22, 2.6)}</button>
                <button class="sq-btn" data-inc aria-label="Padidinti 1 cm">${icon('plus', 22, 2.6)}</button>
              </div>
            </div>
            <div data-ruler></div>
            <label class="sr-only">Laimikio ilgis centimetrais
              <input type="range" min="${MIN_CM}" max="${MAX_CM}" step="1" data-range>
            </label>
          </div>

          <div class="stack">
            <span class="small muted strong">Rūšis</span>
            <div class="chips" role="group" aria-label="Rūšis">
              ${commonIds.map((id) => html`<button type="button" class="sp-chip" data-sp="${id}" aria-pressed="false">${species.find((s) => s.id === id)?.name_lt}</button>`)}
            </div>
            <label class="field">
              <span class="small muted">Kita rūšis</span>
              <select data-sp-select>
                <option value="">Pasirinkti…</option>
                ${species.map((s) => html`<option value="${s.id}">${s.name_lt}</option>`)}
              </select>
            </label>
          </div>

          <div class="stack" data-fit-wrap>
            <span class="small muted strong">Turnyrai</span>
            <div class="list" data-fit></div>
          </div>

          <div class="info-grid">
            <div class="info"><span class="small muted">Laikas</span><span class="strong" data-time>–</span></div>
            <div class="info"><span class="small muted">Vieta</span><span class="strong" data-loc>–</span></div>
          </div>
        </div>
        <div class="cta-bar row gap-10">
          <button class="btn btn-outline btn-lg" data-save-more>Dar vienas</button>
          <button class="btn btn-primary btn-lg grow" data-save>${icon('check', 22, 3)}Išsaugoti</button>
        </div>
      </section>
    </div>`,

    mount(root) {
      const q = (s) => root.querySelector(s);
      const video = q('[data-video]');
      let stream = null;
      let fix = null;
      let photo = null;
      let photoUrl = null;
      let capturedAt = null;
      let clientId = uuid();
      let len = Math.min(MAX_CM, Math.max(MIN_CM, last.lengthCm || 50));
      let speciesId = last.speciesId || commonIds[0] || null;
      let saving = false;

      const ruler = mountRuler(q('[data-ruler]'), {
        value: len, min: MIN_CM, max: MAX_CM,
        onChange: (v) => { len = v; showLen(); }
      });
      const range = q('[data-range]');
      range.value = String(len);
      range.addEventListener('input', () => { len = Number(range.value); ruler.set(len); showLen(); });

      function showLen() {
        q('[data-len]').textContent = String(len);
        range.value = String(len);
        updateFit();
      }
      function step(v) { len = Math.max(MIN_CM, Math.min(MAX_CM, len + v)); ruler.set(len); vibrate(6); showLen(); }
      q('[data-dec]').addEventListener('click', () => step(-1));
      q('[data-inc]').addEventListener('click', () => step(1));

      function showSpecies() {
        root.querySelectorAll('[data-sp]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.sp) === speciesId)));
        q('[data-sp-select]').value = commonIds.includes(speciesId) ? '' : String(speciesId || '');
        updateFit();
      }
      root.querySelectorAll('[data-sp]').forEach((b) => b.addEventListener('click', () => { speciesId = Number(b.dataset.sp); showSpecies(); }));
      q('[data-sp-select]').addEventListener('change', (e) => { if (e.target.value) { speciesId = Number(e.target.value); showSpecies(); } });

      function updateFit() {
        const box = q('[data-fit]');
        if (!tournaments.length) {
          box.innerHTML = String(html`<div class="list-row"><span class="muted small">Šiuo metu nedalyvauji jokiame vykstančiame turnyre. Laimikis bus išsaugotas dienoraštyje.</span></div>`);
          return;
        }
        const draft = { species_id: speciesId, length_mm: len * 10, captured_at_device: capturedAt || new Date().toISOString(), received_at: null };
        box.innerHTML = String(html`${tournaments.map((t) => {
          const r = fitReason(t, t.species_ids, true, draft);
          return html`<div class="list-row">
            <span class="dot-icon ${r === 'ok' ? 'ok' : 'off'}">${icon(r === 'ok' ? 'check' : 'minus', 15, 3)}</span>
            <span class="grow stack-1"><span class="strong">${t.title}</span><span class="small muted">${r === 'ok' ? 'Bus įskaityta po patvirtinimo' : REASON_LT[r]}</span></span>
          </div>`;
        })}`);
      }

      const gpsChip = q('[data-gps]');
      const stopGps = watchLocation((g) => {
        if (g.state === 'ok') {
          fix = { lat: g.lat, lng: g.lng, accuracy: g.accuracy };
          gpsChip.className = 'chip chip-ok';
          gpsChip.innerHTML = String(html`${icon('pin', 14, 2.4)}GPS ±${g.accuracy} m`);
        } else if (g.state === 'denied' || g.state === 'unavailable') {
          gpsChip.className = 'chip chip-wait';
          gpsChip.innerHTML = String(html`${icon('alert', 14, 2.4)}Be GPS`);
        }
        showLoc();
      });
      function showLoc() {
        const el = q('[data-loc]');
        if (el) el.textContent = fix ? `±${fix.accuracy} m` : 'Nėra – tikrins moderatorius';
      }

      async function openCamera() {
        const err = q('[data-cam-error]');
        err.hidden = true;
        try {
          stream = await startCamera(video);
          q('[data-shoot]').disabled = false;
        } catch (e) {
          const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
          err.hidden = false;
          err.innerHTML = String(html`${icon('camera', 28)}
            <p class="strong">${denied ? 'Kamera neleidžiama' : 'Kameros nepavyko įjungti'}</p>
            <p class="small muted">${denied
              ? 'Leisk šiam puslapiui naudoti kamerą naršyklės nustatymuose ir bandyk dar kartą. Nuotraukos iš galerijos nepriimamos – taip saugomas turnyrų sąžiningumas.'
              : 'Patikrink, ar kamera neužimta kitos programėlės.'}</p>
            <button class="btn" data-cam-retry>Bandyti dar kartą</button>`);
          err.querySelector('[data-cam-retry]').addEventListener('click', openCamera);
        }
      }

      function show(which) {
        root.querySelectorAll('[data-step]').forEach((s) => { s.hidden = s.dataset.step !== which; });
      }

      q('[data-shoot]').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const now = new Date();
          capturedAt = now.toISOString();
          photo = await captureFrame(video, { left: `${nickname} · ${clientId.slice(0, 6).toUpperCase()}`, right: stamp(now) });
          vibrate(15);
          stopCamera(stream);
          stream = null;
          if (photoUrl) URL.revokeObjectURL(photoUrl);
          photoUrl = URL.createObjectURL(photo);
          q('[data-photo-preview]').src = photoUrl;
          q('[data-time]').textContent = stamp(now).slice(11, 16);
          showLoc();
          show('details');
          showLen();
          showSpecies();
        } catch {
          ctx.toast('Nepavyko nufotografuoti');
          btn.disabled = false;
        }
      });

      async function backToCamera() {
        show('camera');
        q('[data-shoot]').disabled = true;
        await openCamera();
      }
      q('[data-retake]').addEventListener('click', backToCamera);

      async function save(more) {
        if (saving) return;
        if (!speciesId) { ctx.toast('Pasirink rūšį'); return; }
        saving = true;
        try {
          const sha256 = await sha256Hex(photo);
          await ctx.outbox.add({
            clientId, speciesId, lengthMm: len * 10, capturedAt, sha256, photo,
            location: fix ? { ...fix } : null
          });
          try { localStorage.setItem('zt-last', JSON.stringify({ speciesId, lengthCm: len })); } catch { /* nėra vietos */ }
          vibrate([20, 40, 20]);
          ctx.toast(`Išsaugota: ${cm(len * 10)}`);
          ctx.flush();
          if (more) {
            clientId = uuid();
            photo = null;
            capturedAt = null;
            saving = false;
            await backToCamera();
          } else {
            ctx.navigate('#/dienorastis');
          }
        } catch (err) {
          console.error(err);
          ctx.toast('Nepavyko išsaugoti telefone');
          saving = false;
        }
      }
      q('[data-save]').addEventListener('click', () => save(false));
      q('[data-save-more]').addEventListener('click', () => save(true));

      q('[data-close]').addEventListener('click', () => {
        if (history.length > 1) history.back();
        else ctx.navigate('#/');
      });

      openCamera();

      return () => {
        stopCamera(stream);
        stopGps();
        ruler.destroy();
        if (photoUrl) URL.revokeObjectURL(photoUrl);
      };
    }
  };
}
