// Klubai (#/klubai, #/klubas/:id, #/klubu-lyga, #/klubas/:id/zemelapis): veikla, laimikiai, rekordai, nariai.
import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { cm, shortDate, count, dateTime } from '../lib/format.js';
import { backButton, empty, thumb, hydratePhotos, avatar, loginPrompt, notFound } from '../ui.js';
import { can } from '../lib/roles.js';
import { feat, REACTIONS, MONTHS_NOM, roleLt, clubLogo } from '../lib/clubs.js';
import { shrinkLogo } from '../lib/sponsors.js';

const spName = (state, id) => state.species.find((s) => s.id === id)?.name_lt ?? '';
const TABS = [['veikla', 'Veikla'], ['laimikiai', 'Laimikiai'], ['rekordai', 'Rekordai'], ['nariai', 'Nariai']];
const pad = (n) => String(n).padStart(2, '0');
const localInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const ago = (iso) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `prieš ${Math.max(1, m)} min.`;
  if (m < 1440) return `prieš ${Math.round(m / 60)} val.`;
  return shortDate(iso);
};

// ---------------------------------------------------------------- Sąrašas
export async function clubsView(ctx) {
  const { backend, state } = ctx;
  const [clubs, mine, league] = await Promise.all([
    backend.clubs(), state.user ? backend.myClubs() : [],
    feat(state, 'club_league') && backend.clubLeague ? backend.clubLeague().catch(() => []) : []
  ]);
  const myIds = new Set(mine.map((c) => c.id));
  const place = new Map(league.map((c, i) => [c.id, i + 1]));
  return {
    nav: 'lenteles',
    title: 'Klubai',
    html: html`<div class="screen">
      <header class="top-bar">${backButton('#/lenteles')}<span class="muted strong">Klubai</span><span></span></header>
      <h1 class="display-md" tabindex="-1">Žvejų klubai</h1>
      ${league.length ? html`<a class="card card-link row cl-league-link" href="#/klubu-lyga" data-league-link>
        <span class="cl-league-ico">${icon('trophy', 22)}</span>
        <span class="grow stack-1"><span class="strong">Klubų lyga ${new Date().getFullYear()}</span>
          <span class="small muted">Pirmauja ${league[0].name} · ${league[0].points} tšk.</span></span>${icon('chevron', 18)}</a>` : ''}
      ${clubs.length > 6 ? html`<label class="field"><span class="sr-only">Ieškoti klubo</span><input data-search type="search" placeholder="Ieškoti klubo" autocomplete="off"></label>` : ''}
      ${clubs.length ? html`<div class="list" data-club-list>${clubs.map((c) => html`<a class="list-row" href="#/klubas/${c.id}" data-name="${c.name.toLowerCase()}">
        ${clubLogo(c, 'sm')}
        <span class="grow stack-1"><span class="strong">${c.name}${c.verified ? html` <span class="cl-ver" title="Patvirtintas klubas">${icon('check', 13, 3)}<span class="sr-only">patvirtintas</span></span>` : ''}${myIds.has(c.id) ? html` <span class="badge badge-mine">Narys</span>` : ''}</span>
        <span class="small muted">${count(c.members, 'narys', 'nariai', 'narių')}${c.region ? ` · ${c.region}` : ''}${c.open ? '' : ' · su kvietimu'}${place.has(c.id) ? ` · lygoje #${place.get(c.id)}` : ''}</span></span>
        ${icon('chevron', 18)}</a>`)}</div>` : empty('Klubų dar nėra', 'Sukurk pirmąjį ir pakviesk draugus.')}
      ${state.user && !state.ban ? html`<details class="card stack-2" data-create-club>
        <summary class="strong row gap-8">${icon('plus', 18, 2.6)}Sukurti klubą</summary>
        <form class="stack" data-club-form>
          <label class="field"><span class="small muted strong">Pavadinimas</span><input name="name" required minlength="3" maxlength="40" autocomplete="off"></label>
          <label class="field"><span class="small muted strong">Regionas (nebūtina)</span><input name="region" maxlength="40"></label>
          <label class="field"><span class="small muted strong">Apie klubą (nebūtina)</span><textarea name="description" rows="2" maxlength="300"></textarea></label>
          <label class="check-row"><input type="checkbox" name="open" checked><span class="stack-1"><span class="strong">Atviras</span>
            <span class="small muted">Prisijungti gali bet kas. Išjungus – su kvietimo kodu arba tavo patvirtinimu.</span></span></label>
          <button class="btn btn-primary" type="submit">Sukurti klubą</button>
        </form>
      </details>` : ''}
    </div>`,
    mount(root) {
      root.querySelector('[data-search]')?.addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        root.querySelectorAll('[data-club-list] [data-name]').forEach((a) => { a.hidden = q && !a.dataset.name.includes(q); });
      });
      const form = root.querySelector('[data-club-form]');
      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
          const id = await backend.createClub({ name: form.name.value.trim(), region: form.region.value.trim(), description: form.description.value.trim(), open: form.open.checked });
          ctx.toast('Klubas sukurtas – pakviesk narius');
          try { sessionStorage.setItem(`zt-ctab-${id}`, 'nariai'); } catch { /* */ }
          ctx.navigate(`#/klubas/${id}`);
        } catch (err) {
          btn.disabled = false;
          ctx.toast(err.message || 'Nepavyko sukurti klubo');
        }
      });
    }
  };
}

