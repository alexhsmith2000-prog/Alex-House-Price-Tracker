#!/usr/bin/env python3
"""Download NSW Valuer General bulk property sales and build data/sales.json.

Free, public, official sales data (contract date, price, address locality,
zoning, land area, strata). Published weekly by the NSW Valuer General.
Runs daily from GitHub Actions; files already processed are skipped, so a run
with nothing new does no downloading beyond the index page.

Only Python's standard library is used.
"""
import csv
import gzip
import io
import json
import os
import re
import sys
import time
import urllib.request
import zipfile
from datetime import date, datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
DB_PATH = os.path.join(DATA, "sales_db.csv.gz")    # full working copy (not loaded by the app)
META_PATH = os.path.join(DATA, "meta.json")
OUT_PATH = os.path.join(DATA, "sales.json")        # compact file the app reads

START_YEAR = int(os.environ.get("START_YEAR", "2024"))
# Northern Rivers postcodes: Kyogle/Bonalbo 2469, 2474-2476; Casino 2470; Coraki/Woodburn 2471-2472;
# Evans Head 2473; Alstonville/Wollongbar 2477; Ballina/Lennox 2478; Bangalow 2479; Lismore 2480.
POSTCODES = set(os.environ.get("POSTCODES", "2469,2470,2471,2472,2473,2474,2475,2476,2477,2478,2479,2480").split(","))

INDEX_PAGES = [
    "https://valuation.property.nsw.gov.au/embed/propertySalesInformation",
]
BASE = "https://www.valuergeneral.nsw.gov.au/__psi"
UA = "Mozilla/5.0 (compatible; northern-rivers-price-tracker/1.0; +https://github.com)"

DB_FIELDS = ["key", "district", "property_id", "sale_counter", "downloaded", "unit", "house", "street",
             "locality", "postcode", "area_m2", "contract", "settlement", "price", "zone", "nature",
             "purpose", "strata_lot", "dealing"]


def log(*a):
    print(*a, flush=True)


class Blocked(Exception):
    """The server refused us (HTTP 403)."""


def get(url, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code == 403:
                raise Blocked(url)
            log(f"  HTTP {e.code} for {url} (try {i + 1})")
        except Exception as e:  # network hiccup
            log(f"  {type(e).__name__}: {e} for {url} (try {i + 1})")
        time.sleep(2 ** (i + 1))
    raise RuntimeError(f"Failed to download {url}")


def discover():
    """Return {name: url} of yearly and weekly zip files we want."""
    found = {}
    for page in INDEX_PAGES:
        try:
            html = get(page, tries=2)
        except (RuntimeError, Blocked):
            html = None
        if not html:
            continue
        for href in re.findall(rb'href="([^"]+\.zip)"', html):
            url = href.decode()
            if url.startswith("/"):
                url = "https://www.valuergeneral.nsw.gov.au" + url
            m = re.search(r"/(yearly|weekly)/(\d{4}|\d{8})\.zip$", url)
            if m:
                found[f"{m.group(1)}/{m.group(2)}"] = url
        if found:
            log(f"Index page {page}: {len(found)} zip links")
            break
    if not found:
        log("No links found on index pages; probing known URL pattern instead")
    this_year = date.today().year
    # yearly files for completed years
    for y in range(START_YEAR, this_year):
        found.setdefault(f"yearly/{y}", f"{BASE}/yearly/{y}.zip")
    # weekly files (published on Mondays) for the current year, plus last year in case
    # the yearly file is not out yet
    d = date(this_year - 1, 1, 1)
    today = date.today()
    while d <= today:
        if d.weekday() == 0:
            k = d.strftime("%Y%m%d")
            found.setdefault(f"weekly/{k}", f"{BASE}/weekly/{k}.zip")
        d = date.fromordinal(d.toordinal() + 1)
    return found


def iter_dat(blob, name):
    """Yield (filename, text) for every .DAT inside a (possibly nested) zip."""
    try:
        z = zipfile.ZipFile(io.BytesIO(blob))
    except zipfile.BadZipFile:
        log(f"  {name}: not a zip, skipping")
        return
    for info in z.infolist():
        n = info.filename
        if n.lower().endswith(".zip"):
            yield from iter_dat(z.read(info), n)
        elif n.lower().endswith(".dat"):
            yield n, z.read(info).decode("latin-1")


def to_int(s):
    s = (s or "").strip()
    try:
        return int(float(s))
    except ValueError:
        return None


def parse_dat(text):
    """Parse 'B' (sale) records in the post-2001 Valuer General format."""
    for line in text.splitlines():
        if not line.startswith("B;"):
            continue
        f = line.split(";")
        if len(f) < 24:
            continue
        postcode = f[10].strip()
        if postcode not in POSTCODES:
            continue
        price = to_int(f[15])
        contract = f[13].strip() or f[14].strip()
        if not price or not re.fullmatch(r"\d{8}", contract):
            continue
        area = None
        a = f[11].strip()
        if a:
            try:
                area = float(a) * (10000 if f[12].strip().upper() == "H" else 1)
            except ValueError:
                area = None
        rec = {
            "district": f[1].strip(), "property_id": f[2].strip(), "sale_counter": f[3].strip(),
            "downloaded": f[4].strip(), "unit": f[6].strip(), "house": f[7].strip(), "street": f[8].strip().upper(),
            "locality": f[9].strip().upper(), "postcode": postcode,
            "area_m2": "" if area is None else str(round(area)), "contract": contract,
            "settlement": f[14].strip(), "price": str(price), "zone": f[16].strip().upper(),
            "nature": f[17].strip().upper(), "purpose": f[18].strip().upper(), "strata_lot": f[19].strip(),
            "dealing": f[23].strip(),
        }
        rec["key"] = f"{rec['district']}|{rec['property_id']}|{rec['sale_counter']}|{rec['contract']}"
        yield rec


def load_db():
    if not os.path.exists(DB_PATH):
        return {}
    with gzip.open(DB_PATH, "rt", newline="", encoding="utf-8") as fh:
        return {r["key"]: r for r in csv.DictReader(fh)}


def save_db(db):
    rows = sorted(db.values(), key=lambda r: (r["contract"], r["key"]))
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=DB_FIELDS)
    w.writeheader()
    w.writerows(rows)
    with gzip.GzipFile(DB_PATH, "wb", mtime=0) as fh:  # mtime=0 → identical bytes when unchanged
        fh.write(buf.getvalue().encode("utf-8"))


