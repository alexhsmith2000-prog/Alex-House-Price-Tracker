/* Northern Rivers Prices — The Filters dialog for creating and editing saved searches.
 * Part of the app; the files in js/ load in order and share one scope (see index.html). */
'use strict';

// ---------- filters dialog ----------
const fDlg = $('#filterDialog');
let editing = null, isNew = false;

function openFilters(asNew) {
  isNew = asNew;
  editing = asNew ? { id: '', name: '', area: 'all', locs: [], types: ['house'], min: 0, max: 0, shape: null } : structuredClone(currentView());
  $('#filterTitle').textContent = asNew ? 'New search' : `Edit “${editing.name}”`;
  $('#fName').value = editing.name;
  const areaSel = $('#fArea'); areaSel.replaceChildren();
  for (const g of [...new Set(AREAS.map((a) => a.group))]) areaSel.append(el('optgroup', { label: g }, ...AREAS.filter((a) => a.group === g).map((a) => el('option', { value: a.id }, a.name))));
  areaSel.value = editing.area;
  for (const [id, anyLabel, val] of [['#fLandMin', 'No min', editing.landMin], ['#fLandMax', 'No max', editing.landMax]]) {
    const sel = $(id);
    sel.replaceChildren(el('option', { value: 0 }, anyLabel), ...LAND_STEPS.map((a) => el('option', { value: a }, fmtArea(a))));
    sel.value = String(val || 0);
  }
  $('#fStreet').value = editing.street || '';
  const fsel = $('#fFlood');
  fsel.replaceChildren(...FLOOD_FILTERS.map((f) => el('option', { value: f.id }, f.name)));
  fsel.value = editing.flood || '';
  $('#fFloodField').hidden = !FLOOD && !editing.flood;
  for (const [id, anyLabel, val] of [['#fMin', 'No min', editing.min], ['#fMax', 'No max', editing.max]]) {
    const sel = $(id);
    const steps = val && !PRICE_STEPS.includes(val) ? [...PRICE_STEPS, val].sort((a, b) => a - b) : PRICE_STEPS;
    sel.replaceChildren(el('option', { value: 0 }, anyLabel), ...steps.map((p) => el('option', { value: p }, fmtShort(p))));
    sel.value = String(val || 0);
  }
  $('#fLocSearch').value = '';
  renderTypeChecks(); renderLocChecks(); renderShapeField();
  $('#deleteView').hidden = asNew || views.length <= 1;
  $('#saveAsNew').hidden = asNew;
  $('#filterError').hidden = true;
  fDlg.showModal();
  fDlg.querySelector('.sheet-body').scrollTop = 0;
}

function renderTypeChecks() {
  const box = $('#fTypes'); box.replaceChildren();
  for (const t of TYPES) {
    box.append(el('label', { class: 'check' }, el('input', { type: 'checkbox', value: t.id, checked: editing.types.includes(t.id), onchange: (e) => {
      editing.types = TYPES.map((x) => x.id).filter((id) => (id === t.id ? e.target.checked : editing.types.includes(id)));
      updateCount();
    } }), t.name));
  }
}

function renderLocChecks() {
  const area = areaOf(editing.area);
  const locs = [...LOC_COUNTS.entries()].filter(([, c]) => areaHas(area, c.pc)).sort((a, b) => b[1].n - a[1].n);
  for (const l of editing.locs) if (!LOC_COUNTS.has(l)) locs.push([l, { n: 0 }]); // chosen but no sales yet
  const box = $('#fLocs'); box.replaceChildren();
  const q = $('#fLocSearch').value.trim().toLowerCase();
  if (!locs.length) box.append(el('p', { class: 'hint' }, N
    ? `Your imported sales don't include any from ${area.name} yet. Check ⋯ (top right) to see which areas your data covers, and import more sales files if needed.`
    : 'Locations appear here once sales data has been imported (⋯ → Import sales files).'));
  // chosen ones first, then the busiest; search narrows the list
  const chosen = new Set(editing.locs);
  const shownLocs = locs.filter(([name]) => !q || name.toLowerCase().includes(q))
    .sort((a, b) => (chosen.has(b[0]) - chosen.has(a[0])) || (b[1].n - a[1].n));
  const LIMIT = 150;
  for (const [name, c] of shownLocs.slice(0, LIMIT)) {
    box.append(el('label', { class: 'check', 'data-name': name.toLowerCase() },
      el('input', { type: 'checkbox', value: name, checked: editing.locs.includes(name), onchange: (e) => {
        editing.locs = e.target.checked ? [...editing.locs, name] : editing.locs.filter((x) => x !== name);
        updateCount();
      } }), el('span', { class: 'grow' }, titleCase(name)), el('span', { class: 'count' }, c.n)));
  }
  if (shownLocs.length > LIMIT) box.append(el('p', { class: 'hint' }, `${(shownLocs.length - LIMIT).toLocaleString('en-AU')} more — type above to find a suburb.`));
  updateCount();
}

