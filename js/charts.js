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

// ---------- headline cards: the months the chart shows (complete months only) vs a comparable period ----------
const lastCompleteMonth = () => addMonths(thisMonth(), -(PROVISIONAL_MONTHS + 1));
// Which months the cards cover: the period picked on the chart, else the latest 3 complete months.
function cardWindow() {
  const L = lastCompleteMonth();
  const picked = !!chartZoom;
  let start = picked ? chartZoom.start : addMonths(L, -2);
  const wantEnd = picked ? chartZoom.end : L;
  const end = wantEnd > L ? L : wantEnd;
  const cut = wantEnd > L ? { from: addMonths(L, 1), to: wantEnd } : null; // incomplete months left out
  if (start > end) return { empty: true, picked, cut };
  const len = monthDiff(start, end) + 1;
  // up to a year: same months a year earlier (no seasonal effect); longer: the same length of time just before
  const shift = len <= 12 ? 12 : len;
  return { start, end, len, picked, cut, prevStart: addMonths(start, -shift), prevEnd: addMonths(end, -shift),
    vs: len <= 12 ? 'vs same months a year before' : `vs the ${len} months before` };
}
// prev is null when your data doesn't reach back to the whole comparison period (a % would mislead)
function windowStats(list, w, official = list) {
  const first = official.length ? official[official.length - 1].m : null; // official is newest first
  return {
    cur: list.filter((s) => s.m >= w.start && s.m <= w.end).map((s) => s.price),
    prev: first && first <= w.prevStart ? list.filter((s) => s.m >= w.prevStart && s.m <= w.prevEnd).map((s) => s.price) : null,
  };
}
const NO_PREV = 'no earlier sales imported to compare';
const monthsLabel = (a, b) => (a === b ? fmtMonthShort(a) : `${fmtMonthShort(a)}–${fmtMonthShort(b)}`);
function statCard(label, value, cmp, sub, vs) {
  const pct = value != null && cmp ? ((value - cmp) / cmp) * 100 : null;
  return el('div', { class: 'card' },
    el('div', { class: 'label' }, label),
    el('div', { class: 'value' }, value == null ? '—' : fmtShort(value)),
    el('div', { class: 'delta' }, pct != null ? [el('span', { class: pct >= 0 ? 'up' : 'down' }, `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%`), ` ${vs}`] : sub || ''));
}

