import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, createDecipheriv, hkdfSync, createPublicKey, verify } from 'node:crypto';
import {
  encryptPayload, vapidAuthorization, generateVapidKeys, b64urlToBytes, bytesToB64url, buildPayload, sendPush
} from '../../supabase/functions/send-push/webpush.js';

// RFC 8291, A priedas: oficialus pavyzdys su žinomais raktais ir druska.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN'
};

async function senderKeysFrom(priv, pub) {
  const p = b64urlToBytes(pub);
  const jwk = { kty: 'EC', crv: 'P-256', d: priv, x: bytesToB64url(p.slice(1, 33)), y: bytesToB64url(p.slice(33)), ext: true };
  const privateKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicKey = await crypto.subtle.importKey('raw', p, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  return { privateKey, publicKey };
}

// Nepriklausomas gavėjo pusės iššifravimas su node:crypto (kitas API nei WebCrypto).
function decryptAsReceiver(body, uaPrivate, uaPublic, auth) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const cipher = body.subarray(21 + idlen);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(b64urlToBytes(uaPrivate)));
  const secret = ecdh.computeSecret(Buffer.from(asPublic));
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), Buffer.from(b64urlToBytes(uaPublic)), Buffer.from(asPublic)]);
  const ikm = Buffer.from(hkdfSync('sha256', secret, Buffer.from(b64urlToBytes(auth)), info, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, 'paskutinio įrašo skirtukas');
  return plain.subarray(0, plain.length - 1).toString('utf8');
}

test('Web Push šifravimas sutampa su RFC 8291 pavyzdžiu baitas į baitą', async () => {
  const body = await encryptPayload(RFC.plaintext, { p256dh: RFC.uaPublic, auth: RFC.auth }, {
    salt: b64urlToBytes(RFC.salt), senderKeys: await senderKeysFrom(RFC.asPrivate, RFC.asPublic)
  });
  assert.equal(bytesToB64url(body), RFC.body);
  assert.equal(decryptAsReceiver(Buffer.from(body), RFC.uaPrivate, RFC.uaPublic, RFC.auth), RFC.plaintext);
});

test('Web Push: atsitiktiniai raktai – gavėjas iššifruoja, kas kartą kitokia druska', async () => {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const sub = { p256dh: bytesToB64url(ua.getPublicKey()), auth: bytesToB64url(crypto.getRandomValues(new Uint8Array(16))) };
  const msg = JSON.stringify({ title: 'Laimikis patvirtintas', body: 'Lydeka 92 cm – įskaityta 🎣' });
  const a = await encryptPayload(msg, sub);
  const b = await encryptPayload(msg, sub);
  assert.notEqual(bytesToB64url(a), bytesToB64url(b));
  assert.equal(decryptAsReceiver(Buffer.from(a), bytesToB64url(ua.getPrivateKey()), sub.p256dh, sub.auth), msg);
  await assert.rejects(encryptPayload(msg, { p256dh: 'abc', auth: sub.auth }), /bad_subscription_keys/);
});

test('VAPID parašas: galiojantis ES256 JWT, auditorija – push tarnybos kilmė', async () => {
  const keys = await generateVapidKeys();
  assert.equal(b64urlToBytes(keys.publicKey).length, 65);
  const h = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', { ...keys, subject: 'mailto:test@example.com' }, 1_800_000_000);
  const m = h.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/);
  assert.ok(m, h);
  const claims = JSON.parse(Buffer.from(b64urlToBytes(m[2])).toString());
  assert.deepEqual(claims, { aud: 'https://fcm.googleapis.com', exp: 1_800_000_000 + 43200, sub: 'mailto:test@example.com' });
  assert.equal(m[4], keys.publicKey);
  const pub = b64urlToBytes(keys.publicKey);
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: bytesToB64url(pub.slice(1, 33)), y: bytesToB64url(pub.slice(33)) }, format: 'jwk' });
  const ok = verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(b64urlToBytes(m[3])));
  assert.equal(ok, true, 'parašas turi tikti pagal viešąjį raktą');
});

test('sendPush: antraštės, „gone“ aptikimas, saugus turinys', async () => {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const sub = { endpoint: 'https://push.example.com/x/1', p256dh: bytesToB64url(ua.getPublicKey()), auth: bytesToB64url(new Uint8Array(16).fill(7)) };
  const vapid = { ...(await generateVapidKeys()), subject: 'mailto:a@b.lt' };
  let seen;
  const r = await sendPush(sub, { title: 'x' }, vapid, { fetchImpl: async (url, init) => { seen = { url, init }; return { ok: false, status: 410 }; } });
  assert.deepEqual(r, { ok: false, status: 410, gone: true });
  assert.equal(seen.url, sub.endpoint);
  assert.equal(seen.init.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(seen.init.headers.TTL, '3600');
  assert.match(seen.init.headers.Authorization, /^vapid t=/);
  const p = buildPayload({ id: 5, kind: 'review', title: 'T'.repeat(100), body: 'B', url: 'javascript:alert(1)' });
  assert.equal(p.title.length, 80);
  assert.equal(p.url, '#/', 'tik vidinės nuorodos');
  assert.equal(buildPayload({ id: 1, url: '#/l/abc-1' }).url, '#/l/abc-1');
  assert.equal(p.tag, 'review-5');
});

test('sugeneruoti VAPID raktai atitinka push_init() formatą', async () => {
  for (let i = 0; i < 20; i++) {
    const k = await generateVapidKeys();
    assert.match(k.publicKey, /^[A-Za-z0-9_-]{87}$/);
    assert.match(k.privateKey, /^[A-Za-z0-9_-]{43}$/);
  }
});
