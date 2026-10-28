// Web Push be išorinių bibliotekų: VAPID parašas (RFC 8292) ir turinio šifravimas aes128gcm (RFC 8291).
// Tik standartinis WebCrypto – veikia ir Deno (Supabase Edge Functions), ir Node (testai).

const enc = new TextEncoder();

export function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

// Naujų VAPID raktų pora: viešas (65 B, naršyklei) ir privatus (32 B „d“), abu base64url.
export async function generateVapidKeys() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const pub = concat(new Uint8Array([4]), b64urlToBytes(jwk.x), b64urlToBytes(jwk.y));
  return { publicKey: bytesToB64url(pub), privateKey: jwk.d };
}

async function importVapidPrivate(publicKey, privateKey) {
  const pub = b64urlToBytes(publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('bad_vapid_public');
  const jwk = { kty: 'EC', crv: 'P-256', d: privateKey, x: bytesToB64url(pub.slice(1, 33)), y: bytesToB64url(pub.slice(33)), ext: true };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

// VAPID antraštė: JWT (ES256), auditorija – push tarnybos kilmė (origin).
export async function vapidAuthorization(endpoint, { publicKey, privateKey, subject }, nowSec = Math.floor(Date.now() / 1000)) {
  const aud = new URL(endpoint).origin;
  const header = bytesToB64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = bytesToB64url(enc.encode(JSON.stringify({ aud, exp: nowSec + 12 * 3600, sub: subject })));
  const key = await importVapidPrivate(publicKey, privateKey);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${bytesToB64url(sig)}, k=${publicKey}`;
}

// Turinio šifravimas vienam gavėjui (subscription.keys.p256dh ir auth).
export async function encryptPayload(payload, { p256dh, auth }, { salt = crypto.getRandomValues(new Uint8Array(16)), senderKeys } = {}) {
  const uaPublic = b64urlToBytes(p256dh);
  const authSecret = b64urlToBytes(auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error('bad_subscription_keys');

  const kp = senderKeys || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, kp.privateKey, 256));

  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const plain = concat(typeof payload === 'string' ? enc.encode(payload) : payload, new Uint8Array([2]));
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, plain));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

// Vienas pranešimas vienam įrenginiui. Grąžina { ok, status, gone }.
export async function sendPush(sub, payload, vapid, { ttl = 3600, fetchImpl = fetch } = {}) {
  const body = await encryptPayload(JSON.stringify(payload), sub);
  const res = await fetchImpl(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: 'normal'
    },
    body
  });
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}

// Pranešimo turinys telefonui (ką rodo service worker). Apkarpom, kad tilptų į 4 KB.
export function buildPayload(row) {
  const cut = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || '');
  return {
    title: cut(row.title, 80),
    body: cut(row.body, 200),
    url: /^#\/[\w\-/]*$/.test(row.url || '') ? row.url : '#/',
    tag: `${row.kind || 'zt'}-${row.id}`
  };
}
