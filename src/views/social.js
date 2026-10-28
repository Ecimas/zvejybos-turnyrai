// Sekimas (#/sekami), klubai (#/klubai, #/klubas/:id) ir „Sekti“ mygtukas žvejo profilyje.
import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { cm, shortDate, count } from '../lib/format.js';
import { backButton, empty, thumb, hydratePhotos, avatar, loginPrompt, notFound } from '../ui.js';

const sp = (state, id) => state.species.find((s) => s.id === id)?.name_lt ?? '';

function catchList(state, list) {
  return html`<div class="stack-2">${list.map((c) => html`<a class="card card-link row tight" href="#/l/${c.id}">
    ${thumb(c.photo_path, 64)}
    <span class="grow stack-1"><span class="strong">${c.nickname} · ${sp(state, c.species_id)} ${cm(c.length_mm)}</span>
    <span class="small muted">${shortDate(c.captured_at_device)}</span></span>${icon('chevron', 18)}</a>`)}</div>`;
}

// ---------------------------------------------------------------- Sekimas
export async function feedView(ctx) {
  const { backend, state } = ctx;
  if (!state.user) {
    return { nav: 'lenteles', title: 'Sekami žvejai', html: html`<div class="screen"><h1 class="display-lg" tabindex="-1">Sekami žvejai</h1>${loginPrompt('Prisijunk, kad sektum žvejus.')}</div>` };
  }
  const { following, catches } = await backend.followingFeed();
  return {
    nav: 'lenteles',
    title: 'Sekami žvejai',
    html: html`<div class="screen">
      <header class="top-bar">${backButton('#/profilis')}<span class="muted strong">Sekami</span><span></span></header>
      <h1 class="display-md" tabindex="-1">Sekamų žvejų laimikiai</h1>
      <p class="small muted">Seki ${count(following, 'žvejį', 'žvejus', 'žvejų')}. Rodomi tik patvirtinti laimikiai, vietos – niekada.</p>
      ${catches.length ? catchList(state, catches)
        : empty(following ? 'Naujų laimikių dar nėra' : 'Dar nieko neseki', 'Atidaryk žvejo profilį (paspausk slapyvardį lentelėje) ir spausk „Sekti“.')}
    </div>`,
    mount(root) { hydratePhotos(root, backend); }
  };
}

export function followBlock(stats, isMe, loggedIn) {
  return html`<div class="row gap-10 wrap follow-block" data-follow-block>
    <span class="small muted" data-follow-counts><strong>${stats.followers}</strong> ${stats.followers === 1 ? 'sekėjas' : 'sekėjai'} · seka <strong>${stats.following}</strong></span>
    ${!isMe && loggedIn ? html`<button class="btn ${stats.i_follow ? 'btn-ghost' : 'btn-primary'} small-btn" type="button" data-follow aria-pressed="${stats.i_follow}">
      ${stats.i_follow ? html`${icon('check', 16, 3)}Seki` : html`${icon('plus', 16, 2.6)}Sekti`}</button>` : ''}
  </div>`;
}

export function mountFollow(root, ctx, userId) {
  const btn = root.querySelector('[data-follow]');
  btn?.addEventListener('click', async () => {
    btn.disabled = true;
    const on = btn.getAttribute('aria-pressed') !== 'true';
    try {
      if (on) await ctx.backend.follow(userId);
      else await ctx.backend.unfollow(userId);
      ctx.toast(on ? 'Seki – jo laimikius matysi skiltyje „Sekami“' : 'Nebeseki');
      ctx.rerender();
    } catch (err) {
      btn.disabled = false;
      ctx.toast(err.message || 'Nepavyko');
    }
  });
}

