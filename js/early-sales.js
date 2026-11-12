/* Northern Rivers Prices — Early sold prices from your sold alerts, used until the official Valuer General
 * records arrive. The official records always win: an alert sale is replaced by its official record when it
 * arrives (any difference is noted), and one still missing once its month is complete is left out and listed.
 * Part of the app; the files in js/ load in order and share one scope (see index.html). */
'use strict';

// { infos, pending: [...], checked: [...], notFound: [...] }
//   pending:  reported sold, official record not in yet (counted, from the alert)
//   checked:  official record found (the official sale is counted; the alert isn't); fuzzy = found by price and date (listingInfo)
//   notFound: its month's official records are in and it isn't there (counted, from the alert, unconfirmed)
let EARLY = null;
const ymdMonth = (d) => `${Math.floor(d / 10000)}-${String(Math.floor(d / 100) % 100).padStart(2, '0')}`;
// An official sale that is almost certainly the same sale with the address written differently: same suburb,
// same kind (unit or not), the same price (within $100: alerts report the contract price), a contract date from
// 60 days before to 7 days after the alert, not matched to another home, and the only one that fits.
function fuzzyOfficial(r, price, d) {
  const cands = (SUBURB_SALES && SUBURB_SALES.get(r.suburb)) || [];
  const day = dayNum(d);
  let found = null;
  for (const i of cands) {
    if (SALE_LISTING.has(i) || !!C.strata[i] !== !!r.unit) continue;
    if (Math.abs(C.price[i] - price) > 100) continue;
    const gap = day - dayNum(C.d[i]);
    if (gap > 60 || gap < -7) continue;
    if (found != null) return null; // more than one fits: don't guess
    found = i;
  }
  return found;
}
function earlySales() {
  const infos = listingInfo();
  if (EARLY && EARLY.infos === infos) return EARLY;
  const L = lastCompleteMonth();
  const pending = [], checked = [], notFound = [];
  const sameish = (a, b) => a == null || Math.abs(a - b) <= Math.max(1000, a * 0.005);
  for (const [key, info] of infos) {
    const r = info.r;
    if (!r.soldAlert) continue;
    const price = r.soldAlert.price || null, d = r.soldAlert.d, m = ymdMonth(d);
    if (info.sold != null) { // the official record has arrived (fuzzy: found by price and date): it replaces the alert
      checked.push({ r, key, alertPrice: price, alertD: d, vg: info.sold, same: sameish(price, C.price[info.sold]), fuzzy: !!info.fuzzy });
      continue;
    }
    if (m >= L) { if (price) pending.push({ r, key, m, d, price, early: true }); continue; } // still expected
    notFound.push({ r, key, m, d, price, early: true, unconfirmed: true });
  }
  EARLY = { infos, pending, checked, notFound };
  return EARLY;
}
// alert sales for a search: those not (yet) in the official records, with a reported price
function earlySalesFor(v) {
  const e = earlySales();
  const all = e.pending.concat(e.notFound.filter((x) => x.price));
  if (!all.length) return [];
  const recs = new Set(listingsFor(v, { soldPrices: true }));
  return all.filter((p) => recs.has(p.r));
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
  const shown = mine(e.pending), checked = mine(e.checked), differ = checked.filter((c) => !c.same), fuzzy = checked.filter((c) => c.fuzzy);
  const notFound = mine(e.notFound).filter((x) => x.price);
  if (!shown.length && !checked.length && !notFound.length) { box.hidden = true; return; }
  box.hidden = false;
  const parts = [];
  if (shown.length) parts.push(`Recent months include ${shown.length} sale${shown.length === 1 ? '' : 's'} from your sold alerts that ${shown.length === 1 ? 'isn’t' : 'aren’t'} in the official records yet.`);
  if (checked.length) parts.push(`Checked against the official records so far: ${checked.length} matched${differ.length ? `, ${differ.length} at a different price (the official price is used)` : ', all at the same price'}${fuzzy.length ? `, ${fuzzy.length} by price and date because the address is written differently` : ''}.`);
  if (notFound.length) parts.push(`${notFound.length} never appeared in the official records, so the price reported in your alert is used (unconfirmed).`);
  const rows = [...differ.map((c) => `${listingAddr(c.r)}: alert ${fmtMoney(c.alertPrice)} · official ${fmtMoney(C.price[c.vg])} (${fmtDate(C.d[c.vg])})`),
    ...fuzzy.map((c) => `${listingAddr(c.r)}: matched to the official sale at ${C.dict.house[C.house[c.vg]] || ''} ${titleCase(C.dict.street[C.street[c.vg]] || '')} (${fmtMoney(C.price[c.vg])}, ${fmtDate(C.d[c.vg])})`),
    ...notFound.map((x) => `${listingAddr(x.r)}: ${fmtMoney(x.price)} (${fmtDate(x.d)}) from your alert · not in the official records, alert price used`)];
  box.replaceChildren(parts.join(' '), rows.length ? el('details', {}, el('summary', {}, 'Show the differences'), el('ul', {}, ...rows.map((t) => el('li', {}, t)))) : '');
}
