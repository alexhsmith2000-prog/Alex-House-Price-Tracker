/* Northern Rivers Prices — Sold-sales store: compact columns in IndexedDB, property-type classification, derived columns, importing records, and filtering sales for a search.
 * Part of the app; the files in js/ load in order and share one scope (see index.html). */
'use strict';

// ---------- sales data ----------
// Sales are kept as columns (typed arrays): half a million NSW sales take ~30 MB this way, and
// load from IndexedDB quickly. Row objects are tiny views onto the columns.
let C = null;            // stored columns + dictionaries (see emptyStore)
let N = 0;               // number of sales
let DER = null;          // derived columns: month index, type, position, keep-mask
let DATA_INFO = null;
let DATA_VER = 0;        // bumps whenever the data changes (clears caches)
let LOC_COUNTS = new Map(); // locality → { pc, n }
let FILES = { files: [], updated: null };

// Sort a sale into one of TYPES using strata, land use, zoning and land size.
const TOWN_ZONE = /^(R[1-4]|RU5|MU|B[1-8]|E1|E2)$/;
const RURAL_ZONE = /^(RU[1-4]|RU6|R5|C[1-4])$/;
function classify(s) {
  const z = s.zone, p = s.purpose, a = s.area;
  if (s.strata) return 'unit';
  if (/FARM|GRAZ|DAIRY|AGRIC|ORCHARD|PASTORAL|HORTIC|PLANTATION|POULTRY|CATTLE|BANANA|MACADAMIA/.test(p) && (a == null || a >= 100000)) return 'farm';
  if (/^(IN\d|SP\d|E3|E4|W\d|RE\d)$/.test(z) || /COMMERC|SHOP|OFFICE|INDUSTR|FACTORY|WAREHOUSE|HOTEL|MOTEL|SERVICE STATION|CHURCH|CARAVAN/.test(p)) return 'other';
  const rural = RURAL_ZONE.test(z) || (!TOWN_ZONE.test(z) && a != null && a >= 4000);
  if (rural) return a != null && a >= 400000 ? 'farm' : 'lifestyle';
  if (s.nature === 'V') return 'land';
  return 'house';
}

const COLS = { d: Uint32Array, price: Float64Array, area: Float64Array, loc: Uint32Array, street: Uint32Array, house: Uint32Array,
  zone: Uint16Array, purpose: Uint16Array, nature: Uint8Array, strata: Uint8Array, dl: Float64Array, dealing: Uint32Array, interest: Uint8Array, prop: Uint32Array };
const emptyStore = () => ({ v: 2, n: 0, ...Object.fromEntries(Object.entries(COLS).map(([k, T]) => [k, new T(0)])),
  dict: { loc: [], street: [], house: [], zone: [], purpose: [], dealing: [''] } });

const MONTH_STR = []; // month index → 'YYYY-MM'
const monthStr = (mi) => MONTH_STR[mi] || (MONTH_STR[mi] = `${Math.floor(mi / 12)}-${String((mi % 12) + 1).padStart(2, '0')}`);
const TYPE_IDS = TYPES.map((t) => t.id);

class Row {
  constructor(i) { this.i = i; }
  get d() { return C.d[this.i]; }
  get m() { return monthStr(DER.mi[this.i]); }
  get loc() { return DER.locName[C.loc[this.i]]; }
  get pc() { return DER.locPc[C.loc[this.i]]; }
  get price() { return C.price[this.i]; }
  get area() { const a = C.area[this.i]; return Number.isNaN(a) ? null : a; }
  get zone() { return C.dict.zone[C.zone[this.i]] || ''; }
  get purpose() { return C.dict.purpose[C.purpose[this.i]] || ''; }
  get nature() { return C.nature[this.i] ? String.fromCharCode(C.nature[this.i]) : ''; }
  get strata() { return !!C.strata[this.i]; }
  get street() { return C.dict.street[C.street[this.i]] || ''; }
  get house() { return C.dict.house[C.house[this.i]] || ''; }
  get type() { return TYPE_IDS[DER.type[this.i]]; }
  get lat() { const v = DER.lat[this.i]; return Number.isNaN(v) ? null : v; }
  get lon() { const v = DER.lon[this.i]; return Number.isNaN(v) ? null : v; }
  get level() { return DER.level[this.i]; } // 2 = house position, 1 = suburb centre, 0 = not placed
  get approx() { return DER.level[this.i] === 2 && DER.approx[this.i] === 1; }
}

