/* Northern Rivers Prices — Listings from property alert emails: PDF parsing, import with price history, which listings fit a search.
 * Part of the app; the files in js/ load in order and share one scope (see index.html). */
'use strict';

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
        if (!r) { r = data.recs[key] = { suburb: l.suburb, street: l.street, num: l.num, numText: l.numText, unit: l.unit, firstSeen: d, lastSeen: d, prices: [] }; added++; } else { updated++; if (d - 0 > r.lastSeen && dayNum(d) - dayNum(r.lastSeen) > 42) r.relisted = d; }
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
  LINFO = null; ADDR_SALES = null; render(); renderListingStatus(); renderWatchBar();
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
