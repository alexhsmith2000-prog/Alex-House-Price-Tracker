/* Northern Rivers Prices — Trend lines, summary cards, the price chart and the by-month table.
 * Part of the app; the files in js/ load in order and share one scope (see index.html). */
'use strict';

// ---------- trend lines: straight-line fit of log(price) over a period, as % a year ----------
const TREND_WINDOWS = [
  { months: 3, key: '3', short: '3M', label: '3 mths', color: 'var(--s6)', dash: '1 3' },
  { months: 6, key: '6', short: '6M', label: '6 mths', color: 'var(--s3)', dash: '4 3' },
  { months: 12, key: '12', short: '1Y', label: '1 yr', color: 'var(--s5)', dash: '2 4' },
  { months: 36, key: '36', short: '3Y', label: '3 yrs', color: 'var(--s7)', dash: '7 4' },
  { months: 60, key: '60', short: '5Y', label: '5 yrs', color: 'var(--s8)', dash: '12 5' },
];
if (!Array.isArray(prefs.trends)) prefs.trends = prefs.trend === false ? [] : ['12', '36', '60'];
const trendsOn = () => prefs.trends.length > 0;
// points: [{ month, v }]; returns { a, b, from, to, yearly, n } or null. Leaves out incomplete recent months.
function fitTrend(points, fromMonth, toMonth, minPts) {
  const pts = points.filter((p) => p.month >= fromMonth && p.month <= toMonth && !isProvisional(p.month) && p.v > 0);
  if (pts.length < minPts) return null;
  const t0 = pts[0].month;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of pts) { const t = monthDiff(t0, p.month), yv = Math.log(p.v); sx += t; sy += yv; sxx += t * t; sxy += t * yv; }
  const n = pts.length, den = n * sxx - sx * sx;
  if (!den) return null;
  const b = (n * sxy - sx * sy) / den, a = (sy - b * sx) / n;
  return { a, b, t0, from: pts[0].month, to: pts[pts.length - 1].month, yearly: Math.exp(12 * b) - 1, n };
}
const trendAt = (f, m) => Math.exp(f.a + f.b * monthDiff(f.t0, m));
// Which trends to draw for the current chart
function buildTrends(series) {
  if (!trendsOn()) return [];
  const out = [];
  if (prefs.view === COMPARE) {
    for (const s of series) {
      if (!s.points.length) continue;
      const f = fitTrend(s.points, s.points[0].month, s.points[s.points.length - 1].month, 6);
      if (f) out.push({ ...f, color: s.color, dash: '5 4', label: s.name });
    }
    return out;
  }
  const base = series.find((s) => !s.dashed && s.allPoints && s.allPoints.length);
  if (!base) return out;
  const complete = base.allPoints.filter((p) => !isProvisional(p.month));
  if (!complete.length) return out;
  const last = complete[complete.length - 1].month;
  for (const w of TREND_WINDOWS) {
    if (!prefs.trends.includes(w.key)) continue;
    const from = addMonths(last, -(w.months - 1));
    if (complete[0].month > addMonths(from, Math.round(w.months * 0.25))) continue; // not enough history for this period
    const f = fitTrend(base.allPoints, from, last, w.months <= 6 ? Math.max(3, w.months - 2) : Math.max(6, Math.round(w.months * 0.5)));
    if (f) out.push({ ...f, color: w.color, dash: w.dash, label: w.label, base: base.name });
  }
  return out;
}

// last 3 months vs the same 3 months a year earlier
function windowStats(list, endMonth, months = 3) {
  const startM = addMonths(endMonth, -(months - 1));
  const prevEnd = addMonths(endMonth, -12), prevStart = addMonths(startM, -12);
  return {
    startM,
    cur: list.filter((s) => s.m >= startM && s.m <= endMonth).map((s) => s.price),
    prev: list.filter((s) => s.m >= prevStart && s.m <= prevEnd).map((s) => s.price),
  };
}
function statCard(label, value, cmp, sub) {
  const pct = value != null && cmp ? ((value - cmp) / cmp) * 100 : null;
  return el('div', { class: 'card' },
    el('div', { class: 'label' }, label),
    el('div', { class: 'value' }, value == null ? '—' : fmtShort(value)),
    el('div', { class: 'delta' }, pct != null ? [el('span', { class: pct >= 0 ? 'up' : 'down' }, `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%`), ' vs year before'] : sub || ''));
}

