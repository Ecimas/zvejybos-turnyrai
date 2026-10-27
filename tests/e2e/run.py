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


def step(name):
    print(f"  ✓ {name}")


def extra_demo_tests(page, base, meteo_calls):
    """Ginčai, moderatoriai, privatūs turnyrai, redagavimas, prizai, ekranas, ženkliukai, eksportas, ištrynimas."""
    accept_dialogs = lambda d: d.accept()
    page.on("dialog", accept_dialogs)

    # Ginčas dėl atmesto laimikio
    page.goto(base + "#/dienorastis")
    rejected = page.locator(".card", has_text="Netikslus ilgis")
    rejected.get_by_role("button", name="Nesutinku su sprendimu").click()
    rejected.get_by_label("Kodėl laimikis turėtų būti įskaitytas?").fill("Liniuotė matosi <script>window.__xss=1</script>")
    rejected.get_by_role("button", name="Pateikti moderatoriui").click()
    expect(page.locator("#toast")).to_have_text("Ginčas pateiktas moderatoriui")
    expect(page.locator(".card", has_text="Netikslus ilgis")).to_contain_text("Ginčas peržiūrimas")
    expect(page.locator(".card", has_text="Netikslus ilgis").get_by_role("button", name="Nesutinku su sprendimu")).to_have_count(0)
    dup = page.evaluate("""async () => { const b = window.__zt.backend;
        const c = (await b.myCatches()).find(x => x.status === 'rejected');
        return b.openDispute(c.id, 'dar kartą').then(() => 'ok', e => e.message); }""")
    assert dup == "Ginčas dėl šio laimikio jau pateiktas", dup
    page.goto(base + "#/profilis")
    page.get_by_role("link", name=re.compile("Ginčai")).click()
    expect(page.locator(".quote")).to_have_text("Liniuotė matosi <script>window.__xss=1</script>")
    shot(page, "12-gincai")
    page.get_by_label("Atsakymas dalyviui").fill("Atsiprašome, ilgis teisingas")
    page.get_by_role("button", name="Įskaityti").click()
    expect(page.locator("#toast")).to_have_text("Laimikis įskaitytas")
    expect(page.get_by_text("Ginčų nėra")).to_be_visible()
    page.goto(base + "#/dienorastis")
    card = page.locator(".card", has_text="Ginčas patenkintas")
    expect(card).to_contain_text("Patvirtinta")
    expect(card).to_contain_text("Atsiprašome, ilgis teisingas")
    step("ginčas: dalyvis pateikia, moderatorius įskaito")

    # Moderatorių komanda
    page.goto(base + "#/moderavimas/komanda")
    page.get_by_label("Pridėti moderatorių pagal slapyvardį").fill("nėra_tokio")
    page.get_by_role("button", name="Paskirti moderatoriumi").click()
    expect(page.locator("#toast")).to_have_text("Tokio slapyvardžio nėra")
    page.get_by_label("Pridėti moderatorių pagal slapyvardį").fill("lydekininkas")
    page.get_by_role("button", name="Paskirti moderatoriumi").click()
    expect(page.locator("#toast")).to_have_text("Moderatorius paskirtas")
    row = page.locator(".list-row", has_text="Lydekininkas")
    expect(row).to_be_visible()
    row.get_by_role("button", name="Pašalinti").click()
    expect(page.locator("#toast")).to_have_text("Moderatorius pašalintas")
    expect(page.locator(".list-row", has_text="Lydekininkas")).to_have_count(0)
    page.locator(".list-row", has_text="(tu)").get_by_role("button", name="Pašalinti").click()
    expect(page.locator("#toast")).to_have_text("Negalima pašalinti paskutinio moderatoriaus")
    step("moderatorių skyrimas ir paskutinio apsauga")

    # Privatus turnyras su paslėpta lentele, prizais ir rėmėju
    page.goto(base + "#/naujas")
    page.get_by_label("Pavadinimas").fill("Klubo taurė")
    page.get_by_role("button", name="Tik su kvietimu").click()
    page.get_by_text("Slėpti lentelę iki pabaigos").click()
    page.get_by_label("Prizai (nebūtina)").fill("1 vieta – <img src=x onerror=window.__xss=1>\n2 vieta – ritė")
    page.get_by_label("Rėmėjas (nebūtina)").fill("Ežero parduotuvė")
    page.get_by_label("Rėmėjo svetainė").fill("javascript:alert(1)")
    page.get_by_role("button", name="Sukurti turnyrą").click()
    expect(page.locator("[data-error]")).to_have_text("Rėmėjo svetainė turi prasidėti https://")
    page.get_by_label("Rėmėjo svetainė").fill("https://example.com/zvejyba")
    page.get_by_role("button", name="Sukurti turnyrą").click()
    expect(page.get_by_role("heading", name="Klubo taurė")).to_be_visible()
    expect(page.locator(".badge", has_text="Privatus")).to_be_visible()
    expect(page.locator(".prewrap")).to_contain_text("<img src=x onerror=window.__xss=1>")
    sponsor = page.get_by_role("link", name="Ežero parduotuvė")
    expect(sponsor).to_have_attribute("href", "https://example.com/zvejyba")
    expect(sponsor).to_have_attribute("rel", "noopener noreferrer sponsored")
    expect(page.locator("dl")).to_contain_text("Paslėpta iki pabaigos")
    expect(page.get_by_role("button", name="Kviesti draugus")).to_be_visible()
    shot(page, "13-privatus")
    tid = page.evaluate("() => location.hash.split('/')[2]")
    code = page.evaluate("(id) => JSON.parse(localStorage.getItem('zt-demo-v1')).tournaments.find(t => t.id === id).invite_code", tid)
    assert re.fullmatch(r"[0-9a-f]{10}", code), code
    step("privatus turnyras su prizais, rėmėju ir paslėpta lentele")

    # Redagavimas ir ištrynimas iki starto
    page.get_by_role("link", name="Redaguoti").click()
    expect(page.get_by_label("Pavadinimas")).to_have_value("Klubo taurė")
    expect(page.get_by_role("button", name="Tik su kvietimu")).to_have_attribute("aria-pressed", "true")
    expect(page.locator("[name=leaderboard_hidden]")).to_be_checked()
    page.get_by_label("Pavadinimas").fill("Klubo taurė 2026")
    page.get_by_role("button", name="Visi").click()
    page.get_by_role("button", name="Išsaugoti pakeitimus").click()
    expect(page.locator("#toast")).to_have_text("Pakeitimai išsaugoti")
    expect(page.get_by_role("heading", name="Klubo taurė 2026")).to_be_visible()
    expect(page.locator(".badge", has_text="Privatus")).to_have_count(0)
    page.get_by_role("link", name="Redaguoti").click()
    page.get_by_role("button", name="Ištrinti turnyrą").click()
    expect(page.locator("#toast")).to_have_text("Turnyras ištrintas")
    assert page.evaluate("(id) => JSON.parse(localStorage.getItem('zt-demo-v1')).tournaments.some(t => t.id === id)", tid) is False
    page.goto(base + "#/t/t-taure/redaguoti")
    expect(page.get_by_text("Redaguoti negalima")).to_be_visible()
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
    page.goto(base + "#/t/t-plesrunai")
    expect(page.locator(".winners li")).to_have_count(3)
    expect(page.locator(".winners")).to_contain_text("🥇")
    page.goto(base + "#/t/t-taure")
    expect(page.locator(".winners")).to_have_count(0)
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
    page.goto(base + "#/profilis")
    expect(page.locator(".badge-tile")).to_have_count(10)
    grid = page.locator(".badges").bounding_box()
    head = page.locator("h2", has_text="Ženkliukai").bounding_box()
    first = page.locator(".badge-tile").first.bounding_box()
    assert abs(grid["x"] - head["x"]) < 1 and abs(first["x"] - head["x"]) < 1, (grid, head, first)
    vw = page.viewport_size["width"]
    right_gap = vw - (grid["x"] + grid["width"])
    assert abs(right_gap - head["x"]) < 2, f"ženkliukai necentruoti: kairėje {head['x']}, dešinėje {right_gap}"
    assert page.locator(".badge-tile.earned").count() >= 2
    page.get_by_role("link", name="Turnyrų taisyklės").click()
    expect(page.get_by_role("heading", name="Turnyrų taisyklės")).to_be_visible()
    page.get_by_role("button", name="Atgal").click()
    page.get_by_role("link", name="Privatumo politika").click()
    expect(page.get_by_role("heading", name="Privatumo politika")).to_be_visible()
    expect(page.locator(".prose")).to_contain_text("90 dienų")
    page.goto(base + "#/profilis")
    with page.expect_download() as dl:
        page.get_by_role("button", name="Atsisiųsti mano duomenis").click()
    data = json.loads(pathlib.Path(dl.value.path()).read_text())
    assert dl.value.suggested_filename.startswith("zvejybos-turnyrai-") and dl.value.suggested_filename.endswith(".json")
    assert data["profile"]["nickname"] == "Testas_1", data["profile"]
    assert any(c.get("bait") == "Guminukas" for c in data["catches"])
    assert any(c.get("catch_locations") for c in data["catches"]), "eksporte turi būti vietos"
    assert len(data["disputes"]) == 1
    step("ženkliukai, taisyklės, privatumo politika, duomenų eksportas")

    # Oras išjungiamas
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
    page.goto(base + "#/profilis")
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
                and not re.search(r"fonts\.(googleapis|gstatic)", (m.location or {}).get("url", ""))
                and errors.append(f"console: {m.text} @ {(m.location or {}).get('url', '')}"))
        page.route(re.compile(r"https://fonts\.(googleapis|gstatic)\.com/.*"), lambda r: r.abort())
        meteo_calls = []
        page.route(METEO, lambda r: (meteo_calls.append(r.request.url), fake_meteo(r)))
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

        expect(page.get_by_role("button", name="Lydeka")).to_have_attribute("aria-pressed", "true")
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
        expect(page.get_by_role("heading", name="Dienoraštis")).to_be_visible()
        card81 = page.locator(".card", has_text="81 cm").first
        expect(card81).to_contain_text("Tikrinama")
        expect(card81).to_contain_text("2,4 kg")
        expect(card81).to_contain_text("Masalas: Vobleris 9 cm")
        expect(card81).to_contain_text('<b onmouseover="window.__xss=1">nendrės</b>')
        expect(card81).to_contain_text("6,4 °C")
        card81.get_by_role("button", name="Redaguoti masalą ir pastabas").click()
        card81.get_by_label("Masalas").fill("Guminukas")
        card81.get_by_role("button", name="Išsaugoti").click()
        expect(page.locator("#toast")).to_have_text("Išsaugota")
        expect(page.locator(".card", has_text="81 cm").first).to_contain_text("Masalas: Guminukas")
        step("dienoraštis: svoris, oras, masalo redagavimas")

        # Laimikio peržiūra ir nuotrauka per visą ekraną
        page.locator(".card", has_text="81 cm").first.locator("a.catch-link").click()
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
        step("laimikio peržiūra ir nuotrauka per visą ekraną")
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
        expect(page.locator(".card", has_text="Netikslus ilgis")).to_contain_text("Atmesta")
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
        page.get_by_label("Pavadinimas").fill('<img src=x onerror="window.__xss=1">Taurė')
        page.get_by_role("button", name="Kelių ilgių suma").click()
        page.locator("[data-form]").get_by_role("button", name="Starkis").click()
        page.get_by_role("button", name="Sukurti turnyrą").click()
        expect(page.get_by_role("heading", level=1)).to_have_text('<img src=x onerror="window.__xss=1">Taurė')
        expect(page.locator(".badge-mine")).to_be_visible()
        assert page.evaluate("() => window.__xss") is None, "XSS: kodas įvykdytas!"
        step("turnyro kūrimas, vartotojo tekstas saugiai ištrūkinamas")

        page.goto(base + "#/naujas")
        page.get_by_label("Pavadinimas").fill("Blogos datos")
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
        page.get_by_label("Tema").select_option("light")
        assert page.evaluate("() => document.documentElement.dataset.theme") == "light"
        shot(page, "09-profilis-sviesi")
        page.goto(base + "#/")
        shot(page, "10-turnyrai-sviesi")
        page.goto(base + "#/profilis")
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
