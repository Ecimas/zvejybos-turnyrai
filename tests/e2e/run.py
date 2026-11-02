"""
Naršyklės testai (demonstracinis režimas): pilnas vartotojo kelias telefono ekrane.
Netikra kamera ir GPS, offline eilė, moderavimas, lentelė, turnyro kūrimas, XSS apsauga.

Paleidimas:  python3 tests/e2e/run.py   (reikia Python Playwright ir Chromium)
Ekrano nuotraukos:  E2E_SHOTS=/kelias python3 tests/e2e/run.py
"""
import functools
import http.server
import json
import os
import pathlib
import re
import socketserver
import sys
import threading

from playwright.sync_api import sync_playwright, expect

ROOT = pathlib.Path(__file__).resolve().parents[2]
SHOTS = os.environ.get("E2E_SHOTS")
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
VERCEL = json.loads((ROOT / "vercel.json").read_text())
METEO = re.compile(r"https://api\.open-meteo\.com/.*")
METEO_BODY = json.dumps({"current": {"temperature_2m": 6.44, "wind_speed_10m": 3.06, "surface_pressure": 1012.6, "weather_code": 3}})


def fake_meteo(route):
    route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=METEO_BODY)


class Quiet(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".webmanifest": "application/manifest+json"}

    def log_message(self, *args):
        pass

    def do_GET(self):
        # Testai visada demonstraciniame režime (be tikros Supabase).
        if self.path.split("?")[0].endswith("/src/config.js"):
            body = b"export const SUPABASE_URL = '';\nexport const SUPABASE_ANON_KEY = '';\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def end_headers(self):
        # Tos pačios saugumo antraštės kaip Vercel (vercel.json) – kad testai pagautų CSP pažeidimus.
        for rule in VERCEL["headers"]:
            if rule["source"] == "/(.*)":
                for h in rule["headers"]:
                    self.send_header(h["key"], h["value"])
        super().end_headers()


def serve():
    handler = functools.partial(Quiet, directory=str(ROOT))
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://localhost:{httpd.server_address[1]}/"


def shot(page, name):
    if SHOTS:
        pathlib.Path(SHOTS).mkdir(parents=True, exist_ok=True)
        page.screenshot(path=f"{SHOTS}/{name}.png", full_page=False)


def open_diary(page):
    """Dienoraštyje atskleidžia visus suskleistus mėnesius ir metus."""
    for _ in range(30):
        folds = page.locator("[data-fold]")
        if not folds.count():
            return
        folds.first.click()


def step(name):
    print(f"  ✓ {name}")


def community_demo_tests(page, base):
    """Nieko nekibo, pranešimai apie laimikius, organizatoriaus pranešimai."""
    # „Nieko nekibo“
    page.goto(base + "#/dienorastis")
    page.get_by_role("button", name="Išvyka").click()
    expect(page.locator("[data-blank-form]")).to_contain_text("Žvejybos išvyka")
    page.locator("[data-blank-form]").get_by_label("Vieta (nebūtina)").fill("Kauno marios")
    page.get_by_label("Kiek valandų").fill("30")
    page.locator("[data-blank-form]").get_by_role("button", name="Išsaugoti").click()
    expect(page.locator("#toast")).to_have_text("Valandų: nuo 0,5 iki 24")
    page.get_by_label("Kiek valandų").fill("3,5")
    page.locator("[data-blank-form]").get_by_label("Pastabos (nebūtina)").fill("Stiprus vėjas <b>banga</b>")
    # Jei demo žvejys šiandien jau pagavo žuvį – išvyka su laimikiais, kitaip – „Nieko nekibo“.
    fished_today = page.evaluate("""() => { const me = window.__zt.state.user.id; const d = JSON.parse(localStorage.getItem('zt-demo-v1'));
      const t = new Date().toDateString(); return d.catches.some(c => c.user_id === me && c.status !== 'rejected' && new Date(c.captured_at_device).toDateString() === t); }""")
    page.locator("[data-blank-form]").get_by_role("button", name="Išsaugoti").click()
    expect(page.locator("#toast")).to_have_text("Išvyka išsaugota" if fished_today else "Išsaugota. Kitą kartą tikrai užkibs!")
    trip = page.locator(".trip-card")
    expect(trip).to_contain_text("Išvyka: Kauno marios · 3,5 val." if fished_today else "Nieko nekibo · Kauno marios · 3,5 val.")
    expect(trip).to_contain_text("Stiprus vėjas <b>banga</b>")
    expect(trip).to_contain_text("°C")  # oras paimtas, nes data – šiandien
    shot(page, "15-nieko-nekibo")
    page.goto(base + "#/profilis")
    expect(page.locator("[data-luck]")).to_contain_text("Žvejybos dienų")
    page.goto(base + "#/dienorastis")
    page.get_by_role("button", name="Ištrinti išvyką").click()
    expect(page.locator(".trip-card")).to_have_count(0)
    step("„Nieko nekibo“: įrašas su oru, statistika, ištrynimas")

    # Pranešimas apie įtartiną laimikį
    page.goto(base + "#/l/demo-c1")
    page.get_by_role("button", name="Pranešti apie įtartiną laimikį").click()
    page.locator("[data-report-form]").get_by_role("button", name="Pranešti").click()
    expect(page.locator("#toast")).to_have_text("Pasirink priežastį")
    page.get_by_role("radio", name="Netikslus ilgis").click()
    page.get_by_label("Paaiškinimas (nebūtina)").fill('Liniuotė prasideda nuo 5 cm <img src=x onerror="window.__xss=1">')
    page.locator("[data-report-form]").get_by_role("button", name="Pranešti").click()
    expect(page.locator("#toast")).to_have_text("Ačiū! Moderatorius peržiūrės laimikį")
    expect(page.locator("[data-reported]")).to_contain_text("moderatorius peržiūrės")
    expect(page.get_by_role("button", name="Pranešti apie įtartiną laimikį")).to_have_count(0)
    page.goto(base + "#/dienorastis")
    own = page.locator("[data-catch] a.catch-link").first.get_attribute("href")
    page.goto(base + own)
    expect(page.get_by_role("button", name="Pranešti apie įtartiną laimikį")).to_have_count(0)  # apie savo – ne
    page.goto(base + "#/profilis")
    expect(page.locator("[data-mod-card]")).to_contain_text(re.compile(r"\d pranešim"))
    page.goto(base + "#/moderavimas/pranesimai")
    groups = page.locator("[data-group]")
    expect(groups).to_have_count(2)
    g1 = page.locator("[data-group='demo-c1']")
    expect(g1).to_contain_text("Netikslus ilgis")
    expect(g1).to_contain_text('<img src=x onerror="window.__xss=1">')
    expect(g1.get_by_label("Atmetimo priežastis (matys žvejys)")).to_have_value("Netikslus ilgis")
    shot(page, "16-pranesimai")
    g1.get_by_role("button", name="Atmesti laimikį").click()
    expect(page.locator("#toast")).to_have_text("Laimikis atmestas")
    page.locator("[data-group]").first.get_by_role("button", name="Palikti galioti").click()
    expect(page.locator("#toast")).to_have_text("Laimikis paliktas galioti")
    expect(page.get_by_text("Pranešimų nėra")).to_be_visible()
    st = page.evaluate("() => { const db = JSON.parse(localStorage.getItem('zt-demo-v1')); return [db.catches.find(c => c.id === 'demo-c1').status, db.catches.find(c => c.id === 'demo-c28').status]; }")
    assert st == ["rejected", "approved"], st
    step("pranešimas apie įtartiną laimikį: dalyvis praneša, moderatorius atmeta arba palieka")

    # Organizatoriaus pranešimai
    page.goto(base + "#/t/t-slaptas")
    page.locator("[data-tab=pranesimai]").click()
    page.get_by_label("Naujas pranešimas visiems dalyviams").fill("Startas 6 val. <script>window.__xss=1</script>")
    page.get_by_role("button", name="Siųsti dalyviams").click()
    expect(page.locator("#toast")).to_have_text("Pranešimas išsiųstas dalyviams")
    expect(page.locator(".ann").first).to_contain_text("Startas 6 val. <script>window.__xss=1</script>")
    page.get_by_role("button", name="Ištrinti pranešimą").first.click()
    expect(page.locator(".ann")).to_have_count(0)
    # Dalyvis gauna naują pranešimą: juosta pradžios ekrane ir žymė turnyre
    page.evaluate("""() => { const db = JSON.parse(localStorage.getItem('zt-demo-v1'));
        db.announcements.push({ id: 'a-new', tournament_id: 't-taure', author_id: db.tournaments.find(t => t.id === 't-taure').organizer_id,
          message: 'Rytoj prognozuojamas stiprus vėjas – būkite atsargūs!', created_at: new Date().toISOString() });
        localStorage.setItem('zt-demo-v1', JSON.stringify(db)); }""")
    page.goto(base + "#/")
    page.reload()
    page.wait_for_selector("h1")
    page.locator("[data-seg=visi]").click()
    banner = page.locator(".t-card", has=page.locator("[data-ann-dot]"))
    expect(banner).to_have_count(1)
    expect(banner).to_contain_text("Rudens lydekų taurė")
    shot(page, "17-pranesimas-varpelis")
    banner.click()
    expect(page.locator("[data-panel=pranesimai]")).to_be_visible()
    expect(page.locator(".ann-new")).to_contain_text("stiprus vėjas")
    page.goto(base + "#/")
    expect(page.locator(".t-card", has_text="Rudens lydekų taurė").first).to_be_visible()
    expect(page.locator("[data-ann-dot]")).to_have_count(0)  # perskaityta
    step("organizatoriaus pranešimai: rašymas, ištrynimas, „nauja“ žymė dalyviui")
    page.goto(base + "#/profilis")


LEAFLET_STUB = """const log = (window.__leafletLog = { maps: 0, markers: [], popups: [], fit: [], tiles: [], removed: 0 });
function map(el) { log.maps++; el.classList.add('leaflet-container'); el.innerHTML = '<div class="fake-map">MAP</div>';
  return { fitBounds(b) { log.fit.push(b.length); return this; }, invalidateSize() { log.resized = (log.resized || 0) + 1; return this; }, remove() { log.removed++; } }; }
function tileLayer(url, o) { log.tiles.push(url); log.attribution = o && o.attribution; return { addTo() { return this; } }; }
function layerGroup() { const g = { addTo() { return g; }, clearLayers() { log.markers = []; log.popups = []; } }; return g; }
function circleMarker(ll, o) { const m = { bindPopup(h) { log.popups.push(h); return m; },
  addTo() { log.markers.push({ ll, color: o.fillColor, radius: o.radius }); return m; } }; return m; }
function divIcon(o) { return o; }
function marker(ll, o) { const m = { on() { return m; }, addTo() { log.markers.push({ ll, bubble: o.icon.html }); return m; } }; return m; }
export default { map, tileLayer, layerGroup, circleMarker, divIcon, marker };"""


MAPLIBRE_STUB = """(function () {
  const log = (window.__mlLog = { maps: 0, loaded: false, data: {}, sets: 0, layers: [], vis: {}, fly: [], fit: [], markers: [], removed: 0, handlers: {} });
  log.features = 0;
  class Map {
    constructor(o) { log.maps++; log.style = o.style; this.o = o; o.container.classList.add('maplibregl-map'); o.container.innerHTML = '<canvas class="fake-ml"></canvas>';
      this.h = {}; setTimeout(() => { log.loaded = true; (this.h.load || []).forEach((f) => f()); }, 30); }
    on(ev, layer, fn) { if (typeof layer === 'function') { fn = layer; layer = ''; } const k = ev + ':' + layer; (log.handlers[k] ||= []).push(fn); (this.h[ev] ||= []).push(fn); return this; }
    once(ev, fn) { (this.h[ev] ||= []).push(fn); return this; }
    isStyleLoaded() { return log.loaded; }
    loaded() { return log.loaded; }
    addSource(id, src) { log.data[id] = src.data.features.length; const self = this;
      this['src_' + id] = { setData(d) { log.data[id] = d.features.length; log.sets++; if (id === 'catches') { log.features = d.features.length; log.ids = d.features.map((f) => f.properties.id); } }, getClusterExpansionZoom: () => Promise.resolve(12) }; }
    getSource(id) { return this['src_' + id]; }
    addLayer(l) { log.layers.push(l.id); log.vis[l.id] = (l.layout && l.layout.visibility) || 'visible'; }
    getLayer(id) { return log.layers.includes(id) ? { id } : undefined; }
    setLayoutProperty(id, k, v) { if (k === 'visibility') log.vis[id] = v; }
    getCanvas() { return { style: {} }; }
    getZoom() { return 8; }
    fitBounds(b) { log.fit.push(b); }
    flyTo(o) { log.fly.push(o); }
    easeTo(o) { log.fly.push(o); }
    resize() {}
    remove() { log.removed++; }
  }
  class Marker { constructor(o) { this.el = o.element; } setLngLat(ll) { this.ll = ll; return this; } addTo() { log.markers.push(this.el.className); return this; } remove() {} }
  log.fire = (ev, layer, e) => (log.handlers[ev + ':' + layer] || []).forEach((f) => f(e));
  window.maplibregl = { Map, Marker };
})();"""


def maplibre_route(route):
    if route.request.url.endswith(".css"):
        route.fulfill(status=200, content_type="text/css", headers={"Access-Control-Allow-Origin": "*"}, body="")
    else:
        route.fulfill(status=200, content_type="text/javascript", headers={"Access-Control-Allow-Origin": "*"}, body=MAPLIBRE_STUB)


def ofm_style_route(route):
    route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"},
                  body='{"version": 8, "name": "fake-dark", "sources": {}, "layers": []}')


def maplibre_fail(route):
    route.abort()


def leaflet_route(route):
    if route.request.url.endswith(".css"):
        route.fulfill(status=200, content_type="text/css", headers={"Access-Control-Allow-Origin": "*"}, body="")
    else:
        route.fulfill(status=200, content_type="text/javascript", headers={"Access-Control-Allow-Origin": "*"}, body=LEAFLET_STUB)


