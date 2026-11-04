import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { phase, LATE_JOIN, COEFS, coefText, count, dateTime, cm } from '../lib/format.js';
import { backButton, loginPrompt, empty, banNotice, featureOffScreen, phaseBadge, avatar } from '../ui.js';
import { feat } from '../lib/clubs.js';
import { canCreateTournament } from '../lib/features.js';
import { PRESETS, eur, parseEur, validateSplit, placeAmounts, sponsorTotal } from '../lib/prizes.js';
import { can } from '../lib/roles.js';
import { openRulesBuilder, ruleCard, rulesLines, canCustomRules } from './rules.js';
import { sponsorEditor } from './sponsors.js';
import { shrinkCover } from '../lib/sponsors.js';
import { prizersSection, bindPrizers } from './messages.js';

const pad = (n) => String(n).padStart(2, '0');
const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const SPONSOR_URL = /^https:\/\/[^\s<>"']{3,200}$/;
const DIV_NAME = /^[A-Za-z0-9ĄČĘĖĮŠŲŪŽąčęėįšųūž .,_+()-]+$/;
const FORMAT_HINT = {
  biggest: 'Laimi didžiausią žuvį pagavęs žvejys.',
  top_n_sum: 'Sumuojami kelių ilgiausių žuvų ilgiai.',
  species_points: 'Taškai = ilgis cm × rūšies koeficientas. Retesnėms rūšims duok didesnį koeficientą.',
  duels: 'Atkrintamosios poros: rate laimi daugiau pagavęs. Registracija tik iki starto; 8 dalyviai – 3 ratai, laikas padalinamas po lygiai.',
  custom: 'Taškai skaičiuojami pagal tavo taisykles: rūšys ir jų minimumai, premijos, kas sumuojama. Rūšis ir min. ilgį nustato taisyklės.'
};
// Turnyras pagal svorį (0040): tik „Sunkiausia žuvis“ ir „Kelių svorių suma“.
const W_HINT = {
  biggest: 'Laimi sunkiausią žuvį pagavęs žvejys. Žuvis sveriama ir paleidžiama – svarstyklių rodmuo turi matytis nuotraukoje.',
  top_n_sum: 'Sumuojami kelių sunkiausių žuvų svoriai. Svarstyklių rodmuo turi matytis nuotraukoje.'
};
const W_LABEL = { biggest: 'Sunkiausia žuvis', top_n_sum: 'Kelių svorių suma' };
const TOPN_LABEL = {
  top_n_sum: 'Kiek ilgiausių žuvų sumuoti',
  species_points: 'Kiek geriausių žuvų įskaityti',
  duels: 'Kiek ilgiausių žuvų sumuoti kiekviename rate'
};

const FORMAT_LT = { biggest: 'Didžiausia žuvis', top_n_sum: 'Kelių ilgių suma', species_points: 'Taškai už rūšį', duels: 'Dvikovos', custom: 'Savos taisyklės' };
const fmtText = (f, n, m) => `${(m === 'weight' && W_LABEL[f]) || FORMAT_LT[f] || f}${['top_n_sum', 'species_points', 'duels'].includes(f) ? ` (${n})` : ''}`;
const MEASURE_LT = { length: 'Ilgis (liniuotė)', weight: 'Svoris (svarstyklės)' };
const kgText = (g) => `${String(Math.round(g / 10) / 100).replace('.', ',')} kg`;
const inviteLink = (code) => `${location.origin}${location.pathname}#/kvietimas/${code}`;

// Naujas turnyras (#/naujas) ir turnyro nustatymai (#/t/:id/redaguoti, 0035):
// organizatorius – iki starto viską, po starto – tik tai, kas nekeičia rezultatų; administratorius – taip pat;
// savininkas – viską bet kada (taisyklių pakeitimą su priežastimi gauna dalyviai).
const LOCKED_KEYS = ['title', 'description', 'ends_at', 'visibility', 'leaderboard_hidden', 'late_join_minutes', 'prizes'];
export async function createView(ctx, [editId] = [], query) {
  const clubId = !editId ? (query?.get?.('klubas') || '').replace(/[^\w-]/g, '') : '';
  const { backend, state } = ctx;
  const heading = editId ? 'Turnyro redagavimas' : 'Naujas turnyras';
  if (!state.user) {
    return { nav: 'turnyrai', html: html`<div class="screen">${backButton('#/')}<h1 class="display-lg" tabindex="-1">${heading}</h1>${loginPrompt('Prisijunk, kad galėtum kurti turnyrus.')}</div>` };
  }
  if (state.ban) {
    return { nav: 'turnyrai', html: html`<div class="screen">${backButton('#/')}<h1 class="display-lg" tabindex="-1">${heading}</h1>${banNotice(state.ban)}</div>` };
  }
  if (!editId && !canCreateTournament(state)) {
    return featureOffScreen('Naujas turnyras', 'Turnyrų kūrimas šiuo metu išjungtas', '#/', 'turnyrai');
  }
  let t = null;
  const admin = can(state, 'tournaments');
  const owner = can(state, 'roles');
  let asOrganizer = true;
  let mineT = false;
  if (editId) {
    t = await backend.tournament(editId);
    mineT = !!t && t.organizer_id === state.user.id;
    asOrganizer = mineT && phase(t) === 'soon';
    if (!t || (!mineT && !admin)) {
      return { nav: 'turnyrai', html: html`<div class="screen">${backButton(`#/t/${editId}`)}<h1 class="sr-only" tabindex="-1">${heading}</h1>
        ${empty('Redaguoti negalima', 'Turnyrą gali keisti tik jo organizatorius.')}</div>` };
    }
  }
  // Prasidėjusio turnyro taisyklės užrakintos – keisti jas gali tik savininkas (ir tada lentelė perskaičiuojama).
  const started = !!t && phase(t) !== 'soon';
  const locked = started && !owner;
  const rulesLive = started && owner;
  const dis = locked ? 'disabled' : '';
  const edit = !!t;
  // Nustatymų puslapiui: dalyviai ir jų vietos, rėmėjų redaktorius.
  const [people, board] = edit ? await Promise.all([
    backend.participantsAdmin ? backend.participantsAdmin(t.id).catch(() => null) : null,
    backend.leaderboard(t.id).catch(() => [])
  ]) : [null, []];
  const spEditor = edit ? sponsorEditor(ctx, t) : null;
  // Pasibaigusio turnyro prizininkai (0036): kam išsiųsta žinutė, ar organizatorius parašė, ar prizas įteiktas.
  const prizers = edit && phase(t) === 'done' && backend.prizeStatus ? await backend.prizeStatus(t.id).catch(() => []) : [];
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
  let measure = t?.measure === 'weight' ? 'weight' : 'length';
  // Savos taškų taisyklės (0033): tik organizatoriams. Turnyras saugo taisyklių kopiją.
  const canCustom = canCustomRules(state) || t?.format === 'custom';
  let myRules = canCustom && backend.myScoringRules ? await backend.myScoringRules().catch(() => []) : [];
  let chosenRule = t?.format === 'custom' && t.scoring
    ? (myRules.find((x) => x.id === t.scoring_rule_id && JSON.stringify(x.rules) === JSON.stringify(t.scoring))
      || { id: null, name: 'Šio turnyro taisyklės', rules: t.scoring })
    : null;
  // Viešus turnyrus kuria tik organizatoriai (0028); seni vieši lieka vieši.
  const canPublic = can(state, 'publish') || t?.visibility === 'public';
  let visibility = t?.visibility || (canPublic ? 'public' : 'private');
  // Ne organizatoriui – iš karto viršuje paaiškinam, kad turnyras bus su kvietimu, ir kaip tapti organizatoriumi.
  const orgReq = !canPublic && backend.myOrganizerRequest ? await backend.myOrganizerRequest().catch(() => null) : null;
  const orgCooling = orgReq?.status === 'rejected' && orgReq.decided_at && Date.parse(orgReq.decided_at) + 7 * 24 * 3600e3 > Date.now();
  const back = t ? `#/t/${t.id}` : '#/';

  // ---------------- Laukų fragmentai (tie patys kuriant ir redaguojant)
  const lockChip = rulesLive ? html`<span class="lockchip" data-lockchip>${icon('lock', 11, 2.6)}keičia rezultatus</span>`
    : locked ? html`<span class="lockchip muted-chip" data-lockchip>${icon('lock', 11, 2.6)}užrakinta</span>` : '';
  // Redaguojant – suskleidžiama eilutė „Pavadinimas … reikšmė ›“, kuriant – laukas kaip anksčiau.
  const row = (key, label, body) => (edit ? html`<details class="set-row" data-set-row="${key}">
      <summary><span class="strong">${label}</span><span class="set-v" data-sum="${key}"></span><span class="set-chev" aria-hidden="true">${icon('chevron', 16)}</span></summary>
      <div class="set-body">${body}</div></details>` : body);

  const titleF = html`<label class="field"><span class="small muted strong">Pavadinimas</span>
          <input name="title" required minlength="3" maxlength="80" placeholder="pvz. Rudens lydekų taurė" value="${t?.title || ''}"></label>`;
  const W = measure === 'weight';
  const formatF = html`<fieldset class="field" ${dis}>
          <legend class="small muted strong">Kaip matuojama</legend>
          <div class="seg" data-measure-seg>
            <button type="button" data-measure="length" aria-pressed="${!W}">${icon('ruler', 16, 2.4)}Ilgis</button>
            <button type="button" data-measure="weight" aria-pressed="${W}">${icon('scale', 16, 2.4)}Svoris</button>
          </div>
          <p class="small muted" data-measure-hint>${W ? 'Žuvys sveriamos svarstyklėmis – liniuotės nereikia. Laimikiai be svorio neįskaitomi.' : 'Žuvys matuojamos prie liniuotės.'}</p>
        </fieldset>
        <fieldset class="field" ${dis}>
          <legend class="small muted strong">Formatas</legend>
          <div class="seg seg-grid">
            <button type="button" data-format="biggest" aria-pressed="${format === 'biggest'}">${W ? W_LABEL.biggest : 'Didžiausia žuvis'}</button>
            <button type="button" data-format="top_n_sum" aria-pressed="${format === 'top_n_sum'}">${W ? W_LABEL.top_n_sum : 'Kelių ilgių suma'}</button>
            <button type="button" data-format="species_points" data-len-only aria-pressed="${format === 'species_points'}" ${W ? 'hidden' : ''}>Taškai už rūšį</button>
            ${feat(state, 'duels') || t?.format === 'duels' ? html`<button type="button" data-format="duels" data-len-only aria-pressed="${format === 'duels'}" ${W ? 'hidden' : ''}>Dvikovos</button>` : ''}
            ${canCustom ? html`<button type="button" data-format="custom" data-len-only aria-pressed="${format === 'custom'}" ${W ? 'hidden' : ''}>Savos taisyklės</button>` : ''}
          </div>
          <p class="small muted" data-format-hint>${(W && W_HINT[format]) || FORMAT_HINT[format]}</p>
          <label class="field" data-topn ${format === 'biggest' || format === 'custom' ? 'hidden' : ''}><span class="small muted" data-topn-label>${W && format === 'top_n_sum' ? 'Kiek sunkiausių žuvų sumuoti' : TOPN_LABEL[format] || ''}</span>
            <select name="top_n">${[1, 2, 3, 4, 5].map((n) => html`<option value="${n}" ${n === (t?.top_n || 3) ? 'selected' : ''}>${n}</option>`)}</select></label>
        </fieldset>`;
  const customF = canCustom ? html`<fieldset class="field stack-2" data-custom ${format === 'custom' ? '' : 'hidden'} ${dis}>
          <legend class="small muted strong">Taškų taisyklės</legend>
          <div class="stack-2" data-rule-list></div>
          ${locked ? '' : html`<button type="button" class="btn btn-ghost" data-rule-new>${icon('plus', 18, 2.6)}Kurti naujas taisykles</button>`}
          <ul class="plain small muted rb-desc" data-rule-desc></ul>
        </fieldset>` : '';
  const speciesF = html`<fieldset class="field" data-species-box ${format === 'custom' ? 'hidden' : ''} ${dis}>
          <legend class="small muted strong">Rūšys <span class="muted">(nieko nepažymėjus – visos)</span></legend>
          <div class="chips">${popular.map((s) => html`<button type="button" class="sp-chip" data-sp="${s.id}" aria-pressed="${picked.has(s.id)}">${s.name_lt}</button>`)}</div>
          <div class="list" data-coefs ${format === 'species_points' ? '' : 'hidden'}></div>
        </fieldset>`;
  const datesF = html`<div class="grid-2">
          <label class="field"><span class="small muted strong">Pradžia ${edit && started ? lockChip : ''}</span>
            <input type="datetime-local" name="starts_at" required value="${local(start)}" ${dis}></label>
          <label class="field"><span class="small muted strong">Pabaiga</span>
            <input type="datetime-local" name="ends_at" required value="${local(end)}"></label>
        </div>`;
  const minF = html`<label class="field" data-min-box ${format === 'custom' || W ? 'hidden' : ''}><span class="small muted strong">Minimalus ilgis, cm (nebūtina)</span>
          <input type="number" name="min_cm" min="0" max="200" inputmode="numeric" placeholder="0" value="${t?.min_length_mm ? t.min_length_mm / 10 : ''}" ${dis}></label>
        <label class="field" data-minw-box ${W ? '' : 'hidden'}><span class="small muted strong">Minimalus svoris, kg (nebūtina)</span>
          <input type="text" name="min_kg" inputmode="decimal" maxlength="6" autocomplete="off" placeholder="pvz. 5" value="${t?.min_weight_g ? String(t.min_weight_g / 1000).replace('.', ',') : ''}" ${dis}></label>`;
  const visF = html`<fieldset class="field">
          <legend class="small muted strong">Kas gali dalyvauti</legend>
          <div class="seg">
            <button type="button" data-vis="public" aria-pressed="${visibility === 'public'}" ${canPublic ? '' : 'disabled'}>Visi</button>
            <button type="button" data-vis="private" aria-pressed="${visibility === 'private'}">Tik su kvietimu</button>
          </div>
          <span class="small muted" data-vis-hint>${visibility === 'private' ? 'Turnyras nerodomas sąraše. Po sukūrimo gausi kvietimo nuorodą.' : 'Turnyras matomas visiems sąraše.'}</span>
          ${canPublic ? '' : html`<p class="small public-hint" data-public-hint>${icon('lock', 14, 2.6)} Viešus turnyrus (matomus visų sąraše) kuria patvirtinti organizatoriai. <a class="link" href="#/organizatorius">Tapti organizatoriumi</a></p>`}
        </fieldset>`;
  const lateF = html`<label class="field" data-not-duels ${format === 'duels' ? 'hidden' : ''}><span class="small muted strong">Registracija po starto</span>
          <select name="late_join">${LATE_JOIN.map(([v, label]) => html`<option value="${v === null ? '' : v}" ${(t?.late_join_minutes ?? null) === v ? 'selected' : ''}>${label}</option>`)}</select>
          <span class="small muted">Kiek laiko po starto dar galima prisijungti prie turnyro.</span></label>`;
  const teamF = html`<label class="check-row" data-not-duels ${format === 'duels' ? 'hidden' : ''}><input type="checkbox" name="team_mode" ${t?.team_mode ? 'checked' : ''} ${dis}>
          <span class="stack-1"><span class="strong">Komandinė įskaita (klubai)</span><span class="small muted">Dalyviai atstovauja savo klubams; klubo rezultatas – 3 geriausių narių suma.</span></span></label>`;
  const hiddenF = html`<label class="check-row" data-not-duels ${format === 'duels' ? 'hidden' : ''}><input type="checkbox" name="leaderboard_hidden" ${t?.leaderboard_hidden ? 'checked' : ''}>
          <span class="stack-1"><span class="strong">Slėpti lentelę iki pabaigos</span><span class="small muted">Dalyviai mato tik savo rezultatą – intriga iki paskutinės minutės.</span></span></label>`;
  const divF = html`<fieldset class="field stack" ${dis}>
          <legend class="small muted strong">Divizionai (nebūtina, iki 8)</legend>
          <span class="small muted">Atskiros įskaitos tame pačiame turnyre, pvz. „Jaunimas“, „Moterys“, „Valtis“. Dalyvis pasirenka divizioną registruodamasis.</span>
          <div class="stack-2" data-div-rows></div>
          <button type="button" class="btn btn-ghost" data-add-div>${icon('plus', 18, 2.6)}Pridėti divizioną</button>
        </fieldset>`;
  const leagueSelect = (feat(state, 'leagues') || t?.league_id) && (myLeagues.length || t?.league_id);
  const leagueF = !feat(state, 'leagues') && !t?.league_id ? '' : leagueSelect ? html`<label class="field"><span class="small muted strong">Sezono lyga</span>
          <select name="league_id" ${dis}><option value="">Be lygos</option>${myLeagues.map((l) => html`<option value="${l.id}" ${t?.league_id === l.id ? 'selected' : ''}>${l.name} · ${l.season}</option>`)}
            ${t?.league_id && !myLeagues.some((l) => l.id === t.league_id) && t.league ? html`<option value="${t.league_id}" selected>${t.league.name} · ${t.league.season}</option>` : ''}</select>
          <span class="small muted">Vietos šiame turnyre duos taškų lygos lentelėje.</span></label>`
    : html`<p class="small muted">Rengi kelis etapus per sezoną? <a class="link" href="#/lygos">Sukurk sezono lygą</a> ir įtrauk į ją turnyrus.</p>`;
  const fundF = html`<fieldset class="field ${edit ? '' : 'card'} stack" ${dis}>
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
        </fieldset>`;
  const sponsorsCreateF = html`<fieldset class="field stack" ${t ? 'hidden' : ''}>
          <legend class="small muted strong">Rėmėjai (nebūtina, iki 10)</legend>
          <span class="small muted">Logotipus, generalinį rėmėją ir pasiūlymus dalyviams pridėsi sukūręs turnyrą – skiltyje „Rėmėjai“.</span>
          <div class="stack" data-sponsor-rows></div>
          <button type="button" class="btn btn-ghost" data-add-sponsor>${icon('plus', 18, 2.6)}Pridėti rėmėją</button>
          <div class="row-between gap-8" data-sponsor-sum hidden>
            <span class="small muted" data-sponsor-sum-text></span>
            <button type="button" class="btn-text" data-use-sum>Naudoti kaip fondą</button>
          </div>
        </fieldset>`;
  const prizesF = html`<label class="field"><span class="small muted strong">Daiktiniai prizai (nebūtina)</span>
          <textarea name="prizes" rows="3" maxlength="500" placeholder="pvz. 1 vieta – spiningas, 2 vieta – ritė">${t?.prizes || ''}</textarea></label>`;
  const descF = html`<label class="field"><span class="small muted strong">Aprašymas (nebūtina)</span>
          <textarea name="description" rows="3" maxlength="2000" placeholder="Papildomos taisyklės">${t?.description || ''}</textarea></label>`;
  const errorF = html`<p class="form-error bad small" data-error hidden role="alert"></p>`;
  // Ištrinti: organizatorius – iki starto; administratorius – pašalinti su priežastimi bet kada.
  const canDelete = t && (asOrganizer || admin);
  const deleteF = canDelete ? html`<button type="button" class="btn btn-ghost bad" data-delete aria-expanded="false">${icon('x', 18, 2.4)}${asOrganizer ? 'Ištrinti turnyrą' : 'Pašalinti turnyrą'}</button>
        ${!asOrganizer ? html`<div class="card stack-2" data-del-box hidden>
          <label class="field"><span class="small muted strong">Pašalinimo priežastis</span>
            <textarea data-del-reason rows="2" maxlength="300" placeholder="pvz. Netikras turnyras, dalyvių skundai"></textarea>
            <span class="small muted">Priežastį pranešimu gaus ${count(Number(t.participants) || 0, 'dalyvis', 'dalyviai', 'dalyvių')} ir organizatorius. Laimikiai liks žvejų dienoraščiuose, bet turnyro, jo lentelės ir pranešimų nebeliks.</span></label>
          <button type="button" class="btn bad" data-del-confirm>${icon('x', 18, 2.4)}Pašalinti galutinai</button>
        </div>` : ''}` : '';

  const privateNote = canPublic ? '' : html`<div class="card stack-2 private-note" data-private-note>
        <p class="strong row gap-8">${icon('lock', 18, 2.6)}Turnyras bus tik su kvietimu</p>
        <p class="small muted">Jis nebus rodomas bendrame turnyrų sąraše. Sukūręs gausi nuorodą ir ja pakviesi draugus, klubo narius ar kitus žvejus.</p>
        <p class="small muted">Viešus turnyrus, kuriuos mato visi, kuria patvirtinti organizatoriai.</p>
        ${orgReq?.status === 'pending'
          ? html`<p class="small row gap-8 strong" data-org-status>${icon('clock', 16)}Tavo prašymas tapti organizatoriumi laukia patvirtinimo. Kai patvirtinsime, šį turnyrą iki starto galėsi padaryti viešą.</p>`
          : orgCooling ? html`<p class="small muted" data-org-status>Prašymas tapti organizatoriumi kol kas nepatvirtintas – pakartotinai paprašyti galėsi vėliau.</p>`
          : html`<a class="btn btn-ghost" href="#/organizatorius" data-org-request>${icon('trophy', 18)}Noriu viešo turnyro – tapti organizatoriumi</a>`}
      </div>`;

  // ---------------- Kūrimas: viena forma, kaip anksčiau
  if (!edit) {
    return {
      nav: 'turnyrai',
      title: heading,
      html: html`<div class="screen has-cta">
      <header class="top-bar">${backButton(back)}<span class="muted strong">${heading}</span><span></span></header>
      <h1 class="display-lg" tabindex="-1">Sukurk turnyrą</h1>
      <p class="muted">Keturi laukai – ir turnyras paruoštas. Kol kas visi turnyrai nemokami.</p>
      ${clubId ? html`<p class="card small row gap-8" data-club-note>${icon('users', 18)}Klubo turnyras: sukūrus, klubo nariai gaus kvietimą su nuoroda.</p>` : ''}
      ${privateNote}
      <form class="stack-lg" data-form novalidate>
        ${titleF}${formatF}${customF}${speciesF}${datesF}${minF}${visF}${lateF}${teamF}${hiddenF}${divF}${leagueF}${fundF}${sponsorsCreateF}${prizesF}${descF}${errorF}
      </form>
    </div>
    <div class="cta-bar"><button class="btn btn-primary btn-lg" data-submit>${icon('check', 22, 3)}Sukurti turnyrą</button></div>`,
      mount: (root) => mountForm(root)
    };
  }

  // ---------------- Turnyro nustatymai
  const notice = rulesLive ? html`<div class="owner-note" data-owner-note><span class="accent-ink">${icon('shield', 20)}</span><span class="stack-1">
        <b>Turnyras ${phase(t) === 'done' ? 'baigėsi' : 'vyksta'} – keiti kaip savininkas</b>
        <span class="small muted">Gali keisti viską. Taisyklių pakeitimus parodysime prieš išsaugant, lentelė bus perskaičiuota, dalyviai gaus pranešimą.</span></span></div>`
    : started ? html`<div class="card stack-1 admin-note" data-admin-note>
        <p class="strong row gap-8">${icon('lock', 18, 2.6)}Turnyras jau prasidėjo</p>
        <p class="small muted">Formato, rūšių, pradžios, minimalaus ilgio, divizionų ir prizinio fondo keisti negalima. Gali taisyti pavadinimą, aprašymą, prizus, pabaigą, matomumą, viršelį, rėmėjus, dalyvius ir kvietimą.${mineT ? '' : ' Pakeitimai įrašomi į žurnalą, organizatorius gaus pranešimą.'}</p></div>`
    : !mineT ? html`<div class="card stack-1 admin-note" data-admin-note>
        <p class="strong row gap-8">${icon('shield', 18)}Redaguoji kaip administratorius</p>
        <p class="small muted">Gali keisti viską, kaip organizatorius. Pakeitimai įrašomi į žurnalą, organizatorius gaus pranešimą.</p></div>`
    : html`<p class="small muted">Iki starto gali keisti viską. Dalyviai matys naujas taisykles.</p>`;

  const SECTIONS = [...(prizers.length ? [['set-prizers', 'Prizininkai']] : []), ['set-main', 'Pagrindinis'], ['set-rules', 'Taisyklės'], ['set-prizes', 'Prizai'], ['set-sponsors', 'Rėmėjai'], ['set-people', 'Dalyviai'], ['set-invite', 'Kvietimas']];
  const divName = (id) => (t.divisions || []).find((d) => d.id === id)?.name || '';
  const boardBy = new Map((board || []).map((r) => [r.user_id, r]));

  return {
    nav: 'turnyrai',
    title: `Nustatymai · ${t.title}`,
    html: html`<div class="screen has-cta settings">
      <header class="top-bar">${backButton(back, 'Atgal į turnyrą')}<span class="muted strong">Turnyro nustatymai</span>${phaseBadge(t)}</header>
      <h1 class="sr-only" tabindex="-1">Turnyro nustatymai · ${t.title}</h1>
      <div class="set-cover ${t.cover_url ? 'has-img' : ''}" data-cover>
        ${t.cover_url ? html`<img src="${t.cover_url}" alt="">` : ''}
        <span class="cv-t">${t.title}</span>
        <span class="cv-acts">
          ${t.cover_url ? html`<button type="button" class="cv-btn" data-cover-off aria-label="Pašalinti viršelį">${icon('x', 16, 2.6)}</button>` : ''}
          <label class="cv-btn">${icon('camera', 16)}<span>${t.cover_url ? 'Keisti viršelį' : 'Pridėti viršelį'}</span><input type="file" accept="image/*" data-cover-input hidden></label>
        </span>
      </div>
      ${notice}
      <nav class="stabs" data-stabs aria-label="Nustatymų skiltys">${SECTIONS.map(([id, label], i) => html`<button type="button" data-goto="${id}" aria-pressed="${i === 0}">${label}</button>`)}</nav>
      ${prizersSection(t, prizers, { organizer: mineT })}

      <form class="stack-lg" data-form novalidate>
        <section class="set-sec" id="set-main">
          <h2 class="h2">Pagrindinis</h2>
          ${titleF}${datesF}${descF}${visF}
          ${privateNote}
        </section>
        <section class="set-sec" id="set-rules">
          <div class="row-between"><h2 class="h2">Taisyklės</h2>${lockChip}</div>
          <div class="set-list">
            ${row('format', 'Formatas', html`${formatF}${customF}`)}
            ${row('species', 'Rūšys', speciesF)}
            ${row('min', W ? 'Min. svoris' : 'Min. ilgis', minF)}
            ${row('div', 'Divizionai', divF)}
            ${leagueSelect ? row('league', 'Sezono lyga', leagueF) : ''}
            ${row('team', 'Komandinė įskaita', teamF)}
          </div>
          ${leagueSelect ? '' : leagueF}
          <h3 class="h3">Eiga</h3>
          <div class="set-list">
            ${row('late', 'Registracija po starto', lateF)}
            ${row('hidden', 'Slėpti lentelę iki pabaigos', hiddenF)}
          </div>
        </section>
        <section class="set-sec" id="set-prizes">
          <div class="row-between"><h2 class="h2">Prizai</h2>${lockChip}</div>
          <div class="set-list">
            ${row('fund', 'Prizų fondas', fundF)}
            ${row('prizes', 'Daiktiniai prizai', prizesF)}
          </div>
        </section>
        ${errorF}
      </form>

      <section class="set-sec" id="set-sponsors">
        <div class="row-between"><h2 class="h2">Rėmėjai</h2><a class="link small" href="#/t/${t.id}/remejai" data-sponsors-link>Statistika${icon('chevron', 14)}</a></div>
        <p class="small muted">Logotipai rodomi turnyro puslapyje, sąraše, lentelėje ir dideliame ekrane. Išsaugoma kartu su kitais pakeitimais.</p>
        ${spEditor.html}
      </section>

      <section class="set-sec" id="set-people">
        <div class="row-between"><h2 class="h2">Dalyviai · <span data-people-count>${people ? people.length : t.participants}</span></h2>
          ${(t.divisions || []).length && people ? html`<span class="small muted">${t.divisions.map((d) => `${d.name} ${people.filter((x) => x.division_id === d.id).length}`).join(' · ')}</span>` : ''}</div>
        ${people ? html`
          ${people.length > 6 ? html`<label class="search-box"><span class="sr-only">Ieškoti dalyvio</span><input type="search" data-people-q placeholder="Ieškoti dalyvio" autocomplete="off"></label>` : ''}
          <ul class="plain set-people" data-people>${people.slice().sort((a, b) => (boardBy.get(a.user_id)?.rank ?? 1e9) - (boardBy.get(b.user_id)?.rank ?? 1e9) || a.nickname.localeCompare(b.nickname, 'lt')).map((x) => {
            const r = boardBy.get(x.user_id);
            const self = x.user_id === t.organizer_id;
            return html`<li class="p-row" data-person="${x.user_id}" data-nick="${x.nickname.toLowerCase()}">
              <div class="p-main">${avatar(x.nickname)}
                <span class="grow stack-1"><span class="strong ellipsis">${x.nickname}${self ? html` <span class="small muted">· organizatorius</span>` : ''}</span>
                  <span class="small muted">${r ? `${count(Number(r.counted) || 0, 'žuvis', 'žuvys', 'žuvų')}${r.rank ? ` · #${r.rank}` : ''}` : 'Įskaitytų laimikių nėra'}</span></span>
                ${divName(x.division_id) ? html`<span class="dchip" data-p-divname>${divName(x.division_id)}</span>` : html`<span data-p-divname></span>`}
                <button type="button" class="icon-btn p-more" data-p-more aria-expanded="false" aria-label="Veiksmai: ${x.nickname}">⋯</button></div>
              <div class="p-menu" data-p-menu hidden>
                ${(t.divisions || []).length ? html`<label class="field"><span class="small muted strong">Divizionas</span>
                  <select data-p-div aria-label="${x.nickname} divizionas"><option value="">Nepasirinktas</option>${t.divisions.map((d) => html`<option value="${d.id}" ${x.division_id === d.id ? 'selected' : ''}>${d.name}</option>`)}</select></label>` : ''}
                ${mineT && x.user_id !== state.user.id ? html`<button type="button" class="btn btn-ghost" data-p-write>${icon('chat', 16)}Rašyti žinutę</button>` : ''}
                <a class="btn btn-ghost" href="#/zvejys/${x.user_id}">${icon('user', 16)}Profilis</a>
                ${self ? '' : html`<button type="button" class="btn btn-ghost bad" data-p-remove>${icon('x', 16, 2.4)}Pašalinti iš turnyro</button>
                <div class="stack-2" data-p-confirm hidden>
                  <label class="field"><span class="small muted strong">Priežastis (gaus pranešime, nebūtina)</span>
                    <textarea data-p-reason rows="2" maxlength="300" placeholder="pvz. Nesilaikė taisyklių"></textarea></label>
                  <span class="small muted">Žvejo laimikiai liks jo dienoraštyje, bet šiame turnyre nebebus skaičiuojami.</span>
                  <button type="button" class="btn bad" data-p-remove-ok>Pašalinti ${x.nickname}</button>
                </div>`}
              </div>
            </li>`;
          })}</ul>
          ${people.length ? '' : html`<p class="small muted">Dalyvių dar nėra.</p>`}`
        : html`<p class="small muted">Dalyvių sąrašo nepavyko įkelti.</p>`}
      </section>

      <section class="set-sec" id="set-invite">
        <h2 class="h2">Kvietimas</h2>
        <div class="card stack-2">
          <p class="small muted">${t.visibility === 'private' ? 'Turnyras privatus – prisijungti galima tik su šia nuoroda.' : 'Su šia nuoroda draugai iškart patenka į turnyrą.'}</p>
          <code class="link-box" data-invite-link>${t.invite_code ? inviteLink(t.invite_code) : '—'}</code>
          <div class="grid-2"><button type="button" class="btn" data-invite-copy>Kopijuoti</button><button type="button" class="btn" data-invite-share>${icon('share', 16)}Dalintis</button></div>
          <button type="button" class="btn-text bad small" data-invite-new aria-expanded="false">Sukurti naują nuorodą</button>
          <div class="stack-2" data-invite-confirm hidden>
            <p class="small">Senoji nuoroda nustos veikti. Jau prisijungę dalyviai lieka turnyre.</p>
            <button type="button" class="btn bad" data-invite-new-ok>Sukurti naują nuorodą</button>
          </div>
        </div>
      </section>

      ${canDelete ? html`<section class="set-sec stack-2" data-danger><h2 class="h2">Pavojinga zona</h2>${deleteF}</section>` : ''}
    </div>
    <div class="cta-bar"><button class="btn btn-primary btn-lg" data-submit>${icon('check', 22, 3)}Išsaugoti pakeitimus</button></div>`,
    mount: (root) => mountForm(root)
  };

  function mountForm(root) {

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

      // --- Savos taškų taisyklės ---
      const ruleList = root.querySelector('[data-rule-list]');
      const renderRules = () => {
        if (!ruleList) return;
        const all = chosenRule && !myRules.some((x) => x.id === chosenRule.id) ? [chosenRule, ...myRules] : myRules;
        ruleList.innerHTML = String(all.length ? html`${all.map((rule) => ruleCard(state, rule, { selected: chosenRule === rule || (chosenRule?.id && chosenRule.id === rule.id), pick: !locked }))}`
          : html`<p class="small muted" data-rule-empty>Savų taisyklių dar nėra – sukurk pirmąsias.</p>`);
        root.querySelector('[data-rule-desc]').innerHTML = String(chosenRule ? html`${rulesLines(state, chosenRule.rules).map((l) => html`<li>${l}</li>`)}` : '');
        ruleList.querySelectorAll('[data-rule-pick]').forEach((b) => b.addEventListener('click', () => {
          chosenRule = all.find((x) => (x.id || '') === b.dataset.rulePick) || null;
          renderRules();
        }));
      };
      root.querySelector('[data-rule-new]')?.addEventListener('click', async () => {
        const saved = await openRulesBuilder(ctx);
        if (!saved) return;
        myRules = [saved, ...myRules.filter((x) => x.id !== saved.id)];
        chosenRule = saved;
        renderRules();
        root.querySelector('[data-custom]').scrollIntoView({ block: 'start' });
      });
      renderRules();
      root.querySelectorAll('[data-format]').forEach((b) => b.addEventListener('click', () => {
        format = b.dataset.format;
        root.querySelectorAll('[data-format]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        root.querySelector('[data-topn]').hidden = format === 'biggest' || format === 'custom';
        const custom = root.querySelector('[data-custom]');
        if (custom) custom.hidden = format !== 'custom';
        root.querySelector('[data-species-box]').hidden = format === 'custom';
        showMeasure();
        root.querySelectorAll('[data-not-duels]').forEach((el) => { el.hidden = format === 'duels'; });
        if (format === 'top_n_sum' && form.top_n.value === '1') form.top_n.value = '3';
        renderCoefs();
      }));
      // Matavimas: ilgis ar svoris. Svoriui – tik „Sunkiausia“ ir „Kelių svorių suma“, min. svoris vietoj min. ilgio.
      function showMeasure() {
        const w = measure === 'weight';
        root.querySelectorAll('[data-measure]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.measure === measure)));
        root.querySelector('[data-measure-hint]').textContent = w ? 'Žuvys sveriamos svarstyklėmis – liniuotės nereikia. Laimikiai be svorio neįskaitomi.' : 'Žuvys matuojamos prie liniuotės.';
        root.querySelectorAll('[data-len-only]').forEach((x) => { x.hidden = w; });
        root.querySelector('[data-format="biggest"]').textContent = w ? W_LABEL.biggest : FORMAT_LT.biggest;
        root.querySelector('[data-format="top_n_sum"]').textContent = w ? W_LABEL.top_n_sum : FORMAT_LT.top_n_sum;
        root.querySelector('[data-min-box]').hidden = format === 'custom' || w;
        root.querySelector('[data-minw-box]').hidden = !w;
        root.querySelector('[data-topn-label]').textContent = w && format === 'top_n_sum' ? 'Kiek sunkiausių žuvų sumuoti' : TOPN_LABEL[format] || '';
        root.querySelector('[data-format-hint]').textContent = (w && W_HINT[format]) || FORMAT_HINT[format];
        const minLabel = root.querySelector('[data-set-row="min"] summary .strong');
        if (minLabel) minLabel.textContent = w ? 'Min. svoris' : 'Min. ilgis';
      }
      root.querySelectorAll('[data-measure]').forEach((b) => b.addEventListener('click', () => {
        if (b.closest('fieldset')?.disabled) return;
        measure = b.dataset.measure;
        if (measure === 'weight' && format !== 'biggest' && format !== 'top_n_sum') {
          root.querySelector('[data-format="biggest"]').click();
          return;
        }
        showMeasure();
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
        if (edit) return;
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
        if (edit) return;
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
      sponsorRows?.addEventListener('input', (e) => {
        const row = e.target.closest('[data-sponsor]');
        if (!row || !e.target.dataset.f) return;
        sponsors[Number(row.dataset.sponsor)][e.target.dataset.f] = e.target.value;
        if (e.target.dataset.f === 'amount') updateSponsorSum();
      });
      sponsorRows?.addEventListener('click', (e) => {
        const b = e.target.closest('[data-remove-sponsor]');
        if (b) { sponsors.splice(Number(b.dataset.removeSponsor), 1); renderSponsors(); }
      });
      root.querySelector('[data-add-sponsor]')?.addEventListener('click', () => {
        sponsors.push({ name: '', url: '', amount: '' });
        renderSponsors();
        sponsorRows.querySelector(`[data-sponsor="${sponsors.length - 1}"] [data-f=name]`).focus();
      });
      root.querySelector('[data-use-sum]')?.addEventListener('click', () => {
        const total = sponsorTotal(sponsors.map((x) => ({ amount_cents: parseEur(x.amount) || 0 })));
        fundInput.value = String(total / 100).replace('.', ',');
        fundInput.dispatchEvent(new Event('input'));
      });
      renderSponsors();

      const delBox = root.querySelector('[data-del-box]');
      root.querySelector('[data-del-confirm]')?.addEventListener('click', async (e) => {
        const reason = root.querySelector('[data-del-reason]').value.trim();
        const delBtn = e.currentTarget;
        if (reason.length < 5) return fail('Nurodyk pašalinimo priežastį (bent 5 simboliai).');
        delBtn.disabled = true;
        try {
          await backend.adminDeleteTournament(t.id, reason);
          ctx.toast('Turnyras pašalintas');
          ctx.navigate('#/');
        } catch (err) {
          delBtn.disabled = false;
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

      // ---------------- Nustatymų puslapis: skiltys, santraukos, viršelis, dalyviai, kvietimas, rėmėjai
      const spApi = spEditor ? spEditor.mount(root) : null;
      const cleanup = edit ? mountSettings() : null;

      // Kas keičiasi taisyklėse (savininkui po starto): [pavadinimas, buvo, bus]
      function ruleChanges(data) {
        const out = [];
        const sp = (ids) => (ids.length ? ids.map((id) => state.species.find((x) => x.id === id)?.name_lt ?? id).join(', ') : 'Visos');
        const eq = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
        if (data.format !== t.format || (data.format !== 'biggest' && data.format !== 'custom' && Number(data.top_n) !== Number(t.top_n))) {
          out.push(['Formatas', fmtText(t.format, t.top_n, t.measure), fmtText(data.format, data.top_n, data.measure)]);
        }
        if ((data.measure || 'length') !== (t.measure || 'length')) out.push(['Matavimas', MEASURE_LT[t.measure || 'length'], MEASURE_LT[data.measure || 'length']]);
        if (Number(data.min_weight_g || 0) !== Number(t.min_weight_g || 0)) out.push(['Min. svoris', t.min_weight_g ? kgText(t.min_weight_g) : 'nėra', data.min_weight_g ? kgText(data.min_weight_g) : 'nėra']);
        if (data.format === 'custom' && t.format === 'custom' && !eq(data.scoring, t.scoring)) out.push(['Taškų taisyklės', 'ankstesnės', chosenRule?.name || 'naujos']);
        const before = (t.species_ids || []).slice().sort((a, b) => a - b);
        const after = (data.species_ids || []).slice().sort((a, b) => a - b);
        if (!eq(before, after)) out.push(['Rūšys', sp(before), sp(after)]);
        else if (data.format === 'species_points' && !eq(
          Object.fromEntries(Object.entries(t.species_pct || {}).map(([k, v]) => [String(k), Number(v)])),
          Object.fromEntries(Object.entries(data.species_pct || {}).map(([k, v]) => [String(k), Number(v)])))) out.push(['Rūšių koeficientai', 'ankstesni', 'pakeisti']);
        if (Number(data.min_length_mm) !== Number(t.min_length_mm || 0)) out.push(['Min. ilgis', t.min_length_mm ? cm(t.min_length_mm) : 'nėra', data.min_length_mm ? cm(data.min_length_mm) : 'nėra']);
        if (data.starts_at !== t.starts_at) out.push(['Pradžia', dateTime(t.starts_at), dateTime(data.starts_at)]);
        const dn = (list) => (list || []).map((d) => d.name).join(', ') || 'nėra';
        if (dn(data.divisions) !== dn(t.divisions)) out.push(['Divizionai', dn(t.divisions), dn(data.divisions)]);
        if (!!data.team_mode !== !!t.team_mode) out.push(['Komandinė įskaita', t.team_mode ? 'taip' : 'ne', data.team_mode ? 'taip' : 'ne']);
        if ('league_id' in data && (data.league_id || null) !== (t.league_id || null)) out.push(['Sezono lyga', t.league?.name || 'be lygos', form.league_id.selectedOptions[0]?.textContent || 'be lygos']);
        if (Number(data.prize_fund_cents || 0) !== Number(t.prize_fund_cents || 0) || !eq(data.prize_split, t.prize_fund_cents ? t.prize_split : null)) {
          const f = (c, sp) => (c ? `${eur(c)} · ${count((sp || []).length, 'vieta', 'vietos', 'vietų')}` : 'nėra');
          out.push(['Prizų fondas', f(t.prize_fund_cents, t.prize_split), f(data.prize_fund_cents, data.prize_split)]);
        }
        return out;
      }

      // Patvirtinimo langas: grąžina priežastį arba null (atšaukta).
      function confirmRules(changes) {
        return new Promise((resolve) => {
          const box = document.createElement('div');
          box.className = 'sheet-wrap';
          box.setAttribute('role', 'dialog');
          box.setAttribute('aria-modal', 'true');
          box.setAttribute('aria-label', 'Taisyklių pakeitimas');
          box.dataset.rulesConfirm = '';
          box.innerHTML = String(html`<div class="sheet-bg" data-cancel></div>
            <div class="sheetx stack">
              <span class="grab" aria-hidden="true"></span>
              <h2 class="h2">Keiti ${phase(t) === 'done' ? 'pasibaigusio' : 'vykstančio'} turnyro taisykles</h2>
              <div class="chg-list">${changes.map(([k, a, b]) => html`<div class="chg"><span class="small muted strong">${k}</span><span><s class="muted">${a}</s> → <b>${b}</b></span></div>`)}</div>
              <p class="warnbox">${icon('alert', 18)}<span><b>Lentelė bus perskaičiuota</b> pagal naujas taisykles – gali pasikeisti dalyvių vietos ir įskaitytos žuvys.</span></p>
              <label class="field"><span class="small muted strong">Priežastis dalyviams (bus pranešime)</span>
                <textarea data-reason rows="2" maxlength="300" placeholder="pvz. Klaidingai nurodytas formatas"></textarea></label>
              <p class="small bad" data-reason-err hidden role="alert">Nurodyk priežastį (bent 5 simboliai).</p>
              <p class="small muted">${count(Number(t.participants) || 0, 'dalyvis gaus', 'dalyviai gaus', 'dalyvių gaus')} pranešimą. Pakeitimas įrašomas į žurnalą.</p>
              <div class="grid-2"><button type="button" class="btn" data-cancel>Atšaukti</button><button type="button" class="btn btn-primary" data-ok>Keisti taisykles</button></div>
            </div>`);
          const prev = document.activeElement;
          const close = (val) => { box.remove(); document.removeEventListener('keydown', onKey); prev?.focus?.({ preventScroll: true }); resolve(val); };
          const onKey = (e) => { if (e.key === 'Escape') close(null); };
          box.addEventListener('click', (e) => {
            if (e.target.closest('[data-cancel]')) close(null);
            if (e.target.closest('[data-ok]')) {
              const v = box.querySelector('[data-reason]').value.trim();
              if (v.length < 5) { box.querySelector('[data-reason-err]').hidden = false; box.querySelector('[data-reason]').focus(); return; }
              close(v);
            }
          });
          document.addEventListener('keydown', onKey);
          document.body.append(box);
          box.querySelector('[data-reason]').focus();
        });
      }

      function mountSettings() {
        bindPrizers(root, ctx, prizers);
        // Skilčių juosta: nušoka į skiltį ir pažymi ją
        const tabs = [...root.querySelectorAll('[data-goto]')];
        tabs.forEach((b) => b.addEventListener('click', () => {
          tabs.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
          root.querySelector(`#${b.dataset.goto}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }));
        // Slenkant pažymima matoma skiltis
        let io = null;
        if (typeof IntersectionObserver !== 'undefined') {
          const strip = root.querySelector('[data-stabs]');
          io = new IntersectionObserver((entries) => entries.forEach((en) => {
            if (!en.isIntersecting) return;
            const on = tabs.find((x) => x.dataset.goto === en.target.id);
            if (!on || on.getAttribute('aria-pressed') === 'true') return;
            tabs.forEach((x) => x.setAttribute('aria-pressed', String(x === on)));
            strip.scrollTo({ left: Math.max(0, on.offsetLeft - 16), behavior: 'smooth' });
          }), { rootMargin: '-35% 0px -60% 0px' });
          root.querySelectorAll('.set-sec[id]').forEach((sec) => io.observe(sec));
        }

        // Santraukos suskleistose eilutėse
        const setSum = (key, text) => { const el = root.querySelector(`[data-sum="${key}"]`); if (el) el.textContent = text; };
        const refresh = () => {
          setSum('format', `${measure === 'weight' ? 'Svoris · ' : ''}${fmtText(format, form.top_n.value, measure)}${format === 'custom' && chosenRule ? ` · ${chosenRule.name}` : ''}`);
          setSum('species', format === 'custom' ? 'Pagal taisykles' : picked.size ? popular.filter((x) => picked.has(x.id)).map((x) => x.name_lt).join(', ') : 'Visos');
          const m = Number(form.min_cm.value || 0);
          const mw = Number(form.min_kg.value.replace(',', '.') || 0);
          setSum('min', measure === 'weight' ? (mw > 0 ? `${String(mw).replace('.', ',')} kg` : 'Nėra') : m > 0 ? `${String(m).replace('.', ',')} cm` : 'Nėra');
          const dn = divisions.map((d) => d.name.trim()).filter(Boolean);
          setSum('div', dn.length ? dn.join(', ') : 'Nėra');
          if (form.league_id) setSum('league', form.league_id.selectedOptions[0]?.textContent.trim() || 'Be lygos');
          setSum('team', form.team_mode.checked ? 'Taip' : 'Ne');
          setSum('late', form.late_join.selectedOptions[0]?.textContent.trim() || '');
          setSum('hidden', form.leaderboard_hidden.checked ? 'Taip' : 'Ne');
          const f = fundCents();
          setSum('fund', Number.isFinite(f) && f > 0 ? `${eur(f)} · ${count(split.length, 'vieta', 'vietos', 'vietų')}` : 'Nėra');
          const pz = form.prizes.value.trim();
          setSum('prizes', pz ? (pz.length > 28 ? `${pz.slice(0, 27)}…` : pz) : 'Nėra');
          // Eilutės, kurių laukas paslėptas (pvz. rūšys su savomis taisyklėmis), nerodomos
          root.querySelectorAll('[data-set-row]').forEach((d) => {
            const body = d.querySelector('.set-body')?.firstElementChild;
            d.hidden = !!body?.hidden;
          });
        };
        form.addEventListener('input', refresh);
        form.addEventListener('change', refresh);
        form.addEventListener('click', () => setTimeout(refresh, 0));
        refresh();

        // Viršelis – įkeliamas iš karto
        const coverBox = root.querySelector('[data-cover]');
        const setCover = (url) => {
          coverBox.classList.toggle('has-img', !!url);
          coverBox.querySelector('img')?.remove();
          if (url) { const img = document.createElement('img'); img.alt = ''; img.src = url; coverBox.prepend(img); }
          coverBox.querySelector('label.cv-btn span').textContent = url ? 'Keisti viršelį' : 'Pridėti viršelį';
          let off = coverBox.querySelector('[data-cover-off]');
          if (url && !off) {
            coverBox.querySelector('.cv-acts').insertAdjacentHTML('afterbegin', String(html`<button type="button" class="cv-btn" data-cover-off aria-label="Pašalinti viršelį">${icon('x', 16, 2.6)}</button>`));
            off = coverBox.querySelector('[data-cover-off]');
          } else if (!url) off?.remove();
        };
        coverBox.addEventListener('change', async (e) => {
          const input = e.target.closest('[data-cover-input]');
          const file = input?.files?.[0];
          if (!file) return;
          coverBox.classList.add('busy');
          try {
            const blob = await shrinkCover(file);
            const { path, url } = await backend.uploadTournamentCover(t.id, blob);
            await backend.setTournamentCover(t.id, path, t.cover_path);
            t.cover_path = path;
            setCover(url);
            ctx.toast('Viršelis atnaujintas');
          } catch (err) {
            ctx.toast(err.message || 'Nepavyko įkelti viršelio');
          } finally {
            coverBox.classList.remove('busy');
            input.value = '';
          }
        });
        coverBox.addEventListener('click', async (e) => {
          if (!e.target.closest('[data-cover-off]')) return;
          try {
            await backend.setTournamentCover(t.id, null, t.cover_path);
            t.cover_path = null;
            setCover(null);
            ctx.toast('Viršelis pašalintas');
          } catch (err) {
            ctx.toast(err.message || 'Nepavyko pašalinti viršelio');
          }
        });

        // Dalyviai: paieška, divizionas, pašalinimas
        const list = root.querySelector('[data-people]');
        root.querySelector('[data-people-q]')?.addEventListener('input', (e) => {
          const q = e.target.value.trim().toLowerCase();
          list.querySelectorAll('[data-person]').forEach((li) => { li.hidden = !!q && !li.dataset.nick.includes(q); });
        });
        list?.addEventListener('click', async (e) => {
          const li = e.target.closest('[data-person]');
          if (!li) return;
          const uid = li.dataset.person;
          const more = e.target.closest('[data-p-more]');
          if (more) {
            const menu = li.querySelector('[data-p-menu]');
            menu.hidden = !menu.hidden;
            more.setAttribute('aria-expanded', String(!menu.hidden));
            return;
          }
          if (e.target.closest('[data-p-write]')) {
            try {
              const cid = await backend.startConversation(t.id, uid);
              ctx.navigate(`#/zinutes/${cid}`);
            } catch (err) {
              ctx.toast(err.message || 'Nepavyko pradėti pokalbio');
            }
            return;
          }
          if (e.target.closest('[data-p-remove]')) {
            const c = li.querySelector('[data-p-confirm]');
            c.hidden = !c.hidden;
            if (!c.hidden) li.querySelector('[data-p-reason]').focus();
            return;
          }
          const ok = e.target.closest('[data-p-remove-ok]');
          if (ok) {
            ok.disabled = true;
            try {
              await backend.removeParticipant(t.id, uid, li.querySelector('[data-p-reason]').value.trim());
              li.remove();
              const n = root.querySelector('[data-people-count]');
              n.textContent = String(Math.max(0, Number(n.textContent) - 1));
              ctx.toast('Dalyvis pašalintas');
            } catch (err) {
              ok.disabled = false;
              ctx.toast(err.message || 'Nepavyko pašalinti');
            }
          }
        });
        list?.addEventListener('change', async (e) => {
          const sel = e.target.closest('[data-p-div]');
          if (!sel) return;
          const li = sel.closest('[data-person]');
          try {
            await backend.setParticipantDivision(t.id, li.dataset.person, sel.value || null);
            const tag = li.querySelector('[data-p-divname]');
            const name = sel.value ? sel.selectedOptions[0].textContent : '';
            tag.textContent = name;
            tag.className = name ? 'dchip' : '';
            ctx.toast(name ? `Divizionas: ${name}` : 'Divizionas nuimtas');
          } catch (err) {
            ctx.toast(err.message || 'Nepavyko pakeisti diviziono');
          }
        });

        // Kvietimas
        const linkEl = root.querySelector('[data-invite-link]');
        const link = () => (t.invite_code ? inviteLink(t.invite_code) : '');
        root.querySelector('[data-invite-copy]').addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(link()); ctx.toast('Nuoroda nukopijuota'); } catch { ctx.toast('Nepavyko nukopijuoti – pažymėk nuorodą ir nukopijuok'); }
        });
        root.querySelector('[data-invite-share]').addEventListener('click', async () => {
          try {
            if (navigator.share) await navigator.share({ title: t.title, text: `Prisijunk prie turnyro „${t.title}“`, url: link() });
            else { await navigator.clipboard.writeText(link()); ctx.toast('Nuoroda nukopijuota'); }
          } catch { /* atšaukta */ }
        });
        const newBtn = root.querySelector('[data-invite-new]');
        newBtn.addEventListener('click', () => {
          const c = root.querySelector('[data-invite-confirm]');
          c.hidden = !c.hidden;
          newBtn.setAttribute('aria-expanded', String(!c.hidden));
        });
        root.querySelector('[data-invite-new-ok]').addEventListener('click', async (e) => {
          const okBtn = e.currentTarget;
          okBtn.disabled = true;
          try {
            t.invite_code = await backend.regenerateInvite(t.id);
            linkEl.textContent = link();
            root.querySelector('[data-invite-confirm]').hidden = true;
            newBtn.setAttribute('aria-expanded', 'false');
            ctx.toast('Nauja kvietimo nuoroda sukurta');
          } catch (err) {
            ctx.toast(err.message || 'Nepavyko sukurti naujos nuorodos');
          } finally {
            okBtn.disabled = false;
          }
        });
        return () => io?.disconnect();
      }

      root.querySelector('[data-submit]').addEventListener('click', async (e) => {
        errorEl.hidden = true;
        const title = form.title.value.trim();
        let startsAt = locked ? new Date(t.starts_at) : new Date(form.starts_at.value);
        const spClean = spApi ? spApi.collect() : [];
        if (!spClean) return;
        const endsAt = new Date(form.ends_at.value);
        const minCm = measure === 'weight' ? 0 : Number(form.min_cm.value || 0);
        const minKg = measure === 'weight' ? Number(form.min_kg.value.replace(',', '.').trim() || 0) : 0;
        const fund = fundCents();
        if (title.length < 3) return fail('Pavadinimas per trumpas.');
        if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return fail('Nurodyk pradžią ir pabaigą.');
        if (endsAt <= startsAt) return fail('Pabaiga turi būti vėliau nei pradžia.');
        if (endsAt - startsAt > 366 * 24 * 3600e3) return fail('Turnyras gali trukti ne ilgiau kaip metus.');
        if (started) {
          if (endsAt < Date.now() - 60e3) return fail('Pabaiga negali būti praeityje.');
        } else {
          if (startsAt < Date.now() - 5 * 60e3) return fail('Pradžia negali būti praeityje.');
          // Pradžia „dabar“ -> po 2 min.: duomenų bazė leidžia keisti turnyro rūšis tik iki starto.
          const soonest = new Date(Date.now() + 2 * 60e3);
          if (startsAt < soonest) startsAt = soonest;
        }
        if (endsAt <= startsAt) return fail('Pabaiga turi būti vėliau nei pradžia.');
        if (!Number.isFinite(minCm) || minCm < 0 || minCm > 200) return fail('Minimalus ilgis turi būti 0–200 cm.');
        if (!Number.isFinite(minKg) || minKg < 0 || minKg > 100) return fail('Minimalus svoris turi būti 0–100 kg.');
        if (measure === 'weight' && format !== 'biggest' && format !== 'top_n_sum') return fail('Turnyrui pagal svorį pasirink „Sunkiausia žuvis“ arba „Kelių svorių suma“.');
        if (!Number.isFinite(fund)) return fail('Prizinis fondas: įrašyk sumą eurais, pvz. 500 arba 250,50.');
        if (fund > 10000000) return fail('Prizinis fondas negali viršyti 100 000 €.');
        if (fund > 0) {
          const splitErr = validateSplit(split);
          if (splitErr) return fail(`Prizinis fondas: ${splitErr.charAt(0).toLowerCase()}${splitErr.slice(1)}.`);
        }
        if (format === 'species_points' && !picked.size) return fail('Taškams už rūšį pažymėk bent vieną rūšį ir jos koeficientą.');
        if (format === 'custom' && !chosenRule) return fail('Pasirink arba sukurk taškų taisykles.');
        const customSpecies = format === 'custom' ? chosenRule.rules.species.map((s) => s.id) : null;
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
          top_n: format === 'biggest' ? 3 : format === 'custom' ? 1 : format === 'top_n_sum' ? Math.max(2, Number(form.top_n.value)) : Number(form.top_n.value),
          min_length_mm: format === 'custom' ? 0 : Math.round(minCm * 10),
          // Matavimas (0040): siunčiama tik kai svoris arba turnyras jau turi šį stulpelį – kad veiktų ir senesnė DB.
          ...(measure === 'weight' || (t && 'measure' in t) ? { measure, min_weight_g: Math.round(minKg * 1000) } : {}),
          // Tik savoms taisyklėms (kitaip serveris be 0033 nežinotų šių stulpelių).
          ...(format === 'custom' ? { scoring: chosenRule.rules, scoring_rule_id: chosenRule.id || null } : {}),
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
          species_ids: customSpecies || [...picked],
          species_pct: format === 'species_points' ? Object.fromEntries([...picked].map((sid) => [sid, pct[sid] ?? 100])) : {},
          divisions: cleanDivs,
          ...(form.league_id ? { league_id: form.league_id.value || null } : {})
        };
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          if (t) {
            // Savininkas keičia prasidėjusio turnyro taisykles – parodom, kas keičiasi, ir paprašom priežasties.
            const changes = rulesLive ? ruleChanges(data) : [];
            let reason = null;
            if (changes.length) {
              reason = await confirmRules(changes);
              if (reason === null) { btn.disabled = false; return; }
            }
            await backend.updateTournament(t.id, locked ? Object.fromEntries(LOCKED_KEYS.map((k) => [k, data[k]])) : data);
            if (changes.length) {
              await backend.notifyRuleChange(t.id, reason, changes.map(([k, , after]) => `${k}: ${after}`).join('; '))
                .catch((err) => ctx.toast(`Taisyklės pakeistos, bet pranešimo išsiųsti nepavyko: ${err.message || ''}`));
            }
            if (spApi?.dirty()) await spApi.save(spClean);
            ctx.toast(changes.length ? 'Taisyklės pakeistos – dalyviai gaus pranešimą' : 'Pakeitimai išsaugoti');
            ctx.navigate(`#/t/${t.id}`);
          } else {
            const id = await backend.createTournament(data);
            // Klubo turnyras: nariai pakviečiami klubo pranešimu su kvietimo nuoroda.
            if (clubId && backend.postClub) {
              try {
                const nt = await backend.tournament(id);
                const link = nt?.invite_code ? `${location.origin}${location.pathname}#/kvietimas/${nt.invite_code}` : `${location.origin}${location.pathname}#/t/${id}`;
                await backend.postClub(clubId, 'post', `Naujas klubo turnyras „${data.title}“! Prisijunk: ${link}`);
                ctx.toast('Turnyras sukurtas – klubo nariai pakviesti');
              } catch {
                ctx.toast('Turnyras sukurtas (narių pakviesti nepavyko – pasidalink nuoroda)');
              }
            } else {
              ctx.toast('Turnyras sukurtas');
            }
            ctx.navigate(`#/t/${id}`);
          }
        } catch (err) {
          console.error(err);
          btn.disabled = false;
          fail(/sponsor_limit/.test(err.message || '') ? 'Daugiausia 10 rėmėjų.'
            : /limit|prasid|parą|praeity|taisykl/i.test(err.message || '') ? err.message : `Nepavyko ${t ? 'išsaugoti' : 'sukurti turnyro'}. Bandyk dar kartą.`);
        }
      });
      return cleanup;
  }
}