function updateCount() {
  $('#fCount').textContent = N ? `${salesFor(editing).length.toLocaleString('en-AU')} matching sales` : '';
  if (editing.shape && GEO) {
    const all = salesFor({ ...editing, shape: null });
    const unplaced = all.filter((s) => s.level !== 2 && GEO && GEO.postcodes.has(s.pc)).length;
    $('#fShapeNote').textContent = unplaced ? `${unplaced.toLocaleString('en-AU')} of ${all.length.toLocaleString('en-AU')} sales in these locations in house-level areas couldn't be matched to a house (e.g. lot-only rural addresses), so small drawn areas leave them out.` : '';
  } else $('#fShapeNote').textContent = '';
  $('#fLocLabel').textContent = editing.locs.length ? `Locations · ${editing.locs.length} selected` : 'Locations · all in area';
}

$('#fArea').addEventListener('change', (e) => {
  $('#fLocSearch').value = '';
  editing.area = e.target.value;
  const area = areaOf(editing.area);
  editing.locs = editing.locs.filter((l) => { const c = LOC_COUNTS.get(l); return !c || areaHas(area, c.pc); });
  renderLocChecks();
});
let locSearchT;
$('#fLocSearch').addEventListener('input', () => { clearTimeout(locSearchT); locSearchT = setTimeout(renderLocChecks, 150); });
$('#fLocAll').addEventListener('click', () => { editing.locs = []; $('#fLocSearch').value = ''; renderLocChecks(); });
$('#fMin').addEventListener('change', (e) => { editing.min = +e.target.value; updateCount(); });
$('#fLandMin').addEventListener('change', (e) => { editing.landMin = +e.target.value; updateCount(); });
$('#fLandMax').addEventListener('change', (e) => { editing.landMax = +e.target.value; updateCount(); });
$('#fFlood').addEventListener('change', (e) => { editing.flood = e.target.value; updateCount(); });
let streetT;
$('#fStreet').addEventListener('input', (e) => { clearTimeout(streetT); streetT = setTimeout(() => { editing.street = e.target.value.trim(); updateCount(); }, 250); });
$('#fMax').addEventListener('change', (e) => { editing.max = +e.target.value; updateCount(); });
$('#cancelFilters').addEventListener('click', () => fDlg.close());

function commitFilters(asNew) {
  const name = $('#fName').value.trim();
  const err = (m) => { const e = $('#filterError'); e.textContent = m; e.hidden = false; e.scrollIntoView({ block: 'nearest' }); };
  if (!name) return err('Give this search a name, e.g. “Casino acreage under $800k”.');
  if (editing.min && editing.max && editing.min > editing.max) return err('The minimum price is above the maximum.');
  if (editing.landMin && editing.landMax && editing.landMin > editing.landMax) return err('The minimum land size is above the maximum.');
  editing.street = $('#fStreet').value.trim();
  editing.flood = $('#fFlood').value;
  if (views.some((v) => v.name.toLowerCase() === name.toLowerCase() && (asNew || v.id !== editing.id))) return err('You already have a search with that name.');
  const rec = { ...editing, name };
  if (asNew) { rec.id = 'v-' + Date.now().toString(36); views.push(rec); }
  else {
    const i = views.findIndex((v) => v.id === editing.id);
    const old = views[i];
    if (old.name !== name) { for (const e of entries) if (e.suburb === old.name) { e.suburb = name; e.id = `${name}|${e.month}`; } saveEntries(); }
    views[i] = rec;
  }
  prefs.view = rec.id; salesShown = 30;
  saveViews(); savePrefs(); fDlg.close(); render();
  toast(asNew ? `Saved “${name}”` : 'Filters updated');
}
$('#filterForm').addEventListener('submit', (e) => { e.preventDefault(); commitFilters(isNew); });
$('#saveAsNew').addEventListener('click', () => {
  if ($('#fName').value.trim() === currentView()?.name) $('#fName').value += ' (copy)';
  commitFilters(true);
});
$('#deleteView').addEventListener('click', () => {
  if (!confirm(`Delete the saved search “${editing.name}”?`)) return;
  views = views.filter((v) => v.id !== editing.id);
  prefs.view = views[0].id; saveViews(); savePrefs(); fDlg.close(); render();
});
