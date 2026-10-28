// Statistika savininkui (#/moderavimas/statistika): registracijos, kas prisijungę, telefonų modeliai.
// Rodomos tik suvestinės – jokių konkrečių žmonių.
import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { count, shortDate } from '../lib/format.js';
import { backButton, empty } from '../ui.js';
import { can } from '../lib/roles.js';
import { modelName } from '../lib/presence.js';
import { moderationTabs } from './moderation.js';

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

function card(label, value, sub, key) {
  return html`<div class="stat-box center" data-stat="${key}"><span class="stat-label">${label}</span>
    <span class="stat-value">${value}</span>${sub ? html`<span class="stat-label">${sub}</span>` : ''}</div>`;
}

// 30 dienų registracijos – stulpeliai (SVG), kas 7-a diena pažymėta data.
function signupChart(days) {
  const W = 330;
  const H = 120;
  const max = Math.max(1, ...days.map((d) => d.count));
  const bw = W / days.length;
  const total = days.reduce((s, d) => s + d.count, 0);
  if (!total) return html`<p class="muted center" data-signups-empty>Per 30 dienų naujų registracijų nebuvo.</p>`;
  return html`<p class="small muted">Iš viso per 30 d.: <strong>${total}</strong></p><svg class="stats-chart" viewBox="0 0 ${W} ${H + 18}" role="img" aria-label="Registracijos per 30 dienų: ${total}">
    <line x1="0" x2="${W}" y1="${H}" y2="${H}" class="axis"/>
    ${days.map((d, i) => {
      const h = Math.round((d.count / max) * (H - 14));
      const x = i * bw + 1;
      return html`<g><rect x="${x}" y="${H - h}" width="${Math.max(2, bw - 2)}" height="${h}" rx="2" class="${i === days.length - 1 ? 'bar today' : 'bar'}"><title>${shortDate(d.day)}: ${d.count}</title></rect>
        ${d.count && d.count === max ? html`<text x="${x + bw / 2}" y="${H - h - 4}" text-anchor="middle" class="lbl">${d.count}</text>` : ''}
        ${i % 7 === 2 || i === days.length - 1 ? html`<text x="${i === days.length - 1 ? W : x + bw / 2}" y="${H + 14}" text-anchor="${i === days.length - 1 ? 'end' : 'middle'}" class="lbl">${i === days.length - 1 ? 'šiandien' : shortDate(d.day)}</text>` : ''}</g>`;
    })}
  </svg>`;
}

function barList(rows, label, value, total) {
  const max = Math.max(1, ...rows.map(value));
  return html`<div class="list">${rows.map((r) => html`<div class="list-row stat-row">
    <span class="grow stack-1"><span class="strong ellipsis">${label(r)}</span>
      <span class="stat-bar"><span style="width:${Math.max(3, Math.round((value(r) / max) * 100))}%"></span></span></span>
    <span class="num-sm right">${value(r)}${total ? html`<span class="small muted"> · ${pct(value(r), total)} %</span>` : ''}</span>
  </div>`)}</div>`;
}

export async function statsView(ctx) {
  const { backend, state } = ctx;
  if (!can(state, 'roles')) {
    return { nav: 'profilis', html: html`<div class="screen">${backButton('#/profilis')}<h1 class="sr-only" tabindex="-1">Statistika</h1>${empty('Šiai skilčiai neturi teisių', 'Statistiką mato programėlės savininkas.')}</div>` };
  }
  const s = await backend.adminStats();
  const withDev = Number(s.with_device) || 0;
  return {
    nav: 'profilis',
    title: 'Statistika',
    html: html`<div class="screen">
      <header class="top-bar">${backButton('#/profilis')}<span class="muted strong">Statistika</span>
        <button class="icon-btn" data-refresh aria-label="Atnaujinti">${icon('refresh', 20)}</button></header>
      <h1 class="sr-only" tabindex="-1">Statistika</h1>
      ${moderationTabs(state, 'stats')}

      <section class="stack-2">
        <h2 class="h2">Vartotojai</h2>
        <div class="grid-3">
          ${card('Iš viso', s.users, 'užsiregistravę', 'users')}
          ${card('Nauji šiandien', s.new_today, `7 d.: ${s.new_7d}`, 'new_today')}
          ${card('Nauji per 30 d.', s.new_30d, '', 'new_30d')}
        </div>
        <div class="grid-3">
          ${card('Prisijungę dabar', s.online_now, 'per 5 min.', 'online_now')}
          ${card('Aktyvūs šiandien', s.active_today, `7 d.: ${s.active_7d}`, 'active_today')}
          ${card('Aktyvūs per 30 d.', s.active_30d, '', 'active_30d')}
        </div>
      </section>

      <section class="stack-2">
        <h2 class="h2">Registracijos per 30 dienų</h2>
        <div class="card">${signupChart(s.signups || [])}</div>
      </section>

      <section class="stack-2">
        <h2 class="h2">Veikla</h2>
        <div class="grid-3">
          ${card('Laimikių šiandien', s.catches_today, '', 'catches_today')}
          ${card('Laukia patikros', s.pending, '', 'pending')}
          ${card('Vyksta turnyrų', s.live_tournaments, '', 'live_tournaments')}
        </div>
      </section>

      <section class="stack-2">
        <h2 class="h2">Telefonai</h2>
        ${withDev ? html`
          <p class="small muted">Per 90 d. – ${count(withDev, 'žvejys', 'žvejai', 'žvejų')} su žinomu įrenginiu. Įsidiegę programėlę: <strong data-installed>${s.installed}</strong> (${pct(s.installed, withDev)} %).</p>
          <h3 class="strong">Modeliai</h3>
          <div data-models>${barList(s.models || [], (r) => html`${modelName(r.model)} <span class="small muted">· ${r.platform}</span>`, (r) => Number(r.users), withDev)}</div>
          <h3 class="strong">Sistemos</h3>
          ${barList(s.platforms || [], (r) => r.platform, (r) => Number(r.users), withDev)}
          <h3 class="strong">Naršyklės</h3>
          ${barList(s.browsers || [], (r) => r.browser, (r) => Number(r.users), withDev)}
          <p class="small muted">iPhone tikslaus modelio nepraneša – rodomas tik „iPhone“. Vienas žvejys gali turėti kelis įrenginius.</p>`
        : html`<p class="muted">Duomenų apie telefonus dar nėra – jie atsiras, kai žvejai atidarys programėlę.</p>`}
      </section>
    </div>`,
    mount(root) {
      root.querySelector('[data-refresh]').addEventListener('click', () => ctx.rerender());
      const timer = setInterval(() => ctx.rerender(), 60000);
      return () => clearInterval(timer);
    }
  };
}
