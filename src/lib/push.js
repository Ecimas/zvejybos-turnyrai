// Push pranešimai šiame telefone: palaikymas, įjungimas, išjungimas.

export function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// 'ok' | 'ios-install' | 'unsupported' | 'denied'
export function pushSupport() {
  const has = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!has) return isIos() && !isStandalone() ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return 'ok';
}

async function registration(timeoutMs = 5000) {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, rej) => setTimeout(() => rej(new Error('Programėlė dar įsikelia – pabandyk po minutės')), timeoutMs))
  ]);
}

export async function currentSubscription() {
  if (pushSupport() !== 'ok') return null;
  try {
    const reg = await registration(3000);
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

function sameKey(a, b) {
  if (!a || !b || a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a);
  return x.every((v, i) => v === b[i]);
}

export async function enablePush(backend) {
  const key = await backend.pushPublicKey();
  if (!key) throw new Error('Pranešimai serveryje dar neparuošti');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Pranešimai užblokuoti telefono nustatymuose' : 'Pranešimai neįjungti');
  const reg = await registration();
  const appKey = b64urlToBytes(key);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options?.applicationServerKey, appKey)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
  const j = sub.toJSON();
  await backend.savePushSubscription({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth });
  return sub;
}

export async function disablePush(backend) {
  const sub = await currentSubscription();
  if (!sub) return;
  await backend.removePushSubscription(sub.endpoint).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

export const NOTIFY_KINDS = [
  ['review', 'Laimikis patvirtintas arba atmestas'],
  ['overtaken', 'Tave aplenkė lentelėje'],
  ['start', 'Rytoj startas turnyro, kuriame dalyvauji'],
  ['announcements', 'Organizatoriaus pranešimai']
];
