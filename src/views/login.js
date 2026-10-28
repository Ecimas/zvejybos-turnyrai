// Prisijungimas be slaptažodžio: nuoroda el. laiške (pagrindinis būdas su standartiniu Supabase laišku)
// arba kodas iš laiško, kai laiško šablone yra {{ .Token }} (reikia savo SMTP).
import { html } from '../lib/html.js';
import { icon } from '../icons.js';
import { backButton } from '../ui.js';
import { rememberInvite } from './invite.js';
import { mountCaptcha } from '../lib/captcha.js';

const RESEND_S = 60;

function errorText(err, fallback) {
  const m = String(err?.message || '');
  if (/captcha_load/.test(m)) return 'Nepavyko įkelti apsaugos nuo botų – patikrink ryšį';
  if (/captcha/i.test(m)) return 'Patvirtink, kad nesi robotas, ir bandyk dar kartą';
  if (/rate|too many|security purposes/i.test(m)) return 'Per daug bandymų – palauk minutę';
  if (/expired|invalid|token/i.test(m)) return 'Kodas neteisingas arba nebegalioja';
  return fallback;
}

export async function loginView(ctx) {
  const { backend, state } = ctx;
  if (state.user) {
    ctx.navigate('#/');
    return { nav: 'turnyrai', html: html`` };
  }
  return {
    nav: 'profilis',
    title: 'Prisijungti',
    html: html`<div class="screen">
      <header class="top-bar">${backButton('#/')}<span></span><span></span></header>
      <div class="stack-lg login">
        <div class="stack-2">
          <h1 class="display-lg" tabindex="-1">Prisijungti</h1>
          <p class="muted" data-intro>Be slaptažodžio: atsiųsime prisijungimo nuorodą į el. paštą.</p>
        </div>

        <div class="stack" data-google-wrap hidden>
          <button class="btn btn-google btn-lg" type="button" data-google>${icon('user', 22)}Prisijungti su Google</button>
          <p class="or-line small muted"><span>arba el. paštu</span></p>
        </div>

        <form class="stack" data-email-form novalidate>
          <label class="field"><span class="small muted strong">El. paštas</span>
            <input type="email" name="email" required autocomplete="email" inputmode="email" placeholder="vardas@pastas.lt"></label>
          <div class="captcha" data-captcha></div>
          <button class="btn btn-primary btn-lg" type="submit">${icon('mail', 22)}Siųsti nuorodą</button>
        </form>

        <form class="stack" data-code-form novalidate hidden>
          <div class="card stack-2">
            <p class="strong">Patikrink el. paštą</p>
            <p class="muted small">Išsiuntėme laišką į <strong data-email-shown></strong>. Atidaryk jį <strong>šiame telefone</strong> ir paspausk nuorodą „Sign in“ arba „Confirm“ – programėlė atsidarys jau prisijungus.</p>
            <p class="muted small">Siuntėjas: Supabase Auth. Jei laiško nėra, pažiūrėk „Reklamos“ ir „Šlamštas“ skiltyse.</p>
          </div>
          <button class="btn-text" type="button" data-have-code>Laiške yra kodas?</button>
          <label class="field" data-code-field hidden><span class="small muted strong">Kodas iš laiško</span>
            <input name="code" required inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,8}" maxlength="8"
                   placeholder="123456" class="code-input"></label>
          <button class="btn btn-primary btn-lg" type="submit" data-code-submit hidden>${icon('check', 22, 3)}Prisijungti</button>
          <div class="row-between">
            <button class="btn-text" type="button" data-change>Kitas el. paštas</button>
            <button class="btn-text" type="button" data-resend disabled>Siųsti dar kartą</button>
          </div>
        </form>

        <p class="small muted">Prisijungdamas sutinki su <a class="link" href="#/taisykles">turnyrų taisyklėmis</a> ir kad laimikių nuotraukos ir vieta būtų naudojamos turnyrų patikrai. Tiksli vieta niekam nerodoma ir ištrinama praėjus 90 dienų po turnyro. Plačiau – <a class="link" href="#/privatumas">privatumo politikoje</a>.</p>
      </div>
    </div>`,
    mount(root) {
      const googleWrap = root.querySelector('[data-google-wrap]');
      backend.authProviders?.().then((p) => {
        if (!p?.google || !root.isConnected) return;
        googleWrap.hidden = false;
        root.querySelector('[data-intro]').textContent = 'Greičiausia – su Google paskyra. Slaptažodžio nereikia.';
      });
      root.querySelector('[data-google]').addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        // Kvietimas (jei atėjai per jį) prisimenamas iki grįžimo iš Google.
        const pending = (() => { try { return JSON.parse(localStorage.getItem('zt-invite') || 'null'); } catch { return null; } })();
        if (pending?.code) rememberInvite(pending.code);
        try {
          await backend.signInWithGoogle();
        } catch {
          e.currentTarget.disabled = false;
          ctx.toast('Nepavyko prisijungti per Google');
        }
      });
      const emailForm = root.querySelector('[data-email-form]');
      const captcha = mountCaptcha(root.querySelector('[data-captcha]')).catch(() => ({ failed: true }));
      const codeForm = root.querySelector('[data-code-form]');
      const resend = root.querySelector('[data-resend]');
      let email = '';
      let timer = null;

      const countdown = () => {
        let left = RESEND_S;
        resend.disabled = true;
        resend.textContent = `Siųsti dar kartą (${left})`;
        clearInterval(timer);
        timer = setInterval(() => {
          left -= 1;
          if (left <= 0) {
            clearInterval(timer);
            resend.disabled = false;
            resend.textContent = 'Siųsti dar kartą';
          } else {
            resend.textContent = `Siųsti dar kartą (${left})`;
          }
        }, 1000);
      };

      const send = async () => {
        const cap = await captcha;
        if (cap?.failed) throw new Error('captcha_load');
        const token = cap ? await cap.token().catch(() => null) : null;
        if (cap && !token) throw new Error('captcha_timeout');
        try {
          await backend.signIn(email, token);
        } finally {
          cap?.reset();
        }
        root.querySelector('[data-email-shown]').textContent = email;
        emailForm.hidden = true;
        codeForm.hidden = false;
        root.querySelector('[data-intro]').hidden = true;
        codeForm.code.value = '';
        countdown();
      };

      emailForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        email = emailForm.email.value.trim().toLowerCase();
        if (!emailForm.email.checkValidity() || !email) { ctx.toast('Patikrink el. pašto adresą'); return; }
        const btn = emailForm.querySelector('button');
        btn.disabled = true;
        try {
          await send();
        } catch (err) {
          ctx.toast(errorText(err, 'Nepavyko išsiųsti laiško'));
        } finally {
          btn.disabled = false;
        }
      });

      root.querySelector('[data-have-code]').addEventListener('click', (e) => {
        e.currentTarget.hidden = true;
        root.querySelector('[data-code-field]').hidden = false;
        root.querySelector('[data-code-submit]').hidden = false;
        codeForm.code.focus();
      });

      codeForm.code.addEventListener('input', () => {
        codeForm.code.value = codeForm.code.value.replace(/\D/g, '').slice(0, 8);
      });

      codeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = codeForm.code.value.trim();
        if (!/^\d{6,8}$/.test(code)) { ctx.toast('Įvesk kodą iš laiško'); return; }
        const btn = codeForm.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
          await backend.verifyCode(email, code);
          ctx.toast('Prisijungei');
          ctx.navigate(ctx.afterLogin());
        } catch (err) {
          btn.disabled = false;
          ctx.toast(errorText(err, 'Nepavyko prisijungti'));
        }
      });

      root.querySelector('[data-change]').addEventListener('click', () => {
        clearInterval(timer);
        codeForm.hidden = true;
        emailForm.hidden = false;
        root.querySelector('[data-intro]').hidden = false;
        emailForm.email.focus();
      });

      resend.addEventListener('click', async () => {
        resend.disabled = true;
        try {
          await send();
          ctx.toast('Naujas laiškas išsiųstas');
        } catch (err) {
          resend.disabled = false;
          ctx.toast(errorText(err, 'Nepavyko išsiųsti laiško'));
        }
      });

      return () => clearInterval(timer);
    }
  };
}