function renderCards() {
  const box = $('#statCards'); box.replaceChildren();
  if (!N) {
    box.className = 'cards compare';
    box.append(el('div', { class: 'card wide' }, el('div', { class: 'label' }, 'No sold prices yet'),
      el('div', { class: 'delta' }, 'Import the NSW Valuer General sales files your iPhone Shortcut downloads.'),
      el('button', { class: 'primary', style: 'margin-top:10px', onclick: () => $('#menuBtn').click() }, 'Import sales files')));
    return;
  }
  const w = cardWindow();
  const cutNote = w.cut ? `${monthsLabel(w.cut.from, w.cut.to)} left out: sales still being reported` : '';
  if (w.empty) {
    box.className = 'cards compare';
    box.append(el('div', { class: 'card wide' }, el('div', { class: 'label' }, 'No complete months in this period'),
      el('div', { class: 'delta' }, `${cutNote}. Pick a period that ends by ${fmtMonthShort(lastCompleteMonth())}.`)));
    return;
  }
  const when = monthsLabel(w.start, w.end);
  const title = w.picked ? `Your period · ${when}` : `Latest complete months · ${when}`;
  if (prefs.view === COMPARE) {
    box.className = 'cards compare';
    const fn = prefs.metric === 'avg' ? mean : median;
    for (const v of views) {
      const st = windowStats(salesWithEarly(v), w, salesFor(v));
      const c = statCard(v.name, fn(st.cur), st.prev && fn(st.prev), `${st.cur.length} sales${st.prev ? '' : ` · ${NO_PREV}`}`, w.vs);
      c.querySelector('.label').prepend(el('span', { class: 'dot', style: `background:${viewColor(v)}` }));
      box.append(c);
    }
    box.append(el('p', { class: 'cards-note' }, `${prefs.metric === 'avg' ? 'Average' : 'Median'} sold, ${title.toLowerCase()}, ${w.vs}.${cutNote ? ` ${cutNote}.` : ''}`));
    return;
  }
  box.className = 'cards';
  const st = windowStats(salesWithEarly(currentView()), w, salesFor(currentView()));
  box.append(
    statCard('Median sold', median(st.cur), st.prev && median(st.prev), st.prev ? `${st.cur.length} sales` : NO_PREV, w.vs),
    statCard('Average sold', mean(st.cur), st.prev && mean(st.prev), st.prev ? '' : NO_PREV, w.vs),
    el('div', { class: 'card' }, el('div', { class: 'label' }, 'Sales'), el('div', { class: 'value' }, st.cur.length.toLocaleString('en-AU')),
      el('div', { class: 'delta' }, st.prev ? `${st.prev.length.toLocaleString('en-AU')} ${w.len <= 12 ? 'same months a year before' : `in the ${w.len} months before`}` : NO_PREV)),
    el('p', { class: 'cards-note' }, `${title}${cutNote ? ` · ${cutNote}` : ''}`));
  // early figures for the months still coming in (official so far + your sold alerts), not compared with anything
  const eFrom = addMonths(lastCompleteMonth(), 1), eTo = thisMonth();
  const recent = salesWithEarly(currentView()).filter((x) => x.m >= eFrom && x.m <= eTo);
  if (recent.length) {
    const ne = recent.filter((x) => x.early).length;
    box.insertBefore(el('div', { class: 'card wide early' }, el('div', { class: 'label' }, `Early figures · ${monthsLabel(eFrom, eTo)} (still coming in)`),
      el('div', { class: 'value' }, recent.length >= MIN_SALES ? fmtShort(median(recent.map((x) => x.price))) : '—'),
      el('div', { class: 'delta' }, `median of ${recent.length} sale${recent.length === 1 ? '' : 's'} so far${ne ? `, ${ne} from your sold alerts` : ''} · not compared until the month${eFrom === eTo ? ' is' : 's are'} complete`)), box.lastChild);
  }
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
  const pts = (rows, k) => rows.filter((r) => r.pooled >= MIN_SALES).map((r) => ({ month: r.month, v: r[k], n: r.pooled, e: r.pooledEarly }));
  if (prefs.view === COMPARE) {
    for (const v of views) add(v.name, viewColor(v), false, pts(monthly(salesWithEarly(v), prefs.smooth), prefs.metric));
  } else {
    const v = currentView(), color = viewColor(v);
    const rows = monthly(salesWithEarly(v), prefs.smooth); // incomplete months include early sales from your sold alerts
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
  const built = buildSeries();
  const { series } = built;
  // reset zoom and the pinned month when the search or time range changes
  const zkey = `${prefs.view}|${prefs.range}`;
  if (zkey !== chartZoomKey) { chartZoomKey = zkey; chartZoom = null; chartPin = null; }
  let { start, end } = built;
  const fullStart = start, fullEnd = end;
  if (chartZoom && start) {
    start = chartZoom.start > start ? chartZoom.start : start;
    end = chartZoom.end < end ? chartZoom.end : end;
    if (monthDiff(start, end) < 2 || (start === fullStart && end === fullEnd)) { chartZoom = null; start = fullStart; end = fullEnd; }
    else for (const s of series) s.points = s.points.filter((p) => p.month >= start && p.month <= end);
  }
  const nonEmpty = series.filter((s) => s.points.length);
  renderCards(); // the cards follow the period shown on the chart
  if (prefs.view !== COMPARE) renderEarlyNote(currentView()); else renderEarlyNote(null);
  if (!nonEmpty.length) {
    chartGeo = null; $('#chartPeriod').hidden = true;
    box.append(el('div', { class: 'empty' }, N ? 'Not enough sales match these filters to chart. Try a wider area, more property types or a bigger price range.' : 'No data to chart yet.'));
    return;
  }
  const W = box.clientWidth || 340, H = box.clientHeight || 240;
  const pad = { l: 46, r: 10, t: 12, b: 26 };
  const n = Math.max(1, monthDiff(start, end));
  const trends = buildTrends(nonEmpty);
  const period = chartZoom ? periodStats(nonEmpty, start, end) : null;
  if (!chartZoom) $('#chartPeriod').hidden = true;
  if (period && period.fit) trends.push({ ...period.fit, color: 'var(--text)', dash: '2 3', label: 'selected months' });
  const vals = nonEmpty.flatMap((s) => s.points.map((p) => p.v));
  const tSpan = (t) => [t.from > start ? t.from : start, t.to < end ? t.to : end];
  for (const t of trends) { const [a, b] = tSpan(t); if (a <= b) vals.push(trendAt(t, a), trendAt(t, b)); }
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
    const [a, b] = tSpan(t);
    if (a > b) continue;
    svg.append(svgEl('line', { x1: x(a), y1: y(trendAt(t, a)), x2: x(b), y2: y(trendAt(t, b)), stroke: t.color, 'stroke-width': 2, 'stroke-dasharray': t.dash, 'stroke-linecap': 'round', opacity: 0.9 }));
  }
  const cross = svgEl('line', { y1: pad.t, y2: H - pad.b, stroke: 'var(--muted)', 'stroke-width': 1, 'stroke-dasharray': '3 3', visibility: 'hidden' });
  svg.append(cross);
  const tip = el('div', { class: 'tip', hidden: true });
  box.append(svg, tip);
  chartGeo = { start, end, fullStart, fullEnd, n, W, padL: pad.l, step, x, nonEmpty, svg, cross, tip };
  if (chartPin && chartPin >= start && chartPin <= end) showChartTip(chartPin); else chartPin = null;
  renderChartRange(fullStart, fullEnd, start, end);
  for (const s of series) legend.append(el('span', {}, el('i', { class: s.dashed ? 'dash' : '', style: s.dashed ? `color:${s.color}` : `background:${s.color}` }), s.name + (s.points.length ? '' : ' (not enough sales)')));
  if (showProv) legend.append(el('span', {}, el('i', { class: 'band' }), 'Recent months, sales still being reported'));
  for (const t of trends) legend.append(el('span', {}, el('i', { class: 'dash', style: `color:${t.color}` }), `Trend ${t.label}: `, el('b', { class: t.yearly >= 0 ? 'up' : 'down' }, `${t.yearly >= 0 ? '+' : '−'}${Math.abs(t.yearly * 100).toFixed(1)}%/yr`)));
  const note = $('#trendNote');
  const short = trends.some((t) => t.label === '3 mths' || t.label === '6 mths');
  note.textContent = trends.length && prefs.view !== COMPARE
    ? `Trend lines are a straight-line fit to the ${trends[0].base.toLowerCase()} over each period, shown as growth per year. Incomplete recent months are left out.${short ? ' 3- and 6-month trends rest on only a few months of sales, so they swing a lot: treat them as an early signal, not a forecast.' : ''}`
    : trendsOn() && prefs.view !== COMPARE && N ? 'Not enough months of sales for the trend periods you picked. Try a wider search, a longer period or the 3-month rolling view.' : '';
}

