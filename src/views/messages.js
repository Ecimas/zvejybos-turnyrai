// Vidinės žinutės (0036): sąrašas (#/zinutes), pokalbis (#/zinutes/:id), prizininkai turnyro nustatymuose,
// pranešimai apie žinutes administracijai (#/moderavimas/zinutes).
import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { time, shortDate, dateTime, scoreText, count } from '../lib/format.js';
import { eur } from '../lib/prizes.js';
import { backButton, empty, loginPrompt, avatar, notFound } from '../ui.js';
import { can } from '../lib/roles.js';
import { businessDaysLeft } from '../lib/workdays.js';

const POLL_MS = 8000;
const dayKey = (d) => new Date(d).toLocaleDateString('sv-SE');
const whenShort = (d) => (dayKey(d) === dayKey(Date.now()) ? time(d) : shortDate(d));
const dayLabel = (d) => {
  const k = dayKey(d);
  if (k === dayKey(Date.now())) return 'Šiandien';
  if (k === dayKey(Date.now() - 864e5)) return 'Vakar';
  return shortDate(d);
};
export { businessDaysLeft };

// Žinučių mygtukas su neperskaitytų skaičiumi (skaičių įrašo app.js po atvaizdavimo).
export const inboxButton = () => html`<a class="ic-badge" href="#/zinutes" aria-label="Žinutės" data-inbox-btn>${icon('chat', 20)}<b data-unread hidden></b></a>`;

const NOTICE_IC = { review: 'check', overtaken: 'bars', start: 'clock', announcement: 'megaphone' };
const TABS = [['svarbu', 'Svarbu'], ['zmones', 'Žmonės'], ['klubai', 'Klubai']];

