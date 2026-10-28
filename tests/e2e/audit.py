"""
Ekranų auditas (demonstracinis režimas): visi maršrutai, du ekrano pločiai (320 ir 390 px), tamsi ir šviesi tema.

Tikrina kiekviename ekrane:
  * XSS – visuose vartotojo laukuose įrašyti kenkėjiški tekstai neįvykdomi ir neatsiranda DOM'e;
  * nėra javascript: nuorodų;
  * nėra horizontalaus slinkimo (telefonas 320 px);
  * vienas h1, visi mygtukai/nuorodos/laukai turi prieinamą pavadinimą, paveikslėliai – alt;
  * teksto kontrastas pagal WCAG AA (4,5:1, didelis tekstas 3:1);
  * paspaudimo plotai ne mažesni nei 24×24 px (WCAG 2.2 AA), išskyrus nuorodas tekste;
  * nesikartojantys id.

python3 tests/e2e/audit.py
"""
import importlib.util
import json
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("e2e_base", HERE / "run.py")
base_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base_mod)

X = '"><img src=x onerror="window.__xss=1" data-xss><svg onload="window.__xss=2" data-xss></svg>'

# Įrašo kenkėjiškus tekstus į visus demo duomenų tekstinius laukus.
POISON = """(X) => {
  const KEY = 'zt-demo-v1';
  const db = JSON.parse(localStorage.getItem(KEY));
  const ids = Object.keys(db.profiles);
  ids.forEach((id, i) => { if (i > 0) { db.profiles[id].nickname = 'N' + i + X.slice(0, 12); db.profiles[id].region = X; } });
  db.tournaments.forEach((t) => {
    t.title = t.title + X.slice(0, 40); t.description = X; t.prizes = X + '\\n' + X;
    t.sponsor_name = X.slice(0, 60); t.sponsor_url = 'javascript:window.__xss=3';
  });
  db.catches.forEach((c, i) => {
    c.bait = X.slice(0, 80); c.notes = X;
    if (i % 5 === 0 && c.user_id === ids[0]) { c.status = 'rejected'; c.reject_reason = X; }
    if (i % 7 === 0 && c.user_id !== ids[0]) { c.status = 'pending'; }
  });
  (db.tournament_sponsors || []).forEach((sp) => { sp.name = X.slice(0, 60); sp.url = 'javascript:window.__xss=4'; sp.amount_cents = 12345; });
  (db.announcements || []).forEach((a) => { a.message = X; a.created_at = new Date().toISOString(); });
  (db.reports || []).forEach((r) => { r.message = X; });
  db.blank_trips = [{ id: 'b-x', user_id: ids[0], trip_date: new Date().toISOString().slice(0, 10), hours: 2, notes: X, created_at: new Date().toISOString() }];
  const rej = db.catches.find((c) => c.user_id === ids[0] && c.status === 'rejected');
  if (rej) db.disputes = [{ id: 'd-x', catch_id: rej.id, user_id: ids[0], message: X, status: 'open', resolution: X, created_at: new Date().toISOString() }];
  db.catches.filter((c) => c.status === 'pending').forEach((c) => { db.locations[c.id] = { lat: 54.9, lng: 23.9, accuracy: 15 }; });
  localStorage.setItem(KEY, JSON.stringify(db));
  return { me: ids[0], other: ids[1] };
}"""

