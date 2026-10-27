import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { phase, LATE_JOIN } from '../lib/format.js';
import { backButton, loginPrompt, empty, banNotice } from '../ui.js';
import { PRESETS, eur, parseEur, validateSplit, placeAmounts, sponsorTotal } from '../lib/prizes.js';

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
  if (state.ban) {
    return { nav: 'turnyrai', html: html`<div class="screen">${backButton('#/')}<h1 class="display-lg" tabindex="-1">${heading}</h1>${banNotice(state.ban)}</div>` };
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
    nav: 'turnyrai',
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

        <label class="field"><span class="small muted strong">Registracija po starto</span>
          <select name="late_join">${LATE_JOIN.map(([v, label]) => html`<option value="${v === null ? '' : v}" ${(t?.late_join_minutes ?? null) === v ? 'selected' : ''}>${label}</option>`)}</select>
          <span class="small muted">Kiek laiko po starto dar galima prisijungti prie turnyro.</span></label>

        <label class="check-row"><input type="checkbox" name="leaderboard_hidden" ${t?.leaderboard_hidden ? 'checked' : ''}>
          <span class="stack-1"><span class="strong">Slėpti lentelę iki pabaigos</span><span class="small muted">Dalyviai mato tik savo rezultatą – intriga iki paskutinės minutės.</span></span></label>

        <fieldset class="field card stack">
          <legend class="small muted strong">Prizinis fondas (nebūtina)</legend>
          <label class="field"><span class="small muted strong">Fondo suma, €</span>
            <input name="prize_fund" inputmode="decimal" maxlength="10" autocomplete="off" placeholder="pvz. 500"
                   value="${t?.prize_fund_cents ? String(t.prize_fund_cents / 100).replace('.', ',') : ''}"></label>
          <div class="stack" data-split-wrap ${t?.prize_fund_cents ? '' : 'hidden'}>
            <span class="small muted strong">Kaip padalinti vietoms</span>
            <div class="chips">${PRESETS.map((pr) => html`<button type="button" class="sp-chip" data-preset="${pr.key}">${pr.label}</button>`)}</div>
            <div class="list" data-split-rows></div>
            <button type="button" class="btn-text" data-add-place>${icon('plus', 16, 2.6)}Pridėti vietą</button>
            <p class="small" data-split-msg aria-live="polite"></p>
          </div>
          <p class="small muted">Pinigų programėlė neperveda – fondą išmoka organizatorius arba rėmėjai.</p>
        </fieldset>

        <fieldset class="field stack">
          <legend class="small muted strong">Rėmėjai (nebūtina, iki 10)</legend>
          <div class="stack" data-sponsor-rows></div>
          <button type="button" class="btn btn-ghost" data-add-sponsor>${icon('plus', 18, 2.6)}Pridėti rėmėją</button>
          <div class="row-between gap-8" data-sponsor-sum hidden>
            <span class="small muted" data-sponsor-sum-text></span>
            <button type="button" class="btn-text" data-use-sum>Naudoti kaip fondą</button>
          </div>
        </fieldset>

        <label class="field"><span class="small muted strong">Daiktiniai prizai (nebūtina)</span>
          <textarea name="prizes" rows="3" maxlength="500" placeholder="pvz. 1 vieta – spiningas, 2 vieta – ritė">${t?.prizes || ''}</textarea></label>

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

      // --- Prizinis fondas ir padalijimas ---
      let split = Array.isArray(t?.prize_split) && t.prize_split.length ? t.prize_split.slice() : [50, 30, 20];
      const fundInput = form.prize_fund;
      const splitWrap = root.querySelector('[data-split-wrap]');
      const splitRows = root.querySelector('[data-split-rows]');
      const splitMsg = root.querySelector('[data-split-msg]');
      const fundCents = () => parseEur(fundInput.value);

      function renderSplit() {
        const fund = fundCents();
        const amounts = Number.isFinite(fund) ? placeAmounts(fund, split) : [];
        splitRows.innerHTML = String(html`${split.map((pct, i) => html`<div class="list-row split-row">
          <span class="strong place">${i + 1} vieta</span>
          <input class="pct" data-pct="${i}" inputmode="numeric" maxlength="3" value="${pct}" aria-label="${i + 1} vietos procentas">
          <span class="muted">%</span>
          <span class="grow right num-sm" data-amount="${i}">${amounts[i] !== undefined ? eur(amounts[i]) : ''}</span>
          ${i === split.length - 1 && split.length > 1
            ? html`<button type="button" class="icon-btn small-btn" data-remove-place aria-label="Pašalinti ${i + 1} vietą">${icon('x', 16, 2.4)}</button>`
            : html`<span class="small-btn"></span>`}
        </div>`)}`);
        root.querySelectorAll('[data-preset]').forEach((b) => {
          const pr = PRESETS.find((x) => x.key === b.dataset.preset);
          b.setAttribute('aria-pressed', String(pr.split.join() === split.join()));
        });
        updateSplitMsg();
      }
      function updateSplitMsg() {
        const err = validateSplit(split);
        const sum = split.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
        splitMsg.textContent = err || `Viso 100 % · ${split.length} ${split.length === 1 ? 'prizinė vieta' : 'prizinės vietos'}`;
        splitMsg.className = `small ${err ? 'bad' : 'ok'}`;
        if (!err && sum === 100) {
          const amounts = placeAmounts(fundCents() || 0, split);
          root.querySelectorAll('[data-amount]').forEach((el) => { el.textContent = amounts[el.dataset.amount] !== undefined ? eur(amounts[el.dataset.amount]) : ''; });
        }
      }
      splitRows.addEventListener('input', (e) => {
        const i = e.target.dataset.pct;
        if (i === undefined) return;
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 3);
        split[Number(i)] = Number(e.target.value || 0);
        root.querySelectorAll('[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
        updateSplitMsg();
      });
      splitRows.addEventListener('click', (e) => {
        if (e.target.closest('[data-remove-place]')) { split.pop(); renderSplit(); }
      });
      root.querySelector('[data-add-place]').addEventListener('click', () => {
        if (split.length >= 10) { ctx.toast('Daugiausia 10 prizinių vietų'); return; }
        split.push(0);
        renderSplit();
        splitRows.querySelector(`[data-pct="${split.length - 1}"]`).focus();
      });
      root.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
        split = PRESETS.find((x) => x.key === b.dataset.preset).split.slice();
        renderSplit();
      }));
      fundInput.addEventListener('input', () => {
        splitWrap.hidden = !(fundCents() > 0);
        if (!splitWrap.hidden) updateSplitMsg();
        updateSponsorSum();
      });
      renderSplit();

      // --- Rėmėjai ---
      let sponsors = (t?.sponsors || []).map((x) => ({
        name: x.name || '', url: x.url || '', amount: x.amount_cents ? String(x.amount_cents / 100).replace('.', ',') : ''
      }));
      const sponsorRows = root.querySelector('[data-sponsor-rows]');
      function renderSponsors() {
        sponsorRows.innerHTML = String(html`${sponsors.map((sp, i) => html`<div class="card stack-2 sponsor-row" data-sponsor="${i}">
          <div class="row-between"><span class="small muted strong">Rėmėjas ${i + 1}</span>
            <button type="button" class="btn-text bad" data-remove-sponsor="${i}" aria-label="Pašalinti rėmėją ${i + 1}">Pašalinti</button></div>
          <input data-f="name" maxlength="60" placeholder="Pavadinimas" value="${sp.name}" aria-label="Rėmėjo ${i + 1} pavadinimas">
          <input data-f="url" maxlength="200" inputmode="url" placeholder="Svetainė https://… (nebūtina)" value="${sp.url}" aria-label="Rėmėjo ${i + 1} svetainė">
          <input data-f="amount" inputmode="decimal" maxlength="10" placeholder="Įnašas į fondą, € (nebūtina)" value="${sp.amount}" aria-label="Rėmėjo ${i + 1} įnašas, €">
        </div>`)}`);
        root.querySelector('[data-add-sponsor]').hidden = sponsors.length >= 10;
        updateSponsorSum();
      }
      function updateSponsorSum() {
        const total = sponsorTotal(sponsors.map((x) => ({ amount_cents: parseEur(x.amount) || 0 })));
        const box = root.querySelector('[data-sponsor-sum]');
        box.hidden = !total;
        if (!total) return;
        const fund = fundCents();
        root.querySelector('[data-sponsor-sum-text]').textContent = Number.isFinite(fund) && fund > 0
          ? `Rėmėjų įnašai: ${eur(total)} iš ${eur(fund)} fondo`
          : `Rėmėjų įnašai: ${eur(total)}`;
        root.querySelector('[data-use-sum]').hidden = fund === total;
      }
      sponsorRows.addEventListener('input', (e) => {
        const row = e.target.closest('[data-sponsor]');
        if (!row || !e.target.dataset.f) return;
        sponsors[Number(row.dataset.sponsor)][e.target.dataset.f] = e.target.value;
        if (e.target.dataset.f === 'amount') updateSponsorSum();
      });
      sponsorRows.addEventListener('click', (e) => {
        const b = e.target.closest('[data-remove-sponsor]');
        if (b) { sponsors.splice(Number(b.dataset.removeSponsor), 1); renderSponsors(); }
      });
      root.querySelector('[data-add-sponsor]').addEventListener('click', () => {
        sponsors.push({ name: '', url: '', amount: '' });
        renderSponsors();
        sponsorRows.querySelector(`[data-sponsor="${sponsors.length - 1}"] [data-f=name]`).focus();
      });
      root.querySelector('[data-use-sum]').addEventListener('click', () => {
        const total = sponsorTotal(sponsors.map((x) => ({ amount_cents: parseEur(x.amount) || 0 })));
        fundInput.value = String(total / 100).replace('.', ',');
        fundInput.dispatchEvent(new Event('input'));
      });
      renderSponsors();

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
        const fund = fundCents();
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
        if (!Number.isFinite(fund)) return fail('Prizinis fondas: įrašyk sumą eurais, pvz. 500 arba 250,50.');
        if (fund > 10000000) return fail('Prizinis fondas negali viršyti 100 000 €.');
        if (fund > 0) {
          const splitErr = validateSplit(split);
          if (splitErr) return fail(`Prizinis fondas: ${splitErr.charAt(0).toLowerCase()}${splitErr.slice(1)}.`);
        }
        const cleanSponsors = [];
        for (const [i, sp] of sponsors.entries()) {
          const name = sp.name.trim();
          const url = sp.url.trim();
          const amount = parseEur(sp.amount);
          if (!name && !url && !sp.amount.trim()) continue;
          if (!name) return fail(`Rėmėjas ${i + 1}: įrašyk pavadinimą.`);
          if (url && !SPONSOR_URL.test(url)) return fail(`Rėmėjas ${i + 1}: svetainė turi prasidėti https://`);
          if (!Number.isFinite(amount) || amount > 10000000) return fail(`Rėmėjas ${i + 1}: įnašą įrašyk eurais, pvz. 200.`);
          cleanSponsors.push({ name, url: url || null, amount_cents: amount || null });
        }
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
          late_join_minutes: form.late_join.value === '' ? null : Number(form.late_join.value),
          prizes: form.prizes.value.trim() || null,
          prize_fund_cents: fund,
          prize_split: fund > 0 ? split.slice() : null,
          sponsors: cleanSponsors,
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
          fail(/sponsor_limit/.test(err.message || '') ? 'Daugiausia 10 rėmėjų.'
            : /limit|prasid|parą/i.test(err.message || '') ? err.message : `Nepavyko ${t ? 'išsaugoti' : 'sukurti turnyro'}. Bandyk dar kartą.`);
        }
      });
    }
  };
}