export async function inboxView(ctx, _params, query) {
  const { backend, state } = ctx;
  if (!state.user) {
    return { nav: 'turnyrai', title: 'Žinutės', html: html`<div class="screen">${backButton('#/')}<h1 class="display-lg" tabindex="-1">Žinutės</h1>${loginPrompt('Prisijunk, kad matytum žinutes.')}</div>` };
  }
  const [list, notes, clubs] = await Promise.all([
    backend.conversations(),
    backend.notices ? backend.notices().catch(() => []) : [],
    backend.clubChats ? backend.clubChats().catch(() => []) : []
  ]);
  const sum = (arr, f) => arr.reduce((n, x) => n + (f(x) || 0), 0);
  const systems = list.filter((c) => c.kind === 'system');
  const people = list.filter((c) => c.kind !== 'system');
  // Laimėjimai prisegti „Svarbu“ viršuje, kol prizas įteiktas
  const pins = people.filter((c) => c.kind === 'org' && !c.i_organize && c.prize_place && !c.handed_at);
  const counts = {
    svarbu: sum(systems, (c) => c.unread) + notes.filter((n) => n.unread).length,
    zmones: sum(people, (c) => c.unread),
    klubai: sum(clubs, (c) => c.unread)
  };
  const wanted = query?.get?.('skiltis');
  const tab = TABS.some(([k]) => k === wanted) ? wanted
    : counts.svarbu ? 'svarbu' : counts.zmones ? 'zmones' : counts.klubai ? 'klubai' : pins.length || systems.length || notes.length ? 'svarbu' : 'zmones';

  const unreadDot = (n) => (n ? html`<span class="dotn" aria-label="${count(n, 'nauja žinutė', 'naujos žinutės', 'naujų žinučių')}">${n}</span>` : '');
  const row = (c) => {
    const team = c.kind === 'support' && !c.i_organize;
    const direct = c.kind === 'direct';
    const name = team ? 'Žvejybos turnyrų komanda' : direct ? c.other_nick || '–'
      : `${c.other_nick || '–'} · ${c.kind === 'support' ? 'pagalba' : c.i_organize ? 'dalyvis' : 'organizatorius'}`;
    const sub = direct ? 'Asmeninė žinutė'
      : c.prize_place ? html`<span class="chip-pz">🏆 ${c.prize_place} vieta${c.prize_cents ? ` · ${eur(c.prize_cents)}` : ''}${c.handed_at ? ' · įteikta' : ''}</span> ${c.tournament_title}` : c.tournament_title;
    const preview = c.last_body ? `${c.last_mine ? 'Tu: ' : ''}${c.last_body}` : 'Pokalbis pradėtas';
    return html`<li><a class="th ${c.unread ? 'unread' : ''}" href="#/zinutes/${c.id}" data-thread="${c.id}">
      ${team ? html`<span class="avatar th-team" aria-hidden="true"><img src="icons/icon.svg" alt="" width="40" height="40"></span>` : avatar(c.other_nick || '?')}
      <span class="th-nm"><span class="strong ellipsis">${name}</span><span class="th-t ellipsis">${sub}</span><span class="th-p ellipsis">${preview}</span></span>
      <span class="th-meta"><span>${whenShort(c.last_message_at)}</span>${unreadDot(c.unread)}</span>
    </a></li>`;
  };
  const pinCard = (c) => {
    const step = c.handed_at ? 3 : c.other_wrote ? 2 : 1;
    return html`<article class="imp-card" data-pin="${c.id}">
      <span class="pinlbl">${icon('trophy', 13)}Laimėjai prizą</span>
      <div class="imp-top"><span class="pl">#${c.prize_place}</span><span class="stack-1 min0"><b class="ellipsis">${c.tournament_title}</b>
        <span class="small muted">${c.prize_cents ? html`Prizas <b class="accent-ink">${eur(c.prize_cents)}</b>` : 'Daiktinis prizas'}</span></span></div>
      <ol class="steps3 plain" aria-label="Prizo eiga">
        <li class="ok"><i></i>Pranešta</li>
        <li class="${step >= 2 ? 'ok' : 'now'}"><i></i>${step >= 2 ? 'Organizatorius parašė' : 'Laukiam organizatoriaus'}</li>
        <li class="${step >= 3 ? 'ok' : step === 2 ? 'now' : ''}"><i></i>Prizas įteiktas</li>
      </ol>
      <a class="btn btn-primary" href="#/zinutes/${c.id}">${icon('chat', 18)}Pokalbis su organizatoriumi${c.unread ? html` <span class="dotn inv">${c.unread}</span>` : ''}</a>
    </article>`;
  };
  // „Svarbu“: rezultatų pokalbiai ir programėlės pranešimai – pagal laiką
  const items = [
    ...systems.map((c) => ({ at: c.last_message_at, unread: c.unread > 0, href: `#/zinutes/${c.id}`, ic: 'bars', hot: true,
      title: `${c.tournament_title}${c.prize_place ? ' · prizas' : ' baigėsi'}`, body: c.last_body || '' })),
    ...notes.map((n) => ({ at: n.created_at, unread: n.unread, href: /^#\/[\w\-/?=&]*$/.test(n.url) ? n.url : '#/', ic: NOTICE_IC[n.kind] || 'alert', hot: false,
      title: n.title, body: n.body }))
  ].sort((x, y) => (x.at < y.at ? 1 : -1));
  const noticeRow = (x) => html`<li><a class="sys-row ${x.unread ? 'unread' : ''}" href="${x.href}" data-notice>
    <span class="ic ${x.hot ? 'o' : ''}" aria-hidden="true">${icon(x.ic, 20)}</span>
    <span class="tx"><b class="ellipsis">${x.title}</b><span class="clamp-2">${x.body}</span></span>
    <span class="th-meta"><span>${whenShort(x.at)}</span>${x.unread ? html`<span class="dot-new" aria-label="Nauja"></span>` : ''}</span></a></li>`;
  const clubRow = (c) => html`<li><a class="th ${c.unread ? 'unread' : ''}" href="#/klubas/${c.club_id}/pokalbis" data-club-thread="${c.club_id}">
      ${c.logo_url ? html`<span class="avatar th-team" aria-hidden="true"><img src="${c.logo_url}" alt="" width="40" height="40"></span>` : html`<span class="avatar th-club" aria-hidden="true">${c.name.slice(0, 2).toUpperCase()}</span>`}
      <span class="th-nm"><span class="strong ellipsis">${c.name}</span><span class="th-t ellipsis">Klubo pokalbis · ${count(c.members, 'narys', 'nariai', 'narių')}</span>
        <span class="th-p ellipsis">${c.last_body ? `${c.last_mine ? 'Tu' : c.last_nick || '–'}: ${c.last_body}` : 'Dar niekas neparašė – pradėk pokalbį'}</span></span>
      <span class="th-meta"><span>${whenShort(c.last_at)}</span>${unreadDot(c.unread)}</span>
    </a></li>`;

  const body = tab === 'svarbu' ? html`
      ${pins.length ? html`<p class="sec-k">Prisegta, kol prizas įteiktas</p>${pins.map(pinCard)}` : ''}
      ${items.length ? html`${pins.length ? html`<p class="sec-k">Pranešimai</p>` : ''}<ul class="plain ibx" data-notices>${items.map(noticeRow)}</ul>`
        : pins.length ? '' : empty('Svarbių pranešimų nėra', 'Čia matysi turnyrų rezultatus, laimėjimus, patvirtintus laimikius ir kitus programėlės pranešimus.')}`
    : tab === 'zmones' ? html`
      ${people.length ? html`<ul class="plain inbox" data-inbox>${people.map(row)}</ul>`
        : empty('Pokalbių dar nėra', 'Klausimą organizatoriui gali užduoti turnyro puslapyje, o komandai – skiltyje „Pagalba“.')}
      <p class="small muted">Žinutes mato tik pokalbio dalyviai. Kitų žvejų kontaktų niekas nemato.</p>`
    : html`
      ${clubs.length ? html`<ul class="plain inbox" data-clubs>${clubs.map(clubRow)}</ul>`
        : empty('Klubų pokalbių nėra', 'Prisijunk prie klubo – jo nariai turi bendrą pokalbį.', html`<a class="btn" href="#/klubai">${icon('users', 18)}Klubai</a>`)}`;

  return {
    nav: 'turnyrai',
    title: 'Žinutės',
    html: html`<div class="screen">
      <header class="top-bar">${backButton('#/')}<span class="muted strong">Žinutės</span><span></span></header>
      <h1 class="sr-only" tabindex="-1">Žinutės</h1>
      <nav class="seg3" aria-label="Žinučių skiltys">${TABS.map(([k, label]) => html`<a href="#/zinutes?skiltis=${k}" aria-current="${k === tab ? 'page' : 'false'}" class="${k === tab ? 'on' : ''}" data-itab="${k}">${label}${counts[k] ? html` <span class="cnt">${counts[k]}</span>` : ''}</a>`)}</nav>
      <div class="stack" data-tab-body="${tab}">${body}</div>
    </div>`,
    mount() {
      // Peržiūrėjus „Svarbu“ – pranešimai pažymimi perskaitytais (rezultatų pokalbiai – kai atidaromi)
      if (tab === 'svarbu' && notes.some((n) => n.unread) && backend.markNoticesSeen) backend.markNoticesSeen().catch(() => {});
    }
  };
}

