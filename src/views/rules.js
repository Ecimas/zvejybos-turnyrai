// Savos taškų taisyklės: kūrėjas (atsidaro virš bet kurio ekrano) ir „Mano taškų taisyklės“ (#/tasku-taisykles).
// Kurti gali organizatoriai (teisė „publish“).
import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { backButton, empty } from '../ui.js';
import { can } from '../lib/roles.js';
import { count } from '../lib/format.js';
import {
  BASES, AGGREGATES, TIEBREAKS, BONUSES, defaultRules, validateRules, describeRules, summarizeRules, exampleLines
} from '../lib/custom_scoring.js';

const num = (x) => String(x).replace('.', ',');
const parseNum = (v) => {
  const s = String(v ?? '').trim().replace(',', '.').replace(/^[+×x*]/i, '').replace('−', '-');
  if (s === '' || !/^-?\d*(\.\d*)?$/.test(s)) return NaN;
  return Number(s);
};
const spNameOf = (state) => (id) => state.species.find((s) => s.id === id)?.name_lt ?? `#${id}`;

export const canCustomRules = (state) => can(state, 'publish');

// Bonuso eilutės laukai: [laukas, kaip rodyti, kaip įrašyti, aria]
const bonusFields = {
  len_min: [['cm', (b) => b.cm, (v) => Math.round(v), 'Ilgis cm']],
  weight_min: [['g', (b) => num(b.g / 1000), (v) => Math.round(v * 1000), 'Svoris kg']],
  time: [['from', (b) => b.from, (v) => Math.round(v), 'Nuo val.'], ['to', (b) => b.to, (v) => Math.round(v), 'Iki val.']],
  per_fish: [], species: [], biggest: [], first: []
};
const bonusLabel = (b, f) => {
  if (b.type === 'len_min') return html`Žuvis ≥ ${f[0]} cm`;
  if (b.type === 'weight_min') return html`Žuvis ≥ ${f[0]} kg`;
  if (b.type === 'time') return html`Pagauta ${f[0]}–${f[1]} val.`;
  return BONUSES.find(([k]) => k === b.type)[1];
};
const newBonus = (type) => (type === 'time' ? { type, from: 22, to: 5, m: 120 }
  : type === 'len_min' ? { type, cm: 70, add: 100 } : type === 'weight_min' ? { type, g: 3000, add: 100 }
  : { type, add: type === 'per_fish' ? 10 : 100 });

