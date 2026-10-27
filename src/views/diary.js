import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { cm, dateTime, count } from '../lib/format.js';
import { statusChip, thumb, hydratePhotos, empty, loginPrompt } from '../ui.js';
import { weatherLine } from '../lib/weather.js';

const kg = (g) => `${String(Math.round(g / 10) / 100).replace('.', ',')} kg`;
const DISPUTE_LT = { open: 'Ginčas peržiūrimas', accepted: 'Ginčas patenkintas', rejected: 'Ginčas atmestas' };

export async function diaryView(ctx) {
  const { backend, state } = ctx;
  if (!state.user) {
    return { nav: 'dienorastis', title: 'Dienoraštis', html: html`<div class="screen"><h1 class="display-lg" tabindex="-1">Dienoraštis</h1>${loginPrompt('Prisijunk, kad matytum savo laimikius.')}</div>` };
  }
  const [queued, catches, disputes] = await Promise.all([
    ctx.outbox.list(), backend.myCatches(), backend.myDisputes().catch(() => [])
  ]);
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
          <p class="muted">${count(catches.length + queued.length, 'laimikis', 'laimikiai', 'laimikių')} · ${approved} patvirtinta</p>
        </div>
      </header>

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
        ${catches.length ? catches.map((c) => {
          const d = disputeOf.get(c.id);
          return html`<div class="card stack-2" data-catch="${c.id}">
          <div class="row tight">
            <a class="catch-link" href="#/l/${c.id}" aria-label="Laimikis ${cm(c.length_mm)}, ${sp(c.species_id)} – daugiau">
            ${thumb(c.photo_path)}
            <div class="grow stack-1">
              <span class="num-md">${cm(c.length_mm)}${c.weight_g ? html` <span class="small muted">· ${kg(c.weight_g)}</span>` : ''}</span>
              <span class="small muted">${sp(c.species_id)} · ${dateTime(c.captured_at_device)}</span>
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
            : c.status === 'rejected' ? html`<button class="btn btn-ghost" data-dispute="${c.id}">Nesutinku su sprendimu</button>
              <form class="stack-2" data-dispute-form="${c.id}" hidden>
                <label class="field"><span class="small muted strong">Kodėl laimikis turėtų būti įskaitytas?</span>
                  <textarea name="message" rows="3" minlength="3" maxlength="500" required placeholder="pvz. liniuotė matosi antroje nuotraukos pusėje"></textarea></label>
                <button class="btn btn-primary" type="submit">Pateikti moderatoriui</button>
              </form>` : ''}
        </div>`;
        }) : (!queued.length ? empty('Dar neturi laimikių', 'Paspausk didelį mygtuką apačioje ir užregistruok pirmą žuvį.', html`<a class="btn btn-primary" href="#/laimikis">${icon('camera', 20)}Registruoti laimikį</a>`) : '')}
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
