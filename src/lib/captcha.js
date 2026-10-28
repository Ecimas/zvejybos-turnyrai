// Apsauga nuo botų registruojantis el. paštu: Cloudflare Turnstile.
// Įsijungia tik tada, kai config.js yra TURNSTILE_SITE_KEY (viešas raktas). Slaptas raktas – tik Supabase nustatymuose.
import * as config from '../config.js';

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export const captchaKey = () => config.TURNSTILE_SITE_KEY || window.__turnstileKey || '';

let loading = null;
function load() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('captcha_load')));
    s.onerror = () => { loading = null; reject(new Error('captcha_load')); };
    document.head.append(s);
  });
  return loading;
}

// Grąžina { token(), reset() } arba null, kai apsauga neįjungta.
export async function mountCaptcha(el) {
  const key = captchaKey();
  if (!key || !el) return null;
  const ts = await load();
  let current = null;
  const waiting = [];
  const id = ts.render(el, {
    sitekey: key,
    language: 'lt',
    theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
    callback: (t) => { current = t; waiting.splice(0).forEach((w) => w.resolve(t)); },
    'expired-callback': () => { current = null; },
    'error-callback': () => { current = null; }
  });
  return {
    token(timeoutMs = 20000) {
      if (current) return Promise.resolve(current);
      return new Promise((resolve, reject) => {
        const w = { resolve };
        waiting.push(w);
        setTimeout(() => { const i = waiting.indexOf(w); if (i >= 0) { waiting.splice(i, 1); reject(new Error('captcha_timeout')); } }, timeoutMs);
      });
    },
    // Vienas žetonas – vienam laiškui; po siuntimo gaunamas naujas.
    reset() { current = null; ts.reset(id); }
  };
}
