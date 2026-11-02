// Pagalba (#/pagalba): dažni klausimai, nuorodos ir pokalbis su komanda (0036, kind = 'support').
import { html } from '../lib/html.js';
import { icon } from '../icons.js';

const FAQ = [
  ['photo', 'Kaip teisingai nufotografuoti žuvį?', [
    'Padėk žuvį ant liniuotės ar matuoklės taip, kad matytųsi visa žuvis – nuo snukio iki uodegos galo – ir skaičiai prie jos.',
    'Fotografuok programėle („+“ apačioje): laikas ir vieta užfiksuojami automatiškai, todėl nuotraukos iš galerijos netinka.']],
  ['review', 'Kodėl laimikis rodomas „Tikrinama“?', [
    'Kiekvieną laimikį peržiūri moderatorius – lentelėje jis atsiras, kai bus patvirtintas. Dažniausiai tai užtrunka iki kelių valandų.']],
  ['rejected', 'Laimikis atmestas – ką daryti?', [
    'Dienoraštyje prie laimikio matysi atmetimo priežastį. Jei nesutinki, spausk „Nesutinku su sprendimu“ ir paaiškink – laimikį peržiūrės kitas teisėjas.']],
  ['board', 'Kaip skaičiuojama lentelė?', [
    'Priklauso nuo turnyro formato: didžiausia žuvis, kelių ilgiausių žuvų suma arba taškai. Tikslias taisykles rasi turnyro skiltyje „Taisyklės“.',
    'Kai rezultatas lygus, aukščiau tas, kuris jį pasiekė anksčiau.']],
  ['prize', 'Laimėjau prizą – kaip jį atsiimti?', [
    'Turnyrui pasibaigus gausi žinutę su vieta ir prizu. Organizatorius su tavimi susisieks per 3 darbo dienas programėlės žinutėse – ten ir susitarsite dėl prizo.',
    'Pinigų programėlė neperveda – prizus išmoka organizatorius arba rėmėjai.']],
  ['spots', 'Ar kiti mato, kur aš žvejoju?', [
    'Ne. Tikslią vietą, masalą ir pastabas matai tik tu. Klubo žemėlapyje (jei pats įjungsi) rodoma tik apytikslė vieta (~1 km).']],
  ['create', 'Kaip sukurti savo turnyrą?', [
    'Turnyrų ekrane spausk „Naujas“. Turnyrą su kvietimu gali sukurti kiekvienas; viešus (matomus visiems) – patvirtinti organizatoriai.']],
  ['offline', 'Prie vandens nėra ryšio – ar laimikis dings?', [
    'Ne. Laimikis išsaugomas telefone ir išsiunčiamas automatiškai, kai atsiras ryšys. Viršuje matysi, kiek laimikių laukia išsiuntimo.']],
  ['delete', 'Kaip ištrinti paskyrą?', [
    'Profilis → Nustatymai → „Ištrinti paskyrą“. Laimikiai, nuotraukos ir vietos ištrinamos.']]
];

export async function helpView(ctx) {
  const { state, backend } = ctx;
  return {
    nav: 'profilis',
    title: 'Pagalba',
    html: html`<div class="screen stack-lg">
      <header class="page-head"><h1 class="display-lg" tabindex="-1">Pagalba</h1></header>
      <nav class="help-links" aria-label="Naudinga">
        <a href="#/pradzia">${icon('play', 22)}Kaip tai veikia</a>
        <a href="#/taisykles">${icon('book', 22)}Taisyklės</a>
        <a href="#/privatumas">${icon('lock', 22)}Privatumas</a>
        <a href="remejams.html" data-sponsors-page>${icon('star', 22)}Rėmėjams</a>
      </nav>
      <section class="stack">
        <h2 class="h2">Dažni klausimai</h2>
        <div class="faq" data-faq>${FAQ.map(([key, q, ans]) => html`<details data-q="${key}"><summary>${q}<span class="set-chev" aria-hidden="true">${icon('chevron', 16)}</span></summary>
          <div class="ans">${ans.map((p) => html`<p>${p}</p>`)}</div></details>`)}</div>
      </section>
      <section class="team-card" data-team>
        <img src="icons/icon.svg" alt="">
        <span class="grow stack-1"><b>Neradai atsakymo?</b><span class="small muted">Parašyk komandai – atsakome darbo dienomis čia, žinutėse.</span></span>
      </section>
      <button type="button" class="btn btn-primary btn-lg" data-write-team>${icon('chat', 20)}Parašyti komandai</button>
    </div>`,
    mount(root) {
      root.querySelector('[data-write-team]').addEventListener('click', async (e) => {
        if (!state.user) { ctx.navigate('#/prisijungti'); return; }
        const b = e.currentTarget;
        b.disabled = true;
        try {
          const id = await backend.startSupport();
          ctx.navigate(`#/zinutes/${id}`);
        } catch (err) {
          b.disabled = false;
          ctx.toast(err.message || 'Nepavyko atidaryti pokalbio');
        }
      });
    }
  };
}