// Derive month, type and map position for every sale; drop repeat lots of one multi-lot sale.
function derive() {
  N = C.n;
  const locName = [], locPc = [];
  for (const k of C.dict.loc) { const j = k.lastIndexOf('|'); locName.push(k.slice(0, j)); locPc.push(k.slice(j + 1)); }
  DER = { locName, locPc, mi: new Uint16Array(N), type: new Uint8Array(N), lat: new Float64Array(N).fill(NaN), lon: new Float64Array(N).fill(NaN),
    level: new Uint8Array(N), approx: new Uint8Array(N), keep: new Uint8Array(N) };
  const typeCache = new Map(), seenDeal = new Set();
  let excluded = 0;
  LOC_COUNTS = new Map();
  let latest = 0;
  const locCount = new Uint32Array(locName.length);
  for (let i = 0; i < N; i++) {
    const dg = C.dealing[i];
    // leave out records that aren't a normal sale of a whole property: token/family transfers and part shares
    if (C.price[i] < MIN_PRICE || (C.interest && C.interest[i] && C.interest[i] < 100)) { excluded++; continue; }
    if (dg) { const k = dg + '|' + C.price[i]; if (seenDeal.has(k)) continue; seenDeal.add(k); }
    DER.keep[i] = 1;
    const d = C.d[i];
    DER.mi[i] = Math.floor(d / 10000) * 12 + (Math.floor(d / 100) % 100) - 1;
    const a = C.area[i];
    const bucket = Number.isNaN(a) ? 'n' : a < 4000 ? 'a' : a < 100000 ? 'b' : a < 400000 ? 'c' : 'd';
    const tk = `${C.zone[i]}|${C.purpose[i]}|${C.nature[i]}|${C.strata[i]}|${bucket}`;
    let t = typeCache.get(tk);
    if (t === undefined) {
      t = TYPE_IDS.indexOf(classify({ zone: C.dict.zone[C.zone[i]] || '', purpose: C.dict.purpose[C.purpose[i]] || '', nature: C.nature[i] ? String.fromCharCode(C.nature[i]) : '',
        strata: !!C.strata[i], area: Number.isNaN(a) ? null : a }));
      typeCache.set(tk, t);
    }
    DER.type[i] = t;
    if (d > latest) latest = d;
    locCount[C.loc[i]]++;
  }
  locName.forEach((name, li) => {
    if (!locCount[li]) return;
    const c = LOC_COUNTS.get(name) || { pc: locPc[li], n: 0 }; c.n += locCount[li]; LOC_COUNTS.set(name, c);
  });
  placeAll();
  matchFlood();
  DATA_INFO = N ? { generated: FILES.updated, latest, excluded, needsReimport: N > 0 && !(C.interest && C.interest.length === N && C.interest.some((x) => x)) } : null;
  DATA_VER++; salesCache.clear(); streetMatchCache.clear(); RESALE = null; floodPtsCache = null; surfaceCache.clear(); LINFO = null; ADDR_SALES = null;
}

async function loadSales() {
  const [stored, geoRes, subRes] = await Promise.all([idbGet('store2'), fetch('data/geo.json').catch(() => null), fetch('data/suburbs.json').catch(() => null)]);
  C = stored && stored.v === 2 ? stored : emptyStore();
  FILES = (await idbGet('store2-files')) || { files: [], updated: null };
  FLOOD = (await idbGet('flood-levels')) || null;
  LISTINGS = (await idbGet('listings')) || { recs: {}, files: [] };
  try { if (geoRes && geoRes.ok) loadGeo(await geoRes.json()); } catch { /* house positions unavailable */ }
  try { if (subRes && subRes.ok) loadSuburbs(await subRes.json()); } catch { /* suburb positions unavailable */ }
  if (!stored) await migrateOldStore();
  if (C.n && (!C.prop || C.prop.length !== C.n)) await addPropIds();
  derive();
  render();
}