// ---------------------------------------------------------------- Klubų lyga
export async function clubLeagueView(ctx) {
  const { backend, state } = ctx;
  const [league, mine] = await Promise.all([backend.clubLeague(), state.user ? backend.myClubs() : []]);
  const myIds = new Set(mine.map((c) => c.id));
  return {
    nav: 'lenteles',
    title: 'Klubų lyga',
    html: html`<div class="screen">
      <header class="top-bar">${backButton('#/klubai')}<span class="muted strong">Klubų lyga</span><span></span></header>
      <h1 class="display-md" tabindex="-1">Klubų lyga ${new Date().getFullYear()}</h1>
      <p class="small muted">Klubo taškai – 5 geriausių narių sezono taškų suma. Nario taškai – jo 10 didžiausių patvirtintų laimikių ilgių suma (cm).</p>
      ${league.length ? html`<ol class="card cl-league plain" data-league>${league.map((c, i) => html`<li>
        <a class="cl-lg-row ${myIds.has(c.id) ? 'me' : ''}" href="#/klubas/${c.id}">
          <b class="cl-pos ${i === 0 ? 'accent' : ''}">${i + 1}</b>${clubLogo(c, 'sm')}
          <span class="grow stack-1 min0"><span class="strong ellipsis">${c.name}${c.verified ? html` <span class="cl-ver">${icon('check', 13, 3)}</span>` : ''}</span>
            <span class="small muted">${count(c.members, 'narys', 'nariai', 'narių')}${c.region ? ` · ${c.region}` : ''}${myIds.has(c.id) ? ' · tavo klubas' : ''}</span></span>
          <span class="strong">${c.points}</span></a></li>`)}</ol>`
        : empty('Lyga dar tuščia', 'Kai klubų nariai užregistruos patvirtintų laimikių, čia atsiras reitingas.')}
    </div>`
  };
}

