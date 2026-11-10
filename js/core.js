/* Northern Rivers Prices — Core: app version and error reporting, reference data (areas, property types), saved searches and preferences, small helpers and formatters.
 * Part of the app; the files in js/ load in order and share one scope (see index.html). */
'use strict';

const APP_VERSION = '30'; // keep in step with version.json and VERSION in sw.js

// Show unexpected errors instead of failing silently, so they can be reported.
const showError = (msg) => {
  try { localStorage.setItem('nr-prices.lastError', `${new Date().toLocaleString('en-AU')}: ${msg}`); } catch { /* ignore */ }
  const t = document.getElementById('toast');
  if (t) { t.textContent = `Something went wrong: ${msg}`; t.hidden = false; setTimeout(() => { t.hidden = true; }, 8000); }
};
window.addEventListener('error', (e) => showError(e.message || String(e.error)));
window.addEventListener('unhandledrejection', (e) => showError((e.reason && e.reason.message) || String(e.reason)));

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