// sales imported before version 12 have no property id column: work it out from the stored keys
async function addPropIds() {
  const keys = (await idbGet('store2-keys')) || [];
  if (keys.length !== C.n) return;
  const prop = new Uint32Array(C.n);
  for (let i = 0; i < C.n; i++) prop[i] = propOfKey(keys[i]);
  C.prop = prop;
  try { await idbSet('store2', C); } catch { /* keep it in memory for this session */ }
}

// earlier versions kept Northern Rivers sales as a plain object: convert once
async function migrateOldStore() {
  const old = await idbGet('local-sales');
  if (!old || !old.records || !Object.keys(old.records).length) return;
  const b = builder();
  for (const [key, r] of Object.entries(old.records)) b.put(key, r);
  // those files were read for the Northern Rivers only: list them as still to import so the rest of NSW gets added
  await b.save([], old.updated);
  try { localStorage.setItem('nr-prices.reimport', '1'); } catch { /* ignore */ }
}

// the Valuer General property id is the 2nd part of a sale's key: district|property|sale counter|contract date
const propOfKey = (key) => { const p = parseInt(String(key).split('|')[1], 10); return Number.isFinite(p) && p > 0 && p < 4294967295 ? p : 0; };

// Import helper: grows columns as plain arrays, then saves them as typed arrays.
function builder() {
  // columns added in later versions are missing from older stores: start them as zeros
  const cols = Object.fromEntries(Object.entries(COLS).map(([k, T]) => [k, Array.from(C[k] || new T(C.n))]));
  const dict = structuredClone(C.dict);
  const idx = Object.fromEntries(Object.entries(dict).map(([k, arr]) => [k, new Map(arr.map((v, i) => [v, i]))]));
  const intern = (k, v) => { let i = idx[k].get(v); if (i === undefined) { i = dict[k].length; dict[k].push(v); idx[k].set(v, i); } return i; };
  let keys = null, keyIdx = null;
  const ensureKeys = async () => {
    if (keys) return;
    keys = (await idbGet('store2-keys')) || [];
    keyIdx = new Map(keys.map((k, i) => [k, i]));
  };
  let added = 0;
  return {
    ensureKeys,
    get added() { return added; },
    // r: [contract, locality, postcode, price, area|null, zone, nature, purpose, strata, street, downloaded, dealing, house, % interest (0 = not stated)]
    put(key, r) {
      if (!keyIdx) { keys = keys || []; keyIdx = keyIdx || new Map(); }
      const dl = Number(String(r[10] || '').replace(/\D/g, '').slice(0, 12)) || 0;
      let i = keyIdx.get(key);
      if (i !== undefined && dl < cols.dl[i]) return; // older copy of a sale we have
      if (i === undefined) { i = cols.d.length; keyIdx.set(key, i); keys.push(key); added++; }
      cols.d[i] = r[0]; cols.loc[i] = intern('loc', `${r[1]}|${r[2]}`); cols.price[i] = r[3]; cols.area[i] = r[4] == null ? NaN : r[4];
      cols.zone[i] = intern('zone', r[5] || ''); cols.nature[i] = r[6] ? r[6].charCodeAt(0) : 0; cols.purpose[i] = intern('purpose', r[7] || '');
      cols.strata[i] = r[8] ? 1 : 0; cols.street[i] = intern('street', r[9] || ''); cols.dl[i] = dl;
      cols.dealing[i] = r[11] ? intern('dealing', r[11]) : 0; cols.house[i] = intern('house', r[12] || ''); cols.interest[i] = r[13] || 0; cols.prop[i] = propOfKey(key);
    },
    async save(files, updated) {
      const store = { v: 2, n: cols.d.length, dict, ...Object.fromEntries(Object.entries(COLS).map(([k, T]) => [k, T.from(cols[k])])) };
      await idbSet('store2', store);
      await idbSet('store2-keys', keys || []);
      FILES = { files, updated };
      await idbSet('store2-files', FILES);
      C = store;
    },
  };
}