function renderCards() {
  const box = $('#statCards'); box.replaceChildren();
  if (!N) {
    box.className = 'cards compare';
    box.append(el('div', { class: 'card wide' }, el('div', { class: 'label' }, 'No sold prices yet'),
      el('div', { class: 'delta' }, 'Import the NSW Valuer General sales files your iPhone Shortcut downloads.'),
      el('button', { class: 'primary', style: 'margin-top:10px', onclick: () => { renderImportStatus(); $('#menuDialog').showModal(); } }, 'Import sales files')));
    return;
  }
  const end = addMonths(thisMonth(), -1);
  if (prefs.view === COMPARE) {
    box.className = 'cards compare';
    const fn = prefs.metric === 'avg' ? mean : median;
    for (const v of views) {
      const w = windowStats(salesFor(v), end);
      const c = statCard(v.name, fn(w.cur), fn(w.prev), `${w.cur.length} sales`);
      c.querySelector('.label').prepend(el('span', { class: 'dot', style: `background:${viewColor(v)}` }));
      box.append(c);
    }
    return;
  }
  box.className = 'cards';
  const w = windowStats(salesFor(currentView()), end);
  box.append(
    statCard(`Median sold · ${fmtMonthShort(w.startM)}–${fmtMonthShort(end)}`, median(w.cur), median(w.prev), `${w.cur.length} sales`),
    statCard('Average sold', mean(w.cur), mean(w.prev)),
    el('div', { class: 'card' }, el('div', { class: 'label' }, 'Sales, last 3 mths'), el('div', { class: 'value' }, String(w.cur.length)),
      el('div', { class: 'delta' }, `${w.prev.length} a year before`)));
}

function niceTicks(min, max, count = 4) {
  if (min === max) { min *= 0.9; max *= 1.1; }
  const step0 = (max - min) / count, mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((x) => x * mag).find((x) => x >= step0);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = []; for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  return { lo, hi, ticks };
}

function buildSeries() {
  const series = [];
  const add = (name, color, dashed, points) => series.push({ name, color, dashed, points });
  const pts = (rows, k) => rows.filter((r) => r.pooled >= MIN_SALES).map((r) => ({ month: r.month, v: r[k], n: r.pooled }));
  if (prefs.view === COMPARE) {
    for (const v of views) add(v.name, viewColor(v), false, pts(monthly(salesFor(v), prefs.smooth), prefs.metric));
  } else {
    const v = currentView(), color = viewColor(v);
    const rows = monthly(salesFor(v), prefs.smooth);
    if (prefs.metric !== 'avg') add('Median sold', color, false, pts(rows, 'median'));
    if (prefs.metric !== 'median') add('Average sold', 'var(--muted)', false, pts(rows, 'avg'));
    const lst = entries.filter((e) => e.suburb === v.name && e.avgListing != null).sort((a, b) => a.month.localeCompare(b.month));
    if (lst.length) add('Avg listing (yours)', color, true, lst.map((e) => ({ month: e.month, v: e.avgListing })));
    if (Object.keys(LISTINGS.recs).length) {
      const byM = new Map();
      for (const r of listingsFor(v)) { const f = askMid(r.prices[0]); if (f == null) continue; const m = monthStr(Math.floor(r.firstSeen / 10000) * 12 + (Math.floor(r.firstSeen / 100) % 100) - 1); (byM.get(m) || byM.set(m, []).get(m)).push(f); }
      const pts = [...byM].filter(([, a]) => a.length >= 3).sort((a, b) => a[0].localeCompare(b[0])).map(([m, a]) => ({ month: m, v: median(a), n: a.length }));
      if (pts.length) add('Median asking (new listings)', 'var(--s5)', true, pts);
    }
  }
  const all = series.flatMap((s) => s.points.map((p) => p.month));
  if (!all.length) return { series, start: null, end: null };
  const end = all.reduce((a, b) => (a > b ? a : b));
  let start = all.reduce((a, b) => (a < b ? a : b));
  if (prefs.range) { const rs = addMonths(end, -(prefs.range - 1)); if (rs > start) start = rs; }
  for (const s of series) { s.allPoints = s.points; s.points = s.points.filter((p) => p.month >= start); }
  return { series, start, end };
}