// ---------------------------------------------------------------- Klubo puslapis
export async function clubView(ctx, [id], query) {
  const { backend, state } = ctx;
  const club = await backend.club(id);
  if (!club) return { nav: 'lenteles', html: notFound('#/klubai', 'Klubas nerastas') };
  const me = state.user?.id;
  const my = club.my || (club.members.find((m) => m.user_id === me) ? { role: club.members.find((m) => m.user_id === me).role, share_map: false } : null);
  const member = !!my;
  const owner = my?.role === 'owner';
  const admin = owner || my?.role === 'admin';
  const staff = can(state, 'roles');
  const f = (k) => feat(state, k);
  const memberIds = club.members.map((m) => m.user_id);
  const wanted = query?.get?.('skiltis');
  let saved = null;
  try { saved = sessionStorage.getItem(`zt-ctab-${id}`); } catch { /* */ }
  const tab = TABS.some(([k]) => k === wanted) ? wanted : TABS.some(([k]) => k === saved) ? saved : member ? 'veikla' : 'rekordai';

  const safe = (p, d) => (p ? p.catch(() => d) : Promise.resolve(d));
  const [code, catches, posts, tips, trips, challenge, records, league, perk, requests, myRequest] = await Promise.all([
    member ? safe(backend.clubInviteCode(id), null) : null,
    safe(backend.clubCatches(memberIds), []),
    member && f('club_posts') && backend.clubPosts ? safe(backend.clubPosts(id, 'post'), []) : [],
    member && f('club_tips') && backend.clubPosts ? safe(backend.clubPosts(id, 'tip'), []) : [],
    member && f('club_trips') && backend.clubTrips ? safe(backend.clubTrips(id), []) : [],
    member && f('club_challenge') && backend.clubChallenge ? safe(backend.clubChallenge(id), null) : null,
    f('club_records') && backend.clubRecords ? safe(backend.clubRecords(id), null) : null,
    f('club_league') && backend.clubLeague ? safe(backend.clubLeague(), []) : [],
    member && f('club_perks') && backend.clubPerk ? safe(backend.clubPerk(id), null) : null,
    admin && backend.clubJoinRequests ? safe(backend.clubJoinRequests(id), []) : [],
    me && !member && !club.open && backend.myJoinRequest ? safe(backend.myJoinRequest(id), null) : null
  ]);
  const social = member && (f('club_reactions') || f('club_comments')) && backend.catchSocial
    ? await safe(backend.catchSocial(catches.map((c) => c.id)), {}) : {};
  const leaguePos = league.findIndex((c) => c.id === id) + 1;
  const prefill = (query?.get?.('kodas') || '').replace(/[^0-9a-f]/gi, '').slice(0, 10);
  const inviteUrl = code ? `${location.origin}${location.pathname}#/klubas/${id}?kodas=${code}` : '';
  const nick = (uid) => club.members.find((m) => m.user_id === uid)?.nickname ?? '';
  const membersOnly = html`<div class="card stack-2 center"><p class="strong">${icon('lock', 16)} Tik klubo nariams</p><p class="small muted">Prisijunk prie klubo, kad matytum jo veiklą ir laimikius.</p></div>`;

  // --- Veikla
  const tripCard = (t) => html`<article class="cl-card ${t.my === 'going' ? 'hot' : ''}" data-trip="${t.id}">
    <span class="cl-k">${icon('pin', 14)}Išvyka · ${t.nickname}</span>
    <span class="strong cl-trip-when">${dateTime(t.starts_at)}</span>
    <span class="muted">${t.place}${t.seats !== null && t.seats !== undefined ? ` · ${t.seats ? `liko ${count(t.seats, 'vieta', 'vietos', 'vietų')} 🚗` : 'mašina pilna'}` : ''}</span>
    ${t.notes ? html`<span class="small prewrap">${t.notes}</span>` : ''}
    <span class="row-between"><span class="cl-av" aria-hidden="true">${t.going.slice(0, 6).map((n) => html`<span>${(n || '?').charAt(0).toUpperCase()}</span>`)}</span>
      <span class="small muted">${t.going.length} važiuoja${t.maybe.length ? ` · ${t.maybe.length} gal` : ''}</span></span>
    ${t.going.length ? html`<span class="small muted">${t.going.join(', ')}</span>` : ''}
    <div class="cl-btns">
      <button type="button" class="cl-b ${t.my === 'going' ? 'on' : ''}" data-rsvp="going" aria-pressed="${t.my === 'going'}">${icon('check', 16, 3)}Važiuoju</button>
      <button type="button" class="cl-b ${t.my === 'maybe' ? 'on' : ''}" data-rsvp="maybe" aria-pressed="${t.my === 'maybe'}">Gal</button>
    </div>
    ${t.author_id === me || admin ? html`<button type="button" class="btn-text bad small" data-trip-del>Atšaukti išvyką</button>` : ''}
  </article>`;
  const challengeCard = () => {
    if (!challenge) return '';
    const m = new Date(challenge.month);
    const left = Math.max(0, Math.ceil((new Date(challenge.ends_at) - Date.now()) / 864e5));
    const top = challenge.top || [];
    const mineIdx = top.findIndex((t) => t.user_id === me);
    return html`<article class="cl-card" data-challenge>
      <span class="cl-k">${icon('trophy', 14)}${MONTHS_NOM[m.getMonth()]} iššūkis · liko ${count(left, 'diena', 'dienos', 'dienų')}</span>
      <span class="strong">${challenge.species_id ? `Didžiausias ${spName(state, challenge.species_id).toLowerCase()}` : 'Didžiausia žuvis'}</span>
      ${top.length ? html`<ol class="plain">${top.slice(0, 3).map((t, i) => html`<li class="cl-rank ${t.user_id === me ? 'me' : ''}"><b>${i + 1}</b>
        <a class="grow link-plain" href="#/l/${t.catch_id}">${t.user_id === me ? 'Tu' : t.nickname || nick(t.user_id)}</a><span class="strong">${cm(t.len)}</span></li>`)}
        ${mineIdx > 2 ? html`<li class="cl-rank me"><b>${mineIdx + 1}</b><span class="grow">Tu</span><span class="strong">${cm(top[mineIdx].len)}</span></li>` : ''}</ol>`
        : html`<p class="small muted">Dar niekas nepagavo – būk pirmas!</p>`}
    </article>`;
  };
  const veikla = !member ? membersOnly : html`
    ${perk ? html`<div class="cl-perk" data-perk><span class="cl-perk-ico">${icon('star', 22)}</span>
      <span class="grow stack-1"><span class="strong">${perk.offer}</span><span class="small muted">${perk.sponsor_name} · rodoma tik nariams</span>
        ${perk.url ? html`<a class="small link" href="${perk.url}" target="_blank" rel="noopener noreferrer sponsored">Į rėmėjo svetainę</a>` : ''}</span>
      ${perk.code ? html`<button type="button" class="cl-code" data-copy-code="${perk.code}" aria-label="Kopijuoti kodą ${perk.code}">${perk.code}</button>` : ''}</div>` : ''}
    ${f('club_posts') ? html`<section class="stack-2" data-posts>
      ${posts.slice(0, 3).map((p) => html`<article class="cl-card"><span class="cl-k">${icon('bell', 14)}Pranešimas · ${p.nickname} · ${ago(p.created_at)}</span>
        <span class="prewrap">${p.body}</span>
        ${p.author_id === me || admin ? html`<button type="button" class="btn-text bad small" data-post-del="${p.id}">Ištrinti</button>` : ''}</article>`)}
      ${admin ? html`<details class="card stack-2" data-post-new><summary class="strong row gap-8">${icon('bell', 16)}Naujas pranešimas nariams</summary>
        <form class="stack-2" data-post-form><label class="field"><span class="sr-only">Pranešimas</span><textarea name="body" rows="3" maxlength="500" required minlength="2" placeholder="pvz. Šeštadienį susitikimas 8:00 prie prieplaukos"></textarea></label>
        <button class="btn btn-primary" type="submit">Paskelbti</button><p class="small muted">Nariai gaus pranešimą telefone.</p></form></details>` : ''}
    </section>` : ''}
    ${f('club_trips') ? html`<section class="stack-2" data-trips>
      ${trips.map(tripCard)}
      <details class="card stack-2" data-trip-new><summary class="strong row gap-8">${icon('plus', 16, 2.6)}Nauja išvyka</summary>
        <form class="stack-2" data-trip-form>
          <label class="field"><span class="small muted strong">Kada</span><input type="datetime-local" name="starts_at" required value="${localInput(new Date(Date.now() + 864e5))}"></label>
          <label class="field"><span class="small muted strong">Kur</span><input name="place" required minlength="2" maxlength="80" placeholder="pvz. Kauno marios, Pažaislio prieplauka"></label>
          <label class="field"><span class="small muted strong">Pastabos (nebūtina)</span><textarea name="notes" rows="2" maxlength="300" placeholder="pvz. turiu valtį, imu 1 žmogų"></textarea></label>
          <label class="field"><span class="small muted strong">Laisvų vietų mašinoje (nebūtina)</span><input name="seats" type="number" min="0" max="8" inputmode="numeric"></label>
          <button class="btn btn-primary" type="submit">Pakviesti narius</button>
        </form></details>
    </section>` : ''}
    ${f('club_challenge') ? challengeCard() : ''}
    ${admin && f('club_tournament') ? html`<a class="btn btn-ghost" href="#/naujas?klubas=${id}" data-club-tournament>${icon('trophy', 18)}Klubo turnyras</a>` : ''}`;

  // --- Laimikiai
  const reactBar = (c) => {
    const s = social[c.id];
    if (!s) return '';
    return html`<div class="cl-react" data-social="${c.id}">
      ${f('club_reactions') ? REACTIONS.map(([k, e, label]) => html`<button type="button" class="cl-chip ${s.mine.includes(k) ? 'on' : ''}" data-react="${k}" aria-pressed="${s.mine.includes(k)}" aria-label="${label}: ${s[k]}">${e} <span>${s[k]}</span></button>`) : ''}
      ${f('club_comments') ? html`<button type="button" class="cl-chip" data-comments aria-expanded="false">${icon('chat', 15)} <span>${s.comments}</span><span class="sr-only"> komentarai</span></button>` : ''}
    </div>
    <div class="stack-2" data-comment-box hidden></div>`;
  };
  const laimikiai = !member ? membersOnly : html`
    ${f('club_map') ? html`<a class="card card-link row" href="#/klubas/${id}/zemelapis" data-club-map-link>${icon('pin', 20)}
      <span class="grow stack-1"><span class="strong">Klubo žemėlapis</span><span class="small muted">Laimikiai, kuriais nariai pasidalino (~1 km tikslumu)</span></span>${icon('chevron', 18)}</a>` : ''}
    ${catches.length ? html`<div class="stack" data-feed>${catches.map((c) => html`<article class="cl-card" data-feed-item="${c.id}">
      <div class="row gap-8">${avatar(c.nickname)}<a class="grow stack-1 link-plain" href="#/l/${c.id}"><span class="strong">${c.nickname}</span>
        <span class="small muted">${ago(c.captured_at_device)} · ${spName(state, c.species_id)}</span></a><span class="cl-len">${cm(c.length_mm)}</span></div>
      <a class="cl-photo" href="#/l/${c.id}" aria-label="${spName(state, c.species_id)} ${cm(c.length_mm)}">${thumb(c.photo_path, 160)}</a>
      ${reactBar(c)}
    </article>`)}</div>` : html`<p class="small muted">Patvirtintų narių laimikių dar nėra.</p>`}
    ${f('club_tips') ? html`<section class="stack-2" data-tips><h2 class="h2">Klubo patarimai</h2>
      ${tips.map((t) => html`<article class="cl-card"><span class="prewrap">„${t.body}“</span>
        <span class="row-between"><span class="small muted">${t.nickname} · ${ago(t.created_at)}</span>
          <span class="row gap-8">${t.author_id === me || admin ? html`<button type="button" class="btn-text bad small" data-post-del="${t.id}">Ištrinti</button>` : ''}
          <button type="button" class="cl-chip ${t.liked ? 'on' : ''}" data-like="${t.id}" aria-pressed="${t.liked}" aria-label="Naudinga: ${t.likes}">👍 <span>${t.likes}</span></button></span></span></article>`)}
      <form class="card stack-2" data-tip-form><label class="field"><span class="small muted strong">Pasidalink patarimu su klubu</span>
        <textarea name="body" rows="2" maxlength="500" required minlength="2" placeholder="pvz. Ešeriai kimba 4–6 m gylyje, geriausia rytais"></textarea></label>
        <button class="btn" type="submit">Pasidalinti</button></form>
    </section>` : ''}`;

  // --- Rekordai
  const rekordai = html`
    ${leaguePos ? html`<a class="card card-link row" href="#/klubu-lyga">${icon('trophy', 20)}<span class="grow stack-1"><span class="strong">Klubų lygoje #${leaguePos}</span>
      <span class="small muted">${league[leaguePos - 1].points} tšk. · iš ${league.length} klubų</span></span>${icon('chevron', 18)}</a>` : ''}
    ${records ? html`<section class="cl-card" data-records><span class="cl-k">${icon('trophy', 14)}Klubo rekordai</span>
      ${records.records.length ? records.records.map((r) => html`<a class="cl-rec link-plain" href="#/l/${r.catch_id}"><span class="stack-1 grow"><span class="strong">${spName(state, r.species_id)}</span>
        <span class="small muted">${r.user_id === me ? 'Tu' : r.nickname} · ${shortDate(r.at)}</span></span><span class="cl-len">${cm(r.len)}</span></a>`)
        : html`<p class="small muted">Rekordų dar nėra.</p>`}</section>
    <section class="cl-card" data-season><span class="cl-k">${icon('bars', 14)}${records.year} sezono reitingas</span>
      ${records.season.length ? html`<ol class="plain">${records.season.slice(0, 15).map((s, i) => html`<li class="cl-rank ${s.user_id === me ? 'me' : ''}"><b>${i + 1}</b>
        <span class="grow">${s.user_id === me ? 'Tu' : s.nickname}</span><span class="small muted">${count(Number(s.catches), 'laimikis', 'laimikiai', 'laimikių')} ·</span><span class="strong">&nbsp;${s.points} tšk.</span></li>`)}</ol>
        <p class="small muted">Taškai – 10 didžiausių patvirtintų laimikių ilgių suma (cm).</p>`
        : html`<p class="small muted">Šį sezoną patvirtintų laimikių dar nėra.</p>`}</section>` : html`<p class="small muted">Rekordai šiuo metu nerodomi.</p>`}`;

  // --- Nariai
  const nariai = html`
    ${member ? html`<section class="card stack-2" data-membership>
      <p class="strong">${owner ? 'Tu – klubo savininkas' : my.role === 'admin' ? 'Tu – klubo administratorius' : 'Tu – klubo narys'}</p>
      ${code ? html`<p class="small muted">Kvietimo nuoroda draugams${club.open ? '' : ' (be jos prisijungti galima tik su patvirtinimu)'}:</p>
        <div class="row gap-8"><input class="grow" readonly value="${inviteUrl}" aria-label="Kvietimo nuoroda" data-invite-url><button class="btn btn-ghost small-btn" type="button" data-copy>Kopijuoti</button></div>` : ''}
      ${f('club_map') && club.v2 !== false && 'share_map' in (my || {}) ? html`<label class="check-row"><input type="checkbox" data-share-map ${my.share_map ? 'checked' : ''}>
        <span class="stack-1"><span class="strong">Rodyti mano laimikius klubo žemėlapyje</span><span class="small muted">Vieta apvalinama iki ~1 km. Gali išjungti bet kada.</span></span></label>` : ''}
      ${owner ? '' : html`<button class="btn-text bad" type="button" data-leave>Išeiti iš klubo</button>`}
    </section>` : ''}
    ${requests.length ? html`<section class="card stack-2" data-join-requests><span class="cl-k">Prašymai prisijungti · ${requests.length}</span>
      ${requests.map((r) => html`<div class="row gap-8" data-req="${r.user_id}">${avatar(r.nickname)}<span class="grow stack-1"><span class="strong">${r.nickname}</span>
        ${r.message ? html`<span class="small muted">„${r.message}“</span>` : ''}</span>
        <button type="button" class="icon-btn" data-req-yes="${r.user_id}" aria-label="Priimti ${r.nickname}">${icon('check', 18, 3)}</button>
        <button type="button" class="icon-btn" data-req-no="${r.user_id}" aria-label="Atmesti ${r.nickname}">${icon('x', 18, 2.6)}</button></div>`)}</section>` : ''}
    <section class="stack-2"><h2 class="h2">Nariai · ${club.members.length}</h2>
      <div class="list">${club.members.map((m) => html`<div class="list-row">
        ${avatar(m.nickname)}
        <a class="grow stack-1 link-plain" href="#/zvejys/${m.user_id}"><span class="strong">${m.nickname}${m.user_id === me ? ' (tu)' : ''}</span>
          <span class="small ${m.role === 'member' ? 'muted' : 'accent strong'}">${m.role === 'member' ? `Narys nuo ${shortDate(m.joined_at)}` : roleLt(m.role)}</span></a>
        ${owner && m.role !== 'owner' && club.v2 !== false ? html`<button class="btn-text small" type="button" data-admin="${m.user_id}" data-on="${m.role !== 'admin'}">${m.role === 'admin' ? 'Atimti adm.' : 'Skirti adm.'}</button>` : ''}
        ${(owner && m.role !== 'owner') || (admin && m.role === 'member' && m.user_id !== me) ? html`<button class="btn-text bad" type="button" data-kick="${m.user_id}" data-nick="${m.nickname}">Pašalinti</button>` : ''}
      </div>`)}</div>
    </section>
    ${admin ? html`<details class="card stack-2" data-club-settings>
      <summary class="strong">Klubo nustatymai</summary>
      <form class="stack" data-edit-club>
        <label class="field"><span class="small muted strong">Pavadinimas</span><input name="name" required minlength="3" maxlength="40" value="${club.name}"></label>
        <label class="field"><span class="small muted strong">Regionas</span><input name="region" maxlength="40" value="${club.region || ''}"></label>
        <label class="field"><span class="small muted strong">Apie klubą</span><textarea name="description" rows="2" maxlength="300">${club.description || ''}</textarea></label>
        <label class="check-row"><input type="checkbox" name="open" ${club.open ? 'checked' : ''}><span class="strong">Atviras</span></label>
        <button class="btn btn-primary" type="submit">Išsaugoti</button>
      </form>
      ${club.v2 !== false ? html`<div class="stack-2" data-club-images><span class="cl-k">Išvaizda</span>
        <div class="row gap-10">${clubLogo(club, 'md')}<label class="btn btn-ghost file-btn">${icon('camera', 18)}Logotipas<input type="file" accept="image/*" data-club-img="logo" hidden></label>
          <label class="btn btn-ghost file-btn">${icon('camera', 18)}Viršelis<input type="file" accept="image/*" data-club-img="cover" hidden></label></div></div>
      ${f('club_perks') ? html`<form class="stack-2" data-perk-form><span class="cl-k">Rėmėjo nuolaida nariams</span>
        <label class="field"><span class="small muted strong">Rėmėjas</span><input name="sponsor_name" maxlength="60" value="${perk?.sponsor_name || ''}" placeholder="pvz. Ežero banga"></label>
        <label class="field"><span class="small muted strong">Pasiūlymas</span><input name="offer" maxlength="120" value="${perk?.offer || ''}" placeholder="pvz. −15 % nariams"></label>
        <div class="grid-2"><label class="field"><span class="small muted strong">Kodas</span><input name="code" maxlength="24" value="${perk?.code || ''}" placeholder="LYD15"></label>
          <label class="field"><span class="small muted strong">Nuoroda (https://)</span><input name="url" type="url" maxlength="300" value="${perk?.url || ''}"></label></div>
        <div class="row gap-10"><button class="btn btn-primary grow" type="submit">Išsaugoti nuolaidą</button>${perk ? html`<button class="btn" type="button" data-perk-del>Pašalinti</button>` : ''}</div>
        <p class="small muted">Kodą ir pasiūlymą mato tik klubo nariai.</p></form>` : ''}
      ${owner && !club.verified ? html`<button class="btn btn-ghost" type="button" data-verify-req>${icon('check', 18, 3)}Prašyti „Patvirtinto klubo“ žymės</button>` : ''}` : ''}
      ${owner ? html`<button class="btn btn-danger" type="button" data-delete-club>Ištrinti klubą</button>` : ''}
    </details>` : ''}
    ${staff && club.v2 !== false ? html`<label class="card check-row" data-staff-verify><input type="checkbox" data-verify ${club.verified ? 'checked' : ''}>
      <span class="stack-1"><span class="strong">Patvirtintas klubas</span><span class="small muted">Žymę skiria programėlės komanda</span></span></label>` : ''}`;

  const panels = { veikla, laimikiai, rekordai, nariai };
  return {
    nav: 'lenteles',
    title: club.name,
    html: html`<div class="screen">
      <header class="top-bar">${backButton('#/klubai')}<span class="muted strong">Klubas</span><span></span></header>
      <div class="cl-cover ${club.cover_url ? 'has-img' : ''}">${club.cover_url ? html`<img src="${club.cover_url}" alt="">` : ''}</div>
      <header class="cl-head">
        ${clubLogo(club, 'lg')}
        <div class="stack-1 min0">
          <h1 class="display-md cl-name" tabindex="-1">${club.name}</h1>
          <span class="small muted">${count(club.members.length, 'narys', 'nariai', 'narių')}${club.region ? ` · ${club.region}` : ''} · ${club.open ? 'atviras' : 'su kvietimu'}</span>
          ${club.verified ? html`<span class="cl-ver" data-verified>${icon('check', 13, 3)}Patvirtintas klubas</span>` : ''}
        </div>
      </header>
      ${club.description ? html`<p class="prewrap">${club.description}</p>` : ''}
      ${member || leaguePos ? html`<div class="row gap-8 wrap">${member ? html`<span class="badge badge-mine">${owner ? 'Tu – savininkas' : my.role === 'admin' ? 'Tu – administratorius' : 'Tu – narys'}</span>` : ''}
        ${leaguePos ? html`<span class="badge">${icon('trophy', 13)} Klubų lygoje #${leaguePos}</span>` : ''}</div>` : ''}
      ${!me ? loginPrompt('Prisijunk, kad prisijungtum prie klubo.')
        : member || state.ban ? ''
        : club.open ? html`<form class="card stack-2" data-join-form><button class="btn btn-primary" type="submit">${icon('plus', 18, 2.6)}Prisijungti prie klubo</button></form>`
        : html`<div class="card stack-2">
            <form class="stack-2" data-join-form>
              <label class="field"><span class="small muted strong">Kvietimo kodas</span><input name="code" required maxlength="10" value="${prefill}" autocomplete="off"></label>
              <button class="btn btn-primary" type="submit">${icon('plus', 18, 2.6)}Prisijungti prie klubo</button>
            </form>
            ${backend.requestJoinClub && club.v2 !== false ? (myRequest ? html`<p class="small muted" data-join-pending>${icon('clock', 14)} Prašymas išsiųstas – laukia klubo patvirtinimo.</p>`
              : html`<details class="stack-2" data-join-request><summary class="small strong accent">Neturi kodo? Paprašyk prisijungti</summary>
                <form class="stack-2" data-join-request-form><label class="field"><span class="small muted strong">Trumpai apie save (nebūtina)</span><textarea name="message" rows="2" maxlength="200"></textarea></label>
                <button class="btn" type="submit">Siųsti prašymą</button></form></details>`) : ''}
          </div>`}
      <nav class="cl-tabs" role="tablist" aria-label="Klubo skiltys">${TABS.map(([k, label]) => html`<button type="button" role="tab" id="ct-${k}" aria-controls="cp-${k}" data-ctab="${k}" aria-selected="${k === tab}" aria-pressed="${k === tab}">${label}${k === 'nariai' && requests.length ? html` <span class="tab-badge">${requests.length}</span>` : ''}</button>`)}</nav>
      ${TABS.map(([k]) => html`<section class="stack-lg" id="cp-${k}" role="tabpanel" aria-labelledby="ct-${k}" data-cpanel="${k}" ${k === tab ? '' : 'hidden'}>${panels[k]}</section>`)}
    </div>`,
    mount(root) {
      hydratePhotos(root, backend);
      const act = async (fn, ok, rerender = true) => {
        try { await fn(); if (ok) ctx.toast(ok); if (rerender) ctx.rerender(); return true; } catch (err) { ctx.toast(err.message || 'Nepavyko'); return false; }
      };
      root.querySelectorAll('[data-ctab]').forEach((b) => b.addEventListener('click', () => {
        const k = b.dataset.ctab;
        try { sessionStorage.setItem(`zt-ctab-${id}`, k); history.replaceState(history.state, '', `#/klubas/${id}?skiltis=${k}`); } catch { /* */ }
        root.querySelectorAll('[data-ctab]').forEach((x) => { x.setAttribute('aria-selected', String(x === b)); x.setAttribute('aria-pressed', String(x === b)); });
        root.querySelectorAll('[data-cpanel]').forEach((x) => { x.hidden = x.dataset.cpanel !== k; });
      }));
      const join = root.querySelector('[data-join-form]');
      join?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = join.querySelector('button');
        btn.disabled = true;
        try {
          await backend.joinClub(id, join.code?.value.trim());
          ctx.toast(`Prisijungei prie „${club.name}“`);
          try { sessionStorage.setItem(`zt-ctab-${id}`, 'nariai'); } catch { /* */ }
          ctx.navigate(`#/klubas/${id}`);
          ctx.rerender();
        } catch (err) {
          btn.disabled = false;
          ctx.toast(err.message || 'Nepavyko prisijungti');
        }
      });
      const jr = root.querySelector('[data-join-request-form]');
      jr?.addEventListener('submit', (e) => { e.preventDefault(); act(() => backend.requestJoinClub(id, jr.message.value.trim()), 'Prašymas išsiųstas'); });
      root.querySelector('[data-copy]')?.addEventListener('click', async () => {
        const input = root.querySelector('[data-invite-url]');
        try { await navigator.clipboard.writeText(input.value); ctx.toast('Nuoroda nukopijuota'); } catch { input.select(); }
      });
      root.querySelector('[data-copy-code]')?.addEventListener('click', async (e) => {
        try { await navigator.clipboard.writeText(e.currentTarget.dataset.copyCode); ctx.toast('Kodas nukopijuotas'); } catch { /* */ }
      });
      root.querySelector('[data-leave]')?.addEventListener('click', async () => {
        if (!confirm(`Išeiti iš „${club.name}“?`)) return;
        await act(() => backend.leaveClub(id), 'Išėjai iš klubo');
      });
      root.querySelectorAll('[data-kick]').forEach((b) => b.addEventListener('click', async () => {
        if (!confirm(`Pašalinti ${b.dataset.nick} iš klubo?`)) return;
        await act(() => backend.removeClubMember(id, b.dataset.kick), `${b.dataset.nick} pašalintas`);
      }));
      root.querySelectorAll('[data-admin]').forEach((b) => b.addEventListener('click', () => {
        const on = b.dataset.on === 'true';
        act(() => backend.setClubAdmin(id, b.dataset.admin, on), on ? 'Paskirtas administratorius' : 'Administratoriaus teisės atimtos');
      }));
      root.querySelectorAll('[data-req-yes], [data-req-no]').forEach((b) => b.addEventListener('click', () => {
        const yes = 'reqYes' in b.dataset;
        act(() => backend.decideJoinClub(id, yes ? b.dataset.reqYes : b.dataset.reqNo, yes), yes ? 'Priimtas į klubą' : 'Prašymas atmestas');
      }));
      root.querySelector('[data-share-map]')?.addEventListener('change', (e) => {
        act(() => backend.setClubShareMap(id, e.target.checked), e.target.checked ? 'Tavo laimikiai rodomi klubo žemėlapyje' : 'Nebesidalini su klubo žemėlapiu', false);
      });
      const edit = root.querySelector('[data-edit-club]');
      edit?.addEventListener('submit', (e) => {
        e.preventDefault();
        act(() => backend.updateClub(id, { name: edit.name.value.trim(), region: edit.region.value.trim() || null, description: edit.description.value.trim() || null, open: edit.open.checked }), 'Išsaugota');
      });
      root.querySelectorAll('[data-club-img]').forEach((input) => input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        const kind = input.dataset.clubImg;
        try {
          const blob = await shrinkLogo(file);
          const { path } = await backend.uploadClubImage(id, kind, blob);
          await backend.updateClub(id, kind === 'logo' ? { logo_path: path } : { cover_path: path });
          ctx.toast(kind === 'logo' ? 'Logotipas atnaujintas' : 'Viršelis atnaujintas');
          ctx.rerender();
        } catch (err) {
          ctx.toast(err.message || 'Nepavyko įkelti');
        }
      }));
      const pf = root.querySelector('[data-perk-form]');
      pf?.addEventListener('submit', (e) => {
        e.preventDefault();
        act(() => backend.saveClubPerk(id, { sponsor_name: pf.sponsor_name.value.trim(), offer: pf.offer.value.trim(), code: pf.code.value.trim() || null, url: pf.url.value.trim() || null }), 'Nuolaida išsaugota');
      });
      root.querySelector('[data-perk-del]')?.addEventListener('click', () => act(() => backend.saveClubPerk(id, null), 'Nuolaida pašalinta'));
      root.querySelector('[data-verify-req]')?.addEventListener('click', () => act(() => backend.requestClubVerification(id), 'Prašymas išsiųstas komandai', false));
      root.querySelector('[data-verify]')?.addEventListener('change', (e) => act(() => backend.setClubVerified(id, e.target.checked), e.target.checked ? 'Klubas pažymėtas kaip patvirtintas' : 'Žymė nuimta'));
      root.querySelector('[data-delete-club]')?.addEventListener('click', async () => {
        if (!confirm(`Ištrinti klubą „${club.name}“? Nariai bus atjungti.`)) return;
        await backend.deleteClub(id).catch(() => ctx.toast('Nepavyko'));
        ctx.toast('Klubas ištrintas');
        ctx.navigate('#/klubai');
      });

      // Veikla
      const postForm = root.querySelector('[data-post-form]');
      postForm?.addEventListener('submit', (e) => { e.preventDefault(); act(() => backend.postClub(id, 'post', postForm.body.value.trim()), 'Paskelbta'); });
      const tipForm = root.querySelector('[data-tip-form]');
      tipForm?.addEventListener('submit', (e) => { e.preventDefault(); act(() => backend.postClub(id, 'tip', tipForm.body.value.trim()), 'Ačiū už patarimą!'); });
      root.querySelectorAll('[data-post-del]').forEach((b) => b.addEventListener('click', () => {
        if (confirm('Ištrinti įrašą?')) act(() => backend.deleteClubPost(b.dataset.postDel), 'Ištrinta');
      }));
      root.querySelectorAll('[data-like]').forEach((b) => b.addEventListener('click', () => {
        act(() => backend.likeClubPost(b.dataset.like, b.getAttribute('aria-pressed') !== 'true'));
      }));
      const tripForm = root.querySelector('[data-trip-form]');
      tripForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        const seats = tripForm.seats.value === '' ? null : Number(tripForm.seats.value);
        act(() => backend.createTrip(id, { starts_at: new Date(tripForm.starts_at.value).toISOString(), place: tripForm.place.value.trim(), notes: tripForm.notes.value.trim(), seats }), 'Išvyka paskelbta – nariai gaus pranešimą');
      });
      root.querySelectorAll('[data-trip]').forEach((card) => {
        const tid = card.dataset.trip;
        card.querySelectorAll('[data-rsvp]').forEach((b) => b.addEventListener('click', () => {
          const on = b.getAttribute('aria-pressed') !== 'true';
          act(() => backend.rsvpTrip(tid, on ? b.dataset.rsvp : null), on ? (b.dataset.rsvp === 'going' ? 'Važiuoji! 🎣' : 'Pažymėta „gal“') : 'Atšaukta');
        }));
        card.querySelector('[data-trip-del]')?.addEventListener('click', () => { if (confirm('Atšaukti išvyką?')) act(() => backend.deleteTrip(tid), 'Išvyka atšaukta'); });
      });

      // Laimikiai: reakcijos ir komentarai
      root.querySelectorAll('[data-social]').forEach((bar) => {
        const cid = bar.dataset.social;
        bar.querySelectorAll('[data-react]').forEach((b) => b.addEventListener('click', async () => {
          const on = b.getAttribute('aria-pressed') !== 'true';
          const n = b.querySelector('span');
          b.disabled = true;
          try {
            await backend.react(cid, b.dataset.react, on);
            b.setAttribute('aria-pressed', String(on));
            b.classList.toggle('on', on);
            n.textContent = String(Number(n.textContent) + (on ? 1 : -1));
            b.classList.remove('pop'); void b.offsetWidth; if (on) b.classList.add('pop');
          } catch (err) { ctx.toast(err.message || 'Nepavyko'); }
          b.disabled = false;
        }));
        const box = bar.nextElementSibling;
        const btn = bar.querySelector('[data-comments]');
        btn?.addEventListener('click', () => {
          const open = box.hidden;
          box.hidden = !open;
          btn.setAttribute('aria-expanded', String(open));
          if (open) loadComments(cid, box, btn);
        });
      });
      async function loadComments(cid, box, btn) {
        box.innerHTML = String(html`<p class="small muted">Įkeliama…</p>`);
        const list = await backend.catchComments(cid).catch(() => []);
        box.innerHTML = String(commentsHtml(list, me, admin || can(state, 'review'), false));
        btn.querySelector('span').textContent = String(list.length);
        bindComments(box, cid, () => loadComments(cid, box, btn), ctx);
      }
    }
  };
}

