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
// Property alert email (Domain "Home Alert", sold alerts and similar): for each listing a price line,
// then "address, suburb", then bedrooms/bathrooms/cars (on one line or spread over a few).
// Returns { date, kind: 'sale' | 'sold', listings: [{ unit, num, numText, street, suburb, priceText, beds, baths, cars, sold, soldDate }] }
const DATE_RE = /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*,?\s+(20\d\d)/i;
const DATE_RE2 = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),\s+(20\d\d)/i;
const ymdOf = (m) => { if (!m) return null; const [d, mo, y] = /^\d/.test(m[1]) ? [m[1], m[2], m[3]] : [m[2], m[1], m[3]]; return +y * 10000 + MON[mo.slice(0, 3).toUpperCase()] * 100 + +d; };
function parseAlertLines(lines, subject = '') {
  const subs = knownSuburbs();
  const subSet = new Set(subs);
  let date = null, lastPrice = null, lastSoldDate = null, cur = null;
  const out = [];
  const head = `${subject} ${lines.slice(0, 15).join(' ')}`;
  const kind = /\bsold\b/i.test(head) && !/for sale|home alert|coming soon/i.test(subject) ? 'sold' : 'sale';
  const comingSoon = /coming soon/i.test(head);
  const finish = () => { if (cur && (cur.beds != null || cur.baths != null || cur.priceText)) { delete cur.splitSub; out.push(cur); } cur = null; };
  const setFeat = (k, v) => { cur[k] = v; if (cur.beds != null && cur.baths != null && cur.cars != null) finish(); };
  const startAddr = (a, priceText) => {
    finish();
    const rawTail = a[3];
    const tail = rawTail.toUpperCase().split(/\s\d{4}\b/)[0].replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
    const suburb = subs.find((n) => tail === n || tail.startsWith(n + ' ')) || tail.split(' NSW')[0];
    const numPart = a[1].replace(/\s/g, '');
    const [unit, num] = numPart.includes('/') ? numPart.split('/') : ['', numPart];
    cur = { unit, num: houseKey(num.split('-')[0]), numText: num, street: a[2], suburb, priceText: priceText || lastPrice || '', beds: null, baths: null, cars: null,
      sold: kind === 'sold' || /\bsold\b/i.test(priceText || lastPrice || ''), soldDate: lastSoldDate };
    // the suburb may run onto the next line ("…Road, South" / "Bowenfels 2790"): remember the words to join
    if (!/\b\d{4}\b/.test(rawTail) && !subSet.has(tail)) cur.splitSub = tail.split(' ');
    lastPrice = null; lastSoldDate = null;
  };
  // an address part-way along a line (cells of one table row read as one line): "$875,000 Agent Name 76 Taree Street, Tuncurry 2428"
  const findAddr = (line) => {
    const m0 = line.match(ADDR_RE); if (m0) return { a: m0, before: '' };
    // try each word that starts with a digit
    for (let at = line.indexOf(' '); at !== -1; at = line.indexOf(' ', at + 1)) {
      if (!/\d/.test(line[at + 1] || '')) continue;
      const a = line.slice(at + 1).match(ADDR_RE);
      if (a) return { a, before: line.slice(0, at).trim() };
    }
    return null;
  };
  // "$875,000 Sam Agent" (agent's name in the cell beside the price): keep the price
  const trimAgent = (t) => t.replace(/^(.*?(?:\$[\d,.]+\s*[kKmM]?|contact agent|auction))\s+((?:[A-Z][a-zA-Z'’-]+\s?){1,4})$/i, (m, pr, name) => (/^[A-Z]/.test(name) && !/\b(price|guide|new|offers?|over|from|auction|by|negotiation)\b/i.test(name) ? pr : m));
  const PRICE_RE = /\$\s?\d|contact agent|auction|price on application|expressions of interest|by negotiation|price withheld|undisclosed|\bsold\b/i;
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (!date) date = ymdOf(line.match(DATE_RE) || line.match(DATE_RE2));
    if (cur) {
      // the end of a suburb that ran onto this line, with its postcode
      if (cur.splitSub) {
        const sm = line.match(/^([A-Za-z' -]+?)\s+(\d{4})$/);
        delete cur.splitSub;
        if (sm) {
          const rest = sm[1].toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
          const tw = cur.suburb.split(' ');
          for (let k = tw.length; k >= 0; k--) { const n = [...tw.slice(0, k), rest].join(' ').trim(); if (subSet.has(n) || k === Math.min(1, tw.length)) { cur.suburb = n; break; } }
          continue;
        }
      }
      // bedrooms / bathrooms / cars (may be split over lines, or bare numbers beside icons: "4 2 3")
      const fb = line.match(/(\d+)\s*(?:beds?|bedrooms?)\b/i), fa = line.match(/(\d+)\s*(?:baths?|bathrooms?)\b/i), fc = line.match(/(\d+)\s*(?:cars?|parking|garages?|car spaces?)\b/i);
      if ((fb || fa || fc) && line.length < 60) {
        if (fb) cur.beds = +fb[1]; if (fa) cur.baths = +fa[1]; if (fc) cur.cars = +fc[1];
        if (cur.beds != null && cur.baths != null && cur.cars != null) finish();
        continue;
      }
      const bare = line.match(/^(\d{1,2})(?:\s+(\d{1,2}))?(?:\s+(\d{1,2}))?$/);
      if (bare && cur.beds == null && cur.baths == null) {
        cur.beds = +bare[1]; if (bare[2] != null) cur.baths = +bare[2]; if (bare[3] != null) cur.cars = +bare[3];
        if (bare[3] != null) finish();
        continue;
      }
      if (bare && !bare[2] && cur.beds != null) { setFeat(cur.baths == null ? 'baths' : 'cars', +bare[1]); continue; }
      if (cur.beds != null && cur.baths != null) finish();
    }
    const found = findAddr(line);
    if (!found && line.length < 90 && PRICE_RE.test(line)) {
      finish();
      lastPrice = trimAgent(line);
      const sd = ymdOf(line.match(DATE_RE) || line.match(DATE_RE2));
      if (sd && /\bsold\b/i.test(line)) lastSoldDate = sd;
      continue;
    }
    if (!found && cur && /^sold\b/i.test(line)) { cur.sold = true; const sd = ymdOf(line.match(DATE_RE) || line.match(DATE_RE2)); if (sd) cur.soldDate = sd; continue; }
    if (found) {
      const pm = found.before.match(/(\$[\d,.]+\s*[kKmM]?(?:\s*[-–]\s*\$[\d,.]+\s*[kKmM]?)?|contact agent|auction|price on application|expressions of interest|by negotiation|price withheld|undisclosed|sold[^$]*\$[\d,.]+)/i);
      startAddr(found.a, pm ? pm[0] : '');
      continue;
    }
  }
  finish();
  return { date, kind, comingSoon, listings: out };
}
const listingKey = (suburb, street, num, unit) => `${suburb}|${normStreet(street)}|${num}|${unit || ''}`;
// Add one alert email's listings to the store (for-sale prices with history; sold reports kept separately)
function ingestAlert(data, parsed, fallbackDate) {
  const d = parsed.date || fallbackDate || +new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let added = 0, updated = 0, sold = 0;
  for (const l of parsed.listings) {
    const key = listingKey(l.suburb, l.street, l.num, l.unit);
    const { low, high, flag: f0 } = parseAsking(l.priceText);
    const flag = f0 || (parsed.comingSoon ? 'Coming soon' : '');
    let r = data.recs[key];
    const isSold = l.sold;
    if (!r) {
      r = data.recs[key] = { suburb: l.suburb, street: l.street, num: l.num, numText: l.numText, unit: l.unit, firstSeen: isSold ? (l.soldDate || d) : d, lastSeen: d, prices: [] };
      if (isSold) r.soldOnly = true;
      added++;
    } else { updated++; if (!isSold && d > r.lastSeen && dayNum(d) - dayNum(r.lastSeen) > 42) r.relisted = d; }
    if (l.beds != null) r.beds = l.beds; if (l.baths != null) r.baths = l.baths; if (l.cars != null) r.cars = l.cars;
    if (isSold) {
      r.soldAlert = { d: l.soldDate || d, text: l.priceText, price: low != null && low === high ? low : null };
      sold++;
      continue;
    }
    r.firstSeen = Math.min(r.firstSeen, d); r.lastSeen = Math.max(r.lastSeen, d);
    if (r.soldOnly) { r.soldOnly = false; r.firstSeen = d; }
    const last = r.prices[r.prices.length - 1];
    if ((!last || last.text !== l.priceText) && !r.prices.some((x) => x.d === d && x.text === l.priceText)) { r.prices.push({ d, text: l.priceText, low, high, flag }); r.prices.sort((x, y) => x.d - y.d); }
  }
  return { d, added, updated, sold, n: parsed.listings.length };
}
async function saveListingsAndRefresh() {
  try { await idbSet('listings', LISTINGS); } catch { toast('Could not save the listings on this phone.'); return false; }
  LINFO = null; ADDR_SALES = null; render(); renderListingStatus(); renderWatchBar();
  return true;
}
async function importListingPdfs(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const data = structuredClone(LISTINGS);
  const report = [];
  for (const f of files) {
    toast(`Reading ${f.name}…`);
    try {
      const parsed = parseAlertLines(await pdfLines(f), f.name);
      const res = ingestAlert(data, parsed);
      data.files = data.files.filter((x) => x.name !== f.name).concat({ name: f.name, date: res.d, n: res.n, kind: parsed.kind });
      report.push(res.n ? `${f.name}: ${res.n} ${parsed.kind === 'sold' ? 'sold homes' : 'listings'} (${res.added} new, ${res.updated} updated)` : `${f.name}: no listings found — is it a property alert email?`);
    } catch (e) { report.push(`${f.name}: ${e.message || e}`); }
  }
  LISTINGS = data;
  if (await saveListingsAndRefresh()) toast(report.join(' · '));
}
function renderListingStatus() {
  const box = $('#listingStatus'); if (!box) return;
  const n = Object.keys(LISTINGS.recs).length;
  box.textContent = n
    ? `${n.toLocaleString('en-AU')} homes from ${LISTINGS.files.length} alert email${LISTINGS.files.length === 1 ? '' : 's'} (latest ${fmtDate(Math.max(...LISTINGS.files.map((f) => f.date)))}), including ${Object.values(LISTINGS.recs).filter((r) => r.soldAlert).length.toLocaleString('en-AU')} reported sold. Kept on this phone only.`
    : 'No listings yet. Save a Domain alert email as a PDF (Gmail: ⋯ → Print → pinch out → Share → Save to Files) and import it here.';
}
// Which listings fit a search (area, locations, street, type, price, beds)
// Kind of home: units from the address; otherwise from the Valuer General record of an earlier sale at the
// same address (land size, zoning) when there is one, else 'house'.
const listingType = (r, info) => (r.unit ? 'unit' : info && info.vgType && info.vgType !== 'land' ? info.vgType : 'house');
const askOf = (r) => { const p = r.prices[r.prices.length - 1]; return p ? p : { text: '', low: null, high: null }; };
const floodOk = (flood, fd) => {
  if (fd == null) return flood === 'unknown';
  switch (flood) {
    case 'unknown': return false;
    case 'above': return fd >= 0;
    case 'below': return fd < 0;
    case 'below1': return fd < -1;
    case 'below2022': return overEvent(fd, 2022) < 0;
    case 'above2022': return overEvent(fd, 2022) >= 0;
    case 'below2017': return overEvent(fd, 2017) < 0;
    case 'only2022': return overEvent(fd, 2022) < 0 && overEvent(fd, 2017) >= 0;
    default: return true;
  }
};
const suburbSpot = (name) => {
  const pc = (LOC_COUNTS.get(name) || {}).pc;
  const p = SUBURBS && ((pc && SUBURBS.pts[`${name}|${pc}`]) || SUBURBS.byName.get(name));
  return p ? [p[0] / SUBURBS.scale, p[1] / SUBURBS.scale] : null;
};
// The search's filters applied to alert listings, the same way as to sales. What a listing can't tell us
// (land size, no price shown, no map position) leaves it out when that filter is on.
function listingsFor(v) {
  const area = areaOf(v.area);
  const locSet = v.locs && v.locs.length ? new Set(v.locs) : null;
  const streetQ = v.street ? normStreet(v.street) : null;
  const infos = listingInfo();
  const shape = v.shape || null;
  const fine = shape && (shape.type === 'circle' ? shape.r <= 3000 : polyAreaKm2(shape.pts) <= 30);
  const landOn = !!(v.landMin || v.landMax), landMin = v.landMin || 0, landMax = v.landMax || Infinity;
  return Object.values(LISTINGS.recs).filter((r) => {
    if (!r.prices) r.prices = [];
    const pc = (LOC_COUNTS.get(r.suburb) || {}).pc || (SUBURBS && [...Object.keys(SUBURBS.pts)].find((k) => k.startsWith(r.suburb + '|'))?.split('|')[1]);
    if (locSet ? !locSet.has(r.suburb) : (pc ? !areaHas(area, pc) : area.ranges)) return false;
    const info = infos.get(listingKey(r.suburb, r.street, r.num, r.unit)) || {};
    if (v.types && v.types.length) {
      if (!v.types.includes(listingType(r, info))) return false; // with no earlier sale on record, a house counts as in town
    }
    if (v.min || v.max) {
      const a = r.soldOnly ? { low: info.soldPrice ?? null, high: info.soldPrice ?? null } : askOf(r);
      if (a.low == null) return false; // no price shown
      if (v.min && a.high < v.min) return false;
      if (v.max && a.low > v.max) return false;
    }
    if (landOn && !(info.land >= landMin && info.land <= landMax)) return false;
    if (streetQ && !normStreet(r.street).startsWith(streetQ)) return false;
    if (v.flood && !floodOk(v.flood, info.flood)) return false;
    if (shape) {
      const sp = listingSpot(r) || (!fine ? suburbSpot(r.suburb) : null);
      if (!sp || !inShape(shape, sp[0], sp[1])) return false;
    }
    return true;
  }).sort((x, y) => y.lastSeen - x.lastSeen || y.firstSeen - x.firstSeen);
}
const listingSpot = (r) => houseSpot(normStreet(r.street), r.num, r.suburb);
const fmtAsk = (p) => !p || p.low == null ? (p && p.text ? p.text : 'No price shown') : p.low === p.high ? fmtShort(p.low) : `${fmtShort(p.low)}–${fmtShort(p.high)}`;
const featText = (r) => [r.beds != null && `${r.beds} bed`, r.baths != null && `${r.baths} bath`, r.cars != null && `${r.cars} car`].filter(Boolean).join(' · ');
const listingAddr = (r) => `${r.unit ? r.unit + '/' : ''}${r.numText || r.num} ${titleCase(r.street)}, ${titleCase(r.suburb)}`;
const domainSearch = (r) => `https://www.google.com/search?q=${encodeURIComponent(`${listingAddr(r)} NSW site:domain.com.au`)}`;