function resultCard(m, c) {
  const x = m.meta || {};
  const forOrganizer = c.i_organize;
  if (forOrganizer) {
    return html`<div class="b them b-auto" data-msg="${m.id}">${icon('trophy', 14)} Automatinė žinutė išsiųsta: „${m.body.length > 90 ? `${m.body.slice(0, 88)}…` : m.body}“<small>${time(m.created_at)}</small></div>`;
  }
  const t = { format: c.tournament_format };
  return html`<div class="sysmsg ${x.prize ? 'prize' : ''}" data-msg="${m.id}" data-result>
    <span class="small muted strong row gap-4">${icon('trophy', 14)}Žvejybos turnyrai · automatinė žinutė</span>
    ${x.place ? html`<div class="row gap-12"><span class="sys-pl">#${x.place}</span><span class="stack-1">
        <b class="sys-title">${x.prize ? `Sveikiname! Užėmei ${x.place} vietą` : `Užėmei ${x.place} vietą iš ${x.total}`}</b>
        <span class="small muted">${c.tournament_title}${x.score_mm ? ` · ${scoreText(t, x.score_mm)}` : ''}${x.counted ? ` · ${count(x.counted, 'žuvis', 'žuvys', 'žuvų')}` : ''}</span></span></div>`
      : html`<b class="sys-title">${m.body}</b>`}
    ${x.prize ? html`<span class="lockchip big-chip">${icon('trophy', 14)}${x.prize_cents ? `Prizas: ${eur(x.prize_cents)}` : 'Laimėjai prizą'}</span>` : ''}
    ${x.prize && c.kind === 'org' ? html`<p class="sys-note">${icon('chat', 18)}<span>Organizatorius su tavimi susisieks per <b>3 darbo dienas</b> čia, programėlės žinutėse. Pranešimą gausi į telefoną.</span></p>`
      : x.place && !x.prize ? html`<p class="small muted">Ačiū, kad dalyvavai!</p>` : ''}
  </div>`;
}