def social_demo_test(page, base):
    # Klubai: sąrašas, atviras – laisvai, uždaras – tik su kodu (kodas iš kvietimo nuorodos)
    page.goto(base + "#/lenteles")
    page.get_by_role("link", name="Klubai").click()
    expect(page.get_by_role("heading", name="Žvejų klubai")).to_be_visible()
    expect(page.locator("[data-club-list] a")).to_have_count(2)
    page.get_by_role("link", name=re.compile("^Kauno lydekininkai")).click()
    expect(page.get_by_role("heading", name="Kauno lydekininkai")).to_be_visible()
    expect(page.get_by_text("4 nariai")).to_be_visible()
    page.get_by_role("button", name="Prisijungti prie klubo").click()
    expect(page.locator("#toast")).to_have_text("Prisijungei prie „Kauno lydekininkai“")
    expect(page.get_by_text("Tu – klubo narys")).to_be_visible()
    expect(page.locator("[data-invite-url]")).to_have_value(re.compile(r"#/klubas/club-kaunas\?kodas=a1b2c3d4e5$"))
    page.goto(base + "#/klubas/club-nemunas")
    page.get_by_label("Kvietimo kodas").fill("blogas")
    page.get_by_role("button", name="Prisijungti prie klubo").click()
    expect(page.locator("#toast")).to_have_text("Neteisingas kvietimo kodas")
    page.goto(base + "#/klubas/club-nemunas?kodas=f6e5d4c3b2")
    expect(page.get_by_label("Kvietimo kodas")).to_have_value("f6e5d4c3b2")
    page.get_by_role("button", name="Prisijungti prie klubo").click()
    expect(page.locator("#toast")).to_have_text("Prisijungei prie „Nemuno ešeriai“")
    # Savo klubas: uždaras, savininkas, nustatymai
    page.goto(base + "#/klubai")
    page.locator("[data-create-club] summary").click()
    page.get_by_label("Pavadinimas").fill("Mano draugai")
    page.get_by_text("Atviras", exact=True).click()
    page.get_by_role("button", name="Sukurti klubą").click()
    expect(page.get_by_role("heading", name="Mano draugai")).to_be_visible()
    expect(page.get_by_text("Tu – klubo savininkas")).to_be_visible()
    expect(page.get_by_text("su kvietimu")).to_be_visible()
    page.goto(base + "#/klubai")
    page.locator("[data-create-club] summary").click()
    page.get_by_label("Pavadinimas").fill("mano DRAUGAI")
    page.get_by_role("button", name="Sukurti klubą").click()
    expect(page.locator("#toast")).to_have_text("Toks klubo pavadinimas jau užimtas")
    step("klubai: atviras, uždaras su kodu iš nuorodos, savas klubas, pasikartojantis pavadinimas atmetamas")

    # Sekimas: profilis → Sekti → srautas
    lid = page.evaluate("() => Object.values(JSON.parse(localStorage.getItem('zt-demo-v1')).profiles).find(p => p.nickname === 'Lydekininkas').id")
    page.goto(base + f"#/zvejys/{lid}")
    expect(page.locator("[data-follow-counts]")).to_contain_text("0 sekėjai")
    page.get_by_role("button", name="Sekti").click()
    expect(page.locator("#toast")).to_have_text("Seki – jo laimikius matysi skiltyje „Sekami“")
    expect(page.locator("[data-follow-counts]")).to_contain_text("1 sekėjas")
    expect(page.get_by_role("button", name="Seki")).to_be_visible()
    expect(page.locator(".badge", has_text="Kauno lydekininkai")).to_be_visible()
    page.goto(base + "#/sekami")
    expect(page.get_by_text("Seki 1 žvejį.")).to_be_visible()
    expect(page.locator(".card-link", has_text="Lydekininkas").first).to_be_visible()
    page.goto(base + f"#/zvejys/{lid}")
    page.get_by_role("button", name="Seki").click()
    expect(page.locator("#toast")).to_have_text("Nebeseki")
    step("sekimas: sekti, sekėjų skaičius, sekamų laimikių srautas, nebesekti")

    # Komandinė įskaita: dalyvauji ir atstovauji klubui; klubų lentelė
    page.goto(base + "#/t/t-sezonas?skiltis=apzvalga")
    page.get_by_role("button", name="Dalyvauti").click()
    expect(page.locator("#toast")).to_have_text("Užsiregistravai į turnyrą")
    page.get_by_label("Atstovauju klubui").select_option(label="Kauno lydekininkai")
    expect(page.locator("#toast")).to_have_text("Atstovauji „Kauno lydekininkai“")
    assert page.evaluate("() => JSON.parse(localStorage.getItem('zt-demo-v1')).entries.find(e => e.tournament_id === 't-sezonas' && e.user_id === '00000000-0000-4000-8000-000000000001').club_id") == "club-kaunas"
    page.goto(base + "#/t/t-sezonas/lentele")
    page.get_by_role("button", name="Klubai").click()
    expect(page.get_by_role("heading", name="Klubų lentelė")).to_be_visible()
    rows = page.locator(".board-row")
    expect(rows).to_have_count(2)
    expect(rows.nth(0)).to_contain_text("įskaityti nariai")
    expect(page.locator(".board-row", has_text="Kauno lydekininkai")).to_have_class(re.compile("mine"))
    step("komandinė įskaita: klubo pasirinkimas turnyre ir klubų lentelė")


def clubs_demo_test(page, base):
    """Klubai+: veikla, išvykos, iššūkis, reakcijos ir komentarai, patarimai, rekordai, lyga, žemėlapis, valdymas."""
    accept = lambda d: d.accept()
    page.on("dialog", accept)
    page.goto(base + "#/klubas/club-kaunas?skiltis=veikla")
    expect(page.get_by_role("heading", name="Kauno lydekininkai")).to_be_visible()
    expect(page.locator("[data-verified]")).to_contain_text("Patvirtintas")
    expect(page.locator("[data-perk]")).to_contain_text("LYD15")
    expect(page.locator("[data-posts]")).to_contain_text("Pažaislio prieplaukos")
    trip = page.locator("[data-trip]").first
    expect(trip).to_contain_text("Kauno marios")
    trip.get_by_role("button", name="Gal").click()
    expect(page.locator("#toast")).to_have_text("Pažymėta „gal“")
    page.locator("[data-trip]").first.get_by_role("button", name="Važiuoju").click()
    expect(page.locator("[data-trip]").first.get_by_role("button", name="Važiuoju")).to_have_attribute("aria-pressed", "true")
    page.locator("[data-trip-new] summary").click()
    page.locator("[data-trip-form] [name=place]").fill("Nemuno kilpos, Birštonas")
    page.locator("[data-trip-form] [name=seats]").fill("3")
    page.locator("[data-trip-form]").get_by_role("button", name="Pakviesti narius").click()
    expect(page.locator("#toast")).to_have_text("Išvyka paskelbta – nariai gaus pranešimą")
    expect(page.locator("[data-trip]", has_text="Birštonas")).to_contain_text("liko 3 vietos")
    expect(page.locator("[data-challenge]")).to_contain_text("iššūkis")
    shot(page, "19-klubas-veikla")
    step("klubas: nuolaida nariams, pranešimas, išvykos su „Važiuoju / Gal“, nauja išvyka, mėnesio iššūkis")

    page.get_by_role("tab", name="Laimikiai").click()
    seeded = page.evaluate("() => JSON.parse(localStorage.getItem('zt-demo-v1')).catch_comments.find(c => c.id === 'cc-1').catch_id")
    item = page.locator(f"[data-feed-item='{seeded}']")
    expect(item).to_be_visible()
    like = item.locator("[data-react=like]")
    before = int(like.locator("span").inner_text())
    pressed = like.get_attribute("aria-pressed") == "true"
    like.click()
    expect(like.locator("span")).to_have_text(str(before - 1 if pressed else before + 1))
    item.locator("[data-comments]").click()
    box = item.locator("[data-comment-box]")
    expect(box).to_contain_text("Gražuolis")
    box.locator("[name=body]").fill("Super <b>žuvis</b>!")
    box.get_by_role("button", name="Siųsti komentarą").click()
    expect(box).to_contain_text("Super <b>žuvis</b>!")
    tips = page.locator("[data-tips]")
    expect(tips).to_contain_text("4–6 m gylyje")
    tips.locator("[data-like]").first.click()
    page.locator("[data-tip-form] [name=body]").fill("Vakare lydekos kimba prie nendrių")
    page.locator("[data-tip-form]").get_by_role("button", name="Pasidalinti").click()
    expect(page.locator("#toast")).to_have_text("Ačiū už patarimą!")
    shot(page, "19b-klubas-laimikiai")
    step("klubas: reakcijos, komentarai (be XSS), patarimai su „naudinga“")

    page.get_by_role("tab", name="Rekordai").click()
    expect(page.locator("[data-records] .cl-rec").first).to_be_visible()
    expect(page.locator("[data-season] .cl-rank").first).to_be_visible()
    page.goto(base + "#/klubai")
    page.locator("[data-league-link]").click()
    expect(page.get_by_role("heading", name=re.compile("Klubų lyga"))).to_be_visible()
    expect(page.locator("[data-league] li").first).to_be_visible()
    step("klubas: rekordai, sezono reitingas, klubų lyga")

    # Žemėlapis: pasidalinti savo laimikiais
    page.goto(base + "#/klubas/club-kaunas?skiltis=nariai")
    page.get_by_text("Rodyti mano laimikius klubo žemėlapyje").click()
    expect(page.locator("#toast")).to_have_text("Tavo laimikiai rodomi klubo žemėlapyje")
    page.goto(base + "#/klubas/club-kaunas/zemelapis")
    page.wait_for_function("() => window.__mlLog && window.__mlLog.features > 0")
    page.evaluate("() => window.__mlLog.fire('click', 'points', { features: [{ properties: { id: window.__mlLog.ids[0] } }] })")
    expect(page.locator("[data-sheet]")).to_contain_text("apylinkėje")
    step("klubo žemėlapis: tik pasidalinusių narių laimikiai, ~1 km tikslumu")

    # Laimikio puslapis: klubo draugų reakcijos ir komentarai, pranešimas apie komentarą, moderavimas
    cid = page.evaluate("() => JSON.parse(localStorage.getItem('zt-demo-v1')).catch_comments.find(c => c.id === 'cc-1').catch_id")
    page.goto(base + f"#/l/{cid}")
    sec = page.locator("[data-catch-social]")
    expect(sec).to_contain_text("Gražuolis")
    sec.locator("[data-comment-report]").first.click()
    expect(page.locator("#toast")).to_have_text("Ačiū – moderatorius peržiūrės")
    page.goto(base + "#/moderavimas")
    rc = page.locator("[data-reported-comments]")
    expect(rc).to_be_visible()
    # Skiltys: visos matomos be slinkimo (dvi eilutės), skaičiukas – kiek laukia
    mt = page.locator("nav.mod-tabs")
    expect(mt.locator("a")).to_have_count(8)
    expect(mt.locator("a[aria-current='page'] .t-tab-l")).to_have_text("Laimikiai")
    geo = page.evaluate("""() => { const n = document.querySelector('nav.mod-tabs');
      const ys = [...n.querySelectorAll('a')].map((a) => Math.round(a.getBoundingClientRect().top));
      return { sw: n.scrollWidth, cw: n.clientWidth, rows: new Set(ys).size,
        inside: [...n.querySelectorAll('a')].every((a) => a.getBoundingClientRect().right <= n.getBoundingClientRect().right + 1) }; }""")
    assert geo["sw"] <= geo["cw"] and geo["rows"] == 2 and geo["inside"], geo
    want = page.evaluate("async () => (await window.__zt.backend.modCounts()).queue")
    qb = mt.locator("[data-mod-count='queue']")
    if want:
        expect(qb).to_have_text(str(want))
    else:
        expect(qb).to_be_hidden()
    shot(page, "mod-tabs")
    rc.locator("[data-rc-del]").first.click()
    expect(page.locator("#toast")).to_have_text("Komentaras ištrintas")
    step("laimikio puslapis: klubo draugų reakcijos ir komentarai; pranešti komentarai moderatoriui")

    # Savo uždaras klubas: prašymas prisijungti, administratorius, nuolaida, klubo turnyras
    mine = page.evaluate("() => JSON.parse(localStorage.getItem('zt-demo-v1')).clubs.find(c => c.name === 'Mano draugai').id")
    other = page.evaluate("() => Object.values(JSON.parse(localStorage.getItem('zt-demo-v1')).profiles).find(p => p.nickname === 'Lydekininkas').id")
    page.evaluate("""(a) => { const db = JSON.parse(localStorage.getItem('zt-demo-v1'));
        db.club_join_requests.push({ club_id: a[0], user_id: a[1], message: 'Priimkit <i>mane</i>', created_at: new Date().toISOString() });
        localStorage.setItem('zt-demo-v1', JSON.stringify(db)); }""", [mine, other])
    page.goto(base + f"#/klubas/{mine}?skiltis=nariai")
    page.reload()
    req = page.locator("[data-join-requests]")
    expect(req).to_contain_text("Priimkit <i>mane</i>")
    req.get_by_role("button", name="Priimti Lydekininkas").click()
    expect(page.locator("#toast")).to_have_text("Priimtas į klubą")
    page.get_by_role("button", name="Skirti adm.").click()
    expect(page.locator("#toast")).to_have_text("Paskirtas administratorius")
    expect(page.locator(".list-row", has_text="Lydekininkas")).to_contain_text("Administratorius")
    page.locator("[data-club-settings] summary").click()
    pf = page.locator("[data-perk-form]")
    pf.locator("[name=sponsor_name]").fill("Marių valtys")
    pf.locator("[name=offer]").fill("−10 % valčių nuomai")
    pf.locator("[name=code]").fill("bad code!")
    pf.get_by_role("button", name="Išsaugoti nuolaidą").click()
    expect(page.locator("#toast")).to_have_text("Kodas: 2–24 raidės ar skaičiai")
    pf.locator("[name=code]").fill("VALTIS10")
    pf.get_by_role("button", name="Išsaugoti nuolaidą").click()
    expect(page.locator("#toast")).to_have_text("Nuolaida išsaugota")
    page.get_by_role("tab", name="Veikla").click()
    expect(page.locator("[data-perk]")).to_contain_text("VALTIS10")
    page.locator("[data-post-new] summary").click()
    page.locator("[data-post-form] [name=body]").fill("Sveiki atvykę!")
    page.locator("[data-post-form]").get_by_role("button", name="Paskelbti").click()
    expect(page.locator("[data-posts]")).to_contain_text("Sveiki atvykę!")
    page.locator("[data-club-tournament]").click()
    expect(page.locator("[data-club-note]")).to_be_visible()
    step("savas klubas: prašymas prisijungti, administratorius, nuolaida su patikra, pranešimas, klubo turnyras")

    # Funkcijų jungikliai: išjungus – nerodoma
    page.evaluate("""() => { const db = JSON.parse(localStorage.getItem('zt-demo-v1')); db.features.club_trips = false; localStorage.setItem('zt-demo-v1', JSON.stringify(db)); }""")
    page.goto(base + "#/klubas/club-kaunas?skiltis=veikla")
    page.reload()
    expect(page.locator("[data-posts]")).to_be_visible()
    expect(page.locator("[data-trips]")).to_have_count(0)
    page.evaluate("""() => { const db = JSON.parse(localStorage.getItem('zt-demo-v1')); db.features.club_trips = true; localStorage.setItem('zt-demo-v1', JSON.stringify(db)); }""")
    page.reload()
    page.remove_listener("dialog", accept)
    step("funkcijų jungikliai: išjungta funkcija nerodoma")


