/* Northern Rivers Prices — Main screen: collapsible sections, header, saved-search chips, filter bar and chart controls.
 * Part of the app; the files in js/ load in order and share one scope (see index.html). */
'use strict';

// ---------- rendering ----------
const currentView = () => views.find((v) => v.id === prefs.view);

// Collapsible sections (tables and lists): closed until opened; remembered.
if (!prefs.open || typeof prefs.open !== 'object') prefs.open = {};
function setupCollapsers() {
  for (const btn of document.querySelectorAll('.collapser')) {
    const key = btn.dataset.key, body = document.querySelector(`[data-body="${key}"]`);
    const apply = () => { const open = !!prefs.open[key]; btn.setAttribute('aria-expanded', String(open)); body.hidden = !open; };
    btn.addEventListener('click', () => { prefs.open[key] = !prefs.open[key]; savePrefs(); apply(); });
    apply();
  }
}
setupCollapsers();

function render() {
  renderHeader(); renderChips(); renderFilterBar(); renderSegs();
  // renderChart also draws the headline cards, for the period shown on the chart
  renderChart(); renderMapPanel(); renderListings(); renderTable(); renderResales(); renderSalesList(); renderWatchBar(); renderMissingBar();
}

function renderHeader() {
  const h = $('#lastUpdated');
  if (!DATA_INFO) { h.textContent = 'No sold-price data imported yet'; return; }
  const g = new Date(DATA_INFO.generated);
  h.textContent = `${(N - (DATA_INFO.excluded || 0)).toLocaleString('en-AU')} sales · latest ${fmtDate(DATA_INFO.latest)} · updated ${g.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`;
}

function renderChips() {
  const nav = $('#viewChips'); nav.replaceChildren();
  for (const v of views) {
    nav.append(el('button', { class: 'chip', role: 'tab', 'aria-selected': String(prefs.view === v.id), onclick: () => { prefs.view = v.id; salesShown = 30; resalesShown = 10; savePrefs(); render(); } },
      el('span', { class: 'dot', style: `background:${viewColor(v)}` }), v.name));
  }
  nav.append(el('button', { class: 'chip', role: 'tab', 'aria-selected': String(prefs.view === COMPARE), onclick: () => { prefs.view = COMPARE; savePrefs(); render(); } }, 'Compare'));
  nav.append(el('button', { class: 'chip add', onclick: () => openFilters(true) }, '+ New search'));
  nav.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function filterSummary(v) {
  const area = areaOf(v.area);
  let where = v.locs && v.locs.length ? (v.locs.length <= 2 ? v.locs.map(titleCase).join(', ') : `${v.locs.length} locations · ${area.name}`) : area.name;
  if (v.shape) where += ` · ${shapeLabel(v.shape)}`;
  const types = !v.types || !v.types.length || v.types.length === TYPES.length ? 'All property types' : v.types.map(typeName).join(', ');
  let price = v.min && v.max ? `${fmtShort(v.min)}–${fmtShort(v.max)}` : v.min ? `${fmtShort(v.min)}+` : v.max ? `Up to ${fmtShort(v.max)}` : 'Any price';
  if (v.landMin || v.landMax) price += ` · land ${v.landMin && v.landMax ? `${fmtArea(v.landMin)}–${fmtArea(v.landMax)}` : v.landMin ? `${fmtArea(v.landMin)}+` : `up to ${fmtArea(v.landMax)}`}`;
  if (v.street) where = `Street “${titleCase(v.street)}” · ${where}`;
  if (v.flood) price += ` · ${FLOOD_FILTERS.find((f) => f.id === v.flood)?.short || ''}`;
  return { where, types, price };
}

function renderFilterBar() {
  const bar = $('#filterBar'); bar.replaceChildren();
  const v = currentView();
  if (!v) { bar.append(el('div', { class: 'fsum' }, el('b', {}, 'Comparing your saved searches'), el('span', {}, 'Tap a search above to change its filters'))); return; }
  const f = filterSummary(v);
  bar.append(el('div', { class: 'fsum' }, el('b', {}, f.where), el('span', {}, `${f.types} · ${f.price}`)),
    el('button', { class: 'ghost small', onclick: () => openFilters(false) }, 'Filters'));
}

function renderSegs() {
  const compare = prefs.view === COMPARE;
  if (compare && prefs.metric === 'both') prefs.metric = 'median';
  const seg = $('#metricSeg'); seg.replaceChildren();
  for (const o of METRICS) {
    if (compare && o.key === 'both') continue;
    seg.append(el('button', { role: 'tab', 'aria-selected': String(prefs.metric === o.key), onclick: () => { prefs.metric = o.key; savePrefs(); render(); } }, o.label));
  }
  const rs = $('#rangeSeg'); rs.replaceChildren();
  for (const r of RANGES) rs.append(el('button', { role: 'tab', 'aria-selected': String(prefs.range === r.key), onclick: () => { prefs.range = r.key; savePrefs(); render(); } }, r.label));
  const sm = $('#smoothSeg'); sm.replaceChildren();
  for (const [k, label] of [[1, 'Monthly'], [3, '3-month rolling']]) sm.append(el('button', { role: 'tab', 'aria-selected': String(prefs.smooth === k), onclick: () => { prefs.smooth = k; savePrefs(); render(); } }, label));
  const tr = $('#trendSeg'); tr.replaceChildren(el('span', { class: 'seg-label' }, 'Trends'));
  for (const w of TREND_WINDOWS) {
    const on = prefs.trends.includes(w.key);
    tr.append(el('button', { type: 'button', 'aria-pressed': String(on), 'aria-selected': String(on), title: `Trend over the last ${w.label}`, onclick: () => {
      prefs.trends = on ? prefs.trends.filter((k) => k !== w.key) : [...prefs.trends, w.key];
      savePrefs(); renderChart(); renderSegs();
    } }, w.short));
  }
}
