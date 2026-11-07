/* Northern Rivers Prices — Market activity cards and the listed-vs-sold chart.
 * Part of the app; the files in js/ load in order and share one scope (see index.html). */
'use strict';

// ---------- market activity for a search ----------
function renderMarket(v, list, infos) {
  const panel = $('#marketPanel');
  panel.hidden = false;
  const iof = (r) => infos.get(listingKey(r.suburb, r.street, r.num, r.unit)) || {};
  const sold = list.filter((r) => iof(r).sold != null);
  const pct = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;
  const diffs = sold.map((r) => { const ref = askMid(askOf(r)); return ref ? (C.price[iof(r).sold] - ref) / ref : null; }).filter((x) => x != null);
  const firstDiffs = sold.map((r) => { const f = askMid(r.prices[0]); return f ? (C.price[iof(r).sold] - f) / f : null; }).filter((x) => x != null);
  const ranges = sold.filter((r) => { const a = askOf(r); return a.low != null && a.high > a.low; });
  const overTop = ranges.filter((r) => C.price[iof(r).sold] > askOf(r).high).length;
  const doms = sold.map((r) => iof(r).dom).filter((x) => x != null);
  const cuts = list.filter((r) => iof(r).cut);
  const cutDays = cuts.map((r) => Math.round(dayNum(iof(r).cut.d) - dayNum(r.firstSeen)));
  const active = list.filter((r) => iof(r).sold == null && iof(r).age <= 180);
  const stale = list.filter((r) => iof(r).stale);
  // new listings per week (last 4 weeks)
  const t = today(), wk = list.filter((r) => dayNum(t) - dayNum(r.firstSeen) <= 28).length / 4;
  // sales per month for this search (last 6 complete months, from the sold records)
  const sales = salesFor(v);
  const end = addMonths(thisMonth(), -PROVISIONAL_MONTHS - 1), start6 = addMonths(end, -5);
  const perMonth = sales.filter((s) => s.m >= start6 && s.m <= end).length / 6;
  const mos = perMonth ? active.length / perMonth : null;
  const gauge = mos == null ? '' : mos < 3 ? 'sellers’ market' : mos > 6 ? 'buyers’ market' : 'balanced';
  const card = (label, value, sub) => el('div', { class: 'card' }, el('div', { class: 'label' }, label), el('div', { class: 'value' }, value), el('div', { class: 'delta' }, sub));
  const box = $('#marketCards'); box.replaceChildren(
    card('Days on market', doms.length ? `${Math.round(median(doms))}` : '—', doms.length ? `median, ${doms.length} sold` : 'needs listed homes to sell'),
    card('Sold vs asking', diffs.length ? pct(median(diffs)) : '—', diffs.length ? `median · vs first asking ${pct(median(firstDiffs))}` : 'needs listed homes to sell'),
    card('Sold above the range', ranges.length ? `${Math.round((overTop / ranges.length) * 100)}%` : '—', ranges.length ? `of ${ranges.length} sold with a price range` : 'needs ranged listings to sell'),
    card('Price cuts', list.length ? `${Math.round((cuts.length / list.length) * 100)}%` : '—', cuts.length ? `of listings · first cut after ${Math.round(median(cutDays))} days` : `${cuts.length} of ${list.length} listings`),
    card('New listings a week', `${wk.toFixed(1)}`, 'last 4 weeks of alerts'),
    card('Months of supply', mos != null ? mos.toFixed(1) : '—', mos != null ? `${active.length} for sale ÷ ${perMonth.toFixed(1)} sales a month · ${gauge}` : 'no recent sales'),
    card('Stale listings', `${stale.length}`, '90+ days, not sold'));
  $('#marketNote').textContent = 'Listings only go back to your first alert email, so days on market, discounts and supply firm up over a few months. Sales appear 4–8 weeks after the contract.';
  renderListedSold(v, list, sales);
}
// bar chart: homes newly listed vs homes sold each month (this search)
function renderListedSold(v, list, sales) {
  const box = $('#listedSoldChart'); box.replaceChildren();
  const months = []; for (let i = 11; i >= 0; i--) months.push(addMonths(thisMonth(), -i));
  const listed = new Map(), sold = new Map();
  for (const r of list) { const m = monthStr(Math.floor(r.firstSeen / 10000) * 12 + (Math.floor(r.firstSeen / 100) % 100) - 1); listed.set(m, (listed.get(m) || 0) + 1); }
  for (const s of sales) if (s.m >= months[0]) sold.set(s.m, (sold.get(s.m) || 0) + 1);
  const W = box.clientWidth || 340, H = 190, pad = { l: 30, r: 6, t: 10, b: 24 };
  const maxV = Math.max(1, ...months.map((m) => Math.max(listed.get(m) || 0, sold.get(m) || 0)));
  const { hi, ticks } = niceTicks(0, maxV, 3);
  const bw = (W - pad.l - pad.r) / months.length;
  const y = (val) => pad.t + (1 - val / (hi || 1)) * (H - pad.t - pad.b);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Homes listed and sold each month' });
  for (const tk of ticks) {
    svg.append(svgEl('line', { x1: pad.l, x2: W - pad.r, y1: y(tk), y2: y(tk), stroke: 'var(--grid)' }));
    const lb = svgEl('text', { x: pad.l - 5, y: y(tk) + 4, 'text-anchor': 'end' }); lb.textContent = String(Math.round(tk)); svg.append(lb);
  }
  months.forEach((m, i) => {
    const x0 = pad.l + i * bw + bw * 0.12, w = bw * 0.36;
    const lv = listed.get(m) || 0, sv = sold.get(m) || 0;
    if (lv) svg.append(svgEl('rect', { x: x0, y: y(lv), width: w, height: y(0) - y(lv), fill: 'var(--accent)', rx: 2 }));
    svg.append(svgEl('rect', { x: x0 + w + 1, y: y(sv), width: w, height: Math.max(0, y(0) - y(sv)), fill: 'var(--s3)', opacity: isProvisional(m) ? 0.45 : 0.9, rx: 2 }));
    if (i % 2 === months.length % 2) { const lb = svgEl('text', { x: pad.l + i * bw + bw / 2, y: H - 6, 'text-anchor': 'middle' }); lb.textContent = fmtMonthShort(m); svg.append(lb); }
  });
  box.append(svg);
  $('#listedSoldLegend').replaceChildren(
    el('span', {}, el('i', { style: 'background:var(--accent);height:10px' }), 'Newly listed (from your alerts)'),
    el('span', {}, el('i', { style: 'background:var(--s3);height:10px' }), 'Sold (Valuer General; recent months still coming in)'));
}

// asked vs sold on sales
function listingForSale(i) { listingInfo(); return SALE_LISTING.get(i) || null; }
function askedEl(i) {
  const r = listingForSale(i);
  if (!r) return null;
  const first = r.prices[0], last = askOf(r), pr = C.price[i];
  const ref = askMid(last);
  const diff = ref ? (pr - ref) / ref : null;
  const info = listingInfo().get(listingKey(r.suburb, r.street, r.num, r.unit)) || {};
  return el('div', { class: 'asked' }, `${featText(r)}${featText(r) ? ' · ' : ''}asked ${fmtAsk(last)}${first !== last && first.low != null ? ` (first ${fmtAsk(first)})` : ''}${info.dom != null ? ` · ${info.dom} days on market` : ''}`,
    diff != null ? el('span', { class: diff < 0 ? 'down' : 'up' }, ` · sold ${Math.abs(diff * 100).toFixed(1)}% ${diff < 0 ? 'under' : 'over'}`) : null);
}