function messagesHtml(c, me) {
  let lastDay = '';
  let lastSender;
  return html`${c.messages.map((m) => {
    const day = dayKey(m.created_at);
    const sep = day !== lastDay ? html`<li class="day">${dayLabel(m.created_at)}</li>` : '';
    lastDay = day;
    let body;
    if (m.sender_id === null && m.meta?.event === 'result') body = resultCard(m, c);
    else if (m.sender_id === null) body = html`<p class="b-event" data-msg="${m.id}">${icon('check', 14)} ${m.body} · ${time(m.created_at)}</p>`;
    else {
      const mine = m.sender_id === me;
      const showName = !mine && lastSender !== m.sender_id;
      body = html`${showName ? html`<span class="who">${c.other_nick}</span>` : ''}<div class="b ${mine ? 'me' : 'them'}" data-msg="${m.id}" ${mine ? '' : html`data-reportable tabindex="0"`}>${m.body}<small>${time(m.created_at)}${mine && m.id === c.messages.filter((x) => x.sender_id === me).at(-1)?.id && seenByOther(c, m) ? ' · perskaityta' : ''}</small></div>
        ${mine ? '' : html`<div class="b-actions" data-report-box="${m.id}" hidden><button type="button" class="btn-text bad small" data-report="${m.id}">Pranešti apie žinutę</button></div>`}`;
    }
    lastSender = m.sender_id;
    return html`${sep}<li class="msg-li">${body}</li>`;
  })}`;
}
function seenByOther(c, m) {
  const seen = c.i_organize ? c.part_read_at : c.org_read_at;
  return !!seen && seen >= m.created_at;
}

