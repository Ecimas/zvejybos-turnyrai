"""
Naršyklės testai tikram (Supabase) režimui be tinklo: supabase-js pakeičiamas imitacija
(tests/e2e/fake_supabase.js), o src/config.js – testiniais raktais. Tikrina prisijungimą kodu,
registraciją, laimikio įkėlimą (įskaitant pakartojimą po nutrūkusio ryšio), moderavimą, lentelę,
turnyro kūrimą ir atsijungimą.

python3 tests/e2e/real_mode.py
"""
import importlib.util
import json
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
# Tikslus prisegtos versijos adresas: jei kas nors pakeistų importą į „@2“, testai sulūžtų.
CDN = re.compile(r"https://cdn\.jsdelivr\.net/npm/@supabase/supabase-js@2\.118\.0/\+esm")


def step(name):
    print(f"  ✓ {name}")


def calls(page, kind=None, **match):
    cs = page.evaluate("() => window.__sbCalls")
    out = [c for c in cs if (kind is None or c["kind"] == kind) and all(c.get(k) == v for k, v in match.items())]
    return out


T1 = "tttttttt-0000-4000-8000-000000000001"
T2 = "tttttttt-0000-4000-8000-000000000002"


def fake(page, js, arg=None):
    return page.evaluate(f"(arg) => {{ const db = window.__fakeDb.get(); {js} }}", arg)


def go(page, url):
    """Kaip page.goto, bet ir tada, kai jau esame tame pačiame adrese (tada ekranas tiesiog perpiešiamas)."""
    if page.url == url:
        page.evaluate("() => window.__zt.rerender()")
    else:
        page.goto(url)


