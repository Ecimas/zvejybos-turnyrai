import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { cm, dateTime, count } from '../lib/format.js';
import { statusChip, thumb, hydratePhotos, empty, loginPrompt } from '../ui.js';

export async function diaryView(ctx) {
  const { backend, state } = ctx;
  if (!state.user) {
    return { nav: 'dienorastis', title: 'Dienoraštis', html: html`<div class="screen"><h1 class="display-lg" tabindex="-1">Dienoraštis</h1>${loginPrompt('Prisijunk, kad matytum savo laimikius.')}</div>` };
  }
  const [queued, catches] = await Promise.all([ctx.outbox.list(), backend.myCatches()]);
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
        ${catches.length ? catches.map((c) => html`<div class="card row tight">
          ${thumb(c.photo_path)}
          <div class="grow stack-1">
            <span class="num-md">${cm(c.length_mm)}</span>
            <span class="small muted">${sp(c.species_id)} · ${dateTime(c.captured_at_device)}</span>
            ${c.status === 'rejected' && c.reject_reason ? html`<span class="small bad">${c.reject_reason}</span>` : ''}
          </div>
          ${statusChip(c.status)}
        </div>`) : (!queued.length ? empty('Dar neturi laimikių', 'Paspausk didelį mygtuką apačioje ir užregistruok pirmą žuvį.', html`<a class="btn btn-primary" href="#/laimikis">${icon('camera', 20)}Registruoti laimikį</a>`) : '')}
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
      root.querySelectorAll('[data-dismiss]').forEach((b) => b.addEventListener('click', async () => {
        await ctx.outbox.dismiss(b.dataset.dismiss);
        ctx.rerender();
      }));
      root.querySelector('[data-sync]')?.addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        await ctx.flush();
        if (ctx.state.outboxPending) ctx.toast(navigator.onLine ? 'Nepavyko išsiųsti – bandysime vėliau' : 'Nėra ryšio');
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