export async function chatView(ctx, [id]) {
  const { backend, state } = ctx;
  if (!state.user) {
    return { nav: 'turnyrai', title: 'Žinutės', html: html`<div class="screen">${backButton('#/zinutes')}<h1 class="display-lg" tabindex="-1">Žinutės</h1>${loginPrompt('Prisijunk, kad matytum žinutes.')}</div>` };
  }
  let c = await backend.conversation(id);
  if (!c) return { nav: 'turnyrai', html: notFound('#/zinutes', 'Pokalbis nerastas', 'Galbūt jis ištrintas arba tai ne tavo pokalbis.') };
  const me = state.user.id;
  const sys = c.kind === 'system';
  const support = c.kind === 'support';
  const direct = c.kind === 'direct';
  const title = sys ? 'Žvejybos turnyrai' : support && !c.i_organize ? 'Žvejybos turnyrų komanda' : c.other_nick || '–';
  const sub = sys ? c.tournament_title : direct ? 'Asmeninė žinutė · profilis' : support ? (c.i_organize ? 'Pagalba · atsakai kaip komanda' : 'Pagalba · atsakome darbo dienomis')
    : `${c.i_organize ? (c.prize_place ? `${c.prize_place} vieta${c.prize_cents ? ` · prizas ${eur(c.prize_cents)}` : ''}` : 'Dalyvis') : 'Organizatorius'} · ${c.tournament_title}`;
  if (support && !c.i_organize) c.other_nick = 'Komanda';
  const composer = () => (sys ? html`<div class="chat-foot stack-2" data-sys-foot>
      <p class="small muted">Tai automatinė žinutė – atsakyti į ją negalima.</p>
      <button type="button" class="btn" data-ask-org>${icon('chat', 18)}Rašyti organizatoriui</button></div>`
    : c.blocked ? html`<div class="chat-foot stack-2" data-blocked><p class="small muted">${c.blocked_by_me ? 'Užblokavai šį pokalbį – žinučių nebegausi ir rašyti negalėsi.' : 'Pašnekovas užblokavo pokalbį.'}</p>
      ${c.blocked_by_me ? html`<button type="button" class="btn" data-unblock>Atblokuoti</button>` : ''}</div>`
    : html`<form class="composer" data-composer>
      <label class="sr-only" for="msg-input">Žinutė</label>
      <textarea id="msg-input" name="body" rows="1" maxlength="2000" placeholder="Rašyk žinutę…" required></textarea>
      <button type="submit" class="send-btn" aria-label="Siųsti">${icon('share', 20)}</button></form>`);

  return {
    nav: null,
    title: `${title} · Žinutės`,
    html: html`<div class="screen chat-screen">
      <header class="top-bar chat-top">${backButton('#/zinutes', 'Atgal į žinutes')}
        <div class="grow stack-1 pad-x"><h1 class="chat-name" tabindex="-1">${title}</h1><a class="small muted ellipsis link-plain" href="${support ? '#/pagalba' : direct ? `#/zvejys/${c.other_id}` : `#/t/${c.tournament_id}`}">${sub}</a></div>
        ${sys || support ? html`<span></span>` : html`<button type="button" class="icon-btn" data-chat-menu aria-expanded="false" aria-label="Daugiau veiksmų">⋯</button>`}</header>
      ${sys || support ? '' : html`<div class="card stack-2 chat-menu" data-chat-menu-box hidden>
        ${direct ? '' : html`<a class="btn btn-ghost" href="#/t/${c.tournament_id}">${icon('trophy', 16)}Turnyras</a>`}
        ${c.other_id ? html`<a class="btn btn-ghost" href="#/zvejys/${c.other_id}">${icon('user', 16)}Profilis</a>` : ''}
        ${c.blocked_by_me ? '' : c.blocked ? '' : html`<button type="button" class="btn btn-ghost bad" data-block>${icon('x', 16, 2.4)}Blokuoti pokalbį</button>`}
        <p class="small muted">Netinkamą žinutę paspausk – atsiras „Pranešti apie žinutę“.</p>
      </div>`}
      ${c.i_organize && c.prize_place ? html`<div class="chat-ctx" data-prize-ctx>${icon('trophy', 16)}<span class="grow small">Prizininkas · ${c.prize_place} vieta${c.prize_cents ? ` · ${eur(c.prize_cents)}` : ''}</span>
        <button type="button" class="btn btn-sm ${c.handed_at ? 'btn-ok' : ''}" data-handed aria-pressed="${!!c.handed_at}">${icon('check', 14, 2.6)}${c.handed_at ? 'Prizas įteiktas' : 'Pažymėti: įteiktas'}</button></div>` : ''}
      <ul class="plain chat" data-chat aria-live="polite">${messagesHtml(c, me)}</ul>
    </div>
    <div class="chat-bar" data-chat-bar>${composer()}</div>`,
    mount(root) {
      const list = root.querySelector('[data-chat]');
      const bar = document.querySelector('[data-chat-bar]');
      const scrollEnd = () => window.scrollTo(0, document.body.scrollHeight);
      const redraw = () => { list.innerHTML = String(messagesHtml(c, me)); };
      scrollEnd();
      backend.markRead(id).catch(() => {});
      let busy = false;
      const refresh = async () => {
        if (busy || document.hidden) return;
        busy = true;
        try {
          const next = await backend.conversation(id);
          if (next && (next.messages.length !== c.messages.length || next.handed_at !== c.handed_at || next.part_read_at !== c.part_read_at || next.org_read_at !== c.org_read_at)) {
            const atEnd = window.innerHeight + window.scrollY >= document.body.scrollHeight - 80;
            const grew = next.messages.length > c.messages.length;
            c = next;
            redraw();
            if (grew) { backend.markRead(id).catch(() => {}); if (atEnd) scrollEnd(); }
          }
        } catch { /* be ryšio – bandysim vėliau */ } finally { busy = false; }
      };
      const timer = setInterval(refresh, POLL_MS);

      const form = bar.querySelector('[data-composer]');
      if (form) {
        const ta = form.body;
        const grow = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(140, ta.scrollHeight)}px`; };
        ta.addEventListener('input', grow);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const text = ta.value.trim();
          if (!text) return;
          const btn = form.querySelector('.send-btn');
          btn.disabled = true;
          try {
            await backend.sendMessage(id, text);
            ta.value = '';
            grow();
            c = (await backend.conversation(id)) || c;
            redraw();
            scrollEnd();
          } catch (err) {
            ctx.toast(err.message || 'Nepavyko išsiųsti');
          } finally {
            btn.disabled = false;
            ta.focus();
          }
        });
      }
      bar.querySelector('[data-ask-org]')?.addEventListener('click', async () => {
        try {
          const cid = await backend.startConversation(c.tournament_id);
          ctx.navigate(`#/zinutes/${cid}`);
        } catch (err) {
          ctx.toast(err.message || 'Nepavyko');
        }
      });
      bar.querySelector('[data-unblock]')?.addEventListener('click', async () => {
        try { await backend.blockConversation(id, false); ctx.toast('Pokalbis atblokuotas'); ctx.rerender(); } catch (err) { ctx.toast(err.message || 'Nepavyko'); }
      });
      const menuBtn = root.querySelector('[data-chat-menu]');
      menuBtn?.addEventListener('click', () => {
        const box = root.querySelector('[data-chat-menu-box]');
        box.hidden = !box.hidden;
        menuBtn.setAttribute('aria-expanded', String(!box.hidden));
      });
      root.querySelector('[data-block]')?.addEventListener('click', async () => {
        try { await backend.blockConversation(id, true); ctx.toast('Pokalbis užblokuotas'); ctx.rerender(); } catch (err) { ctx.toast(err.message || 'Nepavyko'); }
      });
      root.querySelector('[data-handed]')?.addEventListener('click', async (e) => {
        const b = e.currentTarget;
        const on = b.getAttribute('aria-pressed') !== 'true';
        b.disabled = true;
        try {
          await backend.setPrizeHanded(id, on);
          ctx.toast(on ? 'Pažymėta: prizas įteiktas' : 'Žymė nuimta');
          ctx.rerender();
        } catch (err) {
          b.disabled = false;
          ctx.toast(err.message || 'Nepavyko');
        }
      });
      list.addEventListener('click', async (e) => {
        const rep = e.target.closest('[data-report]');
        if (rep) {
          rep.disabled = true;
          try { await backend.reportMessage(Number(rep.dataset.report), null); ctx.toast('Ačiū – administracija peržiūrės žinutę'); rep.closest('[data-report-box]').hidden = true; }
          catch (err) { rep.disabled = false; ctx.toast(err.message || 'Nepavyko pranešti'); }
          return;
        }
        const bubble = e.target.closest('[data-reportable]');
        if (bubble) {
          const box = list.querySelector(`[data-report-box="${bubble.dataset.msg}"]`);
          if (box) box.hidden = !box.hidden;
        }
      });
      return () => clearInterval(timer);
    }
  };
}

