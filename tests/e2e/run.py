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


class Quiet(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".webmanifest": "application/manifest+json"}

    def log_message(self, *args):
        pass

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
        expect.set_options(timeout=8000)

        # 1. Turnyrų sąrašas
        page.goto(base)
        expect(page.get_by_role("heading", name="Turnyrai", level=1)).to_be_visible()
        expect(page.locator(".demo-note")).to_be_visible()
        page.get_by_role("button", name=re.compile("^Vyksta")).click()
        expect(page.locator(".t-card", has_text="Rudens lydekų taurė")).to_be_visible()
        shot(page, "01-turnyrai")
        step("turnyrų sąrašas ir filtrai")

        # 2. Registracija į turnyrą
        page.locator(".t-card", has_text="Rudens lydekų taurė").click()
        expect(page.get_by_role("heading", name="Rudens lydekų taurė")).to_be_visible()
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
        shot(page, "04-laimikis")
        step("rūšis ir taisyklių patikra prieš išsaugant")

        page.get_by_role("button", name="Išsaugoti").click()
        expect(page.get_by_role("heading", name="Dienoraštis")).to_be_visible()
        expect(page.locator(".card", has_text="81 cm").first).to_contain_text("Tikrinama")
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