def formats_demo_test(page, base):
    demo = lambda js: page.evaluate(f"() => {{ const db = JSON.parse(localStorage.getItem('zt-demo-v1')); {js} }}")
    # Lyga: sukuriama, tada į ją įtraukiamas naujas taškų turnyras su divizionais
    page.goto(base + "#/lenteles")
    page.get_by_role("link", name="Sezono lygos").click()
    expect(page.get_by_role("heading", name="Sezono lygos")).to_be_visible()
    expect(page.locator("[data-league-list] a", has_text="Kauno marių lyga")).to_contain_text("3 etapai")
    page.locator("[data-create-league] summary").click()
    page.get_by_label("Pavadinimas").fill("<b>x</b>")
    page.get_by_role("button", name="Sukurti lygą").click()
    expect(page.locator("#toast")).to_contain_text("Pavadinime gali būti")
    page.get_by_label("Pavadinimas").fill("Mano sezono lyga")
    page.get_by_role("button", name="Sukurti lygą").click()
    expect(page.get_by_role("heading", name="Mano sezono lyga")).to_be_visible()
    expect(page.get_by_text("Taškų dar niekas neturi")).to_be_visible()
    page.get_by_role("link", name="Naujas etapas").click()
    page.get_by_label("Pavadinimas").fill("Taškų etapas")
    page.locator("[data-format=species_points]").click()
    expect(page.locator("[data-format-hint]")).to_contain_text("koeficient")
    page.locator("[data-submit]").click()
    expect(page.locator("[data-error]")).to_contain_text("pažymėk bent vieną rūšį")
    page.locator("[data-sp='1']").click()
    page.locator("[data-sp='3']").click()
    page.locator("[data-coef='3']").select_option("200")
    page.locator("[data-add-div]").click()
    page.locator("[data-div-name]").nth(0).fill("Jaunimas")
    page.locator("[data-add-div]").click()
    page.locator("[data-div-name]").nth(1).fill("jaunimas")
    page.locator("[data-submit]").click()
    expect(page.locator("[data-error]")).to_contain_text("turi skirtis")
    page.locator("[data-div-name]").nth(1).fill("Moterys")
    page.get_by_label("Sezono lyga").select_option(label=f"Mano sezono lyga · {page.evaluate('() => new Date().getFullYear()')}")
    page.locator("[data-submit]").click()
    expect(page.locator("#toast")).to_have_text("Turnyras sukurtas")
    expect(page.get_by_role("heading", name="Taškų etapas")).to_be_visible()
    rules = page.locator("dl.list")
    expect(rules).to_contain_text("Taškai už rūšį · TOP-3")
    expect(rules).to_contain_text("Lydeka ×1, Starkis ×2")
    expect(rules).to_contain_text("Jaunimas, Moterys")
    page.locator("[data-tab=taisykles]").click()
    expect(page.get_by_role("link", name=re.compile("Mano sezono lyga"))).to_be_visible()
    page.locator("[data-tab=apzvalga]").click()
    page.get_by_label("Mano divizionas").select_option(label="Moterys")
    expect(page.locator("#toast")).to_have_text("Divizionas: Moterys")
    tid = page.evaluate("() => location.hash.split('/')[2]")
    got = demo(f"""const t = db.tournaments.find(x => x.id === '{tid}');
      return {{ pct: db.tournament_species.filter(x => x.tournament_id === t.id).map(x => [x.species_id, x.points_pct]).sort(),
               league: db.leagues.find(l => l.id === t.league_id).name,
               div: db.divisions.find(d => d.id === db.entries.find(e => e.tournament_id === t.id && e.user_id === '00000000-0000-4000-8000-000000000001').division_id).name }};""")
    assert got == {"pct": [[1, 100], [3, 200]], "league": "Mano sezono lyga", "div": "Moterys"}, got
    # Redagavimas: koeficientai ir divizionai išlieka; pervadinus divizioną dalyvio pasirinkimas nedingsta
    page.get_by_role("link", name="Redaguoti").click()
    expect(page.locator("[data-coef='3']")).to_have_value("200")
    expect(page.locator("[data-div-name]")).to_have_count(2)
    page.locator("[data-div-name]").nth(1).fill("Moterų")
    page.locator("[data-submit]").click()
    expect(page.locator("#toast")).to_have_text("Pakeitimai išsaugoti")
    expect(page.locator("dl.list")).to_contain_text("Jaunimas, Moterų")
    expect(page.get_by_label("Mano divizionas")).to_have_value(re.compile(".+"))
    expect(page.get_by_label("Mano divizionas").locator("option:checked")).to_have_text("Moterų")
    step("lyga ir taškų turnyras: koeficientai, divizionai, lyga; redagavimas išsaugo pasirinkimus")

    # Taškų lentelė
    page.goto(base + "#/t/t-taskai/lentele")
    expect(page.locator(".podium")).to_contain_text("tšk.")
    expect(page.locator(".podium")).not_to_contain_text(" cm")
    # Divizionų skirtukai: perskaičiuotos vietos, be prizų sumų
    page.goto(base + "#/t/t-taure/lentele")
    tabs = page.locator("nav.seg-tabs a")
    expect(tabs).to_have_text(["Visi", "Krantas", "Valtis"])
    page.get_by_role("button", name="Valtis").click()
    expect(page.get_by_role("heading", name="Lentelė · Valtis")).to_be_visible()
    n_valtis = demo("return db.entries.filter(e => e.tournament_id === 't-taure' && e.division_id === 'div-valtis').length;")
    expect(page.locator(".podium-col, .board-row")).to_have_count(n_valtis)
    expect(page.locator(".prize-amt")).to_have_count(0)
    expect(page.locator(".podium-col.p1 .rank")).to_have_text("1")
    step("taškų lentelė ir divizionų lentelės (vietos perskaičiuojamos, be prizų)")

    # Dvikovos
    page.goto(base + "#/t/t-dvikovos?skiltis=apzvalga")
    card = page.locator("[data-duel-card]")
    expect(card).to_contain_text("Finalas")
    card.get_by_role("link", name="Visas tinklelis").click()
    expect(page.get_by_role("heading", name="Dvikovos", level=1)).to_be_visible()
    for name, pairs in (("Ketvirtfinalis", 4), ("Pusfinalis", 2), ("Finalas", 1)):
        sec = page.locator("section", has=page.get_by_role("heading", name=name, exact=True))
        expect(sec.locator(".duel-pair")).to_have_count(pairs)
    expect(page.locator(".duel-side.win")).to_have_count(6)
    expect(page.locator(".card.duel-mine").first).to_be_visible()
    # Naujos dvikovos: registracija tik iki starto, slėpimo ir komandų nėra
    page.goto(base + "#/naujas")
    page.get_by_label("Pavadinimas").fill("Mano dvikovos")
    page.locator("[data-format=duels]").click()
    expect(page.get_by_label("Registracija po starto")).to_be_hidden()
    expect(page.get_by_text("Slėpti lentelę iki pabaigos")).to_be_hidden()
    page.locator("[data-submit]").click()
    expect(page.locator("#toast")).to_have_text("Turnyras sukurtas")
    expect(page.locator("dl.list")).to_contain_text("Tik iki starto")
    expect(page.locator("[data-duel-card]")).to_contain_text("Poros bus sudarytos startui")
    step("dvikovos: kortelė, tinklelis su ratais, naujų dvikovų taisyklės")

    page.goto(base + "#/lyga/lyga-marios")
    expect(page.locator(".league-row").first).to_contain_text("tšk.")
    expect(page.locator(".list-row", has_text="Marių taškų taurė")).to_be_visible()
    step("lygos lentelė: taškai už vietas etapuose")


def stats_demo_test(page, base):
    page.goto(base + "#/profilis")
    page.reload()  # paleidžiant programėlė praneša „esu čia“ su įrenginiu
    page.wait_for_function("() => (JSON.parse(localStorage.getItem('zt-demo-v1')).devices || []).length > 0")
    page.goto(base + "#/moderavimas/statistika")
    expect(page.get_by_role("heading", name="Vartotojai")).to_be_visible()
    users = page.evaluate("() => Object.keys(JSON.parse(localStorage.getItem('zt-demo-v1')).profiles).length")
    expect(page.locator("[data-stat='users'] .stat-value")).to_have_text(str(users))
    expect(page.locator("[data-models]")).to_contain_text("Galaxy S23 Ultra (SM-S918B)")
    mine = page.evaluate("() => (JSON.parse(localStorage.getItem('zt-demo-v1')).devices || []).map(d => d.model)")
    assert len(mine) >= 1, "demo vartotojo įrenginys neužfiksuotas"
    expect(page.locator("[data-models]")).to_contain_text(mine[0])
    expect(page.locator("[data-signups-empty]")).to_be_visible()  # demo žvejai užsiregistravę seniai
    expect(page.locator("[data-stat='online_now'] .stat-value")).to_have_text(re.compile(r"^[1-9]"))
    step("statistika: vartotojai, aktyvūs, registracijų grafikas, telefonų modeliai")


def logo_png(color=(40, 120, 200), size=(900, 300)):
    import io
    from PIL import Image, ImageDraw
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((30, 40, 300, 260), fill=color + (255,))
    d.rectangle((340, 110, 860, 190), fill=(20, 30, 40, 255))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def sponsors_demo_test(page, base):
    # Turnyro puslapis: generalinis rėmėjas su logotipu ir pasiūlymu, kiti – tinklelyje
    page.goto(base + "#/")
    page.evaluate("() => localStorage.removeItem('zt-sponsor-seen')")  # ankstesni testai jau „matė“ šiandien
    page.goto(base + "#/t/t-taure?skiltis=apzvalga")
    main = page.locator("[data-sponsor-main]")
    expect(main).to_contain_text("Generalinis rėmėjas")
    expect(main).to_contain_text("Ežero žvejybos parduotuvė")
    expect(main).to_contain_text("−10 % visiems dalyviams su kodu TAURE")
    expect(main.locator("img")).to_have_count(1)
    expect(page.locator(".sponsor-grid .sponsor-logo")).to_have_count(1)
    if SHOTS:  # rinkodaros nuotraukai – be administratoriaus mygtukų ir demo juostos
        page.evaluate("() => document.querySelectorAll('[data-admin-edit], [data-sponsors-manage], .demo-banner').forEach(e => e.style.display = 'none')")
    shot(page, "remejai-turnyras")
    page.wait_for_function("() => (JSON.parse(localStorage.getItem('zt-demo-v1')).sponsor_stats || []).some(x => x.sponsor_id === 's1' && x.day === new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vilnius' }) && x.views >= 1)")
    views = page.evaluate("() => JSON.parse(localStorage.getItem('zt-demo-v1')).sponsor_stats.filter(x => x.sponsor_id === 's1').reduce((a, x) => a + x.views, 0)")
    page.reload()
    page.wait_for_timeout(400)
    again = page.evaluate("() => JSON.parse(localStorage.getItem('zt-demo-v1')).sponsor_stats.filter(x => x.sponsor_id === 's1').reduce((a, x) => a + x.views, 0)")
    assert again == views, f"tas pats įrenginys suskaičiuotas du kartus per dieną: {views} -> {again}"
    with page.context.expect_page() as popup:
        main.locator("a[data-sponsor-click]").first.click()
    popup.value.close()
    page.wait_for_function("() => JSON.parse(localStorage.getItem('zt-demo-v1')).sponsor_stats.some(x => x.sponsor_id === 's1' && x.clicks >= 1 && x.day === new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vilnius' }))")
    step("rėmėjai turnyro puslapyje: generalinis, logotipai, parodymai ir paspaudimai")

    page.goto(base + "#/")
    page.locator("[data-seg=live]").click()
    card = page.locator(".t-card", has_text="Rudens lydekų taurė")
    expect(card.locator(".t-sponsors img")).to_have_count(2)
    if SHOTS:
        card.evaluate("e => e.scrollIntoView({ block: 'center' })")
        page.wait_for_timeout(200)
        card.screenshot(path=f"{SHOTS}/remejai-sarasas.png")
    page.goto(base + "#/t/t-taure/lentele")
    expect(page.locator("[data-sponsor-strip]")).to_contain_text("Lentelę remia")
    expect(page.locator("[data-sponsor-strip] img")).to_have_count(2)
    shot(page, "remejai-lentele")
    page.goto(base + "#/t/t-taure/tv")
    expect(page.locator("[data-tv-sponsors] img")).to_have_count(2)
    shot(page, "remejai-ekranas")
    step("rėmėjų logotipai sąraše, lentelėje ir didžiajame ekrane")

    # Tvarkymas: naujas generalinis rėmėjas su įkeltu logotipu
    page.goto(base + "#/t/t-taure?skiltis=apzvalga")
    page.locator("[data-sponsors-manage]").click()
    expect(page.locator("[data-sponsor-stats]")).to_contain_text("Ežero žvejybos parduotuvė")
    expect(page.locator("[data-stat-sponsor=s1] [data-clicks]")).not_to_have_text("0")
    shot(page, "remejai-statistika")
    page.get_by_role("button", name="Pridėti rėmėją").click()
    row = page.locator("[data-row='2']")
    row.locator("[data-f=name]").fill("Valčių nuoma „Banga“")
    row.locator("[data-f=url]").fill("https://example.org")
    row.locator("[data-f=blurb]").fill("Valtis dalyviams −20 %")
    row.locator("input[type=file]").set_input_files({"name": "logo.png", "mimeType": "image/png", "buffer": logo_png()})
    expect(page.locator("#toast")).to_contain_text("Logotipas įkeltas")
    row = page.locator("[data-row='2']")
    expect(row.locator(".logo-preview img")).to_have_count(1)
    stored = page.evaluate("() => { const db = JSON.parse(localStorage.getItem('zt-demo-v1')); return Object.entries(db.logos).filter(([k]) => k.startsWith('t-taure/')).map(([k, v]) => v.slice(0, 22)); }")
    assert stored and stored[0].startswith("data:image/webp"), f"logotipas nesumažintas į WebP: {stored}"
    row.get_by_text("Generalinis rėmėjas").click()
    expect(page.locator("[data-row='0'] [data-f=name]")).to_have_value("Valčių nuoma „Banga“")
    page.locator("[data-row='1'] [data-f=url]").fill("http://nesaugu.lt")
    page.get_by_role("button", name="Išsaugoti rėmėjus").click()
    expect(page.locator("[data-error]")).to_contain_text("https://")
    page.locator("[data-row='1'] [data-f=url]").fill("https://example.com")
    shot(page, "remejai-tvarkymas")
    page.get_by_role("button", name="Išsaugoti rėmėjus").click()
    expect(page.locator("#toast")).to_have_text("Rėmėjai išsaugoti")
    expect(page.locator("[data-sponsor-main]")).to_contain_text("Valčių nuoma „Banga“")
    expect(page.locator("[data-sponsor-main]")).to_contain_text("Valtis dalyviams −20 %")
    expect(page.locator(".sponsor-grid .sponsor-logo")).to_have_count(2)
    sp = page.evaluate("() => JSON.parse(localStorage.getItem('zt-demo-v1')).tournament_sponsors.filter(x => x.tournament_id === 't-taure').map(x => [x.id, x.tier, x.sort])")
    assert [x[1] for x in sorted(sp, key=lambda x: x[2])] == ["main", "partner", "partner"], sp
    assert any(x[0] == "s1" and x[1] == "partner" for x in sp), f"senojo rėmėjo statistika turi išlikti (tas pats ID): {sp}"
    step("rėmėjų tvarkymas: logotipo įkėlimas, generalinis rėmėjas, statistika")


