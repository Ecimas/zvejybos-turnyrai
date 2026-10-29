// demo-seed: vienkartinis pagalbininkas demonstraciniam turnyrui.
//  search  – randa laisvos licencijos žuvų nuotraukas Wikimedia Commons (pavadinimas, licencija, autorius)
//  upload  – parsisiunčia pasirinktas nuotraukas ir įkelia į catch-photos/<žvejo id>/<vardas>.jpg, grąžina sha256
//  cleanup – ištrina nurodytų (jau ištrintų) žvejų aplankus saugykloje
//  logo    – perkelia demo rėmėjų logotipus iš mūsų svetainės į sponsor-logos/<turnyro id>/<vardas>.webp
// Kviečiama tik iš duomenų bazės (pg_net) su x-push-token antrašte, kaip send-push.

import { Image, decode } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const secretKeys = (() => { try { return JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'); } catch { return {}; } })();
const KEY: string = secretKeys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const BUCKET = 'catch-photos';
const UA = 'ZvejybosTurnyrai/1.0 (demo seed; https://zvejybos-turnyrai.vercel.app)';

function headers(extra: Record<string, string> = {}) {
  const h: Record<string, string> = { apikey: KEY, ...extra };
  if (!KEY.startsWith('sb_')) h.Authorization = `Bearer ${KEY}`;
  return h;
}

async function rpc(name: string, args: unknown) {
  const res = await fetch(`${URL_}/rest/v1/rpc/${name}`, { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(args) });
  if (!res.ok) throw new Error(`${name}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function sameToken(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const FREE = /^(CC0|Public domain|PD|CC BY(-SA)? [1-4]\.0|CC BY(-SA)? 2\.5)/i;
const strip = (s: string) => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);

async function search(queries: string[], limit = 40) {
  const out: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const q of queries) {
    const u = new URL('https://commons.wikimedia.org/w/api.php');
    Object.entries({
      action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrsearch: `${q} filetype:bitmap`, gsrlimit: String(limit),
      prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '1080', iiextmetadatafilter: 'LicenseShortName|Artist|ImageDescription'
    }).forEach(([k, v]) => u.searchParams.set(k, v));
    const res = await fetch(u, { headers: { 'User-Agent': UA } });
    if (!res.ok) { out.push({ query: q, error: res.status }); continue; }
    const data = await res.json();
    for (const p of Object.values(data?.query?.pages || {}) as any[]) {
      const ii = p.imageinfo?.[0];
      if (!ii || seen.has(p.title)) continue;
      const lic = ii.extmetadata?.LicenseShortName?.value || '';
      if (!FREE.test(lic) || !/jpe?g/i.test(ii.mime || '') || ii.width < 700) continue;
      seen.add(p.title);
      out.push({ q, title: p.title, w: ii.width, h: ii.height, license: lic, artist: strip(ii.extmetadata?.Artist?.value), desc: strip(ii.extmetadata?.ImageDescription?.value) });
    }
  }
  return out;
}

// Openverse (Flickr ir kt. CC nuotraukos): tik licencijos, leidžiančios komercinį naudojimą.
async function openverse(queries: string[], limit = 40) {
  const out: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const q of queries) {
    const u = new URL('https://api.openverse.org/v1/images/');
    Object.entries({ q, license_type: 'commercial', page_size: String(Math.min(limit, 20)), mature: 'false' })
      .forEach(([k, v]) => u.searchParams.set(k, v));
    const res = await fetch(u, { headers: { 'User-Agent': UA } });
    if (!res.ok) { out.push({ q, error: res.status }); continue; }
    const data = await res.json();
    for (const r of data?.results || []) {
      if (seen.has(r.id) || !/^https:/.test(r.url || '') || (r.width && r.width < 700)) continue;
      seen.add(r.id);
      out.push({ q, id: r.id, title: strip(r.title), url: r.url, w: r.width, h: r.height, license: `${String(r.license || '').toUpperCase()} ${r.license_version || ''}`.trim(),
        artist: strip(r.creator), page: r.foreign_landing_url, tags: (r.tags || []).map((t: any) => t.name).slice(0, 12).join(', ') });
    }
  }
  return out;
}

async function thumbOf(title: string) {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  Object.entries({ action: 'query', format: 'json', titles: title, prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '1280', iiextmetadatafilter: 'LicenseShortName|Artist' })
    .forEach(([k, v]) => u.searchParams.set(k, v));
  const data = await (await fetch(u, { headers: { 'User-Agent': UA } })).json();
  const p: any = Object.values(data?.query?.pages || {})[0];
  const ii = p?.imageinfo?.[0];
  if (!ii) throw new Error(`no image ${title}`);
  return { url: ii.thumburl || ii.url, page: ii.descriptionurl, license: ii.extmetadata?.LicenseShortName?.value || '', artist: strip(ii.extmetadata?.Artist?.value) };
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

// Commons miniatiūros – tik standartiniai pločiai (…, 500, 960, 1280, …), todėl imama 1280 ir sumažinama čia.
// Variantai, kad ta pati nuotrauka keliuose laimikiuose neatrodytų vienoda: 0 – originalas, 1 – veidrodinis,
// 2 – apkarpytas centras, 3 – veidrodinis ir apkarpytas kitu kampu. Visada iki 1080 px pločio, JPEG 85.
async function variant(src: Uint8Array, v: number): Promise<Uint8Array> {
  let img = (await decode(src)) as Image;
  if (img.width > 1080) img = img.resize(1080, Image.RESIZE_AUTO);
  if (v === 2 || v === 3) {
    const k = v === 2 ? 0.86 : 0.8;
    const w = Math.round(img.width * k);
    const h = Math.round(img.height * k);
    const x = v === 2 ? Math.round((img.width - w) / 2) : Math.round((img.width - w) * 0.15);
    const y = v === 2 ? Math.round((img.height - h) / 2) : Math.round((img.height - h) * 0.7);
    img = img.crop(x, y, w, h);
  }
  if (v === 1 || v === 3) {
    const w = img.width;
    const px = new Uint32Array(img.bitmap.buffer, img.bitmap.byteOffset, w * img.height);
    for (let row = 0; row < img.height; row++) {
      let a = row * w;
      let b = a + w - 1;
      while (a < b) { const t = px[a]; px[a] = px[b]; px[b] = t; a++; b--; }
    }
  }
  return await img.encodeJPEG(85);
}

async function upload(items: { title?: string; url?: string; path: string; variant?: number; license?: string; artist?: string; page?: string }[]) {
  const cache = new Map<string, { bytes: Uint8Array; meta: Record<string, string> }>();
  const out: Record<string, unknown>[] = [];
  for (const it of items) {
    if (!/^[0-9a-f-]{36}\/[A-Za-z0-9_-]{1,64}\.jpg$/.test(it.path)) { out.push({ path: it.path, error: 'path' }); continue; }
    try {
      const key = it.title || it.url || '';
      let c = cache.get(key);
      if (!c) {
        const meta = it.url ? { url: it.url, page: it.page || '', license: it.license || '', artist: it.artist || '' } : await thumbOf(it.title!);
        if (!/^https:\/\//.test(meta.url)) throw new Error('url');
        const res = await fetch(meta.url, { headers: { 'User-Agent': UA } });
        if (!res.ok) throw new Error(`download ${res.status}`);
        c = { bytes: new Uint8Array(await res.arrayBuffer()), meta };
        if (c.bytes.length > 8_000_000) throw new Error(`too big ${c.bytes.length}`);
        cache.set(key, c);
      }
      // Kiekvienam laimikiui – savas variantas; po JPEG pabaigos pridedamas kelias, kad maiša (sha256) visada skirtųsi.
      const img = await variant(c.bytes, it.variant || 0);
      const tail = new TextEncoder().encode(`\n${it.path}`);
      const bytes = new Uint8Array(img.length + tail.length);
      bytes.set(img);
      bytes.set(tail, img.length);
      const up = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${it.path}`, {
        method: 'POST', headers: headers({ 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }), body: bytes
      });
      if (!up.ok) throw new Error(`upload ${up.status} ${await up.text()}`);
      out.push({ path: it.path, sha256: hex(await crypto.subtle.digest('SHA-256', bytes)), ...c.meta });
    } catch (e) {
      out.push({ path: it.path, error: String((e as Error).message || e) });
    }
  }
  return out;
}

// Maža peržiūra (base64), kad prieš įkeliant būtų galima patikrinti, kas nuotraukoje.
async function preview(titles: string[], width = 220) {
  const out: Record<string, unknown>[] = [];
  for (const title of titles) {
    try {
      const meta = await thumbOf(title);
      const small = meta.url.replace(/\/(\d+)px-/, '/500px-'); // Commons leidžia tik standartinius dydžius
      const res = await fetch(small, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`download ${res.status}`);
      let img = (await decode(new Uint8Array(await res.arrayBuffer()))) as Image;
      img = img.resize(width, Image.RESIZE_AUTO);
      const jpg = await img.encodeJPEG(70);
      let bin = '';
      for (let i = 0; i < jpg.length; i++) bin += String.fromCharCode(jpg[i]);
      out.push({ title, w: img.width, h: img.height, b64: btoa(bin) });
    } catch (e) {
      out.push({ title, error: String((e as Error).message || e) });
    }
  }
  return out;
}

const LOGO_SRC = /^https:\/\/(zvejybos-turnyrai\.vercel\.app\/store\/demo-logos\/|raw\.githubusercontent\.com\/Ecimas\/zvejybos-turnyrai\/main\/store\/demo-logos\/)[a-z0-9-]{1,40}\.(webp|png)$/;
async function putLogos(items: { url: string; path: string }[]) {
  const out: Record<string, unknown>[] = [];
  for (const it of items.slice(0, 10)) {
    try {
      if (!LOGO_SRC.test(it.url || '')) throw new Error('url');
      if (!/^[0-9a-f-]{36}\/[A-Za-z0-9_-]{1,64}\.(webp|png)$/.test(it.path || '')) throw new Error('path');
      const res = await fetch(it.url);
      if (!res.ok) throw new Error(`download ${res.status}`);
      const type = (res.headers.get('content-type') || '').split(';')[0];
      if (!['image/webp', 'image/png'].includes(type)) throw new Error(`type ${type}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > 307200) throw new Error('too big');
      const up = await fetch(`${URL_}/storage/v1/object/sponsor-logos/${it.path}`, {
        method: 'POST', headers: headers({ 'Content-Type': type, 'x-upsert': 'true', 'cache-control': 'max-age=31536000' }), body: bytes
      });
      if (!up.ok) throw new Error(`upload ${up.status} ${await up.text()}`);
      out.push({ path: it.path, size: bytes.length });
    } catch (e) {
      out.push({ path: it.path, error: String((e as Error).message || e) });
    }
  }
  return out;
}

async function cleanup(prefixes: string[]) {
  const out: Record<string, unknown>[] = [];
  for (const prefix of prefixes) {
    if (!/^[0-9a-f-]{36}$/.test(prefix)) continue;
    const res = await fetch(`${URL_}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ prefix: `${prefix}/`, limit: 1000 })
    });
    const files: { name: string }[] = res.ok ? await res.json() : [];
    if (!files.length) { out.push({ prefix, removed: 0 }); continue; }
    const del = await fetch(`${URL_}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ prefixes: files.map((f) => `${prefix}/${f.name}`) })
    });
    out.push({ prefix, removed: del.ok ? files.length : 0, status: del.status });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method', { status: 405 });
  try {
    const cfg = await rpc('push_config', {});
    if (!cfg?.push_token || !sameToken(req.headers.get('x-push-token') || '', cfg.push_token)) return new Response('forbidden', { status: 403 });
    const body = await req.json();
    let result: unknown;
    if (body.action === 'search') result = await search(body.queries || [], body.limit || 40);
    else if (body.action === 'openverse') result = await openverse(body.queries || [], body.limit || 20);
    else if (body.action === 'upload') result = await upload(body.items || []);
    else if (body.action === 'preview') result = await preview(body.titles || [], body.width || 220);
    else if (body.action === 'logo') result = await putLogos(body.items || []);
    else if (body.action === 'cleanup') result = await cleanup(body.prefixes || []);
    else return new Response('action', { status: 400 });
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
