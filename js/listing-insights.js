/* Northern Rivers Prices — Per-listing insights (previous sale, comparables, flood, sold status, price cuts), the For sale panel and the watchlist.
 * Part of the app; the files in js/ load in order and share one scope (see index.html). */
'use strict';

// ---------- what we know about each listing: earlier sale, comparables, flood, sold or not ----------
let LINFO = null;          // listing key -> info
let SALE_LISTING = null;   // sale index -> listing record (asked vs sold)
let ADDR_SALES = null;     // 'SUBURB|STREET|NUM' -> sale indexes, oldest first
let SUBURB_SALES = null;   // suburb -> sale indexes, newest first
const addrKeyOfSale = (i) => `${DER.locName[C.loc[i]]}|${normStreet(C.dict.street[C.street[i]] || '')}|${leadNum(C.dict.house[C.house[i]] || '')}`;
function salesIndexes() {
  if (ADDR_SALES) return;
  ADDR_SALES = new Map(); SUBURB_SALES = new Map();
  const want = new Set(Object.values(LISTINGS.recs).map((r) => r.suburb));
  for (let i = 0; i < N; i++) {
    if (!DER.keep[i]) continue;
    const sub = DER.locName[C.loc[i]];
    if (!want.has(sub)) continue;
    const k = addrKeyOfSale(i);
    (ADDR_SALES.get(k) || ADDR_SALES.set(k, []).get(k)).push(i);
    (SUBURB_SALES.get(sub) || SUBURB_SALES.set(sub, []).get(sub)).push(i);
  }
  for (const a of ADDR_SALES.values()) a.sort((x, y) => C.d[x] - C.d[y]);
  for (const a of SUBURB_SALES.values()) a.sort((x, y) => C.d[y] - C.d[x]);
}
const askMid = (p) => (p && p.low != null ? (p.low + p.high) / 2 : null);
const ymdAdd = (d, days) => { const t = new Date(Date.UTC(Math.floor(d / 10000), (Math.floor(d / 100) % 100) - 1, d % 100) + days * 864e5); return t.getUTCFullYear() * 10000 + (t.getUTCMonth() + 1) * 100 + t.getUTCDate(); };
const today = () => +new Date().toISOString().slice(0, 10).replace(/-/g, '');
function listingInfo() {
  if (LINFO) return LINFO;
  salesIndexes();
  LINFO = new Map(); SALE_LISTING = new Map();
  const recs = Object.entries(LISTINGS.recs).sort((a, b) => a[1].firstSeen - b[1].firstSeen);
  const lastSeenByAddr = new Map();
  for (const [key, r] of recs) {
    const info = { key, r };
    const addr = `${r.suburb}|${normStreet(r.street)}|${r.num}`;
    const sales = ADDR_SALES.get(addr) || [];
    const isUnit = !!r.unit;
    const fit = (i) => !!C.strata[i] === isUnit || !isUnit; // houses: any record at that number; units: strata only
    // sold: a sale from about two weeks before first seen onwards
    // homes known only from a sold alert: the contract can be a few weeks before the alert
    const after = sales.filter((i) => fit(i) && C.d[i] >= ymdAdd(r.firstSeen, r.soldOnly ? -75 : -14));
    let sold = null;
    if (after.length) {
      const ref = askMid(askOf(r)) || (r.soldAlert && r.soldAlert.price) || null;
      sold = isUnit && ref ? after.reduce((b, i) => (Math.abs(C.price[i] - ref) < Math.abs(C.price[b] - ref) ? i : b), after[0]) : after[0];
      if (isUnit && ref && Math.abs(C.price[sold] - ref) / ref > 0.35) sold = null; // units: only when the price is plausible
    }
    if (sold != null) { info.sold = sold; const dd = Math.round(dayNum(C.d[sold]) - dayNum(r.firstSeen)); info.dom = dd > 0 && !r.soldOnly ? dd : null; SALE_LISTING.set(sold, r); } // sold before it reached your alerts: days unknown
    else if (r.soldAlert) { // reported sold in an alert; the official record follows weeks later
      info.reported = r.soldAlert;
      const dd = Math.round(dayNum(r.soldAlert.d) - dayNum(r.firstSeen));
      info.dom = dd > 0 && !r.soldOnly ? dd : null;
    }
    info.isSold = info.sold != null || !!info.reported;
    info.soldPrice = info.sold != null ? C.price[info.sold] : (info.reported && info.reported.price) || null;
    // earlier sale of the same home (houses only: the records don't say which unit)
    if (!isUnit) {
      const before = sales.filter((i) => C.d[i] < ymdAdd(r.firstSeen, -14));
      if (before.length) info.prev = before[before.length - 1];
      // land size and kind of property from the latest record at this address
      const rec = [...sales].reverse().find((i) => !C.strata[i]);
      if (rec != null) { info.vgType = TYPE_IDS[DER.type[rec]]; if (C.area[rec] > 0) info.land = C.area[rec]; }
    }
    // price cuts
    const lows = r.prices.map((p) => p.low).filter((v) => v != null);
    const cut = r.prices.findIndex((p, j) => j > 0 && p.low != null && r.prices[j - 1].low != null && p.low < r.prices[j - 1].low);
    info.cut = cut > 0 ? { d: r.prices[cut].d, from: r.prices[cut - 1].low, to: r.prices[cut].low } : null;
    info.cutTotal = lows.length > 1 && lows[lows.length - 1] < lows[0] ? (lows[lows.length - 1] - lows[0]) / lows[0] : 0;
    // relisted: seen again more than ~6 weeks after it was last seen, with no sale in between
    const prevSeen = lastSeenByAddr.get(`${addr}|${r.unit}`);
    info.relisted = !!r.relisted;
    lastSeenByAddr.set(`${addr}|${r.unit}`, r.lastSeen);
    info.age = Math.round(dayNum(today()) - dayNum(r.firstSeen));
    info.stale = !info.isSold && !r.soldOnly && info.age >= 90;
    // flood (council floor-level list)
    const fr = FLOOD && FLOOD.recs ? FLOOD.recs[`${r.suburb}|${normStreet(r.street)}|${r.num}`] : null;
    info.flood = fr ? fr[0] - fr[1] : null;
    LINFO.set(key, info);
  }
  return LINFO;
}
// Comparable sales: same suburb and kind (house/unit), last 12 months (24 if few), nearby and similar land when known
function comparables(info) {
  const r = info.r;
  salesIndexes();
  const subs = SUBURB_SALES.get(r.suburb) || [];
  const sp = listingSpot(r);
  const land = info.prev != null && !Number.isNaN(C.area[info.prev]) ? C.area[info.prev] : null;
  const isUnit = !!r.unit;
  const pick = (months, radius) => {
    const from = ymdAdd(r.firstSeen, -months * 30.5);
    const out = [];
    for (const i of subs) {
      if (C.d[i] < from) break; // newest first
      if (C.d[i] > r.firstSeen) continue;
      if (!!C.strata[i] !== isUnit) continue;
      if (!isUnit && DER.type[i] !== TYPE_IDS.indexOf('house') && DER.type[i] !== TYPE_IDS.indexOf('lifestyle')) continue;
      if (land && !isUnit && !(C.area[i] >= land * 0.65 && C.area[i] <= land * 1.35)) continue;
      if (radius && sp && DER.level[i] === 2 && distM(sp[0], sp[1], DER.lat[i], DER.lon[i]) > radius) continue;
      out.push(C.price[i]);
    }
    return out;
  };
  for (const [months, radius] of [[12, 1500], [12, 0], [24, 0]]) {
    const p = pick(months, radius);
    if (p.length >= 5) return { median: median(p), n: p.length, months, radius, land };
  }
  return null;
}
const floodLine = (d100) => d100 == null ? null : `${d100 >= 0 ? `Floor ${d100.toFixed(1)} m above` : `Floor ${Math.abs(d100).toFixed(1)} m below`} the 1-in-100 level · 2022: ${overEvent(d100, 2022) < 0 ? `about ${Math.abs(overEvent(d100, 2022)).toFixed(1)} m over the floor` : 'floor stayed dry'} (est.)`;

