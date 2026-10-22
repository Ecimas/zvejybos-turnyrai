import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { backButton } from '../ui.js';

export async function loginView(ctx) {
  const { backend, state } = ctx;
  if (state.user) {
    ctx.navigate('#/');
    return { nav: 'turnyrai', html: html`` };
  }
  return {
    nav: null,
    title: 'Prisijungti',
    html: html`<div class="screen">
      <header class="top-bar">${backButton('#/')}<span></span><span></span></header>
      <div class="stack-lg login">
        <div class="stack-2">
          <h1 class="display-lg" tabindex="-1">Prisijungti</h1>
          <p class="muted">Be slaptažodžio: atsiųsime nuorodą į el. paštą. Paspausk ją šiame telefone.</p>
        </div>
        <form class="stack" data-form>
          <label class="field"><span class="small muted strong">El. paštas</span>
            <input type="email" name="email" required autocomplete="email" inputmode="email" placeholder="vardas@pastas.lt"></label>
          <button class="btn btn-primary btn-lg" type="submit">${icon('mail', 22)}Siųsti nuorodą</button>
        </form>
        <div class="card stack" data-sent hidden>
          <p class="strong">Patikrink el. paštą</p>
          <p class="muted small">Nuoroda galioja valandą. Jei laiško nėra, pažiūrėk į „Šlamštą“.</p>
        </div>
        <p class="small muted">Prisijungdamas sutinki, kad laimikių nuotraukos ir vieta būtų naudojamos turnyrų patikrai. Tiksli vieta niekam nerodoma ir ištrinama praėjus 90 dienų po turnyro.</p>
      </div>
    </div>`,
    mount(root) {
      const form = root.querySelector('[data-form]');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = form.email.value.trim();
        if (!form.email.checkValidity()) { ctx.toast('Patikrink el. pašto adresą'); return; }
        const btn = form.querySelector('button');
        btn.disabled = true;
        try {
          await backend.signIn(email);
          form.hidden = true;
          root.querySelector('[data-sent]').hidden = false;
        } catch (err) {
          btn.disabled = false;
          ctx.toast(/rate/i.test(err.message || '') ? 'Per daug bandymų – palauk minutę' : 'Nepavyko išsiųsti nuorodos');
        }
      });
    }
  };
}
