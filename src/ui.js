// Bendri sąsajos elementai.
import { html } from './lib/html.js';
import { icon } from './icons.js';
import { phase } from './lib/format.js';

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

export function initials(name) {
  return (name || '?').trim().charAt(0).toUpperCase() || '?';
}

export function avatar(name, cls = '') {
  return html`<span class="avatar ${cls}">${initials(name)}</span>`;
}

export function loginPrompt(text = 'Prisijunk, kad galėtum dalyvauti.') {
  return html`<div class="card stack">
    <p>${text}</p>
    <a class="btn btn-primary" href="#/prisijungti">${icon('mail', 20)}Prisijungti</a>
  </div>`;
}
