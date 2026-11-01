"""Tikras MapLibre (ne pakaitalas): ar žemėlapis turi aukštį, ar visi sluoksniai priimti ir ar taškai nupiešti.
MapLibre parsisiunčiamas iš GitHub (v4.7.1) į .cache/; OpenFreeMap užklausos pakeičiamos netikromis."""
import io
import json
import pathlib
import re
import sys
import urllib.request
import zipfile

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import run  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

CACHE = pathlib.Path(__file__).resolve().parents[2] / ".cache" / "maplibre-4.7.1.js"
URL = "https://github.com/maplibre/maplibre-gl-js/releases/download/v4.7.1/dist.zip"
STYLE = {"version": 8, "name": "fake-dark",
         "glyphs": "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
         "sources": {"openmaptiles": {"type": "vector", "url": "https://tiles.openfreemap.org/planet"}},
         "layers": [{"id": "bg", "type": "background", "paint": {"background-color": "#223344"}},
                    {"id": "water", "type": "fill", "source": "openmaptiles", "source-layer": "water", "paint": {"fill-color": "#113355"}}]}
CORS = {"Access-Control-Allow-Origin": "*"}


def maplibre_js():
    if not CACHE.exists():
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        data = urllib.request.urlopen(URL, timeout=60).read()
        CACHE.write_bytes(zipfile.ZipFile(io.BytesIO(data)).read("dist/maplibre-gl.js"))
    return CACHE.read_text()


def ofm(route):
    u = route.request.url
    if "/styles/" in u:
        route.fulfill(status=200, content_type="application/json", headers=CORS, body=json.dumps(STYLE))
    elif u.endswith("/planet"):
        route.fulfill(status=200, content_type="application/json", headers=CORS, body=json.dumps(
            {"tilejson": "3.0.0", "tiles": ["https://tiles.openfreemap.org/planet/x/{z}/{x}/{y}.pbf"], "minzoom": 0, "maxzoom": 14}))
    else:
        route.fulfill(status=204, headers=CORS, body="")


def main():
    ml = maplibre_js()
    httpd, base = run.serve()
    errors = []
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        ctx = b.new_context(viewport={"width": 400, "height": 860}, service_workers="block")
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.route(re.compile(r"https://fonts\.(googleapis|gstatic)\.com/.*"), lambda r: r.abort())
        pg.route(re.compile(r"https://(cdn\.jsdelivr\.net/npm|unpkg\.com)/maplibre-gl@.*"),
                 lambda r: r.fulfill(status=200, content_type="text/javascript", headers=CORS, body=ml))
        pg.route(re.compile(r"https://tiles\.openfreemap\.org/.*"), ofm)
        # Pasiekiam žemėlapio objektą tikrinimui.
        pg.add_init_script("""(() => { let v; Object.defineProperty(window, 'maplibregl', { configurable: true, get: () => v,
          set: (m) => { const O = m.Map; m.Map = class extends O { constructor(o) { super(o); window.__map = this;
            this.on('error', (e) => (window.__mlErrors ||= []).push(String(e?.error?.message || e))); } }; v = m; } }); })()""")
        pg.goto(base)
        pg.wait_for_timeout(1000)
        pg.goto(base + "#/zemelapis")
        pg.wait_for_selector("[data-map-wrap][data-engine]", timeout=20000)
        engine = pg.get_attribute("[data-map-wrap]", "data-engine")
        why = pg.evaluate("() => document.querySelector('[data-map-wrap]')?.dataset.mapWhy || ''")
        assert engine == "maplibre", f"turėjo įsikelti MapLibre, o įsikėlė {engine}: {why}"
        pg.wait_for_function("() => window.__map && window.__map.loaded()", timeout=20000)
        pg.wait_for_timeout(1500)
        st = pg.evaluate("""() => { const m = window.__map; const box = document.querySelector('[data-map]');
          return { h: box.clientHeight, layers: m.getStyle().layers.map((l) => l.id),
            drawn: [...new Set(m.queryRenderedFeatures().map((f) => f.layer.id))], errors: window.__mlErrors || [] }; }""")
        assert st["h"] > 300, f"žemėlapio aukštis {st['h']}"
        for lid in ["heat", "clusters", "cluster-count", "points", "point-count"]:
            assert lid in st["layers"], f"sluoksnis {lid} nepriimtas: {st}"
        assert "points" in st["drawn"] or "clusters" in st["drawn"], f"taškai nenupiešti: {st}"
        assert not [e for e in st["errors"] if "layer" in e.lower() or "expression" in e.lower()], st["errors"]
        if run.SHOTS:
            pg.screenshot(path=f"{run.SHOTS}/map-real.png")
        # Šiluma: perjungus turi būti matomas heatmap sluoksnis.
        pg.get_by_role("button", name="Šiluma").click()
        pg.wait_for_timeout(800)
        assert pg.evaluate("() => window.__map.getLayoutProperty('heat', 'visibility')") == "visible"
        b.close()
    httpd.shutdown()
    assert not errors, errors
    print("TIKRO MAPLIBRE TESTAS PRAĖJO:", st["drawn"])


if __name__ == "__main__":
    main()
