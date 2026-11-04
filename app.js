/* Northern Rivers Prices — monthly housing price tracker (offline PWA, no dependencies). */
(() => {
  'use strict';

  const SUBURBS = [
    { name: 'Casino', color: 'var(--s1)' },
    { name: 'Lismore', color: 'var(--s2)' },
    { name: 'Evans Head', color: 'var(--s3)' },
    { name: 'Ballina', color: 'var(--s4)' },
  ];
  const METRICS = [
    { key: 'median', label: 'Median sold', short: 'Median' },
    { key: 'avgSold', label: 'Average sold', short: 'Avg sold' },
    { key: 'avgListing', label: 'Average listing', short: 'Listing' },
  ];
  const RANGES = [
    { key: 12, label: '1Y' },
    { key: 24, label: '2Y' },
    { key: 60, label: '5Y' },
    { key: 0, label: 'All' },
  ];
  const STORE_KEY = 'nr-prices.v1';
  const PREF_KEY = 'nr-prices.prefs';
  const COMPARE = 'Compare';

  // ---------- storage ----------
  const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const safeSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };

  let entries = [];
  try { entries = JSON.parse(safeGet(STORE_KEY) || '[]'); if (!Array.isArray(entries)) entries = []; } catch { entries = []; }
  let prefs = { view: 'Casino', metric: 'all', range: 24 };
  try { Object.assign(prefs, JSON.parse(safeGet(PREF_KEY) || '{}')); } catch { /* ignore */ }

  function save() {
    entries.sort((a, b) => a.month.localeCompare(b.month) || a.suburb.localeCompare(b.suburb));
    if (!safeSet(STORE_KEY, JSON.stringify(entries))) toast('Could not save on this device — export a backup!');
  }
  const savePrefs = () => safeSet(PREF_KEY, JSON.stringify(prefs));

  // persistent storage request (helps stop the browser evicting data)
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // ---------- helpers ----------
  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : String(kid));
    return n;
  };
  const svgEl = (tag, attrs = {}) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };

  const fmtMoney = (v) => v == null ? '—' : '$' + Math.round(v).toLocaleString('en-AU');
  const fmtShort = (v) => {
    if (v == null) return '—';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(v >= 1e7 ? 1 : 2).replace(/\.?0+$/, '') + 'm';
    if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'k';
    return '$' + Math.round(v);
  };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtMonth = (m) => { const [y, mo] = m.split('-'); return `${MONTHS[+mo - 1]} ${y}`; };
  const fmtMonthShort = (m) => { const [y, mo] = m.split('-'); return `${MONTHS[+mo - 1]} ’${y.slice(2)}`; };
  const addMonths = (m, n) => {
    const [y, mo] = m.split('-').map(Number);
    const d = new Date(Date.UTC(y, mo - 1 + n, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const monthDiff = (a, b) => { const [ya, ma] = a.split('-').map(Number); const [yb, mb] = b.split('-').map(Number); return (yb - ya) * 12 + (mb - ma); };
  const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

  function parsePrice(raw) {
    if (raw == null) return null;
    let s = String(raw).trim().toLowerCase().replace(/[$,\s]/g, '');
    if (!s) return null;
    let mult = 1;
    if (s.endsWith('k')) { mult = 1e3; s = s.slice(0, -1); }
    else if (s.endsWith('m')) { mult = 1e6; s = s.slice(0, -1); }
    const n = Number(s);
    if (!isFinite(n) || n < 0) return NaN;
    return Math.round(n * mult);
  }
  function parseMonth(raw) {
    const s = String(raw || '').trim();
    let m = s.match(/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?$/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
    m = s.match(/^(\d{1,2})[-/](\d{4})$/);
    if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
    m = s.match(/^([a-z]{3})[a-z]*[\s-]+(\d{2,4})$/i);
    if (m) {
      const i = MONTHS.findIndex((x) => x.toLowerCase() === m[1].toLowerCase());
      if (i >= 0) { const y = m[2].length === 2 ? '20' + m[2] : m[2]; return `${y}-${String(i + 1).padStart(2, '0')}`; }
    }
    return null;
  }
  const matchSuburb = (raw) => {
    const s = String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
    return SUBURBS.find((x) => x.name.toLowerCase() === s)?.name || null;
  };
  const colorOf = (name) => SUBURBS.find((s) => s.name === name)?.color || 'var(--accent)';

  function upsert(rec) {
    rec.id = `${rec.suburb}|${rec.month}`;
    rec.updated = new Date().toISOString();
    const i = entries.findIndex((e) => e.id === rec.id);
    if (i >= 0) entries[i] = rec; else entries.push(rec);
  }
  const forSuburb = (name) => entries.filter((e) => e.suburb === name).sort((a, b) => a.month.localeCompare(b.month));

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  // ---------- rendering ----------
  function render() {
    renderHeader();
    renderChips();
    renderSegs();
    renderCards();
    renderChart();
    renderGaps();
    renderTable();
  }

  function renderHeader() {
    if (!entries.length) { $('#lastUpdated').textContent = 'No data yet — tap “+ Add month”'; return; }
    const latestMonth = entries.reduce((m, e) => (e.month > m ? e.month : m), '');
    const lastEdit = entries.reduce((m, e) => (e.updated > m ? e.updated : m), '');
    const d = lastEdit ? new Date(lastEdit).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    $('#lastUpdated').textContent = `Latest data: ${fmtMonth(latestMonth)}${d ? ` · updated ${d}` : ''}`;
  }

  function renderChips() {
    const nav = $('#suburbChips'); nav.replaceChildren();
    for (const s of SUBURBS) {
      nav.append(el('button', {
        class: 'chip', role: 'tab', 'aria-selected': String(prefs.view === s.name),
        onclick: () => { prefs.view = s.name; savePrefs(); render(); },
      }, el('span', { class: 'dot', style: `background:${s.color}` }), s.name));
    }
    nav.append(el('button', {
      class: 'chip', role: 'tab', 'aria-selected': String(prefs.view === COMPARE),
      onclick: () => { prefs.view = COMPARE; savePrefs(); render(); },
    }, 'Compare all'));
  }

  function renderSegs() {
    const compare = prefs.view === COMPARE;
    if (compare && prefs.metric === 'all') prefs.metric = 'median';
    const opts = [...(compare ? [] : [{ key: 'all', short: 'All' }]), ...METRICS];
    const seg = $('#metricSeg'); seg.replaceChildren();
    for (const o of opts) {
      seg.append(el('button', {
        role: 'tab', 'aria-selected': String(prefs.metric === o.key),
        onclick: () => { prefs.metric = o.key; savePrefs(); render(); },
      }, o.short));
    }
    const rs = $('#rangeSeg'); rs.replaceChildren();
    for (const r of RANGES) {
      rs.append(el('button', {
        role: 'tab', 'aria-selected': String(prefs.range === r.key),
        onclick: () => { prefs.range = r.key; savePrefs(); renderChart(); renderSegs(); renderTable(); },
      }, r.label));
    }
  }

  // latest value of a metric + comparison against ~12 months earlier (or previous available)
  function trend(rows, key) {
    const withVal = rows.filter((r) => r[key] != null);
    if (!withVal.length) return null;
    const last = withVal[withVal.length - 1];
    const target = addMonths(last.month, -12);
    let base = withVal.find((r) => r.month === target);
    let label = 'vs 12 mths ago';
    if (!base && withVal.length > 1) {
      base = withVal[withVal.length - 2];
      label = `vs ${fmtMonthShort(base.month)}`;
    }
    const pct = base && base[key] ? ((last[key] - base[key]) / base[key]) * 100 : null;
    return { value: last[key], month: last.month, pct, label };
  }

  function card(label, t, sub) {
    const delta = t && t.pct != null
      ? el('div', { class: 'delta' },
          el('span', { class: t.pct >= 0 ? 'up' : 'down' }, `${t.pct >= 0 ? '▲' : '▼'} ${Math.abs(t.pct).toFixed(1)}%`),
          ` ${t.label}`)
      : el('div', { class: 'delta' }, t ? fmtMonth(t.month) : 'No data');
    return el('div', { class: 'card' },
      el('div', { class: 'label' }, label, sub ? ` · ${sub}` : ''),
      el('div', { class: 'value' }, t ? fmtShort(t.value) : '—'),
      delta);
  }

  function renderCards() {
    const box = $('#statCards'); box.replaceChildren();
    if (prefs.view === COMPARE) {
      const key = prefs.metric;
      const m = METRICS.find((x) => x.key === key);
      box.classList.add('compare');
      for (const s of SUBURBS) {
        const t = trend(forSuburb(s.name), key);
        const c = card(s.name, t, m.short);
        c.querySelector('.label').prepend(el('span', { class: 'dot', style: `display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:${s.color}` }));
        box.append(c);
      }
    } else {
      box.classList.remove('compare');
      const rows = forSuburb(prefs.view);
      for (const m of METRICS) box.append(card(m.label, trend(rows, m.key)));
    }
  }

  function buildSeries() {
    const compare = prefs.view === COMPARE;
    let series = [];
    if (compare) {
      series = SUBURBS.map((s) => ({
        name: s.name, color: s.color, dashed: false,
        points: forSuburb(s.name).filter((r) => r[prefs.metric] != null).map((r) => ({ month: r.month, v: r[prefs.metric] })),
      }));
    } else {
      const rows = forSuburb(prefs.view);
      const base = colorOf(prefs.view);
      const metrics = prefs.metric === 'all' ? METRICS : METRICS.filter((m) => m.key === prefs.metric);
      const styles = { median: { color: base, dashed: false }, avgSold: { color: 'var(--muted)', dashed: false }, avgListing: { color: base, dashed: true } };
      series = metrics.map((m) => ({
        name: m.label, ...(metrics.length === 1 ? { color: base, dashed: false } : styles[m.key]),
        points: rows.filter((r) => r[m.key] != null).map((r) => ({ month: r.month, v: r[m.key] })),
      }));
    }
    // apply range
    const all = series.flatMap((s) => s.points.map((p) => p.month));
    if (!all.length) return { series, start: null, end: null };
    const end = all.reduce((a, b) => (a > b ? a : b));
    let start = all.reduce((a, b) => (a < b ? a : b));
    if (prefs.range) { const rs = addMonths(end, -(prefs.range - 1)); if (rs > start) start = rs; }
    for (const s of series) s.points = s.points.filter((p) => p.month >= start && p.month <= end);
    return { series, start, end };
  }

  function niceTicks(min, max, count = 4) {
    if (min === max) { min *= 0.95; max *= 1.05; }
    const span = max - min;
    const step0 = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((x) => x * mag).find((x) => x >= step0);
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
    return { lo, hi, ticks };
  }

  function renderChart() {
    const box = $('#chart'); box.replaceChildren();
    const legend = $('#legend'); legend.replaceChildren();
    const { series, start, end } = buildSeries();
    const nonEmpty = series.filter((s) => s.points.length);
    if (!nonEmpty.length) {
      box.append(el('div', { class: 'empty' }, prefs.view === COMPARE
        ? 'Add figures for a few suburbs to compare them here.'
        : `No ${prefs.view} figures yet. Tap “+ Add month” to start your history.`));
      return;
    }

    const W = box.clientWidth || 340, H = box.clientHeight || 240;
    const pad = { l: 46, r: 10, t: 12, b: 26 };
    const n = Math.max(1, monthDiff(start, end));
    const vals = nonEmpty.flatMap((s) => s.points.map((p) => p.v));
    const { lo, hi, ticks } = niceTicks(Math.min(...vals), Math.max(...vals));
    const x = (m) => pad.l + (monthDiff(start, m) / n) * (W - pad.l - pad.r);
    const y = (v) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);

    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Price trend chart' });
    for (const t of ticks) {
      svg.append(svgEl('line', { x1: pad.l, x2: W - pad.r, y1: y(t), y2: y(t), stroke: 'var(--grid)', 'stroke-width': 1 }));
      const lab = svgEl('text', { x: pad.l - 6, y: y(t) + 4, 'text-anchor': 'end' }); lab.textContent = fmtShort(t); svg.append(lab);
    }
    // x labels: ~4-6 evenly spaced months
    const totalMonths = n + 1;
    const every = Math.max(1, Math.ceil(totalMonths / Math.max(2, Math.floor((W - pad.l) / 70))));
    for (let i = 0; i <= n; i += every) {
      const m = addMonths(start, i);
      const lab = svgEl('text', { x: x(m), y: H - 6, 'text-anchor': i === 0 && n > 0 ? 'start' : 'middle' });
      lab.textContent = fmtMonthShort(m); svg.append(lab);
    }

    for (const s of nonEmpty) {
      // break the line where months are missing
      let d = '', prev = null;
      for (const p of s.points) {
        d += (prev && monthDiff(prev.month, p.month) === 1 ? 'L' : 'M') + x(p.month).toFixed(1) + ',' + y(p.v).toFixed(1);
        prev = p;
      }
      svg.append(svgEl('path', {
        d, fill: 'none', stroke: s.color, 'stroke-width': 2.25, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        ...(s.dashed ? { 'stroke-dasharray': '6 4' } : {}),
      }));
      // dots: show when few points, or for isolated points
      s.points.forEach((p, i) => {
        const isolated = !(s.points[i - 1] && monthDiff(s.points[i - 1].month, p.month) === 1) && !(s.points[i + 1] && monthDiff(p.month, s.points[i + 1].month) === 1);
        if (s.points.length <= 14 || isolated) svg.append(svgEl('circle', { cx: x(p.month), cy: y(p.v), r: 3, fill: s.color }));
      });
    }

    // hover / touch crosshair
    const cross = svgEl('line', { y1: pad.t, y2: H - pad.b, stroke: 'var(--muted)', 'stroke-width': 1, 'stroke-dasharray': '3 3', visibility: 'hidden' });
    svg.append(cross);
    const tip = el('div', { class: 'tip', hidden: true });
    const onMove = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * n);
      const m = addMonths(start, Math.max(0, Math.min(n, i)));
      const lines = nonEmpty.map((s) => ({ s, p: s.points.find((p) => p.month === m) })).filter((o) => o.p);
      cross.setAttribute('x1', x(m)); cross.setAttribute('x2', x(m)); cross.setAttribute('visibility', 'visible');
      tip.replaceChildren(el('div', {}, el('b', {}, fmtMonth(m))),
        ...(lines.length ? lines.map((o) => el('div', {}, `${o.s.name}: ${fmtMoney(o.p.v)}`)) : [el('div', {}, 'No data')]));
      tip.hidden = false;
      const left = (x(m) / W) * r.width;
      tip.style.left = Math.max(70, Math.min(r.width - 70, left)) + 'px';
    };
    const onLeave = () => { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; };
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerdown', onMove);
    svg.addEventListener('pointerleave', onLeave);

    box.append(svg, tip);

    for (const s of series) {
      legend.append(el('span', {},
        el('i', { class: s.dashed ? 'dash' : '', style: s.dashed ? `color:${s.color}` : `background:${s.color}` }),
        s.name + (s.points.length ? '' : ' (no data)')));
    }
  }

  function renderGaps() {
    const panel = $('#gapPanel');
    if (prefs.view === COMPARE) { panel.hidden = true; return; }
    const rows = forSuburb(prefs.view);
    if (!rows.length) { panel.hidden = true; return; }
    const have = new Set(rows.map((r) => r.month));
    const last = addMonths(thisMonth(), -1);
    const missing = [];
    for (let i = 23; i >= 0; i--) { const m = addMonths(last, -i); if (!have.has(m)) missing.push(m); }
    if (!missing.length) { panel.hidden = true; return; }
    panel.hidden = false;
    panel.replaceChildren(
      el('h2', {}, `Missing months (${missing.length})`),
      el('p', { class: 'gaps' }, `${prefs.view} is missing figures for: `,
        ...missing.map((m, i) => [el('a', { href: '#', onclick: (e) => { e.preventDefault(); openEntry({ suburb: prefs.view, month: m }); } }, fmtMonthShort(m)), i < missing.length - 1 ? ', ' : ''])),
    );
  }

  function renderTable() {
    const t = $('#table'); t.replaceChildren();
    const cell = (v, short) => el('td', { class: v == null ? 'na' : '' }, short ? fmtShort(v) : fmtMoney(v));
    if (prefs.view === COMPARE) {
      const m = METRICS.find((x) => x.key === prefs.metric);
      $('#tableTitle').textContent = `${m.label} by suburb`;
      const months = [...new Set(entries.map((e) => e.month))].sort().reverse();
      t.append(el('thead', {}, el('tr', {}, el('th', {}, 'Month'), ...SUBURBS.map((s) => el('th', {}, s.name)))));
      const tb = el('tbody');
      for (const mo of months) {
        tb.append(el('tr', {}, el('td', {}, fmtMonthShort(mo)),
          ...SUBURBS.map((s) => cell(entries.find((e) => e.suburb === s.name && e.month === mo)?.[m.key] ?? null, true))));
      }
      if (!months.length) tb.append(el('tr', {}, el('td', { colspan: 5, class: 'table-empty' }, 'No figures yet.')));
      t.append(tb);
      return;
    }
    $('#tableTitle').textContent = `${prefs.view} monthly figures`;
    const rows = forSuburb(prefs.view).reverse();
    t.append(el('thead', {}, el('tr', {}, el('th', {}, 'Month'), el('th', {}, 'Median'), el('th', {}, 'Avg sold'), el('th', {}, 'Avg listing'), el('th', {}, 'Sold'))));
    const tb = el('tbody');
    for (const r of rows) {
      tb.append(el('tr', { onclick: () => openEntry(r), title: r.notes || '' },
        el('td', {}, fmtMonthShort(r.month)), cell(r.median), cell(r.avgSold), cell(r.avgListing),
        el('td', { class: r.sales == null ? 'na' : '' }, r.sales ?? '—')));
    }
    if (!rows.length) tb.append(el('tr', {}, el('td', { colspan: 5, class: 'table-empty' }, 'Tap “+ Add month” to enter your first figures. Tap any row later to edit it.')));
    t.append(tb);
  }

  // ---------- entry dialog ----------
  const dlg = $('#entryDialog');
  const form = $('#entryForm');
  form.suburb.append(...SUBURBS.map((s) => el('option', { value: s.name }, s.name)));

  function openEntry(rec) {
    const existing = rec && rec.suburb && rec.month ? entries.find((e) => e.suburb === rec.suburb && e.month === rec.month) : null;
    const r = existing || rec || {};
    form.suburb.value = r.suburb || (prefs.view !== COMPARE ? prefs.view : SUBURBS[0].name);
    form.month.value = r.month || addMonths(thisMonth(), -1);
    for (const k of ['median', 'avgSold', 'avgListing', 'sales', 'listings']) form[k].value = r[k] != null ? r[k] : '';
    form.notes.value = r.notes || '';
    $('#entryTitle').textContent = existing ? `Edit ${existing.suburb} · ${fmtMonth(existing.month)}` : 'Add monthly figures';
    $('#deleteEntry').hidden = !existing;
    $('#entryError').hidden = true;
    dlg.dataset.editing = existing ? existing.id : '';
    dlg.showModal();
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const err = (msg) => { const e = $('#entryError'); e.textContent = msg; e.hidden = false; };
    const month = parseMonth(form.month.value);
    if (!month) return err('Please choose a month.');
    const rec = { suburb: form.suburb.value, month, notes: form.notes.value.trim() || undefined };
    for (const k of ['median', 'avgSold', 'avgListing', 'sales', 'listings']) {
      const v = parsePrice(form[k].value);
      if (Number.isNaN(v)) return err(`“${form[k].value}” isn't a number.`);
      rec[k] = v;
    }
    if (rec.median == null && rec.avgSold == null && rec.avgListing == null) return err('Enter at least one price.');
    // editing and the suburb/month changed → remove the old record
    const oldId = dlg.dataset.editing;
    if (oldId && oldId !== `${rec.suburb}|${rec.month}`) entries = entries.filter((e) => e.id !== oldId);
    upsert(rec);
    save();
    dlg.close();
    prefs.view = rec.suburb; savePrefs();
    render();
    toast(`Saved ${rec.suburb} · ${fmtMonth(rec.month)}`);
  });
  $('#cancelEntry').addEventListener('click', () => dlg.close());
  $('#deleteEntry').addEventListener('click', () => {
    const id = dlg.dataset.editing;
    if (!id || !confirm('Delete this month’s figures?')) return;
    entries = entries.filter((e) => e.id !== id);
    save(); dlg.close(); render(); toast('Deleted');
  });
  $('#addBtn').addEventListener('click', () => openEntry(null));

  // ---------- import / export ----------
  const menu = $('#menuDialog');
  $('#menuBtn').addEventListener('click', () => menu.showModal());
  $('#closeMenu').addEventListener('click', () => menu.close());

  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);
  const CSV_COLS = ['suburb', 'month', 'median', 'avgSold', 'avgListing', 'sales', 'listings', 'notes'];
  const csvEsc = (v) => { if (v == null) return ''; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

  $('#exportJson').addEventListener('click', () => {
    download(`nr-prices-backup-${stamp()}.json`, JSON.stringify({ app: 'nr-prices', version: 1, exported: new Date().toISOString(), entries }, null, 2), 'application/json');
  });
  $('#exportCsv').addEventListener('click', () => {
    const lines = [CSV_COLS.join(','), ...entries.map((e) => CSV_COLS.map((c) => csvEsc(e[c])).join(','))];
    download(`nr-prices-${stamp()}.csv`, lines.join('\n'), 'text/csv');
  });

  function parseCsv(text) {
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows.filter((r) => r.some((x) => x.trim()));
  }

  // returns { added, skipped: [reasons] }
  function importRecords(list) {
    let added = 0; const skipped = [];
    for (const raw of list) {
      const suburb = matchSuburb(raw.suburb);
      const month = parseMonth(raw.month);
      if (!suburb) { skipped.push(`unknown suburb “${raw.suburb}”`); continue; }
      if (!month) { skipped.push(`bad month “${raw.month}”`); continue; }
      const rec = { suburb, month, notes: raw.notes ? String(raw.notes).trim() || undefined : undefined };
      let bad = false;
      for (const k of ['median', 'avgSold', 'avgListing', 'sales', 'listings']) {
        const v = parsePrice(raw[k]); if (Number.isNaN(v)) bad = true; rec[k] = Number.isNaN(v) ? null : v;
      }
      if (bad || (rec.median == null && rec.avgSold == null && rec.avgListing == null)) { skipped.push(`${suburb} ${month}: no valid prices`); continue; }
      upsert(rec); added++;
    }
    save(); render();
    return { added, skipped };
  }

  function csvToRecords(text) {
    const rows = parseCsv(text);
    if (!rows.length) return [];
    const norm = (h) => h.trim().toLowerCase().replace(/[^a-z]/g, '');
    const aliases = { suburb: 'suburb', month: 'month', date: 'month', median: 'median', mediansold: 'median', medianprice: 'median',
      avgsold: 'avgSold', averagesold: 'avgSold', averagesoldprice: 'avgSold', avglisting: 'avgListing', averagelisting: 'avgListing',
      averagelistingprice: 'avgListing', listing: 'avgListing', sales: 'sales', sold: 'sales', numbersold: 'sales', listings: 'listings',
      activelistings: 'listings', notes: 'notes', source: 'notes' };
    let header = rows[0].map((h) => aliases[norm(h)]);
    let body = rows.slice(1);
    if (!header.includes('suburb') || !header.includes('month')) { header = CSV_COLS; body = rows; } // no header row
    return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]]).filter(([h]) => h)));
  }

  function reportImport({ added, skipped }) {
    menu.open && menu.close();
    toast(`Imported ${added} month${added === 1 ? '' : 's'}${skipped.length ? `, skipped ${skipped.length}` : ''}`);
    if (skipped.length) console.warn('Skipped rows:', skipped);
  }

  $('#importFile').addEventListener('change', async (ev) => {
    const file = ev.target.files[0]; ev.target.value = '';
    if (!file) return;
    const text = await file.text();
    try {
      let list;
      if (/^\s*[[{]/.test(text)) { const j = JSON.parse(text); list = Array.isArray(j) ? j : j.entries; if (!Array.isArray(list)) throw new Error('No entries in file'); }
      else list = csvToRecords(text);
      reportImport(importRecords(list));
    } catch (e) { toast('Could not read that file: ' + e.message); }
  });

  const pasteDlg = $('#pasteDialog');
  $('#pasteCsvBtn').addEventListener('click', () => { menu.close(); $('#pasteError').hidden = true; pasteDlg.showModal(); });
  $('#cancelPaste').addEventListener('click', () => pasteDlg.close());
  $('#pasteForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const res = importRecords(csvToRecords(ev.target.csv.value));
    if (!res.added) { const e = $('#pasteError'); e.textContent = res.skipped[0] ? `Nothing imported: ${res.skipped[0]}` : 'Nothing to import.'; e.hidden = false; return; }
    ev.target.csv.value = ''; pasteDlg.close(); reportImport(res);
  });

  $('#clearAll').addEventListener('click', () => {
    if (!entries.length) return toast('Nothing to delete');
    if (!confirm(`Delete all ${entries.length} monthly records from this phone? Export a backup first if you might want them.`)) return;
    entries = []; save(); menu.close(); render(); toast('All data deleted');
  });

  // close dialogs when tapping the backdrop
  for (const d of document.querySelectorAll('dialog')) {
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  }

  let resizeT;
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(renderChart, 120); });

  render();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
