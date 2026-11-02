// Klubo bendras pokalbis (#/klubas/:id/pokalbis, 0037): rašo visi nariai; valdytojai prisega, trina, nutildo.
import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { time, shortDate, cm, count, dateTime } from '../lib/format.js';
import { backButton, loginPrompt, notFound, avatar } from '../ui.js';
import { feat } from '../lib/clubs.js';

const POLL_MS = 8000;
const EMOJI = ['👍', '🔥', '🎣'];
const dayKey = (d) => new Date(d).toLocaleDateString('sv-SE');
const dayLabel = (d) => {
  const k = dayKey(d);
  if (k === dayKey(Date.now())) return 'Šiandien';
  if (k === dayKey(Date.now() - 864e5)) return 'Vakar';
  return shortDate(d);
};
const ROLE_LT = { owner: 'Savininkas', admin: 'Valdytojas' };

export async function clubChatView(ctx, [id]) {
  const { backend, state } = ctx;
  if (!state.user) {
    return { nav: 'lenteles', title: 'Klubo pokalbis', html: html`<div class="screen">${backButton(`#/klubas/${id}`)}<h1 class="display-lg" tabindex="-1">Klubo pokalbis</h1>${loginPrompt('Prisijunk, kad matytum klubo pokalbį.')}</div>` };
  }
  let chat = backend.clubChat ? await backend.clubChat(id) : null;
  if (!chat) return { nav: 'lenteles', html: notFound(`#/klubas/${id}`, 'Pokalbis nepasiekiamas', 'Klubo pokalbį mato tik klubo nariai.') };
  const me = state.user.id;
  const admin = ['owner', 'admin'].includes(chat.my_role);
  const on = feat(state, 'club_chat');
  const spName = (sid) => state.species.find((s) => s.id === sid)?.name_lt ?? 'Žuvis';

  const catchCard = (c) => html`<span class="cc-card">${icon('fish', 22)}<span class="stack-1 min0"><b>${spName(c.species_id)} ${cm(c.length_mm)}</b>
    <span class="small muted">${c.weight_g ? `${(c.weight_g / 1000).toLocaleString('lt-LT')} kg · ` : ''}${dateTime(c.captured_at)}${c.status === 'approved' ? ' · patvirtintas' : ''}</span></span></span>`;
  const msgHtml = () => {
    let lastDay = '';
    let lastSender;
    return html`${chat.messages.map((m) => {
      const day = dayKey(m.created_at);
      const sep = day !== lastDay ? html`<li class="day">${dayLabel(m.created_at)}</li>` : '';
      if (day !== lastDay) lastSender = undefined;
      lastDay = day;
      const mine = m.sender_id === me;
      const head = !mine && lastSender !== m.sender_id;
      lastSender = m.sender_id;
      const reacts = Object.entries(m.reactions || {}).filter(([, n]) => n > 0);
      const canDel = !m.deleted && (mine || admin);
      const canMute = admin && !mine && m.sender_id && m.role !== 'owner';
      return html`${sep}<li class="cm-li ${mine ? 'me' : ''}" data-cmsg="${m.id}">
        ${!mine ? (head ? avatar(m.nickname || '?', 'cm-av') : html`<span class="cm-av-sp" aria-hidden="true"></span>`) : ''}
        <div class="cm-col">
          <button type="button" class="b ${mine ? 'me' : 'them'} cm-b ${m.deleted ? 'cm-del' : ''}" data-cm-open aria-expanded="false"
            aria-label="${mine ? 'Tavo žinutė' : `${m.nickname || 'Narys'} rašo`}: ${m.deleted ? 'žinutė ištrinta' : m.body || 'laimikis'}. Veiksmai">
            ${head ? html`<span class="cm-name">${m.nickname || '–'}${ROLE_LT[m.role] ? html` <span class="cm-role">${ROLE_LT[m.role]}</span>` : ''}</span>` : ''}
            ${m.deleted ? html`<i>Žinutė ištrinta</i>` : html`${m.body ? html`<span class="cm-text">${m.body}</span>` : ''}${m.catch ? catchCard(m.catch) : ''}`}
            <small>${time(m.created_at)}${chat.pin_id === m.id ? ' · prisegta' : ''}</small>
          </button>
          ${reacts.length ? html`<span class="cm-reacts">${reacts.map(([e, n]) => html`<span class="${(m.mine || []).includes(e) ? 'mine' : ''}">${e} ${n}</span>`)}</span>` : ''}
          <div class="cm-acts" data-cm-acts hidden>
            ${m.deleted ? '' : html`<span class="row gap-4">${EMOJI.map((e) => html`<button type="button" class="cm-emoji ${(m.mine || []).includes(e) ? 'on' : ''}" data-react="${e}" aria-label="Reakcija ${e}" aria-pressed="${(m.mine || []).includes(e)}">${e}</button>`)}</span>`}
            <span class="row gap-4 wrap">
              ${!mine && !m.deleted && m.sender_id ? html`<button type="button" class="btn-text small" data-cm-report>Pranešti</button>` : ''}
              ${admin && !m.deleted ? html`<button type="button" class="btn-text small" data-cm-pin>${chat.pin_id === m.id ? 'Atsegti' : 'Prisegti'}</button>` : ''}
              ${canMute ? html`<button type="button" class="btn-text small" data-cm-mute="24">Nutildyti 24 val.</button><button type="button" class="btn-text small" data-cm-mute="168">7 d.</button>` : ''}
              ${canDel ? html`<button type="button" class="btn-text small bad" data-cm-del>Ištrinti</button>` : ''}
            </span>
          </div>
        </div>
      </li>`;
    })}`;
  };
  const pinMsg = () => (chat.pin_id ? chat.messages.find((m) => m.id === chat.pin_id && !m.deleted) : null);
  const pinBar = () => {
    const p = pinMsg();
    return p ? html`<button type="button" class="cm-pin" data-cm-goto="${p.id}">${icon('megaphone', 18)}<span class="grow ellipsis"><b>Prisegta:</b> ${p.body || `${spName(p.catch?.species_id)} ${cm(p.catch?.length_mm || 0)}`}</span></button>` : '';
  };
  const muted = chat.muted_until && chat.muted_until > new Date().toISOString();
  const foot = !on ? html`<p class="small muted center" data-chat-off>Klubų pokalbiai šiuo metu išjungti – senas žinutes matai, rašyti negalima.</p>`
    : muted ? html`<p class="small muted center" data-muted>Klubo valdytojas nutildė tave iki ${dateTime(chat.muted_until)}.</p>`
    : html`<form class="composer" data-composer>
      <button type="button" class="cm-fish" data-share-catch aria-label="Pasidalinti laimikiu">${icon('fish', 22)}</button>
      <label class="sr-only" for="cm-input">Žinutė klubui</label>
      <textarea id="cm-input" name="body" rows="1" maxlength="2000" placeholder="Rašyk klubui…"></textarea>
      <button type="submit" class="send-btn" aria-label="Siųsti">${icon('share', 20)}</button></form>`;

  return {
    nav: null,
    title: `${chat.name} · pokalbis`,
    html: html`<div class="screen chat-screen">
      <header class="top-bar chat-top">${backButton('#/zinutes?skiltis=klubai', 'Atgal į žinutes')}
        <div class="grow stack-1 pad-x min0"><h1 class="chat-name ellipsis" tabindex="-1">${chat.name}</h1>
          <a class="small muted ellipsis link-plain" href="#/klubas/${id}">${count(chat.members, 'narys', 'nariai', 'narių')} · klubo puslapis</a></div>
        <button type="button" class="icon-btn" data-chat-menu aria-expanded="false" aria-label="Pokalbio nustatymai">⋯</button></header>
      <div class="card stack-2" data-chat-menu-box hidden>
        <label class="check-row"><input type="checkbox" data-push ${chat.push ? 'checked' : ''}>
          <span class="stack-1"><span class="strong">Pranešimai apie naujas žinutes</span><span class="small muted">Ne dažniau kaip kartą per 15 min. Išjungus – matysi tik skaičių prie žinučių.</span></span></label>
        <a class="btn btn-ghost" href="#/klubas/${id}">${icon('users', 16)}Klubo puslapis</a>
        <p class="small muted">Paspausk žinutę – galėsi uždėti reakciją ar pranešti apie netinkamą.${admin ? ' Kaip valdytojas gali prisegti, ištrinti ar nutildyti narį.' : ''}</p>
      </div>
      <div data-pin-box>${pinBar()}</div>
      <ul class="plain chat cm-list" data-cchat aria-live="polite">${chat.messages.length ? msgHtml() : html`<li class="small muted center cm-empty">Dar niekas neparašė – pasisveikink su klubu! 👋</li>`}</ul>
    </div>
    <div class="chat-bar" data-chat-bar>${foot}</div>`,
    mount(root) {
      const list = root.querySelector('[data-cchat]');
      const bar = document.querySelector('[data-chat-bar]');
      const scrollEnd = () => window.scrollTo(0, document.body.scrollHeight);
      const redraw = () => {
        const open = list.querySelector('[data-cm-acts]:not([hidden])')?.closest('[data-cmsg]')?.dataset.cmsg;
        list.innerHTML = String(chat.messages.length ? msgHtml() : html`<li class="small muted center cm-empty">Dar niekas neparašė – pasisveikink su klubu! 👋</li>`);
        root.querySelector('[data-pin-box]').innerHTML = String(pinBar());
        if (open) {
          const li = list.querySelector(`[data-cmsg="${open}"]`);
          if (li) { li.querySelector('[data-cm-acts]').hidden = false; li.querySelector('[data-cm-open]').setAttribute('aria-expanded', 'true'); }
        }
      };
      const reload = async () => { chat = (await backend.clubChat(id)) || chat; redraw(); };
      scrollEnd();
      backend.clubChatRead(id).catch(() => {});
      let busy = false;
      const timer = setInterval(async () => {
        if (busy || document.hidden) return;
        busy = true;
        try {
          const next = await backend.clubChat(id);
          if (next && (JSON.stringify(next.messages) !== JSON.stringify(chat.messages) || next.pin_id !== chat.pin_id)) {
            const atEnd = window.innerHeight + window.scrollY >= document.body.scrollHeight - 80;
            const grew = next.messages.length > chat.messages.length;
            chat = next;
            redraw();
            if (grew) { backend.clubChatRead(id).catch(() => {}); if (atEnd) scrollEnd(); }
          }
        } catch { /* be ryšio – bandysim vėliau */ } finally { busy = false; }
      }, POLL_MS);

      const form = bar.querySelector('[data-composer]');
      const send = async (text, catchId = null) => {
        const btn = form.querySelector('.send-btn');
        btn.disabled = true;
        try {
          await backend.clubChatSend(id, text, catchId);
          await reload();
          scrollEnd();
          return true;
        } catch (err) {
          ctx.toast(err.message || 'Nepavyko išsiųsti');
          return false;
        } finally {
          btn.disabled = false;
        }
      };
      if (form) {
        const ta = form.body;
        const grow = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(140, ta.scrollHeight)}px`; };
        ta.addEventListener('input', grow);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const text = ta.value.trim();
          if (!text) return;
          if (await send(text)) { ta.value = ''; grow(); ta.focus(); }
        });
        // Pasidalinti laimikiu: savo paskutinių laimikių sąrašas
        form.querySelector('[data-share-catch]').addEventListener('click', async () => {
          const mine = (await backend.myCatches().catch(() => [])).filter((c) => c.status !== 'rejected').slice(0, 12);
          const box = document.createElement('div');
          box.className = 'sheet-wrap';
          box.setAttribute('role', 'dialog');
          box.setAttribute('aria-modal', 'true');
          box.setAttribute('aria-label', 'Pasidalinti laimikiu');
          box.dataset.catchPicker = '';
          box.innerHTML = String(html`<div class="sheet-bg" data-close></div><div class="sheetx stack">
            <span class="grab" aria-hidden="true"></span><h2 class="h2">Pasidalinti laimikiu</h2>
            <p class="small muted">Klubas matys rūšį, ilgį ir datą. Vieta nerodoma.</p>
            ${mine.length ? html`<ul class="plain ibx">${mine.map((c) => html`<li><button type="button" class="cc-pick" data-pick="${c.id}">${icon('fish', 20)}
              <span class="grow stack-1"><b>${spName(c.species_id)} ${cm(c.length_mm)}</b><span class="small muted">${dateTime(c.captured_at_device)}</span></span>${icon('chevron', 16)}</button></li>`)}</ul>`
              : html`<p class="muted">Laimikių dar nėra.</p>`}
            <button type="button" class="btn" data-close>Atšaukti</button></div>`);
          const close = () => { box.remove(); document.removeEventListener('keydown', onKey); };
          const onKey = (e) => { if (e.key === 'Escape') close(); };
          box.addEventListener('click', async (e) => {
            if (e.target.closest('[data-close]')) { close(); return; }
            const p = e.target.closest('[data-pick]');
            if (p) { close(); if (await send(null, p.dataset.pick)) ctx.toast('Laimikis pasidalintas su klubu'); }
          });
          document.addEventListener('keydown', onKey);
          document.body.append(box);
          box.querySelector('[data-pick], [data-close].btn')?.focus();
        });
      }

      const menuBtn = root.querySelector('[data-chat-menu]');
      menuBtn.addEventListener('click', () => {
        const box = root.querySelector('[data-chat-menu-box]');
        box.hidden = !box.hidden;
        menuBtn.setAttribute('aria-expanded', String(!box.hidden));
      });
      root.querySelector('[data-push]').addEventListener('change', async (e) => {
        try {
          await backend.clubChatSetPush(id, e.target.checked);
          ctx.toast(e.target.checked ? 'Pranešimai įjungti' : 'Pranešimai išjungti');
        } catch (err) {
          e.target.checked = !e.target.checked;
          ctx.toast(err.message || 'Nepavyko');
        }
      });
      root.querySelector('[data-pin-box]').addEventListener('click', (e) => {
        const g = e.target.closest('[data-cm-goto]');
        if (g) list.querySelector(`[data-cmsg="${g.dataset.cmGoto}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      list.addEventListener('click', async (e) => {
        const li = e.target.closest('[data-cmsg]');
        if (!li) return;
        const mid = Number(li.dataset.cmsg);
        const act = async (fn, msg) => {
          try { await fn(); if (msg) ctx.toast(msg); await reload(); } catch (err) { ctx.toast(err.message || 'Nepavyko'); }
        };
        if (e.target.closest('[data-cm-open]')) {
          const acts = li.querySelector('[data-cm-acts]');
          list.querySelectorAll('[data-cm-acts]').forEach((x) => { if (x !== acts) x.hidden = true; });
          list.querySelectorAll('[data-cm-open]').forEach((x) => x.setAttribute('aria-expanded', 'false'));
          acts.hidden = !acts.hidden;
          e.target.closest('[data-cm-open]').setAttribute('aria-expanded', String(!acts.hidden));
          return;
        }
        const r = e.target.closest('[data-react]');
        if (r) return act(() => backend.clubChatReact(mid, r.dataset.react));
        if (e.target.closest('[data-cm-report]')) return act(() => backend.clubChatReport(mid, null), 'Ačiū – klubo valdytojai peržiūrės žinutę');
        if (e.target.closest('[data-cm-pin]')) return act(() => backend.clubChatPin(id, chat.pin_id === mid ? null : mid), chat.pin_id === mid ? 'Atsegta' : 'Žinutė prisegta');
        const mu = e.target.closest('[data-cm-mute]');
        if (mu) {
          const m = chat.messages.find((x) => x.id === mid);
          return act(() => backend.clubChatMute(id, m.sender_id, Number(mu.dataset.cmMute)), `${m.nickname} nutildytas ${mu.dataset.cmMute === '24' ? '24 val.' : '7 d.'}`);
        }
        if (e.target.closest('[data-cm-del]')) return act(() => backend.clubChatDelete(mid), 'Žinutė ištrinta');
        return null;
      });
      return () => clearInterval(timer);
    }
  };
}
