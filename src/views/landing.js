// Pradinis puslapis neprisijungusiam lankytojui (#/sveiki; į #/ nukreipiama, kol svečias jo nepraleido).
// Kas tai, kaip veikia, vykstantys turnyrai (tikri duomenys), funkcijos, organizatoriams ir rėmėjams.
import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { phase } from '../lib/format.js';
import { promoCard, rowCard } from './tournaments.js';

const KEY = 'zt-landing-seen';
export const landingSeen = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return true; } };
export const markLandingSeen = () => { try { localStorage.setItem(KEY, '1'); } catch { /* */ } };

const STEPS = [
  ['camera', 'Nufotografuok prie liniuotės', 'Laimikį fotografuoji programėlės kamera – laikas ir vieta užfiksuojami automatiškai, moderatorius patvirtina.'],
  ['bars', 'Stebėk gyvą lentelę', 'Kiekviena patvirtinta žuvis iškart lentelėje. Matai, kiek trūksta iki aukštesnės vietos.'],
  ['trophy', 'Laimėk prizus', 'Prizininkai gauna žinutę, o organizatorius susisiekia per programėlę ir įteikia prizą.']
];
const FEATURES = [
  ['users', 'Klubai ir pokalbiai', 'Bendri klubo pokalbiai, išvykos, klubo rekordai ir asmeninės žinutės.'],
  ['book', 'Dienoraštis', 'Visi laimikiai, rekordai, rūšių kolekcija ir orai – vienoje vietoje.'],
  ['shield', 'Sąžininga', 'Tik programėlės kamera, GPS ir moderatorius – sukčiauti sunku.'],
  ['cloudOff', 'Veikia be ryšio', 'Prie vandens nėra ryšio? Laimikis išsiųs vėliau, laikas išliks tikras.']
];

export async function landingView(ctx) {
  const { backend } = ctx;
  const all = await backend.tournaments().catch(() => []);
  const pub = all.filter((t) => t.visibility !== 'private');
  const live = pub.filter((t) => phase(t) === 'live').sort((a, b) => (b.prize_fund_cents || 0) - (a.prize_fund_cents || 0) || b.participants - a.participants).slice(0, 2);
  const soon = pub.filter((t) => phase(t) === 'soon').sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at)).slice(0, 1);

  return {
    nav: null,
    title: 'Žvejybos turnyrai – turnyrai telefone su prizais',
    html: html`<div class="lp">
      <header class="lp-top">
        <a class="lp-brand" href="#/sveiki" aria-label="Žvejybos turnyrai"><img src="icons/icon.svg" alt="" width="34" height="34"><span>Žvejybos <b>turnyrai</b></span></a>
        <a class="btn btn-ghost lp-login" href="#/prisijungti" data-lp-login>Prisijungti</a>
      </header>

      <section class="lp-hero">
        <span class="lp-kicker">Žvejybos turnyrai telefone</span>
        <h1 class="lp-h1" tabindex="-1">Pagauk didžiausią.<br><b>Laimėk prizą.</b></h1>
        <p class="lp-lead">Dalyvauk turnyruose bet kur Lietuvoje: nufotografuok laimikį prie liniuotės, stebėk gyvą lentelę ir kovok dėl prizų.</p>
        <div class="lp-btns">
          <a class="btn btn-primary btn-lg" href="#/prisijungti" data-lp-start>${icon('plus', 20, 2.6)}Pradėti nemokamai</a>
          <a class="btn btn-ghost btn-lg" href="#/" data-lp-browse>${icon('trophy', 20)}Žiūrėti turnyrus</a>
        </div>
        <p class="lp-note">Nemokama · nieko diegti nereikia · veikia ir be ryšio</p>
        <div class="lp-phone"><video src="store/remejams/video.mp4" poster="store/remejams/video-poster.jpg" autoplay muted loop playsinline preload="metadata" aria-label="Programėlės pristatymo vaizdo įrašas"></video></div>
      </section>

      ${live.length || soon.length ? html`<section class="lp-sec" data-lp-tournaments>
        <div class="lp-sec-h"><h2 class="lp-h2">${live.length ? 'Vyksta dabar' : 'Netrukus prasideda'}</h2><a class="link small" href="#/" data-lp-browse>Visi turnyrai</a></div>
        <div class="stack-2">${live.map((t) => rowCard(t, null))}${soon.map((t) => promoCard(t, null))}</div>
      </section>` : ''}

      <section class="lp-sec">
        <h2 class="lp-h2">Kaip tai <b>veikia</b></h2>
        <ol class="lp-steps plain">${STEPS.map(([ic, h, p], i) => html`<li class="lp-step">
          <span class="lp-step-n">${i + 1}</span>
          <span class="stack-1"><b class="lp-step-h">${icon(ic, 18)} ${h}</b><span class="muted">${p}</span></span>
        </li>`)}</ol>
      </section>

      <section class="lp-sec">
        <h2 class="lp-h2">Ne tik <b>turnyrai</b></h2>
        <div class="lp-feats">${FEATURES.map(([ic, h, p]) => html`<div class="lp-feat"><span class="lp-ic">${icon(ic, 22)}</span><b>${h}</b><span class="small muted">${p}</span></div>`)}</div>
      </section>

      <section class="lp-sec lp-duo">
        <a class="lp-card" href="#/organizatorius" data-lp-org>${icon('trophy', 24)}<span class="stack-1"><b>Organizatoriams</b><span class="small muted">Sukurk savo turnyrą: taisyklės, prizai, lentelė ir rėmėjai – automatiškai.</span></span>${icon('chevron', 18)}</a>
        <a class="lp-card" href="remejams.html" data-sponsors-page>${icon('star', 24)}<span class="stack-1"><b>Rėmėjams</b><span class="small muted">Jūsų logotipas turnyre, lentelėje ir prizuose – su ataskaita.</span></span>${icon('chevron', 18)}</a>
      </section>

      <section class="lp-final">
        <h2 class="lp-h2">Pirmas laimikis – <b>šiandien</b></h2>
        <p class="muted">Prisijunk per kelias sekundes – užtenka el. pašto.</p>
        <a class="btn btn-primary btn-lg" href="#/prisijungti" data-lp-start>${icon('plus', 20, 2.6)}Pradėti nemokamai</a>
        <a class="btn-text" href="#/" data-lp-browse>Pirma pažiūrėsiu turnyrus</a>
      </section>

      <footer class="lp-foot"><a href="#/taisykles">Taisyklės</a><a href="#/privatumas">Privatumas</a><a href="#/pagalba">Pagalba</a><a href="remejams.html">Rėmėjams</a></footer>
    </div>`,
    mount(root) {
      // Pasirinkus „žiūrėti“ ar „prisijungti“ – pradinis puslapis daugiau automatiškai nerodomas.
      root.querySelectorAll('[data-lp-browse], [data-lp-start], [data-lp-login]').forEach((a) => a.addEventListener('click', markLandingSeen));
    }
  };
}
