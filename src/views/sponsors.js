// Turnyro rėmėjai (#/t/:id/remejai, 0027): logotipai, generalinis rėmėjas, pasiūlymas dalyviams ir statistika rėmėjui.
// Tvarko organizatorius (bet kada) arba administratorius.
import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { count, longDate } from '../lib/format.js';
import { backButton, empty, notFound } from '../ui.js';
import { can } from '../lib/roles.js';
import { parseEur } from '../lib/prizes.js';
import { SAFE_URL, logoTile, shrinkLogo, reportText, sortSponsors } from '../lib/sponsors.js';

const MAX = 10;
const num = (n) => Number(n || 0).toLocaleString('lt-LT');

export async function sponsorsView(ctx, [id]) {
  const { backend, state } = ctx;
  const t = await backend.tournament(id);
  if (!t) return { nav: 'turnyrai', html: notFound('#/', 'Turnyras nerastas') };
  const allowed = !!state.user && (t.organizer_id === state.user.id || can(state, 'tournaments'));
  if (!allowed) {
    return { nav: 'turnyrai', html: html`<div class="screen">${backButton(`#/t/${id}`)}<h1 class="sr-only" tabindex="-1">Rėmėjai</h1>
      ${empty('Rėmėjus tvarko organizatorius', 'Šiai skilčiai reikia būti turnyro organizatoriumi.')}</div>` };
  }
  const report = t.sponsors?.length && backend.sponsorReport ? await backend.sponsorReport(id).catch(() => null) : null;
  // Redaguojamas sąrašas (generalinis – pirmas)
  let rows = sortSponsors(t.sponsors).map((s) => ({
    id: s.id, name: s.name || '', url: s.url || '', blurb: s.blurb || '', tier: s.tier || 'partner',
    amount: s.amount_cents ? String(s.amount_cents / 100).replace('.', ',') : '', logo_path: s.logo_path || null, logo_url: s.logo_url || null
  }));
  const uploaded = new Set(); // šioje sesijoje įkelti, bet dar neišsaugoti logotipai

  const statsCard = () => {
    if (!report?.sponsors?.length) return '';
    return html`<section class="card stack" data-sponsor-stats>
      <div class="row-between"><h2 class="h2">Statistika rėmėjams</h2><span class="small muted">${count(report.participants, 'dalyvis', 'dalyviai', 'dalyvių')} · ${count(report.catches, 'laimikis', 'laimikiai', 'laimikių')}</span></div>
      <div class="list">${report.sponsors.map((s) => html`<div class="list-row stat-row" data-stat-sponsor="${s.id}">
        <span class="grow stack-1">${s.tier === 'main' ? html`<span class="chip chip-main">Generalinis rėmėjas</span>` : ''}<span class="strong ellipsis">${s.name}</span>
          <span class="small muted">Parodymai: <strong data-views>${num(s.views)}</strong> · paspaudimai: <strong data-clicks>${num(s.clicks)}</strong> · per 7 d.: ${num(s.views_7d)} / ${num(s.clicks_7d)}</span></span>
        <button type="button" class="btn-text" data-report="${s.id}" aria-label="Ataskaita rėmėjui ${s.name}">${icon('share', 16)}Ataskaita</button>
      </div>`)}</div>
      <p class="small muted">Parodymai – kiek skirtingų įrenginių per dieną matė logotipą (turnyro puslapyje, sąraše, lentelėje, ekrane). Paspaudimai – kiek kartų atidaryta rėmėjo svetainė.</p>
    </section>`;
  };

  const rowCard = (r, i) => html`<article class="card stack-2 sponsor-edit" data-row="${i}">
    <div class="row-between">
      <span class="small muted strong">${r.tier === 'main' ? 'Generalinis rėmėjas' : `Rėmėjas ${i + 1}`}</span>
      <span class="row gap-4">
        <button type="button" class="icon-btn small-btn" data-up="${i}" aria-label="Perkelti aukščiau" ${i === 0 ? 'disabled' : ''}><span class="rot-up">${icon('chevron', 16, 2.4)}</span></button>
        <button type="button" class="btn-text bad" data-remove="${i}" aria-label="Pašalinti rėmėją ${r.name || i + 1}">Pašalinti</button>
      </span>
    </div>
    <div class="row gap-10 logo-row">
      ${r.logo_url ? logoTile({ name: r.name || 'Logotipas', logo_url: r.logo_url }, 'logo-preview') : html`<span class="sponsor-logo logo-preview logo-empty">${icon('star', 26)}</span>`}
      <span class="stack-2 grow">
        <label class="btn btn-ghost file-btn">${icon('plus', 16, 2.6)}${r.logo_url ? 'Pakeisti logotipą' : 'Įkelti logotipą'}
          <input type="file" accept="image/png,image/jpeg,image/webp" data-logo="${i}" hidden></label>
        ${r.logo_url ? html`<button type="button" class="btn-text" data-logo-off="${i}">Be logotipo</button>` : html`<span class="small muted">PNG su permatomu fonu – gražiausia. Sumažinsim automatiškai.</span>`}
      </span>
    </div>
    <input data-f="name" maxlength="60" placeholder="Pavadinimas" value="${r.name}" aria-label="Rėmėjo ${i + 1} pavadinimas">
    <input data-f="url" maxlength="200" inputmode="url" placeholder="Svetainė https://… (nebūtina)" value="${r.url}" aria-label="Rėmėjo ${i + 1} svetainė">
    <input data-f="blurb" maxlength="140" placeholder="Pasiūlymas dalyviams, pvz. −10 % su kodu TAURE (nebūtina)" value="${r.blurb}" aria-label="Rėmėjo ${i + 1} pasiūlymas">
    <input data-f="amount" inputmode="decimal" maxlength="10" placeholder="Įnašas į prizinį fondą, € (nebūtina)" value="${r.amount}" aria-label="Rėmėjo ${i + 1} įnašas, €">
    <label class="check-row"><input type="radio" name="main" data-main="${i}" ${r.tier === 'main' ? 'checked' : ''}>
      <span class="stack-1"><span class="strong">Generalinis rėmėjas</span><span class="small muted">Didžiausias logotipas turnyro viršuje, lentelėje ir ekrane.</span></span></label>
  </article>`;

  return {
    nav: 'turnyrai',
    title: `Rėmėjai · ${t.title}`,
    html: html`<div class="screen has-cta">
      <header class="top-bar">${backButton(`#/t/${t.id}`, 'Atgal į turnyrą')}
        <div class="grow stack-1 pad-x"><h1 class="display-md" tabindex="-1">Rėmėjai</h1><span class="small muted ellipsis">${t.title}</span></div></header>
      <p class="muted">Rėmėjų logotipai rodomi turnyro puslapyje, turnyrų sąraše, rezultatų lentelėje ir didžiajame renginio ekrane. Generalinis rėmėjas – didžiausias ir pirmas.</p>
      <div data-stats>${statsCard()}</div>
      <section class="stack" data-rows></section>
      <button type="button" class="btn btn-ghost" data-add>${icon('plus', 18, 2.6)}Pridėti rėmėją</button>
      <label class="check-row"><input type="radio" name="main" data-main="-1" ${rows.some((r) => r.tier === 'main') ? '' : 'checked'}>
        <span class="strong">Be generalinio rėmėjo</span></label>
      <p class="form-error bad small" data-error hidden role="alert"></p>
    </div>
    <div class="cta-bar"><button class="btn btn-primary btn-lg" data-save>${icon('check', 22, 3)}Išsaugoti rėmėjus</button></div>`,
    mount(root) {
      const box = root.querySelector('[data-rows]');
      const errorEl = root.querySelector('[data-error]');
      const fail = (msg) => { errorEl.hidden = false; errorEl.textContent = msg; errorEl.scrollIntoView({ block: 'center' }); };
      const render = () => {
        box.innerHTML = String(html`${rows.map(rowCard)}`);
        root.querySelector('[data-add]').hidden = rows.length >= MAX;
        root.querySelector('[data-main="-1"]').checked = !rows.some((r) => r.tier === 'main');
      };
      render();
      box.addEventListener('input', (e) => {
        const card = e.target.closest('[data-row]');
        if (card && e.target.dataset.f) rows[Number(card.dataset.row)][e.target.dataset.f] = e.target.value;
      });
      root.addEventListener('change', async (e) => {
        if (e.target.dataset.main !== undefined) {
          const k = Number(e.target.dataset.main);
          rows.forEach((r, i) => { r.tier = i === k ? 'main' : 'partner'; });
          if (k > 0) rows.unshift(...rows.splice(k, 1)); // generalinis – į viršų
          render();
          return;
        }
        if (e.target.dataset.logo === undefined) return;
        const i = Number(e.target.dataset.logo);
        const file = e.target.files?.[0];
        if (!file) return;
        errorEl.hidden = true;
        const label = e.target.closest('label');
        label.classList.add('busy');
        try {
          const blob = await shrinkLogo(file);
          const { path, url } = await backend.uploadSponsorLogo(t.id, blob);
          uploaded.add(path);
          rows[i].logo_path = path;
          rows[i].logo_url = url;
          render();
          ctx.toast('Logotipas įkeltas – nepamiršk išsaugoti');
        } catch (err) {
          label.classList.remove('busy');
          fail(err.message || 'Nepavyko įkelti logotipo');
        }
      });
      box.addEventListener('click', (e) => {
        const rm = e.target.closest('[data-remove]');
        const up = e.target.closest('[data-up]');
        const off = e.target.closest('[data-logo-off]');
        if (rm) { rows.splice(Number(rm.dataset.remove), 1); render(); }
        if (up) {
          const i = Number(up.dataset.up);
          if (i > 0) { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; render(); }
        }
        if (off) { const r = rows[Number(off.dataset.logoOff)]; r.logo_path = null; r.logo_url = null; render(); }
      });
      root.querySelector('[data-add]').addEventListener('click', () => {
        if (rows.length >= MAX) return;
        rows.push({ name: '', url: '', blurb: '', tier: 'partner', amount: '', logo_path: null, logo_url: null });
        render();
        box.querySelector(`[data-row="${rows.length - 1}"] [data-f=name]`).focus();
      });
      root.querySelector('[data-stats]').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-report]');
        if (!b) return;
        const sp = t.sponsors.find((s) => s.id === b.dataset.report);
        const text = reportText({ tournament: t, report, sponsor: sp, url: `${location.origin}${location.pathname}#/t/${t.id}`, dateFmt: longDate });
        try {
          if (navigator.share) await navigator.share({ title: `Ataskaita · ${sp.name}`, text });
          else { await navigator.clipboard.writeText(text); ctx.toast('Ataskaita nukopijuota'); }
        } catch { /* atšaukta */ }
      });
      root.querySelector('[data-save]').addEventListener('click', async (e) => {
        errorEl.hidden = true;
        const clean = [];
        for (const [i, r] of rows.entries()) {
          const name = r.name.trim();
          const url = r.url.trim();
          const blurb = r.blurb.trim();
          const amount = parseEur(r.amount);
          if (!name && !url && !blurb && !r.amount.trim() && !r.logo_path) continue;
          if (!name) return fail(`Rėmėjas ${i + 1}: įrašyk pavadinimą.`);
          if (url && !SAFE_URL.test(url)) return fail(`Rėmėjas ${i + 1}: svetainė turi prasidėti https://`);
          if (!Number.isFinite(amount) || amount > 10000000) return fail(`Rėmėjas ${i + 1}: įnašą įrašyk eurais, pvz. 200.`);
          clean.push({ id: r.id, name, url: url || null, blurb: blurb || null, tier: r.tier, amount_cents: amount || null, logo_path: r.logo_path });
        }
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          await backend.saveSponsors(t.id, clean);
          // Įkelti, bet galiausiai nenaudojami logotipai – ištrinami
          const used = new Set(clean.map((x) => x.logo_path).filter(Boolean));
          [...uploaded].filter((p) => !used.has(p)).forEach((p) => backend.discardSponsorLogo?.(p));
          ctx.toast('Rėmėjai išsaugoti');
          ctx.navigate(`#/t/${t.id}`);
        } catch (err) {
          btn.disabled = false;
          fail(err.message || 'Nepavyko išsaugoti');
        }
      });
    }
  };
}