def build_output(db):
    """Compact columnar JSON for the phone app."""
    start = f"{START_YEAR}0101"
    rows = [r for r in db.values() if r["contract"] >= start]
    # one dealing can cover several lots for one total price: keep a single row for it
    seen, uniq = set(), []
    for r in sorted(rows, key=lambda r: (r["contract"], r["key"])):
        dk = (r["dealing"], r["price"]) if r["dealing"] else r["key"]
        if dk in seen:
            continue
        seen.add(dk)
        uniq.append(r)

    locs, loc_idx = [], {}
    dicts = {"zone": [], "purpose": [], "street": []}
    idx = {k: {} for k in dicts}

    def intern(kind, val):
        m = idx[kind]
        if val not in m:
            m[val] = len(dicts[kind])
            dicts[kind].append(val)
        return m[val]

    sales = []
    for r in uniq:
        lk = (r["locality"], r["postcode"])
        if lk not in loc_idx:
            loc_idx[lk] = len(locs)
            locs.append([r["locality"], r["postcode"]])
        sales.append([
            int(r["contract"]), loc_idx[lk], int(r["price"]),
            int(r["area_m2"]) if r["area_m2"] else None,
            intern("zone", r["zone"]), r["nature"][:1], intern("purpose", r["purpose"]),
            1 if r["strata_lot"] else 0, intern("street", r["street"]), r["house"],
        ])
    return {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "NSW Valuer General bulk property sales information",
        "fields": ["contract", "loc", "price", "area_m2", "zone", "nature", "purpose", "strata", "street", "house"],
        "localities": locs, "zones": dicts["zone"], "purposes": dicts["purpose"], "streets": dicts["street"],
        "sales": sales,
    }


def main():
    os.makedirs(DATA, exist_ok=True)
    meta = {"processed": []}
    if os.path.exists(META_PATH):
        with open(META_PATH) as fh:
            meta = json.load(fh)
    processed = set(meta.get("processed", []))
    db = load_db()
    log(f"Existing records: {len(db)}; processed files: {len(processed)}")

    files = discover()
    todo = sorted(k for k in files if k not in processed)
    # once a year's yearly file is processed, that year's weekly files are redundant
    done_years = {k.split("/")[1] for k in processed if k.startswith("yearly/")}
    todo = [k for k in todo if not (k.startswith("weekly/") and k.split("/")[1][:4] in done_years)]
    log(f"Files to check: {len(todo)}")

    changed = 0
    for k in todo:
        try:
            blob = get(files[k])
        except Blocked as e:
            log(f"BLOCKED: the Valuer General server refused the download ({e}).")
            log("It does not allow downloads from this machine. Run this script on your own computer,")
            log("or import the weekly file in the app instead. Nothing was changed.")
            sys.exit(2)
        if blob is None:
            # not published (yet): only remember 404s for weeks more than 3 weeks old
            if k.startswith("weekly/"):
                wk = datetime.strptime(k.split("/")[1], "%Y%m%d").date()
                if (date.today() - wk).days > 21:
                    processed.add(k)
            continue
        n = 0
        for fname, text in iter_dat(blob, k):
            for rec in parse_dat(text):
                old = db.get(rec["key"])
                if old is None or rec["downloaded"] >= old["downloaded"]:
                    db[rec["key"]] = rec
                    n += 1
        log(f"  {k}: {len(blob) // 1024} KB, {n} Northern Rivers sale records")
        changed += n
        processed.add(k)
        if k.startswith("yearly/"):
            yr = k.split("/")[1]
            processed.update(x for x in files if x.startswith(f"weekly/{yr}"))

    if not db:
        log("ERROR: no sales records at all — the download format or URLs may have changed.")
        sys.exit(1)

    save_db(db)
    out = build_output(db)
    with open(OUT_PATH, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    meta = {"processed": sorted(processed), "records": len(out["sales"]),
            "last_check": out["generated"],
            "latest_contract": max((s[0] for s in out["sales"]), default=None)}
    with open(META_PATH, "w") as fh:
        json.dump(meta, fh, indent=1)
    log(f"Done: {changed} new/updated records, {len(out['sales'])} sales in app file, latest contract {meta['latest_contract']}")


if __name__ == "__main__":
    main()