// Komentarų blokas (naudojamas ir laimikio puslapyje).
export function commentsHtml(list, me, moderator, catchOwner) {
  return html`${list.length ? html`<ul class="cl-comments plain">${list.map((c) => html`<li data-comment="${c.id}"><span class="cl-cmt"><b>${c.nickname}</b> <span class="prewrap">${c.body}</span></span>
    <span class="small muted">${ago(c.created_at)}${c.user_id === me || moderator || catchOwner
      ? html` · <button type="button" class="link-btn small bad" data-comment-del="${c.id}">Ištrinti</button>` : ''}${c.user_id !== me
      ? html` · <button type="button" class="link-btn small muted" data-comment-report="${c.id}">Pranešti</button>` : ''}</span></li>`)}</ul>`
    : html`<p class="small muted">Komentarų dar nėra.</p>`}
    <form class="row gap-8" data-comment-form><label class="grow"><span class="sr-only">Komentaras</span><input name="body" maxlength="300" required placeholder="Rašyti komentarą…" autocomplete="off"></label>
      <button class="btn btn-primary small-btn" type="submit" aria-label="Siųsti komentarą">${icon('check', 18, 3)}</button></form>`;
}

export function bindComments(box, catchId, reload, ctx) {
  const { backend } = ctx;
  const form = box.querySelector('[data-comment-form]');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = form.body.value.trim();
    if (!body) return;
    form.querySelector('button').disabled = true;
    try { await backend.addComment(catchId, body); reload(); } catch (err) { ctx.toast(err.message || 'Nepavyko'); form.querySelector('button').disabled = false; }
  });
  box.querySelectorAll('[data-comment-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Ištrinti komentarą?')) return;
    try { await backend.deleteComment(b.dataset.commentDel); reload(); } catch { ctx.toast('Nepavyko ištrinti'); }
  }));
  box.querySelectorAll('[data-comment-report]').forEach((b) => b.addEventListener('click', async () => {
    try { await backend.reportComment(b.dataset.commentReport); ctx.toast('Ačiū – moderatorius peržiūrės'); b.remove(); } catch { ctx.toast('Nepavyko pranešti'); }
  }));
}