function renderChart() {
  const box = $('#chart'); box.replaceChildren();
  const legend = $('#legend'); legend.replaceChildren();
  const { series, start, end } = buildSeries();
  const nonEmpty = series.filter((s) => s.points.length);
  if (!nonEmpty.length) {
    box.append(el('div', { class: 'empty' }, N ? 'Not enough sales match these filters to chart. Try a wider area, more property types or a bigger price range.' : 'No data to chart yet.'));
    return;
  }
  const W = box.clientWidth || 340, H = box.clientHeight || 240;
  const pad = { l: 46, r: 10, t: 12, b: 26 };
  const n = Math.max(1, monthDiff(start, end));
  const trends = buildTrends(nonEmpty);
  const vals = nonEmpty.flatMap((s) => s.points.map((p) => p.v));
  for (const t of trends) { const a = t.from > start ? t.from : start; if (a <= t.to) vals.push(trendAt(t, a), trendAt(t, t.to)); }
  const { lo, hi, ticks } = niceTicks(Math.min(...vals), Math.max(...vals));
  const step = (W - pad.l - pad.r) / n;
  const x = (m) => pad.l + monthDiff(start, m) * step;
  const y = (v) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Price trend chart' });

  const provStart = addMonths(thisMonth(), -PROVISIONAL_MONTHS);
  const showProv = N && end >= provStart;
  if (showProv) {
    const bx = Math.max(pad.l, x(provStart > start ? provStart : start) - step / 2);
    svg.append(svgEl('rect', { x: bx, y: pad.t, width: Math.max(0, W - pad.r - bx), height: H - pad.t - pad.b, fill: 'var(--grid)', opacity: 0.7 }));
  }
  for (const t of ticks) {
    svg.append(svgEl('line', { x1: pad.l, x2: W - pad.r, y1: y(t), y2: y(t), stroke: 'var(--grid)', 'stroke-width': 1 }));
    const lab = svgEl('text', { x: pad.l - 6, y: y(t) + 4, 'text-anchor': 'end' }); lab.textContent = fmtShort(t); svg.append(lab);
  }
  const every = Math.max(1, Math.ceil((n + 1) / Math.max(2, Math.floor((W - pad.l) / 70))));
  for (let i = 0; i <= n; i += every) {
    const m = addMonths(start, i);
    const lab = svgEl('text', { x: x(m), y: H - 6, 'text-anchor': i === 0 && n > 0 ? 'start' : 'middle' }); lab.textContent = fmtMonthShort(m); svg.append(lab);
  }
  for (const s of nonEmpty) {
    let d = '', prev = null;
    for (const p of s.points) { d += (prev && monthDiff(prev.month, p.month) === 1 ? 'L' : 'M') + x(p.month).toFixed(1) + ',' + y(p.v).toFixed(1); prev = p; }
    svg.append(svgEl('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2.25, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', ...(s.dashed ? { 'stroke-dasharray': '6 4' } : {}) }));
    s.points.forEach((p, i) => {
      const iso = !(s.points[i - 1] && monthDiff(s.points[i - 1].month, p.month) === 1) && !(s.points[i + 1] && monthDiff(p.month, s.points[i + 1].month) === 1);
      if (s.points.length <= 14 || iso) svg.append(svgEl('circle', { cx: x(p.month), cy: y(p.v), r: 3, fill: s.color }));
    });
  }
  for (const t of trends) {
    const a = t.from > start ? t.from : start;
    if (a > t.to) continue;
    svg.append(svgEl('line', { x1: x(a), y1: y(trendAt(t, a)), x2: x(t.to), y2: y(trendAt(t, t.to)), stroke: t.color, 'stroke-width': 2, 'stroke-dasharray': t.dash, 'stroke-linecap': 'round', opacity: 0.9 }));
  }
  const cross = svgEl('line', { y1: pad.t, y2: H - pad.b, stroke: 'var(--muted)', 'stroke-width': 1, 'stroke-dasharray': '3 3', visibility: 'hidden' });
  svg.append(cross);
  const tip = el('div', { class: 'tip', hidden: true });
  const onMove = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const m = addMonths(start, Math.max(0, Math.min(n, Math.round((px - pad.l) / step))));
    const lines = nonEmpty.map((s) => ({ s, p: s.points.find((p) => p.month === m) })).filter((o) => o.p);
    cross.setAttribute('x1', x(m)); cross.setAttribute('x2', x(m)); cross.setAttribute('visibility', 'visible');
    tip.replaceChildren(el('div', {}, el('b', {}, fmtMonth(m)), isProvisional(m) ? ' · incomplete' : ''),
      ...(lines.length ? lines.map((o) => el('div', {}, `${o.s.name}: ${fmtMoney(o.p.v)}${o.p.n ? ` (${o.p.n} sales)` : ''}`)) : [el('div', {}, 'Not enough sales')]));
    tip.hidden = false;
    tip.style.left = Math.max(90, Math.min(r.width - 90, (x(m) / W) * r.width)) + 'px';
  };
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerdown', onMove);
  svg.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; });
  box.append(svg, tip);
  for (const s of series) legend.append(el('span', {}, el('i', { class: s.dashed ? 'dash' : '', style: s.dashed ? `color:${s.color}` : `background:${s.color}` }), s.name + (s.points.length ? '' : ' (not enough sales)')));
  if (showProv) legend.append(el('span', {}, el('i', { class: 'band' }), 'Recent months, sales still being reported'));
  for (const t of trends) legend.append(el('span', {}, el('i', { class: 'dash', style: `color:${t.color}` }), `Trend ${t.label}: `, el('b', { class: t.yearly >= 0 ? 'up' : 'down' }, `${t.yearly >= 0 ? '+' : '−'}${Math.abs(t.yearly * 100).toFixed(1)}%/yr`)));
  const note = $('#trendNote');
  const short = trends.some((t) => t.label === '3 mths' || t.label === '6 mths');
  note.textContent = trends.length && prefs.view !== COMPARE
    ? `Trend lines are a straight-line fit to the ${trends[0].base.toLowerCase()} over each period, shown as growth per year. Incomplete recent months are left out.${short ? ' 3- and 6-month trends rest on only a few months of sales, so they swing a lot: treat them as an early signal, not a forecast.' : ''}`
    : trendsOn() && prefs.view !== COMPARE && N ? 'Not enough months of sales for the trend periods you picked. Try a wider search, a longer period or the 3-month rolling view.' : '';
}

