// Statiniai puslapiai: privatumo politika ir turnyrų taisyklės.
// Pastaba savininkui: tai aiškus pradinis tekstas; prieš mokamus turnyrus jį turėtų peržiūrėti teisininkas.
import { html } from '../lib/html.js';
import * as config from '../config.js';

// Namespace importas: senesnė config.js be CONTACT_EMAIL nesugadina programėlės.
const CONTACT_EMAIL = config.CONTACT_EMAIL || '';

const contact = () => (CONTACT_EMAIL
  ? html`<a class="link" href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>`
  : html`kontaktinis el. paštas bus paskelbtas čia netrukus`);

function page(title, body) {
  return {
    nav: 'profilis',
    title,
    html: html`<div class="screen prose">
      <header class="top-bar"><button class="icon-btn" data-back aria-label="Atgal"><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></button><span></span><span></span></header>
      <h1 class="display-lg" tabindex="-1">${title}</h1>
      ${body}
    </div>`,
    mount(root) {
      root.querySelector('[data-back]').addEventListener('click', () => {
        if (history.length > 1) history.back();
        else location.hash = '#/';
      });
    }
  };
}

export async function privacyView() {
  return page('Privatumo politika', html`
    <p class="muted small">Atnaujinta 2026 m. spalio 28 d.</p>
    <h2 class="h2">Kas tvarko duomenis</h2>
    <p>Programėlę „Žvejybos turnyrai“ valdo jos kūrėjas (toliau – „mes“). Klausimai ir prašymai: ${contact()}.</p>
    <h2 class="h2">Kokius duomenis renkame ir kodėl</h2>
    <ul>
      <li><strong>El. pašto adresą</strong> – prisijungimui (per Google paskyrą arba nuorodą laiške). Kitiems dalyviams jis nerodomas. Jungiantis per Google gauname tik el. paštą ir vardą; vardo niekur nerodome – kitiems matomas tik tavo pasirinktas slapyvardis.</li>
      <li><strong>Slapyvardį ir regioną</strong> – rodomi lentelėse ir profilyje.</li>
      <li><strong>Laimikio nuotrauką, ilgį, rūšį, laiką</strong> – turnyrų rezultatams ir patikrai. Patvirtintos nuotraukos matomos kitiems dalyviams.</li>
      <li><strong>Tikslią vietą (GPS)</strong> – tik sąžiningumo patikrai. Ją mato tik moderatoriai, ji niekada nerodoma kitiems ir automatiškai ištrinama praėjus 90 dienų po turnyro pabaigos. Jei pats įjungi „Saugoti vietas mano žemėlapiui“, išsaugoma jų kopija, kurią matai tik tu (net ne moderatoriai); išjungus kopijos ištrinamos.</li>
      <li><strong>Orą</strong> (temperatūra, vėjas, slėgis) – užklausiame Open-Meteo pagal suapvalintą (~100 m) vietą ir išsaugome prie laimikio. Išjungti galima profilyje.</li>
      <li><strong>Masalą ir pastabas</strong> – jei įrašai; matomi tik tau.</li>
      <li><strong>Sekimus ir narystę klubuose</strong> – kai seki kitus žvejus ar prisijungi prie klubo; klubų nariai ir sekėjų skaičius matomi kitiems.</li>
      <li><strong>Pranešimų prenumeratą</strong> – jei įjungi pranešimus: telefono naršyklės suteiktą adresą, kuriuo siunčiame žinutes apie laimikius ir turnyrus. Išjungus pranešimus adresas nebenaudojamas. Pranešimų turinys šifruojamas.</li>
    </ul>
    <p>Teisinis pagrindas – sutartis (turnyrų paslauga, kurią užsisakai prisijungdamas) ir teisėtas interesas užtikrinti sąžiningas varžybas.</p>
    <h2 class="h2">Kur saugoma</h2>
    <p>Duomenys saugomi Supabase (ES duomenų centras) ir programėlė pasiekiama per Vercel. Duomenų neparduodame ir reklamai nenaudojame. Slapukų sekimui nenaudojame – telefone saugoma tik prisijungimo sesija ir neišsiųsti laimikiai.</p>
    <h2 class="h2">Tavo teisės</h2>
    <ul>
      <li>Atsisiųsti visus savo duomenis – Profilis → „Atsisiųsti mano duomenis“.</li>
      <li>Ištrinti paskyrą ir visus duomenis – Profilis → „Ištrinti paskyrą“.</li>
      <li>Taisyti slapyvardį ir regioną – Profilis → redaguoti.</li>
      <li>Pateikti skundą Valstybinei duomenų apsaugos inspekcijai (vdai.lrv.lt).</li>
    </ul>
    <h2 class="h2">Saugumas</h2>
    <p>Prieiga prie duomenų ribojama duomenų bazės taisyklėmis: kiekvienas mato tik tai, ką jam leidžiama matyti. Ryšys šifruojamas (HTTPS). Prisijungiama be slaptažodžio – vienkartine nuoroda el. paštu.</p>
  `);
}

