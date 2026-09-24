"""Genera data/calles.json: banco de preguntas del simulador.

Fuentes:
  - data/zonificacion_parques.kml: mapa «Zonificación por Parques» (Google My Maps),
    exportado a KML. Cada zona trae los campos Parque y Coopera.
  - Ajuntament de València, geoportal (datos abiertos):
      capa 223 «Ejes de calle»: tramos de calle con rangos de portales por acera.
      capa 273 «Vías»: nombre oficial y traducción no oficial (castellano).

Método:
  Cada tramo de calle tiene un rango de portales en su acera izquierda (lf_add..lt_add)
  y en la derecha (rf_add..rt_add). Para cada acera se desplaza el eje 12 m hacia ese
  lado y se mira en qué zona cae. Así se resuelven bien las calles que hacen de frontera
  entre dos zonas (una acera en cada zona).
  - Si todas las aceras numeradas de una calle caen en la misma zona -> pregunta simple.
  - Si caen en varias zonas -> la pregunta se hace con número de portal.
  - Calles sin numeración: se asignan a una zona si >= 90 % de su eje está en ella;
    si no, se excluyen (puentes, autovías que cruzan varias zonas...).

Uso:  pip install -r tools/requirements.txt && python3 tools/build_data.py
"""
import collections
import json
import os
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date

import pyproj
from shapely.geometry import Polygon, shape
from shapely.ops import linemerge, transform, unary_union
from shapely.strtree import STRtree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KML = os.path.join(ROOT, "data", "zonificacion_parques.kml")
OUT = os.path.join(ROOT, "data", "calles.json")
GEOPORTAL = "https://geoportal.valencia.es/server/rest/services/OPENDATA/UrbanismoEInfraestructuras/MapServer/"
K = "{http://www.opengis.net/kml/2.2}"
OFFSET_M = 12  # distancia del eje a la que se evalúa cada acera
MIN_SHARE_SIN_NUMEROS = 0.9

to_utm = pyproj.Transformer.from_crs(4326, 25830, always_xy=True).transform
to_wgs = pyproj.Transformer.from_crs(25830, 4326, always_xy=True).transform


def fetch_layer(layer, geojson):
    feats, offset = [], 0
    while True:
        q = {"where": "1=1", "outFields": "*", "f": "geojson" if geojson else "json",
             "resultOffset": offset, "resultRecordCount": 2000, "orderByFields": "objectid"}
        if geojson:
            q["outSR"] = 4326
        url = GEOPORTAL + f"{layer}/query?" + urllib.parse.urlencode(q)
        page = json.load(urllib.request.urlopen(url, timeout=300))["features"]
        feats += page
        offset += len(page)
        if len(page) < 2000:
            return feats


def load_zones():
    zones = []
    for pm in ET.parse(KML).getroot().iter(K + "Placemark"):
        polys = [Polygon([tuple(map(float, c.split(",")[:2]))
                          for c in p.find(f"{K}outerBoundaryIs//{K}coordinates").text.split()])
                 for p in pm.iter(K + "Polygon")]
        if not polys:
            continue  # los puntos de los parques no son zonas
        d = {x.get("name"): x.find(K + "value").text for x in pm.iter(K + "Data")}
        g = transform(to_utm, unary_union(polys))
        zones.append({"zona": d["AreaName"], "parque": d["Parque"], "coopera": d["Coopera"],
                      "codigo": d["CTypeArea"], "geom": g if g.is_valid else g.buffer(0)})
    return zones


def single_line(g):
    if g.geom_type == "LineString":
        return g
    m = linemerge(g)
    return m if m.geom_type == "LineString" else max(m.geoms, key=lambda x: x.length)


def parts(g):
    return list(g.geoms) if hasattr(g, "geoms") else [g]


def rnd(coords):
    return [[round(x, 5), round(y, 5)] for x, y in coords]


def merge_tramos(ranges):
    """Agrupa rangos por paridad y fusiona los consecutivos de la misma zona."""
    out = []
    for parity in (1, 0):
        rs = sorted((a, b, z) for a, b, z in ranges if a % 2 == parity)
        cur = None
        for a, b, z in rs:
            if cur and cur[2] == z and a <= cur[1] + 2:
                cur[1] = max(cur[1], b)
            else:
                if cur:
                    out.append(cur)
                cur = [a, b, z]
        if cur:
            out.append(cur)
    return out


