// Laimikio kortelė pasidalinimui: nuotrauka + ilgis + rūšis + data (1080×1350 PNG).
// Nuotrauka piešiama tik iš tos pačios kilmės (data:/blob:) arba parsisiųsta kaip blob – kad drobė nebūtų „užteršta“.

const W = 1080;
const H = 1350;

async function loadBitmap(src) {
  if (!src) return null;
  try {
    if (src instanceof Blob) return await createImageBitmap(src);
    if (/^(data|blob):/.test(src)) {
      const img = new Image();
      img.src = src;
      await img.decode();
      return img;
    }
    const res = await fetch(src, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch {
    return null;
  }
}

function cover(ctx, img, x, y, w, h) {
  const iw = img.width || img.naturalWidth;
  const ih = img.height || img.naturalHeight;
  const s = Math.max(w / iw, h / ih);
  const sw = w / s;
  const sh = h / s;
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}

// photo: Blob arba URL; grąžina PNG Blob.
export async function makeShareCard({ photo, length, species, line = '', badge = '' }) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#17405a');
  grad.addColorStop(1, '#0a1822');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  const img = await loadBitmap(photo);
  if (img) cover(ctx, img, 0, 0, W, 1050);
  const shade = ctx.createLinearGradient(0, 650, 0, 1050);
  shade.addColorStop(0, 'rgba(10,24,34,0)');
  shade.addColorStop(1, 'rgba(10,24,34,1)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 650, W, 400);
  ctx.fillStyle = '#0a1822';
  ctx.fillRect(0, 1050, W, H - 1050);
  if (badge) {
    ctx.font = '700 40px system-ui, sans-serif';
    const bw = ctx.measureText(badge).width + 56;
    ctx.fillStyle = '#FFA62B';
    ctx.beginPath();
    ctx.roundRect?.(W - bw - 48, 48, bw, 76, 38);
    if (!ctx.roundRect) ctx.rect(W - bw - 48, 48, bw, 76);
    ctx.fill();
    ctx.fillStyle = '#1A1206';
    ctx.fillText(badge, W - bw - 20, 100);
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 190px "Barlow Condensed", system-ui, sans-serif';
  ctx.fillText(length, 56, 1010);
  ctx.font = '700 64px system-ui, sans-serif';
  ctx.fillText(species, 60, 1130);
  ctx.fillStyle = '#9fb6c6';
  ctx.font = '500 40px system-ui, sans-serif';
  ctx.fillText(line, 60, 1200);
  ctx.fillStyle = '#FFA62B';
  ctx.font = '800 40px system-ui, sans-serif';
  ctx.fillText('Žvejybos turnyrai', 60, 1290);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

// Dalinasi paveikslėliu (telefone – per „Dalintis“), kitaip parsiunčia. Grąžina 'shared' | 'downloaded' | 'cancelled'.
export async function shareImage(blob, { title = '', fileName = 'laimikis.png' } = {}) {
  const file = new File([blob], fileName, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch {
      return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'downloaded';
}