def organizer_demo_test(page, base):
    page.goto(base + "#/moderavimas/komanda")
    req = page.locator("[data-org-req]")
    expect(req).to_contain_text("Nemuno_Jonas")
    expect(req).to_contain_text("Nemuno taurę")
    shot(page, "organizatoriaus-prasymas")
    req.get_by_role("button", name="Patvirtinti").click()
    expect(page.locator("#toast")).to_have_text("Organizatorius patvirtintas")
    expect(page.locator("[data-org-req]")).to_have_count(0)
    expect(page.locator(".team-card", has_text="Nemuno_Jonas").get_by_label("Organizatorius")).to_be_checked()
    p = page.evaluate("() => Object.values(JSON.parse(localStorage.getItem('zt-demo-v1')).profiles).find(p => p.nickname === 'Nemuno_Jonas')")
    assert p["roles"] == ["organizer"], p
    page.goto(base + "#/organizatorius")
    expect(page.locator("[data-org-ok]")).to_contain_text("Tu – organizatorius")
    step("organizatoriaus prašymas: savininkas patvirtina, organizatorius – ne komandos narys")


def admin_demo_test(page, base):
    # Demo žvejys – savininkas, todėl turi teisę tvarkyti bet kurį turnyrą (0026)
    page.goto(base + "#/t/t-sezonas?skiltis=apzvalga")
    page.get_by_role("link", name="Tvarkyti").click()
    expect(page.locator("[data-admin-note]")).to_contain_text("Turnyras jau prasidėjo")
    expect(page.get_by_role("button", name="Dvikovos")).to_be_disabled()
    expect(page.get_by_role("button", name="Pridėti divizioną")).to_be_disabled()
    expect(page.locator("input[name=starts_at]")).to_be_disabled()
    expect(page.locator("input[name=min_cm]")).to_be_disabled()
    expect(page.locator("input[name=title]")).to_be_enabled()
    page.locator("input[name=title]").fill("Sezono iššūkis 2026")
    page.locator("textarea[name=description]").fill("Taisyklės patikslintos administratoriaus.")
    shot(page, "admin-redagavimas")
    page.get_by_role("button", name="Išsaugoti pakeitimus").click()
    expect(page.locator("#toast")).to_have_text("Pakeitimai išsaugoti")
    expect(page.get_by_role("heading", name="Sezono iššūkis 2026")).to_be_visible()
    t = page.evaluate("() => JSON.parse(localStorage.getItem('zt-demo-v1')).tournaments.find(t => t.id === 't-sezonas')")
    assert t["format"] == "biggest" and t["team_mode"] is True, f"užrakintos taisyklės pasikeitė: {t}"
    step("administratorius taiso vykstantį turnyrą – taisyklės užrakintos")

    page.goto(base + "#/t/t-plesrunai?skiltis=apzvalga")
    page.get_by_role("link", name="Tvarkyti").click()
    page.get_by_role("button", name="Pašalinti turnyrą").click()
    page.locator("[data-del-reason]").fill("abc")
    page.get_by_role("button", name="Pašalinti galutinai").click()
    expect(page.locator("[data-error]")).to_contain_text("bent 5 simboliai")
    page.locator("[data-del-reason]").fill("Bandomasis turnyras, dalyvių skundai")
    page.get_by_role("button", name="Pašalinti galutinai").click()
    expect(page.locator("#toast")).to_have_text("Turnyras pašalintas")
    expect(page.get_by_text("Rugsėjo plėšrūnai")).to_have_count(0)
    page.goto(base + "#/moderavimas/turnyrai")
    expect(page.locator("[data-log-row=delete]")).to_contain_text("Rugsėjo plėšrūnai")
    expect(page.locator("[data-log-row=delete]")).to_contain_text("Bandomasis turnyras, dalyvių skundai")
    expect(page.locator("[data-log-row=update]")).to_contain_text("Sezono iššūkis 2026")
    expect(page.locator("[data-log-row=update]")).to_contain_text("Pavadinimas")
    expect(page.locator("[data-log-row=update]")).not_to_contain_text("Pabaiga")  # nepakeistas laikas – ne pakeitimas
    shot(page, "admin-zurnalas")
    step("administratorius pašalina turnyrą su priežastimi, žurnalas")


def features_panel_demo_test(page, base):
    """Administravimo panelė: jungikliai veikia iškart, skelbimas visiems, žurnalas."""
    page.goto(base + "#/moderavimas/funkcijos")
    expect(page.get_by_role("heading", name="Programėlės funkcijos")).to_be_visible()
    expect(page.locator("nav.mod-tabs a[aria-current='page'] .t-tab-l")).to_have_text("Funkcijos")
    expect(page.locator("[data-feature]")).to_have_count(18)
    expect(page.locator("[data-feature-sum] .af-big")).to_have_text("18/18")

    def toggle(key, on):
        box = page.locator(f"[data-feature='{key}']")
        box.click()
        expect(page.locator("#toast")).to_contain_text("Įjungta" if on else "Išjungta visiems")
        expect(page.locator(f"[data-feature='{key}']")).to_be_checked(checked=on)

    # Sekimas išjungtas: nuorodos dingsta, puslapis praneša; įjungus – grįžta
    toggle("social_follow", False)
    expect(page.locator("[data-feature-row='social_follow'] .af-off")).to_contain_text("Išjungta")
    expect(page.locator("[data-feature-sum] .af-big")).to_have_text("17/18")
    page.goto(base + "#/lenteles")
    expect(page.locator("a[href='#/klubai']").first).to_be_visible()
    expect(page.locator("[data-follow-link]")).to_have_count(0)
    page.goto(base + "#/sekami")
    expect(page.locator("[data-feature-off]")).to_contain_text("Sekimas šiuo metu išjungtas")
    page.goto(base + "#/profilis")
    expect(page.locator(".p-quick a[href='#/sekami']")).to_have_count(0)
    # Serveris (demo) irgi neleidžia sekti
    err = page.evaluate("""async () => { const me = window.__zt.state.user.id;
      const other = Object.keys(JSON.parse(localStorage.getItem('zt-demo-v1')).profiles).find((k) => k !== me);
      try { await window.__zt.backend.follow(other); return ''; } catch (e) { return e.message; } }""")
    assert "išjungta" in err, err

    # Lygos ir dvikovos
    page.goto(base + "#/moderavimas/funkcijos")
    toggle("leagues", False)
    toggle("duels", False)
    page.goto(base + "#/lenteles")
    expect(page.locator("[data-leagues-link]")).to_have_count(0)
    page.goto(base + "#/lygos")
    expect(page.locator("[data-feature-off]")).to_contain_text("Sezono lygos šiuo metu išjungtos")
    page.goto(base + "#/naujas")
    expect(page.locator("[data-format='biggest']")).to_be_visible()
    expect(page.locator("[data-format='duels']")).to_have_count(0)
    expect(page.locator("select[name='league_id']")).to_have_count(0)

    # „Nieko nekibo“ ir orai
    page.goto(base + "#/moderavimas/funkcijos")
    toggle("blank_trips", False)
    toggle("weather", False)
    page.goto(base + "#/dienorastis")
    expect(page.locator("[data-blank-open]")).to_be_hidden()
    page.goto(base + "#/profilis?skiltis=nustatymai")
    expect(page.locator("[data-weather-toggle]")).to_have_count(0)

    # Žurnalas ir grąžinimas
    page.goto(base + "#/moderavimas/funkcijos")
    log = page.locator("[data-feature-log]")
    expect(log).to_contain_text("išjungė „Orai“")
    expect(log).to_contain_text("išjungė „Sekimas ir naujienos“")
    for key in ["social_follow", "leagues", "duels", "blank_trips", "weather"]:
        toggle(key, True)
    expect(page.locator("[data-feature-sum] .af-big")).to_have_text("18/18")
    page.goto(base + "#/dienorastis")
    expect(page.locator("[data-blank-open]")).to_be_visible()
    page.goto(base + "#/naujas")
    expect(page.locator("[data-format='duels']")).to_be_visible()
    step("administravimo panelė: jungikliai paslepia ir grąžina funkcijas, demo „serveris“ neleidžia, žurnalas")

    # Turnyrų kūrimas: išjungus savininkas vis tiek gali, kiti – ne
    page.goto(base + "#/moderavimas/funkcijos")
    toggle("tournament_create", False)
    page.goto(base + "#/")
    expect(page.locator(".l-new")).to_be_visible()
    roles = page.evaluate("""() => { const d = JSON.parse(localStorage.getItem('zt-demo-v1')); const me = window.__zt.state.user.id;
      const r = d.profiles[me].roles; d.profiles[me].roles = []; localStorage.setItem('zt-demo-v1', JSON.stringify(d)); return r; }""")
    page.reload()
    expect(page.get_by_role("heading", name="Turnyrai", level=1)).to_be_visible()
    expect(page.locator(".l-new")).to_have_count(0)
    page.goto(base + "#/naujas")
    expect(page.locator("[data-feature-off]")).to_contain_text("Turnyrų kūrimas šiuo metu išjungtas")
    page.goto(base + "#/profilis")
    expect(page.locator("[data-create-link]")).to_have_count(0)
    err = page.evaluate("""async () => { try { await window.__zt.backend.createTournament({ title: 'Bandymas', format: 'biggest', species_ids: [],
      starts_at: new Date(Date.now() + 864e5).toISOString(), ends_at: new Date(Date.now() + 2 * 864e5).toISOString(), visibility: 'private' }); return ''; }
      catch (e) { return e.message; } }""")
    assert "išjungta" in err, err
    page.evaluate("(r) => { const d = JSON.parse(localStorage.getItem('zt-demo-v1')); d.profiles[window.__zt.state.user.id].roles = r; localStorage.setItem('zt-demo-v1', JSON.stringify(d)); }", roles)
    page.reload()
    page.goto(base + "#/moderavimas/funkcijos")
    toggle("tournament_create", True)
    page.goto(base + "#/profilis")
    expect(page.locator("[data-create-link]")).to_be_visible()
    step("turnyrų kūrimo jungiklis: kitiems paslepia ir neleidžia, savininkui – leidžia")

    # Skelbimas visiems
    page.goto(base + "#/moderavimas/funkcijos")
    form = page.locator("[data-banner-form]")
    form.locator("textarea").fill("Šeštadienį 9–10 val. atnaujinimas")
    form.locator("[data-tone='warn']").click()
    form.get_by_role("button", name="Rodyti visiems").click()
    expect(page.locator("#toast")).to_have_text("Skelbimas rodomas visiems")
    shot(page, "admin-funkcijos")
    page.goto(base + "#/")
    bar = page.locator("[data-app-banner]")
    expect(bar).to_contain_text("Šeštadienį 9–10 val. atnaujinimas")
    expect(bar).to_have_class(re.compile("app-banner-warn"))
    shot(page, "admin-skelbimas")
    page.reload()  # išlieka ir paleidus iš naujo
    expect(page.locator("[data-app-banner]")).to_be_visible()
    page.get_by_role("button", name="Paslėpti skelbimą").click()
    expect(page.locator("[data-app-banner]")).to_have_count(0)
    page.reload()
    expect(page.locator("#app-banner")).to_be_hidden()
    # Naujas skelbimas vėl matomas net paslėpus seną
    page.goto(base + "#/moderavimas/funkcijos")
    page.locator("[data-banner-form] textarea").fill("Nauja: klubų lyga!")
    page.locator("[data-banner-form] [data-tone='info']").click()
    page.get_by_role("button", name="Atnaujinti").click()
    expect(page.locator("[data-app-banner]")).to_contain_text("Nauja: klubų lyga!")
    page.get_by_role("button", name="Nuimti").click()
    expect(page.locator("#toast")).to_have_text("Skelbimas nuimtas")
    expect(page.locator("[data-app-banner]")).to_have_count(0)
    expect(page.locator("[data-feature-log]")).to_contain_text("nuėmė skelbimą")
    step("skelbimas visiems: rodomas visur, galima paslėpti sau, naujas vėl matomas, nuimamas")