AUDIT = r"""() => {
  const out = { errors: [], warnings: [] };
  const err = (m) => out.errors.push(m);
  const warn = (m) => out.warnings.push(m);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden]');
  };
  const desc = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}"`;

  if (window.__xss) err(`XSS įvykdytas: ${window.__xss}`);
  document.querySelectorAll('[data-xss], [onerror], [onload], [onmouseover], script:not([type=module]):not([src])').forEach((el) => err(`įterptas elementas: ${el.outerHTML.slice(0, 80)}`));
  document.querySelectorAll('a[href]').forEach((a) => { if (/^\s*javascript:/i.test(a.getAttribute('href'))) err(`javascript: nuoroda ${desc(a)}`); });

  const sw = document.documentElement.scrollWidth;
  if (sw > innerWidth + 1) {
    const wide = [...document.querySelectorAll('#app *')].filter((e) => visible(e) && e.getBoundingClientRect().right > innerWidth + 1 && !e.closest('.ruler, .ruler-strip'))
      .slice(0, 3).map(desc).join('; ');
    err(`horizontalus slinkimas: ${sw} > ${innerWidth} (${wide})`);
  }

  const h1 = [...document.querySelectorAll('h1')];
  if (h1.length !== 1) err(`h1 skaičius: ${h1.length}`);

  const ids = {};
  document.querySelectorAll('[id]').forEach((e) => { ids[e.id] = (ids[e.id] || 0) + 1; });
  Object.entries(ids).filter(([, n]) => n > 1).forEach(([id]) => err(`pasikartojantis id: ${id}`));

  const name = (el) => {
    if (el.getAttribute('aria-label')?.trim()) return true;
    const lb = el.getAttribute('aria-labelledby');
    if (lb && document.getElementById(lb)?.textContent.trim()) return true;
    if (el.labels && [...el.labels].some((l) => l.textContent.trim())) return true;
    if (el.closest('label')?.textContent.trim()) return true;
    if (el.title?.trim()) return true;
    if (['INPUT', 'TEXTAREA'].includes(el.tagName) && el.placeholder?.trim()) return 'placeholder';
    return !!el.textContent.trim() || [...el.querySelectorAll('img[alt]')].some((i) => i.alt.trim());
  };
  document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea').forEach((el) => {
    if (!visible(el)) return;
    const n = name(el);
    if (!n) err(`be pavadinimo: ${el.outerHTML.slice(0, 90)}`);
    else if (n === 'placeholder') warn(`tik placeholder kaip pavadinimas: ${desc(el)}`);
  });
  document.querySelectorAll('img').forEach((img) => { if (!img.hasAttribute('alt')) err(`img be alt: ${img.outerHTML.slice(0, 60)}`); });

  // Paspaudimo plotai
  document.querySelectorAll('button, a[href], input[type=checkbox], input[type=range], select, summary').forEach((el) => {
    if (!visible(el) || el.closest('.sr-only')) return;
    const r = el.getBoundingClientRect();
    const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.parentElement && el.parentElement.textContent.trim().length > el.textContent.trim().length + 3;
    if (inline) return;
    if (Math.min(r.width, r.height) < 24) err(`per mažas paspaudimo plotas ${Math.round(r.width)}×${Math.round(r.height)}: ${desc(el)}`);
    else if (Math.min(r.width, r.height) < 40) warn(`mažas paspaudimo plotas ${Math.round(r.width)}×${Math.round(r.height)}: ${desc(el)}`);
  });

  // Kontrastas
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const blend = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const bgOf = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage !== 'none' && !/gradient/.test(cs.backgroundImage)) return null; // ant paveikslėlio – praleidžiam
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) base = blend(layers[i], base);
    return base;
  };
  const seen = new Set();
  document.querySelectorAll('#app *').forEach((el) => {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own || !visible(el) || el.closest('.sr-only, [aria-hidden=true], option')) return;
    const cs = getComputedStyle(el);
    if (Number(cs.opacity) < 1 && el.closest('button:disabled')) return;
    let fg = parse(cs.color);
    const bg = bgOf(el);
    if (!fg || !bg) return;
    if (fg.a < 1) fg = blend(fg, bg);
    const L1 = lum(fg), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    if (ratio < need) {
      const key = `${cs.color}|${cs.backgroundColor}|${el.className}`;
      if (!seen.has(key)) { seen.add(key); err(`kontrastas ${ratio.toFixed(2)} < ${need}: ${desc(el)}`); }
    }
  });
  return out;
}"""


