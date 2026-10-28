// Administratorių veiksmų su turnyrais žurnalas (#/moderavimas/turnyrai, 0026): kas, kada ir ką pakeitė ar pašalino.
import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { dateTime, count } from '../lib/format.js';
import { backButton, empty } from '../ui.js';
import { can } from '../lib/roles.js';
import { moderationTabs } from './moderation.js';

export const FIELD_LT = {
  title: 'Pavadinimas', description: 'Aprašymas', ends_at: 'Pabaiga', starts_at: 'Pradžia', visibility: 'Matomumas',
  leaderboard_hidden: 'Lentelės slėpimas', late_join_minutes: 'Registracija po starto', prizes: 'Prizai',
  format: 'Formatas', top_n: 'Įskaitomų žuvų', min_length_mm: 'Minimalus ilgis', team_mode: 'Komandos',
  league_id: 'Lyga', prize_fund_cents: 'Prizinis fondas', prize_split: 'Fondo padalijimas', sponsor_name: 'Rėmėjas', sponsor_url: 'Rėmėjo svetainė'
};

// Vienos reikšmės tekstas žurnale: datos – lietuviškai, ilgi tekstai sutrumpinami.
export function valueText(key, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (key === 'ends_at' || key === 'starts_at') return dateTime(v);
  if (key === 'visibility') return v === 'private' ? 'tik su kvietimu' : 'visi';
  if (typeof v === 'boolean') return v ? 'taip' : 'ne';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

export function changeLines(changes) {
  return Object.entries(changes || {})
    .filter(([, pair]) => Array.isArray(pair))
    .map(([k, [a, b]]) => ({ label: FIELD_LT[k] || k, from: valueText(k, a), to: valueText(k, b) }));
}

export async function adminLogView(ctx) {
  const { backend, state } = ctx;
  if (!can(state, 'tournaments')) {
    return { nav: 'profilis', html: html`<div class="screen">${backButton('#/profilis')}<h1 class="sr-only" tabindex="-1">Turnyrų žurnalas</h1>${empty('Šiai skilčiai neturi teisių', 'Turnyrus tvarko administratoriai.')}</div>` };
  }
  const rows = await backend.tournamentAdminLog();
  return {
    nav: 'profilis',
    title: 'Turnyrų žurnalas',
    html: html`<div class="screen">
      <header class="top-bar">${backButton('#/profilis')}<span class="muted strong">Turnyrų žurnalas</span><span></span></header>
      <h1 class="sr-only" tabindex="-1">Turnyrų žurnalas</h1>
      ${moderationTabs(state, 'tlog')}
      <p class="small muted">Administratorių pakeitimai ir pašalinti turnyrai. Organizatorių įprasti pakeitimai iki starto čia nerodomi.</p>
      ${rows.length ? html`<div class="stack" data-log>${rows.map((r) => {
        const lines = r.action === 'update' ? changeLines(r.changes) : [];
        return html`<article class="card stack-2" data-log-row="${r.action}">
          <div class="row-between gap-8">
            <span class="strong row gap-8">${r.action === 'delete' ? html`<span class="chip chip-bad">Pašalintas</span>` : html`<span class="chip">Pakeistas</span>`}
              ${r.action === 'delete' ? html`<span>${r.title}</span>` : html`<a class="link" href="#/t/${r.tournament_id}">${r.title}</a>`}</span>
            <span class="small muted right">${dateTime(r.created_at)}</span>
          </div>
          <span class="small muted">${icon('shield', 14)} ${r.actor_nick || 'Administratorius'}</span>
          ${r.reason ? html`<p class="small"><strong>Priežastis:</strong> ${r.reason}</p>` : ''}
          ${r.action === 'delete' && r.changes?.entries !== undefined ? html`<p class="small muted">Buvo ${count(Number(r.changes.entries), 'dalyvis', 'dalyviai', 'dalyvių')}</p>` : ''}
          ${lines.length ? html`<dl class="list">${lines.map((l) => html`<div class="list-row stack-1 log-change"><dt class="small muted strong">${l.label}</dt>
            <dd class="small"><span class="muted">${l.from}</span> → <span>${l.to}</span></dd></div>`)}</dl>` : ''}
        </article>`;
      })}</div>` : empty('Žurnalas tuščias', 'Kai administratorius pakeis ar pašalins turnyrą, tai matysis čia.')}
    </div>`
  };
}
