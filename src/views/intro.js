// Pirmas įspūdis: trumpas pristatymas (#/pradzia) ir „Tavo pradžia“ – keturių žingsnių sąrašas naujam žvejui.
import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { defaultNickname } from '../ui.js';

const STEPS = [
  ['🐟', 'ruler', '1. Žuvis prie liniuotės', 'Padėk žuvį ant liniuotės ar matuoklės ir nufotografuok programėle. Visa žuvis ir skaičiai turi matytis – taip laimikį patvirtins moderatorius. Laikas ir vieta užfiksuojami automatiškai.'],
  ['🏆', 'podium', '2. Dalyvauk turnyruose', 'Prisijunk prie turnyro ir žvejok kur nori. Kiekviena patvirtinta žuvis iškart atsiranda lentelėje – matysi, kiek trūksta iki aukštesnės vietos.'],
  ['📔', 'book', '3. Tavo dienoraštis', 'Visi laimikiai, rekordai, rūšių kolekcija, tikslai ir kibimo prognozė – vienoje vietoje. Vietas, masalus ir pastabas matai tik tu.']
];

const KEY = 'zt-intro-done';
export const introDone = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return true; } };
const markDone = () => { try { localStorage.setItem(KEY, '1'); } catch { /* */ } };
const HIDE = 'zt-start-hide';
export const startHidden = () => { try { return localStorage.getItem(HIDE) === '1'; } catch { return false; } };

// Pradžios žingsniai: { key, label, done, href }
export function startItems(state, { catches = 0, joined = false } = {}) {
  return [
    { key: 'login', label: 'Prisijungti', done: !!state.user, href: '#/prisijungti' },
    { key: 'nick', label: 'Pasirinkti slapyvardį', done: !!state.profile && !defaultNickname(state.profile.nickname), href: '#/profilis' },
    { key: 'catch', label: 'Užregistruoti pirmą žuvį', done: catches > 0, href: '#/laimikis' },
    { key: 'join', label: 'Prisijungti prie turnyro', done: joined, href: '#/' }
  ];
}

export function startCard(items, { dismiss = true, intro = true } = {}) {
  const done = items.filter((x) => x.done).length;
  const next = items.find((x) => !x.done);
  return html`<section class="card stack-1 start-card" data-start>
    <div class="row-between"><b>Tavo pradžia</b><span class="row gap-8"><span class="small muted">${done} iš ${items.length}</span>
      ${dismiss ? html`<button type="button" class="icon-btn small-btn" data-start-hide aria-label="Paslėpti pradžios sąrašą">${icon('x', 16, 2.4)}</button>` : ''}</span></div>
    ${items.map((x) => (x.done
      ? html`<div class="check d" data-start-item="${x.key}"><span class="c">${icon('check', 14, 3)}</span><span class="t">${x.label}</span></div>`
      : html`<a class="check" href="${x.href}" data-start-item="${x.key}" ${x.key === 'nick' ? 'data-nick-banner' : ''}><span class="c"></span><span class="grow">${x.label}</span>${x === next ? html`<span class="accent-ink strong">Dabar</span>` : icon('chevron', 16)}</a>`))}
    ${intro ? html`<a class="btn-text small" href="#/pradzia" data-intro-link>Kaip tai veikia? (1 min.)</a>` : ''}
  </section>`;
}

export function bindStartCard(root, ctx) {
  root.querySelector('[data-start-hide]')?.addEventListener('click', () => {
    try { localStorage.setItem(HIDE, '1'); } catch { /* */ }
    root.querySelector('[data-start]')?.remove();
    ctx.toast('Pradžios sąrašas paslėptas');
  });
}

export async function introView(ctx) {
  const { state, backend } = ctx;
  let catches = 0;
  let joined = false;
  if (state.user) {
    const [mine, list] = await Promise.all([backend.myCatches().catch(() => []), backend.tournaments().catch(() => [])]);
    catches = mine.length;
    joined = list.some((t) => t.joined);
  }
  const items = startItems(state, { catches, joined });
  return {
    nav: null,
    title: 'Kaip tai veikia',
    html: html`<div class="screen intro">
      <h1 class="sr-only" tabindex="-1">Kaip veikia Žvejybos turnyrai</h1>
      <div class="intro-illu" data-intro-illu aria-hidden="true"></div>
      <div class="step-dots" aria-hidden="true">${STEPS.map((_, i) => html`<i data-dot="${i}"></i>`)}</div>
      <section class="stack-2" aria-live="polite" data-intro-text></section>
      ${state.user ? startCard(items, { dismiss: false, intro: false }) : ''}
      <div class="row gap-8 intro-bar">
        <button type="button" class="btn grow" data-intro-skip>Praleisti</button>
        <button type="button" class="btn btn-primary intro-next" data-intro-next>Toliau</button>
      </div>
    </div>`,
    mount(root) {
      let i = 0;
      const draw = () => {
        const [emoji, kind, title, text] = STEPS[i];
        root.querySelector('[data-intro-illu]').innerHTML = String(html`<span class="intro-emoji">${emoji}</span>${kind === 'ruler' ? html`<span class="intro-ruler"></span>`
          : kind === 'podium' ? html`<span class="intro-pod"><i style="height:46px"></i><i style="height:70px"></i><i style="height:34px"></i></span>` : ''}`);
        root.querySelector('[data-intro-text]').innerHTML = String(html`<h2 class="display-md" data-intro-title>${title}</h2><p class="muted">${text}</p>`);
        root.querySelectorAll('[data-dot]').forEach((d) => d.classList.toggle('on', Number(d.dataset.dot) === i));
        root.querySelector('[data-intro-next]').textContent = i === STEPS.length - 1 ? 'Pradėti' : 'Toliau';
      };
      const finish = () => { markDone(); ctx.navigate(state.user ? '#/' : '#/prisijungti'); };
      root.querySelector('[data-intro-next]').addEventListener('click', () => {
        if (i < STEPS.length - 1) { i += 1; draw(); } else finish();
      });
      root.querySelector('[data-intro-skip]').addEventListener('click', finish);
      draw();
    }
  };
}