def main():
    zones = load_zones()
    tree = STRtree([z["geom"] for z in zones])

    def zone_at(pt):
        for i in tree.query(pt, predicate="within"):
            return int(i)
        return None

    def side_zone(line, dist):
        off = single_line(line).offset_curve(dist)
        if off.is_empty:
            off = single_line(line)
        votes = collections.Counter(zone_at(off.interpolate(f, normalized=True)) for f in (0.2, 0.5, 0.8))
        return votes.most_common(1)[0][0]

    print("Descargando ejes de calle y vías del geoportal...")
    ejes = fetch_layer(223, geojson=True)
    vias = {v["attributes"]["codvia"]: v["attributes"] for v in fetch_layer(273, geojson=False)}

    streets = collections.defaultdict(lambda: {"nombre": None, "ranges": [], "clen": collections.Counter(), "geoms": []})
    for f in ejes:
        p = f["properties"]
        if f["geometry"] is None or p["motivobaja"]:
            continue
        g = transform(to_utm, shape(f["geometry"]))
        s = streets[p["codvia"]]
        s["nombre"] = p["tipnomcalle"] or s["nombre"]
        s["geoms"].append(g)
        for z in tree.query(g, predicate="intersects"):
            s["clen"][int(z)] += g.intersection(zones[z]["geom"]).length
        # Acera izquierda (+) y derecha (-) respecto al sentido de digitalización
        for a, b, dist in ((p["lf_add"], p["lt_add"], OFFSET_M), (p["rf_add"], p["rt_add"], -OFFSET_M)):
            if a and b:
                z = side_zone(g, dist)
                if z is not None:
                    s["ranges"].append((min(a, b), max(a, b), z))

    calles, excluidas = [], []
    for cod, s in streets.items():
        nombre = (s["nombre"] or "").strip()
        total = sum(s["clen"].values())
        zonas_num = {r[2] for r in s["ranges"]}
        rec = {"id": cod, "n": nombre}
        v = vias.get(cod)
        if v and v.get("traducnooficial") and v["traducnooficial"] != v["nomoficial"]:
            rec["alt"] = v["traducnooficial"].strip()
        if not nombre:
            excluidas.append(("(tramo sin nombre, codvia " + str(cod) + ")", "sin nombre"))
            continue
        if len(zonas_num) == 1:
            rec["z"] = zonas_num.pop()
        elif len(zonas_num) > 1:
            rec["t"] = merge_tramos(set(s["ranges"]))
        elif total > 0 and max(s["clen"].values()) / total >= MIN_SHARE_SIN_NUMEROS:
            rec["z"] = s["clen"].most_common(1)[0][0]
        else:
            excluidas.append((nombre, "sin numeración y repartida entre zonas" if total else "fuera de las zonas"))
            continue
        u = unary_union(s["geoms"])
        if u.geom_type == "MultiLineString":
            u = linemerge(u)
        rec["g"] = [rnd(l.coords) for l in parts(transform(to_wgs, u.simplify(4)))]
        calles.append(rec)

    calles.sort(key=lambda c: c["n"])
    data = {
        "generado": date.today().isoformat(),
        "fuentes": {
            "zonas": "Bombers València – «Zonificación por Parques» (Google My Maps, exportado a KML)",
            "calles": "Ajuntament de València – geoportal, capas «Ejes de calle» (223) y «Vías» (273)",
        },
        "zonas": [{"zona": z["zona"], "parque": z["parque"], "coopera": z["coopera"], "codigo": z["codigo"],
                   "g": [rnd(p.exterior.coords) for p in parts(transform(to_wgs, z["geom"].simplify(3)))]}
                  for z in zones],
        "calles": calles,
        "excluidas": [e[0] for e in excluidas],
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
    simples = sum(1 for c in calles if "z" in c)
    print(f"{len(calles)} calles ({simples} en una sola zona, {len(calles) - simples} por número de portal)")
    print(f"{len(excluidas)} excluidas:")
    for e in excluidas:
        print("  -", *e)


if __name__ == "__main__":
    main()