// Turnyro nustatymuose: prizininkų sąrašas, terminas ir „Rašyti visiems“ (organizatoriui).
export function prizersSection(t, rows, { organizer }) {
  if (!rows?.length) return '';
  const deadline = rows.map((r) => r.deadline_at).filter(Boolean).sort()[0];
  const pending = rows.filter((r) => !r.organizer_wrote && !r.handed_at).length;
  const left = businessDaysLeft(deadline);
  return html`<section class="set-sec" id="set-prizers" data-prizers>
    <div class="row-between"><h2 class="h2">Prizininkai · ${rows.length}</h2>${t.prize_fund_cents ? html`<span class="small muted">Fondas ${eur(t.prize_fund_cents)}</span>` : ''}</div>
    ${pending && deadline ? html`<p class="dl-note ${left < 0 ? 'late' : ''}" data-deadline>${icon('clock', 18)}<span>${left < 0
      ? html`<b>Terminas praėjo ${shortDate(deadline)}.</b> ${count(pending, 'prizininkas dar laukia', 'prizininkai dar laukia', 'prizininkų dar laukia')} tavo žinutės.`
      : html`<b>Susisiek su prizininkais iki ${dateTime(deadline)}</b> (3 darbo dienos). Jiems jau išsiųsta automatinė žinutė.`}</span></p>` : ''}
    <ul class="plain prz">${rows.map((r) => {
      const status = r.handed_at ? html`<span class="st-chip ok">${icon('check', 12, 2.6)}Įteikta</span>`
        : r.organizer_wrote ? html`<span class="st-chip ok">Susisiekta</span>` : '';
      const note = r.handed_at ? `Prizas įteiktas ${shortDate(r.handed_at)}`
        : r.organizer_wrote ? (r.replied ? 'Parašei · atsakė' : 'Parašei · laukiama atsakymo')
        : `Dar neparašei${left === null ? '' : left < 0 ? ' · terminas praėjo' : ` · liko ${left} d. d.`}`;
      return html`<li class="pr-row" data-prizer="${r.participant_id}">
        <span class="pr-r">${r.prize_place}</span>
        <span class="grow stack-1"><b class="ellipsis">${r.nickname}${r.prize_cents ? ` · ${eur(r.prize_cents)}` : ''}</b><span class="small muted">${note}</span></span>
        ${organizer ? html`<a class="btn btn-sm ${!status ? 'btn-primary' : ''}" href="#/zinutes/${r.conversation_id}" aria-label="Rašyti ${r.nickname}">${icon('chat', 15)}${status ? '' : 'Rašyti'}</a>` : ''}${status}
      </li>`;
    })}</ul>
    ${organizer ? html`<button type="button" class="btn btn-ghost" data-write-all aria-expanded="false">${icon('chat', 18)}Rašyti visiems prizininkams</button>
    <div class="stack-2" data-write-all-box hidden>
      <label class="field"><span class="small muted strong">Žinutė visiems prizininkams</span>
        <textarea data-write-all-text rows="3" maxlength="2000" placeholder="pvz. Sveikinu! Prizus įteiksiu šeštadienį 10 val. prieplaukoje."></textarea></label>
      <button type="button" class="btn btn-primary" data-write-all-send>Siųsti ${count(rows.length, 'prizininkui', 'prizininkams', 'prizininkų')}</button>
    </div>` : ''}
    <p class="small muted">Pokalbyje gali pažymėti „Prizas įteiktas“. Jei per 3 darbo dienas neparašysi, gausi priminimą, o programėlės administracija – pranešimą.</p>
  </section>`;
}

