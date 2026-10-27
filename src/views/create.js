import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { phase } from '../lib/format.js';
import { backButton, loginPrompt, empty } from '../ui.js';

const pad = (n) => String(n).padStart(2, '0');
const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const SPONSOR_URL = /^https:\/\/[^\s<>"']{3,200}$/;

// Naujas turnyras (#/naujas) ir esamo redagavimas iki starto (#/t/:id/redaguoti).
export async function createView(ctx, [editId] = []) {
  const { backend, state } = ctx;
  const heading = editId ? 'Turnyro redagavimas' : 'Naujas turnyras';
  if (!state.user) {
    return { nav: 'turnyrai', html: html`<div class="screen">${backButton('#/')}<h1 class="display-lg" tabindex="-1">${heading}</h1>${loginPrompt('Prisijunk, kad galėtum kurti turnyrus.')}</div>` };
  }
  let t = null;
  if (editId) {
    t = await backend.tournament(editId);
    if (!t || t.organizer_id !== state.user.id || phase(t) !== 'soon') {
      return { nav: 'turnyrai', html: html`<div class="screen">${backButton(`#/t/${editId}`)}<h1 class="sr-only" tabindex="-1">${heading}</h1>
        ${empty('Redaguoti negalima', 'Turnyrą gali keisti tik organizatorius ir tik iki starto.')}</div>` };
    }
  }
  const start = t ? new Date(t.starts_at) : new Date(Date.now() + 60 * 60e3);
  if (!t) start.setMinutes(0, 0, 0);
  const end = t ? new Date(t.ends_at) : new Date(start.getTime() + 2 * 24 * 60 * 60e3);
  const popular = ['lydeka', 'eserys', 'starkis', 'karsis', 'kuoja', 'karpis', 'lynas', 'samas']
    .map((c) => state.species.find((s) => s.code === c)).filter(Boolean);
  // Redaguojant rodom ir anksčiau pasirinktas retesnes rūšis.
  (t?.species_ids || []).forEach((id) => {
    if (!popular.some((s) => s.id === id)) {
      const s = state.species.find((x) => x.id === id);
      if (s) popular.push(s);
    }
  });
  const picked = new Set(t?.species_ids || []);
  let format = t?.format || 'biggest';
  let visibility = t?.visibility || 'public';
  const back = t ? `#/t/${t.id}` : '#/';

  return {
    nav: null,
    title: heading,
    html: html`<div class="screen has-cta">
      <header class="top-bar">${backButton(back)}<span class="muted strong">${heading}</span><span></span></header>
      <h1 class="display-lg" tabindex="-1">${t ? 'Keisk turnyrą' : 'Sukurk turnyrą'}</h1>
      <p class="muted">${t ? 'Keisti galima iki starto. Dalyviai matys naujas taisykles.' : 'Keturi laukai – ir turnyras paruoštas. Kol kas visi turnyrai nemokami.'}</p>

      <form class="stack-lg" data-form novalidate>
        <label class="field"><span class="small muted strong">Pavadinimas</span>
          <input name="title" required minlength="3" maxlength="80" placeholder="pvz. Rudens lydekų taurė" value="${t?.title || ''}"></label>

        <fieldset class="field">
          <legend class="small muted strong">Formatas</legend>
          <div class="seg">
            <button type="button" data-format="biggest" aria-pressed="${format === 'biggest'}">Didžiausia žuvis</button>
            <button type="button" data-format="top_n_sum" aria-pressed="${format === 'top_n_sum'}">Kelių ilgių suma</button>
          </div>
          <label class="field" data-topn ${format === 'top_n_sum' ? '' : 'hidden'}><span class="small muted">Kiek ilgiausių žuvų sumuoti</span>
            <select name="top_n">${[2, 3, 4, 5].map((n) => html`<option value="${n}" ${n === (t?.top_n || 3) ? 'selected' : ''}>${n}</option>`)}</select></label>
        </fieldset>

        <fieldset class="field">
          <legend class="small muted strong">Rūšys <span class="muted">(nieko nepažymėjus – visos)</span></legend>
          <div class="chips">${popular.map((s) => html`<button type="button" class="sp-chip" data-sp="${s.id}" aria-pressed="${picked.has(s.id)}">${s.name_lt}</button>`)}</div>
        </fieldset>

        <div class="grid-2">
          <label class="field"><span class="small muted strong">Pradžia</span>
            <input type="datetime-local" name="starts_at" required value="${local(start)}"></label>
          <label class="field"><span class="small muted strong">Pabaiga</span>
            <input type="datetime-local" name="ends_at" required value="${local(end)}"></label>
        </div>

        <label class="field"><span class="small muted strong">Minimalus ilgis, cm (nebūtina)</span>
          <input type="number" name="min_cm" min="0" max="200" inputmode="numeric" placeholder="0" value="${t?.min_length_mm ? t.min_length_mm / 10 : ''}"></label>

        <fieldset class="field">
          <legend class="small muted strong">Kas gali dalyvauti</legend>
          <div class="seg">
            <button type="button" data-vis="public" aria-pressed="${visibility === 'public'}">Visi</button>
            <button type="button" data-vis="private" aria-pressed="${visibility === 'private'}">Tik su kvietimu</button>
          </div>
          <span class="small muted" data-vis-hint>${visibility === 'private' ? 'Turnyras nerodomas sąraše. Po sukūrimo gausi kvietimo nuorodą.' : 'Turnyras matomas visiems sąraše.'}</span>
        </fieldset>

        <label class="check-row"><input type="checkbox" name="leaderboard_hidden" ${t?.leaderboard_hidden ? 'checked' : ''}>
          <span class="stack-1"><span class="strong">Slėpti lentelę iki pabaigos</span><span class="small muted">Dalyviai mato tik savo rezultatą – intriga iki paskutinės minutės.</span></span></label>

        <label class="field"><span class="small muted strong">Prizai (nebūtina)</span>
          <textarea name="prizes" rows="3" maxlength="500" placeholder="1 vieta – spiningas&#10;2 vieta – ritė">${t?.prizes || ''}</textarea></label>

        <div class="grid-2">
          <label class="field"><span class="small muted strong">Rėmėjas (nebūtina)</span>
            <input name="sponsor_name" maxlength="60" placeholder="Pavadinimas" value="${t?.sponsor_name || ''}"></label>
          <label class="field"><span class="small muted strong">Rėmėjo svetainė</span>
            <input name="sponsor_url" type="url" maxlength="200" inputmode="url" placeholder="https://…" value="${t?.sponsor_url || ''}"></label>
        </div>

        <label class="field"><span class="small muted strong">Aprašymas (nebūtina)</span>
          <textarea name="description" rows="3" maxlength="2000" placeholder="Papildomos taisyklės">${t?.description || ''}</textarea></label>

        <p class="form-error bad small" data-error hidden role="alert"></p>
        ${t ? html`<button type="button" class="btn btn-ghost bad" data-delete>${icon('x', 18, 2.4)}Ištrinti turnyrą</button>` : ''}
      </form>
    </div>
    <div class="cta-bar"><button class="btn btn-primary btn-lg" data-submit>${icon('check', 22, 3)}${t ? 'Išsaugoti pakeitimus' : 'Sukurti turnyrą'}</button></div>`,
    mount(root) {
      const form = root.querySelector('[data-form]');
      root.querySelectorAll('[data-format]').forEach((b) => b.addEventListener('click', () => {
        format = b.dataset.format;
        root.querySelectorAll('[data-format]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        root.querySelector('[data-topn]').hidden = format !== 'top_n_sum';
      }));
      root.querySelectorAll('[data-vis]').forEach((b) => b.addEventListener('click', () => {
        visibility = b.dataset.vis;
        root.querySelectorAll('[data-vis]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        root.querySelector('[data-vis-hint]').textContent = visibility === 'private'
          ? 'Turnyras nerodomas sąraše. Po sukūrimo gausi kvietimo nuorodą.'
          : 'Turnyras matomas visiems sąraše.';
      }));
      root.querySelectorAll('[data-sp]').forEach((b) => b.addEventListener('click', () => {
        const id = Number(b.dataset.sp);
        if (picked.has(id)) picked.delete(id); else picked.add(id);
        b.setAttribute('aria-pressed', String(picked.has(id)));
      }));
      const errorEl = root.querySelector('[data-error]');
      const fail = (msg) => { errorEl.hidden = false; errorEl.textContent = msg; errorEl.scrollIntoView({ block: 'center' }); };

      root.querySelector('[data-delete]')?.addEventListener('click', async (e) => {
        if (!confirm('Ištrinti turnyrą? Dalyvių registracijos bus panaikintos.')) return;
        e.currentTarget.disabled = true;
        try {
          await backend.deleteTournament(t.id);
          ctx.toast('Turnyras ištrintas');
          ctx.navigate('#/');
        } catch (err) {
          e.currentTarget.disabled = false;
          fail(err.message || 'Nepavyko ištrinti');
        }
      });

      root.querySelector('[data-submit]').addEventListener('click', async (e) => {
        errorEl.hidden = true;
        const title = form.title.value.trim();
        let startsAt = new Date(form.starts_at.value);
        const endsAt = new Date(form.ends_at.value);
        const minCm = Number(form.min_cm.value || 0);
        const sponsorUrl = form.sponsor_url.value.trim();
        if (title.length < 3) return fail('Pavadinimas per trumpas.');
        if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return fail('Nurodyk pradžią ir pabaigą.');
        if (endsAt <= startsAt) return fail('Pabaiga turi būti vėliau nei pradžia.');
        if (endsAt - startsAt > 120 * 24 * 3600e3) return fail('Turnyras gali trukti ne ilgiau kaip 120 dienų.');
        if (startsAt < Date.now() - 5 * 60e3) return fail('Pradžia negali būti praeityje.');
        // Pradžia „dabar“ -> po 2 min.: duomenų bazė leidžia keisti turnyro rūšis tik iki starto.
        const soonest = new Date(Date.now() + 2 * 60e3);
        if (startsAt < soonest) startsAt = soonest;
        if (endsAt <= startsAt) return fail('Pabaiga turi būti vėliau nei pradžia.');
        if (!Number.isFinite(minCm) || minCm < 0 || minCm > 200) return fail('Minimalus ilgis turi būti 0–200 cm.');
        if (sponsorUrl && !SPONSOR_URL.test(sponsorUrl)) return fail('Rėmėjo svetainė turi prasidėti https://');
        const data = {
          title,
          description: form.description.value.trim() || null,
          format,
          top_n: format === 'top_n_sum' ? Number(form.top_n.value) : 3,
          min_length_mm: Math.round(minCm * 10),
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
          visibility,
          leaderboard_hidden: form.leaderboard_hidden.checked,
          prizes: form.prizes.value.trim() || null,
          sponsor_name: form.sponsor_name.value.trim() || null,
          sponsor_url: sponsorUrl || null,
          species_ids: [...picked]
        };
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          if (t) {
            await backend.updateTournament(t.id, data);
            ctx.toast('Pakeitimai išsaugoti');
            ctx.navigate(`#/t/${t.id}`);
          } else {
            const id = await backend.createTournament(data);
            ctx.toast('Turnyras sukurtas');
            ctx.navigate(`#/t/${id}`);
          }
        } catch (err) {
          console.error(err);
          btn.disabled = false;
          fail(/limit|prasid|parą/i.test(err.message || '') ? err.message : `Nepavyko ${t ? 'išsaugoti' : 'sukurti turnyro'}. Bandyk dar kartą.`);
        }
      });
    }
  };
}
