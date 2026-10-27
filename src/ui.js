// Bendri sąsajos elementai.
import { html } from './lib/html.js';
import { icon } from './icons.js';
import { phase } from './lib/format.js';
import { banUntilText } from './lib/bans.js';

export function phaseBadge(t, extra = '') {
  const p = phase(t);
  const label = { live: 'Vyksta', soon: 'Artėja', done: 'Baigėsi' }[p];
  return html`<span class="badge badge-${p}">${p === 'live' ? html`<span class="dot"></span>` : ''}${label}${extra ? ` · ${extra}` : ''}</span>`;
}

export const STATUS = {
  approved: { cls: 'ok', label: 'Patvirtinta', icon: 'check' },
  pending: { cls: 'wait', label: 'Tikrinama', icon: 'clock' },
  rejected: { cls: 'bad', label: 'Atmesta', icon: 'x' },
  queued: { cls: 'queue', label: 'Laukia eilėje', icon: 'cloudOff' },
  failed: { cls: 'bad', label: 'Neišsiųsta', icon: 'alert' }
};

export function statusChip(status) {
  const s = STATUS[status] || STATUS.pending;
  return html`<span class="chip chip-${s.cls}">${icon(s.icon, 14, 2.8)}${s.label}</span>`;
}

export function backButton(href, label = 'Atgal') {
  return html`<a class="icon-btn" href="${href}" aria-label="${label}">${icon('back', 22, 2.2)}</a>`;
}

export function thumb(path, size = 56) {
  return html`<span class="thumb" style="width:${size}px;height:${size}px">${icon('fish', Math.round(size * 0.6), 1.8)}${
    path ? html`<img alt="" data-photo="${path}" loading="lazy">` : ''}</span>`;
}

export function hydratePhotos(root, backend) {
  root.querySelectorAll('img[data-photo]').forEach(async (img) => {
    const url = await backend.photoUrl(img.dataset.photo).catch(() => null);
    if (url && img.isConnected) {
      img.src = url;
      img.onload = () => img.classList.add('loaded');
    }
  });
}

export function empty(title, text, action) {
  return html`<div class="empty">
    <div class="empty-icon">${icon('fish', 34, 1.6)}</div>
    <p class="empty-title">${title}</p>
    ${text ? html`<p class="muted">${text}</p>` : ''}
    ${action || ''}
  </div>`;
}

// Visas ekranas „nerasta“ – su h1, kad ekrano skaitytuvai ir fokusas veiktų kaip kituose ekranuose.
export function notFound(back, title, text = '') {
  return html`<div class="screen">${backButton(back)}<div class="empty">
    <div class="empty-icon">${icon('fish', 34, 1.6)}</div>
    <h1 class="empty-title" tabindex="-1">${title}</h1>
    ${text ? html`<p class="muted">${text}</p>` : ''}
  </div></div>`;
}

// Automatiškai sukurtas slapyvardis (pvz. zvejys_1a2b3c4d) – reikia pasiūlyti pasirinkti savo.
export const defaultNickname = (n) => /^zvejys_[0-9a-f]{8}$/.test(n || '');

export function initials(name) {
  return (name || '?').trim().charAt(0).toUpperCase() || '?';
}

export function avatar(name, cls = '') {
  return html`<span class="avatar ${cls}">${initials(name)}</span>`;
}

// Užblokuoto žvejo pranešimas (0013).
export function banNotice(ban) {
  if (!ban) return '';
  return html`<div class="card stack-2 ban-card" role="status" data-ban-notice>
    <p class="strong row gap-8">${icon('lock', 18, 2.6)}Paskyra užblokuota ${banUntilText(ban)}</p>
    <p class="small">Priežastis: ${ban.reason}</p>
    <p class="small muted">Gali žiūrėti turnyrus ir savo duomenis, bet registruoti laimikių, dalyvauti ir rašyti pranešimų negali. Blokavimą skyrė programėlės moderatorius.</p>
  </div>`;
}

export function loginPrompt(text = 'Prisijunk, kad galėtum dalyvauti.') {
  return html`<div class="card stack">
    <p>${text}</p>
    <a class="btn btn-primary" href="#/prisijungti">${icon('mail', 20)}Prisijungti</a>
  </div>`;
}

// Šventė per visą ekraną (naujas rekordas). Užsidaro paspaudus arba po kelių sekundžių.
export function celebrate({ title, text, big }) {
  return new Promise((resolve) => {
    const box = document.createElement('div');
    box.className = 'celebrate';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-label', title);
    const bits = Array.from({ length: 28 }, (_, i) => `<i style="--x:${(i * 37) % 100}%;--d:${(i % 7) * 0.12}s;--r:${(i * 53) % 360}deg"></i>`).join('');
    box.innerHTML = `<div class="confetti" aria-hidden="true">${bits}</div>` + String(html`<div class="celebrate-card">
      <div class="celebrate-ico">${icon('trophy', 44, 2)}</div>
      <p class="celebrate-title">${title}</p>
      ${big ? html`<p class="celebrate-big">${big}</p>` : ''}
      ${text ? html`<p class="celebrate-text">${text}</p>` : ''}
      <button class="btn btn-primary" data-ok>Super!</button>
    </div>`);
    let done = false;
    const close = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      box.remove();
      resolve();
    };
    const timer = setTimeout(close, 4500);
    box.addEventListener('click', close);
    document.body.appendChild(box);
    box.querySelector('[data-ok]').focus();
  });
}

// Nuotrauka per visą ekraną. Uždaroma mygtuku, paspaudus fone, „Atgal“ ar Esc.
// Didinti galima dviem pirštais (puslapio mastelis neužblokuotas).
export function openPhoto(src, alt = '') {
  document.querySelector('.lightbox')?.remove();
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Nuotrauka');
  box.innerHTML = String(html`<img alt="${alt}"><button class="icon-btn lightbox-close" aria-label="Uždaryti nuotrauką">${icon('x', 24, 2.4)}</button>`);
  box.querySelector('img').src = src;
  const prevFocus = document.activeElement;
  const close = () => {
    box.remove();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', close);
    prevFocus?.focus?.({ preventScroll: true });
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('.lightbox-close')) close(); });
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', close);
  document.body.appendChild(box);
  box.querySelector('.lightbox-close').focus();
  return close;
}