export async function rulesView() {
  return page('Turnyrų taisyklės', html`
    <h2 class="h2">Laimikio registravimas</h2>
    <ul>
      <li>Nuotrauka daroma tik programėlės kamera – iš galerijos įkelti negalima.</li>
      <li>Žuvis padedama ant matavimo liniuotės ar matuoklės, matosi visa žuvis ir skalė.</li>
      <li>Ilgis matuojamas nuo snukio galo iki uodegos peleko galo.</li>
      <li>Laimikis įskaitomas, jei nufotografuotas turnyro metu ir išsiųstas ne vėliau kaip per 24 val. po pabaigos.</li>
      <li>Ta pati nuotrauka antrą kartą nepriimama.</li>
      <li>Per parą galima įkelti iki 50 laimikių.</li>
    </ul>
    <h2 class="h2">Tikrinimas</h2>
    <ul>
      <li>Kiekvieną laimikį peržiūri moderatorius. Į lentelę patenka tik patvirtinti.</li>
      <li>Atmetus laimikį nurodoma priežastis. Nesutinki – spausk „Nesutinku“ dienoraštyje ir paaiškink; ginčą peržiūrės moderatorius.</li>
      <li>Moderatorius mato tikslią vietą ir laiką, todėl sukčiavimas (sena nuotrauka, kito žmogaus žuvis) pastebimas.</li>
      <li>Už pažeidimus dalyvis gali būti pašalintas iš turnyro ar platformos.</li>
    </ul>
    <h2 class="h2">Rezultatai</h2>
    <ul>
      <li>„Didžiausia žuvis“ – skaičiuojama ilgiausia viena žuvis.</li>
      <li>„Kelių ilgių suma“ – sumuojama nurodytas skaičius ilgiausių žuvų.</li>
      <li>„Taškai už rūšį“ – taškai = ilgis cm × rūšies koeficientas (jį nustato organizatorius); sumuojamos geriausios žuvys.</li>
      <li>„Dvikovos“ – atkrintamosios poros. Poros sudaromos atsitiktinai iš užsiregistravusių iki starto, turnyro laikas padalinamas į ratus. Rate laimi daugiau pagavęs; lygiųjų atveju – pirmasis poroje.</li>
      <li>Divizionai – atskiros lentelės tame pačiame turnyre (pvz. jaunimas, moterys). Divizioną renkiesi pats, kol vyksta registracija.</li>
      <li>Sezono lyga – vietos etapuose duoda taškų: 25, 18, 15, 12, 10, 8, 6, 4, 2, 1.</li>
      <li>Vienodo rezultato atveju aukščiau tas, kuris jį pasiekė anksčiau.</li>
      <li>Organizatorius gali paslėpti lentelę iki pabaigos – tada matai tik savo rezultatą.</li>
    </ul>
    <h2 class="h2">Gamta ir įstatymai</h2>
    <p>Laikykis Mėgėjų žvejybos taisyklių: turėk leidimą (žvejo bilietą), gerbk draudžiamus laikotarpius ir mažiausius leidžiamus dydžius. Rekomenduojame žuvis paleisti – nufotografuok ir grąžink į vandenį.</p>
    <h2 class="h2">Prizai</h2>
    <p>Prizus skiria ir įteikia turnyro organizatorius arba rėmėjas. Platforma už juos neatsako.</p>
  `);
}
