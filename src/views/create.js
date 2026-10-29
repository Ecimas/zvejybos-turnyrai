import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { phase, LATE_JOIN, COEFS, coefText, count } from '../lib/format.js';
import { backButton, loginPrompt, empty, banNotice } from '../ui.js';
import { PRESETS, eur, parseEur, validateSplit, placeAmounts, sponsorTotal } from '../lib/prizes.js';
import { can } from '../lib/roles.js';

const pad = (n) => String(n).padStart(2, '0');
const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const SPONSOR_URL = /^https:\/\/[^\s<>"']{3,200}$/;
const DIV_NAME = /^[A-Za-z0-9ĄČĘĖĮŠŲŪŽąčęėįšųūž .,_+()-]+$/;
const FORMAT_HINT = {
  biggest: 'Laimi didžiausią žuvį pagavęs žvejys.',
  top_n_sum: 'Sumuojami kelių ilgiausių žuvų ilgiai.',
  species_points: 'Taškai = ilgis cm × rūšies koeficientas. Retesnėms rūšims duok didesnį koeficientą.',
  duels: 'Atkrintamosios poros: rate laimi daugiau pagavęs. Registracija tik iki starto; 8 dalyviai – 3 ratai, laikas padalinamas po lygiai.'
};
const TOPN_LABEL = {
  top_n_sum: 'Kiek ilgiausių žuvų sumuoti',
  species_points: 'Kiek geriausių žuvų įskaityti',
  duels: 'Kiek ilgiausių žuvų sumuoti kiekviename rate'
};

// Naujas turnyras (#/naujas) ir esamo redagavimas (#/t/:id/redaguoti): organizatorius – iki starto,
// administratorius – bet kada (prasidėjus – tik tai, kas nekeičia rezultatų; žr. 0026).
const LOCKED_KEYS = ['title', 'description', 'ends_at', 'visibility', 'leaderboard_hidden', 'late_join_minutes', 'prizes'];
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
  const admin = can(state, 'tournaments');
  let asOrganizer = true;
  if (editId) {
    t = await backend.tournament(editId);
    asOrganizer = !!t && t.organizer_id === state.user.id && phase(t) === 'soon';
    if (!t || (!asOrganizer && !admin)) {
      return { nav: 'turnyrai', html: html`<div class="screen">${backButton(`#/t/${editId}`)}<h1 class="sr-only" tabindex="-1">${heading}</h1>
        ${empty('Redaguoti negalima', 'Turnyrą gali keisti tik organizatorius ir tik iki starto.')}</div>` };
    }
  }
  // Vykstančio ar pasibaigusio turnyro taisyklės užrakintos – keičia tik administratorius ir tik tai, kas nekeičia rezultatų.
  const locked = !!t && phase(t) !== 'soon';
  const dis = locked ? 'disabled' : '';
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
  const pct = { ...(t?.species_pct || {}) };
  const myLeagues = backend.myLeagues ? await backend.myLeagues().catch(() => []) : [];
  let divisions = (t?.divisions || []).map((d) => ({ id: d.id, name: d.name }));
  let format = t?.format || 'biggest';
  // Viešus turnyrus kuria tik organizatoriai (0028); seni vieši lieka vieši.
  const canPublic = can(state, 'publish') || t?.visibility === 'public';
  let visibility = t?.visibility || (canPublic ? 'public' : 'private');
  // Ne organizatoriui – iš karto viršuje paaiškinam, kad turnyras bus su kvietimu, ir kaip tapti organizatoriumi.
  const orgReq = !canPublic && backend.myOrganizerRequest ? await backend.myOrganizerRequest().catch(() => null) : null;
  const orgCooling = orgReq?.status === 'rejected' && orgReq.decided_at && Date.parse(orgReq.decided_at) + 7 * 24 * 3600e3 > Date.now();
  const back = t ? `#/t/${t.id}` : '#/';

  return {
    nav: 'turnyrai',
    title: heading,
    html: html`<div class="screen has-cta">
      <header class="top-bar">${backButton(back)}<span class="muted strong">${heading}</span><span></span></header>
      <h1 class="display-lg" tabindex="-1">${t ? 'Keisk turnyrą' : 'Sukurk turnyrą'}</h1>
      <p class="muted">${t ? 'Keisti galima iki starto. Dalyviai matys naujas taisykles.' : 'Keturi laukai – ir turnyras paruoštas. Kol kas visi turnyrai nemokami.'}</p>
      ${canPublic ? '' : html`<div class="card stack-2 private-note" data-private-note>
        <p class="strong row gap-8">${icon('lock', 18, 2.6)}Turnyras bus tik su kvietimu</p>
        <p class="small muted">Jis nebus rodomas bendrame turnyrų sąraše. Sukūręs gausi nuorodą ir ja pakviesi draugus, klubo narius ar kitus žvejus.</p>
        <p class="small muted">Viešus turnyrus, kuriuos mato visi, kuria patvirtinti organizatoriai.</p>
        ${orgReq?.status === 'pending'
          ? html`<p class="small row gap-8 strong" data-org-status>${icon('clock', 16)}Tavo prašymas tapti organizatoriumi laukia patvirtinimo. Kai patvirtinsime, šį turnyrą iki starto galėsi padaryti viešą.</p>`
          : orgCooling ? html`<p class="small muted" data-org-status>Prašymas tapti organizatoriumi kol kas nepatvirtintas – pakartotinai paprašyti galėsi vėliau.</p>`
          : html`<a class="btn btn-ghost" href="#/organizatorius" data-org-request>${icon('trophy', 18)}Noriu viešo turnyro – tapti organizatoriumi</a>`}
      </div>`}
      ${t && !asOrganizer ? html`<div class="card stack-1 admin-note" data-admin-note>
        <p class="strong row gap-8">${icon('shield', 18)}Redaguoji kaip administratorius</p>
        <p class="small muted">${locked
          ? 'Turnyras jau prasidėjo, todėl formato, rūšių, pradžios, minimalaus ilgio, divizionų ir prizinio fondo keisti negalima. Gali taisyti pavadinimą, aprašymą, prizus, rėmėjus, matomumą ir pabaigos laiką.'
          : 'Gali keisti viską, kaip organizatorius.'} Pakeitimai įrašomi į žurnalą, organizatorius gaus pranešimą.</p>
      </div>` : ''}

      <form class="stack-lg" data-form novalidate>
        <label class="field"><span class="small muted strong">Pavadinimas</span>
          <input name="title" required minlength="3" maxlength="80" placeholder="pvz. Rudens lydekų taurė" value="${t?.title || ''}"></label>

        <fieldset class="field" ${dis}>
          <legend class="small muted strong">Formatas</legend>
          <div class="seg seg-grid">
            <button type="button" data-format="biggest" aria-pressed="${format === 'biggest'}">Didžiausia žuvis</button>
            <button type="button" data-format="top_n_sum" aria-pressed="${format === 'top_n_sum'}">Kelių ilgių suma</button>
            <button type="button" data-format="species_points" aria-pressed="${format === 'species_points'}">Taškai už rūšį</button>
            <button type="button" data-format="duels" aria-pressed="${format === 'duels'}">Dvikovos</button>
          </div>
          <p class="small muted" data-format-hint>${FORMAT_HINT[format]}</p>
          <label class="field" data-topn ${format === 'biggest' ? 'hidden' : ''}><span class="small muted" data-topn-label>${TOPN_LABEL[format] || ''}</span>
            <select name="top_n">${[1, 2, 3, 4, 5].map((n) => html`<option value="${n}" ${n === (t?.top_n || 3) ? 'selected' : ''}>${n}</option>`)}</select></label>
        </fieldset>

        <fieldset class="field" ${dis}>
          <legend class="small muted strong">Rūšys <span class="muted">(nieko nepažymėjus – visos)</span></legend>
          <div class="chips">${popular.map((s) => html`<button type="button" class="sp-chip" data-sp="${s.id}" aria-pressed="${picked.has(s.id)}">${s.name_lt}</button>`)}</div>
          <div class="list" data-coefs ${format === 'species_points' ? '' : 'hidden'}></div>
        </fieldset>

        <div class="grid-2">
          <label class="field"><span class="small muted strong">Pradžia</span>
            <input type="datetime-local" name="starts_at" required value="${local(start)}" ${dis}></label>
          <label class="field"><span class="small muted strong">Pabaiga</span>
            <input type="datetime-local" name="ends_at" required value="${local(end)}"></label>
        </div>

        <label class="field"><span class="small muted strong">Minimalus ilgis, cm (nebūtina)</span>
          <input type="number" name="min_cm" min="0" max="200" inputmode="numeric" placeholder="0" value="${t?.min_length_mm ? t.min_length_mm / 10 : ''}" ${dis}></label>

        <fieldset class="field">
          <legend class="small muted strong">Kas gali dalyvauti</legend>
          <div class="seg">
            <button type="button" data-vis="public" aria-pressed="${visibility === 'public'}" ${canPublic ? '' : 'disabled'}>Visi</button>
            <button type="button" data-vis="private" aria-pressed="${visibility === 'private'}">Tik su kvietimu</button>
          </div>
          <span class="small muted" data-vis-hint>${visibility === 'private' ? 'Turnyras nerodomas sąraše. Po sukūrimo gausi kvietimo nuorodą.' : 'Turnyras matomas visiems sąraše.'}</span>
          ${canPublic ? '' : html`<p class="small public-hint" data-public-hint>${icon('lock', 14, 2.6)} Viešus turnyrus (matomus visų sąraše) kuria patvirtinti organizatoriai. <a class="link" href="#/organizatorius">Tapti organizatoriumi</a></p>`}
        </fieldset>

        <label class="field" data-not-duels ${format === 'duels' ? 'hidden' : ''}><span class="small muted strong">Registracija po starto</span>
          <select name="late_join">${LATE_JOIN.map(([v, label]) => html`<option value="${v === null ? '' : v}" ${(t?.late_join_minutes ?? null) === v ? 'selected' : ''}>${label}</option>`)}</select>
          <span class="small muted">Kiek laiko po starto dar galima prisijungti prie turnyro.</span></label>

        <label class="check-row" data-not-duels ${format === 'duels' ? 'hidden' : ''}><input type="checkbox" name="team_mode" ${t?.team_mode ? 'checked' : ''} ${dis}>
          <span class="stack-1"><span class="strong">Komandinė įskaita (klubai)</span><span class="small muted">Dalyviai atstovauja savo klubams; klubo rezultatas – 3 geriausių narių suma.</span></span></label>

        <label class="check-row" data-not-duels ${format === 'duels' ? 'hidden' : ''}><input type="checkbox" name="leaderboard_hidden" ${t?.leaderboard_hidden ? 'checked' : ''}>
          <span class="stack-1"><span class="strong">Slėpti lentelę iki pabaigos</span><span class="small muted">Dalyviai mato tik savo rezultatą – intriga iki paskutinės minutės.</span></span></label>

        <fieldset class="field stack" ${dis}>
          <legend class="small muted strong">Divizionai (nebūtina, iki 8)</legend>
          <span class="small muted">Atskiros įskaitos tame pačiame turnyre, pvz. „Jaunimas“, „Moterys“, „Valtis“. Dalyvis pasirenka divizioną registruodamasis.</span>
          <div class="stack-2" data-div-rows></div>
          <button type="button" class="btn btn-ghost" data-add-div>${icon('plus', 18, 2.6)}Pridėti divizioną</button>
        </fieldset>

        ${myLeagues.length || t?.league_id ? html`<label class="field"><span class="small muted strong">Sezono lyga</span>
          <select name="league_id" ${dis}><option value="">Be lygos</option>${myLeagues.map((l) => html`<option value="${l.id}" ${t?.league_id === l.id ? 'selected' : ''}>${l.name} · ${l.season}</option>`)}</select>
          <span class="small muted">Vietos šiame turnyre duos taškų lygos lentelėje.</span></label>`
        : html`<p class="small muted">Rengi kelis etapus per sezoną? <a class="link" href="#/lygos">Sukurk sezono lygą</a> ir įtrauk į ją turnyrus.</p>`}

        <fieldset class="field card stack" ${dis}>
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

        ${t ? html`<a class="card card-link row gap-10" href="#/t/${t.id}/remejai" data-sponsors-link>${icon('star', 20)}
          <span class="grow stack-1"><span class="strong">Rėmėjai ir jų logotipai</span><span class="small muted">${t.sponsors?.length ? count(t.sponsors.length, 'rėmėjas', 'rėmėjai', 'rėmėjų') : 'Dar nėra'} · tvarkoma atskirai, galima ir vykstant turnyrui</span></span>${icon('chevron', 18)}</a>` : ''}
        <fieldset class="field stack" ${t ? 'hidden' : ''}>
          <legend class="small muted strong">Rėmėjai (nebūtina, iki 10)</legend>
          <span class="small muted">Logotipus, generalinį rėmėją ir pasiūlymus dalyviams pridėsi sukūręs turnyrą – skiltyje „Rėmėjai“.</span>
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
        ${t ? html`<button type="button" class="btn btn-ghost bad" data-delete aria-expanded="false">${icon('x', 18, 2.4)}${asOrganizer ? 'Ištrinti turnyrą' : 'Pašalinti turnyrą'}</button>` : ''}
        ${t && !asOrganizer ? html`<div class="card stack-2" data-del-box hidden>
          <label class="field"><span class="small muted strong">Pašalinimo priežastis</span>
            <textarea data-del-reason rows="2" maxlength="300" placeholder="pvz. Netikras turnyras, dalyvių skundai"></textarea>
            <span class="small muted">Priežastį pranešimu gaus ${count(Number(t.participants) || 0, 'dalyvis', 'dalyviai', 'dalyvių')} ir organizatorius. Laimikiai liks žvejų dienoraščiuose, bet turnyro, jo lentelės ir pranešimų nebeliks.</span></label>
          <button type="button" class="btn bad" data-del-confirm>${icon('x', 18, 2.4)}Pašalinti galutinai</button>
        </div>` : ''}
      </form>
    </div>
    <div class="cta-bar"><button class="btn btn-primary btn-lg" data-submit>${icon('check', 22, 3)}${t ? 'Išsaugoti pakeitimus' : 'Sukurti turnyrą'}</button></div>`,
    mount(root) {
      const form = root.querySelector('[data-form]');
      const coefBox = root.querySelector('[data-coefs]');
      const renderCoefs = () => {
        coefBox.hidden = format !== 'species_points';
        const list = popular.filter((x) => picked.has(x.id));
        coefBox.innerHTML = String(list.length ? html`${list.map((x) => html`<label class="list-row"><span class="grow strong">${x.name_lt}</span>
          <select data-coef="${x.id}" aria-label="${x.name_lt} koeficientas">${COEFS.map((c) => html`<option value="${c}" ${(pct[x.id] ?? 100) === c ? 'selected' : ''}>${coefText(c)}</option>`)}</select></label>`)}`
          : html`<p class="small warn">Pažymėk rūšis – kiekvienai galėsi nurodyti koeficientą.</p>`);
      };
      coefBox.addEventListener('change', (e) => {
        if (e.target.dataset.coef) pct[e.target.dataset.coef] = Number(e.target.value);
      });
      renderCoefs();
      root.querySelectorAll('[data-format]').forEach((b) => b.addEventListener('click', () => {
        format = b.dataset.format;
        root.querySelectorAll('[data-format]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        root.querySelector('[data-topn]').hidden = format === 'biggest';
        root.querySelector('[data-topn-label]').textContent = TOPN_LABEL[format] || '';
        root.querySelector('[data-format-hint]').textContent = FORMAT_HINT[format];
        root.querySelectorAll('[data-not-duels]').forEach((el) => { el.hidden = format === 'duels'; });
        if (format === 'top_n_sum' && form.top_n.value === '1') form.top_n.value = '3';
        renderCoefs();
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
        renderCoefs();
      }));

      // --- Divizionai ---
      const divRows = root.querySelector('[data-div-rows]');
      const renderDivs = () => {
        divRows.innerHTML = String(html`${divisions.map((d, i) => html`<div class="row gap-8" data-div="${i}">
          <input class="grow" data-div-name maxlength="30" placeholder="pvz. Jaunimas" value="${d.name}" aria-label="Divizionas ${i + 1}">
          <button type="button" class="icon-btn" data-div-remove="${i}" aria-label="Pašalinti divizioną ${i + 1}">${icon('x', 18, 2.4)}</button>
        </div>`)}`);
        root.querySelector('[data-add-div]').hidden = divisions.length >= 8;
      };
      divRows.addEventListener('input', (e) => {
        const row = e.target.closest('[data-div]');
        if (row) divisions[Number(row.dataset.div)].name = e.target.value;
      });
      divRows.addEventListener('click', (e) => {
        const b = e.target.closest('[data-div-remove]');
        if (b) { divisions.splice(Number(b.dataset.divRemove), 1); renderDivs(); }
      });
      root.querySelector('[data-add-div]').addEventListener('click', () => {
        divisions.push({ name: '' });
        renderDivs();
        divRows.querySelector(`[data-div="${divisions.length - 1}"] input`).focus();
      });
      renderDivs();
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

      const delBox = root.querySelector('[data-del-box]');
      root.querySelector('[data-del-confirm]')?.addEventListener('click', async (e) => {
        const reason = root.querySelector('[data-del-reason]').value.trim();
        if (reason.length < 5) return fail('Nurodyk pašalinimo priežastį (bent 5 simboliai).');
        e.currentTarget.disabled = true;
        try {
          await backend.adminDeleteTournament(t.id, reason);
          ctx.toast('Turnyras pašalintas');
          ctx.navigate('#/');
        } catch (err) {
          e.currentTarget.disabled = false;
          fail(err.message || 'Nepavyko pašalinti');
        }
      });
      root.querySelector('[data-delete]')?.addEventListener('click', async (e) => {
        if (delBox) {
          delBox.hidden = !delBox.hidden;
          e.currentTarget.setAttribute('aria-expanded', String(!delBox.hidden));
          if (!delBox.hidden) { delBox.scrollIntoView({ block: 'center' }); root.querySelector('[data-del-reason]').focus(); }
          return;
        }
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
        let startsAt = locked ? new Date(t.starts_at) : new Date(form.starts_at.value);
        const endsAt = new Date(form.ends_at.value);
        const minCm = Number(form.min_cm.value || 0);
        const fund = fundCents();
        if (title.length < 3) return fail('Pavadinimas per trumpas.');
        if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return fail('Nurodyk pradžią ir pabaigą.');
        if (endsAt <= startsAt) return fail('Pabaiga turi būti vėliau nei pradžia.');
        if (endsAt - startsAt > 120 * 24 * 3600e3) return fail('Turnyras gali trukti ne ilgiau kaip 120 dienų.');
        if (locked) {
          if (endsAt < Date.now() - 60e3) return fail('Pabaiga negali būti praeityje.');
        } else {
          if (startsAt < Date.now() - 5 * 60e3) return fail('Pradžia negali būti praeityje.');
          // Pradžia „dabar“ -> po 2 min.: duomenų bazė leidžia keisti turnyro rūšis tik iki starto.
          const soonest = new Date(Date.now() + 2 * 60e3);
          if (startsAt < soonest) startsAt = soonest;
        }
        if (endsAt <= startsAt) return fail('Pabaiga turi būti vėliau nei pradžia.');
        if (!Number.isFinite(minCm) || minCm < 0 || minCm > 200) return fail('Minimalus ilgis turi būti 0–200 cm.');
        if (!Number.isFinite(fund)) return fail('Prizinis fondas: įrašyk sumą eurais, pvz. 500 arba 250,50.');
        if (fund > 10000000) return fail('Prizinis fondas negali viršyti 100 000 €.');
        if (fund > 0) {
          const splitErr = validateSplit(split);
          if (splitErr) return fail(`Prizinis fondas: ${splitErr.charAt(0).toLowerCase()}${splitErr.slice(1)}.`);
        }
        if (format === 'species_points' && !picked.size) return fail('Taškams už rūšį pažymėk bent vieną rūšį ir jos koeficientą.');
        const cleanDivs = divisions.map((d) => ({ ...d, name: d.name.trim() })).filter((d) => d.name || d.id);
        if (cleanDivs.some((d) => d.name.length < 2 || d.name.length > 30 || !DIV_NAME.test(d.name))) return fail('Diviziono pavadinimas: 2–30 raidžių, skaičių ar tarpų.');
        if (new Set(cleanDivs.map((d) => d.name.toLowerCase())).size !== cleanDivs.length) return fail('Divizionų pavadinimai turi skirtis.');
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
          top_n: format === 'biggest' ? 3 : format === 'top_n_sum' ? Math.max(2, Number(form.top_n.value)) : Number(form.top_n.value),
          min_length_mm: Math.round(minCm * 10),
          // Nepakeistas laikas – tikslus senasis (forma rodo tik minutes, todėl kitaip „pasikeistų“ sekundės).
          starts_at: t && form.starts_at.value === local(start) ? t.starts_at : startsAt.toISOString(),
          ends_at: t && form.ends_at.value === local(end) ? t.ends_at : endsAt.toISOString(),
          visibility,
          leaderboard_hidden: format !== 'duels' && form.leaderboard_hidden.checked,
          team_mode: format !== 'duels' && form.team_mode.checked,
          late_join_minutes: format === 'duels' ? 0 : form.late_join.value === '' ? null : Number(form.late_join.value),
          prizes: form.prizes.value.trim() || null,
          prize_fund_cents: fund,
          prize_split: fund > 0 ? split.slice() : null,
          ...(t ? {} : { sponsors: cleanSponsors }), // esamo turnyro rėmėjai – skiltyje „Rėmėjai“ (su logotipais)
          species_ids: [...picked],
          species_pct: format === 'species_points' ? Object.fromEntries([...picked].map((sid) => [sid, pct[sid] ?? 100])) : {},
          divisions: cleanDivs,
          ...(form.league_id ? { league_id: form.league_id.value || null } : {})
        };
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          if (t) {
            await backend.updateTournament(t.id, locked ? Object.fromEntries(LOCKED_KEYS.map((k) => [k, data[k]])) : data);
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
            : /limit|prasid|parą|praeity|taisykl/i.test(err.message || '') ? err.message : `Nepavyko ${t ? 'išsaugoti' : 'sukurti turnyro'}. Bandyk dar kartą.`);
        }
      });
    }
  };
}
