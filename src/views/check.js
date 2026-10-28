// Atsitiktiniai patikrinimai: žvejys atsiunčia papildomą nuotrauką (#/patikra/:id),
// moderatorius palygina ją su originalu (#/moderavimas/patikros).
import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { cm, dateTime, duration } from '../lib/format.js';
import { startCamera, stopCamera, captureFrame, sha256Hex, vibrate } from '../lib/device.js';
import { backButton, empty, thumb, hydratePhotos, openPhoto, notFound, loginPrompt } from '../ui.js';
import { can } from '../lib/roles.js';

export const CHECK_PRESETS = [
  'Žuvis su atviru delnu šalia',
  'Žuvis su šiandienos data ant lapelio',
  'Žuvis iš kito kampo, matosi visa liniuotė',
  'Žuvis ir du pirštai (V ženklas)'
];

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
export const timeLeft = (due) => {
  const ms = Date.parse(due) - Date.now();
  return ms > 0 ? `Liko ${duration(ms)}` : 'Terminas baigėsi';
};

// Žvejo kortelė sąraše ir dienoraštyje.
export function checkBanners(list) {
  if (!list?.length) return '';
  return html`${list.map((k) => html`<a class="card card-link row check-banner" href="#/patikra/${k.id}" data-check-banner>
    ${icon('camera', 22)}
    <span class="grow stack-1"><span class="strong">${k.status === 'answered' ? 'Patikra išsiųsta – laukia moderatoriaus' : 'Papildoma patikra'}</span>
      <span class="small">${k.instruction}</span>
      ${k.status === 'open' ? html`<span class="small bad strong">${timeLeft(k.due_at)}</span>` : ''}</span>
    ${icon('chevron', 18)}
  </a>`)}`;
}

const STATUS_LT = {
  answered: 'Nuotrauka išsiųsta. Laukiama moderatoriaus sprendimo.',
  passed: 'Patikra praėjo – laimikis lieka įskaitytas.',
  failed: 'Patikra nepraėjo – laimikis atmestas.',
  expired: 'Terminas baigėsi – laimikis atmestas.'
};

