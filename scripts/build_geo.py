#!/usr/bin/env python3
"""Build data/geo.json: map positions for Northern Rivers street addresses.

Source: G-NAF (Geocoded National Address File), free open government data
published quarterly on data.gov.au. The zip is ~1.5 GB, so this runs on
GitHub's servers every few months, not on the phone. The output only covers
the Northern Rivers postcodes and is a few MB.

The app matches each sale's street + house number + locality against this
file to place it on the map.

Only Python's standard library is used.
"""
import csv
import io
import json
import os
import re
import sys
import time
import urllib.request
import zipfile
from collections import defaultdict
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "geo.json")
POSTCODES = set(os.environ.get("POSTCODES", "2469,2470,2471,2472,2473,2474,2475,2476,2477,2478,2479,2480").split(","))
CKAN = "https://data.gov.au/data/api/3/action/package_show?id=19432f89-dc3a-4ef3-b943-5326ef1dbecc"
UA = "northern-rivers-price-tracker/1.0 (+https://github.com)"
WORK = os.environ.get("RUNNER_TEMP", "/tmp")

csv.field_size_limit(10_000_000)


def log(*a):
    print(*a, flush=True)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return urllib.request.urlopen(req, timeout=300)


def find_zip_url():
    if os.environ.get("GNAF_URL"):
        return os.environ["GNAF_URL"]
    try:
        res = json.load(fetch(CKAN))["result"]["resources"]
    except Exception as e:  # dataset id changed: search instead
        log(f"package_show failed ({e}); searching data.gov.au")
        found = json.load(fetch("https://data.gov.au/data/api/3/action/package_search?q=G-NAF%20geocoded%20national%20address%20file&rows=5"))
        res = [r for p in found["result"]["results"] if "g-naf" in (p.get("title", "") + p.get("name", "")).lower() for r in p["resources"]]
    for r in res:
        log(f"  resource: {r.get('name')!r} format={r.get('format')} url={r.get('url')}")
    zips = [r for r in res if str(r.get("url", "")).lower().endswith(".zip")]
    # prefer GDA2020 (current datum), newest first
    zips.sort(key=lambda r: ("gda2020" in (r.get("name", "") + r["url"]).lower(), r.get("last_modified") or r.get("created") or ""), reverse=True)
    if not zips:
        sys.exit("ERROR: no G-NAF zip found in the data.gov.au listing")
    return zips[0]["url"]


def download(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 100_000_000:
        log(f"Using cached {path}")
        return
    log(f"Downloading {url}")
    t = time.time()
    with fetch(url) as r, open(path, "wb") as fh:
        n = 0
        while True:
            chunk = r.read(8 << 20)
            if not chunk:
                break
            fh.write(chunk)
            n += len(chunk)
            if n % (200 << 20) < (8 << 20):
                log(f"  {n >> 20} MB")
    log(f"Downloaded {os.path.getsize(path) >> 20} MB in {time.time() - t:.0f}s")


def member(z, suffix):
    names = [n for n in z.namelist() if n.upper().endswith(suffix.upper())]
    if not names:
        sys.exit(f"ERROR: {suffix} not found in the G-NAF zip")
    return names[0]


def rows(z, suffix):
    name = member(z, suffix)
    log(f"Reading {name}")
    with z.open(name) as fh:
        yield from csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8", newline=""), delimiter="|")


def main():
    zpath = os.path.join(WORK, "gnaf.zip")
    download(find_zip_url(), zpath)
    z = zipfile.ZipFile(zpath)

    # 1. NSW addresses in our postcodes (principal, not retired)
    addr = {}
    for r in rows(z, "NSW_ADDRESS_DETAIL_psv.psv"):
        if r["POSTCODE"] not in POSTCODES or r.get("DATE_RETIRED") or r.get("ALIAS_PRINCIPAL", "P") != "P":
            continue
        try:
            num = int(r["NUMBER_FIRST"])
        except (TypeError, ValueError):
            continue
        addr[r["ADDRESS_DETAIL_PID"]] = (r["STREET_LOCALITY_PID"], r["LOCALITY_PID"], num)
    log(f"Addresses in postcodes: {len(addr)}")

    want_streets = {a[0] for a in addr.values()}
    want_locs = {a[1] for a in addr.values()}
    streets = {}
    for r in rows(z, "NSW_STREET_LOCALITY_psv.psv"):
        if r["STREET_LOCALITY_PID"] in want_streets:
            streets[r["STREET_LOCALITY_PID"]] = (r["STREET_NAME"].upper().strip(), (r.get("STREET_TYPE_CODE") or "").upper().strip())
    locs = {}
    for r in rows(z, "NSW_LOCALITY_psv.psv"):
        if r["LOCALITY_PID"] in want_locs:
            locs[r["LOCALITY_PID"]] = r["LOCALITY_NAME"].upper().strip()

    # street type abbreviations, e.g. ST / STREET, RD / ROAD
    types = {}
    for r in rows(z, "STREET_TYPE_AUT_psv.psv"):
        code = r["CODE"].upper().strip()
        for k in ("CODE", "NAME", "DESCRIPTION"):
            v = (r.get(k) or "").upper().strip()
            if v and len(v) <= 20:
                types[v] = code
    log(f"Street types: {len(types)}")

    # 2. positions
    pts = defaultdict(dict)  # "LOCALITY|NAME|TYPE" -> {number: (lat, lon)}
    for r in rows(z, "NSW_ADDRESS_DEFAULT_GEOCODE_psv.psv"):
        a = addr.get(r["ADDRESS_DETAIL_PID"])
        if not a or a[0] not in streets or a[1] not in locs:
            continue
        name, typ = streets[a[0]]
        try:
            lat, lon = float(r["LATITUDE"]), float(r["LONGITUDE"])
        except (TypeError, ValueError):
            continue
        key = f"{locs[a[1]]}|{name}|{typ}"
        pts[key].setdefault(a[2], (round(lat * 1e5), round(lon * 1e5)))

    out = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "G-NAF, Geoscape Australia (open data, data.gov.au)",
        "scale": 1e5,
        "types": types,
        # each street: flat list [number, lat*1e5, lon*1e5, number, lat, lon, ...] sorted by number
        "streets": {k: [x for n in sorted(v) for x in (n, v[n][0], v[n][1])] for k, v in sorted(pts.items())},
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    log(f"Wrote {OUT}: {len(pts)} streets, {sum(len(v) for v in pts.values())} numbered addresses, {os.path.getsize(OUT) >> 10} KB")
    if len(pts) < 500:
        sys.exit("ERROR: suspiciously few streets; the G-NAF format may have changed")


if __name__ == "__main__":
    main()
