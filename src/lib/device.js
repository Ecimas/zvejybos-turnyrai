// Kamera, GPS ir nuotraukos parašas.
// Nuotrauka daroma tik programėlės kamera – įkelti iš galerijos negalima.

export async function startCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('no_camera');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }
  });
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.muted = true;
  await video.play();
  return stream;
}

export function stopCamera(stream) {
  stream?.getTracks().forEach((t) => t.stop());
}

// Kadras iš vaizdo įrašo su įdegintu vandens ženklu (laikas, kodas, slapyvardis).
// webp: true – laimikio nuotrauka WebP formatu (~2,5 karto lengvesnė, ta pati 1600 px raiška, liniuotės
// milimetrai matosi). iPhone naršyklė WebP nesukuria – tada JPEG. Patikros nuotraukos lieka JPEG.
export async function captureFrame(video, watermark, maxSide = 1600, { webp = false } = {}) {
  const w0 = video.videoWidth || 1280;
  const h0 = video.videoHeight || 960;
  const k = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.round(w0 * k);
  const h = Math.round(h0 * k);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, w, h);
  const bar = Math.max(28, Math.round(h * 0.045));
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.fillRect(0, h - bar, w, bar);
  ctx.fillStyle = '#E6EEF2';
  ctx.font = `600 ${Math.round(bar * 0.48)}px ui-monospace, Menlo, monospace`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(watermark.left, Math.round(bar * 0.4), h - bar / 2);
  ctx.textAlign = 'right';
  ctx.fillText(watermark.right, w - Math.round(bar * 0.4), h - bar / 2);
  const blob = await encodeCanvas(canvas, webp, webp ? 0.8 : 0.86, 0.82);
  if (!blob) throw new Error('capture_failed');
  return blob;
}

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

// WebP, jei naršyklė jį tikrai sukuria (Safari vietoj jo grąžina PNG), kitaip – JPEG.
async function encodeCanvas(canvas, webp, webpQuality, jpegQuality) {
  if (webp) {
    const b = await toBlob(canvas, 'image/webp', webpQuality);
    if (b && b.type === 'image/webp') return b;
  }
  return toBlob(canvas, 'image/jpeg', jpegQuality);
}

// Miniatiūros kelias: „uid/vardas.webp“ → „uid/vardas.t.webp“.
export function thumbPathOf(path) {
  return typeof path === 'string' && /\.(jpg|webp)$/.test(path) && !/\.t\.(jpg|webp)$/.test(path)
    ? path.replace(/\.(jpg|webp)$/, '.t.$1') : null;
}

// Maža peržiūros kopija (ilgoji kraštinė ≤ 400 px) tokio pat formato kaip originalas.
// Grąžina null, jei naršyklė jos sukurti negali – tada sąrašuose rodomas originalas.
export async function makeThumb(blob, maxSide = 400) {
  try {
    if (!blob || typeof createImageBitmap !== 'function') return null;
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bmp.width * k));
    canvas.height = Math.max(1, Math.round(bmp.height * k));
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const webp = blob.type === 'image/webp';
    const out = await encodeCanvas(canvas, webp, 0.72, 0.72);
    return out && out.type === blob.type ? out : null;
  } catch {
    return null;
  }
}

export async function sha256Hex(blob) {
  const buf = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// GPS: seka vietą, kol atidarytas laimikio ekranas, ir laiko tiksliausią paskutinę padėtį.
export function watchLocation(onUpdate) {
  if (!navigator.geolocation) {
    onUpdate({ state: 'unavailable' });
    return () => {};
  }
  onUpdate({ state: 'searching' });
  const id = navigator.geolocation.watchPosition(
    (p) => onUpdate({
      state: 'ok',
      lat: p.coords.latitude,
      lng: p.coords.longitude,
      accuracy: Math.round(p.coords.accuracy),
      at: p.timestamp
    }),
    (e) => onUpdate({ state: e.code === 1 ? 'denied' : 'error' }),
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
  );
  return () => navigator.geolocation.clearWatch(id);
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* nepalaikoma */ }
}
