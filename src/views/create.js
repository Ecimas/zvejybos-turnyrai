import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { backButton, loginPrompt } from '../ui.js';

const pad = (n) => String(n).padStart(2, '0');
const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export async function createView(ctx) {
  const { backend, state } = ctx;
  if (!state.user) {
    return { nav: 'turnyrai', html: html`<div class="screen">${backButton('#/')}<h1 class="display-lg" tabindex="-1">Naujas turnyras</h1>${loginPrompt('Prisijunk, kad galėtum kurti turnyrus.')}</div>` };
  }
  const start = new Date(Date.now() + 60 * 60e3);
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 2 * 24 * 60 * 60e3);
  const popular = ['lydeka', 'eserys', 'starkis', 'karsis', 'kuoja', 'karpis', 'lynas', 'samas']
    .map((c) => state.species.find((s) => s.code === c)).filter(Boolean);

  return {
    nav: null,
    title: 'Naujas turnyras',
    html: html`<div class="screen has-cta">
      <header class="top-bar">${backButton('#/')}<span class="muted strong">Naujas turnyras</span><span></span></header>
      <h1 class="display-lg" tabindex="-1">Sukurk turnyrą</h1>
      <p class="muted">Keturi laukai – ir turnyras paruoštas. Kol kas visi turnyrai nemokami.</p>

      <form class="stack-lg" data-form novalidate>
        <label class="field"><span class="small muted strong">Pavadinimas</span>
          <input name="title" required minlength="3" maxlength="80" placeholder="pvz. Rudens lydekų taurė"></label>

        <fieldset class="field">
          <legend class="small muted strong">Formatas</legend>
          <div class="seg">
            <button type="button" data-format="biggest" aria-pressed="true">Didžiausia žuvis</button>
            <button type="button" data-format="top_n_sum" aria-pressed="false">Kelių ilgių suma</button>
          </div>
          <label class="field" data-topn hidden><span class="small muted">Kiek ilgiausių žuvų sumuoti</span>
            <select name="top_n">${[2, 3, 4, 5].map((n) => html`<option value="${n}" ${n === 3 ? 'selected' : ''}>${n}</option>`)}</select></label>
        </fieldset>

        <fieldset class="field">
          <legend class="small muted strong">Rūšys <span class="muted">(nieko nepažymėjus – visos)</span></legend>
          <div class="chips">${popular.map((s) => html`<button type="button" class="sp-chip" data-sp="${s.id}" aria-pressed="false">${s.name_lt}</button>`)}</div>
        </fieldset>

        <div class="grid-2">
          <label class="field"><span class="small muted strong">Pradžia</span>
            <input type="datetime-local" name="starts_at" required value="${local(start)}"></label>
          <label class="field"><span class="small muted strong">Pabaiga</span>
            <input type="datetime-local" name="ends_at" required value="${local(end)}"></label>
        </div>

        <label class="field"><span class="small muted strong">Minimalus ilgis, cm (nebūtina)</span>
          <input type="number" name="min_cm" min="0" max="200" inputmode="numeric" placeholder="0"></label>

        <label class="field"><span class="small muted strong">Aprašymas (nebūtina)</span>
          <textarea name="description" rows="3" maxlength="2000" placeholder="Papildomos taisyklės, prizai, rėmėjai"></textarea></label>

        <p class="form-error bad small" data-error hidden></p>
      </form>
    </div>
    <div class="cta-bar"><button class="btn btn-primary btn-lg" data-submit>${icon('check', 22, 3)}Sukurti turnyrą</button></div>`,
    mount(root) {
      const form = root.querySelector('[data-form]');
      let format = 'biggest';
      const picked = new Set();
      root.querySelectorAll('[data-format]').forEach((b) => b.addEventListener('click', () => {
        format = b.dataset.format;
        root.querySelectorAll('[data-format]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        root.querySelector('[data-topn]').hidden = format !== 'top_n_sum';
      }));
      root.querySelectorAll('[data-sp]').forEach((b) => b.addEventListener('click', () => {
        const id = Number(b.dataset.sp);
        if (picked.has(id)) picked.delete(id); else picked.add(id);
        b.setAttribute('aria-pressed', String(picked.has(id)));
      }));
      const errorEl = root.querySelector('[data-error]');
      const fail = (msg) => { errorEl.hidden = false; errorEl.textContent = msg; errorEl.scrollIntoView({ block: 'center' }); };

      root.querySelector('[data-submit]').addEventListener('click', async (e) => {
        errorEl.hidden = true;
        const title = form.title.value.trim();
        let startsAt = new Date(form.starts_at.value);
        const endsAt = new Date(form.ends_at.value);
        const minCm = Number(form.min_cm.value || 0);
        if (title.length < 3) return fail('Pavadinimas per trumpas.');
        if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return fail('Nurodyk pradžią ir pabaigą.');
        if (endsAt <= startsAt) return fail('Pabaiga turi būti vėliau nei pradžia.');
        if (endsAt - startsAt > 120 * 24 * 3600e3) return fail('Turnyras gali trukti ne ilgiau kaip 120 dienų.');
        if (startsAt < Date.now() - 5 * 60e3) return fail('Pradžia negali būti praeityje.');
        // Pradžia „dabar“ -> po 2 min.: duomenų bazė leidžia keisti turnyro rūšis tik iki starto.
        const soonest = new Date(Date.now() + 2 * 60e3);
        if (startsAt < soonest) startsAt = soonest;
        if (endsAt <= startsAt) return fail('Pabaiga turi būti vėliau nei pradžia.');
        if (minCm < 0 || minCm > 200) return fail('Minimalus ilgis turi būti 0–200 cm.');
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const id = await backend.createTournament({
            title,
            description: form.description.value.trim() || null,
            format,
            top_n: format === 'top_n_sum' ? Number(form.top_n.value) : 3,
            min_length_mm: Math.round(minCm * 10),
            starts_at: startsAt.toISOString(),
            ends_at: endsAt.toISOString(),
            species_ids: [...picked]
          });
          ctx.toast('Turnyras sukurtas');
          ctx.navigate(`#/t/${id}`);
        } catch (err) {
          console.error(err);
          btn.disabled = false;
          fail('Nepavyko sukurti turnyro. Bandyk dar kartą.');
        }
      });
    }
  };
}