def more_real_tests(page, base):
    page.on("dialog", lambda d: d.accept())
    me = fake(page, "return db.profiles.find(p => p.nickname === 'Ecimas_LT').id;")

    # Laimikio laukai pasiekia serverį (svoris gramais, masalas, pastabos, oras)
    go(page, base + "#/laimikis")
    page.get_by_role("button", name="Fotografuoti").click()
    expect(page.locator("[data-weather]")).to_contain_text("6,4 °C")
    page.get_by_text("Daugiau: svoris, masalas, pastabos").click()
    page.get_by_label("Svoris, kg (nebūtina)").fill("1,25")
    page.get_by_label("Masalas (matysi tik tu)").fill("Sukriukė")
    page.get_by_label("Svoris, kg (nebūtina)").fill("999")
    page.get_by_role("button", name="Išsaugoti").click()
    expect(page.locator("#toast")).to_have_text("Svoris turi būti 0–200 kg")
    page.get_by_label("Svoris, kg (nebūtina)").fill("1,25")
    page.get_by_role("button", name="Išsaugoti").click()
    expect(page.locator("#toast")).to_have_text("Laimikis išsiųstas")
    row = fake(page, "return db.catches.filter(c => c.user_id === arg).sort((a, b) => a.received_at < b.received_at ? 1 : -1)[0];", me)
    assert row["weight_g"] == 1250 and row["bait"] == "Sukriukė" and row["notes"] is None, row
    assert row["weather"] == {"temp_c": 6.4, "wind_ms": 3.1, "pressure_hpa": 1013, "code": 3}, row["weather"]
    ins = [c for c in calls(page, "from", table="catches", op="insert")][-1]["rows"][0]
    assert set(ins) >= {"weight_g", "bait", "notes", "weather"} and "status" not in ins and "user_id" not in ins, ins
    step("laimikio svoris, masalas ir oras išsaugomi serveryje (be status/user_id iš kliento)")

    # Masalo redagavimas: siunčiami tik leistini stulpeliai
    go(page, base + "#/dienorastis")
    card = page.locator("[data-catch]").first
    card.get_by_role("button", name="Redaguoti masalą ir pastabas").click()
    card.get_by_label("Pastabos").fill("Prie nendrių")
    card.get_by_role("button", name="Išsaugoti").click()
    expect(page.locator("#toast")).to_have_text("Išsaugota")
    upd = calls(page, "from", table="catches", op="update")[-1]
    assert sorted(upd["patch"]) == ["bait", "notes"], upd
    step("masalo ir pastabų redagavimas (tik leistini laukai)")

    # Laimikio peržiūra: savas – su masalu ir vieta; svetimas – be jų; jokio „*“ iš catches
    mine_id = fake(page, "return db.catches.filter(c => c.user_id === arg && c.bait === 'Sukriukė')[0].id;", me)
    go(page, base + f"#/l/{mine_id}")
    expect(page.locator("section", has_text="Tik tau")).to_contain_text("Sukriukė")
    expect(page.locator("dl").first).to_contain_text("1,25 kg")
    go(page, base + "#/l/cccccccc-0000-4000-8000-000000000001")
    expect(page.get_by_role("heading", name="70 cm")).to_be_visible()
    expect(page.get_by_text("Tik tau")).to_have_count(0)
    expect(page.get_by_text("Laimikio vieta nerodoma")).to_be_visible()
    bad = [c for c in calls(page, "from", table="catches") if c["op"] == "select" and ("*" in (c["sel"] or "*").split(",")[0] or "bait" in (c["sel"] or ""))]
    assert not bad, f"catches skaitomi su * arba bait: {bad[:2]}"
    assert calls(page, "rpc", name="my_catch_notes"), "savo masalas turi būti gaunamas per my_catch_notes"
    step("laimikio peržiūra: privatūs laukai tik savininkui, užklausos be *")

    # Paros limitas: laimikis lieka eilėje su aiškiu pranešimu, vėliau išsiunčiamas
    fake(page, """for (let i = 0; i < 50; i++) db.catches.push({ id: 'lim' + i, user_id: arg, client_id: 'lim' + i, species_id: 2,
        length_mm: 200, captured_at_device: new Date().toISOString(), received_at: new Date().toISOString(),
        photo_path: arg + '/lim' + i + '.jpg', photo_sha256: 'lim' + i, status: 'pending' }); window.__fakeDb.save();""", me)
    page.evaluate("""async () => { const z = window.__zt;
        await z.outbox.add({ clientId: crypto.randomUUID(), speciesId: 2, lengthMm: 330, capturedAt: new Date().toISOString(),
          sha256: 'a'.repeat(64), photo: new Blob(['y'], {type: 'image/jpeg'}), location: null });
        await z.flush(); }""")
    expect(page.locator("#toast")).to_have_text("Paros limitas – 50 laimikių. Išsiųsime automatiškai vėliau")
    expect(page.locator("#status")).to_contain_text("1 laimikis laukia")
    go(page, base + "#/dienorastis")
    expect(page.locator(".card", has_text="33 cm")).to_contain_text("Paros limitas")
    fake(page, "db.catches = db.catches.filter(c => !String(c.id).startsWith('lim')); window.__fakeDb.save();")
    page.get_by_role("button", name="Siųsti dabar").click()
    expect(page.locator("#toast")).to_have_text("Laimikis išsiųstas")
    expect(page.locator("#status")).to_be_hidden()
    step("paros limitas: laimikis neprarandamas, išsiunčiamas vėliau")

    # Ginčas ir jo sprendimas (patikimumas +5)
    target = fake(page, "return db.catches.find(c => c.user_id === arg && c.length_mm === 330).id;", me)
    page.evaluate("(id) => window.__zt.backend.review(id, false, 'Ne ta rūšis')", target)
    trust0 = fake(page, "return db.profiles.find(p => p.id === arg).trust_score;", me)
    go(page, base + "#/dienorastis")
    rej = page.locator("[data-catch]", has_text="Ne ta rūšis")
    rej.get_by_role("button", name="Nesutinku su sprendimu").click()
    rej.get_by_label("Kodėl laimikis turėtų būti įskaitytas?").fill("Tai tikrai ešerys")
    rej.get_by_role("button", name="Pateikti moderatoriui").click()
    expect(page.locator("#toast")).to_have_text("Ginčas pateiktas moderatoriui")
    d = fake(page, "return db.disputes[0];")
    assert d["catch_id"] == target and d["user_id"] == me and d["status"] == "open", d
    dup = page.evaluate("(id) => window.__zt.backend.openDispute(id, 'dar kartą').then(() => 'ok', e => e.message)", target)
    assert dup == "Ginčas dėl šio laimikio jau pateiktas", dup
    go(page, base + "#/moderavimas/gincai")
    expect(page.locator(".quote")).to_have_text("Tai tikrai ešerys")
    expect(page.locator("[data-d]")).to_contain_text("Atmesta: Ne ta rūšis")
    page.get_by_role("button", name="Įskaityti").click()
    expect(page.locator("#toast")).to_have_text("Laimikis įskaitytas")
    assert fake(page, "return db.catches.find(c => c.id === arg).status;", target) == "approved"
    assert fake(page, "return db.profiles.find(p => p.id === arg).trust_score;", me) == min(100, trust0 + 5)
    step("ginčas: pateikimas, dublio apsauga, įskaitymas su patikimumo grąžinimu")

    # Moderatorių komanda
    go(page, base + "#/moderavimas/komanda")
    page.get_by_label("Pridėti moderatorių pagal slapyvardį").fill("kitas_zvejys")
    page.get_by_role("button", name="Paskirti moderatoriumi").click()
    expect(page.locator("#toast")).to_have_text("Moderatorius paskirtas")
    assert fake(page, "return db.profiles.find(p => p.nickname === 'Kitas_Zvejys').is_admin;") is True
    page.locator(".list-row", has_text="Kitas_Zvejys").get_by_role("button", name="Pašalinti").click()
    expect(page.locator("#toast")).to_have_text("Moderatorius pašalintas")
    page.locator(".list-row", has_text="(tu)").get_by_role("button", name="Pašalinti").click()
    expect(page.locator("#toast")).to_have_text("Negalima pašalinti paskutinio moderatoriaus")
    step("moderatorių skyrimas per serverio funkciją")

    # „Nieko nekibo“ – privatus įrašas serveryje
    go(page, base + "#/dienorastis")
    page.get_by_role("button", name="Nieko nekibo").click()
    page.get_by_label("Kiek valandų").fill("2")
    page.locator("[data-blank-form]").get_by_label("Pastabos (nebūtina)").fill("Drumstas vanduo")
    page.locator("[data-blank-form]").get_by_role("button", name="Išsaugoti").click()
    expect(page.locator(".trip-card")).to_contain_text("Nieko nekibo · 2 val.")
    trips = fake(page, "return db.blank_trips;")
    assert len(trips) == 1 and trips[0]["user_id"] == me and trips[0]["notes"] == "Drumstas vanduo" and trips[0]["hours"] == 2, trips
    ins = calls(page, "from", table="blank_trips", op="insert")[-1]["rows"][0]
    assert "user_id" not in ins, f"savininką nustato serveris, ne programėlė: {ins}"
    step("„Nieko nekibo“ išsaugoma serveryje be user_id iš kliento")

    # Pranešimas apie įtartiną laimikį ir moderatoriaus sprendimas
    go(page, base + "#/l/cccccccc-0000-4000-8000-000000000002")
    page.get_by_role("button", name="Pranešti apie įtartiną laimikį").click()
    page.get_by_role("radio", name="Ne ta rūšis").click()
    page.locator("[data-report-form]").get_by_role("button", name="Pranešti").click()
    expect(page.locator("[data-reported]")).to_be_visible()
    rep_rows = fake(page, "return db.catch_reports;")
    assert len(rep_rows) == 1 and rep_rows[0]["reporter_id"] == me and rep_rows[0]["reason"] == "wrong_species", rep_rows
    dup = page.evaluate("() => window.__zt.backend.reportCatch('cccccccc-0000-4000-8000-000000000002', 'other', '').then(() => 'ok', e => e.message)")
    assert dup == "Apie šį laimikį jau pranešei", dup
    own_id = fake(page, "return db.catches.find(c => c.user_id === arg && c.status === 'approved').id;", me)
    res = page.evaluate("(id) => window.__zt.backend.reportCatch(id, 'other', '').then(() => 'ok', e => e.message)", own_id)
    assert res != "ok", "apie savo laimikį pranešti negalima"
    go(page, base + "#/moderavimas/pranesimai")
    g = page.locator("[data-group]")
    expect(g).to_have_count(1)
    expect(g).to_contain_text("Ne ta rūšis")
    expect(g).to_contain_text("Ecimas_LT")
    trust0 = fake(page, "return db.profiles.find(p => p.nickname === 'Kitas_Zvejys').trust_score;")
    g.get_by_role("button", name="Atmesti laimikį").click()
    expect(page.locator("#toast")).to_have_text("Laimikis atmestas")
    assert fake(page, "return db.catches.find(c => c.id === 'cccccccc-0000-4000-8000-000000000002').status;") == "rejected"
    assert fake(page, "return db.profiles.find(p => p.nickname === 'Kitas_Zvejys').trust_score;") == trust0 - 5
    assert calls(page, "rpc", name="resolve_report")
    step("pranešimas apie laimikį: įrašas, dublio ir savo laimikio apsauga, moderatorius atmeta")

    # Organizatoriaus pranešimas
    nt = page.evaluate("""() => window.__zt.backend.createTournament({ title: 'Pranešimų bandymas', format: 'biggest', top_n: 3,
        min_length_mm: 0, starts_at: new Date(Date.now() + 864e5).toISOString(), ends_at: new Date(Date.now() + 2 * 864e5).toISOString(),
        species_ids: [], visibility: 'public', leaderboard_hidden: false, prize_fund_cents: 0, prize_split: null, sponsors: [] })""")
    go(page, base + f"#/t/{nt}")
    page.get_by_label("Naujas pranešimas visiems dalyviams").fill("Startas rytoj 6 val.")
    page.get_by_role("button", name="Siųsti dalyviams").click()
    expect(page.locator(".ann")).to_contain_text("Startas rytoj 6 val.")
    ann = fake(page, "return db.tournament_announcements;")
    assert len(ann) == 1 and ann[0]["author_id"] == me and ann[0]["tournament_id"] == nt, ann
    res = page.evaluate("(t) => window.__zt.backend.postAnnouncement(t, 'Ne mano turnyras').then(() => 'ok', e => e.message)", T1)
    assert res != "ok", "ne organizatorius negali rašyti pranešimų"
    step("organizatoriaus pranešimas: tik organizatorius, autorių nustato serveris")

    # Turnyro redagavimas ir ištrynimas (savo, iki starto); svetimo – ne
    tid = fake(page, "return db.tournaments.find(t => t.title === 'Ešerių savaitgalis').id;")
    go(page, base + f"#/t/{tid}/redaguoti")
    page.get_by_label("Pavadinimas", exact=True).fill("Ešerių savaitgalis+")
    page.get_by_role("button", name="Tik su kvietimu").click()
    page.get_by_label("Daiktiniai prizai (nebūtina)").fill("Kepurė")
    page.get_by_label("Fondo suma, €").fill("250,50")
    page.get_by_role("button", name="Trims: 50 / 30 / 20").click()
    page.get_by_role("button", name="Pridėti rėmėją").click()
    page.get_by_label("Rėmėjo 1 pavadinimas").fill("  Žvejų klubas  ")
    page.get_by_label("Rėmėjo 1 įnašas, €").fill("100")
    page.get_by_role("button", name="Pridėti rėmėją").click()
    page.get_by_label("Rėmėjo 2 pavadinimas").fill("Ežero parduotuvė")
    page.get_by_label("Rėmėjo 2 svetainė").fill("https://example.com")
    page.locator("[data-form]").get_by_role("button", name="Lydeka").click()
    page.get_by_role("button", name="Išsaugoti pakeitimus").click()
    expect(page.get_by_role("heading", name="Ešerių savaitgalis+")).to_be_visible()
    expect(page.locator("[data-fund]")).to_have_text("250,50 €")
    expect(page.locator(".prize-card .list-row").nth(0)).to_contain_text("125,25 €")
    expect(page.locator(".prize-card .list-row").nth(2)).to_contain_text("50,10 €")
    t = fake(page, "return db.tournaments.find(t => t.id === arg);", tid)
    assert t["visibility"] == "private" and t["prizes"] == "Kepurė", t
    assert t["prize_fund_cents"] == 25050 and t["prize_split"] == [50, 30, 20], t
    assert "sponsor_name" not in [k for k, v in t.items() if v], "senų rėmėjo laukų nebenaudojam"
    sp = fake(page, "return db.tournament_sponsors.filter(x => x.tournament_id === arg).sort((a, b) => a.sort - b.sort);", tid)
    assert [(x["name"], x["url"], x["amount_cents"], x["sort"]) for x in sp] == [
        ("Žvejų klubas", None, 10000, 0), ("Ežero parduotuvė", "https://example.com", None, 1)], sp
    res = page.evaluate("(id) => window.__zt.backend.updateTournament(id, { sponsors: [{ name: 'X', url: 'javascript:1' }] }).then(() => 'ok', e => e.code)", T1)
    assert res != "ok", "svetimo prasidėjusio turnyro rėmėjų keisti negalima"
    assert sorted(x["species_id"] for x in fake(page, "return db.tournament_species.filter(x => x.tournament_id === arg);", tid)) == [1, 2]
    go(page, base + f"#/t/{T1}/redaguoti")
    expect(page.get_by_text("Redaguoti negalima")).to_be_visible()
    res = page.evaluate("(id) => window.__zt.backend.updateTournament(id, { title: 'Pavogta' }).then(() => 'ok', e => e.message)", T1)
    assert res == "Turnyras jau prasidėjo – keisti nebegalima", res
    res = page.evaluate("(id) => window.__zt.backend.deleteTournament(id).then(() => 'ok', e => e.message)", T1)
    assert res == "Prasidėjusio turnyro ištrinti negalima", res
    assert fake(page, "return db.tournaments.find(t => t.id === arg).title;", T1) == "Testo lydekų taurė"
    go(page, base + f"#/t/{tid}/redaguoti")
    page.get_by_role("button", name="Ištrinti turnyrą").click()
    expect(page.locator("#toast")).to_have_text("Turnyras ištrintas")
    assert fake(page, "return db.tournaments.some(t => t.id === arg) || db.entries.some(e => e.tournament_id === arg);", tid) is False
    step("redagavimas ir ištrynimas: savo iki starto – taip, svetimo prasidėjusio – ne")

    # Privatus turnyras: nesimato sąraše, kvietimas, paslėpta lentelė
    fake(page, "db.profiles.find(p => p.id === arg).is_admin = false; window.__fakeDb.save();", me)
    page.evaluate("async () => { window.__zt.state.profile = await window.__zt.backend.myProfile(); }")
    go(page, base + "#/")
    page.get_by_role("button", name=re.compile("^Vyksta")).click()
    expect(page.locator(".t-card", has_text="Slaptas klubo turnyras")).to_have_count(0)
    res = page.evaluate("(id) => window.__zt.backend.join(id).then(() => 'ok', e => e.code)", T2)
    assert res == "42501", f"prisijungti prie privataus be kvietimo neturėtų pavykti: {res}"
    go(page, base + "#/profilis")
    page.get_by_role("button", name="Atsijungti").click()
    go(page, base + "#/kvietimas/b1b2b3b4b5")
    expect(page.get_by_role("heading", name="Slaptas klubo turnyras")).to_be_visible()
    page.get_by_role("link", name="Prisijungti ir dalyvauti").click()
    page.get_by_label("El. paštas").fill("ecimas@pastas.lt")
    page.get_by_role("button", name="Siųsti nuorodą").click()
    page.get_by_role("button", name="Laiške yra kodas?").click()
    page.get_by_label("Kodas iš laiško").fill("123456")
    page.get_by_role("button", name="Prisijungti").click()
    expect(page.get_by_role("button", name="Dalyvauti")).to_be_visible()  # grįžo į kvietimą
    assert page.evaluate("() => location.hash") == "#/kvietimas/b1b2b3b4b5"
    page.get_by_role("button", name="Dalyvauti").click()
    expect(page.locator("#toast")).to_have_text("Užsiregistravai į turnyrą")
    expect(page.get_by_role("heading", name="Slaptas klubo turnyras")).to_be_visible()
    expect(page.get_by_text("Lentelė paslėpta iki turnyro pabaigos.")).to_be_visible()
    expect(page.locator(".list-row", has_text="Kitas_Zvejys")).to_have_count(0)
    go(page, base + f"#/t/{T2}/lentele")
    expect(page.get_by_text("Paslėpta iki pabaigos")).to_be_visible()
    go(page, base + f"#/t/{T2}/tv")
    expect(page.locator(".tv-empty")).to_contain_text("paslėpta")
    expect(page.locator(".tv-row")).to_have_count(0)
    lb = page.evaluate("(id) => window.__zt.backend.leaderboard(id)", T2)
    me2 = fake(page, "return db.profiles.find(p => p.nickname === 'Ecimas_LT').id;")
    assert lb and all(r["user_id"] == me2 and r["rank"] is None for r in lb), f"paslėptoje lentelėje tik sava eilutė be vietos: {lb}"
    go(page, base + "#/kvietimas/ffffffffff")
    expect(page.get_by_text("Kvietimas negalioja")).to_be_visible()
    step("privatus turnyras: nematomas, kvietimas išlieka per prisijungimą, lentelė paslėpta")

    # Vėlyva registracija: turnyras prasidėjo prieš 3 val., registruotis leista tik 1 val. po starto
    T3 = "tttttttt-0000-4000-8000-000000000003"
    go(page, base + f"#/t/{T3}")
    expect(page.get_by_role("heading", name="Uždaros registracijos turnyras")).to_be_visible()
    expect(page.locator(".reg-closed")).to_have_text("Registracija baigėsi")
    expect(page.get_by_role("button", name="Dalyvauti")).to_have_count(0)
    expect(page.locator(".list-row", has_text="Registracija")).to_contain_text("Iki ")
    res = page.evaluate("(id) => window.__zt.backend.join(id).then(() => 'ok', e => e.code)", T3)
    assert res == "42501", f"registracijai pasibaigus prisijungti neturėtų pavykti: {res}"
    go(page, base + "#/kvietimas/c1c2c3c4c5")
    expect(page.get_by_text("Kvietimas negalioja")).to_be_visible()
    res = page.evaluate("() => window.__zt.backend.joinWithInvite('c1c2c3c4c5').then(() => 'ok', e => e.message)")
    assert res == "Registracija į šį turnyrą jau baigėsi", res
    go(page, base + f"#/t/{T2}")
    expect(page.locator(".list-row", has_text="Registracija")).to_contain_text("Iki pabaigos")
    step("vėlyva registracija: pasibaigus – mygtuko nėra, serveris ir kvietimas atmeta")

    # Duomenų eksportas
    go(page, base + "#/profilis")
    with page.expect_download() as dl:
        page.get_by_role("button", name="Atsisiųsti mano duomenis").click()
    data = json.loads(pathlib.Path(dl.value.path()).read_text())
    assert data["email"] == "ecimas@pastas.lt" and data["profile"]["id"] == me
    assert all(c["user_id"] == me for c in data["catches"]) and len(data["catches"]) >= 2
    assert any(e["tournament_id"] == T2 for e in data["entries"])
    assert len(data["disputes"]) == 1
    assert len(data["blank_trips"]) == 1 and len(data["catch_reports"]) == 1, (data.get("blank_trips"), data.get("catch_reports"))
    step("duomenų eksportas: tik savi duomenys")

    # Paskyros ištrynimas: kol funkcija neįdiegta – aiškus pranešimas; paskui – pilnas
    page.evaluate("() => { window.__sbFail.noDeletion = true; }")
    page.get_by_role("button", name="Ištrinti paskyrą").first.click()
    page.get_by_label("Patvirtinimui įrašyk IŠTRINTI").fill("IŠTRINTI")
    page.locator("[data-delete-confirm]").click()
    expect(page.locator("[data-delete-status]")).to_contain_text("laikinai neprieinamas")
    assert fake(page, "return db.profiles.some(p => p.id === arg);", me)
    page.evaluate("() => { window.__sbFail.noDeletion = false; }")
    page.locator("[data-delete-confirm]").click()
    expect(page.locator("#toast")).to_have_text("Paskyra ištrinta")
    expect(page.get_by_role("heading", name="Turnyrai", level=1)).to_be_visible()
    left = fake(page, """return { p: db.profiles.some(p => p.id === arg), c: db.catches.some(c => c.user_id === arg),
        e: db.entries.some(e => e.user_id === arg), d: db.disputes.length, t: db.tournaments.some(t => t.organizer_id === arg) };""", me)
    assert left == {"p": False, "c": False, "e": False, "d": 0, "t": False}, left
    assert calls(page, "list") and calls(page, "remove"), "nuotraukos turi būti ištrintos"
    order = [c["name"] for c in calls(page, "rpc") if "account_deletion" in c.get("name", "")]
    assert order[-2:] == ["begin_account_deletion", "finish_account_deletion"], order
    go(page, base + "#/dienorastis")
    expect(page.get_by_role("link", name="Prisijungti")).to_be_visible()
    step("paskyros ištrynimas: neįdiegus – pranešimas, įdiegus – viskas ištrinta")