export async function checkView(ctx, [id]) {
  const { backend, state } = ctx;
  if (!state.user) {
    return { nav: 'dienorastis', title: 'Patikra', html: html`<div class="screen"><h1 class="display-lg" tabindex="-1">Papildoma patikra</h1>${loginPrompt('Prisijunk, kad atsakytum į patikrą.')}</div>` };
  }
  const k = await backend.check(id).catch(() => null);
  if (!k || k.user_id !== state.user.id) return { nav: 'dienorastis', html: notFound('#/dienorastis', 'Patikra nerasta') };
  const sp = state.species.find((s) => s.id === k.catch?.species_id)?.name_lt ?? '';
  const open = k.status === 'open' && Date.parse(k.due_at) > Date.now();
  const nickname = state.profile?.nickname || 'zvejys';

  return {
    nav: open ? null : 'dienorastis',
    dark: open,
    title: 'Papildoma patikra',
    html: html`<div class="${open ? 'capture' : 'screen'}">
      <header class="${open ? 'cap-top' : 'top-bar'}">${open
        ? html`<button class="icon-btn" data-close aria-label="Uždaryti">${icon('x', 22, 2.2)}</button>`
        : backButton('#/dienorastis')}
        <h1 class="${open ? 'cap-title' : 'muted strong'}" tabindex="-1">Papildoma patikra</h1><span></span></header>
      <section class="check-task stack-2">
        <p class="strong">${k.instruction}</p>
        <p class="small">${sp}${k.catch ? ` · ${cm(k.catch.length_mm)} · ${dateTime(k.catch.captured_at_device)}` : ''}</p>
        ${open ? html`<p class="small bad strong" data-left>${timeLeft(k.due_at)}</p>` : html`<p class="small" data-check-status>${STATUS_LT[k.status] || ''}${k.note ? ` (${k.note})` : ''}</p>`}
      </section>
      ${open ? html`
        <section data-step="camera" class="cam-step">
          <div class="cam-wrap">
            <video data-video playsinline muted></video>
            <p class="cam-hint">Nufotografuok tą pačią žuvį pagal užduotį. Tik programėlės kamera.</p>
          </div>
          <div class="cam-error" data-cam-error hidden></div>
          <div class="cam-bar"><button class="shutter" data-shoot aria-label="Fotografuoti" disabled><span></span></button></div>
        </section>
        <section data-step="review" class="details" hidden>
          <div class="photo-wrap"><img data-preview alt="Patikros nuotrauka"><button class="pill-btn" data-retake>Perfotografuoti</button></div>
          <div class="sheet stack"><button class="btn btn-primary btn-lg" data-send>${icon('check', 22, 3)}Siųsti moderatoriui</button></div>
        </section>` : ''}
    </div>`,
    mount(root) {
      if (!open) return undefined;
      const q = (s) => root.querySelector(s);
      const video = q('[data-video]');
      let stream = null;
      let photo = null;
      let photoUrl = null;
      const show = (step) => root.querySelectorAll('[data-step]').forEach((s) => { s.hidden = s.dataset.step !== step; });
      const openCamera = async () => {
        q('[data-cam-error]').hidden = true;
        try {
          stream = await startCamera(video);
          q('[data-shoot]').disabled = false;
        } catch {
          const err = q('[data-cam-error]');
          err.hidden = false;
          err.innerHTML = String(html`${icon('camera', 28)}<p class="strong">Kameros nepavyko įjungti</p>
            <p class="small muted">Leisk naudoti kamerą naršyklės nustatymuose. Nuotraukos iš galerijos nepriimamos.</p>
            <button class="btn" data-cam-retry>Bandyti dar kartą</button>`);
          err.querySelector('[data-cam-retry]').addEventListener('click', openCamera);
        }
      };
      q('[data-shoot]').addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        photo = await captureFrame(video, { left: `${nickname} · PATIKRA`, right: stamp(new Date()) });
        vibrate(15);
        stopCamera(stream);
        stream = null;
        if (photoUrl) URL.revokeObjectURL(photoUrl);
        photoUrl = URL.createObjectURL(photo);
        q('[data-preview]').src = photoUrl;
        show('review');
      });
      q('[data-retake]').addEventListener('click', () => { show('camera'); openCamera(); });
      q('[data-send]').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          await backend.answerCheck(k.id, photo, await sha256Hex(photo));
          ctx.toast('Patikros nuotrauka išsiųsta');
          ctx.navigate('#/dienorastis');
        } catch (err) {
          btn.disabled = false;
          ctx.toast(err.message || 'Nepavyko išsiųsti');
        }
      });
      q('[data-close]').addEventListener('click', () => (history.length > 1 ? history.back() : ctx.navigate('#/')));
      const timer = setInterval(() => { const el = q('[data-left]'); if (el) el.textContent = timeLeft(k.due_at); }, 30000);
      openCamera();
      return () => {
        clearInterval(timer);
        stopCamera(stream);
        if (photoUrl) URL.revokeObjectURL(photoUrl);
      };
    }
  };
}