// ---------- chart interaction: tap to pin a month, pinch to zoom, drag to move along ----------
let chartGeo = null, chartZoom = null, chartZoomKey = '', chartPin = null;
function showChartTip(m) {
  const g = chartGeo; if (!g) return;
  const lines = g.nonEmpty.map((s) => ({ s, p: s.points.find((p) => p.month === m) })).filter((o) => o.p);
  g.cross.setAttribute('x1', g.x(m)); g.cross.setAttribute('x2', g.x(m)); g.cross.setAttribute('visibility', 'visible');
  const pinned = m === chartPin;
  g.tip.replaceChildren(el('div', {}, el('b', {}, fmtMonth(m)), isProvisional(m) ? ' · incomplete' : ''),
    ...(lines.length ? lines.map((o) => el('div', {}, `${o.s.name}: ${fmtMoney(o.p.v)}${o.p.n ? ` (${o.p.n} sales${o.p.e ? `, ${o.p.e} from your alerts` : ''})` : ''}`)) : [el('div', {}, 'Not enough sales')]),
    pinned ? el('div', { class: 'tip-actions' },
      el('button', { type: 'button', onclick: () => setChartPeriod(m, null) }, 'Start here'),
      el('button', { type: 'button', onclick: () => setChartPeriod(null, m) }, 'End here')) : '');
  g.tip.classList.toggle('pinned', pinned);
  g.tip.hidden = false;
  const w = g.svg.getBoundingClientRect().width || g.W;
  const half = (g.tip.offsetWidth || 180) / 2 + 2; // keep the whole popup inside the chart
  g.tip.style.left = Math.max(half, Math.min(w - half, (g.x(m) / g.W) * w)) + 'px';
}
// Show the chart between two months (either can be left as it is)
function setChartPeriod(from, to) {
  const g = chartGeo; if (!g) return;
  let a = from || (chartZoom ? chartZoom.start : g.fullStart), b = to || (chartZoom ? chartZoom.end : g.fullEnd);
  if (from && b <= from) b = g.fullEnd;            // a new start after the current end: run to the latest month
  if (to && a >= to) a = g.fullStart;              // a new end before the current start: run from the first month
  if (a > b) [a, b] = [b, a];
  if (a < g.fullStart) a = g.fullStart;
  if (b > g.fullEnd) b = g.fullEnd;
  if (monthDiff(a, b) < 2) b = addMonths(a, 2) > g.fullEnd ? g.fullEnd : addMonths(a, 2);
  if (monthDiff(a, b) < 2) a = addMonths(b, -2);
  chartZoom = { start: a, end: b }; chartPin = null;
  renderChart();
}
function renderChartRange(fullStart, fullEnd, start, end) {
  for (const [id, v] of [['#chartFrom', start], ['#chartTo', end]]) {
    const inp = $(id); inp.min = fullStart; inp.max = fullEnd;
    if (document.activeElement !== inp) inp.value = v;
  }
  $('#chartReset').hidden = !chartZoom;
}
// change and trend over the months shown (complete months only)
function periodStats(series, start, end) {
  const base = series.find((s) => !s.dashed && s.allPoints);
  const box = $('#chartPeriod');
  if (!base) { box.hidden = true; return null; }
  const pts = base.allPoints.filter((p) => p.month >= start && p.month <= end && !isProvisional(p.month));
  box.hidden = false;
  if (pts.length < 3) { box.textContent = 'Pick at least 3 complete months (not the shaded recent ones) to see the change over a period.'; return null; }
  const a = pts[0], b = pts[pts.length - 1], ch = b.v / a.v - 1;
  const fit = fitTrend(base.allPoints, start, end, 3);
  const pc = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;
  box.replaceChildren(el('b', {}, `${fmtMonthShort(a.month)} → ${fmtMonthShort(b.month)}: `),
    `${base.name.toLowerCase()} ${fmtShort(a.v)} → ${fmtShort(b.v)} `, el('span', { class: ch >= 0 ? 'up' : 'down' }, pc(ch)),
    ...(fit ? [' · trend over these months ', el('span', { class: fit.yearly >= 0 ? 'up' : 'down' }, `${pc(fit.yearly)}/yr`)] : []),
    pts.length < 6 ? ' · only a few months, so treat it as rough' : '');
  return { fit: fit && { ...fit, base: base.name } };
}
function setChartFull(on) {
  $('#chartPanel').classList.toggle('full', on);
  document.body.classList.toggle('noscroll', on);
  $('#chartFullBtn').textContent = on ? 'Close' : '⛶ Full screen';
  $('#chartFullBtn').setAttribute('aria-pressed', String(on));
  setTimeout(renderChart, 60);
}
$('#chartFullBtn').addEventListener('click', () => setChartFull(!$('#chartPanel').classList.contains('full')));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#chartPanel').classList.contains('full')) setChartFull(false); });
let chartResizeT = 0;
window.addEventListener('resize', () => { clearTimeout(chartResizeT); chartResizeT = setTimeout(renderChart, 150); });
$('#chartReset').addEventListener('click', () => { chartZoom = null; renderChart(); });
for (const id of ['#chartFrom', '#chartTo']) $(id).addEventListener('change', () => {
  const f = $('#chartFrom').value, t = $('#chartTo').value;
  if (/^\d{4}-\d{2}$/.test(f) && /^\d{4}-\d{2}$/.test(t)) setChartPeriod(f, t);
});
function hideChartTip() { if (!chartGeo) return; chartGeo.tip.hidden = true; chartGeo.cross.setAttribute('visibility', 'hidden'); }
// month position (fractional) under a screen x
function chartMonthAt(clientX) {
  const g = chartGeo, r = g.svg.getBoundingClientRect();
  const px = ((clientX - r.left) / (r.width || 1)) * g.W;
  return Math.max(0, Math.min(g.n, (px - g.padL) / g.step));
}
(function chartGestures() {
  const box = $('#chart');
  const ptrs = new Map();
  let gesture = null, raf = 0;
  const redraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; renderChart(); }); };
  const setWindow = (s0, span) => {
    const g = chartGeo, full = monthDiff(g.fullStart, g.fullEnd);
    if (span >= full) { chartZoom = null; return redraw(); }
    s0 = Math.max(0, Math.min(full - span, Math.round(s0)));
    chartZoom = { start: addMonths(g.fullStart, s0), end: addMonths(g.fullStart, s0 + span) };
    redraw();
  };
  box.addEventListener('gesturestart', (ev) => ev.preventDefault()); // iPhone: pinch zooms the chart, not the page
  box.addEventListener('pointerdown', (ev) => {
    if (!chartGeo || ev.target.closest('button')) return;
    ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const g = chartGeo, off = monthDiff(g.fullStart, g.start);
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      gesture = { type: 'pinch', d0: Math.max(30, Math.abs(a.x - b.x)), off, span: g.n, c: off + chartMonthAt((a.x + b.x) / 2) };
    } else if (ptrs.size === 1) gesture = { type: 'tap', x0: ev.clientX, y0: ev.clientY, t0: Date.now(), off, span: g.n, id: ev.pointerId };
  });
  box.addEventListener('pointermove', (ev) => {
    if (!chartGeo) return;
    if (ev.pointerType === 'mouse' && !ev.buttons && !chartPin) showChartTip(addMonths(chartGeo.start, Math.round(chartMonthAt(ev.clientX))));
    const p = ptrs.get(ev.pointerId); if (!p) return;
    p.x = ev.clientX; p.y = ev.clientY;
    if (gesture && gesture.type === 'pinch' && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const span = Math.max(3, Math.round(gesture.span * (gesture.d0 / Math.max(30, Math.abs(a.x - b.x)))));
      setWindow(gesture.c - (gesture.c - gesture.off) * (span / gesture.span), span);
    } else if (gesture && gesture.type !== 'pinch' && chartZoom && Math.abs(ev.clientX - gesture.x0) > 10) {
      gesture.type = 'pan';
      const r = chartGeo.svg.getBoundingClientRect(), stepPx = (chartGeo.step / chartGeo.W) * (r.width || 1);
      setWindow(gesture.off - (ev.clientX - gesture.x0) / stepPx, gesture.span);
    }
  });
  const end = (ev) => {
    const g = gesture;
    if (g && g.type === 'tap' && g.id === ev.pointerId && ev.type === 'pointerup' && chartGeo
      && Math.hypot(ev.clientX - g.x0, ev.clientY - g.y0) < 10 && Date.now() - g.t0 < 700) {
      chartPin = addMonths(chartGeo.start, Math.round(chartMonthAt(ev.clientX)));
      showChartTip(chartPin);
    }
    ptrs.delete(ev.pointerId);
    if (!ptrs.size) gesture = null;
    else if (g && g.type === 'pinch') gesture = { type: 'done' }; // one finger lifted: wait for the other
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
  box.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse' && !chartPin) hideChartTip(); });
  // tap anywhere else to close the pinned popup
  document.addEventListener('pointerdown', (ev) => { if (chartPin && !box.contains(ev.target)) { chartPin = null; hideChartTip(); } });
})();

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
    const data = views.map((v) => new Map(monthly(salesWithEarly(v), prefs.smooth).map((r) => [r.month, r])));
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
  const rows = new Map(monthly(salesWithEarly(v), prefs.smooth).map((r) => [r.month, r]));
  const lst = new Map(entries.filter((e) => e.suburb === v.name).map((e) => [e.month, e]));
  const months = [...new Set([...rows.keys(), ...lst.keys()])].sort().reverse();
  t.append(el('thead', {}, el('tr', {}, el('th', {}, 'Month'), el('th', {}, 'Sales'), el('th', {}, 'Median'), el('th', {}, 'Average'), el('th', {}, 'Listing'))));
  const tb = el('tbody');
  for (const m of months.slice(0, tableAll ? undefined : 12)) {
    const r = rows.get(m), e = lst.get(m);
    tb.append(el('tr', { onclick: () => openEntry({ suburb: v.name, month: m }) },
      el('td', {}, fmtMonthShort(m), isProvisional(m) ? '*' : ''), el('td', {}, r ? r.n : 0, r && r.early ? el('span', { class: 'early-n' }, ` (${r.early} alert)`) : ''),
      td(r ? r.median : null), td(r ? r.avg : null), td(e ? e.avgListing : null)));
  }
  if (!months.length) tb.append(el('tr', {}, el('td', { colspan: 5, class: 'table-empty' }, 'No sales match these filters.')));
  tableToggle(months.length);
  t.append(tb);
  $('#tableNote').textContent = months.length ? '* Sales for this month are still being reported; "alert" sales come from your sold alerts until the official records arrive. Tap a month to add your listing (asking) price.' : '';
}
