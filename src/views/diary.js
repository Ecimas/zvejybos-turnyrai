import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { cm, dateTime, count, longDate } from '../lib/format.js';
import { statusChip, thumb, hydratePhotos, empty, loginPrompt } from '../ui.js';
import { weatherLine, fetchWeather } from '../lib/weather.js';
import { recordIds } from '../lib/records.js';
import { weatherEnabled } from './capture.js';

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

export async function diaryView(ctx) {
  const { backend, state } = ctx;
  if (!state.user) {
    return { nav: 'dienorastis', title: 'Dienoraštis', html: html`<div class="screen"><h1 class="display-lg" tabindex="-1">Dienoraštis</h1>${loginPrompt('Prisijunk, kad matytum savo laimikius.')}</div>` };
  }
  const [queued, catches, disputes, trips] = await Promise.all([
    ctx.outbox.list(), backend.myCatches(), backend.myDisputes().catch(() => []), backend.blankTrips().catch(() => [])
  ]);
  const records = recordIds(catches);
  // Laimikiai ir išvykos be laimikio – viena laiko juosta, naujausi viršuje.
  const timeline = [
    ...catches.map((c) => ({ kind: 'catch', at: c.captured_at_device, c })),
    ...trips.map((b) => ({ kind: 'trip', at: `${b.trip_date}T23:59:59`, b }))
  ].sort((x, y) => (y.at > x.at ? 1 : y.at < x.at ? -1 : 0));
  const disputeOf = new Map(disputes.map((d) => [d.catch_id, d]));
  const sp = (id) => state.species.find((s) => s.id === id)?.name_lt ?? '';
  const approved = catches.filter((c) => c.status === 'approved').length;

  return {
    nav: 'dienorastis',
    title: 'Dienoraštis',
    html: html`<div class="screen">
      <header class="page-head">
        <div class="stack-2">
          <h1 class="display-lg" tabindex="-1">Dienoraštis</h1>
          <p class="muted">${count(catches.length + queued.length, 'laimikis', 'laimikiai', 'laimikių')} · ${approved} patvirtinta${trips.length ? ` · ${trips.length} be laimikio` : ''}</p>
        </div>
      </header>
      <button class="btn btn-ghost blank-open" data-blank-open aria-expanded="false">${icon('minus', 18, 2.6)}Nieko nekibo – įrašyti žvejybą be laimikio</button>

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

      <section class="stack">
        ${queued.length ? html`<h2 class="h2">Išsiųsti</h2>` : ''}
        ${timeline.length ? timeline.map((item) => {
          if (item.kind === 'trip') {
            const b = item.b;
            return html`<div class="card row tight trip-card" data-trip="${b.id}">
              <span class="thumb trip-ico">${icon('minus', 26, 2.4)}</span>
              <div class="grow stack-1">
                <span class="strong">Nieko nekibo${b.hours ? ` · ${hoursText(b.hours)}` : ''}</span>
                <span class="small muted">${longDate(`${b.trip_date}T12:00:00`)}${b.weather ? ` · ${weatherLine(b.weather)}` : ''}</span>
                ${b.notes ? html`<span class="small">${b.notes}</span>` : ''}
              </div>
              <button class="icon-btn small-btn" data-trip-delete="${b.id}" aria-label="Ištrinti išvyką be laimikio">${icon('x', 16, 2.4)}</button>
            </div>`;
          }
          const c = item.c;
          const d = disputeOf.get(c.id);
          return html`<div class="card stack-2" data-catch="${c.id}">
          <div class="row tight">
            <a class="catch-link" href="#/l/${c.id}" aria-label="Laimikis ${cm(c.length_mm)}, ${sp(c.species_id)} – daugiau">
            ${thumb(c.photo_path)}
            <div class="grow stack-1">
              <span class="num-md">${cm(c.length_mm)}${c.weight_g ? html` <span class="small muted">· ${kg(c.weight_g)}</span>` : ''}</span>
              <span class="small muted">${sp(c.species_id)} · ${dateTime(c.captured_at_device)}</span>
              ${records.has(c.id) ? html`<span class="record-chip">${icon('trophy', 13, 2.4)}Asmeninis rekordas</span>` : ''}
              ${c.status === 'rejected' && c.reject_reason ? html`<span class="small bad">${c.reject_reason}</span>` : ''}
            </div>
            </a>
            <div class="stack-2 right">
              ${statusChip(c.status)}
              <button class="btn-text" data-edit-catch="${c.id}" aria-label="Redaguoti masalą ir pastabas">${icon('edit', 16)}</button>
            </div>
          </div>
          ${c.weather ? html`<span class="small muted">${weatherLine(c.weather)}</span>` : ''}
          ${c.bait || c.notes ? html`<span class="small" data-extra>${c.bait ? html`<strong>Masalas:</strong> ${c.bait}` : ''}${c.bait && c.notes ? ' · ' : ''}${c.notes || ''}</span>` : ''}
          <form class="stack-2" data-extra-form="${c.id}" hidden>
            <label class="field"><span class="small muted strong">Masalas</span><input name="bait" maxlength="80" value="${c.bait || ''}"></label>
            <label class="field"><span class="small muted strong">Pastabos</span><textarea name="notes" rows="2" maxlength="500">${c.notes || ''}</textarea></label>
            <button class="btn btn-primary" type="submit">Išsaugoti</button>
          </form>
          ${d ? html`<span class="small ${d.status === 'accepted' ? 'ok' : d.status === 'rejected' ? 'bad' : 'muted'}">${DISPUTE_LT[d.status]}${d.resolution ? `: ${d.resolution}` : ''}</span>`
            : c.status === 'rejected' && !state.ban ? html`<button class="btn btn-ghost" data-dispute="${c.id}">Nesutinku su sprendimu</button>
              <form class="stack-2" data-dispute-form="${c.id}" hidden>
                <label class="field"><span class="small muted strong">Kodėl laimikis turėtų būti įskaitytas?</span>
                  <textarea name="message" rows="3" minlength="3" maxlength="500" required placeholder="pvz. liniuotė matosi antroje nuotraukos pusėje"></textarea></label>
                <button class="btn btn-primary" type="submit">Pateikti moderatoriui</button>
              </form>` : ''}
        </div>`;
        }) : (!queued.length ? empty('Dar neturi laimikių', 'Paspausk didelį mygtuką apačioje ir užregistruok pirmą žuvį.', html`<a class="btn btn-primary" href="#/laimikis">${icon('camera', 20)}Užregistruoti pirmą laimikį</a>`) : '')}
      </section>
    </div>`,
    mount(root) {
      hydratePhotos(root, backend);
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
      root.querySelectorAll('[data-trip-delete]').forEach((b) => b.addEventListener('click', async () => {
        await backend.deleteBlankTrip(b.dataset.tripDelete).catch(() => ctx.toast('Nepavyko ištrinti'));
        ctx.rerender();
      }));
      root.querySelectorAll('[data-edit-catch]').forEach((b) => b.addEventListener('click', () => {
        const f = root.querySelector(`[data-extra-form="${b.dataset.editCatch}"]`);
        f.hidden = !f.hidden;
        if (!f.hidden) f.bait.focus();
      }));
      root.querySelectorAll('[data-extra-form]').forEach((f) => f.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await backend.updateCatch(f.dataset.extraForm, { bait: f.bait.value.trim(), notes: f.notes.value.trim() });
          ctx.toast('Išsaugota');
          ctx.rerender();
        } catch (err) {
          ctx.toast(err.message || 'Nepavyko išsaugoti');
        }
      }));
      root.querySelectorAll('[data-dispute]').forEach((b) => b.addEventListener('click', () => {
        b.hidden = true;
        const f = root.querySelector(`[data-dispute-form="${b.dataset.dispute}"]`);
        f.hidden = false;
        f.message.focus();
      }));
      root.querySelectorAll('[data-dispute-form]').forEach((f) => f.addEventListener('submit', async (e) => {
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