// ---------------------------------------------------------------- Klubo žemėlapis
export async function clubMapView(ctx, [id]) {
  const { backend, state } = ctx;
  const club = await backend.club(id);
  if (!club) return { nav: 'lenteles', html: notFound('#/klubai', 'Klubas nerastas') };
  const member = !!(club.my || club.members.some((m) => m.user_id === state.user?.id));
  const points = member ? await backend.clubMap(id).catch(() => []) : [];
  const sharing = club.my?.share_map;
  return {
    nav: 'lenteles',
    title: `${club.name} · žemėlapis`,
    html: html`<div class="screen">
      <header class="top-bar">${backButton(`#/klubas/${id}?skiltis=laimikiai`)}<span class="muted strong">Klubo žemėlapis</span><span></span></header>
      <h1 class="sr-only" tabindex="-1">${club.name}: klubo žemėlapis</h1>
      <p class="small muted">${icon('lock', 14)} Mato tik „${club.name}“ nariai. Vietos apvalintos iki ~1 km. ${count(points.length, 'laimikis', 'laimikiai', 'laimikių')}.</p>
      ${!member ? empty('Tik klubo nariams', '') : points.length ? html`<div class="mp-wrap" data-map-wrap style="height:62vh">
          <div class="mp-canvas" data-map role="region" aria-label="Klubo laimikių žemėlapis"><p class="small muted center mp-msg">Įkeliamas žemėlapis…</p></div>
          <section class="mp-sheet" data-sheet hidden></section></div>`
        : empty('Žemėlapis dar tuščias', sharing ? 'Kai nariai pasidalins laimikiais, jie atsiras čia.' : 'Įjunk „Rodyti mano laimikius klubo žemėlapyje“ skiltyje „Nariai“ – ir pakviesk kitus.')}
    </div>`,
    async mount(root) {
      const box = root.querySelector('[data-map]');
      if (!box) return undefined;
      const { mapEngine } = await import('./map.js');
      const pts = points.map((p) => ({ id: p.catch_id, lat: p.lat, lng: p.lng, species_id: p.species_id, length_mm: p.length_mm, captured_at_device: p.captured_at, nickname: p.nickname }));
      const sheet = root.querySelector('[data-sheet]');
      let engine;
      const onPick = (cid) => {
        const c = pts.find((x) => x.id === cid);
        if (!c) return;
        const near = pts.filter((x) => Math.abs(x.lat - c.lat) < 1e-6 && Math.abs(x.lng - c.lng) < 1e-6).sort((a, b) => b.length_mm - a.length_mm);
        sheet.hidden = false;
        sheet.innerHTML = String(html`<div class="mp-handle" aria-hidden="true"></div>
          <div class="row-between"><span class="small muted strong">Šioje apylinkėje ${count(near.length, 'laimikis', 'laimikiai', 'laimikių')}</span>
          <button type="button" class="mp-mini" data-sheet-close aria-label="Uždaryti">${icon('x', 16, 2.4)}</button></div>
          <ul class="plain mp-spots">${near.slice(0, 20).map((x) => html`<li><a class="mp-spot link-plain" href="#/l/${x.id}"><span class="grow stack-1"><span class="strong">${spName(state, x.species_id)} ${cm(x.length_mm)}</span>
            <span class="small muted">${x.nickname} · ${shortDate(x.captured_at_device)}</span></span>${icon('chevron', 18)}</a></li>`)}</ul>`);
        sheet.querySelector('[data-sheet-close]').addEventListener('click', () => { sheet.hidden = true; engine?.highlight(null); });
        engine?.highlight(c.lat, c.lng);
      };
      try {
        engine = await mapEngine(box, { onPick, state });
      } catch {
        box.innerHTML = String(html`<p class="small muted center mp-msg">Žemėlapio nepavyko įkelti – patikrink ryšį.</p>`);
        return undefined;
      }
      if (!box.isConnected) { engine.destroy(); return undefined; }
      engine.setPoints(pts);
      engine.fit(pts);
      return () => engine.destroy();
    }
  };
}
