/* Northern Rivers Prices — NSW sold-price tracker with filters and maps (offline PWA).
 * Sold prices: NSW Valuer General sales files, imported on the phone (IndexedDB).
 * Listing (asking) prices: entered by hand, stored on the phone. */
(() => {
  'use strict';

  const APP_VERSION = '22'; // keep in step with version.json and VERSION in sw.js

  // Show unexpected errors instead of failing silently, so they can be reported.
  const reportError = (msg) => {
    try { localStorage.setItem('nr-prices.lastError', `${new Date().toLocaleString('en-AU')}: ${msg}`); } catch { /* ignore */ }
    const t = document.getElementById('toast');
    if (t) { t.textContent = `Something went wrong: ${msg}`; t.hidden = false; setTimeout(() => { t.hidden = true; }, 8000); }
  };
  window.addEventListener('error', (e) => reportError(e.message || String(e.error)));
  window.addEventListener('unhandledrejection', (e) => reportError((e.reason && e.reason.message) || String(e.reason)));

  // ---------- reference data ----------
  // Areas are groups of postcodes. Outside the Northern Rivers they are broad regions, so edges are approximate.
  const AREAS = [
    { id: 'casino', group: 'Northern Rivers', name: 'Casino & district', pcs: '2470' },
    { id: 'lismore', group: 'Northern Rivers', name: 'Lismore & district', pcs: '2480' },
    { id: 'evans', group: 'Northern Rivers', name: 'Evans Head & Mid-Richmond', pcs: '2471-2473' },
    { id: 'ballina', group: 'Northern Rivers', name: 'Ballina, Lennox & Alstonville', pcs: '2477-2478' },
    { id: 'kyogle', group: 'Northern Rivers', name: 'Kyogle & Upper Richmond', pcs: '2469,2474-2476' },
    { id: 'bangalow', group: 'Northern Rivers', name: 'Bangalow', pcs: '2479' },
    { id: 'all', group: 'Northern Rivers', name: 'All Northern Rivers', pcs: '2469-2480' },
    { id: 'tweed', group: 'North Coast', name: 'Tweed & Byron', pcs: '2481-2490' },
    { id: 'clarence', group: 'North Coast', name: 'Clarence Valley (Grafton, Yamba)', pcs: '2460-2466' },
    { id: 'midnorth', group: 'North Coast', name: 'Mid North Coast (Coffs, Port Macquarie)', pcs: '2415-2459' },
    { id: 'newcastle', group: 'Hunter', name: 'Newcastle & Lake Macquarie', pcs: '2264-2267,2278,2280-2308' },
    { id: 'maitland', group: 'Hunter', name: 'Maitland, Cessnock & Port Stephens', pcs: '2309-2324' },
    { id: 'hunter', group: 'Hunter', name: 'Upper Hunter', pcs: '2325-2339' },
    { id: 'centralcoast', group: 'Sydney & surrounds', name: 'Central Coast', pcs: '2250-2263' },
    { id: 'sydney', group: 'Sydney & surrounds', name: 'Greater Sydney & Blue Mountains', pcs: '2000-2249,2555-2574,2740-2786' },
    { id: 'illawarra', group: 'South', name: 'Illawarra & South Coast', pcs: '2500-2551' },
    { id: 'highlands', group: 'South', name: 'Southern Highlands & Tablelands', pcs: '2575-2599' },
    { id: 'monaro', group: 'South', name: 'Queanbeyan, Snowy & Monaro', pcs: '2600-2639' },
    { id: 'newengland', group: 'Inland', name: 'New England & North West', pcs: '2340-2411' },
    { id: 'riverina', group: 'Inland', name: 'Riverina & Murray', pcs: '2640-2739' },
    { id: 'centralwest', group: 'Inland', name: 'Central West & Orana', pcs: '2787-2879' },
    { id: 'farwest', group: 'Inland', name: 'Far West', pcs: '2880-2899' },
    { id: 'nsw', group: 'Whole state', name: 'All of NSW', pcs: null },
  ];
  for (const a of AREAS) a.ranges = a.pcs ? a.pcs.split(',').map((r) => { const [lo, hi] = r.split('-').map(Number); return [lo, hi || lo]; }) : null;
  const areaHas = (area, pc) => { if (!area.ranges) return true; const n = +pc; return area.ranges.some(([lo, hi]) => n >= lo && n <= hi); };
  const TYPES = [
    { id: 'house', name: 'House in town' },
    { id: 'unit', name: 'Unit / townhouse' },
    { id: 'land', name: 'Vacant block (town)' },
    { id: 'lifestyle', name: 'Rural lifestyle / acreage' },
    { id: 'farm', name: 'Farm (40 ha+)' },
    { id: 'other', name: 'Commercial / other' },
  ];
  const LAND_STEPS = [300, 450, 600, 800, 1000, 1500, 2000, 4000, 10000, 20000, 50000, 100000, 200000, 400000, 1000000];
  const PRICE_STEPS = [100e3, 200e3, 300e3, 400e3, 500e3, 600e3, 700e3, 800e3, 900e3, 1e6, 1.25e6, 1.5e6, 2e6, 2.5e6, 3e6, 5e6];
  const DEFAULT_VIEWS = [
    { id: 'v-casino', name: 'Casino', area: 'casino', locs: ['CASINO'], types: ['house', 'unit'], min: 0, max: 0 },
    { id: 'v-lismore', name: 'Lismore', area: 'lismore', locs: ['LISMORE', 'LISMORE HEIGHTS', 'EAST LISMORE', 'NORTH LISMORE', 'SOUTH LISMORE', 'GIRARDS HILL', 'GOONELLABAH'], types: ['house', 'unit'], min: 0, max: 0 },
    { id: 'v-evans', name: 'Evans Head', area: 'evans', locs: ['EVANS HEAD'], types: ['house', 'unit'], min: 0, max: 0 },
    { id: 'v-ballina', name: 'Ballina', area: 'ballina', locs: ['BALLINA', 'EAST BALLINA', 'WEST BALLINA'], types: ['house', 'unit'], min: 0, max: 0 },
  ];
  const PALETTE = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
  const RANGES = [{ key: 12, label: '1Y' }, { key: 24, label: '2Y' }, { key: 36, label: '3Y' }, { key: 0, label: 'All' }];
  const METRICS = [{ key: 'median', label: 'Median' }, { key: 'avg', label: 'Average' }, { key: 'both', label: 'Both' }];
  const MIN_PRICE = 10000; // below this it's a token or family transfer, not a market sale
  const MIN_SALES = 3; // months with fewer sales are left off the chart (too noisy)
  const PROVISIONAL_MONTHS = 2; // latest months are incomplete: sales take weeks to be reported
  const COMPARE = 'compare';

  // ---------- storage ----------
  const K = { entries: 'nr-prices.v1', prefs: 'nr-prices.prefs', views: 'nr-prices.views' };
  const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const safeSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
  const readJson = (k, fallback) => { try { const v = JSON.parse(safeGet(k)); return v ?? fallback; } catch { return fallback; } };

  let entries = readJson(K.entries, []); if (!Array.isArray(entries)) entries = [];
  let views = readJson(K.views, null); if (!Array.isArray(views) || !views.length) views = structuredClone(DEFAULT_VIEWS);
  const prefs = Object.assign({ view: views[0].id, metric: 'median', range: 24, smooth: 3, trend: true, floodLayer: '100' }, readJson(K.prefs, {}));
  if (prefs.view !== COMPARE && !views.some((v) => v.id === prefs.view)) prefs.view = views[0].id;
  if (!METRICS.some((m) => m.key === prefs.metric)) prefs.metric = 'median';

  const saveEntries = () => { entries.sort((a, b) => a.month.localeCompare(b.month)); if (!safeSet(K.entries, JSON.stringify(entries))) toast('Could not save on this device — export a backup!'); };
  const saveViews = () => safeSet(K.views, JSON.stringify(views));
  const savePrefs = () => safeSet(K.prefs, JSON.stringify(prefs));
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // ---------- helpers ----------
  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'checked' || k === 'selected') n[k] = !!v;
      else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : String(kid));
    return n;
  };
  const svgEl = (tag, attrs = {}) => { const n = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const fmtMoney = (v) => v == null ? '—' : '$' + Math.round(v).toLocaleString('en-AU');
  const fmtShort = (v) => {
    if (v == null) return '—';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'm';
    if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'k';
    return '$' + Math.round(v);
  };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtMonth = (m) => { const [y, mo] = m.split('-'); return `${MONTHS[+mo - 1]} ${y}`; };
  const fmtMonthShort = (m) => { const [y, mo] = m.split('-'); return `${MONTHS[+mo - 1]} ’${y.slice(2)}`; };
  const fmtDate = (n) => { const s = String(n); return `${+s.slice(6, 8)} ${MONTHS[+s.slice(4, 6) - 1]} ${s.slice(0, 4)}`; };
  const addMonths = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
  const monthDiff = (a, b) => { const [ya, ma] = a.split('-').map(Number); const [yb, mb] = b.split('-').map(Number); return (yb - ya) * 12 + (mb - ma); };
  const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const titleCase = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  const fmtArea = (m2) => m2 == null ? '' : m2 >= 10000 ? `${(m2 / 10000).toFixed(m2 >= 1e6 ? 0 : 1)} ha` : `${Math.round(m2).toLocaleString('en-AU')} m²`;
  const median = (arr) => { if (!arr.length) return null; const a = Float64Array.from(arr).sort(); const i = a.length >> 1; return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2; };
  const mean = (arr) => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null;
  const areaOf = (id) => AREAS.find((a) => a.id === id) || AREAS[AREAS.length - 1];
  const typeName = (id) => TYPES.find((t) => t.id === id)?.name || id;
  const viewColor = (v) => PALETTE[Math.max(0, views.indexOf(v)) % PALETTE.length];
  const isProvisional = (m) => { const d = monthDiff(m, thisMonth()); return d >= 0 && d <= PROVISIONAL_MONTHS; };

  function parsePrice(raw) {
    if (raw == null) return null;
    let s = String(raw).trim().toLowerCase().replace(/[$,\s]/g, '');
    if (!s) return null;
    let mult = 1;
    if (s.endsWith('k')) { mult = 1e3; s = s.slice(0, -1); } else if (s.endsWith('m')) { mult = 1e6; s = s.slice(0, -1); }
    const n = Number(s);
    return isFinite(n) && n >= 0 ? Math.round(n * mult) : NaN;
  }
  function parseMonth(raw) {
    const s = String(raw || '').trim();
    let m = s.match(/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?$/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
    m = s.match(/^(\d{1,2})[-/](\d{4})$/); if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
    m = s.match(/^([a-z]{3})[a-z]*[\s-]+(\d{2,4})$/i);
    if (m) { const i = MONTHS.findIndex((x) => x.toLowerCase() === m[1].toLowerCase()); if (i >= 0) return `${m[2].length === 2 ? '20' + m[2] : m[2]}-${String(i + 1).padStart(2, '0')}`; }
    return null;
  }

  let toastTimer;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, msg.length > 80 ? 9000 : 2800); }

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
    DATA_VER++; salesCache.clear(); streetMatchCache.clear(); RESALE = null; floodPtsCache = null; surfaceCache.clear();
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

  // ---------- map positions (G-NAF addresses, built on GitHub into data/geo.json) ----------
  let GEO = null;
  function loadGeo(json) {
    const byName = new Map();
    for (const k of Object.keys(json.streets)) {
      const nk = k.slice(0, k.lastIndexOf('|'));
      byName.set(nk, byName.has(nk) ? null : k); // null = several street types share the name: ambiguous
    }
    // common abbreviations in the sales records that the address file spells differently
    const extra = { AVE: 'AVENUE', AV: 'AVENUE', CRES: 'CRESCENT', CR: 'CRESCENT', CCT: 'CIRCUIT', HWY: 'HIGHWAY', TCE: 'TERRACE', BVD: 'BOULEVARD', BLVD: 'BOULEVARD',
      ESP: 'ESPLANADE', GR: 'GROVE', GRV: 'GROVE', PKWY: 'PARKWAY', PWY: 'PARKWAY', CL: 'CLOSE', CT: 'COURT', DR: 'DRIVE', PL: 'PLACE', RD: 'ROAD', ST: 'STREET', LN: 'LANE', SQ: 'SQUARE', WY: 'WAY', RDGE: 'RIDGE', CTR: 'CENTRE' };
    GEO = { types: { ...extra, ...(json.types || {}) }, streets: json.streets, byName, scale: json.scale || 1e5,
      postcodes: new Set(json.postcodes || ['2469', '2470', '2471', '2472', '2473', '2474', '2475', '2476', '2477', '2478', '2479', '2480']) };
  }
  let SUBURBS = null; // 'LOCALITY|POSTCODE' → [lat, lon]
  function loadSuburbs(json) {
    const pts = json.suburbs || {}, byName = new Map();
    for (const [k, p] of Object.entries(pts)) { // name-only lookup when the postcode differs: pick the biggest
      const name = k.slice(0, k.lastIndexOf('|'));
      const cur = byName.get(name);
      if (!cur || (p[2] || 0) > (cur[2] || 0)) byName.set(name, p);
    }
    SUBURBS = { pts, byName, scale: json.scale || 1e5 };
  }
  function houseSpot(street, houseNo, loc) {
    if (!GEO || !street) return null;
    const num = parseInt((String(houseNo).match(/\d+/) || [])[0], 10);
    if (!num) return null;
    const toks = street.trim().split(/\s+/);
    let name = street.trim(), typ = '';
    if (toks.length > 1 && GEO.types[toks[toks.length - 1]]) { typ = GEO.types[toks.pop()]; name = toks.join(' '); }
    let arr = GEO.streets[`${loc}|${name}|${typ}`];
    if (!arr) { const k = GEO.byName.get(`${loc}|${name}`) || GEO.byName.get(`${loc}|${street.trim()}`); if (k) arr = GEO.streets[k]; }
    if (!arr) return null;
    // exact number, else the nearest number on the same side of the street
    let best = -1, bestDiff = Infinity;
    for (let i = 0; i < arr.length; i += 3) {
      const diff = Math.abs(arr[i] - num) + ((arr[i] - num) % 2 ? 0.5 : 0);
      if (diff < bestDiff) { bestDiff = diff; best = i; if (diff === 0) break; }
    }
    if (best < 0 || bestDiff > 10) return null;
    return [arr[best + 1] / GEO.scale, arr[best + 2] / GEO.scale, bestDiff > 0 ? 1 : 0];
  }
  // House positions where we have them (Northern Rivers, Newcastle); suburb centres everywhere else.
  function placeAll() {
    const nl = DER.locName.length;
    const houseRegion = new Uint8Array(nl), subLat = new Float64Array(nl).fill(NaN), subLon = new Float64Array(nl).fill(NaN);
    for (let li = 0; li < nl; li++) {
      houseRegion[li] = GEO && GEO.postcodes.has(DER.locPc[li]) ? 1 : 0;
      const p = SUBURBS && (SUBURBS.pts[`${DER.locName[li]}|${DER.locPc[li]}`] || SUBURBS.byName.get(DER.locName[li]));
      if (p) { subLat[li] = p[0] / SUBURBS.scale; subLon[li] = p[1] / SUBURBS.scale; }
    }
    DER.houseRegion = houseRegion;
    const spotCache = new Map();
    for (let i = 0; i < N; i++) {
      if (!DER.keep[i]) continue;
      const li = C.loc[i];
      if (houseRegion[li]) {
        const k = `${li}|${C.street[i]}|${C.house[i]}`;
        let sp = spotCache.get(k);
        if (sp === undefined) { sp = houseSpot(C.dict.street[C.street[i]], C.dict.house[C.house[i]], DER.locName[li]); spotCache.set(k, sp); }
        if (sp) { DER.lat[i] = sp[0]; DER.lon[i] = sp[1]; DER.level[i] = 2; DER.approx[i] = sp[2]; continue; }
      }
      if (!Number.isNaN(subLat[li])) { DER.lat[i] = subLat[li]; DER.lon[i] = subLon[li]; DER.level[i] = 1; }
    }
  }
  const toRad = (d) => d * Math.PI / 180;
  const distM = (a, b, c, d) => { const R = 6371e3, x = toRad(c - a), y = toRad(d - b); const h = Math.sin(x / 2) ** 2 + Math.cos(toRad(a)) * Math.cos(toRad(c)) * Math.sin(y / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  function inPoly(lat, lon, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [yi, xi] = pts[i], [yj, xj] = pts[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  const inShape = (shape, lat, lon) => shape.type === 'circle' ? distM(shape.c[0], shape.c[1], lat, lon) <= shape.r : inPoly(lat, lon, shape.pts);
  function polyAreaKm2(pts) { // small areas: flat projection is fine
    const lat0 = toRad(pts.reduce((s, p) => s + p[0], 0) / pts.length);
    const xy = pts.map(([la, lo]) => [toRad(lo) * 6371 * Math.cos(lat0), toRad(la) * 6371]);
    let a = 0; for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) a += (xy[j][0] + xy[i][0]) * (xy[j][1] - xy[i][1]);
    return Math.abs(a / 2);
  }
  const fmtDist = (m) => m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m)} m`;
  const shapeLabel = (sh) => !sh ? null : sh.type === 'circle' ? `Within ${fmtDist(sh.r)} of a pin` : `Drawn area (${polyAreaKm2(sh.pts).toFixed(polyAreaKm2(sh.pts) < 10 ? 1 : 0)} km²)`;

  // ---------- IndexedDB (imported sales can be a few MB: too big for localStorage) ----------
  let dbPromise;
  const idb = () => dbPromise || (dbPromise = new Promise((res, rej) => {
    const r = indexedDB.open('nr-prices', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  async function idbGet(k) {
    try {
      const db = await idb();
      return await new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    } catch { return undefined; }
  }
  async function idbSet(k, v) {
    const db = await idb();
    return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
  }

  // ---------- reading NSW Valuer General zip files on the phone ----------
  const VG_BASE = 'https://www.valuergeneral.nsw.gov.au/__psi';

  function* zipEntries(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('not a zip file');
    let count = dv.getUint16(eocd + 10, true), cd = dv.getUint32(eocd + 16, true);
    if ((cd === 0xffffffff || count === 0xffff) && eocd >= 20 && dv.getUint32(eocd - 20, true) === 0x07064b50) { // ZIP64
      const z = Number(dv.getBigUint64(eocd - 12, true));
      count = Number(dv.getBigUint64(z + 32, true)); cd = Number(dv.getBigUint64(z + 48, true));
    }
    let p = cd;
    for (let i = 0; i < count && dv.getUint32(p, true) === 0x02014b50; i++) {
      const method = dv.getUint16(p + 10, true);
      let csize = dv.getUint32(p + 20, true);
      const usize = dv.getUint32(p + 24, true);
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      let off = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nlen));
      if (csize === 0xffffffff || off === 0xffffffff) {
        for (let e = p + 46 + nlen; e < p + 46 + nlen + elen;) {
          const id = dv.getUint16(e, true), sz = dv.getUint16(e + 2, true);
          if (id === 1) {
            let q = e + 4;
            if (usize === 0xffffffff) q += 8;
            if (csize === 0xffffffff) { csize = Number(dv.getBigUint64(q, true)); q += 8; }
            if (off === 0xffffffff) off = Number(dv.getBigUint64(q, true));
          }
          e += 4 + sz;
        }
      }
      p += 46 + nlen + elen + clen;
      if (name.endsWith('/')) continue;
      const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
      yield { name, method, data: buf.subarray(start, start + csize) };
    }
  }
  async function inflate(entry) {
    if (entry.method === 0) return entry.data;
    if (entry.method !== 8) throw new Error('unsupported compression');
    const stream = new Blob([entry.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // % interest of sale: 100 for a whole property; less for a part share (e.g. buying out a co-owner).
  const interestPct = (v) => { const n = parseFloat(String(v || '').trim()); return isFinite(n) && n > 0 ? Math.min(100, Math.max(1, Math.round(n))) : 0; };

  // 'B' records, post-2001 Valuer General format (semicolon separated). All of NSW is kept.
  function parseDat(text, b) {
    let n = 0;
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('B;')) continue;
      const f = line.split(';');
      if (f.length < 24) continue;
      const price = parseInt(f[15], 10);
      const contract = f[13].trim() || f[14].trim();
      if (!price || !/^\d{8}$/.test(contract)) continue;
      const a = parseFloat(f[11]);
      const area = isFinite(a) ? Math.round(a * (f[12].trim().toUpperCase() === 'H' ? 10000 : 1)) : null;
      b.put(`${f[1].trim()}|${f[2].trim()}|${f[3].trim()}|${contract}`, [+contract, f[9].trim().toUpperCase(), f[10].trim(), price, area, f[16].trim().toUpperCase(),
        f[17].trim().toUpperCase().slice(0, 1), f[18].trim().toUpperCase(), f[19].trim() ? 1 : 0, f[8].trim().toUpperCase(), f[4].trim(), f[23].trim(), f[7].trim(), interestPct(f[22])]);
      n++;
    }
    return n;
  }

  const fileId = (name) => { const m = String(name).match(/(\d{8}|\d{4})(?:\s*\d*)?\.zip$/i); return m ? (m[1].length === 8 ? `weekly/${m[1]}` : `yearly/${m[1]}`) : null; };

  async function importZipFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    if (typeof DecompressionStream === 'undefined') { toast('This phone’s browser is too old to unzip files (needs iOS 16.4 or later).'); return; }
    const latin1 = new TextDecoder('iso-8859-1');
    const done = new Set(FILES.files);
    const b = builder();
    await b.ensureKeys();
    let read = 0, ok = 0;
    const bad = [];
    const walk = async (buf) => {
      for (const entry of zipEntries(buf)) {
        const lower = entry.name.toLowerCase();
        if (lower.endsWith('.zip')) {
          await walk(await inflate(entry));
          const id = fileId(entry.name); if (id) done.add(id);
        } else if (lower.endsWith('.dat')) {
          read += parseDat(latin1.decode(await inflate(entry)), b);
        }
      }
    };
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      toast(`Reading ${f.name} (${i + 1} of ${files.length})…`);
      try {
        await walk(new Uint8Array(await f.arrayBuffer()));
        const id = fileId(f.name); if (id) done.add(id);
        ok++;
      } catch (e) { bad.push(f.name); console.warn(f.name, e); }
    }
    if (!ok) {
      const msg = `None of the ${files.length} selected file${files.length === 1 ? ' was a sales file' : 's were sales files'} (${bad.slice(0, 3).join(', ')}${bad.length > 3 ? ', …' : ''}). Open one in the Files app: a real one is a .zip of about 1–3 MB (weekly) or much larger (yearly).`;
      try { localStorage.setItem('nr-prices.lastImport', `${new Date().toLocaleString('en-AU')}: ${msg}`); } catch { /* ignore */ }
      toast(msg); renderImportStatus(); return;
    }
    toast('Saving…');
    try { await b.save([...done].sort(), new Date().toISOString()); } catch (e) {
      const msg = `Read ${ok} file${ok === 1 ? '' : 's'} (${read.toLocaleString('en-AU')} NSW sales) but could not save them on this phone: ${(e && (e.name || '') + ' ' + (e.message || '')).trim() || e}`;
      try { localStorage.setItem('nr-prices.lastImport', `${new Date().toLocaleString('en-AU')}: ${msg}`); } catch { /* ignore */ }
      toast(msg); renderImportStatus(); return;
    }
    derive(); render(); renderImportStatus();
    const msg = `Imported ${ok} file${ok === 1 ? '' : 's'}: ${read.toLocaleString('en-AU')} NSW sales read, ${b.added.toLocaleString('en-AU')} new${bad.length ? ` · ${bad.length} skipped (${bad.slice(0, 3).join(', ')}${bad.length > 3 ? ', …' : ''}: not a sales file)` : ''}`;
    try { localStorage.setItem('nr-prices.lastImport', `${new Date().toLocaleString('en-AU')}: ${msg}`); } catch { /* ignore */ }
    toast(msg); renderImportStatus();
  }

  const mondaysOf = (year, until) => {
    const out = [];
    for (let d = new Date(Date.UTC(year, 0, 1)); d <= until && d.getUTCFullYear() === year; d.setUTCDate(d.getUTCDate() + 1)) {
      if (d.getUTCDay() === 1) out.push(d.toISOString().slice(0, 10).replace(/-/g, ''));
    }
    return out;
  };
  const historyStart = () => { try { return +localStorage.getItem('nr-prices.historyFrom') || 2024; } catch { return 2024; } };
  // every file not yet imported: yearly files for past years, weekly files for this year
  function missingFiles() {
    const have = new Set(FILES.files);
    const now = new Date();
    const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const year = today.getUTCFullYear();
    const urls = [];
    for (let y = historyStart(); y < year; y++) {
      if (have.has(`yearly/${y}`)) continue;
      // early in a new year the yearly file may not be out yet: fall back to its weekly files
      if (today.getUTCMonth() === 0 && y === year - 1) { for (const w of mondaysOf(y, today)) if (!have.has(`weekly/${w}`)) urls.push(`${VG_BASE}/weekly/${w}.zip`); continue; }
      urls.push(`${VG_BASE}/yearly/${y}.zip`);
    }
    for (const w of mondaysOf(year, today)) if (!have.has(`weekly/${w}`)) urls.push(`${VG_BASE}/weekly/${w}.zip`);
    return urls;
  }

  function renderImportStatus() {
    const box = $('#importStatus'); if (!box) return;
    const n = N;
    const weeks = FILES.files.filter((f) => f.startsWith('weekly/')).sort();
    const years = FILES.files.filter((f) => f.startsWith('yearly/')).map((f) => f.slice(7));
    const missing = missingFiles();
    let reimport = false; try { reimport = localStorage.getItem('nr-prices.reimport') === '1' && !FILES.files.length; } catch { /* ignore */ }
    box.textContent = reimport
      ? `${n.toLocaleString('en-AU')} Northern Rivers sales kept from before. The app now keeps all of NSW: import your sales files again (they're probably still in the NR Prices folder) to add the rest of the state. Nothing will be doubled up.`
      : n
      ? `${n.toLocaleString('en-AU')} sales imported on this phone${years.length ? ` · years ${years.join(', ')}` : ''}${weeks.length ? ` · latest week ${fmtDate(weeks[weeks.length - 1].slice(7))}` : ''}. ${missing.length ? `${missing.length} file${missing.length === 1 ? '' : 's'} still to download.` : 'Up to date.'}`
      : `No sales imported yet. ${missing.length} files to download to build your history (see the steps below).`;
    let last = ''; try { last = localStorage.getItem('nr-prices.lastImport') || ''; } catch { /* ignore */ }
    let lastErr = ''; try { lastErr = localStorage.getItem('nr-prices.lastError') || ''; } catch { /* ignore */ }
    $('#lastImport').textContent = [last && `Last import: ${last}`, lastErr && `Last error: ${lastErr}`].filter(Boolean).join(' — ');
    const hs = $('#historyFrom');
    if (hs && !hs.options.length) {
      const y = new Date().getFullYear();
      for (let k = y - 1; k >= 2016; k--) hs.append(el('option', { value: k }, `${k} (${y - k + 1} years)`));
      hs.value = String(historyStart());
      hs.addEventListener('change', () => { try { localStorage.setItem('nr-prices.historyFrom', hs.value); } catch { /* ignore */ } renderImportStatus(); });
    }
    const br = $('#regionBreakdown');
    if (br) {
      const counts = new Map();
      for (const [, c] of LOC_COUNTS) { const a = AREAS.find((x) => x.group !== 'Northern Rivers' && x.id !== 'nsw' && areaHas(x, c.pc)) || (areaHas(areaOf('all'), c.pc) ? areaOf('all') : null); const k = a ? a.name : 'Other'; counts.set(k, (counts.get(k) || 0) + c.n); }
      const parts = [...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n.toLocaleString('en-AU')}`);
      br.textContent = N ? `${DATA_INFO && DATA_INFO.needsReimport ? 'Import your files again (nothing will double up) so part-share sales can be left out. ' : ''}${DATA_INFO && DATA_INFO.excluded ? `${DATA_INFO.excluded.toLocaleString('en-AU')} token transfers and part-share sales left out. ` : ''}Sales by area: ${parts.join(' · ')}. Imported files: ${FILES.files.length ? FILES.files.length + ' (' + FILES.files.slice(0, 3).map((f) => f.replace(/^\w+\//, '')).join(', ') + (FILES.files.length > 3 ? ', …' : '') + ')' : 'none recorded'}.` : '';
    }
    const latest = missing.filter((u) => u.includes('/weekly/')).pop();
    const link = $('#latestFileLink');
    link.hidden = !latest;
    if (latest) { link.href = latest; link.textContent = `Download week of ${fmtDate(latest.match(/(\d{8})\.zip/)[1])}`; }
  }

  // monthly stats, optionally pooled over a rolling window of months
  const monthlyCache = new WeakMap();
  function monthly(list, smooth) {
    let memo = monthlyCache.get(list);
    if (!memo) monthlyCache.set(list, (memo = {}));
    if (!memo[smooth]) memo[smooth] = monthlyCalc(list, smooth);
    return memo[smooth];
  }
  function monthlyCalc(list, smooth) {
    const by = new Map();
    for (const s of list) { const m = s.m; let a = by.get(m); if (!a) by.set(m, (a = [])); a.push(s.price); }
    if (!by.size) return [];
    const ms = [...by.keys()].sort();
    const rows = [];
    for (let m = ms[0]; m <= ms[ms.length - 1]; m = addMonths(m, 1)) {
      const own = by.get(m) || [];
      let pool = own;
      if (smooth > 1) { pool = []; for (let i = 0; i < smooth; i++) pool = pool.concat(by.get(addMonths(m, -i)) || []); }
      rows.push({ month: m, n: own.length, pooled: pool.length, median: median(pool), avg: mean(pool) });
    }
    return rows;
  }

  // ---------- rendering ----------
  const currentView = () => views.find((v) => v.id === prefs.view);

  // Collapsible sections (tables and lists): closed until opened; remembered.
  if (!prefs.open || typeof prefs.open !== 'object') prefs.open = {};
  function setupCollapsers() {
    for (const btn of document.querySelectorAll('.collapser')) {
      const key = btn.dataset.key, body = document.querySelector(`[data-body="${key}"]`);
      const apply = () => { const open = !!prefs.open[key]; btn.setAttribute('aria-expanded', String(open)); body.hidden = !open; };
      btn.addEventListener('click', () => { prefs.open[key] = !prefs.open[key]; savePrefs(); apply(); });
      apply();
    }
  }
  setupCollapsers();

  function render() {
    renderHeader(); renderChips(); renderFilterBar(); renderSegs();
    renderCards(); renderChart(); renderMapPanel(); renderListings(); renderTable(); renderResales(); renderSalesList();
  }

  function renderHeader() {
    const h = $('#lastUpdated');
    if (!DATA_INFO) { h.textContent = 'No sold-price data imported yet'; return; }
    const g = new Date(DATA_INFO.generated);
    h.textContent = `${(N - (DATA_INFO.excluded || 0)).toLocaleString('en-AU')} sales · latest ${fmtDate(DATA_INFO.latest)} · updated ${g.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`;
  }

  function renderChips() {
    const nav = $('#viewChips'); nav.replaceChildren();
    for (const v of views) {
      nav.append(el('button', { class: 'chip', role: 'tab', 'aria-selected': String(prefs.view === v.id), onclick: () => { prefs.view = v.id; salesShown = 30; resalesShown = 10; savePrefs(); render(); } },
        el('span', { class: 'dot', style: `background:${viewColor(v)}` }), v.name));
    }
    nav.append(el('button', { class: 'chip', role: 'tab', 'aria-selected': String(prefs.view === COMPARE), onclick: () => { prefs.view = COMPARE; savePrefs(); render(); } }, 'Compare'));
    nav.append(el('button', { class: 'chip add', onclick: () => openFilters(true) }, '+ New search'));
    nav.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function filterSummary(v) {
    const area = areaOf(v.area);
    let where = v.locs && v.locs.length ? (v.locs.length <= 2 ? v.locs.map(titleCase).join(', ') : `${v.locs.length} locations · ${area.name}`) : area.name;
    if (v.shape) where += ` · ${shapeLabel(v.shape)}`;
    const types = !v.types || !v.types.length || v.types.length === TYPES.length ? 'All property types' : v.types.map(typeName).join(', ');
    let price = v.min && v.max ? `${fmtShort(v.min)}–${fmtShort(v.max)}` : v.min ? `${fmtShort(v.min)}+` : v.max ? `Up to ${fmtShort(v.max)}` : 'Any price';
    if (v.landMin || v.landMax) price += ` · land ${v.landMin && v.landMax ? `${fmtArea(v.landMin)}–${fmtArea(v.landMax)}` : v.landMin ? `${fmtArea(v.landMin)}+` : `up to ${fmtArea(v.landMax)}`}`;
    if (v.street) where = `Street “${titleCase(v.street)}” · ${where}`;
    if (v.flood) price += ` · ${FLOOD_FILTERS.find((f) => f.id === v.flood)?.short || ''}`;
    return { where, types, price };
  }

  function renderFilterBar() {
    const bar = $('#filterBar'); bar.replaceChildren();
    const v = currentView();
    if (!v) { bar.append(el('div', { class: 'fsum' }, el('b', {}, 'Comparing your saved searches'), el('span', {}, 'Tap a search above to change its filters'))); return; }
    const f = filterSummary(v);
    bar.append(el('div', { class: 'fsum' }, el('b', {}, f.where), el('span', {}, `${f.types} · ${f.price}`)),
      el('button', { class: 'ghost small', onclick: () => openFilters(false) }, 'Filters'));
  }

  function renderSegs() {
    const compare = prefs.view === COMPARE;
    if (compare && prefs.metric === 'both') prefs.metric = 'median';
    const seg = $('#metricSeg'); seg.replaceChildren();
    for (const o of METRICS) {
      if (compare && o.key === 'both') continue;
      seg.append(el('button', { role: 'tab', 'aria-selected': String(prefs.metric === o.key), onclick: () => { prefs.metric = o.key; savePrefs(); render(); } }, o.label));
    }
    const rs = $('#rangeSeg'); rs.replaceChildren();
    for (const r of RANGES) rs.append(el('button', { role: 'tab', 'aria-selected': String(prefs.range === r.key), onclick: () => { prefs.range = r.key; savePrefs(); render(); } }, r.label));
    const sm = $('#smoothSeg'); sm.replaceChildren();
    for (const [k, label] of [[1, 'Monthly'], [3, '3-month rolling']]) sm.append(el('button', { role: 'tab', 'aria-selected': String(prefs.smooth === k), onclick: () => { prefs.smooth = k; savePrefs(); render(); } }, label));
    const tr = $('#trendSeg'); tr.replaceChildren(el('span', { class: 'seg-label' }, 'Trends'));
    for (const w of TREND_WINDOWS) {
      const on = prefs.trends.includes(w.key);
      tr.append(el('button', { type: 'button', 'aria-pressed': String(on), 'aria-selected': String(on), title: `Trend over the last ${w.label}`, onclick: () => {
        prefs.trends = on ? prefs.trends.filter((k) => k !== w.key) : [...prefs.trends, w.key];
        savePrefs(); renderChart(); renderSegs();
      } }, w.short));
    }
  }

  // ---------- trend lines: straight-line fit of log(price) over a period, as % a year ----------
  const TREND_WINDOWS = [
    { months: 3, key: '3', short: '3M', label: '3 mths', color: 'var(--s6)', dash: '1 3' },
    { months: 6, key: '6', short: '6M', label: '6 mths', color: 'var(--s3)', dash: '4 3' },
    { months: 12, key: '12', short: '1Y', label: '1 yr', color: 'var(--s5)', dash: '2 4' },
    { months: 36, key: '36', short: '3Y', label: '3 yrs', color: 'var(--s7)', dash: '7 4' },
    { months: 60, key: '60', short: '5Y', label: '5 yrs', color: 'var(--s8)', dash: '12 5' },
  ];
  if (!Array.isArray(prefs.trends)) prefs.trends = prefs.trend === false ? [] : ['12', '36', '60'];
  const trendsOn = () => prefs.trends.length > 0;
  // points: [{ month, v }]; returns { a, b, from, to, yearly, n } or null. Leaves out incomplete recent months.
  function fitTrend(points, fromMonth, toMonth, minPts) {
    const pts = points.filter((p) => p.month >= fromMonth && p.month <= toMonth && !isProvisional(p.month) && p.v > 0);
    if (pts.length < minPts) return null;
    const t0 = pts[0].month;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const p of pts) { const t = monthDiff(t0, p.month), yv = Math.log(p.v); sx += t; sy += yv; sxx += t * t; sxy += t * yv; }
    const n = pts.length, den = n * sxx - sx * sx;
    if (!den) return null;
    const b = (n * sxy - sx * sy) / den, a = (sy - b * sx) / n;
    return { a, b, t0, from: pts[0].month, to: pts[pts.length - 1].month, yearly: Math.exp(12 * b) - 1, n };
  }
  const trendAt = (f, m) => Math.exp(f.a + f.b * monthDiff(f.t0, m));
  // Which trends to draw for the current chart
  function buildTrends(series) {
    if (!trendsOn()) return [];
    const out = [];
    if (prefs.view === COMPARE) {
      for (const s of series) {
        if (!s.points.length) continue;
        const f = fitTrend(s.points, s.points[0].month, s.points[s.points.length - 1].month, 6);
        if (f) out.push({ ...f, color: s.color, dash: '5 4', label: s.name });
      }
      return out;
    }
    const base = series.find((s) => !s.dashed && s.allPoints && s.allPoints.length);
    if (!base) return out;
    const complete = base.allPoints.filter((p) => !isProvisional(p.month));
    if (!complete.length) return out;
    const last = complete[complete.length - 1].month;
    for (const w of TREND_WINDOWS) {
      if (!prefs.trends.includes(w.key)) continue;
      const from = addMonths(last, -(w.months - 1));
      if (complete[0].month > addMonths(from, Math.round(w.months * 0.25))) continue; // not enough history for this period
      const f = fitTrend(base.allPoints, from, last, w.months <= 6 ? Math.max(3, w.months - 2) : Math.max(6, Math.round(w.months * 0.5)));
      if (f) out.push({ ...f, color: w.color, dash: w.dash, label: w.label, base: base.name });
    }
    return out;
  }

  // last 3 months vs the same 3 months a year earlier
  function windowStats(list, endMonth, months = 3) {
    const startM = addMonths(endMonth, -(months - 1));
    const prevEnd = addMonths(endMonth, -12), prevStart = addMonths(startM, -12);
    return {
      startM,
      cur: list.filter((s) => s.m >= startM && s.m <= endMonth).map((s) => s.price),
      prev: list.filter((s) => s.m >= prevStart && s.m <= prevEnd).map((s) => s.price),
    };
  }
  function statCard(label, value, cmp, sub) {
    const pct = value != null && cmp ? ((value - cmp) / cmp) * 100 : null;
    return el('div', { class: 'card' },
      el('div', { class: 'label' }, label),
      el('div', { class: 'value' }, value == null ? '—' : fmtShort(value)),
      el('div', { class: 'delta' }, pct != null ? [el('span', { class: pct >= 0 ? 'up' : 'down' }, `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%`), ' vs year before'] : sub || ''));
  }

  function renderCards() {
    const box = $('#statCards'); box.replaceChildren();
    if (!N) {
      box.className = 'cards compare';
      box.append(el('div', { class: 'card wide' }, el('div', { class: 'label' }, 'No sold prices yet'),
        el('div', { class: 'delta' }, 'Import the NSW Valuer General sales files your iPhone Shortcut downloads.'),
        el('button', { class: 'primary', style: 'margin-top:10px', onclick: () => { renderImportStatus(); $('#menuDialog').showModal(); } }, 'Import sales files')));
      return;
    }
    const end = addMonths(thisMonth(), -1);
    if (prefs.view === COMPARE) {
      box.className = 'cards compare';
      const fn = prefs.metric === 'avg' ? mean : median;
      for (const v of views) {
        const w = windowStats(salesFor(v), end);
        const c = statCard(v.name, fn(w.cur), fn(w.prev), `${w.cur.length} sales`);
        c.querySelector('.label').prepend(el('span', { class: 'dot', style: `background:${viewColor(v)}` }));
        box.append(c);
      }
      return;
    }
    box.className = 'cards';
    const w = windowStats(salesFor(currentView()), end);
    box.append(
      statCard(`Median sold · ${fmtMonthShort(w.startM)}–${fmtMonthShort(end)}`, median(w.cur), median(w.prev), `${w.cur.length} sales`),
      statCard('Average sold', mean(w.cur), mean(w.prev)),
      el('div', { class: 'card' }, el('div', { class: 'label' }, 'Sales, last 3 mths'), el('div', { class: 'value' }, String(w.cur.length)),
        el('div', { class: 'delta' }, `${w.prev.length} a year before`)));
  }

  function niceTicks(min, max, count = 4) {
    if (min === max) { min *= 0.9; max *= 1.1; }
    const step0 = (max - min) / count, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((x) => x * mag).find((x) => x >= step0);
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    const ticks = []; for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
    return { lo, hi, ticks };
  }

  function buildSeries() {
    const series = [];
    const add = (name, color, dashed, points) => series.push({ name, color, dashed, points });
    const pts = (rows, k) => rows.filter((r) => r.pooled >= MIN_SALES).map((r) => ({ month: r.month, v: r[k], n: r.pooled }));
    if (prefs.view === COMPARE) {
      for (const v of views) add(v.name, viewColor(v), false, pts(monthly(salesFor(v), prefs.smooth), prefs.metric));
    } else {
      const v = currentView(), color = viewColor(v);
      const rows = monthly(salesFor(v), prefs.smooth);
      if (prefs.metric !== 'avg') add('Median sold', color, false, pts(rows, 'median'));
      if (prefs.metric !== 'median') add('Average sold', 'var(--muted)', false, pts(rows, 'avg'));
      const lst = entries.filter((e) => e.suburb === v.name && e.avgListing != null).sort((a, b) => a.month.localeCompare(b.month));
      if (lst.length) add('Avg listing (yours)', color, true, lst.map((e) => ({ month: e.month, v: e.avgListing })));
    }
    const all = series.flatMap((s) => s.points.map((p) => p.month));
    if (!all.length) return { series, start: null, end: null };
    const end = all.reduce((a, b) => (a > b ? a : b));
    let start = all.reduce((a, b) => (a < b ? a : b));
    if (prefs.range) { const rs = addMonths(end, -(prefs.range - 1)); if (rs > start) start = rs; }
    for (const s of series) { s.allPoints = s.points; s.points = s.points.filter((p) => p.month >= start); }
    return { series, start, end };
  }

  function renderChart() {
    const box = $('#chart'); box.replaceChildren();
    const legend = $('#legend'); legend.replaceChildren();
    const { series, start, end } = buildSeries();
    const nonEmpty = series.filter((s) => s.points.length);
    if (!nonEmpty.length) {
      box.append(el('div', { class: 'empty' }, N ? 'Not enough sales match these filters to chart. Try a wider area, more property types or a bigger price range.' : 'No data to chart yet.'));
      return;
    }
    const W = box.clientWidth || 340, H = box.clientHeight || 240;
    const pad = { l: 46, r: 10, t: 12, b: 26 };
    const n = Math.max(1, monthDiff(start, end));
    const trends = buildTrends(nonEmpty);
    const vals = nonEmpty.flatMap((s) => s.points.map((p) => p.v));
    for (const t of trends) { const a = t.from > start ? t.from : start; if (a <= t.to) vals.push(trendAt(t, a), trendAt(t, t.to)); }
    const { lo, hi, ticks } = niceTicks(Math.min(...vals), Math.max(...vals));
    const step = (W - pad.l - pad.r) / n;
    const x = (m) => pad.l + monthDiff(start, m) * step;
    const y = (v) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Price trend chart' });

    const provStart = addMonths(thisMonth(), -PROVISIONAL_MONTHS);
    const showProv = N && end >= provStart;
    if (showProv) {
      const bx = Math.max(pad.l, x(provStart > start ? provStart : start) - step / 2);
      svg.append(svgEl('rect', { x: bx, y: pad.t, width: Math.max(0, W - pad.r - bx), height: H - pad.t - pad.b, fill: 'var(--grid)', opacity: 0.7 }));
    }
    for (const t of ticks) {
      svg.append(svgEl('line', { x1: pad.l, x2: W - pad.r, y1: y(t), y2: y(t), stroke: 'var(--grid)', 'stroke-width': 1 }));
      const lab = svgEl('text', { x: pad.l - 6, y: y(t) + 4, 'text-anchor': 'end' }); lab.textContent = fmtShort(t); svg.append(lab);
    }
    const every = Math.max(1, Math.ceil((n + 1) / Math.max(2, Math.floor((W - pad.l) / 70))));
    for (let i = 0; i <= n; i += every) {
      const m = addMonths(start, i);
      const lab = svgEl('text', { x: x(m), y: H - 6, 'text-anchor': i === 0 && n > 0 ? 'start' : 'middle' }); lab.textContent = fmtMonthShort(m); svg.append(lab);
    }
    for (const s of nonEmpty) {
      let d = '', prev = null;
      for (const p of s.points) { d += (prev && monthDiff(prev.month, p.month) === 1 ? 'L' : 'M') + x(p.month).toFixed(1) + ',' + y(p.v).toFixed(1); prev = p; }
      svg.append(svgEl('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2.25, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', ...(s.dashed ? { 'stroke-dasharray': '6 4' } : {}) }));
      s.points.forEach((p, i) => {
        const iso = !(s.points[i - 1] && monthDiff(s.points[i - 1].month, p.month) === 1) && !(s.points[i + 1] && monthDiff(p.month, s.points[i + 1].month) === 1);
        if (s.points.length <= 14 || iso) svg.append(svgEl('circle', { cx: x(p.month), cy: y(p.v), r: 3, fill: s.color }));
      });
    }
    for (const t of trends) {
      const a = t.from > start ? t.from : start;
      if (a > t.to) continue;
      svg.append(svgEl('line', { x1: x(a), y1: y(trendAt(t, a)), x2: x(t.to), y2: y(trendAt(t, t.to)), stroke: t.color, 'stroke-width': 2, 'stroke-dasharray': t.dash, 'stroke-linecap': 'round', opacity: 0.9 }));
    }
    const cross = svgEl('line', { y1: pad.t, y2: H - pad.b, stroke: 'var(--muted)', 'stroke-width': 1, 'stroke-dasharray': '3 3', visibility: 'hidden' });
    svg.append(cross);
    const tip = el('div', { class: 'tip', hidden: true });
    const onMove = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const m = addMonths(start, Math.max(0, Math.min(n, Math.round((px - pad.l) / step))));
      const lines = nonEmpty.map((s) => ({ s, p: s.points.find((p) => p.month === m) })).filter((o) => o.p);
      cross.setAttribute('x1', x(m)); cross.setAttribute('x2', x(m)); cross.setAttribute('visibility', 'visible');
      tip.replaceChildren(el('div', {}, el('b', {}, fmtMonth(m)), isProvisional(m) ? ' · incomplete' : ''),
        ...(lines.length ? lines.map((o) => el('div', {}, `${o.s.name}: ${fmtMoney(o.p.v)}${o.p.n ? ` (${o.p.n} sales)` : ''}`)) : [el('div', {}, 'Not enough sales')]));
      tip.hidden = false;
      tip.style.left = Math.max(90, Math.min(r.width - 90, (x(m) / W) * r.width)) + 'px';
    };
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerdown', onMove);
    svg.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; });
    box.append(svg, tip);
    for (const s of series) legend.append(el('span', {}, el('i', { class: s.dashed ? 'dash' : '', style: s.dashed ? `color:${s.color}` : `background:${s.color}` }), s.name + (s.points.length ? '' : ' (not enough sales)')));
    if (showProv) legend.append(el('span', {}, el('i', { class: 'band' }), 'Recent months, sales still being reported'));
    for (const t of trends) legend.append(el('span', {}, el('i', { class: 'dash', style: `color:${t.color}` }), `Trend ${t.label}: `, el('b', { class: t.yearly >= 0 ? 'up' : 'down' }, `${t.yearly >= 0 ? '+' : '−'}${Math.abs(t.yearly * 100).toFixed(1)}%/yr`)));
    const note = $('#trendNote');
    const short = trends.some((t) => t.label === '3 mths' || t.label === '6 mths');
    note.textContent = trends.length && prefs.view !== COMPARE
      ? `Trend lines are a straight-line fit to the ${trends[0].base.toLowerCase()} over each period, shown as growth per year. Incomplete recent months are left out.${short ? ' 3- and 6-month trends rest on only a few months of sales, so they swing a lot: treat them as an early signal, not a forecast.' : ''}`
      : trendsOn() && prefs.view !== COMPARE && N ? 'Not enough months of sales for the trend periods you picked. Try a wider search, a longer period or the 3-month rolling view.' : '';
  }

  let tableAll = false;
  function tableToggle(total) {
    const btn = $('#tableMore');
    btn.hidden = total <= 12;
    btn.textContent = tableAll ? 'Show the last 12 months only' : `Show all ${total} months`;
    btn.onclick = () => { tableAll = !tableAll; renderTable(); };
  }
  function renderTable() {
    const t = $('#table'); t.replaceChildren();
    const td = (v) => el('td', { class: v == null ? 'na' : '' }, fmtShort(v));
    const rolling = prefs.smooth > 1 ? ' (3-month rolling)' : '';
    if (prefs.view === COMPARE) {
      const key = prefs.metric === 'avg' ? 'avg' : 'median';
      $('#tableTitle').textContent = `${key === 'avg' ? 'Average' : 'Median'} sold${rolling}`;
      const data = views.map((v) => new Map(monthly(salesFor(v), prefs.smooth).map((r) => [r.month, r])));
      const months = [...new Set(data.flatMap((m) => [...m.keys()]))].sort().reverse();
      t.append(el('thead', {}, el('tr', {}, el('th', {}, 'Month'), ...views.map((v) => el('th', {}, v.name)))));
      const tb = el('tbody');
      for (const mo of months.slice(0, tableAll ? undefined : 12)) tb.append(el('tr', {}, el('td', {}, fmtMonthShort(mo)), ...data.map((m) => { const r = m.get(mo); return td(r && r.pooled >= MIN_SALES ? r[key] : null); })));
      if (!months.length) tb.append(el('tr', {}, el('td', { colspan: views.length + 1, class: 'table-empty' }, 'No sales yet.')));
      tableToggle(months.length);
      t.append(tb);
      $('#tableNote').textContent = '';
      return;
    }
    const v = currentView();
    $('#tableTitle').textContent = `${v.name} by month${rolling}`;
    const rows = new Map(monthly(salesFor(v), prefs.smooth).map((r) => [r.month, r]));
    const lst = new Map(entries.filter((e) => e.suburb === v.name).map((e) => [e.month, e]));
    const months = [...new Set([...rows.keys(), ...lst.keys()])].sort().reverse();
    t.append(el('thead', {}, el('tr', {}, el('th', {}, 'Month'), el('th', {}, 'Sales'), el('th', {}, 'Median'), el('th', {}, 'Average'), el('th', {}, 'Listing'))));
    const tb = el('tbody');
    for (const m of months.slice(0, tableAll ? undefined : 12)) {
      const r = rows.get(m), e = lst.get(m);
      tb.append(el('tr', { onclick: () => openEntry({ suburb: v.name, month: m }) },
        el('td', {}, fmtMonthShort(m), isProvisional(m) ? '*' : ''), el('td', {}, r ? r.n : 0),
        td(r ? r.median : null), td(r ? r.avg : null), td(e ? e.avgListing : null)));
    }
    if (!months.length) tb.append(el('tr', {}, el('td', { colspan: 5, class: 'table-empty' }, 'No sales match these filters.')));
    tableToggle(months.length);
    t.append(tb);
    $('#tableNote').textContent = months.length ? '* Sales for this month are still being reported. Tap a month to add your listing (asking) price.' : '';
  }

  // ---------- flood: council floor and flood levels (imported on the phone only) ----------
  // FLOOD = { files: [{ name, n, imported }], recs: { 'LISMORE|BALLINA RD|16': [floor, flood1in100] } }  (metres AHD)
  let FLOOD = null;
  const FLOOD_FILTERS = [
    { id: '', name: 'Any', short: '' },
    { id: 'above', name: 'Floor above the 1-in-100 flood level', short: 'floor above 1-in-100 flood' },
    { id: 'below', name: 'Floor below the 1-in-100 flood level', short: 'floor below 1-in-100 flood' },
    { id: 'below1', name: 'Floor more than 1 m below it', short: 'floor >1 m below 1-in-100 flood' },
    { id: 'below2022', name: 'Floor below the 2022 flood (estimated)', short: 'floor below 2022 flood (est.)' },
    { id: 'above2022', name: 'Floor above the 2022 flood (estimated)', short: 'floor above 2022 flood (est.)' },
    { id: 'below2017', name: 'Floor below the 2017 flood (estimated)', short: 'floor below 2017 flood (est.)' },
    { id: 'only2022', name: 'Flooded in 2022 but not 2017 (estimated)', short: 'flooded 2022, not 2017 (est.)' },
    { id: 'unknown', name: 'Not in the council list (same suburbs)', short: 'not in council flood list' },
  ];
  // Peak heights at the Lismore (Rowing Club) gauge, metres AHD; the gauge's 1-in-100 level is 12.4 m.
  // A flood's height at a home is estimated as that home's own 1-in-100 level plus (peak - 12.4).
  const GAUGE_1IN100 = 12.4;
  const FLOOD_EVENTS = { 2022: 14.37, 2017: 11.59 };
  // floor height above an event's estimated level at the home (negative = water over the floor)
  const overEvent = (d100, year) => d100 - (FLOOD_EVENTS[year] - GAUGE_1IN100);
  const houseKey = (h) => String(h || '').toUpperCase().replace(/\s+/g, '');
  const leadNum = (h) => (String(h || '').match(/\d+/) || [''])[0];
  function matchFlood() {
    DER.flood = new Float32Array(N).fill(NaN);
    DER.floodLoc = new Uint8Array(DER.locName.length);
    if (!FLOOD || !FLOOD.recs) return;
    const locs = new Set(Object.keys(FLOOD.recs).map((k) => k.split('|')[0]));
    DER.locName.forEach((n, li) => { if (locs.has(n)) DER.floodLoc[li] = 1; });
    const streetNorm = new Map();
    for (let i = 0; i < N; i++) {
      if (!DER.keep[i] || !DER.floodLoc[C.loc[i]]) continue;
      const si = C.street[i];
      let st = streetNorm.get(si);
      if (st === undefined) { st = normStreet(C.dict.street[si] || ''); streetNorm.set(si, st); }
      const h = C.dict.house[C.house[i]] || '';
      const base = `${DER.locName[C.loc[i]]}|${st}|`;
      const r = FLOOD.recs[base + houseKey(h)] || FLOOD.recs[base + leadNum(h)];
      if (r) DER.flood[i] = r[0] - r[1];
    }
  }
  function floodText(i) {
    const fd = DER && DER.flood ? DER.flood[i] : NaN;
    if (Number.isNaN(fd)) return '';
    const m = Math.abs(fd).toFixed(1);
    return fd >= 0 ? `Floor ${m} m above the 1-in-100 flood level` : `Floor ${m} m below the 1-in-100 flood level`;
  }
  function eventText(i) {
    const fd = DER && DER.flood ? DER.flood[i] : NaN;
    if (Number.isNaN(fd)) return '';
    return Object.keys(FLOOD_EVENTS).sort().reverse().map((y) => {
      const o = overEvent(fd, +y);
      return o < 0 ? `${y}: about ${Math.abs(o).toFixed(1)} m over the floor` : `${y}: floor about ${o.toFixed(1)} m above the water`;
    }).join(' · ') + ' (est.)';
  }
  const floodEl = (i) => {
    const t = floodText(i);
    if (!t) return null;
    return el('div', {}, el('div', { class: `flood ${DER.flood[i] >= 0 ? 'dry' : 'wet'}` }, t),
      el('div', { class: `flood-ev ${overEvent(DER.flood[i], 2022) < 0 ? 'wet' : 'dry'}` }, eventText(i)));
  };

  // Read the council's "Flood & Floor Levels" PDF tables with pdf.js (loaded only when needed).
  let pdfjsReady = null;
  const loadPdfjs = () => pdfjsReady || (pdfjsReady = new Promise((res, rej) => {
    const sc = document.createElement('script');
    sc.src = 'vendor/pdfjs/pdf.min.js';
    sc.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js'; res(window.pdfjsLib); };
    sc.onerror = () => { pdfjsReady = null; rej(new Error('could not load the PDF reader')); };
    document.head.append(sc);
  }));
  async function pdfLines(file) {
    const pdfjsLib = await loadPdfjs();
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const lines = [];
    for (let pn = 1; pn <= doc.numPages; pn++) {
      const page = await doc.getPage(pn);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const rows = [];
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        // screen position and reading direction (some council PDFs are laid out sideways)
        const m = pdfjsLib.Util.transform(vp.transform, it.transform);
        const horiz = Math.abs(m[0]) >= Math.abs(m[1]);
        const k = horiz ? m[5] * Math.sign(m[0] || 1) : -m[4] * Math.sign(m[1]);
        const col = horiz ? m[4] * Math.sign(m[0] || 1) : m[5] * Math.sign(m[1]);
        let row = rows.find((r) => Math.abs(r.k - k) < 3);
        if (!row) rows.push((row = { k, items: [] }));
        row.items.push({ col, s: it.str.trim() });
      }
      rows.sort((a, b) => a.k - b.k);
      for (const r of rows) lines.push(r.items.sort((a, b) => a.col - b.col).map((t) => t.s).join(' '));
    }
    return lines;
  }
  const STREET_TYPE_WORDS = new Set(['STREET', 'ST', 'ROAD', 'RD', 'AVENUE', 'AVE', 'LANE', 'LN', 'PLACE', 'PL', 'CRESCENT', 'CRES', 'DRIVE', 'DR', 'COURT', 'CT',
    'CLOSE', 'CL', 'PARADE', 'PDE', 'TERRACE', 'TCE', 'HIGHWAY', 'HWY', 'WAY', 'CIRCUIT', 'CCT', 'GROVE', 'ESPLANADE', 'BOULEVARD', 'SQUARE', 'ARCADE', 'MALL', 'RISE', 'VIEW']);
  // e.g. "16 Ballina Road Lismore 8.723 8.397 8.858 Ampol Service Station 12.3"
  function parseFloodLine(line) {
    line = line.replace(/^(\d+[A-Za-z]?)\s*[-–]\s*(\d+[A-Za-z]?)\b/, '$1-$2'); // "5 - 7 Carrington Street" → "5-7 …"
    const m = line.match(/^((?:\d+[A-Za-z]?\s?[-/]\s?)*\d+[A-Za-z]?)\s+(.+)$/); // 16, 124a, 5-7, 2-3/101 (units/street number)
    if (!m) return null;
    const toks = m[2].split(/\s+/);
    const firstNum = toks.findIndex((t) => /^\d+(\.\d+)?$/.test(t));
    if (firstNum < 2) return null;
    const words = toks.slice(0, firstNum);
    let k = -1;
    words.forEach((w, j) => { if (STREET_TYPE_WORDS.has(w.toUpperCase())) k = j; });
    if (k < 1 || k === words.length - 1) return null; // need a street name, a street type and a suburb
    const nums = toks.filter((t) => /^\d+(\.\d+)?$/.test(t)).map(Number);
    const floor = Number(toks[firstNum]), flood = nums[nums.length - 1];
    if (!(floor > 0 && floor < 60 && flood > 0 && flood < 60) || nums.length < 2) return null;
    return { num: houseKey(m[1].includes('/') ? m[1].split('/').pop() : m[1].split('-')[0]), street: normStreet(words.slice(0, k + 1).join(' ')), suburb: words.slice(k + 1).join(' ').replace(/\(.*?\)|\(.*$/g, ' ').replace(/[^A-Za-z ]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase(), floor, flood };
  }
  async function importFloodPdfs(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    const data = FLOOD ? structuredClone(FLOOD) : { files: [], recs: {} };
    const report = [];
    for (const f of files) {
      toast(`Reading ${f.name}…`);
      try {
        let n = 0, lines = 0;
        const subsInFile = new Set(), unread = [];
        for (const line of await pdfLines(f)) {
          const r = parseFloodLine(line);
          if (/^\d/.test(line)) lines++;
          if (!r) { if (/^\d/.test(line) && /\d+\.\d+/.test(line) && line.split(/\s+/).some((w) => STREET_TYPE_WORDS.has(w.toUpperCase())) && unread.length < 3) unread.push(line.slice(0, 90)); continue; }
          subsInFile.add(r.suburb);
          const key = `${r.suburb}|${r.street}|${r.num}`;
          const old = data.recs[key];
          if (!old || r.floor < old[0]) data.recs[key] = [r.floor, r.flood]; // several floors at one address: keep the lowest
          n++;
        }
        data.files = data.files.filter((x) => x.name !== f.name).concat({ name: f.name, n, lines, suburbs: [...subsInFile], unread, imported: new Date().toISOString() });
        report.push(n ? `${f.name}: ${n} floor levels` : `${f.name}: no floor-level table found`);
      } catch (e) { report.push(`${f.name}: ${e.message || e}`); }
    }
    FLOOD = data;
    try { await idbSet('flood-levels', FLOOD); } catch { toast('Could not save the flood levels on this phone.'); return; }
    derive(); render(); renderFloodStatus();
    toast(report.join(' · '));
  }
  function renderFloodStatus() {
    const box = $('#floodStatus'); if (!box) return;
    if (!FLOOD || !Object.keys(FLOOD.recs).length) { box.textContent = 'No flood levels imported yet. Import the council’s “Flood & Floor Levels” PDF for a suburb (Lismore City Council publishes one per suburb).'; return; }
    // per suburb: addresses read, placed on the map, and matching sales
    const per = new Map();
    for (const k of Object.keys(FLOOD.recs)) { const sub = k.split('|')[0]; const o = per.get(sub) || { n: 0, placed: 0, sales: 0 }; o.n++; per.set(sub, o); }
    for (const p of floodPoints()) { const sub = p.label.split(', ').pop().toUpperCase(); const o = per.get(sub); if (o) o.placed++; }
    if (DER && DER.flood) for (let i = 0; i < N; i++) if (!Number.isNaN(DER.flood[i])) { const o = per.get(DER.locName[C.loc[i]]); if (o) o.sales++; }
    box.replaceChildren(el('span', {}, 'Kept on this phone only.'),
      ...[...per].map(([sub, o]) => el('span', { class: 'fline' }, `${titleCase(sub)}: ${o.n.toLocaleString('en-AU')} addresses, ${o.placed.toLocaleString('en-AU')} placed on the map, ${o.sales.toLocaleString('en-AU')} of your sales match`)),
      ...FLOOD.files.map((f) => el('span', { class: 'fline' }, `File “${f.name}”: ${f.n.toLocaleString('en-AU')} rows read${f.suburbs ? ` (${f.suburbs.map(titleCase).join(', ') || 'no suburb found'})` : ''}${f.unread && f.unread.length ? `. Rows it couldn't read look like: “${f.unread.join('” · “')}”` : ''}`)));
  }

  // ---------- listings from your property alert emails (kept on this phone only) ----------
  // LISTINGS = { recs: { 'SUBURB|STREET RD|12|unit': { suburb, street, num, unit, beds, baths, cars, firstSeen, lastSeen, prices: [{ d, text, low, high, flag }] } }, files: [] }
  let LISTINGS = { recs: {}, files: [] };
  const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  // "$529,000 - $549,000", "Price Guide $3,900,000", "NEW PRICE $499,000", "$650k", "Contact agent"
  function parseAsking(text) {
    const vals = [...String(text).matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([kKmM])?/g)].map((m) => {
      let v = parseFloat(m[1].replace(/,/g, ''));
      if (/k/i.test(m[2] || '')) v *= 1e3; else if (/m/i.test(m[2] || '')) v *= 1e6; else if (v < 10000) v *= 1e3;
      return Math.round(v);
    }).filter((v) => v >= 20000);
    const flag = /new price/i.test(text) ? 'New price' : /price release/i.test(text) ? 'Price released' : /reduced|price drop/i.test(text) ? 'Reduced' : '';
    if (!vals.length) return { low: null, high: null, flag };
    return { low: Math.min(...vals.slice(0, 2)), high: Math.max(...vals.slice(0, 2)), flag };
  }
  const knownSuburbs = () => {
    const set = new Set(LOC_COUNTS ? [...LOC_COUNTS.keys()] : []);
    if (GEO) for (const k of Object.keys(GEO.streets)) set.add(k.slice(0, k.indexOf('|')));
    if (SUBURBS) for (const k of Object.keys(SUBURBS.pts)) set.add(k.slice(0, k.lastIndexOf('|')));
    return [...set].sort((a, b) => b.length - a.length); // longest first, so "EVANS HEAD" beats "EVANS"
  };
  const ADDR_RE = new RegExp(`^((?:\\d+[A-Za-z]?\\s?\\/\\s?)?\\d+[A-Za-z]?(?:\\s?-\\s?\\d+[A-Za-z]?)?)\\s+(.+?\\s(?:${[...STREET_TYPE_WORDS].join('|')}))\\s*,\\s*(.+)$`, 'i');
  // Domain "Home Alert" email: price line(s), then "address, suburb", then "N beds N baths N cars".
  function parseAlertLines(lines) {
    const subs = knownSuburbs();
    let date = null, lastPrice = null, cur = null;
    const out = [];
    for (const raw of lines) {
      const line = raw.replace(/\s+/g, ' ').trim();
      if (!date) { const m = line.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*,?\s+(20\d\d)/i) || line.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),\s+(20\d\d)/i);
        if (m) { const [d, mo, y] = /^\d/.test(m[1]) ? [m[1], m[2], m[3]] : [m[2], m[1], m[3]]; date = +y * 10000 + MON[mo.slice(0, 3).toUpperCase()] * 100 + +d; } }
      if (/\$\s?\d|contact agent|auction|price on application|expressions of interest|by negotiation/i.test(line) && !ADDR_RE.test(line) && line.length < 80) { lastPrice = line; continue; }
      const a = line.match(ADDR_RE);
      if (a) {
        const tail = a[3].toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
        const suburb = subs.find((n) => tail === n || tail.startsWith(n + ' ')) || tail.split(' NSW')[0];
        const numPart = a[1].replace(/\s/g, '');
        const [unit, num] = numPart.includes('/') ? numPart.split('/') : ['', numPart];
        cur = { unit, num: houseKey(num.split('-')[0]), numText: num, street: a[2], suburb, priceText: lastPrice || '' };
        lastPrice = null;
        continue;
      }
      const f = line.match(/(\d+)\s*beds?\b.*?(\d+)\s*baths?\b(?:.*?(\d+)\s*(?:cars?|parking)\b)?/i);
      if (f && cur) { out.push({ ...cur, beds: +f[1], baths: +f[2], cars: f[3] != null ? +f[3] : null }); cur = null; }
    }
    return { date, listings: out };
  }
  const listingKey = (suburb, street, num, unit) => `${suburb}|${normStreet(street)}|${num}|${unit || ''}`;
  async function importListingPdfs(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    const data = structuredClone(LISTINGS);
    const report = [];
    for (const f of files) {
      toast(`Reading ${f.name}…`);
      try {
        const { date, listings } = parseAlertLines(await pdfLines(f));
        const d = date || +new Date().toISOString().slice(0, 10).replace(/-/g, '');
        let added = 0, updated = 0;
        for (const l of listings) {
          const key = listingKey(l.suburb, l.street, l.num, l.unit);
          const { low, high, flag } = parseAsking(l.priceText);
          let r = data.recs[key];
          if (!r) { r = data.recs[key] = { suburb: l.suburb, street: l.street, num: l.num, numText: l.numText, unit: l.unit, firstSeen: d, lastSeen: d, prices: [] }; added++; } else updated++;
          r.beds = l.beds; r.baths = l.baths; r.cars = l.cars;
          r.firstSeen = Math.min(r.firstSeen, d); r.lastSeen = Math.max(r.lastSeen, d);
          const last = r.prices[r.prices.length - 1];
          if (!last || last.text !== l.priceText) { r.prices.push({ d, text: l.priceText, low, high, flag }); r.prices.sort((x, y) => x.d - y.d); }
        }
        data.files = data.files.filter((x) => x.name !== f.name).concat({ name: f.name, date: d, n: listings.length });
        report.push(listings.length ? `${f.name}: ${listings.length} listings (${added} new, ${updated} updated)` : `${f.name}: no listings found — is it a Domain alert email?`);
      } catch (e) { report.push(`${f.name}: ${e.message || e}`); }
    }
    LISTINGS = data;
    try { await idbSet('listings', LISTINGS); } catch { toast('Could not save the listings on this phone.'); return; }
    listingIndex = null; render(); renderListingStatus();
    toast(report.join(' · '));
  }
  function renderListingStatus() {
    const box = $('#listingStatus'); if (!box) return;
    const n = Object.keys(LISTINGS.recs).length;
    box.textContent = n
      ? `${n.toLocaleString('en-AU')} listings from ${LISTINGS.files.length} alert email${LISTINGS.files.length === 1 ? '' : 's'} (latest ${fmtDate(Math.max(...LISTINGS.files.map((f) => f.date)))}). Kept on this phone only.`
      : 'No listings yet. Save a Domain alert email as a PDF (Gmail: ⋯ → Print → pinch out → Share → Save to Files) and import it here.';
  }
  // Which listings fit a search (area, locations, street, type, price, beds)
  const listingType = (r) => (r.unit ? 'unit' : 'house');
  const askOf = (r) => { const p = r.prices[r.prices.length - 1]; return p ? p : { text: '', low: null, high: null }; };
  function listingsFor(v) {
    const area = areaOf(v.area);
    const locSet = v.locs && v.locs.length ? new Set(v.locs) : null;
    const streetQ = v.street ? normStreet(v.street) : null;
    return Object.values(LISTINGS.recs).filter((r) => {
      const pc = (LOC_COUNTS.get(r.suburb) || {}).pc || (SUBURBS && [...Object.keys(SUBURBS.pts)].find((k) => k.startsWith(r.suburb + '|'))?.split('|')[1]);
      if (locSet ? !locSet.has(r.suburb) : (pc ? !areaHas(area, pc) : area.ranges)) return false;
      if (v.types && v.types.length && !v.types.includes(listingType(r)) && !(listingType(r) === 'house' && v.types.some((t) => t === 'lifestyle' || t === 'farm'))) return false;
      const a = askOf(r);
      if (v.min && a.high != null && a.high < v.min) return false;
      if (v.max && a.low != null && a.low > v.max) return false;
      if (streetQ && !normStreet(r.street).startsWith(streetQ)) return false;
      return true;
    }).sort((x, y) => y.lastSeen - x.lastSeen || y.firstSeen - x.firstSeen);
  }
  const listingSpot = (r) => houseSpot(normStreet(r.street), r.num, r.suburb);
  const fmtAsk = (p) => !p || p.low == null ? (p && p.text ? p.text : 'No price shown') : p.low === p.high ? fmtShort(p.low) : `${fmtShort(p.low)}–${fmtShort(p.high)}`;
  const featText = (r) => [r.beds != null && `${r.beds} bed`, r.baths != null && `${r.baths} bath`, r.cars != null && `${r.cars} car`].filter(Boolean).join(' · ');
  const listingAddr = (r) => `${r.unit ? r.unit + '/' : ''}${r.numText || r.num} ${titleCase(r.street)}, ${titleCase(r.suburb)}`;
  const domainSearch = (r) => `https://www.google.com/search?q=${encodeURIComponent(`${listingAddr(r)} NSW site:domain.com.au`)}`;

  if (prefs.listBeds == null) prefs.listBeds = 0;
  let listingsShown = 15;
  function renderListings() {
    const panel = $('#listingPanel');
    const v = currentView();
    const has = Object.keys(LISTINGS.recs).length > 0;
    if (!v || !has) { panel.hidden = true; return; }
    panel.hidden = false;
    let list = listingsFor(v);
    const all = list.length;
    if (prefs.listBeds) list = list.filter((r) => r.beds != null && r.beds >= prefs.listBeds);
    $('#listingTitle').textContent = `For sale now (${all.toLocaleString('en-AU')})`;
    const mids = list.map((r) => askOf(r)).filter((p) => p.low != null).map((p) => (p.low + p.high) / 2);
    $('#listingSummary').textContent = list.length
      ? `${list.length} listing${list.length === 1 ? '' : 's'} from your alert emails${mids.length ? `, median asking ${fmtShort(median(mids))}` : ''}. Asking prices are what the agent advertised; they're matched to the sale when the home sells.`
      : 'None of your alert listings match this search yet.';
    const chips = $('#listingBeds'); chips.replaceChildren(el('span', { class: 'seg-label' }, 'Beds'));
    for (const [k, label] of [[0, 'Any'], [2, '2+'], [3, '3+'], [4, '4+']]) chips.append(el('button', { type: 'button', 'aria-selected': String(prefs.listBeds === k), onclick: () => { prefs.listBeds = k; savePrefs(); renderListings(); } }, label));
    const box = $('#listingList'); box.replaceChildren();
    for (const r of list.slice(0, listingsShown)) {
      const p = askOf(r);
      const hist = r.prices.length > 1 ? `Was ${fmtAsk(r.prices[r.prices.length - 2])} · ` : '';
      box.append(el('li', {},
        el('div', { class: 'srow' }, el('b', {}, fmtAsk(p)), el('span', { class: 'sdate' }, `seen ${fmtDate(r.firstSeen)}`)),
        el('div', { class: 'sline' }, listingAddr(r)),
        el('div', { class: 'smeta' }, [featText(r), r.unit ? 'Unit / townhouse' : ''].filter(Boolean).join(' · ')),
        (p.flag || hist) ? el('div', { class: 'pricechg' }, `${hist}${p.flag || 'Price changed'} ${fmtDate(p.d)}`) : null,
        el('a', { class: 'lookup', href: domainSearch(r), target: '_blank', rel: 'noopener' }, 'Open the listing ↗')));
    }
    const more = $('#moreListings');
    more.hidden = list.length <= listingsShown;
    more.onclick = () => { listingsShown += 30; renderListings(); };
  }

  // Match a sale to an earlier listing of the same address (asked vs sold).
  let listingIndex = null;
  function listingForSale(i) {
    if (!LISTINGS || !Object.keys(LISTINGS.recs).length) return null;
    if (!listingIndex) {
      listingIndex = new Map();
      for (const r of Object.values(LISTINGS.recs)) {
        const k = `${r.suburb}|${normStreet(r.street)}|${r.num}`;
        (listingIndex.get(k) || listingIndex.set(k, []).get(k)).push(r);
      }
    }
    const k = `${DER.locName[C.loc[i]]}|${normStreet(C.dict.street[C.street[i]] || '')}|${leadNum(C.dict.house[C.house[i]] || '')}`;
    const cands = (listingIndex.get(k) || []).filter((r) => C.d[i] >= r.firstSeen - 14 && dayNum(C.d[i]) - dayNum(r.lastSeen) < 365);
    if (!cands.length) return null;
    if (cands.length === 1) return cands[0];
    const pr = C.price[i]; // several units at one street number: closest asking price
    return cands.reduce((b, r) => { const a = askOf(r), d = a.low ? Math.abs((a.low + a.high) / 2 - pr) : Infinity; return d < b.d ? { r, d } : b; }, { r: null, d: Infinity }).r;
  }
  function askedEl(i) {
    const r = listingForSale(i);
    if (!r) return null;
    const first = r.prices[0], last = askOf(r), pr = C.price[i];
    const ref = last.low != null ? (last.low + last.high) / 2 : null;
    const diff = ref ? (pr - ref) / ref : null;
    return el('div', { class: 'asked' }, `${featText(r)}${featText(r) ? ' · ' : ''}asked ${fmtAsk(last)}${first !== last && first.low != null ? ` (first ${fmtAsk(first)})` : ''}`,
      diff != null ? el('span', { class: diff < 0 ? 'down' : 'up' }, ` · sold ${Math.abs(diff * 100).toFixed(1)}% ${diff < 0 ? 'under' : 'over'}`) : null);
  }

  // ---------- resales: the same property sold twice ----------
  // For each sale, the previous sale of the same property (or -1). Built once, when first needed.
  let RESALE = null;
  function resaleIndex() {
    if (RESALE) return RESALE;
    const prev = new Int32Array(N).fill(-1);
    if (C.prop && C.prop.length === N) {
      const ids = [];
      for (let i = 0; i < N; i++) if (DER.keep[i] && C.prop[i]) ids.push(i);
      const order = Uint32Array.from(ids).sort((a, b) => (C.prop[a] - C.prop[b]) || (C.d[a] - C.d[b]));
      for (let k = 1; k < order.length; k++) if (C.prop[order[k]] === C.prop[order[k - 1]]) prev[order[k]] = order[k - 1];
    }
    RESALE = prev;
    return prev;
  }
  const dayNum = (d) => Date.UTC(Math.floor(d / 10000), (Math.floor(d / 100) % 100) - 1, d % 100) / 864e5;
  // Pairs of sales of the same property: later sale matches the search; leaves out pairs that aren't comparable.
  function resalesFor(list) {
    const prev = resaleIndex();
    const out = [];
    for (const s of list) {
      const j = prev[s.i];
      if (j < 0) continue;
      const i = s.i;
      const years = (dayNum(C.d[i]) - dayNum(C.d[j])) / 365.25;
      if (years < 0.5) continue;                                  // quick re-sales are often not like-for-like
      if (C.nature[j] === 86 && C.nature[i] !== 86) continue;     // was vacant land, now has a house ('V')
      if (C.strata[j] !== C.strata[i]) continue;
      const a1 = C.area[j], a2 = C.area[i];
      if (a1 > 0 && a2 > 0 && Math.abs(a1 - a2) / Math.max(a1, a2) > 0.1) continue; // block was subdivided or merged
      const total = C.price[i] / C.price[j] - 1;
      const yearly = Math.pow(C.price[i] / C.price[j], 1 / years) - 1;
      if (yearly > 0.5 || yearly < -0.3) continue;                // likely a rebuild, renovation or unusual sale
      out.push({ s, prevPrice: C.price[j], prevD: C.d[j], years, total, yearly });
    }
    return out;
  }
  const fmtPct = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;
  let resalesShown = 10;
  function renderResales() {
    const panel = $('#resalePanel');
    const v = currentView();
    if (!v || !N || !C.prop) { panel.hidden = true; return; }
    const pairs = resalesFor(salesFor(v));
    panel.hidden = false;
    const box = $('#resaleList'); box.replaceChildren();
    if (!pairs.length) {
      $('#resaleSummary').textContent = 'No homes in this search have sold twice yet in your data. Importing more years of history gives more resales.';
      $('#moreResales').hidden = true;
      return;
    }
    const recent = pairs.filter((r) => r.s.d >= Number(String(thisMonth()).replace('-', '')) * 100 - 30000); // last ~3 years
    const med = median(pairs.map((r) => r.yearly));
    const medRecent = recent.length >= 5 ? median(recent.map((r) => r.yearly)) : null;
    $('#resaleSummary').replaceChildren(
      el('b', {}, `${fmtPct(med)} a year`), ` typical growth, from ${pairs.length.toLocaleString('en-AU')} home${pairs.length === 1 ? '' : 's'} sold twice`,
      medRecent != null ? ` (${fmtPct(medRecent)} a year for resales in the last 3 years)` : '',
      '. Each home is compared only with its own earlier sale, so the mix of homes doesn’t skew it. Renovations still push some results up.');
    for (const r of pairs.slice(0, resalesShown)) {
      const s = r.s;
      box.append(el('li', {},
        el('div', { class: 'srow' }, el('b', {}, `${fmtShort(r.prevPrice)} → ${fmtShort(s.price)}`),
          el('span', { class: r.total >= 0 ? 'up' : 'down' }, `${fmtPct(r.total)} · ${fmtPct(r.yearly)}/yr`)),
        el('div', { class: 'sline' }, `${s.street ? (s.house ? s.house + ' ' : '') + titleCase(s.street) + ', ' : ''}${titleCase(s.loc)}`),
        el('div', { class: 'smeta' }, `${fmtDate(r.prevD)} → ${fmtDate(s.d)} (${r.years.toFixed(1)} years) · ${typeName(s.type)}${s.area ? ' · ' + fmtArea(s.area) : ''}`),
        floodEl(s.i),
        s.street ? el('a', { class: 'lookup', href: lookupUrl(s), target: '_blank', rel: 'noopener' }, 'Look up on property.com.au ↗') : null));
    }
    const more = $('#moreResales');
    more.hidden = pairs.length <= resalesShown;
    more.onclick = () => { resalesShown += 20; renderResales(); };
  }

  let salesShown = 30;
  function renderSalesList() {
    const box = $('#salesList'); box.replaceChildren();
    const panel = $('#salesPanel');
    const v = currentView();
    if (!v || !N) { panel.hidden = true; return; }
    panel.hidden = false;
    const list = salesFor(v); // newest first
    $('#salesTitle').textContent = `Sales matching this search (${list.length.toLocaleString('en-AU')})`;
    for (const s of list.slice(0, salesShown)) {
      box.append(el('li', {},
        el('div', { class: 'srow' }, el('b', {}, fmtMoney(s.price)), el('span', { class: 'sdate' }, fmtDate(s.d))),
        el('div', { class: 'sline' }, `${s.street ? (s.house ? s.house + ' ' : '') + titleCase(s.street) + ', ' : ''}${titleCase(s.loc)}`),
        el('div', { class: 'smeta' }, [typeName(s.type), fmtArea(s.area), s.zone ? `zone ${s.zone}` : ''].filter(Boolean).join(' · ')),
        askedEl(s.i),
        floodEl(s.i),
        s.street ? el('a', { class: 'lookup', href: lookupUrl(s), target: '_blank', rel: 'noopener' }, 'Look up on property.com.au ↗') : null));
    }
    if (!list.length) box.append(el('li', { class: 'table-empty' }, 'No sales match these filters.'));
    const more = $('#moreSales');
    more.hidden = list.length <= salesShown;
    more.onclick = () => { salesShown += 50; renderSalesList(); };
  }

  // property.com.au pages use internal ids, so search for the address on that site instead.
  const lookupUrl = (s) => {
    const addr = `${s.house ? s.house + ' ' : ''}${titleCase(s.street)} ${titleCase(s.loc)} NSW ${s.pc}`.replace(/\s+/g, ' ').trim();
    return `https://www.google.com/search?q=${encodeURIComponent(`${addr} site:property.com.au`)}`;
  };

  // ---------- maps (Leaflet, bundled in vendor/) ----------
  const NR_CENTER = [-28.83, 153.25];
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#0f6b5c';
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const MAX_DOTS = 4000;
  function makeMap(elm) {
    // canvas drawing is fast with thousands of dots; 'tolerance' lets a fingertip near a dot count as a tap on it
    const m = L.map(elm, { preferCanvas: true, renderer: L.canvas({ tolerance: 12 }) }).setView(NR_CENTER, 9);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · G-NAF',
    }).addTo(m);
    return m;
  }
  // colour dots by price: lower third / middle / upper third of the sales shown
  function priceBands(list) {
    const p = Float64Array.from(list, (s) => C.price[s.i]).sort();
    return p.length ? [p[Math.floor(p.length / 3)], p[Math.floor((2 * p.length) / 3)]] : [0, 0];
  }
  function addDots(layer, list, opts = {}) {
    const [t1, t2] = priceBands(list);
    const cols = [cssVar('--s2'), cssVar('--s3'), cssVar('--s5')];
    // suburb-level sales: one bubble per suburb (size = number of sales, colour = median)
    const subs = new Map();
    for (const s of list) {
      const i = s.i;
      if (DER.level[i] !== 1) continue;
      const k = C.loc[i];
      let g = subs.get(k);
      if (!g) { g = { lat: DER.lat[i], lon: DER.lon[i], loc: DER.locName[k], prices: [] }; subs.set(k, g); }
      g.prices.push(C.price[i]);
    }
    for (const g of subs.values()) {
      const med = median(g.prices);
      const c = med <= t1 ? cols[0] : med <= t2 ? cols[1] : cols[2];
      const mk = L.circleMarker([g.lat, g.lon], { radius: Math.min(22, 6 + Math.sqrt(g.prices.length) * 1.6), weight: 1.5, color: '#ffffff', fillColor: c,
        fillOpacity: opts.faint ? 0.35 : 0.75, interactive: !opts.faint });
      if (!opts.faint) mk.bindPopup(() => `<b>${esc(titleCase(g.loc))}</b><br>${g.prices.length.toLocaleString('en-AU')} sale${g.prices.length === 1 ? '' : 's'} · median ${fmtMoney(med)}<br><span style="opacity:.7">Shown at the suburb centre</span>`);
      mk.addTo(layer);
    }
    const shown = [];
    for (const s of list) { if (s.level === 2) { shown.push(s); if (shown.length >= MAX_DOTS) break; } } // list is newest first
    for (const s of shown) {
      const c = s.price <= t1 ? cols[0] : s.price <= t2 ? cols[1] : cols[2];
      const mk = L.circleMarker([s.lat, s.lon], { radius: opts.small ? 4 : opts.slim ? 3.5 : 5.5, weight: 1, color: '#ffffff', fillColor: c, fillOpacity: opts.faint ? 0.45 : 0.9, interactive: !opts.faint });
      if (!opts.faint) mk.bindPopup(() => `<b>${fmtMoney(s.price)}</b> · ${fmtDate(s.d)}<br>${esc(s.house ? s.house + ' ' : '')}${esc(titleCase(s.street))}, ${esc(titleCase(s.loc))}<br><span style="opacity:.7">${esc(typeName(s.type))}${s.area ? ' · ' + fmtArea(s.area) : ''}${s.approx ? ' · position approximate' : ''}</span>${floodText(s.i) ? `<br>${esc(floodText(s.i))}<br><span style="opacity:.75">${esc(eventText(s.i))}</span>` : ''}${s.street ? `<br><a href="${esc(lookupUrl(s))}" target="_blank" rel="noopener">Look up on property.com.au ↗</a>` : ''}`);
      mk.addTo(layer);
    }
    return { shown: shown.length, suburbs: subs.size, bands: [t1, t2], cols };
  }
  function shapeLayer(shape) {
    const style = { color: cssVar('--accent'), weight: 2.5, dashArray: '6 5', fillOpacity: 0.08 };
    if (!shape) return null;
    return shape.type === 'circle' ? L.circle(shape.c, { ...style, radius: shape.r }) : L.polygon(shape.pts, style);
  }

  const boundsOf = (list) => { let a = 90, b = 180, c = -90, d = -180; for (const s of list) { const la = s.lat, lo = s.lon; if (la < a) a = la; if (la > c) c = la; if (lo < b) b = lo; if (lo > d) d = lo; } return L.latLngBounds([a, b], [c, d]); };
  // Flood layer: each address in the council's floor-level list, coloured by water over the floor.
  const FLOOD_LAYERS = [['off', 'Off'], ['100', '1-in-100'], ['2022', '2022 flood'], ['2017', '2017 flood']];
  let floodPtsCache = null, floodPtsKey = null;
  function floodPoints() {
    if (!FLOOD || !FLOOD.recs || !GEO) return [];
    if (floodPtsKey === FLOOD && floodPtsCache) return floodPtsCache;
    const pts = [];
    for (const [k, r] of Object.entries(FLOOD.recs)) {
      const [sub, street, num] = k.split('|');
      const sp = houseSpot(street, num, sub);
      if (sp) pts.push({ lat: sp[0], lon: sp[1], d100: r[0] - r[1], label: `${num} ${titleCase(street)}, ${titleCase(sub)}` });
    }
    floodPtsCache = pts; floodPtsKey = FLOOD;
    return pts;
  }
  const floodLevelOver = (d100, which) => which === '100' ? d100 : overEvent(d100, +which); // floor height above that flood (negative = water over floor)
  // Smooth water surface: depth over the floor at listed addresses, blended between neighbours
  // (inverse-distance weighting on a ~10 m grid) and faded out away from any listed address.
  // It is a picture of the council data, not a flood model: nothing is drawn far from a listed home.
  const SURFACE_REACH = 70; // metres: how far a home's value spreads
  const surfaceCache = new Map();
  function floodSurface(which) {
    const pts = floodPoints();
    const key = `${which}|${pts.length}`;
    if (surfaceCache.has(key)) return surfaceCache.get(key);
    if (!pts.length) return null;
    let la1 = 90, la2 = -90, lo1 = 180, lo2 = -180;
    for (const p of pts) { la1 = Math.min(la1, p.lat); la2 = Math.max(la2, p.lat); lo1 = Math.min(lo1, p.lon); lo2 = Math.max(lo2, p.lon); }
    const mLat = 111320, mLon = 111320 * Math.cos(toRad((la1 + la2) / 2));
    const padLat = SURFACE_REACH / mLat, padLon = SURFACE_REACH / mLon;
    la1 -= padLat; la2 += padLat; lo1 -= padLon; lo2 += padLon;
    const cell = 8; // metres per pixel
    const W = Math.min(1600, Math.ceil(((lo2 - lo1) * mLon) / cell)), H = Math.min(1600, Math.ceil(((la2 - la1) * mLat) / cell));
    // bucket the homes so each pixel only looks at nearby ones
    const B = SURFACE_REACH, buckets = new Map();
    const bx = (lon) => Math.floor(((lon - lo1) * mLon) / B), by = (lat) => Math.floor(((lat - la1) * mLat) / B);
    const vals = pts.map((p) => -floodLevelOver(p.d100, which)); // water depth over the floor (negative = dry)
    pts.forEach((p, i) => { const k = `${bx(p.lon)},${by(p.lat)}`; (buckets.get(k) || buckets.set(k, []).get(k)).push(i); });
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(W, H), d = img.data;
    // depth → colour: shallow light blue to deep navy
    const stops = [[0, [150, 205, 240]], [0.75, [70, 145, 215]], [1.5, [30, 90, 180]], [3, [12, 45, 120]]];
    const colour = (v) => { for (let k = 1; k < stops.length; k++) if (v <= stops[k][0]) { const [a0, c0] = stops[k - 1], [a1, c1] = stops[k], f = (v - a0) / (a1 - a0); return c0.map((c, j) => c + (c1[j] - c) * f); } return stops[stops.length - 1][1]; };
    for (let j = 0; j < H; j++) {
      const lat = la2 - ((j + 0.5) * cell) / mLat;
      const gy = by(lat);
      for (let i = 0; i < W; i++) {
        const lon = lo1 + ((i + 0.5) * cell) / mLon;
        const gx = bx(lon);
        let sw = 0, sv = 0, dmin = Infinity;
        for (let yy = gy - 1; yy <= gy + 1; yy++) for (let xx = gx - 1; xx <= gx + 1; xx++) {
          const list = buckets.get(`${xx},${yy}`); if (!list) continue;
          for (const k of list) {
            const dx = (pts[k].lon - lon) * mLon, dy = (pts[k].lat - lat) * mLat, dd = dx * dx + dy * dy;
            if (dd > SURFACE_REACH * SURFACE_REACH) continue;
            if (dd < dmin) dmin = dd;
            const w = 1 / (dd + 100);
            sw += w; sv += w * vals[k];
          }
        }
        if (!sw) continue;
        const v = sv / sw;
        if (v <= 0) continue; // floor above the water here: leave clear
        const reach = Math.max(0, Math.min(1, (SURFACE_REACH - Math.sqrt(dmin)) / (SURFACE_REACH - 25)));
        const alpha = reach * Math.min(1, 0.45 + v / 2) * 0.8;
        const [r, g, b] = colour(v), o = (j * W + i) * 4;
        d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = Math.round(alpha * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    const out = { url: cv.toDataURL('image/png'), bounds: [[la1, lo1], [la2, lo2]] };
    if (surfaceCache.size > 6) surfaceCache.clear();
    surfaceCache.set(key, out);
    return out;
  }
  function addFloodLayer(layer, which, opts = {}) {
    if (!which || which === 'off') return 0;
    const pts = floodPoints();
    const surf = floodSurface(which);
    if (surf) L.imageOverlay(surf.url, surf.bounds, { pane: 'floodPane', opacity: opts.faint ? 0.55 : 1, className: 'flood-surface', interactive: false }).addTo(layer);
    if (!opts.faint) {
      // invisible tap targets so each listed home can still be checked
      for (const p of pts) {
        const o = floodLevelOver(p.d100, which);
        L.circle([p.lat, p.lon], { radius: 14, stroke: false, fillOpacity: 0 }) // same layer as the sales dots, so taps reach it
          .bindPopup(() => `<b>${esc(p.label)}</b><br>${o < 0 ? `About ${Math.abs(o).toFixed(1)} m of water over the floor` : `Floor about ${o.toFixed(1)} m above the water`} in ${which === '100' ? 'a 1-in-100 flood' : `the ${which} flood (est.)`}`)
          .addTo(layer);
      }
    }
    return pts.length;
  }
  function floodPane(map) { if (!map.getPane('floodPane')) { const pn = map.createPane('floodPane'); pn.style.zIndex = 350; } }

  function setMapFull(on) {
    $('#mapPanel').classList.toggle('full', on);
    document.body.classList.toggle('noscroll', on);
    $('#mapFullBtn').textContent = on ? 'Close' : 'Full screen';
    $('#mapFullBtn').setAttribute('aria-pressed', String(on));
    if (mainMap) setTimeout(() => mainMap.invalidateSize(), 60);
  }
  $('#mapFullBtn').addEventListener('click', () => setMapFull(!$('#mapPanel').classList.contains('full')));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#mapPanel').classList.contains('full')) setMapFull(false); });

  let mainMap = null, mainLayer = null, lastFit = '';
  function renderMapPanel() {
    const panel = $('#mapPanel');
    const v = currentView();
    if (!v || !N || typeof L === 'undefined') { panel.hidden = true; return; }
    panel.hidden = false;
    if (!mainMap) { mainMap = makeMap($('#map')); floodPane(mainMap); mainLayer = L.layerGroup().addTo(mainMap); }
    mainLayer.clearLayers();
    const hasFlood = !!(FLOOD && FLOOD.recs && Object.keys(FLOOD.recs).length && GEO);
    $('#floodLayerRow').hidden = !hasFlood;
    let floodShown = 0;
    if (hasFlood) {
      const seg = $('#floodLayerSeg'); seg.replaceChildren();
      for (const [k, label] of FLOOD_LAYERS) seg.append(el('button', { role: 'tab', 'aria-selected': String(prefs.floodLayer === k), onclick: () => { prefs.floodLayer = k; savePrefs(); renderMapPanel(); } }, label));
      floodShown = addFloodLayer(mainLayer, prefs.floodLayer);
      const fl = $('#floodLegend'); fl.replaceChildren();
      if (prefs.floodLayer !== 'off') {
        fl.append(el('span', { class: 'depthscale' }, 'Water over the floor', el('i', { class: 'depthbar' }), '0 → 3 m+'),
          el('span', {}, `Smoothed between ${floodShown.toLocaleString('en-AU')} homes in the council list${prefs.floodLayer === '100' ? '' : ' (estimated)'}. Unshaded = floors stayed dry, or no listed homes nearby. Tap a spot for a home's figure.`));
      }
    }
    const list = salesFor(v);
    const placed = list.filter((s) => DER.level[s.i] > 0);
    const res = addDots(mainLayer, list, { slim: !!(FLOOD && GEO && prefs.floodLayer !== 'off') });
    let houseN = 0; for (const s of list) if (DER.level[s.i] === 2) houseN++;
    let listShown = 0; const listPts = [];
    if (Object.keys(LISTINGS.recs).length) {
      const ring = cssVar('--accent');
      for (const r of listingsFor(v)) {
        if (prefs.listBeds && !(r.beds >= prefs.listBeds)) continue;
        const sp = listingSpot(r); if (!sp) continue;
        listShown++; listPts.push({ lat: sp[0], lon: sp[1] });
        L.circleMarker([sp[0], sp[1]], { radius: 8, weight: 3, color: ring, fillColor: '#ffffff', fillOpacity: 0.85 })
          .bindPopup(() => `<b>For sale: ${esc(fmtAsk(askOf(r)))}</b><br>${esc(listingAddr(r))}<br>${esc(featText(r))}<br><span style="opacity:.7">First in your alerts ${fmtDate(r.firstSeen)}</span><br><a href="${esc(domainSearch(r))}" target="_blank" rel="noopener">Open the listing ↗</a>`)
          .addTo(mainLayer);
      }
    }
    const sl = shapeLayer(v.shape); if (sl) sl.addTo(mainLayer);
    const leg = $('#mapLegend'); leg.replaceChildren();
    if (placed.length) {
      const [t1, t2] = res.bands;
      [[`Up to ${fmtShort(t1)}`, 0], [`${fmtShort(t1)}–${fmtShort(t2)}`, 1], [`Over ${fmtShort(t2)}`, 2]].forEach(([t, i]) => leg.append(el('span', {}, el('i', { class: 'dot', style: `background:${res.cols[i]}` }), t)));
    }
    if (listShown) leg.append(el('span', {}, el('i', { class: 'ring' }), `For sale now (${listShown})`));
    $('#mapNote').textContent = !GEO
      ? 'House positions are still being prepared. They appear here once the address file has been built.'
      : !list.length ? 'No sales match this search.'
      : `${list.length.toLocaleString('en-AU')} sales: ${res.shown.toLocaleString('en-AU')} shown at their house${res.shown < houseN ? ' (latest only)' : ''}${res.suburbs ? `, the rest grouped into ${res.suburbs.toLocaleString('en-AU')} suburb bubble${res.suburbs === 1 ? '' : 's'}` : ''}${placed.length < list.length ? ` · ${(list.length - placed.length).toLocaleString('en-AU')} couldn't be placed` : ''}. Tap a dot for details.`;
    setTimeout(() => {
      mainMap.invalidateSize();
      const key = JSON.stringify([v.id, v.area, v.locs, v.types, v.min, v.max, v.shape, v.landMin, v.landMax, v.street, v.flood, listPts.length]);
      if (key === lastFit) return;
      lastFit = key;
      if (sl) mainMap.fitBounds(sl.getBounds(), { padding: [16, 16] });
      else if (placed.length || listPts.length) mainMap.fitBounds(boundsOf([...placed, ...listPts]), { padding: [16, 16], maxZoom: 16 });
      else mainMap.setView(NR_CENTER, 9);
    }, 0);
  }

  // drawing an area for a search
  const mDlg = $('#mapDialog');
  let drawMap = null, drawLayer = null, ctxLayer = null;
  const draw = { mode: 'poly', pts: [], c: null, r: 1000 };
  function openDrawMap() {
    if (typeof L === 'undefined') return toast('The map could not load. Check your internet connection.');
    if (!GEO) toast('House positions are not ready yet, so no sales can be placed inside an area.');
    const sh = editing.shape;
    draw.mode = sh && sh.type === 'circle' ? 'circle' : 'poly';
    draw.pts = sh && sh.type === 'poly' ? sh.pts.map((p) => [...p]) : [];
    draw.c = sh && sh.type === 'circle' ? [...sh.c] : null;
    draw.r = sh && sh.type === 'circle' ? sh.r : 1000;
    mDlg.showModal();
    if (!drawMap) {
      drawMap = makeMap($('#drawMap'));
      drawMap.doubleClickZoom.disable(); // taps place corners, so quick taps must not zoom
      ctxLayer = L.layerGroup().addTo(drawMap);
      drawLayer = L.layerGroup().addTo(drawMap);
      drawMap.on('click', (e) => {
        const p = [+e.latlng.lat.toFixed(5), +e.latlng.lng.toFixed(5)];
        if (draw.mode === 'poly') draw.pts.push(p); else draw.c = p;
        redrawShape();
      });
    }
    ctxLayer.clearLayers();
    floodPane(drawMap);
    if (FLOOD && GEO) addFloodLayer(ctxLayer, prefs.floodLayer === 'off' ? '100' : prefs.floodLayer, { faint: true }); // helps trace the floodplain
    const context = salesFor({ ...editing, shape: null });
    addDots(ctxLayer, context, { small: true, faint: true });
    setTimeout(() => {
      drawMap.invalidateSize();
      const sl = shapeLayer(sh);
      const placed = context.filter((s) => s.lat != null);
      if (sl) drawMap.fitBounds(sl.getBounds(), { padding: [30, 30] });
      else if (placed.length) drawMap.fitBounds(boundsOf(placed), { padding: [20, 20], maxZoom: 15 });
      else drawMap.setView(NR_CENTER, 9);
    }, 0);
    renderDrawTools();
    redrawShape();
  }
  const currentDrawShape = () => draw.mode === 'poly' ? (draw.pts.length >= 3 ? { type: 'poly', pts: draw.pts } : null) : (draw.c ? { type: 'circle', c: draw.c, r: draw.r } : null);
  function redrawShape() {
    drawLayer.clearLayers();
    const col = cssVar('--accent');
    if (draw.mode === 'poly') {
      if (draw.pts.length >= 3) L.polygon(draw.pts, { color: col, weight: 2.5, fillOpacity: 0.12 }).addTo(drawLayer);
      else if (draw.pts.length === 2) L.polyline(draw.pts, { color: col, weight: 2.5 }).addTo(drawLayer);
      draw.pts.forEach((p) => L.circleMarker(p, { radius: 6, color: col, weight: 2, fillColor: '#fff', fillOpacity: 1, interactive: false }).addTo(drawLayer));
    } else if (draw.c) {
      L.circle(draw.c, { radius: draw.r, color: col, weight: 2.5, fillOpacity: 0.12, interactive: false }).addTo(drawLayer);
      L.circleMarker(draw.c, { radius: 6, color: col, weight: 2, fillColor: '#fff', fillOpacity: 1, interactive: false }).addTo(drawLayer);
    }
    const sh = currentDrawShape();
    const n = sh ? salesFor({ ...editing, shape: sh }).length : null;
    $('#drawHint').textContent = draw.mode === 'poly'
      ? (draw.pts.length < 3 ? `Tap the map to place the corners of your area (${draw.pts.length} so far, at least 3).` : `${draw.pts.length} corners · ${n.toLocaleString('en-AU')} matching sales inside. Keep tapping to add corners.`)
      : (draw.c ? `${n.toLocaleString('en-AU')} matching sales within ${fmtDist(draw.r)}. Tap elsewhere to move the pin.` : 'Tap the map to drop a pin.');
    $('#drawUndo').disabled = draw.mode !== 'poly' || !draw.pts.length;
  }
  function renderDrawTools() {
    const seg = $('#drawMode'); seg.replaceChildren();
    for (const [k, label] of [['poly', 'Draw area'], ['circle', 'Distance from a pin']]) {
      seg.append(el('button', { type: 'button', role: 'tab', 'aria-selected': String(draw.mode === k), onclick: () => { draw.mode = k; renderDrawTools(); redrawShape(); } }, label));
    }
    $('#radiusRow').hidden = draw.mode !== 'circle';
    $('#radius').value = String(draw.r);
    $('#radiusLabel').textContent = fmtDist(draw.r);
  }
  $('#radius').addEventListener('input', (e) => { draw.r = +e.target.value; $('#radiusLabel').textContent = fmtDist(draw.r); redrawShape(); });
  $('#drawUndo').addEventListener('click', () => { draw.pts.pop(); redrawShape(); });
  $('#drawClear').addEventListener('click', () => { draw.pts = []; draw.c = null; redrawShape(); });
  $('#drawCancel').addEventListener('click', () => mDlg.close());
  $('#drawDone').addEventListener('click', () => {
    const sh = currentDrawShape();
    if (draw.mode === 'poly' && draw.pts.length && draw.pts.length < 3) return toast('An area needs at least 3 corners.');
    editing.shape = sh || null;
    mDlg.close();
    renderShapeField(); updateCount();
  });
  function renderShapeField() {
    $('#fShapeLabel').textContent = editing.shape ? shapeLabel(editing.shape) : 'No map area (use the whole area and locations above)';
    $('#fDraw').textContent = editing.shape ? 'Change on map' : 'Draw on map';
    $('#fShapeClear').hidden = !editing.shape;
  }
  $('#fDraw').addEventListener('click', () => openDrawMap());
  $('#fShapeClear').addEventListener('click', () => { editing.shape = null; renderShapeField(); updateCount(); });

  // ---------- filters dialog ----------
  const fDlg = $('#filterDialog');
  let editing = null, isNew = false;

  function openFilters(asNew) {
    isNew = asNew;
    editing = asNew ? { id: '', name: '', area: 'all', locs: [], types: ['house'], min: 0, max: 0, shape: null } : structuredClone(currentView());
    $('#filterTitle').textContent = asNew ? 'New search' : `Edit “${editing.name}”`;
    $('#fName').value = editing.name;
    const areaSel = $('#fArea'); areaSel.replaceChildren();
    for (const g of [...new Set(AREAS.map((a) => a.group))]) areaSel.append(el('optgroup', { label: g }, ...AREAS.filter((a) => a.group === g).map((a) => el('option', { value: a.id }, a.name))));
    areaSel.value = editing.area;
    for (const [id, anyLabel, val] of [['#fLandMin', 'No min', editing.landMin], ['#fLandMax', 'No max', editing.landMax]]) {
      const sel = $(id);
      sel.replaceChildren(el('option', { value: 0 }, anyLabel), ...LAND_STEPS.map((a) => el('option', { value: a }, fmtArea(a))));
      sel.value = String(val || 0);
    }
    $('#fStreet').value = editing.street || '';
    const fsel = $('#fFlood');
    fsel.replaceChildren(...FLOOD_FILTERS.map((f) => el('option', { value: f.id }, f.name)));
    fsel.value = editing.flood || '';
    $('#fFloodField').hidden = !FLOOD && !editing.flood;
    for (const [id, anyLabel, val] of [['#fMin', 'No min', editing.min], ['#fMax', 'No max', editing.max]]) {
      const sel = $(id);
      const steps = val && !PRICE_STEPS.includes(val) ? [...PRICE_STEPS, val].sort((a, b) => a - b) : PRICE_STEPS;
      sel.replaceChildren(el('option', { value: 0 }, anyLabel), ...steps.map((p) => el('option', { value: p }, fmtShort(p))));
      sel.value = String(val || 0);
    }
    $('#fLocSearch').value = '';
    renderTypeChecks(); renderLocChecks(); renderShapeField();
    $('#deleteView').hidden = asNew || views.length <= 1;
    $('#saveAsNew').hidden = asNew;
    $('#filterError').hidden = true;
    fDlg.showModal();
    fDlg.querySelector('.sheet-body').scrollTop = 0;
  }

  function renderTypeChecks() {
    const box = $('#fTypes'); box.replaceChildren();
    for (const t of TYPES) {
      box.append(el('label', { class: 'check' }, el('input', { type: 'checkbox', value: t.id, checked: editing.types.includes(t.id), onchange: (e) => {
        editing.types = TYPES.map((x) => x.id).filter((id) => (id === t.id ? e.target.checked : editing.types.includes(id)));
        updateCount();
      } }), t.name));
    }
  }

  function renderLocChecks() {
    const area = areaOf(editing.area);
    const locs = [...LOC_COUNTS.entries()].filter(([, c]) => areaHas(area, c.pc)).sort((a, b) => b[1].n - a[1].n);
    for (const l of editing.locs) if (!LOC_COUNTS.has(l)) locs.push([l, { n: 0 }]); // chosen but no sales yet
    const box = $('#fLocs'); box.replaceChildren();
    const q = $('#fLocSearch').value.trim().toLowerCase();
    if (!locs.length) box.append(el('p', { class: 'hint' }, N
      ? `Your imported sales don't include any from ${area.name} yet. Check ⋯ (top right) to see which areas your data covers, and import more sales files if needed.`
      : 'Locations appear here once sales data has been imported (⋯ → Import sales files).'));
    // chosen ones first, then the busiest; search narrows the list
    const chosen = new Set(editing.locs);
    const shownLocs = locs.filter(([name]) => !q || name.toLowerCase().includes(q))
      .sort((a, b) => (chosen.has(b[0]) - chosen.has(a[0])) || (b[1].n - a[1].n));
    const LIMIT = 150;
    for (const [name, c] of shownLocs.slice(0, LIMIT)) {
      box.append(el('label', { class: 'check', 'data-name': name.toLowerCase() },
        el('input', { type: 'checkbox', value: name, checked: editing.locs.includes(name), onchange: (e) => {
          editing.locs = e.target.checked ? [...editing.locs, name] : editing.locs.filter((x) => x !== name);
          updateCount();
        } }), el('span', { class: 'grow' }, titleCase(name)), el('span', { class: 'count' }, c.n)));
    }
    if (shownLocs.length > LIMIT) box.append(el('p', { class: 'hint' }, `${(shownLocs.length - LIMIT).toLocaleString('en-AU')} more — type above to find a suburb.`));
    updateCount();
  }

  function updateCount() {
    $('#fCount').textContent = N ? `${salesFor(editing).length.toLocaleString('en-AU')} matching sales` : '';
    if (editing.shape && GEO) {
      const all = salesFor({ ...editing, shape: null });
      const unplaced = all.filter((s) => s.level !== 2 && GEO && GEO.postcodes.has(s.pc)).length;
      $('#fShapeNote').textContent = unplaced ? `${unplaced.toLocaleString('en-AU')} of ${all.length.toLocaleString('en-AU')} sales in these locations in house-level areas couldn't be matched to a house (e.g. lot-only rural addresses), so small drawn areas leave them out.` : '';
    } else $('#fShapeNote').textContent = '';
    $('#fLocLabel').textContent = editing.locs.length ? `Locations · ${editing.locs.length} selected` : 'Locations · all in area';
  }

  $('#fArea').addEventListener('change', (e) => {
    $('#fLocSearch').value = '';
    editing.area = e.target.value;
    const area = areaOf(editing.area);
    editing.locs = editing.locs.filter((l) => { const c = LOC_COUNTS.get(l); return !c || areaHas(area, c.pc); });
    renderLocChecks();
  });
  let locSearchT;
  $('#fLocSearch').addEventListener('input', () => { clearTimeout(locSearchT); locSearchT = setTimeout(renderLocChecks, 150); });
  $('#fLocAll').addEventListener('click', () => { editing.locs = []; $('#fLocSearch').value = ''; renderLocChecks(); });
  $('#fMin').addEventListener('change', (e) => { editing.min = +e.target.value; updateCount(); });
  $('#fLandMin').addEventListener('change', (e) => { editing.landMin = +e.target.value; updateCount(); });
  $('#fLandMax').addEventListener('change', (e) => { editing.landMax = +e.target.value; updateCount(); });
  $('#fFlood').addEventListener('change', (e) => { editing.flood = e.target.value; updateCount(); });
  let streetT;
  $('#fStreet').addEventListener('input', (e) => { clearTimeout(streetT); streetT = setTimeout(() => { editing.street = e.target.value.trim(); updateCount(); }, 250); });
  $('#fMax').addEventListener('change', (e) => { editing.max = +e.target.value; updateCount(); });
  $('#cancelFilters').addEventListener('click', () => fDlg.close());

  function commitFilters(asNew) {
    const name = $('#fName').value.trim();
    const err = (m) => { const e = $('#filterError'); e.textContent = m; e.hidden = false; e.scrollIntoView({ block: 'nearest' }); };
    if (!name) return err('Give this search a name, e.g. “Casino acreage under $800k”.');
    if (editing.min && editing.max && editing.min > editing.max) return err('The minimum price is above the maximum.');
    if (editing.landMin && editing.landMax && editing.landMin > editing.landMax) return err('The minimum land size is above the maximum.');
    editing.street = $('#fStreet').value.trim();
    editing.flood = $('#fFlood').value;
    if (views.some((v) => v.name.toLowerCase() === name.toLowerCase() && (asNew || v.id !== editing.id))) return err('You already have a search with that name.');
    const rec = { ...editing, name };
    if (asNew) { rec.id = 'v-' + Date.now().toString(36); views.push(rec); }
    else {
      const i = views.findIndex((v) => v.id === editing.id);
      const old = views[i];
      if (old.name !== name) { for (const e of entries) if (e.suburb === old.name) { e.suburb = name; e.id = `${name}|${e.month}`; } saveEntries(); }
      views[i] = rec;
    }
    prefs.view = rec.id; salesShown = 30;
    saveViews(); savePrefs(); fDlg.close(); render();
    toast(asNew ? `Saved “${name}”` : 'Filters updated');
  }
  $('#filterForm').addEventListener('submit', (e) => { e.preventDefault(); commitFilters(isNew); });
  $('#saveAsNew').addEventListener('click', () => {
    if ($('#fName').value.trim() === currentView()?.name) $('#fName').value += ' (copy)';
    commitFilters(true);
  });
  $('#deleteView').addEventListener('click', () => {
    if (!confirm(`Delete the saved search “${editing.name}”?`)) return;
    views = views.filter((v) => v.id !== editing.id);
    prefs.view = views[0].id; saveViews(); savePrefs(); fDlg.close(); render();
  });

  // ---------- listing-price entry dialog ----------
  const dlg = $('#entryDialog');
  const form = $('#entryForm');
  function openEntry(rec) {
    form.suburb.replaceChildren(...views.map((v) => el('option', { value: v.name }, v.name)));
    const existing = rec && rec.suburb && rec.month ? entries.find((e) => e.suburb === rec.suburb && e.month === rec.month) : null;
    const r = existing || rec || {};
    form.suburb.value = r.suburb || currentView()?.name || views[0].name;
    form.month.value = r.month || addMonths(thisMonth(), -1);
    form.avgListing.value = r.avgListing ?? '';
    form.listings.value = r.listings ?? '';
    form.notes.value = r.notes || '';
    $('#entryTitle').textContent = existing ? `${existing.suburb} · ${fmtMonth(existing.month)}` : 'Add listing (asking) price';
    $('#deleteEntry').hidden = !existing;
    $('#entryError').hidden = true;
    dlg.dataset.editing = existing ? existing.id : '';
    dlg.showModal();
  }
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const err = (msg) => { const e = $('#entryError'); e.textContent = msg; e.hidden = false; };
    const month = parseMonth(form.month.value);
    if (!month) return err('Please choose a month.');
    const avgListing = parsePrice(form.avgListing.value), listings = parsePrice(form.listings.value);
    if (Number.isNaN(avgListing) || Number.isNaN(listings)) return err('Please enter numbers only.');
    if (avgListing == null) return err('Enter the average listing price.');
    const oldId = dlg.dataset.editing;
    const old = entries.find((e) => e.id === oldId);
    const rec = { ...(old || {}), suburb: form.suburb.value, month, avgListing, listings, notes: form.notes.value.trim() || undefined };
    rec.id = `${rec.suburb}|${rec.month}`; rec.updated = new Date().toISOString();
    entries = entries.filter((e) => e.id !== oldId && e.id !== rec.id);
    entries.push(rec);
    saveEntries(); dlg.close(); render();
    toast(`Saved listing price for ${rec.suburb} · ${fmtMonth(month)}`);
  });
  $('#cancelEntry').addEventListener('click', () => dlg.close());
  $('#deleteEntry').addEventListener('click', () => {
    const id = dlg.dataset.editing;
    if (!id || !confirm('Delete this listing price?')) return;
    entries = entries.filter((e) => e.id !== id); saveEntries(); dlg.close(); render(); toast('Deleted');
  });
  $('#addBtn').addEventListener('click', () => openEntry(null));

  // ---------- menu: import / export ----------
  const menu = $('#menuDialog');
  $('#menuBtn').addEventListener('click', () => { renderImportStatus(); renderFloodStatus(); renderListingStatus(); menu.showModal(); });
  $('#importFlood').addEventListener('change', async (ev) => { const files = ev.target.files; await importFloodPdfs(files); ev.target.value = ''; });
  $('#importListings').addEventListener('change', async (ev) => { const files = ev.target.files; await importListingPdfs(files); ev.target.value = ''; });
  $('#clearListings').addEventListener('click', async () => {
    if (!Object.keys(LISTINGS.recs).length) return toast('No listings to delete');
    if (!confirm('Delete all listings imported from alert emails?')) return;
    LISTINGS = { recs: {}, files: [] }; listingIndex = null;
    try { await idbSet('listings', LISTINGS); } catch { /* ignore */ }
    render(); renderListingStatus();
  });
  $('#clearFlood').addEventListener('click', async () => {
    if (!FLOOD) return toast('No flood levels to delete');
    if (!confirm('Delete the imported flood and floor levels?')) return;
    FLOOD = null; try { await idbSet('flood-levels', null); } catch { /* ignore */ }
    derive(); render(); renderFloodStatus();
  });
  $('#importZip').addEventListener('change', async (ev) => { const files = ev.target.files; await importZipFiles(files); ev.target.value = ''; });
  $('#copyList').addEventListener('click', async () => {
    const list = missingFiles();
    if (!list.length) return toast('Nothing to download: you are up to date');
    const text = list.join('\n');
    try { await navigator.clipboard.writeText(text); toast(`Copied ${list.length} download links. Now run the “NR Prices catch-up” shortcut.`); }
    catch { const ta = $('#copyFallback'); ta.hidden = false; ta.value = text; ta.select(); toast('Select all and copy the links below'); }
  });
  $('#clearImported').addEventListener('click', async () => {
    if (!N) return toast('No imported sales to delete');
    if (!confirm('Delete all sales imported on this phone? You can import the files again later.')) return;
    C = emptyStore(); FILES = { files: [], updated: null };
    try { await idbSet('store2', C); await idbSet('store2-keys', []); await idbSet('store2-files', FILES); } catch { /* ignore */ }
    derive(); render(); renderImportStatus(); toast('Imported sales deleted');
  });
  $('#closeMenu').addEventListener('click', () => menu.close());
  function download(name, text, type) {
    const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);
  const csvEsc = (v) => { if (v == null) return ''; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const ENTRY_COLS = ['suburb', 'month', 'avgListing', 'listings', 'notes'];

  $('#exportJson').addEventListener('click', () => download(`nr-prices-backup-${stamp()}.json`, JSON.stringify({ app: 'nr-prices', version: 2, exported: new Date().toISOString(), views, entries }, null, 2), 'application/json'));
  $('#exportSales').addEventListener('click', () => {
    const v = currentView();
    if (!v) return toast('Pick one of your searches first');
    const rows = salesFor(v);
    const lines = ['contract_date,price,street,locality,postcode,type,land_m2,zone',
      ...rows.map((s) => [String(s.d).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'), s.price, titleCase(s.street), titleCase(s.loc), s.pc, typeName(s.type), s.area ?? '', s.zone].map(csvEsc).join(','))];
    download(`${v.name.replace(/[^\w]+/g, '-')}-sales-${stamp()}.csv`, lines.join('\n'), 'text/csv');
  });
  $('#exportCsv').addEventListener('click', () => download(`nr-prices-listings-${stamp()}.csv`, [ENTRY_COLS.join(','), ...entries.map((e) => ENTRY_COLS.map((c) => csvEsc(e[c])).join(','))].join('\n'), 'text/csv'));

  function parseCsv(text) {
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows.filter((r) => r.some((x) => x.trim()));
  }
  function csvToRecords(text) {
    const rows = parseCsv(text); if (!rows.length) return [];
    const norm = (h) => h.trim().toLowerCase().replace(/[^a-z]/g, '');
    const alias = { suburb: 'suburb', search: 'suburb', month: 'month', date: 'month', avglisting: 'avgListing', averagelisting: 'avgListing', averagelistingprice: 'avgListing', listing: 'avgListing', listings: 'listings', activelistings: 'listings', notes: 'notes', source: 'notes' };
    let header = rows[0].map((h) => alias[norm(h)]), body = rows.slice(1);
    if (!header.includes('suburb') || !header.includes('month')) { header = ENTRY_COLS; body = rows; }
    return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]]).filter(([h]) => h)));
  }
  function importEntries(list) {
    let added = 0; const skipped = [];
    for (const raw of list) {
      const name = String(raw.suburb || '').trim();
      const v = views.find((x) => x.name.toLowerCase() === name.toLowerCase());
      const month = parseMonth(raw.month);
      if (!v) { skipped.push(`no saved search called “${name}”`); continue; }
      if (!month) { skipped.push(`bad month “${raw.month}”`); continue; }
      const avgListing = parsePrice(raw.avgListing), listings = parsePrice(raw.listings);
      if (avgListing == null || Number.isNaN(avgListing)) { skipped.push(`${v.name} ${month}: no listing price`); continue; }
      const rec = { suburb: v.name, month, avgListing, listings: Number.isNaN(listings) ? null : listings, notes: raw.notes ? String(raw.notes).trim() || undefined : undefined };
      rec.id = `${rec.suburb}|${month}`; rec.updated = new Date().toISOString();
      entries = entries.filter((e) => e.id !== rec.id); entries.push(rec); added++;
    }
    saveEntries(); render();
    return { added, skipped };
  }
  const report = ({ added, skipped }) => { if (menu.open) menu.close(); toast(`Imported ${added} row${added === 1 ? '' : 's'}${skipped.length ? `, skipped ${skipped.length}` : ''}`); };

  $('#importFile').addEventListener('change', async (ev) => {
    const file = ev.target.files[0]; ev.target.value = '';
    if (!file) return;
    const text = await file.text();
    try {
      if (/^\s*[[{]/.test(text)) {
        const j = JSON.parse(text);
        if (Array.isArray(j.views) && j.views.length) {
          for (const v of j.views) { const i = views.findIndex((x) => x.id === v.id || x.name === v.name); if (i >= 0) views[i] = v; else views.push(v); }
          saveViews();
        }
        const list = Array.isArray(j) ? j : j.entries;
        if (!Array.isArray(list)) throw new Error('no entries in file');
        report(importEntries(list));
      } else report(importEntries(csvToRecords(text)));
    } catch (e) { toast('Could not read that file: ' + e.message); }
  });

  const pasteDlg = $('#pasteDialog');
  $('#pasteCsvBtn').addEventListener('click', () => { menu.close(); $('#pasteError').hidden = true; pasteDlg.showModal(); });
  $('#cancelPaste').addEventListener('click', () => pasteDlg.close());
  $('#pasteForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const res = importEntries(csvToRecords(ev.target.csv.value));
    if (!res.added) { const e = $('#pasteError'); e.textContent = res.skipped[0] ? `Nothing imported: ${res.skipped[0]}` : 'Nothing to import.'; e.hidden = false; return; }
    ev.target.csv.value = ''; pasteDlg.close(); report(res);
  });
  $('#resetViews').addEventListener('click', () => {
    if (!confirm('Restore the four starting searches (Casino, Lismore, Evans Head, Ballina)? Your other saved searches are kept.')) return;
    for (const d of DEFAULT_VIEWS) { const i = views.findIndex((v) => v.id === d.id); if (i >= 0) views[i] = structuredClone(d); else views.push(structuredClone(d)); }
    saveViews(); menu.close(); render();
  });
  $('#clearAll').addEventListener('click', () => {
    if (!entries.length) return toast('No listing prices to delete');
    if (!confirm(`Delete all ${entries.length} listing prices you've entered? Export a backup first if you might want them.`)) return;
    entries = []; saveEntries(); menu.close(); render(); toast('Deleted');
  });

  for (const d of document.querySelectorAll('dialog:not(#mapDialog)')) d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  let resizeT;
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(renderChart, 120); });

  render();
  loadSales();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});

  // Is a newer version published? Offer a one-tap update (iPhones keep old copies of home-screen apps).
  async function updateNow() {
    toast('Updating…');
    try {
      const regs = navigator.serviceWorker ? await navigator.serviceWorker.getRegistrations() : [];
      await Promise.all(regs.map((r) => r.unregister()));
      if (window.caches) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
    } catch { /* reload anyway */ }
    location.reload();
  }
  async function checkForUpdate() {
    try {
      const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const { version } = await res.json();
      $('#versionInfo').textContent = `App version ${APP_VERSION}${version !== APP_VERSION ? ` · version ${version} is available` : ' · up to date'}`;
      if (version !== APP_VERSION) $('#updateBar').hidden = false;
    } catch { $('#versionInfo').textContent = `App version ${APP_VERSION} (offline)`; }
  }
  $('#updateBtn').addEventListener('click', updateNow);
  $('#forceUpdate').addEventListener('click', updateNow);
  $('#versionInfo').textContent = `App version ${APP_VERSION}`;
  checkForUpdate();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });
})();