// street names: the records abbreviate (CENTRE ST), people often type them out (Centre Street)
const STREET_ABBR = { STREET: 'ST', ROAD: 'RD', AVENUE: 'AVE', DRIVE: 'DR', CRESCENT: 'CRES', PLACE: 'PL', COURT: 'CT', CLOSE: 'CL', PARADE: 'PDE',
  HIGHWAY: 'HWY', TERRACE: 'TCE', CIRCUIT: 'CCT', BOULEVARD: 'BVD', ESPLANADE: 'ESP', GROVE: 'GR', PARKWAY: 'PKWY', SQUARE: 'SQ', AV: 'AVE', CR: 'CRES' };
const normStreet = (t) => String(t).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).map((w) => STREET_ABBR[w] || w).join(' ');
const streetMatchCache = new Map();
function streetMatcher(text) {
  const q = normStreet(text);
  let ok = streetMatchCache.get(q);
  if (ok) return ok;
  ok = new Uint8Array(C.dict.street.length);
  C.dict.street.forEach((st, i) => { const n = normStreet(st); ok[i] = n === q || n.startsWith(q + ' ') || n.startsWith(q) ? 1 : 0; });
  if (streetMatchCache.size > 20) streetMatchCache.clear();
  streetMatchCache.set(q, ok);
  return ok;
}

const salesCache = new Map();
function salesFor(v) {
  if (!N) return [];
  const key = JSON.stringify([v.area, v.locs, v.types, v.min, v.max, v.shape, v.landMin, v.landMax, v.street, v.flood]);
  const hit = salesCache.get(key);
  if (hit) return hit; // shared, newest first: callers must not modify it
  const area = areaOf(v.area);
  const locSet = v.locs && v.locs.length ? new Set(v.locs) : null;
  const locOk = DER.locName.map((name, li) => areaHas(area, DER.locPc[li]) && (!locSet || locSet.has(name)));
  const typeOk = TYPE_IDS.map((t) => !v.types || !v.types.length || v.types.includes(t));
  const shape = v.shape || null;
  // a drawn part of town only uses house positions there; suburb centres are fine for big areas
  const fine = shape && (shape.type === 'circle' ? shape.r <= 3000 : polyAreaKm2(shape.pts) <= 30);
  const min = v.min || 0, max = v.max || Infinity;
  const landMin = v.landMin || 0, landMax = v.landMax || Infinity, landOn = !!(v.landMin || v.landMax);
  const streetOk = v.street ? streetMatcher(v.street) : null;
  const out = [];
  for (let i = 0; i < N; i++) {
    if (!DER.keep[i] || !locOk[C.loc[i]] || !typeOk[DER.type[i]]) continue;
    const p = C.price[i];
    if (p < min || p > max) continue;
    if (landOn) { const a = C.area[i]; if (!(a >= landMin && a <= landMax)) continue; } // no land size recorded → left out
    if (streetOk && !streetOk[C.street[i]]) continue;
    if (v.flood) {
      const fd = DER.flood[i];
      if (v.flood === 'unknown' ? !Number.isNaN(fd) || !DER.floodLoc[C.loc[i]] : Number.isNaN(fd)) continue;
      if ((v.flood === 'above' && fd < 0) || (v.flood === 'below' && fd >= 0) || (v.flood === 'below1' && fd >= -1)) continue;
      if ((v.flood === 'below2022' && overEvent(fd, 2022) >= 0) || (v.flood === 'above2022' && overEvent(fd, 2022) < 0)) continue;
      if ((v.flood === 'below2017' && overEvent(fd, 2017) >= 0) || (v.flood === 'only2022' && !(overEvent(fd, 2022) < 0 && overEvent(fd, 2017) >= 0))) continue;
    }
    if (shape) {
      const lvl = DER.level[i];
      if (!lvl || (fine && lvl === 1 && DER.houseRegion[C.loc[i]])) continue;
      if (!inShape(shape, DER.lat[i], DER.lon[i])) continue;
    }
    out.push(i);
  }
  out.sort((a, b) => C.d[b] - C.d[a]);
  const rows = out.map((i) => new Row(i));
  if (salesCache.size > 30) salesCache.clear();
  salesCache.set(key, rows);
  return rows;
}