let tableAll = false;
function tableToggle(total) {
  const btn = $('#tableMore');
  btn.hidden = total <= 12;
  btn.textContent = tableAll ? 'Show the last 12 months only' : `Show all ${total} months`;
  btn.onclick = () => { tableAll = !tableAll; renderTable(); };
}
function renderTable() {
  const t = $('#table'); t.replaceChildren();
  const td = (v) => el('td', { class: v == null ? 'na' : '' }, fmtShort(v));
  const rolling = prefs.smooth > 1 ? ' (3-month rolling)' : '';
  if (prefs.view === COMPARE) {
    const key = prefs.metric === 'avg' ? 'avg' : 'median';
    $('#tableTitle').textContent = `${key === 'avg' ? 'Average' : 'Median'} sold${rolling}`;
    const data = views.map((v) => new Map(monthly(salesFor(v), prefs.smooth).map((r) => [r.month, r])));
    const months = [...new Set(data.flatMap((m) => [...m.keys()]))].sort().reverse();
    t.append(el('thead', {}, el('tr', {}, el('th', {}, 'Month'), ...views.map((v) => el('th', {}, v.name)))));
    const tb = el('tbody');
    for (const mo of months.slice(0, tableAll ? undefined : 12)) tb.append(el('tr', {}, el('td', {}, fmtMonthShort(mo)), ...data.map((m) => { const r = m.get(mo); return td(r && r.pooled >= MIN_SALES ? r[key] : null); })));
    if (!months.length) tb.append(el('tr', {}, el('td', { colspan: views.length + 1, class: 'table-empty' }, 'No sales yet.')));
    tableToggle(months.length);
    t.append(tb);
    $('#tableNote').textContent = '';
    return;
  }
  const v = currentView();
  $('#tableTitle').textContent = `${v.name} by month${rolling}`;
  const rows = new Map(monthly(salesFor(v), prefs.smooth).map((r) => [r.month, r]));
  const lst = new Map(entries.filter((e) => e.suburb === v.name).map((e) => [e.month, e]));
  const months = [...new Set([...rows.keys(), ...lst.keys()])].sort().reverse();
  t.append(el('thead', {}, el('tr', {}, el('th', {}, 'Month'), el('th', {}, 'Sales'), el('th', {}, 'Median'), el('th', {}, 'Average'), el('th', {}, 'Listing'))));
  const tb = el('tbody');
  for (const m of months.slice(0, tableAll ? undefined : 12)) {
    const r = rows.get(m), e = lst.get(m);
    tb.append(el('tr', { onclick: () => openEntry({ suburb: v.name, month: m }) },
      el('td', {}, fmtMonthShort(m), isProvisional(m) ? '*' : ''), el('td', {}, r ? r.n : 0),
      td(r ? r.median : null), td(r ? r.avg : null), td(e ? e.avgListing : null)));
  }
  if (!months.length) tb.append(el('tr', {}, el('td', { colspan: 5, class: 'table-empty' }, 'No sales match these filters.')));
  tableToggle(months.length);
  t.append(tb);
  $('#tableNote').textContent = months.length ? '* Sales for this month are still being reported. Tap a month to add your listing (asking) price.' : '';
}