def google_login_test(page, base, auth_settings):
    # Kol Google neįjungtas Supabase – mygtuko nėra
    go(page, base + "#/prisijungti")
    expect(page.get_by_role("heading", name="Prisijungti")).to_be_visible()
    page.wait_for_timeout(300)
    expect(page.get_by_role("button", name="Prisijungti su Google")).to_be_hidden()
    # Įjungus – mygtukas atsiranda ir prisijungia
    auth_settings["google"] = True
    page.goto("about:blank")
    page.goto(base + "#/prisijungti")
    expect(page.get_by_role("button", name="Prisijungti su Google")).to_be_visible()
    expect(page.get_by_text("arba el. paštu")).to_be_visible()
    page.get_by_role("button", name="Prisijungti su Google").click()
    expect(page.locator("#toast")).to_have_text("Prisijungei")
    assert page.evaluate("() => location.hash") == "#/profilis"
    oc = page.evaluate("() => JSON.parse(localStorage.getItem('fake-oauth-call'))")
    assert oc == {"provider": "google", "redirectTo": base, "queryParams": {"prompt": "select_account"}}, oc
    expect(page.locator(".nick-card")).to_contain_text("Pasirink slapyvardį")
    page.get_by_role("button", name="Pasirinkti slapyvardį").click()
    expect(page.get_by_label("Slapyvardis (matomas kitiems)")).to_be_focused()
    page.get_by_label("Slapyvardis (matomas kitiems)").fill("Google_Zvejys")
    page.get_by_role("button", name="Išsaugoti").click()
    expect(page.get_by_role("heading", name="Google_Zvejys")).to_be_visible()
    expect(page.locator(".nick-card")).to_have_count(0)
    page.goto(base + "#/")
    expect(page.locator("[data-nick-banner]")).to_have_count(0)
    step("prisijungimas su Google: mygtukas tik įjungus, grįžimas, slapyvardžio pasirinkimas")


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
        ctx.route(base_mod.METEO, base_mod.fake_meteo)
        auth_settings = {"google": False}
        ctx.route(re.compile(r"https://fake\.supabase\.co/auth/v1/settings"), lambda r: r.fulfill(
            status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"},
            body=json.dumps({"external": {"google": auth_settings["google"], "email": True}})))
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
        page.get_by_role("button", name="Siųsti nuorodą").click()
        expect(page.get_by_text("Patikrink el. paštą")).to_be_visible()
        expect(page.get_by_label("Kodas iš laiško")).to_be_hidden()
        page.get_by_role("button", name="Laiške yra kodas?").click()
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
        page.get_by_label("Pavadinimas", exact=True).fill("Ešerių savaitgalis")
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

        # 11. Grįžimas iš laiško nuorodos: pasibaigusi nuoroda ir sėkmingas prisijungimas
        page.goto("about:blank")
        page.goto(base + "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired")
        expect(page.get_by_role("heading", name="Prisijungti")).to_be_visible()
        expect(page.locator("#toast")).to_have_text("Nuoroda nebegalioja – paprašyk naujos")
        assert "error" not in page.evaluate("() => location.hash")
        page.evaluate("""() => {
            const p = window.__fakeDb.get().profiles.find(x => x.nickname === 'Ecimas_LT');
            localStorage.setItem('fake-sb-session', JSON.stringify({ access_token: 'x', user: { id: p.id, email: p.email } }));
        }""")
        page.goto("about:blank")
        page.goto(base + "#access_token=abc&expires_in=3600&refresh_token=def&token_type=bearer&type=magiclink")
        expect(page.get_by_role("heading", name="Ecimas_LT")).to_be_visible()
        expect(page.locator("#toast")).to_have_text("Prisijungei")
        assert page.evaluate("() => location.hash") == "#/profilis"
        step("grįžimas iš laiško nuorodos (pasibaigusi ir sėkminga)")

        more_real_tests(page, base)
        google_login_test(page, base, auth_settings)

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