def custom_rules_demo_test(page, base):
    """Savos taškų taisyklės: kūrimas, keitimas, pasirinkimas turnyre, lentelė taškais, ištrynimas, tik organizatoriams."""
    page.goto(base + "#/profilis?skiltis=zvejyba")
    page.goto(base + "#/tasku-taisykles")
    expect(page.get_by_role("heading", name="Mano taškų taisyklės")).to_be_visible()
    expect(page.locator("[data-rule='rule-demo']")).to_contain_text("Kauno marių plėšrūnai")
    expect(page.locator("[data-rule='rule-demo']")).to_contain_text("Lydeka ×1,5 nuo 50 cm, daugiausia 2")

    # Kūrėjas
    page.locator("[data-rule-new]").click()
    rb = page.locator("[data-rules-builder]")
    expect(rb).to_be_visible()
    rb.locator("[data-rb-save]").click()
    expect(rb.locator("[data-rb-error]")).to_contain_text("Pavadinimas")
    rb.get_by_label("Pavadinimas").fill("Ešerių šventė")
    rb.locator("[data-rb-base='fish']").click()
    expect(rb.locator("[data-rb-all]")).to_contain_text("1 tšk. už žuvį")
    rb.locator("[data-rb-add-sp]").select_option(label="Ešerys")
    rb.locator("[data-sp-f='m']").first.fill("2")
    rb.locator("[data-sp-f='min_cm']").first.fill("15")
    rb.locator("[data-rb-add-b]").select_option("len_min")
    rb.locator("[data-b-f='cm']").fill("30")
    rb.locator("[data-b-f='add']").fill("+5")
    rb.locator("[data-rb-add-b]").select_option("time")
    rb.locator("[data-b-f='m']").fill("×1,5")
    rb.locator("[data-rb-agg='all']").click()
    rb.get_by_label("Lygiųjų taisyklė 1").select_option("most_fish")
    expect(rb.locator("[data-rb-preview]")).to_contain_text("Ešerys 40 cm → 7 tšk.")  # 2 + 5
    shot(page, "taisykles-kurimas")
    rb.locator("[data-b-f='add']").fill("abc")
    expect(rb.locator("[data-rb-preview]")).to_contain_text("Premija")
    rb.locator("[data-b-f='add']").fill("+5")
    rb.locator("[data-rb-save]").click()
    expect(page.locator("#toast")).to_have_text("Taisyklės išsaugotos")
    expect(page.locator("[data-rules-builder]")).to_have_count(0)
    card = page.locator("[data-rules-list] [data-rule]", has_text="Ešerių šventė")
    expect(card).to_contain_text("Kiekviena įskaitoma žuvis duoda rūšies taškų")
    expect(card).to_contain_text("Ešerys 2 tšk. nuo 15 cm")
    expect(card).to_contain_text("Pagauta 22–5 val.: ×1,5")
    expect(card).to_contain_text("Lygiosios: daugiau žuvų")
    # Keitimas
    card.locator("[data-rule-edit]").click()
    page.locator("[data-rules-builder]").get_by_label("Pavadinimas").fill("Ešerių šventė 2026")
    page.locator("[data-rules-builder] [data-rb-save]").click()
    expect(page.locator("[data-rules-list]")).to_contain_text("Ešerių šventė 2026")
    step("taškų taisyklės: kūrėjas (rūšys, premijos, sumavimas, lygiosios, pavyzdys), išsaugojimas, keitimas")

    # Turnyras su savomis taisyklėmis
    page.goto(base + "#/naujas")
    page.get_by_label("Pavadinimas").fill("Plėšrūnų taurė")
    page.locator("[data-format=custom]").click()
    expect(page.locator("[data-species-box]")).to_be_hidden()
    expect(page.locator("[data-min-box]")).to_be_hidden()
    page.locator("[data-submit]").click()
    expect(page.locator("[data-error]")).to_contain_text("Pasirink arba sukurk taškų taisykles")
    page.locator("[data-rule-pick='rule-demo']").click()
    expect(page.locator("[data-rule-desc]")).to_contain_text("Žuvis nuo 70 cm: +20 tšk.")
    shot(page, "taisykles-turnyras")
    page.locator("[data-submit]").click()
    expect(page.locator("#toast")).to_have_text("Turnyras sukurtas")
    expect(page.get_by_role("heading", name="Plėšrūnų taurė")).to_be_visible()
    page.locator("[data-tab=taisykles]").click()
    rl = page.locator("[data-scoring-rules]")
    expect(rl).to_contain_text("Žuvies taškai = ilgis cm × rūšies koeficientas")
    expect(rl).to_contain_text("Sumuojamos 5 geriausios žuvys")
    expect(page.locator("dl.list")).to_contain_text("Savos taškų taisyklės")
    tid = page.evaluate("() => location.hash.split('/')[2].split('?')[0]")
    t = page.evaluate(f"() => JSON.parse(localStorage.getItem('zt-demo-v1')).tournaments.find(t => t.id === '{tid}')")
    assert t["format"] == "custom" and t["scoring_rule_id"] == "rule-demo" and t["min_length_mm"] == 0, t
    page.goto(base + "#/tasku-taisykles")
    expect(page.locator("[data-rule='rule-demo'] .rb-tag")).to_have_text("Naudota 1 turnyre")

    # Vykstantis turnyras su savomis taisyklėmis: lentelė taškais
    page.evaluate("""() => { const d = JSON.parse(localStorage.getItem('zt-demo-v1')); const t = d.tournaments.find(x => x.id === 't-taure');
      t.format = 'custom'; t.scoring = { v: 1, base: 'cm', species: [], bonuses: [{ type: 'per_fish', add: 10 }], aggregate: { mode: 'best_n', n: 2 }, tiebreak: ['biggest_fish'] };
      localStorage.setItem('zt-demo-v1', JSON.stringify(d)); }""")
    page.reload()
    page.goto(base + "#/t/t-taure/lentele")
    expect(page.locator(".podium")).to_contain_text("tšk.")
    board = page.evaluate("async () => window.__zt.backend.leaderboard('t-taure')")
    top = board[0]
    assert top["score_mm"] > 0 and top["rank"] == 1, top
    step("turnyras su savomis taisyklėmis: pasirinkimas, aprašymas, kopija turnyre, lentelė taškais")

    # Prasidėjusio turnyro taisyklių keisti negalima
    err = page.evaluate("""async () => { try { await window.__zt.backend.updateTournament('t-taure', { scoring: { v: 1, base: 'fish', species: [], bonuses: [],
      aggregate: { mode: 'all', n: 1 }, tiebreak: [] } }); return ''; } catch (e) { return e.message; } }""")
    assert "taisykl" in err or "prasidėjo" in err, err

    # Ištrynimas – turnyras lieka su kopija
    page.goto(base + "#/tasku-taisykles")
    page.once("dialog", lambda d: d.accept())
    page.locator("[data-rule='rule-demo'] [data-rule-del]").click()
    expect(page.locator("#toast")).to_have_text("Taisyklės ištrintos")
    expect(page.locator("[data-rule='rule-demo']")).to_have_count(0)
    page.goto(base + f"#/t/{tid}?skiltis=taisykles")
    expect(page.locator("[data-scoring-rules]")).to_contain_text("Sumuojamos 5 geriausios žuvys")

    # Ne organizatorius: savų taisyklių nėra
    roles = page.evaluate("""() => { const d = JSON.parse(localStorage.getItem('zt-demo-v1')); const me = window.__zt.state.user.id;
      const r = d.profiles[me].roles; d.profiles[me].roles = []; localStorage.setItem('zt-demo-v1', JSON.stringify(d)); return r; }""")
    page.reload()
    page.goto(base + "#/naujas")
    expect(page.locator("[data-format=biggest]")).to_be_visible()
    expect(page.locator("[data-format=custom]")).to_have_count(0)
    page.goto(base + "#/tasku-taisykles")
    expect(page.get_by_text("Savas taisykles kuria organizatoriai")).to_be_visible()
    err = page.evaluate("""async () => { try { await window.__zt.backend.saveScoringRule({ name: 'Bandymas', rules: { v: 1, base: 'cm', species: [], bonuses: [],
      aggregate: { mode: 'all', n: 1 }, tiebreak: [] } }); return ''; } catch (e) { return e.message; } }""")
    assert "organizatoriai" in err, err
    page.evaluate("(r) => { const d = JSON.parse(localStorage.getItem('zt-demo-v1')); d.profiles[window.__zt.state.user.id].roles = r; localStorage.setItem('zt-demo-v1', JSON.stringify(d)); }", roles)
    page.reload()
    step("taisyklių ištrynimas (turnyras lieka su kopija), užraktas po starto, tik organizatoriams")


def forecast_route(route):
    import time
    now = int(time.time())
    hours = [now - 6 * 3600 + i * 3600 for i in range(36)]
    body = {"hourly": {"time": hours, "temperature_2m": [8.2] * 36, "surface_pressure": [1014 - i * 0.4 for i in range(36)],
                       "wind_speed_10m": [3.1] * 36, "wind_direction_10m": [225] * 36, "weather_code": [3] * 36},
            "daily": {"sunrise": [now - 3 * 3600], "sunset": [now + 6 * 3600]}}
    route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps(body))


def diary_plus_demo_test(page, base):
    """Dienoraštis: prognozė, sezonas, skiltys (kolekcija, įžvalgos, tikslai), išvyka su laimikiais."""
    fc_re = re.compile(r"https://api\.open-meteo\.com/.*hourly=.*")
    page.route(fc_re, forecast_route)
    page.evaluate("() => { localStorage.removeItem('zt-fc-loc'); localStorage.removeItem('zt-forecast'); sessionStorage.removeItem('zt-dtab'); }")
    page.goto(base + "#/dienorastis")
    fc = page.locator("[data-forecast]")
    expect(fc).to_contain_text("Kibimo prognozė tavo vietoje")
    fc.get_by_role("button", name="Rodyti prognozę").click()
    expect(fc.locator("[data-fc-label]")).to_contain_text("Kibimas –")
    expect(fc).to_contain_text("8°")
    expect(fc).to_contain_text("PV vėjas")
    expect(fc).to_contain_text("Geriausias laikas")
    loc = page.evaluate("() => JSON.parse(localStorage.getItem('zt-fc-loc'))")
    assert loc == {"lat": 54.9, "lng": 23.9}, loc
    expect(page.locator("[data-stat='days']")).to_be_visible()
    shot(page, "dienorastis-prognoze")
    step("dienoraštis: kibimo prognozė (vieta tik telefone, suapvalinta), sezono santrauka")

    # Kolekcija
    page.get_by_role("tab", name="Kolekcija").click()
    album = page.locator("[data-album]")
    expect(album).to_be_visible()
    caught = page.evaluate("""() => { const me = window.__zt.state.user.id; const d = JSON.parse(localStorage.getItem('zt-demo-v1'));
      return new Set(d.catches.filter(c => c.user_id === me && c.status !== 'rejected').map(c => c.species_id)).size; }""")
    expect(album.locator("a.alb-t")).to_have_count(caught)
    expect(album.locator(".alb-lk").first).to_contain_text("dar nepagauta")
    expect(page.locator("[data-collection]")).to_contain_text(f"{caught} / ")
    expect(page.locator("[data-diary-badges] .chip").first).to_be_visible()
    shot(page, "dienorastis-kolekcija")
    # Įžvalgos
    page.get_by_role("tab", name="Įžvalgos").click()
    expect(page.locator("[data-insight='daypart']")).to_contain_text("pagauta")
    expect(page.locator("[data-insight='days'] .hm i")).to_have_count(84)
    expect(page.locator("[data-insight='baits']")).to_be_visible()
    shot(page, "dienorastis-izvalgos")
    step("dienoraštis: rūšių kolekcija ir ženkleliai, įžvalgos (paros laikas, masalai, orai, žvejybos dienos)")

    # Tikslai
    page.get_by_role("tab", name="Tikslai").click()
    expect(page).to_have_url(re.compile(r"skiltis=tikslai"))
    expect(page.locator("[data-goals-empty]")).to_be_visible()
    page.locator("[data-goal-kind='length']").click()
    form = page.locator("[data-goal-form]")
    form.get_by_label("Rūšis").select_option(label="Lydeka")
    form.get_by_label("Ilgis nuo, cm").fill("80")
    form.get_by_role("button", name="Išsaugoti tikslą").click()
    expect(page.locator("#toast")).to_have_text("Tikslas išsaugotas")
    goal = page.locator("[data-goal]", has_text="Lydeka ≥ 80 cm šį sezoną")
    expect(goal).to_be_visible()
    page.locator("[data-goal-kind='count']").click()
    page.locator("[data-goal-form]").get_by_label("Kiek laimikių").fill("abc")
    page.locator("[data-goal-form]").get_by_role("button", name="Išsaugoti tikslą").click()
    expect(page.locator("#toast")).to_have_text("Įrašyk sveiką skaičių")
    page.locator("[data-goal-form]").get_by_label("Kiek laimikių").fill("1000")
    page.locator("[data-goal-form]").get_by_role("button", name="Šį sezoną").click()
    page.locator("[data-goal-form]").get_by_role("button", name="Išsaugoti tikslą").click()
    expect(page.locator("[data-goal]", has_text="1000 laimikių šį sezoną")).to_contain_text("iš 1000")
    page.reload()
    expect(page.get_by_role("tab", name="Tikslai")).to_have_attribute("aria-selected", "true")
    expect(page.locator("[data-goal]")).to_have_count(2)
    shot(page, "dienorastis-tikslai")
    page.locator("[data-goal]", has_text="1000 laimikių").get_by_role("button", name=re.compile("Ištrinti tikslą")).click()
    expect(page.locator("[data-goal]")).to_have_count(1)
    step("dienoraštis: tikslai su pažanga, išsaugojimas, ištrynimas, skiltis išlieka")

    # Išvyka tą dieną, kai pagauta žuvis – laimikiai priskiriami
    day = page.evaluate("""() => { const me = window.__zt.state.user.id; const d = JSON.parse(localStorage.getItem('zt-demo-v1'));
      const c = d.catches.filter(c => c.user_id === me && c.status !== 'rejected').sort((a, b) => a.captured_at_device < b.captured_at_device ? 1 : -1)[0];
      const x = new Date(c.captured_at_device); const p = (n) => String(n).padStart(2, '0'); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`; }""")
    page.get_by_role("tab", name="Laimikiai").click()
    page.get_by_role("button", name="Išvyka").click()
    bf = page.locator("[data-blank-form]")
    bf.get_by_label("Data").fill(day)
    bf.get_by_label("Vieta (nebūtina)").fill("Kauno marios")
    bf.get_by_label("Kiek valandų").fill("4")
    bf.get_by_role("button", name="Išsaugoti").click()
    expect(page.locator("#toast")).to_have_text("Išvyka išsaugota")
    expect(page.locator(".trip-card.trip-ok")).to_contain_text("Išvyka: Kauno marios · 4 val.")
    expect(page.locator(".trip-card.trip-ok")).to_contain_text("laimik")
    page.get_by_role("button", name="Ištrinti išvyką").click()
    page.unroute(fc_re, forecast_route)
    step("išvyka su vieta: tos dienos laimikiai priskiriami automatiškai")