if (prefs.listBeds == null) prefs.listBeds = 0;
if (!prefs.listShow) prefs.listShow = 'forsale';
const LIST_SHOWS = [['forsale', 'For sale'], ['sold', 'Sold'], ['starred', '★ Starred'], ['cuts', 'Price cuts'], ['stale', 'Stale']];
let listingsShown = 15;
function renderListings() {
  const panel = $('#listingPanel');
  const v = currentView();
  const has = Object.keys(LISTINGS.recs).length > 0;
  if (!v || !has) { panel.hidden = true; $('#marketPanel').hidden = true; return; }
  panel.hidden = false;
  const infos = listingInfo();
  let list = listingsFor(v);
  const infoOf = (r) => infos.get(listingKey(r.suburb, r.street, r.num, r.unit)) || { r };
  const forSale = list.filter((r) => !infoOf(r).isSold);
  $('#listingTitle').textContent = `For sale now (${forSale.length.toLocaleString('en-AU')})`;
  const show = prefs.listShow;
  let shown = show === 'sold' ? list.filter((r) => infoOf(r).isSold)
    : show === 'starred' ? list.filter((r) => r.starred)
    : show === 'cuts' ? list.filter((r) => infoOf(r).cut)
    : show === 'stale' ? list.filter((r) => infoOf(r).stale)
    : forSale;
  if (prefs.listBeds) shown = shown.filter((r) => r.beds != null && r.beds >= prefs.listBeds);
  const mids = forSale.map((r) => askMid(askOf(r))).filter((x) => x != null);
  $('#listingSummary').textContent = list.length
    ? `${forSale.length} for sale${mids.length ? `, median asking ${fmtShort(median(mids))}` : ''}${list.length > forSale.length ? ` · ${list.length - forSale.length} since sold` : ''}. From your alert emails.`
    : 'None of your alert listings match this search yet.';
  const sh = $('#listingShow'); sh.replaceChildren();
  for (const [k, label] of LIST_SHOWS) sh.append(el('button', { type: 'button', 'aria-selected': String(show === k), onclick: () => { prefs.listShow = k; listingsShown = 15; savePrefs(); renderListings(); } }, label));
  const chips = $('#listingBeds'); chips.replaceChildren(el('span', { class: 'seg-label' }, 'Beds'));
  for (const [k, label] of [[0, 'Any'], [2, '2+'], [3, '3+'], [4, '4+']]) chips.append(el('button', { type: 'button', 'aria-selected': String(prefs.listBeds === k), onclick: () => { prefs.listBeds = k; savePrefs(); renderListings(); renderMapPanel(); } }, label));
  const box = $('#listingList'); box.replaceChildren();
  for (const r of shown.slice(0, listingsShown)) box.append(listingItem(r, infoOf(r)));
  if (!shown.length) box.append(el('li', { class: 'table-empty' }, show === 'starred' ? 'Tap ☆ on a listing to add it to your watchlist.' : show === 'sold' ? 'None of these listings has shown up in your sold data yet. Sales appear 4–8 weeks after the contract.' : 'No listings here yet.'));
  const more = $('#moreListings');
  more.hidden = shown.length <= listingsShown;
  more.onclick = () => { listingsShown += 30; renderListings(); };
  renderMarket(v, list, infos);
}
function listingItem(r, info) {
  const p = askOf(r), key = listingKey(r.suburb, r.street, r.num, r.unit);
  const lines = [];
  // status
  if (info.sold != null) {
    const ref = askMid(p), pr = C.price[info.sold], diff = ref ? (pr - ref) / ref : null;
    lines.push(el('div', { class: 'lstatus sold' }, `SOLD ${fmtDate(C.d[info.sold])} for ${fmtMoney(pr)}`, diff != null ? el('span', { class: diff < 0 ? 'down' : 'up' }, ` · ${Math.abs(diff * 100).toFixed(1)}% ${diff < 0 ? 'under' : 'over'} asking`) : '', info.dom != null ? ` · ${info.dom} days on market` : ' · sold around when it first appeared in your alerts',
      r.soldAlert && r.soldAlert.price && Math.abs(r.soldAlert.price - pr) > Math.max(1000, r.soldAlert.price * 0.005) ? ` · your alert said ${fmtMoney(r.soldAlert.price)}; the official price is shown` : ''));
  } else if (info.reported) {
    const ref = askMid(p), pr = info.reported.price, diff = ref && pr ? (pr - ref) / ref : null;
    lines.push(el('div', { class: 'lstatus sold' }, `SOLD ${fmtDate(info.reported.d)} ${pr ? `for ${fmtMoney(pr)}` : `(${info.reported.text || 'price not shown'})`}`,
      diff != null ? el('span', { class: diff < 0 ? 'down' : 'up' }, ` · ${Math.abs(diff * 100).toFixed(1)}% ${diff < 0 ? 'under' : 'over'} asking`) : '',
      info.dom != null ? ` · ${info.dom} days on market` : '',
      ymdMonth(info.reported.d) < lastCompleteMonth() ? ' · from your sold alert, but not found in the official records (left out of the figures)' : ' · from your sold alert; the official record follows in 4–8 weeks'));
  } else {
    lines.push(el('div', { class: `lstatus${info.stale ? ' stale' : ''}` }, `${info.stale ? 'Stale: ' : 'On market '}${info.age} days${info.stale ? ' and not sold' : ''}${r.relisted ? ' · relisted' : ''}`));
  }
  if (r.prices.length > 1 || p.flag) lines.push(el('div', { class: 'pricechg' }, r.prices.length > 1 ? `Was ${fmtAsk(r.prices[r.prices.length - 2])} · ${p.flag || (info.cut ? 'Price cut' : 'Price changed')} ${fmtDate(p.d)}${info.cutTotal < 0 ? ` (${(info.cutTotal * 100).toFixed(1)}% since first listed)` : ''}` : `${p.flag} ${fmtDate(p.d)}`));
  if (info.prev != null) {
    const pp = C.price[info.prev], ref = askMid(p);
    const yrs = (dayNum(r.firstSeen) - dayNum(C.d[info.prev])) / 365.25;
    const g = ref && yrs > 0.5 ? Math.pow(ref / pp, 1 / yrs) - 1 : null;
    lines.push(el('div', { class: 'lmeta' }, `Last sold ${fmtDate(C.d[info.prev])} for ${fmtShort(pp)}${ref ? ` → asking now ${ref >= pp ? '+' : '−'}${Math.abs((ref / pp - 1) * 100).toFixed(0)}%` : ''}${g != null ? ` (about ${(g * 100).toFixed(1)}% a year)` : ''}`));
  }
  const comp = comparables(info);
  if (comp) {
    const ref = askMid(p), d = ref ? (ref - comp.median) / comp.median : null;
    lines.push(el('div', { class: 'lmeta' }, `Comparable sales: median ${fmtShort(comp.median)} (${comp.n} ${r.unit ? 'units' : 'homes'}${comp.radius ? ` within ${comp.radius / 1000} km` : ` in ${titleCase(r.suburb)}`}, last ${comp.months} months${comp.land ? `, similar land` : ''})`,
      d != null ? el('span', { class: d > 0.1 ? 'down' : d < -0.1 ? 'up' : '' }, ` · asking ${Math.abs(d * 100).toFixed(0)}% ${d >= 0 ? 'above' : 'below'}`) : ''));
  }
  const fl = floodLine(info.flood);
  if (fl) lines.push(el('div', { class: `flood ${info.flood >= 0 ? 'dry' : 'wet'}` }, fl));
  if (r.note) lines.push(el('div', { class: 'lnote' }, `Note: ${r.note}`));
  const star = el('button', { type: 'button', class: `starbtn${r.starred ? ' on' : ''}`, 'aria-label': r.starred ? 'Remove from watchlist' : 'Add to watchlist', onclick: async () => {
    r.starred = !r.starred; if (r.starred) r.watch = { prices: r.prices.length, sold: !!info.isSold };
    await saveListings(); renderListings();
  } }, r.starred ? '★' : '☆');
  const noteBtn = el('button', { type: 'button', class: 'link', onclick: async () => {
    const t = prompt(`Note for ${listingAddr(r)}`, r.note || '');
    if (t === null) return;
    r.note = t.trim() || undefined; await saveListings(); renderListings();
  } }, r.note ? 'Edit note' : 'Add note');
  return el('li', { 'data-key': key },
    el('div', { class: 'srow' }, el('b', {}, r.soldOnly ? (info.soldPrice ? fmtMoney(info.soldPrice) : 'Sold') : fmtAsk(p)), el('span', { class: 'sdate' }, r.soldOnly ? 'sold' : `seen ${fmtDate(r.firstSeen)}`), star),
    el('div', { class: 'sline' }, listingAddr(r)),
    el('div', { class: 'smeta' }, [featText(r), r.unit ? 'Unit / townhouse' : ''].filter(Boolean).join(' · ')),
    ...lines,
    el('div', { class: 'lactions' }, el('a', { class: 'lookup', href: domainSearch(r), target: '_blank', rel: 'noopener' }, 'Open the listing ↗'), noteBtn));
}
async function saveListings() { try { await idbSet('listings', LISTINGS); } catch { toast('Could not save on this phone.'); } }

// Watchlist: tell me what changed on starred homes since I last looked
function watchNews() {
  const infos = listingInfo(), news = [];
  for (const [key, r] of Object.entries(LISTINGS.recs)) {
    if (!r.starred) continue;
    const w = r.watch || { prices: r.prices.length, sold: false };
    const info = infos.get(key) || {};
    if (r.prices.length > w.prices) news.push(`${listingAddr(r)}: price now ${fmtAsk(askOf(r))}`);
    if (info.isSold && !w.sold) news.push(`${listingAddr(r)}: sold${info.soldPrice ? ` for ${fmtShort(info.soldPrice)}` : ''}`);
  }
  return news;
}
function renderWatchBar() {
  const bar = $('#watchBar'); if (!bar) return;
  const news = watchNews();
  bar.hidden = !news.length;
  if (!news.length) return;
  $('#watchText').textContent = `Watchlist: ${news.join(' · ')}`;
}
$('#watchOk').addEventListener('click', async () => {
  const infos = listingInfo();
  for (const [key, r] of Object.entries(LISTINGS.recs)) if (r.starred) r.watch = { prices: r.prices.length, sold: !!(infos.get(key) || {}).isSold };
  await saveListings(); renderWatchBar();
});
