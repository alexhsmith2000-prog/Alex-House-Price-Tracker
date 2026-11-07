/* Northern Rivers Prices — Maps (Leaflet): sales dots and suburb bubbles, flood surface, full screen, drawing an area.
 * Part of the app; the files in js/ load in order and share one scope (see index.html). */
'use strict';

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
      L.circleMarker([sp[0], sp[1]], { radius: r.starred ? 10 : 8, weight: 3, color: ring, fillColor: r.starred ? cssVar('--s3') : '#ffffff', fillOpacity: 0.9 })
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
