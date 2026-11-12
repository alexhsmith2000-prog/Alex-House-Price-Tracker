/* Northern Rivers Prices — Early sold prices from your sold alerts, used until the official Valuer General
 * records arrive. The official records always win: an alert sale is replaced by its official record when it
 * arrives (any difference is noted), and one still missing once its month is complete is left out and listed.
 * Part of the app; the files in js/ load in order and share one scope (see index.html). */
'use strict';

// { infos, pending: [{ r, key, m, d, price, counted }], checked: [{ r, key, alertPrice, alertD, vg, same }], notFound: [{ r, key, m, d, price }] }
let EARLY = null;
const ymdMonth = (d) => `${Math.floor(d / 10000)}-${String(Math.floor(d / 100) % 100).padStart(2, '0')}`;
function earlySales() {
  const infos = listingInfo();
  if (EARLY && EARLY.infos === infos) return EARLY;
  const L = lastCompleteMonth();
  const pending = [], checked = [], notFound = [];
  for (const [key, info] of infos) {
    const r = info.r;
    if (!r.soldAlert) continue;
    const price = r.soldAlert.price || null, d = r.soldAlert.d, m = ymdMonth(d);
    if (info.sold != null) { // the official record has arrived: it replaces the alert
      const vp = C.price[info.sold];
      checked.push({ r, key, alertPrice: price, alertD: d, vg: info.sold, same: price == null || Math.abs(vp - price) <= Math.max(1000, price * 0.005) });
    } else if (m < L) notFound.push({ r, key, m, d, price }); // its month's official records are in, and it isn't there
    else if (price) pending.push({ r, key, m, d, price, early: true, counted: m > L }); // the latest complete month: wait, don't count
  }
  EARLY = { infos, pending, checked, notFound };
  return EARLY;
}
// alert sales for a search, counted in incomplete months only (complete months use the official records alone)
function earlySalesFor(v) {
  const e = earlySales();
  if (!e.pending.length) return [];
  const recs = new Set(listingsFor(v, { soldPrices: true }));
  return e.pending.filter((p) => p.counted && recs.has(p.r));
}
// official sales plus early alert sales, for the chart and the table
const earlyListCache = new WeakMap();
function salesWithEarly(v) {
  const base = salesFor(v);
  if (!N || !Object.keys(LISTINGS.recs).length) return base;
  const e = earlySales(), hit = earlyListCache.get(base);
  if (hit && hit.e === e && hit.v === JSON.stringify([v.area, v.locs, v.types, v.min, v.max, v.shape, v.landMin, v.landMax, v.street, v.flood])) return hit.list;
  const add = earlySalesFor(v);
  const list = add.length ? base.concat(add) : base;
  earlyListCache.set(base, { e, list, v: JSON.stringify([v.area, v.locs, v.types, v.min, v.max, v.shape, v.landMin, v.landMax, v.street, v.flood]) });
  return list;
}
// what's under the chart: how many early sales are shown, and how earlier ones checked out
function renderEarlyNote(v) {
  const box = $('#earlyNote'); if (!box) return;
  if (!N || !Object.keys(LISTINGS.recs).length || prefs.view === COMPARE) { box.hidden = true; return; }
  const e = earlySales(), recs = new Set(listingsFor(v, { soldPrices: true }));
  const mine = (a) => a.filter((x) => recs.has(x.r));
  const shown = mine(e.pending).filter((p) => p.counted), waiting = mine(e.pending).filter((p) => !p.counted);
  const checked = mine(e.checked), differ = checked.filter((c) => !c.same), notFound = mine(e.notFound).filter((x) => x.price);
  if (!shown.length && !checked.length && !notFound.length && !waiting.length) { box.hidden = true; return; }
  box.hidden = false;
  const parts = [];
  if (shown.length) parts.push(`The shaded months include ${shown.length} sale${shown.length === 1 ? '' : 's'} from your sold alerts that ${shown.length === 1 ? 'isn’t' : 'aren’t'} in the official records yet.`);
  if (waiting.length) parts.push(`${waiting.length} more from ${fmtMonthShort(lastCompleteMonth())} ${waiting.length === 1 ? 'is' : 'are'} waiting for the official record (not counted).`);
  if (checked.length) parts.push(`Checked against the official records so far: ${checked.length} matched${differ.length ? `, ${differ.length} at a different price (the official price is used)` : ', all at the same price'}.`);
  if (notFound.length) parts.push(`${notFound.length} not found in the official records, so left out.`);
  const rows = [...differ.map((c) => `${listingAddr(c.r)}: alert $${c.alertPrice.toLocaleString('en-AU')} · official ${fmtMoney(C.price[c.vg])} (${fmtDate(C.d[c.vg])})`),
    ...notFound.map((x) => `${listingAddr(x.r)}: alert ${fmtMoney(x.price)} (${fmtDate(x.d)}) · not in the official records`)];
  box.replaceChildren(parts.join(' '), rows.length ? el('details', {}, el('summary', {}, 'Show the differences'), el('ul', {}, ...rows.map((t) => el('li', {}, t)))) : '');
}
