#!/usr/bin/env python3
"""One-off check: which areas does the NSW Planning Portal flood planning layer cover?"""
import json
import urllib.parse
import urllib.request

UA = "northern-rivers-price-tracker/1.0 (+https://github.com)"
LAYERS = {
    "ePlanning flood planning map (230)": "https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Hazard/MapServer/230",
    "Planning/Hazard flood planning (1)": "https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/Hazard/MapServer/1",
}
AREAS = {  # lon/lat boxes
    "Lismore": (153.22, -28.86, 153.33, -28.77),
    "Casino": (152.99, -28.90, 153.10, -28.82),
    "Coraki/Woodburn": (153.24, -29.08, 153.37, -28.95),
    "Evans Head": (153.39, -29.14, 153.45, -29.08),
    "Ballina": (153.52, -28.89, 153.62, -28.82),
    "Newcastle": (151.65, -32.96, 151.80, -32.86),
    "Lake Macquarie (Bonnells Bay)": (151.50, -33.13, 151.56, -33.08),
}


def get(url, params):
    q = urllib.parse.urlencode(params)
    req = urllib.request.Request(f"{url}/query?{q}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


for lname, url in LAYERS.items():
    print(f"\n=== {lname}")
    try:
        req = urllib.request.Request(f"{url}?f=json", headers={"User-Agent": UA})
        meta = json.load(urllib.request.urlopen(req, timeout=60))
        print("fields:", [f["name"] for f in meta.get("fields", [])])
        print("maxRecordCount:", meta.get("maxRecordCount"))
    except Exception as e:
        print("metadata failed:", e)
        continue
    for aname, (x1, y1, x2, y2) in AREAS.items():
        base = {"geometry": f"{x1},{y1},{x2},{y2}", "geometryType": "esriGeometryEnvelope", "inSR": 4326,
                "spatialRel": "esriSpatialRelIntersects", "f": "json"}
        try:
            n = get(url, {**base, "returnCountOnly": "true"}).get("count")
            sample = get(url, {**base, "outFields": "*", "returnGeometry": "false", "resultRecordCount": 3})
            attrs = [ft.get("attributes") for ft in sample.get("features", [])]
            print(f"{aname}: {n} polygons; sample: {json.dumps(attrs)[:400]}")
        except Exception as e:
            print(f"{aname}: query failed: {e}")