def main():
    httpd, base = base_mod.serve()
    problems = []
    warnings = set()
    checked = 0
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"])
        for width, height in [(320, 640), (390, 844)]:
            for theme in ["dark", "light"]:
                ctx = browser.new_context(viewport={"width": width, "height": height}, is_mobile=True, has_touch=True,
                                          geolocation={"latitude": 54.9, "longitude": 23.9, "accuracy": 8},
                                          permissions=["geolocation", "camera"], service_workers="block",
                                          locale="lt-LT", timezone_id="Europe/Vilnius")
                ctx.route(re.compile(r"https://fonts\.(googleapis|gstatic)\.com/.*"), lambda r: r.abort())
                ctx.route(base_mod.METEO, base_mod.fake_meteo)
                ctx.route(re.compile(r"https://cdn\.jsdelivr\.net/npm/leaflet@.*"), base_mod.leaflet_route)
                page = ctx.new_page()
                page.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))
                page.on("dialog", lambda d: d.dismiss())
                page.goto(base)
                page.wait_for_selector("h1", state="attached")
                ids = page.evaluate(POISON, X)
                page.evaluate(f"() => localStorage.setItem('zt-theme', '{theme}')")
                page.reload()
                page.wait_for_selector("h1", state="attached")
                routes = ["#/", "#/t/t-taure", "#/t/t-taure/lentele", "#/t/t-taure/tv", "#/t/t-plesrunai", "#/t/t-slaptas",
                          "#/t/t-eseriai", "#/dienorastis", "#/lenteles", "#/profilis", f"#/zvejys/{ids['other']}",
                          "#/naujas", "#/moderavimas", "#/moderavimas/gincai", "#/moderavimas/komanda",
                          "#/privatumas", "#/taisykles", "#/kvietimas/zzzzzz", "#/laimikis", "#/t/nera",
                          "#/l/demo-c1", "#/l/demo-c33", "#/l/nera", "#/moderavimas/pranesimai",
                          "#/moderavimas/blokuoti", f"#/zvejys/{ids['other']}", "#/moderavimas/patikros", "#/patikra/nera", "#/zemelapis",
                          "#/klubai", "#/klubas/club-kaunas", "#/klubas/club-nemunas?kodas=<b>x", "#/klubas/nera", "#/sekami", "#/t/t-sezonas/klubai",
                          "#/lygos", "#/lyga/lyga-marios", "#/lyga/nera", "#/t/t-dvikovos", "#/t/t-dvikovos/dvikovos", "#/t/t-taure/dvikovos", "#/t/t-taskai", "#/t/t-taskai/lentele", "#/t/t-taure/lentele?div=div-valtis", "#/t/t-taure/lentele?div=<x>", "#/t/t-taure"]
                for r in routes:
                    if r == "#/moderavimas/blokuoti":  # užblokuojam kitą žvejį su „nuodinga“ priežastimi
                        page.evaluate("([id, x]) => window.__zt.backend.banUser(id, 7, x)", [ids["other"], X])
                    page.goto("about:blank")
                    page.goto(base + r)
                    try:
                        page.wait_for_selector("h1", state="attached", timeout=5000)
                    except Exception:
                        problems.append(f"[{width}px {theme}] {r}: ekranas be h1")
                    page.wait_for_timeout(250)
                    if r == "#/laimikis":
                        page.get_by_role("button", name="Fotografuoti").click()
                        page.wait_for_selector("[data-step=details]:not([hidden])")
                        page.locator("details.more summary").click()
                    if r == "#/l/demo-c1" and page.get_by_role("button", name="Pranešti apie įtartiną laimikį").count():
                        page.get_by_role("button", name="Pranešti apie įtartiną laimikį").click()
                    if r == "#/dienorastis":
                        page.get_by_role("button", name="Nieko nekibo").click()
                        page.locator("[data-edit-catch]").first.click()
                        if page.get_by_role("button", name="Nesutinku su sprendimu").count():
                            page.get_by_role("button", name="Nesutinku su sprendimu").first.click()
                    if r == "#/profilis":
                        page.get_by_role("button", name="Redaguoti profilį").click()
                        page.get_by_role("button", name="Ištrinti paskyrą").first.click()
                    if r == "#/naujas":  # atidarom prizinio fondo ir rėmėjų laukus
                        page.get_by_label("Fondo suma, €").fill("1000")
                        page.get_by_role("button", name="Penkiems: 40 / 25 / 15 / 12 / 8").click()
                        page.get_by_role("button", name="Pridėti rėmėją").click()
                        page.get_by_role("button", name="Pridėti rėmėją").click()
                    if r == "#/moderavimas":
                        page.get_by_role("button", name="Atmesti").first.click()
                    page.wait_for_timeout(150)
                    res = page.evaluate(AUDIT)
                    checked += 1
                    tag = f"[{width}px {theme}] {r}"
                    problems.extend(f"{tag}: {e}" for e in res["errors"])
                    warnings.update(f"{width}px: {w}" for w in res["warnings"])
                ctx.close()
        browser.close()
    httpd.shutdown()
    print(f"Patikrinta ekranų: {checked}")
    if warnings:
        print(f"\nĮspėjimai ({len(warnings)}):")
        for w in sorted(warnings)[:40]:
            print("  ·", w)
    if problems:
        print(f"\nPROBLEMOS ({len(problems)}):")
        for e in problems:
            print("  ✗", e)
        sys.exit(1)
    print("\nAUDITAS PRAĖJO: XSS, nuorodos, plotis, antraštės, pavadinimai, kontrastas, paspaudimo plotai")


if __name__ == "__main__":
    main()