def map_demo_test(page, base):
    page.goto(base + "#/profilis?skiltis=zvejyba")
    page.get_by_role("link", name="Žemėlapis").click()
    expect(page.get_by_role("heading", name="Mano laimikių žemėlapis")).to_be_attached()
    expect(page.get_by_text("Šį žemėlapį matai tik tu.")).to_be_visible()
    page.wait_for_function("() => window.__mlLog && window.__mlLog.features > 0")
    expect(page.locator("[data-map-wrap]")).to_have_attribute("data-engine", "maplibre")
    # Tikras MapLibre prideda klasę „maplibregl-map“ (position: relative) – žemėlapio aukštis neturi tapti 0.
    page.wait_for_function("() => [...document.styleSheets].some((s) => (s.href || '').includes('maplibre-gl.css'))")
    h = page.evaluate("() => { const b = document.querySelector('[data-map]'); b.classList.add('maplibregl-map'); const h = b.clientHeight; b.classList.remove('maplibregl-map'); return h; }")
    assert h > 300, f"žemėlapio aukštis su MapLibre stiliumi: {h}"
    log = page.evaluate("() => window.__mlLog")
    assert log["maps"] == 1 and log["style"]["name"] == "fake-dark", log["style"]
    assert {"clusters", "cluster-count", "points", "heat"} <= set(log["layers"]), log["layers"]
    assert log["fit"] or log["fly"], "žemėlapis turi priartėti prie taškų"
    total = log["features"]
    expect(page.locator("[data-map-count]")).to_contain_text("Rodoma:")
    sheet = page.locator("[data-sheet]")
    expect(sheet).to_contain_text("Mano geriausios vietos")
    expect(sheet.locator("[data-spot]").first).to_be_visible()
    # Rūšies filtras
    chip = page.locator("[data-sp]").nth(1)
    chip.click()
    expect(chip).to_have_attribute("aria-pressed", "true")
    assert 0 < page.evaluate("() => window.__mlLog.features") <= total
    page.locator("[data-sp=all]").click()
    assert page.evaluate("() => window.__mlLog.features") == total
    # Paros laikas ir laikotarpis
    page.locator("[data-daypart]").select_option("night")
    page.locator("[data-daypart]").select_option("all")
    page.locator("[data-period]").select_option("30d")
    assert page.evaluate("() => window.__mlLog.features") <= total
    page.locator("[data-period]").select_option("all")
    # Šiluma
    page.get_by_role("button", name="Šiluma").click()
    vis = page.evaluate("() => window.__mlLog.vis")
    assert vis["heat"] == "visible" and vis["points"] == "none", vis
    page.get_by_role("button", name="Taškai").click()
    assert page.evaluate("() => window.__mlLog.vis.points") == "visible"
    # Paspaustas taškas – kortelė su laimikiu
    cid = page.evaluate("() => window.__mlLog.ids[0]")
    if True:
        page.evaluate("(id) => window.__mlLog.fire('click', 'points', { features: [{ properties: { id } }] })", cid)
        expect(sheet.locator(f"a[href='#/l/{cid}']")).to_be_visible()
        assert "mp-pulse" in page.evaluate("() => window.__mlLog.markers")
        shot(page, "18-zemelapis-laimikis")
        sheet.get_by_role("button", name="Uždaryti").click()
    expect(sheet).to_contain_text("Mano geriausios vietos")
    fly_before = len(page.evaluate("() => window.__mlLog.fly"))
    sheet.locator("[data-spot]").first.click()
    assert len(page.evaluate("() => window.__mlLog.fly")) > fly_before, "paspaudus vietą žemėlapis turi nuskristi"
    expect(sheet.get_by_role("link", name="Atidaryti laimikį ›").first).to_be_attached()
    # Sezono atkūrimas
    page.get_by_role("button", name="Sezono atkūrimas").click()
    expect(page.locator("[data-replay-bar]")).to_be_visible()
    page.wait_for_function("() => document.querySelector('[data-replay-date]').textContent.length > 0")
    page.get_by_role("button", name="Baigti atkūrimą").click()
    expect(page.locator("[data-replay-bar]")).to_be_hidden()
    assert page.evaluate("() => window.__mlLog.features") == total
    shot(page, "18-zemelapis")
    page.get_by_text("Saugoti vietas mano žemėlapiui ilgiau nei 90 d.").click()
    expect(page.locator("#toast")).to_contain_text("Vietos bus saugomos")
    assert page.evaluate("() => JSON.parse(localStorage.getItem('zt-demo-v1')).keepSpots") is True
    page.goto(base + "#/")
    page.wait_for_function("() => window.__mlLog.removed === 1")
    step("naujas žemėlapis: burbulai, filtrai, šiluma, laimikio kortelė, geriausios vietos, sezono atkūrimas")

    # Atsarginis žemėlapis, kai vektorinis neįsikelia
    page.unroute(re.compile(r"https://(cdn\.jsdelivr\.net/npm|unpkg\.com)/maplibre-gl@.*"))
    page.route(re.compile(r"https://(cdn\.jsdelivr\.net/npm|unpkg\.com)/maplibre-gl@.*"), maplibre_fail)
    page.evaluate("() => { delete window.maplibregl; }")
    page.goto(base + "#/zemelapis")
    page.reload()
    page.wait_for_function("() => window.__leafletLog && window.__leafletLog.markers.length > 0")
    expect(page.locator("[data-map-wrap]")).to_have_attribute("data-engine", "leaflet")
    assert any(">2<" in (m.get("bubble") or "") or ">3<" in (m.get("bubble") or "") for m in page.evaluate("() => window.__leafletLog.markers")), "kelios žuvys vienoje vietoje – burbulas su skaičiumi"
    expect(page.locator("[data-mode-seg]")).to_be_hidden()
    expect(page.locator("[data-sheet]")).to_contain_text("Mano geriausios vietos")
    page.goto(base + "#/")
    page.unroute(re.compile(r"https://(cdn\.jsdelivr\.net/npm|unpkg\.com)/maplibre-gl@.*"))
    page.route(re.compile(r"https://(cdn\.jsdelivr\.net/npm|unpkg\.com)/maplibre-gl@.*"), maplibre_route)
    step("žemėlapis: neįsikėlus vektoriniam – atsarginis (Leaflet)")


def extra_demo_tests(page, base, meteo_calls):
    """Ginčai, moderatoriai, privatūs turnyrai, redagavimas, prizai, ekranas, ženkliukai, eksportas, ištrynimas."""
    accept_dialogs = lambda d: d.accept()
    page.on("dialog", accept_dialogs)

    # Ginčas dėl atmesto laimikio
    page.goto(base + "#/dienorastis")
    rejected = page.locator("[data-catch]", has_text="Netikslus ilgis")
    rejected.get_by_role("button", name="Nesutinku su sprendimu").click()
    rejected.get_by_label("Kodėl laimikis turėtų būti įskaitytas?").fill("Liniuotė matosi <script>window.__xss=1</script>")
    rejected.get_by_role("button", name="Pateikti moderatoriui").click()
    expect(page.locator("#toast")).to_have_text("Ginčas pateiktas moderatoriui")
    open_diary(page)
    expect(page.locator("[data-catch]", has_text="Netikslus ilgis")).to_contain_text("Ginčas peržiūrimas")
    expect(page.locator("[data-catch]", has_text="Netikslus ilgis").get_by_role("button", name="Nesutinku su sprendimu")).to_have_count(0)
    dup = page.evaluate("""async () => { const b = window.__zt.backend;
        const c = (await b.myCatches()).find(x => x.status === 'rejected');
        return b.openDispute(c.id, 'dar kartą').then(() => 'ok', e => e.message); }""")
    assert dup == "Ginčas dėl šio laimikio jau pateiktas", dup
    page.goto(base + "#/moderavimas/gincai")
    expect(page.locator(".quote")).to_have_text("Liniuotė matosi <script>window.__xss=1</script>")
    shot(page, "12-gincai")
    page.get_by_label("Atsakymas dalyviui").fill("Atsiprašome, ilgis teisingas")
    page.get_by_role("button", name="Įskaityti").click()
    expect(page.locator("#toast")).to_have_text("Laimikis įskaitytas")
    expect(page.get_by_text("Ginčų nėra")).to_be_visible()
    page.goto(base + "#/dienorastis")
    open_diary(page)
    card = page.locator("[data-catch]", has_text="Ginčas patenkintas")
    expect(card).not_to_contain_text("Atmesta")
    expect(card).to_contain_text("Atsiprašome, ilgis teisingas")
    step("ginčas: dalyvis pateikia, moderatorius įskaito")

    # Komanda ir rolės
    page.goto(base + "#/moderavimas/komanda")
    expect(page.locator(".team-card", has_text="(tu)")).to_contain_text("Savininkas")
    page.get_by_label("Žvejo slapyvardis").fill("nėra_tokio")
    page.get_by_role("button", name="Suteikti rolę").click()
    expect(page.locator("#toast")).to_have_text("Tokio slapyvardžio nėra")
    page.get_by_label("Žvejo slapyvardis").fill("lydekininkas")
    page.get_by_label("Rolė").select_option(label="Ginčų teisėjas")
    page.get_by_role("button", name="Suteikti rolę").click()
    expect(page.locator("#toast")).to_have_text("lydekininkas: suteikta rolė „Ginčų teisėjas“")
    card = page.locator(".team-card", has_text="Lydekininkas")
    expect(card.get_by_label("Ginčų teisėjas")).to_be_checked()
    card.get_by_label("Laimikių tikrintojas").check()
    expect(page.locator("#toast")).to_have_text("Lydekininkas: suteikta rolė „Laimikių tikrintojas“")
    card = page.locator(".team-card", has_text="Lydekininkas")
    card.get_by_label("Ginčų teisėjas").uncheck()
    expect(page.locator("#toast")).to_have_text("Lydekininkas: atimta rolė „Ginčų teisėjas“")
    page.locator(".team-card", has_text="Lydekininkas").get_by_label("Laimikių tikrintojas").click()  # paskutinė rolė – kortelė dingsta
    expect(page.locator(".team-card", has_text="Lydekininkas")).to_have_count(0)
    res = page.evaluate("() => window.__zt.backend.setRole(window.__zt.state.profile.nickname, 'admin', false).then(() => 'ok', e => e.message)")
    assert res == "Savininko rolių keisti negalima", res
    step("komanda: rolių suteikimas ir atėmimas, savininko apsauga")

    # Privatus turnyras su paslėpta lentele, prizais ir rėmėju
    page.goto(base + "#/naujas")
    page.get_by_label("Pavadinimas", exact=True).fill("Klubo taurė")
    page.get_by_role("button", name="Tik su kvietimu").click()
    page.get_by_text("Slėpti lentelę iki pabaigos").click()
    page.get_by_label("Registracija po starto").select_option(label="3 val. po starto")
    page.get_by_label("Daiktiniai prizai (nebūtina)").fill("1 vieta – <img src=x onerror=window.__xss=1>\n2 vieta – ritė")

    # Prizinis fondas: suma, padalijimas, savas padalijimas su klaida
    expect(page.locator("[data-split-wrap]")).to_be_hidden()
    page.get_by_label("Fondo suma, €").fill("1 000")
    expect(page.locator("[data-split-wrap]")).to_be_visible()
    expect(page.locator("[data-amount='0']")).to_have_text("500 €")  # numatyta 50/30/20
    page.get_by_role("button", name="Penkiems: 40 / 25 / 15 / 12 / 8").click()
    expect(page.locator(".split-row")).to_have_count(5)
    expect(page.locator("[data-amount='4']")).to_have_text("80 €")
    page.get_by_role("button", name="Pašalinti 5 vietą").click()
    expect(page.locator("[data-split-msg]")).to_have_text("Procentų suma turi būti 100 (dabar 92)")
    page.get_by_role("button", name="Sukurti turnyrą").click()
    expect(page.locator("[data-error]")).to_have_text("Prizinis fondas: procentų suma turi būti 100 (dabar 92).")
    page.get_by_label("4 vietos procentas").fill("20")
    expect(page.locator("[data-split-msg]")).to_have_text("Aukštesnė vieta negali gauti mažiau nei žemesnė")
    page.get_by_label("4 vietos procentas").fill("12")
    page.get_by_label("2 vietos procentas").fill("33")
    expect(page.locator("[data-split-msg]")).to_contain_text("Viso 100 %")
    expect(page.locator("[data-amount='1']")).to_have_text("330 €")
    page.get_by_label("1 vietos procentas").fill("10")
    expect(page.locator("[data-split-msg]")).to_contain_text("dabar 70")
    page.get_by_role("button", name="Trims: 50 / 30 / 20").click()
    expect(page.locator("[data-amount='1']")).to_have_text("300 €")

    # Du rėmėjai: neleistina nuoroda atmetama, įnašų suma rodoma
    page.get_by_role("button", name="Pridėti rėmėją").click()
    page.get_by_label("Rėmėjo 1 pavadinimas").fill("Ežero parduotuvė")
    page.get_by_label("Rėmėjo 1 svetainė").fill("javascript:alert(1)")
    page.get_by_label("Rėmėjo 1 įnašas, €").fill("600")
    page.get_by_role("button", name="Pridėti rėmėją").click()
    page.get_by_label("Rėmėjo 2 pavadinimas").fill('<b onmouseover="window.__xss=1">Klubas</b>')
    page.get_by_label("Rėmėjo 2 įnašas, €").fill("400")
    expect(page.locator("[data-sponsor-sum-text]")).to_have_text("Rėmėjų įnašai: 1 000 € iš 1 000 € fondo")
    expect(page.get_by_role("button", name="Naudoti kaip fondą")).to_be_hidden()
    page.get_by_role("button", name="Sukurti turnyrą").click()
    expect(page.locator("[data-error]")).to_have_text("Rėmėjas 1: svetainė turi prasidėti https://")
    page.get_by_label("Rėmėjo 1 svetainė").fill("https://example.com/zvejyba")
    shot(page, "13a-prizinis-fondas")
    page.get_by_role("button", name="Sukurti turnyrą").click()
    expect(page.get_by_role("heading", name="Klubo taurė")).to_be_visible()
    expect(page.locator(".badge", has_text="Privatus")).to_be_visible()
    expect(page.locator(".prewrap")).to_contain_text("<img src=x onerror=window.__xss=1>")
    expect(page.locator("[data-fund]")).to_have_text("1 000 €")
    prize_rows = page.locator(".prize-card .list-row")
    expect(prize_rows).to_have_count(3)
    expect(prize_rows.nth(0)).to_contain_text("50 %")
    expect(prize_rows.nth(0)).to_contain_text("500 €")
    expect(prize_rows.nth(2)).to_contain_text("200 €")
    page.locator("[data-tab=prizai]").click()  # prizai ir rėmėjai – savo skiltyje
    sponsor = page.locator(".sponsor-list").get_by_role("link", name="Ežero parduotuvė")
    expect(sponsor).to_have_attribute("href", "https://example.com/zvejyba")
    expect(sponsor).to_have_attribute("rel", "noopener noreferrer sponsored")
    expect(page.locator(".sponsor-list .list-row").nth(1)).to_contain_text('<b onmouseover="window.__xss=1">Klubas</b>')
    expect(page.locator("dl", has_text="Lentelė")).to_contain_text("Paslėpta iki pabaigos")
    expect(page.locator(".list-row", has_text="Registracija")).to_contain_text("Iki ")
    page.locator("[data-tab=apzvalga]").click()
    expect(page.get_by_role("button", name="Kviesti draugus")).to_be_visible()
    shot(page, "13-privatus")
    tid = page.evaluate("() => location.hash.split('/')[2]")
    code = page.evaluate("(id) => JSON.parse(localStorage.getItem('zt-demo-v1')).tournaments.find(t => t.id === id).invite_code", tid)
    assert re.fullmatch(r"[0-9a-f]{10}", code), code
    step("privatus turnyras su prizinu fondu, padalijimu, dviem rėmėjais ir paslėpta lentele")

    # Redagavimas ir ištrynimas iki starto
    page.get_by_role("link", name="Redaguoti").click()
    expect(page.get_by_label("Pavadinimas", exact=True)).to_have_value("Klubo taurė")
    expect(page.get_by_role("button", name="Tik su kvietimu")).to_have_attribute("aria-pressed", "true")
    expect(page.locator("[name=leaderboard_hidden]")).to_be_checked()
    expect(page.get_by_label("Registracija po starto")).to_have_value("180")
    page.get_by_label("Registracija po starto").select_option(label="Tik iki starto")
    expect(page.get_by_label("Fondo suma, €")).to_have_value("1000")
    # Esamo turnyro rėmėjai tvarkomi atskiroje skiltyje (su logotipais) – formoje tik nuoroda
    expect(page.locator("[data-sponsors-link]")).to_contain_text("2 rėmėjai")
    expect(page.get_by_label("Rėmėjo 2 įnašas, €")).to_be_hidden()
    page.get_by_label("Fondo suma, €").fill("600")
    page.get_by_role("button", name="Tik nugalėtojui").click()
    page.get_by_label("Pavadinimas", exact=True).fill("Klubo taurė 2026")
    page.get_by_role("button", name="Visi").click()
    page.get_by_role("button", name="Išsaugoti pakeitimus").click()
    expect(page.locator("#toast")).to_have_text("Pakeitimai išsaugoti")
    expect(page.get_by_role("heading", name="Klubo taurė 2026")).to_be_visible()
    expect(page.locator(".badge", has_text="Privatus")).to_have_count(0)
    expect(page.locator("[data-fund]")).to_have_text("600 €")
    expect(page.locator(".prize-card .list-row")).to_have_count(1)
    expect(page.locator(".sponsor-list .list-row")).to_have_count(2)
    page.locator("[data-sponsors-manage]").click()
    page.locator("[data-remove='1']").click()
    page.get_by_role("button", name="Išsaugoti rėmėjus").click()
    expect(page.locator("#toast")).to_have_text("Rėmėjai išsaugoti")
    expect(page.locator(".sponsor-list .list-row")).to_have_count(1)
    expect(page.locator(".list-row", has_text="Registracija")).to_contain_text("Tik iki starto")
    stored = page.evaluate("() => JSON.parse(localStorage.getItem('zt-demo-v1')).tournaments.find(t => t.title === 'Klubo taurė 2026').late_join_minutes")
    assert stored == 0, stored
    page.get_by_role("link", name="Redaguoti").click()
    page.get_by_role("button", name="Ištrinti turnyrą").click()
    expect(page.locator("#toast")).to_have_text("Turnyras ištrintas")
    assert page.evaluate("(id) => JSON.parse(localStorage.getItem('zt-demo-v1')).tournaments.some(t => t.id === id)", tid) is False
    # Demo žvejys – savininkas: svetimą vykstantį turnyrą gali tvarkyti tik kaip administratorius (taisyklės užrakintos)
    page.goto(base + "#/t/t-taure/redaguoti")
    expect(page.locator("[data-admin-note]")).to_contain_text("Redaguoji kaip administratorius")
    step("turnyro redagavimas ir ištrynimas iki starto, prasidėjusio – ne")

    # Kvietimai
    scode = page.evaluate("() => JSON.parse(localStorage.getItem('zt-demo-v1')).tournaments.find(t => t.id === 't-slaptas').invite_code")
    page.goto(base + f"#/kvietimas/{scode}")
    expect(page.get_by_role("heading", name="Draugų iššūkis")).to_be_visible()  # jau dalyvauji -> iškart turnyras
    page.goto(base + "#/kvietimas/0000000000")
    expect(page.get_by_text("Kvietimas negalioja")).to_be_visible()
    page.goto(base + "#/kvietimas/%3Cscript%3E")  # ne kodas -> maršrutas nepriima, grįžtama į pradžią
    expect(page.get_by_role("heading", name="Turnyrai", level=1)).to_be_visible()
    page.goto(base + "#/kvietimas/zzzzzz")  # ne šešioliktainis -> serveris net neklausiamas
    expect(page.get_by_text("Kvietimas negalioja")).to_be_visible()
    step("kvietimo nuoroda: galiojanti ir negaliojanti")

    # Baigęsis turnyras: nugalėtojai, ekrano režimas
    page.goto(base + "#/t/t-plesrunai?skiltis=apzvalga")
    expect(page.locator(".winners li")).to_have_count(3)
    expect(page.locator(".winners li").nth(0)).to_contain_text("60 €")
    expect(page.locator(".winners li").nth(1)).to_contain_text("40 €")
    expect(page.locator(".winners li").nth(2).locator(".prize-amt")).to_have_count(0)
    expect(page.locator(".winners")).to_contain_text("🥇")
    page.goto(base + "#/t/t-taure")
    expect(page.locator(".winners")).to_have_count(0)
    page.locator("[data-tab=lentele]").click()
    page.get_by_role("link", name="Rodyti dideliame ekrane").click()
    expect(page.locator(".tv-row")).to_have_count(10)
    expect(page.locator(".tv-row.r1")).to_contain_text("Ąžuolas_K")
    expect(page.locator("#nav")).to_be_hidden()
    shot(page, "14-ekranas")
    page.set_viewport_size({"width": 1280, "height": 720})
    shot(page, "14b-ekranas-platus")
    page.set_viewport_size({"width": 390, "height": 844})
    step("nugalėtojai ir didelio ekrano režimas")

    # Ženkliukai, puslapiai, eksportas
    page.goto(base + "#/profilis?skiltis=zvejyba")
    expect(page.locator("#badge-grid")).to_be_hidden()
    page.locator("[data-badges-open]").click()
    expect(page.locator(".badge-tile")).to_have_count(10)
    grid = page.locator(".badges").bounding_box()
    head = page.locator("h2", has_text="Ženkliukai").bounding_box()
    first = page.locator(".badge-tile").first.bounding_box()
    assert abs(grid["x"] - head["x"]) < 1 and abs(first["x"] - head["x"]) < 1, (grid, head, first)
    vw = page.viewport_size["width"]
    right_gap = vw - (grid["x"] + grid["width"])
    assert abs(right_gap - head["x"]) < 2, f"ženkliukai necentruoti: kairėje {head['x']}, dešinėje {right_gap}"
    assert page.locator(".badge-tile.earned").count() >= 2
    page.locator("[data-ptab=nustatymai]").click()
    page.get_by_role("link", name="Turnyrų taisyklės").click()
    expect(page.get_by_role("heading", name="Turnyrų taisyklės")).to_be_visible()
    page.get_by_role("button", name="Atgal").click()
    page.get_by_role("link", name="Privatumo politika").click()
    expect(page.get_by_role("heading", name="Privatumo politika")).to_be_visible()
    expect(page.locator(".prose")).to_contain_text("90 dienų")
    page.goto(base + "#/profilis?skiltis=nustatymai")
    with page.expect_download() as dl:
        page.get_by_role("button", name="Atsisiųsti mano duomenis").click()
    data = json.loads(pathlib.Path(dl.value.path()).read_text())
    assert dl.value.suggested_filename.startswith("zvejybos-turnyrai-") and dl.value.suggested_filename.endswith(".json")
    assert data["profile"]["nickname"] == "Testas_1", data["profile"]
    assert any(c.get("bait") == "Guminukas" for c in data["catches"])
    assert any(c.get("catch_locations") for c in data["catches"]), "eksporte turi būti vietos"
    assert len(data["disputes"]) == 1
    step("ženkliukai, taisyklės, privatumo politika, duomenų eksportas")

    community_demo_tests(page, base)

    # Oras išjungiamas
    page.goto(base + "#/profilis?skiltis=nustatymai")
    page.get_by_text("Oras prie laimikio").click()
    assert page.evaluate("() => localStorage.getItem('zt-weather')") == "off"
    n = len(meteo_calls)
    page.goto(base + "#/laimikis")
    page.get_by_role("button", name="Fotografuoti").click()
    expect(page.locator("[data-step=details]")).to_be_visible()
    page.wait_for_timeout(500)
    assert len(meteo_calls) == n, "oras išjungtas, bet užklausa siųsta"
    page.get_by_role("button", name="Uždaryti").click()
    step("oro užklausų išjungimas")

    # Paskyros ištrynimas
    page.goto(base + "#/profilis?skiltis=nustatymai")
    page.get_by_role("button", name="Ištrinti paskyrą").first.click()
    page.get_by_label("Patvirtinimui įrašyk IŠTRINTI").fill("taip")
    page.locator("[data-delete-confirm]").click()
    expect(page.locator("[data-delete-status]")).to_have_text("Įrašyk žodį IŠTRINTI.")
    page.get_by_label("Patvirtinimui įrašyk IŠTRINTI").fill("ištrinti")
    page.locator("[data-delete-confirm]").click()
    expect(page.locator("#toast")).to_have_text("Demo paskyra ištrinta ir sukurta iš naujo")
    expect(page.get_by_role("heading", name="Turnyrai", level=1)).to_be_visible()
    assert page.evaluate("() => window.__xss") is None, "XSS: kodas įvykdytas!"
    page.remove_listener("dialog", accept_dialogs)
    step("paskyros ištrynimas su patvirtinimu; XSS niekur neįvykdytas")


