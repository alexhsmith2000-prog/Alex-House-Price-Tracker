/* Northern Rivers Prices — Council floor/flood levels: PDF import (pdf.js), matching to sales, flood text and 2022/2017 estimates.
 * Part of the app; the files in js/ load in order and share one scope (see index.html). */
'use strict';

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