// Atidaro kūrėją virš ekrano. Grąžina išsaugotą rinkinį { id, name, rules } arba null.
export function openRulesBuilder(ctx, existing = null) {
  const { backend, state } = ctx;
  const spName = spNameOf(state);
  const r = structuredClone(existing?.rules || defaultRules());
  let name = existing?.name || '';
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'rb-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', existing ? 'Taisyklių keitimas' : 'Naujos taškų taisyklės');
    overlay.dataset.rulesBuilder = '';
    document.body.append(overlay);
    document.body.classList.add('rb-open');
    const prevScroll = window.scrollY;
    const close = (val) => {
      overlay.remove();
      document.body.classList.remove('rb-open');
      window.scrollTo(0, prevScroll);
      resolve(val);
    };

    const isFish = () => r.base === 'fish';
    const render = () => {
      const unused = state.species.filter((s) => !r.species.some((x) => x.id === s.id));
      overlay.innerHTML = String(html`<div class="screen rb-screen">
        <header class="top-bar"><button type="button" class="icon-btn" data-rb-cancel aria-label="Atšaukti">${icon('back', 22)}</button>
          <span class="muted strong">${existing ? 'Taisyklių keitimas' : 'Naujos taisyklės'}</span><span></span></header>
        <label class="field"><span class="small muted strong">Pavadinimas</span>
          <input data-rb-name maxlength="60" placeholder="pvz. Kauno marių plėšrūnai" value="${name}"></label>

        <section class="card stack-2"><div class="row gap-8"><span class="rb-num">1</span><h2 class="h2">Taškai už žuvį</h2></div>
          <div class="seg seg-grid" role="group" aria-label="Taškai už žuvį">${BASES.map(([k, label]) => html`<button type="button" data-rb-base="${k}" aria-pressed="${r.base === k}">${label}</button>`)}</div>
          <p class="small muted">${BASES.find(([k]) => k === r.base)[2]}</p></section>

        <section class="card stack-2"><div class="row gap-8"><span class="rb-num">2</span><h2 class="h2">Rūšys</h2></div>
          ${r.species.length ? html`<div class="rb-t" data-rb-species>
            <span class="hd">Rūšis</span><span class="hd">Min. cm</span><span class="hd">${isFish() ? 'Tšk.' : '×'}</span><span class="hd">Maks.</span><span></span>
            ${r.species.map((s, i) => html`<span class="strong ellipsis">${spName(s.id)}</span>
              <input class="rb-in" inputmode="numeric" data-sp-i="${i}" data-sp-f="min_cm" value="${s.min_cm}" aria-label="${spName(s.id)}: min. cm">
              <input class="rb-in" inputmode="decimal" data-sp-i="${i}" data-sp-f="m" value="${num(s.m / 100)}" aria-label="${spName(s.id)}: ${isFish() ? 'taškai' : 'koeficientas'}">
              <input class="rb-in" inputmode="numeric" data-sp-i="${i}" data-sp-f="max" value="${s.max ?? ''}" placeholder="–" aria-label="${spName(s.id)}: daugiausia žuvų">
              <button type="button" class="rb-x" data-sp-del="${i}" aria-label="Pašalinti ${spName(s.id)}">${icon('x', 16, 2.4)}</button>`)}
          </div>` : html`<p class="small muted" data-rb-all>Rūšių nepasirinkta – įskaitomos visos, ${isFish() ? '1 tšk. už žuvį' : '×1'}.</p>`}
          ${unused.length && r.species.length < 30 ? html`<label class="rb-add-row">${icon('plus', 18, 2.6)}<select data-rb-add-sp aria-label="Pridėti rūšį">
            <option value="">Pridėti rūšį</option>${unused.map((s) => html`<option value="${s.id}">${s.name_lt}</option>`)}</select></label>` : ''}
          <p class="small muted">Min. cm – trumpesnė neįskaitoma. ${isFish() ? 'Tšk. – kiek taškų duoda viena žuvis.' : '× – rūšies koeficientas.'} Maks. – kiek tos rūšies žuvų daugiausia skaičiuojama.</p></section>

        <section class="card stack-2"><div class="row gap-8"><span class="rb-num">3</span><h2 class="h2">Premijos ir baudos</h2></div>
          ${r.bonuses.length ? html`<div data-rb-bonuses>${r.bonuses.map((b, i) => {
            const f = bonusFields[b.type].map(([key, show, , aria]) => html`<input class="rb-in rb-in-sm" inputmode="decimal" data-b-i="${i}" data-b-f="${key}" value="${show(b)}" aria-label="${aria}">`);
            return html`<div class="rb-row"><span class="grow ${b.type === 'time' || b.type === 'len_min' || b.type === 'weight_min' ? 'rb-lbl' : ''}">${bonusLabel(b, f)}</span>
              ${b.type === 'time'
                ? html`<input class="rb-in rb-val" inputmode="decimal" data-b-i="${i}" data-b-f="m" value="×${num(b.m / 100)}" aria-label="Daugiklis">`
                : html`<input class="rb-in rb-val" inputmode="decimal" data-b-i="${i}" data-b-f="add" value="${b.add >= 0 ? '+' : ''}${num(b.add / 10)}" aria-label="Taškai">`}
              <button type="button" class="rb-x" data-b-del="${i}" aria-label="Pašalinti">${icon('x', 16, 2.4)}</button></div>`;
          })}</div>` : html`<p class="small muted">Premijų nėra. Neigiamas skaičius – bauda.</p>`}
          ${r.bonuses.length < 20 ? html`<label class="rb-add-row">${icon('plus', 18, 2.6)}<select data-rb-add-b aria-label="Pridėti premiją ar baudą">
            <option value="">Pridėti premiją ar baudą</option>${BONUSES.map(([k, label]) => html`<option value="${k}">${label}</option>`)}</select></label>` : ''}
        </section>

        <section class="card stack-2"><div class="row gap-8"><span class="rb-num">4</span><h2 class="h2">Kas sumuojama</h2></div>
          <div class="seg seg-grid" role="group" aria-label="Kas sumuojama">${AGGREGATES.map(([k, label]) => html`<button type="button" data-rb-agg="${k}" aria-pressed="${r.aggregate.mode === k}">${label}</button>`)}</div>
          <label class="field" ${['best_n', 'best_n_per_species'].includes(r.aggregate.mode) ? '' : 'hidden'}><span class="small muted strong">N =</span>
            <input data-rb-n inputmode="numeric" value="${r.aggregate.n}"></label></section>

        <section class="card stack-2"><div class="row gap-8"><span class="rb-num">5</span><h2 class="h2">Lygiosios</h2></div>
          <p class="small muted">Kai taškų vienodai – kas aukščiau:</p>
          ${[0, 1, 2].map((i) => html`<label class="row gap-8"><span class="strong">${i + 1}.</span><select class="grow rb-tie" data-rb-tie="${i}" aria-label="Lygiųjų taisyklė ${i + 1}">
            <option value="">—</option>${TIEBREAKS.map(([k, label]) => html`<option value="${k}" ${r.tiebreak[i] === k ? 'selected' : ''}>${label}</option>`)}</select></label>`)}
        </section>

        <section class="rb-pre stack-1" data-rb-preview aria-live="polite"></section>
        <p class="form-error bad small" data-rb-error hidden role="alert"></p>
        <button type="button" class="btn btn-primary btn-lg" data-rb-save>${icon('check', 20, 3)}Išsaugoti taisykles</button>
      </div>`);
      bind();
      preview();
    };

    const preview = () => {
      const box = overlay.querySelector('[data-rb-preview]');
      const err = validateRules(r);
      box.innerHTML = String(err ? html`<span class="strong">Pavyzdys</span><span class="small">${err}</span>`
        : html`<span class="strong">Pavyzdys</span>${exampleLines(r, spName, state.species).map((l) => html`<span class="small">${l}</span>`)}`);
    };

    const bind = () => {
      overlay.querySelector('[data-rb-cancel]').addEventListener('click', () => close(null));
      overlay.querySelector('[data-rb-name]').addEventListener('input', (e) => { name = e.target.value; });
      overlay.querySelectorAll('[data-rb-base]').forEach((b) => b.addEventListener('click', () => { r.base = b.dataset.rbBase; render(); }));
      overlay.querySelectorAll('[data-rb-agg]').forEach((b) => b.addEventListener('click', () => { r.aggregate.mode = b.dataset.rbAgg; render(); }));
      overlay.querySelector('[data-rb-n]')?.addEventListener('input', (e) => { r.aggregate.n = Math.round(parseNum(e.target.value)); preview(); });
      overlay.querySelectorAll('[data-rb-tie]').forEach((sel) => sel.addEventListener('change', () => {
        const vals = [...overlay.querySelectorAll('[data-rb-tie]')].map((x) => x.value).filter(Boolean);
        r.tiebreak = [...new Set(vals)];
        preview();
      }));
      overlay.querySelector('[data-rb-add-sp]')?.addEventListener('change', (e) => {
        const id = Number(e.target.value);
        if (id) { r.species.push({ id, min_cm: 0, m: 100, max: null }); render(); }
      });
      overlay.querySelectorAll('[data-sp-del]').forEach((b) => b.addEventListener('click', () => { r.species.splice(Number(b.dataset.spDel), 1); render(); }));
      overlay.querySelectorAll('[data-sp-i]').forEach((inp) => inp.addEventListener('input', () => {
        const s = r.species[Number(inp.dataset.spI)];
        const v = parseNum(inp.value);
        if (inp.dataset.spF === 'min_cm') s.min_cm = inp.value.trim() === '' ? 0 : Math.round(v);
        else if (inp.dataset.spF === 'm') s.m = Math.round(v * 100);
        else s.max = inp.value.trim() === '' || inp.value.trim() === '–' ? null : Math.round(v);
        preview();
      }));
      overlay.querySelector('[data-rb-add-b]')?.addEventListener('change', (e) => {
        if (e.target.value) { r.bonuses.push(newBonus(e.target.value)); render(); }
      });
      overlay.querySelectorAll('[data-b-del]').forEach((b) => b.addEventListener('click', () => { r.bonuses.splice(Number(b.dataset.bDel), 1); render(); }));
      overlay.querySelectorAll('[data-b-i]').forEach((inp) => inp.addEventListener('input', () => {
        const b = r.bonuses[Number(inp.dataset.bI)];
        const f = inp.dataset.bF;
        const v = parseNum(inp.value);
        if (f === 'add') b.add = Math.round(v * 10);
        else if (f === 'm') b.m = Math.round(v * 100);
        else b[f] = bonusFields[b.type].find(([k]) => k === f)[2](v);
        preview();
      }));
      overlay.querySelector('[data-rb-save]').addEventListener('click', async (e) => {
        const errEl = overlay.querySelector('[data-rb-error]');
        const fail = (m) => { errEl.hidden = false; errEl.textContent = m; errEl.scrollIntoView({ block: 'center' }); };
        const n = name.trim();
        if (n.length < 3 || n.length > 60) return fail('Pavadinimas – nuo 3 iki 60 simbolių.');
        const err = validateRules(r);
        if (err) return fail(`${err}.`);
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const saved = await backend.saveScoringRule({ id: existing?.id || null, name: n, rules: r });
          ctx.toast('Taisyklės išsaugotos');
          close(saved);
        } catch (ex) {
          btn.disabled = false;
          fail(ex.message || 'Nepavyko išsaugoti');
        }
      });
    };
    render();
    overlay.querySelector('[data-rb-name]').focus();
  });
}

