// Sekimas (#/sekami), klubai (#/klubai, #/klubas/:id) ir „Sekti“ mygtukas žvejo profilyje.
import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { cm, shortDate, count } from '../lib/format.js';
import { backButton, empty, thumb, hydratePhotos, avatar, loginPrompt, notFound, featureOffScreen } from '../ui.js';
import { feat } from '../lib/clubs.js';

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
  if (!feat(state, 'social_follow')) return featureOffScreen('Sekami žvejai', 'Sekimas šiuo metu išjungtas', '#/profilis', 'lenteles');
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