export function bindPrizers(root, ctx, rows) {
  const btn = root.querySelector('[data-write-all]');
  if (!btn) return;
  const box = root.querySelector('[data-write-all-box]');
  btn.addEventListener('click', () => {
    box.hidden = !box.hidden;
    btn.setAttribute('aria-expanded', String(!box.hidden));
    if (!box.hidden) box.querySelector('textarea').focus();
  });
  root.querySelector('[data-write-all-send]').addEventListener('click', async (e) => {
    const text = root.querySelector('[data-write-all-text]').value.trim();
    if (!text) { ctx.toast('Įrašyk žinutę'); return; }
    const b = e.currentTarget;
    b.disabled = true;
    let ok = 0;
    for (const r of rows) {
      try { await ctx.backend.sendMessage(r.conversation_id, text); ok += 1; } catch { /* tęsiam */ }
    }
    b.disabled = false;
    ctx.toast(ok === rows.length ? 'Žinutė išsiųsta visiems prizininkams' : `Išsiųsta ${ok} iš ${rows.length}`);
    ctx.rerender();
  });
}

// Administracijai: žinutės, apie kurias pranešė žvejai.
export async function reportedMessagesView(ctx) {
  const { backend, state } = ctx;
  if (!can(state, 'ban')) {
    return { nav: 'profilis', html: html`<div class="screen">${backButton('#/profilis')}<h1 class="sr-only" tabindex="-1">Pranešimai apie žinutes</h1>${empty('Šiai skilčiai neturi teisių', 'Pranešimus apie žinutes peržiūri administracija.')}</div>` };
  }
  const rows = await backend.reportedMessages();
  return {
    nav: 'profilis',
    title: 'Pranešimai apie žinutes',
    html: html`<div class="screen">
      <header class="top-bar">${backButton('#/moderavimas/pranesimai')}<span class="muted strong">Pranešimai apie žinutes</span><span></span></header>
      <h1 class="sr-only" tabindex="-1">Pranešimai apie žinutes</h1>
      ${rows.length ? html`<div class="stack">${rows.map((r) => html`<article class="card stack-2" data-msg-report="${r.report_id}">
        <div class="row-between gap-8"><span class="strong">${r.sender_nick || '–'}</span><span class="small muted">${dateTime(r.created_at)}</span></div>
        <p class="b-quote">${r.body}</p>
        <p class="small muted">Pranešė ${r.reporter_nick || '–'}${r.reason ? ` · ${r.reason}` : ''} · ${r.tournament_title}</p>
        <div class="row gap-8 wrap">
          ${r.sender_id ? html`<a class="btn btn-sm" href="#/zvejys/${r.sender_id}">${icon('user', 14)}Profilis</a>` : ''}
          ${r.resolved_at ? html`<span class="st-chip ok">Peržiūrėta</span>` : html`<button type="button" class="btn btn-sm" data-resolve="${r.report_id}">${icon('check', 14)}Peržiūrėta</button>`}
        </div>
      </article>`)}</div>` : empty('Pranešimų nėra', 'Kai žvejys praneš apie netinkamą žinutę, ji atsiras čia.')}
      <p class="small muted">Rodoma tik žinutė, apie kurią pranešta – ne visas pokalbis. Pažeidėją gali užblokuoti skiltyje „Blokuoti“.</p>
    </div>`,
    mount(root) {
      root.querySelectorAll('[data-resolve]').forEach((b) => b.addEventListener('click', async () => {
        try { await backend.resolveMessageReport(Number(b.dataset.resolve)); ctx.toast('Pažymėta'); ctx.rerender(); } catch (err) { ctx.toast(err.message || 'Nepavyko'); }
      }));
    }
  };
}
