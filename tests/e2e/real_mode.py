"""
Naršyklės testai tikram (Supabase) režimui be tinklo: supabase-js pakeičiamas imitacija
(tests/e2e/fake_supabase.js), o src/config.js – testiniais raktais. Tikrina prisijungimą kodu,
registraciją, laimikio įkėlimą (įskaitant pakartojimą po nutrūkusio ryšio), moderavimą, lentelę,
turnyro kūrimą ir atsijungimą.

python3 tests/e2e/real_mode.py
"""
import importlib.util
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright, expect

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("e2e_base", HERE / "run.py")
base_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base_mod)

FAKE = (HERE / "fake_supabase.js").read_text()
CONFIG = "export const SUPABASE_URL = 'https://fake.supabase.co';\nexport const SUPABASE_ANON_KEY = 'sb_publishable_test';\n"
CDN = re.compile(r"https://cdn\.jsdelivr\.net/npm/@supabase/supabase-js@2/\+esm")


def step(name):
    print(f"  ✓ {name}")


def calls(page, kind=None, **match):
    cs = page.evaluate("() => window.__sbCalls")
    out = [c for c in cs if (kind is None or c["kind"] == kind) and all(c.get(k) == v for k, v in match.items())]
    return out


def main():
    httpd, base = base_mod.serve()
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"])
        ctx = browser.new_context(
            viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True,
            geolocation={"latitude": 54.9, "longitude": 23.9, "accuracy": 9},
            permissions=["geolocation", "camera"], service_workers="block",
            locale="lt-LT", timezone_id="Europe/Vilnius",
        )
        ctx.add_init_script(f"window.__appBase = {base!r};")
        ctx.route(re.compile(r"https://fonts\.(googleapis|gstatic)\.com/.*"), lambda r: r.abort())
        ctx.route(CDN, lambda r: r.fulfill(status=200, content_type="text/javascript",
                                           headers={"Access-Control-Allow-Origin": "*"}, body=FAKE))
        ctx.route(re.compile(r".*/src/config\.js$"), lambda r: r.fulfill(status=200, content_type="text/javascript", body=CONFIG))
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: m.type == "error"
                and not re.search(r"fonts\.(googleapis|gstatic)", (m.location or {}).get("url", ""))
                and errors.append(f"console: {m.text} @ {(m.location or {}).get('url', '')}"))
        expect.set_options(timeout=8000)

        # 1. Neprisijungęs: mato turnyrus, demo pranešimo nėra
        page.goto(base)
        expect(page.get_by_role("heading", name="Turnyrai", level=1)).to_be_visible()
        expect(page.locator(".demo-note")).to_have_count(0)
        assert calls(page, "createClient")[0]["url"] == "https://fake.supabase.co"
        page.get_by_role("button", name=re.compile("^Vyksta")).click()
        expect(page.locator(".t-card", has_text="Testo lydekų taurė")).to_contain_text("2")  # dalyviai
        page.locator(".t-card", has_text="Testo lydekų taurė").click()
        expect(page.get_by_role("link", name="Prisijungti ir dalyvauti")).to_be_visible()
        expect(page.locator(".list-row", has_text="Kitas_Zvejys")).to_contain_text("70 cm")
        step("neprisijungęs mato turnyrą ir lentelę")

        # 2. Prisijungimas kodu
        page.get_by_role("link", name="Prisijungti ir dalyvauti").click()
        page.get_by_label("El. paštas").fill("  Ecimas@Pastas.LT ")
        page.get_by_role("button", name="Siųsti kodą").click()
        expect(page.get_by_label("Kodas iš laiško")).to_be_visible()
        assert calls(page, "signInWithOtp")[-1]["email"] == "ecimas@pastas.lt"
        expect(page.get_by_role("button", name=re.compile("Siųsti dar kartą"))).to_be_disabled()
        page.get_by_label("Kodas iš laiško").fill("000000")
        page.get_by_role("button", name="Prisijungti").click()
        expect(page.locator("#toast")).to_have_text("Kodas neteisingas arba nebegalioja")
        page.get_by_label("Kodas iš laiško").fill("12 34-56")
        expect(page.get_by_label("Kodas iš laiško")).to_have_value("123456")
        page.get_by_role("button", name="Prisijungti").click()
        expect(page.get_by_role("heading", level=1)).to_have_text(re.compile(r"^zvejys_"))
        step("prisijungimas kodu (neteisingas kodas atmetamas)")

        # 3. Profilio slapyvardis
        page.get_by_role("button", name="Redaguoti profilį").click()
        page.get_by_label("Slapyvardis (matomas kitiems)").fill("Kitas_Zvejys")
        page.get_by_role("button", name="Išsaugoti").click()
        expect(page.locator("#toast")).to_have_text("Toks slapyvardis jau užimtas")
        page.get_by_label("Slapyvardis (matomas kitiems)").fill("Ecimas_LT")
        page.get_by_role("button", name="Išsaugoti").click()
        expect(page.get_by_role("heading", name="Ecimas_LT")).to_be_visible()
        step("slapyvardis: užimtas atmetamas, laisvas išsaugomas")

        # 4. Registracija į turnyrą
        page.goto(base + "#/t/tttttttt-0000-4000-8000-000000000001")
        page.get_by_role("button", name="Dalyvauti").click()
        expect(page.locator("#toast")).to_have_text("Užsiregistravai į turnyrą")
        assert calls(page, "from", table="entries", op="insert")
        step("registracija į turnyrą")

        # 5. Laimikis: pirmas bandymas nutrūksta po nuotraukos įkėlimo, antras – sėkmingas
        page.evaluate("() => { window.__sbFail.catchInsert = 1; }")
        page.get_by_role("link", name="Registruoti laimikį").click()
        expect(page.get_by_role("button", name="Fotografuoti")).to_be_enabled()
        page.get_by_role("button", name="Fotografuoti").click()
        for _ in range(28):
            page.get_by_role("button", name="Padidinti 1 cm").click()
        expect(page.locator("[data-len]")).to_have_text("78")
        page.get_by_role("button", name="Išsaugoti").click()
        expect(page.get_by_role("heading", name="Dienoraštis")).to_be_visible()
        expect(page.locator("#status")).to_contain_text("1 laimikis laukia")
        page.get_by_role("button", name="Siųsti dabar").click()
        expect(page.locator("#toast")).to_have_text("Laimikis išsiųstas")
        expect(page.locator(".card", has_text="78 cm")).to_contain_text("Tikrinama")
        ups = calls(page, "upload")
        assert len(ups) == 2 and ups[0]["path"] == ups[1]["path"], ups
        assert ups[0]["type"] == "image/jpeg" and ups[0]["upsert"] is False
        mine = page.evaluate("() => window.__fakeDb.get().catches.filter(c => c.length_mm === 780)")
        assert len(mine) == 1, mine
        locs = page.evaluate("() => window.__fakeDb.get().catch_locations")
        assert len(locs) == 1 and abs(locs[0]["lat"] - 54.9) < 1e-6 and locs[0]["accuracy_m"] == 9, locs
        sha = mine[0]["photo_sha256"]
        assert re.fullmatch(r"[0-9a-f]{64}", sha), sha
        step("laimikis: pakartojimas po nutrūkimo nesukuria dublio, vieta išsaugota")

        # 6. Pakartota nuotrauka – nuolatinė klaida
        page.evaluate("""async (sha) => {
            const z = window.__zt;
            await z.outbox.add({ clientId: crypto.randomUUID(), speciesId: 1, lengthMm: 600,
              capturedAt: new Date().toISOString(), sha256: sha, photo: new Blob(['x'], {type: 'image/jpeg'}), location: null });
            await z.flush();
        }""", sha)
        expect(page.locator("#status")).to_contain_text("1 neišsiųsta")
        page.goto(base + "#/dienorastis")
        expect(page.locator(".card", has_text="Ši nuotrauka jau buvo įkelta")).to_be_visible()
        page.get_by_role("button", name="Pašalinti").click()
        step("pakartota nuotrauka atmetama visam laikui")

        # 7. Moderavimas (padarom vartotoją moderatoriumi, kaip SQL komanda README)
        page.evaluate("""async () => {
            window.__fakeDb.set(db => { db.profiles.find(p => p.nickname === 'Ecimas_LT').is_admin = true; });
            window.__zt.state.profile = await window.__zt.backend.myProfile();
        }""")
        page.goto(base + "#/profilis")
        page.get_by_role("link", name=re.compile("Moderavimas")).click()
        expect(page.locator(".list-row", has_text="Rūšis ir ilgis")).to_contain_text("78 cm")
        expect(page.locator(".list-row", has_text="Vieta")).to_contain_text("±9 m")
        expect(page.locator(".mod-photo img.loaded")).to_be_visible()
        page.get_by_role("button", name="Patvirtinti").click()
        expect(page.get_by_text("Eilė tuščia")).to_be_visible()
        assert calls(page, "rpc", name="review_catch")
        step("moderavimas su nuotrauka ir vieta")

        # 8. Lentelė
        page.goto(base + "#/t/tttttttt-0000-4000-8000-000000000001/lentele")
        expect(page.locator(".podium-col.p1")).to_contain_text("78 cm")
        expect(page.locator(".my-sticky")).to_contain_text("#1")
        step("lentelė iš serverio funkcijos")

        # 9. Turnyro kūrimas su rūšimis
        page.goto(base + "#/naujas")
        page.get_by_label("Pavadinimas").fill("Ešerių savaitgalis")
        page.evaluate("""() => { const d = new Date(), p = (n) => String(n).padStart(2, '0');
            document.querySelector('[name=starts_at]').value =
              `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }""")
        page.locator("[data-form]").get_by_role("button", name="Ešerys").click()
        page.get_by_role("button", name="Sukurti turnyrą").click()
        expect(page.get_by_role("heading", name="Ešerių savaitgalis")).to_be_visible()
        expect(page.locator(".badge-mine")).to_be_visible()
        t = page.evaluate("() => window.__fakeDb.get().tournaments.find(t => t.title === 'Ešerių savaitgalis')")
        ts = page.evaluate("(id) => window.__fakeDb.get().tournament_species.filter(x => x.tournament_id === id)", t["id"])
        assert [x["species_id"] for x in ts] == [2], ts
        import datetime as _dt
        start = _dt.datetime.fromisoformat(t["starts_at"].replace("Z", "+00:00"))
        assert start > _dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(seconds=60), t["starts_at"]
        step("turnyro kūrimas su rūšimi")

        # 10. Atsijungimas
        page.goto(base + "#/profilis")
        page.get_by_role("button", name="Atsijungti").click()
        expect(page.get_by_role("heading", name="Turnyrai", level=1)).to_be_visible()
        page.goto(base + "#/dienorastis")
        expect(page.get_by_role("link", name="Prisijungti")).to_be_visible()
        step("atsijungimas")

        browser.close()
    httpd.shutdown()
    if errors:
        print("\nKLAIDOS NARŠYKLĖJE:")
        for e in errors:
            print("  ", e)
        sys.exit(1)
    print("\nVISI TIKRO REŽIMO TESTAI PRAĖJO")


if __name__ == "__main__":
    main()