// Kortelė su santrauka (naudojama ir turnyro kūrimo formoje).
export function ruleCard(state, rule, { selected = false, pick = false } = {}) {
  const spName = spNameOf(state);
  return html`<div class="card rb-card ${selected ? 'rb-sel' : ''}" data-rule="${rule.id || ''}">
    <span class="grow stack-1 min0"><span class="strong">${rule.name}</span>
      <span class="small muted">${summarizeRules(rule.rules, spName)}</span>
      ${rule.used ? html`<span class="row gap-8"><span class="rb-tag">Naudota ${count(rule.used, 'turnyre', 'turnyruose', 'turnyrų')}</span></span>` : ''}</span>
    ${pick ? html`<button type="button" class="btn ${selected ? 'btn-primary' : 'btn-ghost'} rb-pick" data-rule-pick="${rule.id || ''}" aria-pressed="${selected}">${selected ? 'Pasirinkta' : 'Rinktis'}</button>` : ''}
  </div>`;
}

export function rulesLines(state, rules) {
  return describeRules(rules, spNameOf(state));
}

// „Mano taškų taisyklės“: sąrašas, kūrimas, keitimas, ištrynimas.
export async function myRulesView(ctx) {
  const { backend, state } = ctx;
  if (!state.user || !canCustomRules(state)) {
    return { nav: 'profilis', html: html`<div class="screen">${backButton('#/profilis')}<h1 class="sr-only" tabindex="-1">Taškų taisyklės</h1>
      ${empty('Savas taisykles kuria organizatoriai', 'Tapk organizatoriumi – galėsi kurti savo taškų skaičiavimo taisykles.')}</div>` };
  }
  const list = await backend.myScoringRules();
  const spName = spNameOf(state);
  return {
    nav: 'profilis',
    title: 'Mano taškų taisyklės',
    html: html`<div class="screen">
      <header class="top-bar">${backButton('#/profilis')}<span class="muted strong">Taškų taisyklės</span><span></span></header>
      <h1 class="display-md" tabindex="-1">Mano taškų taisyklės</h1>
      <p class="small muted">Sukurk savo taškų skaičiavimą ir naudok jį kurdamas turnyrus. Turnyrui nukopijuojama taisyklių kopija – pakeitus rinkinį, jau sukurti turnyrai nesikeičia.</p>
      ${list.length ? html`<div class="stack-2" data-rules-list>${list.map((rule) => html`<section class="card stack-2" data-rule="${rule.id}">
        <div class="stack-1"><span class="strong">${rule.name}</span>
          ${rule.used ? html`<span class="row"><span class="rb-tag">Naudota ${count(rule.used, 'turnyre', 'turnyruose', 'turnyrų')}</span></span>` : ''}</div>
        <ul class="plain small muted rb-desc">${describeRules(rule.rules, spName).map((l) => html`<li>${l}</li>`)}</ul>
        <div class="row gap-8"><button type="button" class="btn btn-ghost grow" data-rule-edit="${rule.id}">${icon('edit', 18)}Keisti</button>
          <button type="button" class="btn btn-ghost bad" data-rule-del="${rule.id}">${icon('x', 18, 2.4)}Ištrinti</button></div>
      </section>`)}</div>` : empty('Taisyklių dar nėra', 'Sukurk pirmąsias – pvz. lydekoms didesnis koeficientas, premija už 70 cm.')}
      <button type="button" class="btn btn-primary" data-rule-new>${icon('plus', 18, 2.6)}Kurti naujas taisykles</button>
    </div>`,
    mount(root) {
      root.querySelector('[data-rule-new]').addEventListener('click', async () => {
        if (await openRulesBuilder(ctx)) ctx.rerender();
      });
      root.querySelectorAll('[data-rule-edit]').forEach((b) => b.addEventListener('click', async () => {
        const rule = list.find((x) => x.id === b.dataset.ruleEdit);
        if (await openRulesBuilder(ctx, rule)) ctx.rerender();
      }));
      root.querySelectorAll('[data-rule-del]').forEach((b) => b.addEventListener('click', async () => {
        const rule = list.find((x) => x.id === b.dataset.ruleDel);
        if (!confirm(`Ištrinti „${rule.name}“? Jau sukurti turnyrai liks su savo taisyklių kopija.`)) return;
        try {
          await backend.deleteScoringRule(rule.id);
          ctx.toast('Taisyklės ištrintos');
          ctx.rerender();
        } catch (err) {
          ctx.toast(err.message || 'Nepavyko ištrinti');
        }
      }));
    }
  };
}
