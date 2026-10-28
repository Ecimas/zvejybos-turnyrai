// Buvimas programėlėje ir telefono modelis (savininko statistikai, 0024).
// Siunčiama tik prisijungus, ne dažniau nei kartą per minutę ir tik kol programėlė atidaryta.

const SAMSUNG = {
  S931: 'Galaxy S25', S936: 'Galaxy S25+', S938: 'Galaxy S25 Ultra', S921: 'Galaxy S24', S926: 'Galaxy S24+', S928: 'Galaxy S24 Ultra',
  S721: 'Galaxy S24 FE', S911: 'Galaxy S23', S916: 'Galaxy S23+', S918: 'Galaxy S23 Ultra', S711: 'Galaxy S23 FE',
  S901: 'Galaxy S22', S906: 'Galaxy S22+', S908: 'Galaxy S22 Ultra', G991: 'Galaxy S21', G996: 'Galaxy S21+', G998: 'Galaxy S21 Ultra',
  G990: 'Galaxy S21 FE', A556: 'Galaxy A55', A546: 'Galaxy A54', A536: 'Galaxy A53', A528: 'Galaxy A52s', A525: 'Galaxy A52', A526: 'Galaxy A52 5G',
  A356: 'Galaxy A35', A346: 'Galaxy A34', A256: 'Galaxy A25', A155: 'Galaxy A15', A156: 'Galaxy A15 5G', A145: 'Galaxy A14', A146: 'Galaxy A14 5G',
  A135: 'Galaxy A13', A137: 'Galaxy A13', A515: 'Galaxy A51', A715: 'Galaxy A71', F956: 'Galaxy Z Fold6', F741: 'Galaxy Z Flip6',
  F946: 'Galaxy Z Fold5', F731: 'Galaxy Z Flip5'
};

// „SM-S918B“ -> „Galaxy S23 Ultra (SM-S918B)“; kiti – kaip yra.
export function modelName(model) {
  const m = /^SM-([A-Z]\d{3})/.exec(model || '');
  return m && SAMSUNG[m[1]] ? `${SAMSUNG[m[1]]} (${model})` : model || 'Nežinomas';
}

function browserOf(ua) {
  if (/SamsungBrowser/.test(ua)) return 'Samsung Internet';
  if (/EdgA?\/|EdgiOS/.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/Firefox|FxiOS/.test(ua)) return 'Firefox';
  if (/CriOS|Chrome\//.test(ua)) return 'Chrome';
  if (/Safari/.test(ua)) return 'Safari';
  return 'Kita';
}

const PLATFORMS = { android: 'Android', ios: 'iOS', windows: 'Windows', macos: 'macOS', linux: 'Linux', 'chrome os': 'Linux', chromeos: 'Linux' };

export async function deviceInfo(nav = globalThis.navigator, win = globalThis.window, doc = globalThis.document) {
  const ua = nav?.userAgent || '';
  let model = '';
  let platform = 'Kita';
  let os = '';
  const uad = nav?.userAgentData;
  if (uad?.getHighEntropyValues) {
    try {
      const h = await uad.getHighEntropyValues(['model', 'platformVersion']);
      model = (h.model || '').trim();
      os = h.platformVersion || '';
      platform = PLATFORMS[String(uad.platform || '').toLowerCase()] || platform;
    } catch { /* nepalaikoma */ }
  }
  if (/iPhone/.test(ua)) {
    platform = 'iOS';
    model ||= 'iPhone';
    os ||= (/OS (\d+(?:_\d+)*)/.exec(ua)?.[1] || '').replace(/_/g, '.');
  } else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && nav?.maxTouchPoints > 1)) {
    platform = 'iOS';
    model ||= 'iPad';
  } else if (/Android/.test(ua)) {
    platform = 'Android';
    os ||= /Android (\d+(?:\.\d+)?)/.exec(ua)?.[1] || '';
    const m = /Android [^;)]*; ([^;)]+?)(?: Build[^;)]*)?\)/.exec(ua);
    if (!model && m && m[1].trim() !== 'K') model = m[1].trim();
  } else if (platform === 'Kita') {
    if (/Windows/.test(ua)) platform = 'Windows';
    else if (/Macintosh/.test(ua)) platform = 'macOS';
    else if (/Linux|CrOS/.test(ua)) platform = 'Linux';
  }
  if (!model) model = platform === 'Android' ? 'Android (modelis nežinomas)' : ['Windows', 'macOS', 'Linux'].includes(platform) ? 'Kompiuteris' : 'Nežinomas';
  let installed = false;
  try {
    installed = !!(win?.matchMedia?.('(display-mode: standalone)').matches || nav?.standalone === true
      || String(doc?.referrer || '').startsWith('android-app://'));
  } catch { /* nėra */ }
  return { model: model.slice(0, 60), platform, os: String(os).split('.').slice(0, 2).join('.'), browser: browserOf(ua), installed };
}

// Paleidžiama vieną kartą: praneša „esu čia“ prisijungus, grįžus į programėlę ir kas 4 min., kol ji atidaryta.
export function startPresence(ctx, { every = 4 * 60e3, min = 60e3 } = {}) {
  let last = 0;
  let info = null;
  const touch = async () => {
    if (!ctx.state.user || !ctx.backend.touchPresence) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (Date.now() - last < min) return;
    last = Date.now();
    try {
      info ||= await deviceInfo();
      await ctx.backend.touchPresence(info);
    } catch { /* statistika neprivaloma */ }
  };
  touch();
  const timer = setInterval(touch, every);
  const onVisible = () => touch();
  document.addEventListener('visibilitychange', onVisible);
  return { touch, reset: () => { last = 0; }, stop: () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); } };
}
