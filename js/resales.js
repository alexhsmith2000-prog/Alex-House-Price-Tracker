/* Northern Rivers Prices — Resales (same home sold twice) and the sales list.
 * Part of the app; the files in js/ load in order and share one scope (see index.html). */
'use strict';

// ---------- resales: the same property sold twice ----------
// For each sale, the previous sale of the same property (or -1). Built once, when first needed.
let RESALE = null;
function resaleIndex() {
  if (RESALE) return RESALE;
  const prev = new Int32Array(N).fill(-1);
  if (C.prop && C.prop.length === N) {
    const ids = [];
    for (let i = 0; i < N; i++) if (DER.keep[i] && C.prop[i]) ids.push(i);
    const order = Uint32Array.from(ids).sort((a, b) => (C.prop[a] - C.prop[b]) || (C.d[a] - C.d[b]));
    for (let k = 1; k < order.length; k++) if (C.prop[order[k]] === C.prop[order[k - 1]]) prev[order[k]] = order[k - 1];
  }
  RESALE = prev;
  return prev;
}
const dayNum = (d) => Date.UTC(Math.floor(d / 10000), (Math.floor(d / 100) % 100) - 1, d % 100) / 864e5;
// Pairs of sales of the same property: later sale matches the search; leaves out pairs that aren't comparable.
function resalesFor(list) {
  const prev = resaleIndex();
  const out = [];
  for (const s of list) {
    const j = prev[s.i];
    if (j < 0) continue;
    const i = s.i;
    const years = (dayNum(C.d[i]) - dayNum(C.d[j])) / 365.25;
    if (years < 0.5) continue;                                  // quick re-sales are often not like-for-like
    if (C.nature[j] === 86 && C.nature[i] !== 86) continue;     // was vacant land, now has a house ('V')
    if (C.strata[j] !== C.strata[i]) continue;
    const a1 = C.area[j], a2 = C.area[i];
    if (a1 > 0 && a2 > 0 && Math.abs(a1 - a2) / Math.max(a1, a2) > 0.1) continue; // block was subdivided or merged
    const total = C.price[i] / C.price[j] - 1;
    const yearly = Math.pow(C.price[i] / C.price[j], 1 / years) - 1;
    if (yearly > 0.5 || yearly < -0.3) continue;                // likely a rebuild, renovation or unusual sale
    out.push({ s, prevPrice: C.price[j], prevD: C.d[j], years, total, yearly });
  }
  return out;
}
const fmtPct = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;
let resalesShown = 10;
function renderResales() {
  const panel = $('#resalePanel');
  const v = currentView();
  if (!v || !N || !C.prop) { panel.hidden = true; return; }
  const pairs = resalesFor(salesFor(v));
  panel.hidden = false;
  const box = $('#resaleList'); box.replaceChildren();
  if (!pairs.length) {
    $('#resaleSummary').textContent = 'No homes in this search have sold twice yet in your data. Importing more years of history gives more resales.';
    $('#moreResales').hidden = true;
    return;
  }
  const recent = pairs.filter((r) => r.s.d >= Number(String(thisMonth()).replace('-', '')) * 100 - 30000); // last ~3 years
  const med = median(pairs.map((r) => r.yearly));
  const medRecent = recent.length >= 5 ? median(recent.map((r) => r.yearly)) : null;
  $('#resaleSummary').replaceChildren(
    el('b', {}, `${fmtPct(med)} a year`), ` typical growth, from ${pairs.length.toLocaleString('en-AU')} home${pairs.length === 1 ? '' : 's'} sold twice`,
    medRecent != null ? ` (${fmtPct(medRecent)} a year for resales in the last 3 years)` : '',
    '. Each home is compared only with its own earlier sale, so the mix of homes doesn’t skew it. Renovations still push some results up.');
  for (const r of pairs.slice(0, resalesShown)) {
    const s = r.s;
    box.append(el('li', {},
      el('div', { class: 'srow' }, el('b', {}, `${fmtShort(r.prevPrice)} → ${fmtShort(s.price)}`),
        el('span', { class: r.total >= 0 ? 'up' : 'down' }, `${fmtPct(r.total)} · ${fmtPct(r.yearly)}/yr`)),
      el('div', { class: 'sline' }, `${s.street ? (s.house ? s.house + ' ' : '') + titleCase(s.street) + ', ' : ''}${titleCase(s.loc)}`),
      el('div', { class: 'smeta' }, `${fmtDate(r.prevD)} → ${fmtDate(s.d)} (${r.years.toFixed(1)} years) · ${typeName(s.type)}${s.area ? ' · ' + fmtArea(s.area) : ''}`),
      floodEl(s.i),
      s.street ? el('a', { class: 'lookup', href: lookupUrl(s), target: '_blank', rel: 'noopener' }, 'Look up on property.com.au ↗') : null));
  }
  const more = $('#moreResales');
  more.hidden = pairs.length <= resalesShown;
  more.onclick = () => { resalesShown += 20; renderResales(); };
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
      el('div', { class: 'sline' }, `${s.street ? (s.house ? s.house + ' ' : '') + titleCase(s.street) + ', ' : ''}${titleCase(s.loc)}`),
      el('div', { class: 'smeta' }, [typeName(s.type), fmtArea(s.area), s.zone ? `zone ${s.zone}` : ''].filter(Boolean).join(' · ')),
      askedEl(s.i),
      floodEl(s.i),
      s.street ? el('a', { class: 'lookup', href: lookupUrl(s), target: '_blank', rel: 'noopener' }, 'Look up on property.com.au ↗') : null));
  }
  if (!list.length) box.append(el('li', { class: 'table-empty' }, 'No sales match these filters.'));
  const more = $('#moreSales');
  more.hidden = list.length <= salesShown;
  more.onclick = () => { salesShown += 50; renderSalesList(); };
}

// property.com.au pages use internal ids, so search for the address on that site instead.
const lookupUrl = (s) => {
  const addr = `${s.house ? s.house + ' ' : ''}${titleCase(s.street)} ${titleCase(s.loc)} NSW ${s.pc}`.replace(/\s+/g, ' ').trim();
  return `https://www.google.com/search?q=${encodeURIComponent(`${addr} site:property.com.au`)}`;
};
