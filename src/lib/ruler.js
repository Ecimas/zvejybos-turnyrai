// Liniuotė ilgiui pasirinkti: stumiama pirštu, kas centimetrą trumpai suvibruoja.
import { vibrate } from './device.js';

const STEP = 14; // px per 1 cm

export function mountRuler(root, { value, min = 10, max = 200, onChange }) {
  root.classList.add('ruler');
  root.innerHTML = '';
  const strip = document.createElement('div');
  strip.className = 'ruler-strip';
  for (let v = min; v <= max; v++) {
    const tick = document.createElement('div');
    tick.className = 'tick' + (v % 10 === 0 ? ' t10' : v % 5 === 0 ? ' t5' : '');
    if (v % 10 === 0) {
      const n = document.createElement('span');
      n.textContent = String(v);
      tick.appendChild(n);
    }
    strip.appendChild(tick);
  }
  const pointer = document.createElement('div');
  pointer.className = 'ruler-pointer';
  root.append(strip, pointer);

  let current = value;
  const place = () => {
    const center = root.clientWidth / 2;
    strip.style.transform = `translateX(${center - ((current - min) * STEP + STEP / 2)}px)`;
  };
  const set = (v, fromUser) => {
    const nv = Math.max(min, Math.min(max, Math.round(v)));
    if (nv === current) return;
    current = nv;
    place();
    if (fromUser) {
      vibrate(6);
      onChange?.(current);
    }
  };

  let drag = null;
  root.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, v: current };
    root.setPointerCapture?.(e.pointerId);
  });
  root.addEventListener('pointermove', (e) => {
    if (drag) set(drag.v - (e.clientX - drag.x) / STEP, true);
  });
  const end = () => { drag = null; };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
  ro?.observe(root);
  requestAnimationFrame(place);

  return {
    get value() { return current; },
    set: (v) => set(v, false),
    destroy: () => ro?.disconnect()
  };
}