// ---------------------------------------------------------------- Klubai
export async function clubsView(ctx) {
  const { backend, state } = ctx;
  const [clubs, mine] = await Promise.all([backend.clubs(), state.user ? backend.myClubs() : []]);
  const myIds = new Set(mine.map((c) => c.id));
  return {
    nav: 'lenteles',
    title: 'Klubai',
    html: html`<div class="screen">
      <header class="top-bar">${backButton('#/lenteles')}<span class="muted strong">Klubai</span><span></span></header>
      <h1 class="display-md" tabindex="-1">Žvejų klubai</h1>
      ${clubs.length > 6 ? html`<label class="field"><span class="sr-only">Ieškoti klubo</span><input data-search type="search" placeholder="Ieškoti klubo" autocomplete="off"></label>` : ''}
      ${clubs.length ? html`<div class="list" data-club-list>${clubs.map((c) => html`<a class="list-row" href="#/klubas/${c.id}" data-name="${c.name.toLowerCase()}">
        ${icon('users', 20)}
        <span class="grow stack-1"><span class="strong">${c.name}${myIds.has(c.id) ? html` <span class="badge badge-mine">Narys</span>` : ''}</span>
        <span class="small muted">${count(c.members, 'narys', 'nariai', 'narių')}${c.region ? ` · ${c.region}` : ''}${c.open ? '' : ' · su kvietimu'}</span></span>
        ${icon('chevron', 18)}</a>`)}</div>` : empty('Klubų dar nėra', 'Sukurk pirmąjį ir pakviesk draugus.')}
      ${state.user && !state.ban ? html`<details class="card stack-2" data-create-club>
        <summary class="strong row gap-8">${icon('plus', 18, 2.6)}Sukurti klubą</summary>
        <form class="stack" data-club-form>
          <label class="field"><span class="small muted strong">Pavadinimas</span><input name="name" required minlength="3" maxlength="40" autocomplete="off"></label>
          <label class="field"><span class="small muted strong">Regionas (nebūtina)</span><input name="region" maxlength="40"></label>
          <label class="field"><span class="small muted strong">Apie klubą (nebūtina)</span><textarea name="description" rows="2" maxlength="300"></textarea></label>
          <label class="check-row"><input type="checkbox" name="open" checked><span class="stack-1"><span class="strong">Atviras</span>
            <span class="small muted">Prisijungti gali bet kas. Išjungus – tik su tavo kvietimo kodu.</span></span></label>
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
          ctx.toast('Klubas sukurtas');
          ctx.navigate(`#/klubas/${id}`);
        } catch (err) {
          btn.disabled = false;
          ctx.toast(err.message || 'Nepavyko sukurti klubo');
        }
      });
    }
  };
}