def main():
    httpd, base = serve()
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(args=[
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
        ])
        ctx = browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True,
            geolocation={"latitude": 54.9, "longitude": 23.9, "accuracy": 8},
            permissions=["geolocation", "camera"],
            service_workers="block",
            locale="lt-LT",
            timezone_id="Europe/Vilnius",
        )
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: m.type == "error"
                and not re.search(r"fonts\.(googleapis|gstatic)|maplibre-gl@", (m.location or {}).get("url", ""))
                and errors.append(f"console: {m.text} @ {(m.location or {}).get('url', '')}"))
        page.route(re.compile(r"https://fonts\.(googleapis|gstatic)\.com/.*"), lambda r: r.abort())
        meteo_calls = []
        page.route(METEO, lambda r: (meteo_calls.append(r.request.url), fake_meteo(r)))
        page.route(re.compile(r"https://(cdn\.jsdelivr\.net/npm|unpkg\.com)/leaflet@.*"), leaflet_route)
        page.route(re.compile(r"https://(cdn\.jsdelivr\.net/npm|unpkg\.com)/maplibre-gl@.*"), maplibre_route)
        page.route(re.compile(r"https://tiles\.openfreemap\.org/styles/.*"), ofm_style_route)
        page.add_init_script("window.__assumeWebgl = true;")
        expect.set_options(timeout=8000)

        # 1. Turnyrų sąrašas
        page.goto(base)
        expect(page.get_by_role("heading", name="Turnyrai", level=1)).to_be_visible()
        assert page.evaluate("() => document.documentElement.dataset.theme") == "dark", "numatyta tema turi būti tamsi"
        expect(page.locator(".demo-note")).to_be_visible()
        page.get_by_role("button", name=re.compile("^Vyksta")).click()
        expect(page.locator(".t-card", has_text="Rudens lydekų taurė")).to_be_visible()
        shot(page, "01-turnyrai")
        step("turnyrų sąrašas ir filtrai")

        # 2. Registracija į turnyrą
        page.locator(".t-card", has_text="Rudens lydekų taurė").click()
        expect(page.get_by_role("heading", name="Rudens lydekų taurė")).to_be_visible()
        expect(page.locator("#nav")).to_be_visible()  # meniu matomas ir ekranuose su veiksmo mygtuku
        btn = page.get_by_role("button", name="Dalyvauti").bounding_box()
        fab = page.locator(".fab").bounding_box()
        assert btn["y"] + btn["height"] <= fab["y"], f"veiksmo mygtukas užlipa ant + mygtuko: {btn} {fab}"
        page.get_by_role("button", name="Dalyvauti").click()
        expect(page.locator("#toast")).to_have_text("Užsiregistravai į turnyrą")
        expect(page.get_by_role("link", name="Registruoti laimikį")).to_be_visible()
        shot(page, "02-turnyras")
        step("registracija į turnyrą")

        # 3. Laimikio registracija: kamera, GPS, liniuotė, rūšis
        page.get_by_role("link", name="Registruoti laimikį").click()
        shutter = page.get_by_role("button", name="Fotografuoti")
        expect(shutter).to_be_enabled()
        expect(page.locator("[data-gps]")).to_contain_text("GPS ±8 m")
        shot(page, "03-kamera")
        shutter.click()
        expect(page.locator("[data-step=details]")).to_be_visible()
        expect(page.locator("[data-len]")).to_have_text("50")

        ruler = page.locator("[data-ruler]")
        box = ruler.bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx - 140, cy, steps=6)
        page.mouse.move(cx - 420, cy, steps=12)
        page.mouse.up()
        expect(page.locator("[data-len]")).to_have_text("80")
        page.get_by_role("button", name="Sumažinti 1 cm").click()
        page.get_by_role("button", name="Padidinti 1 cm").click()
        page.get_by_role("button", name="Padidinti 1 cm").click()
        expect(page.locator("[data-len]")).to_have_text("81")
        step("liniuotė ir +/- mygtukai")

        # Pirmoji – dažniausiai tavo gaudoma rūšis
        expect(page.locator("[data-sp]").first).to_have_attribute("aria-pressed", "true")
        page.get_by_role("button", name="Lydeka").click()
        expect(page.get_by_role("button", name="Lydeka")).to_have_attribute("aria-pressed", "true")
        imp = page.locator("[data-impact]")
        expect(imp).to_contain_text("Naujas asmeninis rekordas")
        expect(imp).to_contain_text("buvo 69 cm")
        fit = page.locator("[data-fit] .list-row", has_text="Rudens lydekų taurė")
        expect(fit).to_contain_text("Bus įskaityta po patvirtinimo")
        page.get_by_role("button", name="Ešerys").click()
        expect(fit).to_contain_text("kita rūšis")
        page.get_by_role("button", name="Lydeka").click()
        expect(fit).to_contain_text("Bus įskaityta")
        expect(page.locator("[data-loc]")).to_have_text("±8 m")
        expect(page.locator("[data-weather]")).to_have_text("Oras: 6,4 °C, debesuota, vėjas 3,1 m/s, 1013 hPa")
        assert "latitude=54.900&longitude=23.900" in meteo_calls[0], meteo_calls
        page.get_by_text("Daugiau: svoris, masalas, pastabos").click()
        page.get_by_label("Svoris, kg (nebūtina)").fill("2,4")
        page.get_by_label("Masalas (matysi tik tu)").fill("Vobleris 9 cm")
        page.get_by_label("Pastabos (matysi tik tu)").fill('<b onmouseover="window.__xss=1">nendrės</b>')
        shot(page, "04-laimikis")
        step("rūšis, taisyklių patikra, oras ir papildoma informacija")

        page.get_by_role("button", name="Išsaugoti").click()
        # 81 cm lydeka > ankstesnė 69 cm -> naujas asmeninis rekordas (šventinis ekranas)
        done = page.locator("[data-step='done']")
        expect(done.locator("[data-done]")).to_contain_text("Naujas asmeninis rekordas!")
        expect(done).to_contain_text("Lydeka 81 cm")
        expect(done).to_contain_text("Ankstesnis rekordas – 69 cm")
        expect(done).to_contain_text("Rudens lydekų taurė")
        expect(done.locator("[data-done-status]")).to_contain_text("Išsiųsta · laukia moderatoriaus")
        shot(page, "04b-rekordas")
        with page.expect_download() as dl:
            done.get_by_role("button", name="Pasidalinti").click()
        assert dl.value.suggested_filename == "laimikis.png"
        done.get_by_role("button", name="Į dienoraštį").click()
        expect(page.get_by_role("heading", name="Dienoraštis")).to_be_visible()
        card81 = page.locator("[data-catch]", has_text="81 cm").first
        expect(card81).to_contain_text("Asmeninis rekordas")
        expect(card81).to_contain_text("Tikrinama")
        expect(card81).to_contain_text("2,4 kg")
        expect(card81).to_contain_text("Vobleris 9 cm")
        expect(page.locator("[data-stat=biggest]")).to_contain_text("81 cm")
        card81.locator("a.catch-link").click()
        expect(page.get_by_role("heading", name="81 cm")).to_be_visible()
        expect(page.locator("dl").first).to_contain_text("6,4 °C")
        tik_tau = page.locator("section", has_text="Tik tau")
        expect(tik_tau).to_contain_text('<b onmouseover="window.__xss=1">nendrės</b>')
        page.get_by_role("button", name="Redaguoti masalą ir pastabas").click()
        page.locator("[data-extra-form]").get_by_label("Masalas").fill("Guminukas")
        page.locator("[data-extra-form]").get_by_role("button", name="Išsaugoti").click()
        expect(page.locator("#toast")).to_have_text("Išsaugota")
        expect(page.locator("section", has_text="Tik tau")).to_contain_text("Guminukas")
        page.goto(base + "#/dienorastis")
        expect(page.locator("[data-catch]", has_text="81 cm").first).to_contain_text("Guminukas")
        step("dienoraštis: svoris, oras, masalo redagavimas laimikio puslapyje")

        # Laimikio peržiūra ir nuotrauka per visą ekraną
        page.locator("[data-catch]", has_text="81 cm").first.locator("a.catch-link").click()
        expect(page.get_by_role("heading", name="81 cm")).to_be_visible()
        expect(page.locator("dl").first).to_contain_text("2,4 kg")
        expect(page.locator("section", has_text="Tik tau")).to_contain_text("Guminukas")
        expect(page.get_by_role("link", name=re.compile("žemėlapis"))).to_be_visible()
        expect(page.locator(".list-row", has_text="Rudens lydekų taurė")).to_contain_text("Bus įskaitytas po patvirtinimo")
        expect(page.locator(".photo-big img.loaded")).to_be_visible()
        page.get_by_role("button", name="Rodyti nuotrauką per visą ekraną").click()
        expect(page.locator(".lightbox img")).to_be_visible()
        shot(page, "05b-nuotrauka")
        page.keyboard.press("Escape")
        expect(page.locator(".lightbox")).to_have_count(0)
        page.get_by_role("button", name="Rodyti nuotrauką per visą ekraną").click()
        page.get_by_role("button", name="Uždaryti nuotrauką").click()
        expect(page.locator(".lightbox")).to_have_count(0)
        shot(page, "05c-laimikis")
        expect(page.locator("[data-pb]")).to_contain_text("Asmeninis rekordas")
        expect(page.locator("[data-compare]")).to_contain_text("Lydeka: tavo laimikiai")
        expect(page.locator("[data-compare]")).to_contain_text("1 vieta iš")
        expect(page.get_by_role("link", name="Mano žemėlapyje")).to_be_visible()
        with page.expect_download() as dl2:
            page.get_by_role("button", name="Dalintis laimikiu").click()
        assert dl2.value.suggested_filename == "laimikis.png"
        step("laimikio peržiūra ir nuotrauka per visą ekraną, palyginimas, pasidalinimas paveikslėliu")

        # Pristatymas (#/pradzia); „Tavo pradžia“ nerodoma, kai viskas atlikta
        page.goto(base + "#/")
        expect(page.get_by_role("heading", name="Turnyrai", level=1)).to_be_visible()
        expect(page.locator("[data-start]")).to_have_count(0)
        page.goto(base + "#/pradzia")
        expect(page.locator("[data-intro-title]")).to_have_text("1. Žuvis prie liniuotės")
        expect(page.locator("[data-start] .check.d")).to_have_count(4)
        page.get_by_role("button", name="Toliau").click()
        expect(page.locator("[data-intro-title]")).to_have_text("2. Dalyvauk turnyruose")
        page.get_by_role("button", name="Toliau").click()
        expect(page.locator("[data-intro-title]")).to_have_text("3. Tavo dienoraštis")
        shot(page, "05d-pristatymas")
        page.get_by_role("button", name="Pradėti").click()
        expect(page.get_by_role("heading", name="Turnyrai", level=1)).to_be_visible()
        assert page.evaluate("() => localStorage.getItem('zt-intro-done')") == "1"
        step("pristatymas 3 žingsniais ir paslepiamas pradžios sąrašas")
        shot(page, "05-dienorastis")
        step("išsaugota ir išsiųsta")

        # 4. Offline eilė: siuntimas nepavyksta -> laukia eilėje -> išsiunčiama vėliau
        page.evaluate("""() => {
            const b = window.__zt.backend;
            window.__realSubmit = b.submitCatch;
            b.submitCatch = async () => { throw new TypeError('Failed to fetch'); };
        }""")
        page.goto(base + "#/laimikis")
        expect(page.get_by_role("button", name="Fotografuoti")).to_be_enabled()
        page.get_by_role("button", name="Fotografuoti").click()
        page.get_by_role("button", name="Išsaugoti").click()
        expect(page.locator("#status")).to_contain_text("1 laimikis laukia išsiuntimo")
        expect(page.locator("[data-done-status]")).to_contain_text("Laukia ryšio")
        page.get_by_role("button", name="Į dienoraštį").click()
        expect(page.locator(".card", has_text="Laukia eilėje")).to_be_visible()
        shot(page, "06-eile")
        page.evaluate("() => { window.__zt.backend.submitCatch = window.__realSubmit; }")
        page.get_by_role("button", name="Siųsti dabar").click()
        expect(page.locator("#status")).to_be_hidden()
        expect(page.locator("#toast")).to_have_text("Laimikis išsiųstas")
        page.wait_for_timeout(300)
        expect(page.locator("#toast")).to_have_text("Laimikis išsiųstas")
        step("offline eilė išsaugo ir vėliau išsiunčia")

        # 5. Pakartota nuotrauka atmetama visam laikui ir rodoma vartotojui
        page.evaluate("""async () => {
            const z = window.__zt;
            const last = (await z.backend.myCatches()).find(c => c.status === 'pending');
            await z.outbox.add({ clientId: crypto.randomUUID(), speciesId: 1, lengthMm: 700,
              capturedAt: new Date().toISOString(), sha256: last.photo_sha256, photo: new Blob(['x']), location: null });
            await z.flush();
        }""")
        expect(page.locator("#status")).to_contain_text("1 neišsiųsta")
        page.goto(base + "#/dienorastis")
        expect(page.locator(".card", has_text="Ši nuotrauka jau buvo įkelta")).to_be_visible()
        page.get_by_role("button", name="Pašalinti").click()
        expect(page.locator("#status")).to_be_hidden()
        step("pakartotos nuotraukos apsauga")

        # 6. Moderavimas
        page.goto(base + "#/profilis")
        page.get_by_role("link", name=re.compile("Moderavimas")).click()
        expect(page.get_by_role("button", name="Patvirtinti")).to_be_visible()
        expect(page.locator(".mod-photo img.loaded")).to_be_visible()
        shot(page, "07-moderavimas")
        page.get_by_role("button", name="Atmesti").first.click()
        page.get_by_role("button", name="Atmesti laimikį").click()
        expect(page.locator("#toast")).to_have_text("Nurodyk priežastį")
        page.get_by_role("button", name="Patvirtinti").click()
        expect(page.locator("#toast")).to_have_text("Patvirtinta")
        page.get_by_role("button", name="Atmesti").first.click()
        page.get_by_role("button", name="Netikslus ilgis").click()
        page.get_by_role("button", name="Atmesti laimikį").click()
        expect(page.get_by_text("Eilė tuščia")).to_be_visible()
        step("moderavimas: patvirtinti ir atmesti su priežastimi")

        page.goto(base + "#/dienorastis")
        expect(page.locator("[data-catch]", has_text="Netikslus ilgis")).to_contain_text("Atmesta")
        step("dalyvis mato atmetimo priežastį")

        # 7. Lentelė
        page.goto(base + "#/t/t-taure/lentele")
        mine = page.locator(".board-row.mine")
        expect(mine).to_contain_text("81 cm")
        expect(page.locator(".my-sticky")).to_contain_text("#10")
        expect(page.locator(".podium-col.p1")).to_contain_text("Ąžuolas_K")
        shot(page, "08-lentele")
        step("lentelė su mano vieta")

        page.locator(".podium-col.p1").click()
        expect(page.get_by_role("heading", name="Ąžuolas_K")).to_be_visible()
        expect(page.locator(".gallery figure").first).to_be_visible()
        step("kito žvejo profilis")

        page.locator(".gallery a").first.click()
        expect(page.locator(".card", has_text="Ąžuolas_K")).to_be_visible()
        expect(page.get_by_text("Tik tau")).to_have_count(0)
        expect(page.get_by_text("Laimikio vieta nerodoma")).to_be_visible()
        expect(page.get_by_role("link", name=re.compile("žemėlapis"))).to_have_count(0)
        step("kito žvejo laimikis: be masalo ir vietos")

        page.goto(base + "#/lenteles")
        expect(page.locator(".card", has_text="Rudens lydekų taurė")).to_contain_text("#10")
        step("mano lentelių suvestinė")

        # 8. Turnyro kūrimas + XSS apsauga
        page.goto(base + "#/naujas")
        page.get_by_label("Pavadinimas", exact=True).fill('<img src=x onerror="window.__xss=1">Taurė')
        page.get_by_role("button", name="Kelių ilgių suma").click()
        page.locator("[data-form]").get_by_role("button", name="Starkis").click()
        page.get_by_role("button", name="Sukurti turnyrą").click()
        expect(page.get_by_role("heading", level=1)).to_have_text('<img src=x onerror="window.__xss=1">Taurė')
        expect(page.locator(".badge-mine")).to_be_visible()
        assert page.evaluate("() => window.__xss") is None, "XSS: kodas įvykdytas!"
        step("turnyro kūrimas, vartotojo tekstas saugiai ištrūkinamas")

        page.goto(base + "#/naujas")
        page.get_by_label("Pavadinimas", exact=True).fill("Blogos datos")
        page.get_by_label("Pabaiga").fill("2020-01-01T10:00")
        page.get_by_role("button", name="Sukurti turnyrą").click()
        expect(page.locator("[data-error]")).to_have_text("Pabaiga turi būti vėliau nei pradžia.")
        step("formos validacija")

        # 9. Profilis ir tema
        page.goto(base + "#/profilis")
        page.get_by_role("button", name="Redaguoti profilį").click()
        page.get_by_label("Slapyvardis (matomas kitiems)").fill("Testas_1")
        page.get_by_role("button", name="Išsaugoti").click()
        expect(page.get_by_role("heading", name="Testas_1")).to_be_visible()
        page.locator("[data-ptab=nustatymai]").click()
        page.get_by_label("Tema").select_option("light")
        assert page.evaluate("() => document.documentElement.dataset.theme") == "light"
        shot(page, "09-profilis-sviesi")
        page.goto(base + "#/")
        shot(page, "10-turnyrai-sviesi")
        page.goto(base + "#/profilis?skiltis=nustatymai")
        page.get_by_label("Tema").select_option("dark")
        step("profilio redagavimas ir šviesi tema")

        # 10. Kamera neleidžiama -> aiškus paaiškinimas
        plain = p.chromium.launch()  # be netikros kameros
        ctx2 = plain.new_context(viewport={"width": 390, "height": 844}, service_workers="block")
        p2 = ctx2.new_page()
        p2.route(re.compile(r"https://fonts\..*"), lambda r: r.abort())
        p2.goto(base + "#/laimikis")
        expect(p2.locator("[data-cam-error]")).to_contain_text("Kamer")
        expect(p2.get_by_role("button", name="Bandyti dar kartą")).to_be_visible()
        shot(p2, "11-kameros-klaida")
        plain.close()
        step("kameros klaidos paaiškinimas")

        extra_demo_tests(page, base, meteo_calls)
        map_demo_test(page, base)
        social_demo_test(page, base)
        clubs_demo_test(page, base)
        formats_demo_test(page, base)
        stats_demo_test(page, base)
        sponsors_demo_test(page, base)
        organizer_demo_test(page, base)
        admin_demo_test(page, base)
        features_panel_demo_test(page, base)
        custom_rules_demo_test(page, base)
        diary_plus_demo_test(page, base)

        ctx.close()

        # 11. PWA: programėlė atsidaro be interneto
        ctx3 = browser.new_context(viewport={"width": 390, "height": 844})
        p3 = ctx3.new_page()
        p3.route(re.compile(r"https://fonts\..*"), lambda r: r.abort())
        p3.goto(base)
        p3.evaluate("() => navigator.serviceWorker.ready")
        p3.reload()
        expect(p3.get_by_role("heading", name="Turnyrai", level=1)).to_be_visible()
        p3.wait_for_function("() => !!navigator.serviceWorker.controller")
        ctx3.set_offline(True)
        p3.reload()
        expect(p3.get_by_role("heading", name="Turnyrai", level=1)).to_be_visible()
        ctx3.close()
        step("veikia be interneto (service worker)")

        # 12. Push pranešimas per tikrą service worker (Chrome DevTools: deliverPushMessage)
        # (pilnas Chromium – „headless shell“ pranešimų nepalaiko)
        origin = re.match(r"https?://[^/]+", base).group(0)
        full = p.chromium.launch(channel="chromium")
        ctx4 = full.new_context(viewport={"width": 390, "height": 844})
        ctx4.grant_permissions(["notifications"], origin=origin)
        p4 = ctx4.new_page()
        p4.route(re.compile(r"https://fonts\..*"), lambda r: r.abort())
        p4.goto(base)
        p4.evaluate("() => navigator.serviceWorker.ready")
        cdp = ctx4.new_cdp_session(p4)
        regs = []
        cdp.on("ServiceWorker.workerRegistrationUpdated", lambda ev: regs.extend(ev["registrations"]))
        cdp.send("ServiceWorker.enable")
        p4.wait_for_timeout(500)
        reg_id = next(r["registrationId"] for r in regs if not r.get("isDeleted"))
        msgs = [{"title": "Laimikis patvirtintas", "body": "Lydeka 92,5 cm – įskaityta", "url": "#/l/abc-1", "tag": "review-1"},
                {"title": "Kenkėjas", "body": "x", "url": "javascript:alert(1)", "tag": "bad-1"}]
        notes = []
        for i, m in enumerate(msgs, start=1):
            cdp.send("ServiceWorker.deliverPushMessage", {"origin": origin, "registrationId": reg_id, "data": json.dumps(m)})
            for _ in range(150):  # iki 15 s kiekvienam
                notes = p4.evaluate("""async () => (await (await navigator.serviceWorker.ready).getNotifications())
                    .map(n => ({ title: n.title, body: n.body, tag: n.tag, url: n.data && n.data.url }))""")
                if len(notes) >= i:
                    break
                p4.wait_for_timeout(100)
        by_tag = {n["tag"]: n for n in notes}
        assert by_tag["review-1"] == {"title": "Laimikis patvirtintas", "body": "Lydeka 92,5 cm – įskaityta", "tag": "review-1", "url": "#/l/abc-1"}, notes
        assert by_tag["bad-1"]["url"] == "#/", "nesaugi nuoroda turi būti pakeista į #/"
        ctx4.close()
        full.close()
        step("push pranešimas parodomas per tikrą service worker, nuorodos saugios")

        browser.close()
    httpd.shutdown()

    if errors:
        print("\nKLAIDOS NARŠYKLĖJE:")
        for e in errors:
            print("  ", e)
        sys.exit(1)
    print("\nVISI NARŠYKLĖS TESTAI PRAĖJO")


if __name__ == "__main__":
    main()
