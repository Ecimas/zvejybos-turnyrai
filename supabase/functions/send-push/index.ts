// send-push: paima pranešimus iš eilės (notification_outbox) ir išsiunčia į žvejų telefonus.
// Kviečia duomenų bazė (pg_net) su x-push-token antrašte; raktai – Supabase Vault (push_config()).
import { sendPush, buildPayload, generateVapidKeys } from './webpush.js';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const secretKeys = (() => { try { return JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'); } catch { return {}; } })();
const KEY: string = secretKeys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

function headers() {
  const h: Record<string, string> = { apikey: KEY, 'Content-Type': 'application/json' };
  if (!KEY.startsWith('sb_')) h.Authorization = `Bearer ${KEY}`; // senas JWT raktas
  return h;
}

async function rpc(name: string, args: unknown) {
  const res = await fetch(`${URL_}/rest/v1/rpc/${name}`, { method: 'POST', headers: headers(), body: JSON.stringify(args) });
  if (!res.ok) throw new Error(`${name}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

let config: { vapid_public: string; vapid_private: string; vapid_subject: string; push_token: string } | null = null;

function sameToken(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method', { status: 405 });
  try {
    config ??= await rpc('push_config', {});
    if (!config?.push_token || !sameToken(req.headers.get('x-push-token') || '', config.push_token)) {
      return new Response('forbidden', { status: 403 });
    }
    // Pirmas paleidimas: VAPID raktai sukuriami čia ir išsaugomi Vault (niekur kitur nepasirodo).
    if (!config.vapid_private) {
      const keys = await generateVapidKeys();
      await rpc('push_init', { p_public: keys.publicKey, p_private: keys.privateKey });
      config = await rpc('push_config', {});
      if (!config?.vapid_private) throw new Error('vapid_init_failed');
    }
    const vapid = { publicKey: config.vapid_public, privateKey: config.vapid_private, subject: config.vapid_subject };
    const rows: { id: number; kind: string; title: string; body: string; url: string; subs: { endpoint: string; p256dh: string; auth: string }[] }[] =
      await rpc('push_claim', { p_limit: 200 });
    const results: { id: number; sent: number; error: string | null }[] = [];
    const gone = new Set<string>();
    for (const row of rows || []) {
      const payload = buildPayload(row);
      let sent = 0;
      const errors: string[] = [];
      await Promise.all(row.subs.map(async (sub) => {
        try {
          const r = await sendPush(sub, payload, vapid);
          if (r.ok) sent++;
          else {
            errors.push(String(r.status));
            if (r.gone) gone.add(sub.endpoint);
          }
        } catch (e) {
          errors.push(String((e as Error).message || e).slice(0, 80));
        }
      }));
      results.push({ id: row.id, sent, error: errors.length ? errors.join(',') : null });
    }
    if (results.length || gone.size) await rpc('push_done', { p_results: results, p_gone: [...gone] });
    return Response.json({ processed: results.length, gone: gone.size });
  } catch (e) {
    config = null;
    console.error(e);
    return new Response('error', { status: 500 });
  }
});
