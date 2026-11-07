/* Northern Rivers Prices — Map positions: house-level (G-NAF) and suburb-centre lookups, distance and shape helpers.
 * Part of the app; the files in js/ load in order and share one scope (see index.html). */
'use strict';

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