// Moderatoriaus patikrų sąrašas: atsakytos – palyginti ir nuspręsti; laukiančios – kiek liko laiko.
export async function checksModerationView(ctx, tabs) {
  const { backend, state } = ctx;
  if (!can(state, 'review')) return null;
  const list = await backend.moderationChecks().catch(() => []);
  const answered = list.filter((k) => k.status === 'answered');
  const waiting = list.filter((k) => k.status === 'open');
  const sp = (id) => state.species.find((s) => s.id === id)?.name_lt ?? '';
  return {
    nav: 'profilis',
    title: 'Patikros',
    html: html`<div class="screen">
      <header class="top-bar">${backButton('#/moderavimas')}<span class="muted strong">Patikros</span><span></span></header>
      <h1 class="sr-only" tabindex="-1">Patikros</h1>
      ${tabs}
      <section class="stack">
        <h2 class="h2">Laukia sprendimo (${answered.length})</h2>
        ${answered.length ? answered.map((k) => html`<article class="card stack" data-check="${k.id}">
          <p class="small"><a class="link strong" href="#/zvejys/${k.user_id}">${k.nickname}</a> · ${sp(k.catch?.species_id)} ${k.catch ? cm(k.catch.length_mm) : ''}</p>
          <p class="strong">Užduotis: ${k.instruction}</p>
          <div class="grid-2 check-pair">
            <figure><button class="thumb-btn" data-zoom="orig" aria-label="Originali nuotrauka per visą ekraną">${thumb(k.catch?.photo_path, 160)}</button><figcaption class="small muted">Originali</figcaption></figure>
            <figure><button class="thumb-btn" data-zoom="check" aria-label="Patikros nuotrauka per visą ekraną">${thumb(k.photo_path, 160)}</button><figcaption class="small muted">Patikros, ${dateTime(k.answered_at)}</figcaption></figure>
          </div>
          <input data-note maxlength="200" placeholder="Pastaba (nebūtina, matys žvejys)" aria-label="Pastaba žvejui">
          <div class="row gap-10">
            <button class="btn btn-danger grow" data-fail>${icon('x', 18, 2.6)}Nepraėjo</button>
            <button class="btn btn-primary grow" data-pass>${icon('check', 18, 3)}Praėjo</button>
          </div>
        </article>`) : html`<p class="small muted">Atsakytų patikrų nėra.</p>`}
      </section>
      <section class="stack-2">
        <h2 class="h2">Laukia žvejo (${waiting.length})</h2>
        ${waiting.length ? html`<div class="list">${waiting.map((k) => html`<a class="list-row" href="#/l/${k.catch_id}">
          <span class="grow stack-1"><span class="strong">${k.nickname} · ${sp(k.catch?.species_id)} ${k.catch ? cm(k.catch.length_mm) : ''}</span>
          <span class="small muted">${k.instruction} · ${timeLeft(k.due_at)}</span></span>${icon('chevron', 18)}</a>`)}</div>`
          : html`<p class="small muted">Nėra. Neatsakius laiku, laimikis atmetamas automatiškai.</p>`}
      </section>
    </div>`,
    mount(root) {
      hydratePhotos(root, backend);
      root.querySelectorAll('[data-check]').forEach((card) => {
        const id = card.dataset.check;
        card.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => {
          const img = b.querySelector('img.loaded');
          if (img) openPhoto(img.src, b.dataset.zoom === 'orig' ? 'Originali nuotrauka' : 'Patikros nuotrauka');
        }));
        const decide = async (pass) => {
          card.querySelectorAll('button').forEach((b) => { b.disabled = true; });
          try {
            await backend.resolveCheck(id, pass, card.querySelector('[data-note]').value.trim());
            ctx.toast(pass ? 'Patikra praėjo' : 'Laimikis atmestas');
            ctx.rerender();
          } catch (err) {
            ctx.toast(err.message || 'Nepavyko');
            card.querySelectorAll('button').forEach((b) => { b.disabled = false; });
          }
        };
        card.querySelector('[data-pass]').addEventListener('click', () => decide(true));
        card.querySelector('[data-fail]').addEventListener('click', () => {
          if (confirm('Atmesti laimikį, nes patikra nepraėjo?')) decide(false);
        });
      });
    }
  };
}

// Laimikio puslapyje moderatoriui: paprašyti papildomos nuotraukos.
export function checkRequestBox(active) {
  if (active) {
    return html`<section class="card stack-2" data-check-active>
      <h2 class="h2 row gap-8">${icon('camera', 20)}Papildoma patikra</h2>
      <p class="small">${active.instruction}</p>
      <p class="small muted">${active.status === 'answered' ? 'Žvejys atsakė – sprendimas skiltyje „Patikros“.' : timeLeft(active.due_at)}</p>
      ${active.status === 'answered' ? html`<a class="btn btn-ghost" href="#/moderavimas/patikros">Atidaryti patikras</a>` : ''}
    </section>`;
  }
  return html`<details class="card stack-2" data-check-request>
    <summary class="strong row gap-8">${icon('camera', 20)}Paprašyti papildomos nuotraukos</summary>
    <form class="stack" data-check-form>
      <div class="chips">${CHECK_PRESETS.map((p) => html`<button type="button" class="sp-chip" data-preset="${p}">${p}</button>`)}</div>
      <label class="field"><span class="small muted strong">Užduotis žvejui</span>
        <input name="instruction" maxlength="200" required placeholder="pvz. Žuvis su atviru delnu šalia"></label>
      <label class="field"><span class="small muted strong">Per kiek laiko atsakyti</span>
        <select name="hours"><option value="1">1 val.</option><option value="2" selected>2 val.</option><option value="6">6 val.</option><option value="24">24 val.</option></select></label>
      <button class="btn btn-primary" type="submit">Siųsti užduotį</button>
      <p class="small muted">Žvejys gaus pranešimą. Neatsakius laiku, laimikis bus atmestas automatiškai.</p>
    </form>
  </details>`;
}

export function mountCheckRequest(root, ctx, catchId) {
  const form = root.querySelector('[data-check-form]');
  if (!form) return;
  form.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    form.instruction.value = b.dataset.preset;
    form.querySelectorAll('[data-preset]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await ctx.backend.requestCheck(catchId, form.instruction.value.trim(), Number(form.hours.value));
      ctx.toast('Užduotis išsiųsta žvejui');
      ctx.rerender();
    } catch (err) {
      btn.disabled = false;
      ctx.toast(err.message || 'Nepavyko');
    }
  });
}
