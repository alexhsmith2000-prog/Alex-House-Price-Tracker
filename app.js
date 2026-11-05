/* Northern Rivers Prices — NSW sold-price tracker with filters and maps (offline PWA).
 * Sold prices: NSW Valuer General sales files, imported on the phone (IndexedDB).
 * Listing (asking) prices: entered by hand, stored on the phone. */
(() => {
  'use strict';

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
  const prefs = Object.assign({ view: views[0].id, metric: 'median', range: 24, smooth: 3 }, readJson(K.prefs, {}));
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
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2800); }

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
    zone: Uint16Array, purpose: Uint16Array, nature: Uint8Array, strata: Uint8Array, dl: Float64Array, dealing: Uint32Array };
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
    LOC_COUNTS = new Map();
    let latest = 0;
    const locCount = new Uint32Array(locName.length);
    for (let i = 0; i < N; i++) {
      const dg = C.dealing[i];
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
    DATA_INFO = N ? { generated: FILES.updated, latest } : null;
    DATA_VER++; salesCache.clear();
  }

  async function loadSales() {
    const [stored, geoRes, subRes] = await Promise.all([idbGet('store2'), fetch('data/geo.json').catch(() => null), fetch('data/suburbs.json').catch(() => null)]);
    C = stored && stored.v === 2 ? stored : emptyStore();
    FILES = (await idbGet('store2-files')) || { files: [], updated: null };
    try { if (geoRes && geoRes.ok) loadGeo(await geoRes.json()); } catch { /* house positions unavailable */ }
    try { if (subRes && subRes.ok) loadSuburbs(await subRes.json()); } catch { /* suburb positions unavailable */ }
    if (!stored) await migrateOldStore();
    derive();
    render();
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

  // Import helper: grows columns as plain arrays, then saves them as typed arrays.
  function builder() {
    const cols = Object.fromEntries(Object.keys(COLS).map((k) => [k, Array.from(C[k])]));
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
      // r: [contract, locality, postcode, price, area|null, zone, nature, purpose, strata, street, downloaded, dealing, house]
      put(key, r) {
        if (!keyIdx) { keys = keys || []; keyIdx = keyIdx || new Map(); }
        const dl = Number(String(r[10] || '').replace(/\D/g, '').slice(0, 12)) || 0;
        let i = keyIdx.get(key);
        if (i !== undefined && dl < cols.dl[i]) return; // older copy of a sale we have
        if (i === undefined) { i = cols.d.length; keyIdx.set(key, i); keys.push(key); added++; }
        cols.d[i] = r[0]; cols.loc[i] = intern('loc', `${r[1]}|${r[2]}`); cols.price[i] = r[3]; cols.area[i] = r[4] == null ? NaN : r[4];
        cols.zone[i] = intern('zone', r[5] || ''); cols.nature[i] = r[6] ? r[6].charCodeAt(0) : 0; cols.purpose[i] = intern('purpose', r[7] || '');
        cols.strata[i] = r[8] ? 1 : 0; cols.street[i] = intern('street', r[9] || ''); cols.dl[i] = dl;
        cols.dealing[i] = r[11] ? intern('dealing', r[11]) : 0; cols.house[i] = intern('house', r[12] || '');
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

  const salesCache = new Map();
  function salesFor(v) {
    if (!N) return [];
    const key = JSON.stringify([v.area, v.locs, v.types, v.min, v.max, v.shape]);
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
    const out = [];
    for (let i = 0; i < N; i++) {
      if (!DER.keep[i] || !locOk[C.loc[i]] || !typeOk[DER.type[i]]) continue;
      const p = C.price[i];
      if (p < min || p > max) continue;
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
        f[17].trim().toUpperCase().slice(0, 1), f[18].trim().toUpperCase(), f[19].trim() ? 1 : 0, f[8].trim().toUpperCase(), f[4].trim(), f[23].trim(), f[7].trim()]);
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
    toast('Saving…');
    try { await b.save([...done].sort(), new Date().toISOString()); } catch (e) { console.warn(e); toast('Could not save the imported sales on this phone (storage full?).'); return; }
    derive(); render(); renderImportStatus();
    toast(`Imported ${ok} file${ok === 1 ? '' : 's'}: ${read.toLocaleString('en-AU')} NSW sales read, ${b.added.toLocaleString('en-AU')} new${bad.length ? ` · ${bad.length} skipped (not a sales file — that week may not be published yet)` : ''}`);
  }

  const mondaysOf = (year, until) => {
    const out = [];
    for (let d = new Date(Date.UTC(year, 0, 1)); d <= until && d.getUTCFullYear() === year; d.setUTCDate(d.getUTCDate() + 1)) {
      if (d.getUTCDay() === 1) out.push(d.toISOString().slice(0, 10).replace(/-/g, ''));
    }
    return out;
  };
  // every file not yet imported: yearly files for past years, weekly files for this year
  function missingFiles() {
    const have = new Set(FILES.files);
    const now = new Date();
    const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const year = today.getUTCFullYear();
    const urls = [];
    for (let y = 2024; y < year; y++) {
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

  function render() {
    renderHeader(); renderChips(); renderFilterBar(); renderSegs();
    renderCards(); renderChart(); renderMapPanel(); renderTable(); renderSalesList();
  }

  function renderHeader() {
    const h = $('#lastUpdated');
    if (!DATA_INFO) { h.textContent = 'No sold-price data imported yet'; return; }
    const g = new Date(DATA_INFO.generated);
    h.textContent = `${N.toLocaleString('en-AU')} sales · latest ${fmtDate(DATA_INFO.latest)} · updated ${g.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`;
  }

  function renderChips() {
    const nav = $('#viewChips'); nav.replaceChildren();
    for (const v of views) {
      nav.append(el('button', { class: 'chip', role: 'tab', 'aria-selected': String(prefs.view === v.id), onclick: () => { prefs.view = v.id; salesShown = 30; savePrefs(); render(); } },
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
    const price = v.min && v.max ? `${fmtShort(v.min)}–${fmtShort(v.max)}` : v.min ? `${fmtShort(v.min)}+` : v.max ? `Up to ${fmtShort(v.max)}` : 'Any price';
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
    for (const s of series) s.points = s.points.filter((p) => p.month >= start);
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
    const vals = nonEmpty.flatMap((s) => s.points.map((p) => p.v));
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
      for (const mo of months) tb.append(el('tr', {}, el('td', {}, fmtMonthShort(mo)), ...data.map((m) => { const r = m.get(mo); return td(r && r.pooled >= MIN_SALES ? r[key] : null); })));
      if (!months.length) tb.append(el('tr', {}, el('td', { colspan: views.length + 1, class: 'table-empty' }, 'No sales yet.')));
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
    for (const m of months) {
      const r = rows.get(m), e = lst.get(m);
      tb.append(el('tr', { onclick: () => openEntry({ suburb: v.name, month: m }) },
        el('td', {}, fmtMonthShort(m), isProvisional(m) ? '*' : ''), el('td', {}, r ? r.n : 0),
        td(r ? r.median : null), td(r ? r.avg : null), td(e ? e.avgListing : null)));
    }
    if (!months.length) tb.append(el('tr', {}, el('td', { colspan: 5, class: 'table-empty' }, 'No sales match these filters.')));
    t.append(tb);
    $('#tableNote').textContent = months.length ? '* Sales for this month are still being reported. Tap a month to add your listing (asking) price.' : '';
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
        el('div', { class: 'sline' }, `${s.street ? titleCase(s.street) + ', ' : ''}${titleCase(s.loc)}`),
        el('div', { class: 'smeta' }, [typeName(s.type), fmtArea(s.area), s.zone ? `zone ${s.zone}` : ''].filter(Boolean).join(' · '))));
    }
    if (!list.length) box.append(el('li', { class: 'table-empty' }, 'No sales match these filters.'));
    const more = $('#moreSales');
    more.hidden = list.length <= salesShown;
    more.onclick = () => { salesShown += 50; renderSalesList(); };
  }

  // ---------- maps (Leaflet, bundled in vendor/) ----------
  const NR_CENTER = [-28.83, 153.25];
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#0f6b5c';
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const MAX_DOTS = 4000;
  function makeMap(elm) {
    const m = L.map(elm, { preferCanvas: true, tap: true }).setView(NR_CENTER, 9);
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
      const mk = L.circleMarker([s.lat, s.lon], { radius: opts.small ? 4 : 5.5, weight: 1, color: '#ffffff', fillColor: c, fillOpacity: opts.faint ? 0.45 : 0.9, interactive: !opts.faint });
      if (!opts.faint) mk.bindPopup(() => `<b>${fmtMoney(s.price)}</b> · ${fmtDate(s.d)}<br>${esc(s.house ? s.house + ' ' : '')}${esc(titleCase(s.street))}, ${esc(titleCase(s.loc))}<br><span style="opacity:.7">${esc(typeName(s.type))}${s.area ? ' · ' + fmtArea(s.area) : ''}${s.approx ? ' · position approximate' : ''}</span>`);
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
  let mainMap = null, mainLayer = null, lastFit = '';
  function renderMapPanel() {
    const panel = $('#mapPanel');
    const v = currentView();
    if (!v || !N || typeof L === 'undefined') { panel.hidden = true; return; }
    panel.hidden = false;
    if (!mainMap) { mainMap = makeMap($('#map')); mainLayer = L.layerGroup().addTo(mainMap); }
    mainLayer.clearLayers();
    const list = salesFor(v);
    const placed = list.filter((s) => DER.level[s.i] > 0);
    const res = addDots(mainLayer, list);
    let houseN = 0; for (const s of list) if (DER.level[s.i] === 2) houseN++;
    const sl = shapeLayer(v.shape); if (sl) sl.addTo(mainLayer);
    const leg = $('#mapLegend'); leg.replaceChildren();
    if (placed.length) {
      const [t1, t2] = res.bands;
      [[`Up to ${fmtShort(t1)}`, 0], [`${fmtShort(t1)}–${fmtShort(t2)}`, 1], [`Over ${fmtShort(t2)}`, 2]].forEach(([t, i]) => leg.append(el('span', {}, el('i', { class: 'dot', style: `background:${res.cols[i]}` }), t)));
    }
    $('#mapNote').textContent = !GEO
      ? 'House positions are still being prepared. They appear here once the address file has been built.'
      : !list.length ? 'No sales match this search.'
      : `${list.length.toLocaleString('en-AU')} sales: ${res.shown.toLocaleString('en-AU')} shown at their house${res.shown < houseN ? ' (latest only)' : ''}${res.suburbs ? `, the rest grouped into ${res.suburbs.toLocaleString('en-AU')} suburb bubble${res.suburbs === 1 ? '' : 's'}` : ''}${placed.length < list.length ? ` · ${(list.length - placed.length).toLocaleString('en-AU')} couldn't be placed` : ''}. Tap a dot for details.`;
    setTimeout(() => {
      mainMap.invalidateSize();
      const key = JSON.stringify([v.id, v.area, v.locs, v.types, v.min, v.max, v.shape]);
      if (key === lastFit) return;
      lastFit = key;
      if (sl) mainMap.fitBounds(sl.getBounds(), { padding: [16, 16] });
      else if (placed.length) mainMap.fitBounds(boundsOf(placed), { padding: [16, 16], maxZoom: 16 });
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
    if (!locs.length) box.append(el('p', { class: 'hint' }, 'Locations appear here once sales data has been imported.'));
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
  $('#fMax').addEventListener('change', (e) => { editing.max = +e.target.value; updateCount(); });
  $('#cancelFilters').addEventListener('click', () => fDlg.close());

  function commitFilters(asNew) {
    const name = $('#fName').value.trim();
    const err = (m) => { const e = $('#filterError'); e.textContent = m; e.hidden = false; e.scrollIntoView({ block: 'nearest' }); };
    if (!name) return err('Give this search a name, e.g. “Casino acreage under $800k”.');
    if (editing.min && editing.max && editing.min > editing.max) return err('The minimum price is above the maximum.');
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
  $('#menuBtn').addEventListener('click', () => { renderImportStatus(); menu.showModal(); });
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
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