export async function clubView(ctx, [id], query) {
  const { backend, state } = ctx;
  const club = await backend.club(id);
  if (!club) return { nav: 'lenteles', html: notFound('#/klubai', 'Klubas nerastas') };
  const me = state.user?.id;
  const my = club.members.find((m) => m.user_id === me);
  const owner = my?.role === 'owner';
  const [code, catches] = await Promise.all([
    my ? backend.clubInviteCode(id) : null,
    backend.clubCatches(club.members.map((m) => m.user_id)).catch(() => [])
  ]);
  const prefill = (query?.get?.('kodas') || '').replace(/[^0-9a-f]/gi, '').slice(0, 10);
  const inviteUrl = code ? `${location.origin}${location.pathname}#/klubas/${id}?kodas=${code}` : '';
  return {
    nav: 'lenteles',
    title: club.name,
    html: html`<div class="screen">
      <header class="top-bar">${backButton('#/klubai')}<span class="muted strong">Klubas</span><span></span></header>
      <header class="stack-2">
        <h1 class="display-md" tabindex="-1">${club.name}</h1>
        <p class="small muted">${count(club.members.length, 'narys', 'nariai', 'narių')}${club.region ? ` · ${club.region}` : ''} · ${club.open ? 'atviras' : 'su kvietimu'}</p>
        ${club.description ? html`<p class="prewrap">${club.description}</p>` : ''}
      </header>
      ${!me ? loginPrompt('Prisijunk, kad prisijungtum prie klubo.')
        : my ? html`<section class="card stack-2">
            <p class="strong">${owner ? 'Tu – klubo savininkas' : 'Tu – klubo narys'}</p>
            ${code ? html`<p class="small muted">Kvietimo nuoroda draugams${club.open ? '' : ' (be jos prisijungti negalima)'}:</p>
              <div class="row gap-8"><input class="grow" readonly value="${inviteUrl}" aria-label="Kvietimo nuoroda" data-invite-url><button class="btn btn-ghost small-btn" type="button" data-copy>Kopijuoti</button></div>` : ''}
            ${owner ? '' : html`<button class="btn-text bad" type="button" data-leave>Išeiti iš klubo</button>`}
          </section>`
        : state.ban ? '' : html`<form class="card stack-2" data-join-form>
            ${club.open ? '' : html`<label class="field"><span class="small muted strong">Kvietimo kodas</span><input name="code" required maxlength="10" value="${prefill}" autocomplete="off"></label>`}
            <button class="btn btn-primary" type="submit">${icon('plus', 18, 2.6)}Prisijungti prie klubo</button>
          </form>`}
      <section class="stack-2">
        <h2 class="h2">Nariai</h2>
        <div class="list">${club.members.map((m) => html`<div class="list-row">
          ${avatar(m.nickname)}
          <a class="grow stack-1 link-plain" href="#/zvejys/${m.user_id}"><span class="strong">${m.nickname}${m.user_id === me ? ' (tu)' : ''}</span>
            <span class="small muted">${m.role === 'owner' ? 'Savininkas' : `Narys nuo ${shortDate(m.joined_at)}`}</span></a>
          ${owner && m.role !== 'owner' ? html`<button class="btn-text bad" type="button" data-kick="${m.user_id}" data-nick="${m.nickname}">Pašalinti</button>` : ''}
        </div>`)}</div>
      </section>
      <section class="stack-2">
        <h2 class="h2">Naujausi narių laimikiai</h2>
        ${catches.length ? catchList(state, catches) : html`<p class="small muted">Patvirtintų laimikių dar nėra.</p>`}
      </section>
      ${owner ? html`<details class="card stack-2">
        <summary class="strong">Klubo nustatymai</summary>
        <form class="stack" data-edit-club>
          <label class="field"><span class="small muted strong">Pavadinimas</span><input name="name" required minlength="3" maxlength="40" value="${club.name}"></label>
          <label class="field"><span class="small muted strong">Regionas</span><input name="region" maxlength="40" value="${club.region || ''}"></label>
          <label class="field"><span class="small muted strong">Apie klubą</span><textarea name="description" rows="2" maxlength="300">${club.description || ''}</textarea></label>
          <label class="check-row"><input type="checkbox" name="open" ${club.open ? 'checked' : ''}><span class="strong">Atviras</span></label>
          <button class="btn btn-primary" type="submit">Išsaugoti</button>
        </form>
        <button class="btn btn-danger" type="button" data-delete-club>Ištrinti klubą</button>
      </details>` : ''}
    </div>`,
    mount(root) {
      hydratePhotos(root, backend);
      const join = root.querySelector('[data-join-form]');
      join?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = join.querySelector('button');
        btn.disabled = true;
        try {
          await backend.joinClub(id, join.code?.value.trim());
          ctx.toast(`Prisijungei prie „${club.name}“`);
          ctx.navigate(`#/klubas/${id}`);
          ctx.rerender();
        } catch (err) {
          btn.disabled = false;
          ctx.toast(err.message || 'Nepavyko prisijungti');
        }
      });
      root.querySelector('[data-copy]')?.addEventListener('click', async () => {
        const input = root.querySelector('[data-invite-url]');
        try { await navigator.clipboard.writeText(input.value); ctx.toast('Nuoroda nukopijuota'); } catch { input.select(); }
      });
      root.querySelector('[data-leave]')?.addEventListener('click', async () => {
        if (!confirm(`Išeiti iš „${club.name}“?`)) return;
        await backend.leaveClub(id).catch(() => ctx.toast('Nepavyko'));
        ctx.toast('Išėjai iš klubo');
        ctx.rerender();
      });
      root.querySelectorAll('[data-kick]').forEach((b) => b.addEventListener('click', async () => {
        if (!confirm(`Pašalinti ${b.dataset.nick} iš klubo?`)) return;
        await backend.removeClubMember(id, b.dataset.kick).catch(() => ctx.toast('Nepavyko'));
        ctx.toast(`${b.dataset.nick} pašalintas`);
        ctx.rerender();
      }));
      const edit = root.querySelector('[data-edit-club]');
      edit?.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await backend.updateClub(id, { name: edit.name.value.trim(), region: edit.region.value.trim() || null, description: edit.description.value.trim() || null, open: edit.open.checked });
          ctx.toast('Išsaugota');
          ctx.rerender();
        } catch (err) {
          ctx.toast(err.message || 'Nepavyko');
        }
      });
      root.querySelector('[data-delete-club]')?.addEventListener('click', async () => {
        if (!confirm(`Ištrinti klubą „${club.name}“? Nariai bus atjungti.`)) return;
        await backend.deleteClub(id).catch(() => ctx.toast('Nepavyko'));
        ctx.toast('Klubas ištrintas');
        ctx.navigate('#/klubai');
      });
    }
  };
}
