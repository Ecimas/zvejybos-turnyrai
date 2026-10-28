// Sezono lygos (#/lygos, #/lyga/:id): kelių turnyrų (etapų) bendra įskaita taškais už vietas.
import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { count, dateTime } from '../lib/format.js';
import { backButton, empty, avatar, notFound, phaseBadge } from '../ui.js';

const POINTS_TEXT = 'Taškai už vietą etape: 25, 18, 15, 12, 10, 8, 6, 4, 2, 1.';

export async function leaguesView(ctx) {
  const { backend, state } = ctx;
  const list = await backend.leagues();
  const year = new Date().getFullYear();
  return {
    nav: 'lenteles',
    title: 'Sezono lygos',
    html: html`<div class="screen">
      <header class="top-bar">${backButton('#/lenteles')}<span class="muted strong">Lygos</span><span></span></header>
      <h1 class="display-md" tabindex="-1">Sezono lygos</h1>
      <p class="small muted">Lygą sudaro keli turnyrai (etapai). ${POINTS_TEXT}</p>
      ${list.length ? html`<div class="list" data-league-list>${list.map((l) => html`<a class="list-row" href="#/lyga/${l.id}">
        ${icon('trophy', 20)}
        <span class="grow stack-1"><span class="strong">${l.name}</span>
          <span class="small muted">${l.season} m. sezonas · ${count(l.events, 'etapas', 'etapai', 'etapų')}</span></span>
        ${icon('chevron', 18)}</a>`)}</div>` : empty('Lygų dar nėra', 'Sukurk lygą ir kurdamas turnyrus įtrauk juos kaip etapus.')}
      ${state.user && !state.ban ? html`<details class="card stack-2" data-create-league>
        <summary class="strong row gap-8">${icon('plus', 18, 2.6)}Sukurti lygą</summary>
        <form class="stack" data-league-form>
          <label class="field"><span class="small muted strong">Pavadinimas</span><input name="name" required minlength="3" maxlength="60" autocomplete="off" placeholder="pvz. Kauno marių lyga"></label>
          <label class="field"><span class="small muted strong">Sezonas</span>
            <select name="season">${[year - 1, year, year + 1].map((y) => html`<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`)}</select></label>
          <label class="field"><span class="small muted strong">Aprašymas (nebūtina)</span><textarea name="description" rows="2" maxlength="500"></textarea></label>
          <button class="btn btn-primary" type="submit">Sukurti lygą</button>
          <p class="small muted">Etapus įtrauksi kurdamas arba redaguodamas savo turnyrą (laukas „Sezono lyga“).</p>
        </form>
      </details>` : ''}
    </div>`,
    mount(root) {
      const form = root.querySelector('[data-league-form]');
      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = form.querySelector('[type=submit]');
        btn.disabled = true;
        try {
          const id = await backend.createLeague({ name: form.name.value.trim(), season: Number(form.season.value), description: form.description.value.trim() });
          ctx.toast('Lyga sukurta');
          ctx.navigate(`#/lyga/${id}`);
        } catch (err) {
          btn.disabled = false;
          ctx.toast(err.message || 'Nepavyko sukurti lygos');
        }
      });
    }
  };
}

export async function leagueView(ctx, [id]) {
  const { backend, state } = ctx;
  const l = await backend.league(id);
  if (!l) return { nav: 'lenteles', html: notFound('#/lygos', 'Lyga nerasta') };
  const me = state.user?.id;
  const owner = !!me && l.owner_id === me;
  const rows = l.standings || [];
  return {
    nav: 'lenteles',
    title: l.name,
    html: html`<div class="screen">
      <header class="top-bar">${backButton('#/lygos')}<span class="muted strong">Lyga</span><span></span></header>
      <header class="stack-2">
        <h1 class="display-md" tabindex="-1">${l.name}</h1>
        <p class="small muted">${l.season} m. sezonas · ${count(l.tournaments.length, 'etapas', 'etapai', 'etapų')}</p>
        ${l.description ? html`<p class="prewrap">${l.description}</p>` : ''}
      </header>
      <section class="stack-2">
        <h2 class="h2">Lentelė</h2>
        ${rows.length ? html`<ol class="stack-6 plain">${rows.map((r) => html`<li>
          <a class="list-row board-row league-row ${r.user_id === me ? 'mine' : ''}" href="#/zvejys/${r.user_id}">
            <span class="rank">${r.rank}</span>
            ${avatar(r.nickname)}
            <span class="grow stack-1"><span class="strong ellipsis">${r.user_id === me ? 'Tu' : r.nickname}</span>
              <span class="small muted">${count(Number(r.events), 'etapas', 'etapai', 'etapų')}${Number(r.wins) ? ` · ${count(Number(r.wins), 'pergalė', 'pergalės', 'pergalių')}` : ''} · geriausia vieta ${r.best_place}</span></span>
            <span class="num-md points">${r.points} tšk.</span>
          </a></li>`)}</ol>` : html`<p class="muted">Taškų dar niekas neturi – jie atsiras, kai prasidės pirmas etapas.</p>`}
        <p class="small muted">${POINTS_TEXT} Įskaitomi tik vieši etapai; paslėpta lentelė – tik pasibaigus etapui.</p>
      </section>
      <section class="stack-2">
        <h2 class="h2">Etapai</h2>
        ${l.tournaments.length ? html`<div class="list">${l.tournaments.map((t) => html`<a class="list-row" href="#/t/${t.id}">
          <span class="grow stack-1"><span class="strong">${t.title}</span><span class="small muted">${dateTime(t.starts_at)} – ${dateTime(t.ends_at)}</span></span>
          ${phaseBadge(t)}</a>`)}</div>` : html`<p class="small muted">Etapų dar nėra.${owner ? ' Kurdamas turnyrą pasirink šią lygą.' : ''}</p>`}
        ${owner ? html`<a class="btn" href="#/naujas">${icon('plus', 18, 2.6)}Naujas etapas</a>` : ''}
      </section>
      ${owner ? html`<details class="card stack-2">
        <summary class="strong">Lygos nustatymai</summary>
        <form class="stack" data-edit-league>
          <label class="field"><span class="small muted strong">Pavadinimas</span><input name="name" required minlength="3" maxlength="60" value="${l.name}"></label>
          <label class="field"><span class="small muted strong">Aprašymas</span><textarea name="description" rows="2" maxlength="500">${l.description || ''}</textarea></label>
          <button class="btn btn-primary" type="submit">Išsaugoti</button>
        </form>
        <button class="btn btn-danger" type="button" data-delete-league>Ištrinti lygą</button>
        <p class="small muted">Ištrynus lygą turnyrai lieka, tik nebepriklauso lygai.</p>
      </details>` : ''}
    </div>`,
    mount(root) {
      const edit = root.querySelector('[data-edit-league]');
      edit?.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await backend.updateLeague(id, { name: edit.name.value.trim(), description: edit.description.value.trim() || null });
          ctx.toast('Išsaugota');
          ctx.rerender();
        } catch (err) {
          ctx.toast(err.message || 'Nepavyko');
        }
      });
      root.querySelector('[data-delete-league]')?.addEventListener('click', async () => {
        if (!confirm(`Ištrinti lygą „${l.name}“?`)) return;
        try {
          await backend.deleteLeague(id);
          ctx.toast('Lyga ištrinta');
          ctx.navigate('#/lygos');
        } catch {
          ctx.toast('Nepavyko ištrinti');
        }
      });
    }
  };
}
