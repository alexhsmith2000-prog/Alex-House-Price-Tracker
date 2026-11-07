/* Northern Rivers Prices — Manual listing (asking) price entry dialog.
 * Part of the app; the files in js/ load in order and share one scope (see index.html). */
'use strict';

// ---------- listing-price entry dialog ----------
const dlg = $('#entryDialog');
const form = $('#entryForm');
function openEntry(rec) {
  form.suburb.replaceChildren(...views.map((v) => el('option', { value: v.name }, v.name)));
  const existing = rec && rec.suburb && rec.month ? entries.find((e) => e.suburb === rec.suburb && e.month === rec.month) : null;
  const r = existing || rec || {};
  form.suburb.value = r.suburb || currentView()?.name || views[0].name;
  form.month.value = r.month || addMonths(thisMonth(), -1);
  form.avgListing.value = r.avgListing ?? '';
  form.listings.value = r.listings ?? '';
  form.notes.value = r.notes || '';
  $('#entryTitle').textContent = existing ? `${existing.suburb} · ${fmtMonth(existing.month)}` : 'Add listing (asking) price';
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
  const avgListing = parsePrice(form.avgListing.value), listings = parsePrice(form.listings.value);
  if (Number.isNaN(avgListing) || Number.isNaN(listings)) return err('Please enter numbers only.');
  if (avgListing == null) return err('Enter the average listing price.');
  const oldId = dlg.dataset.editing;
  const old = entries.find((e) => e.id === oldId);
  const rec = { ...(old || {}), suburb: form.suburb.value, month, avgListing, listings, notes: form.notes.value.trim() || undefined };
  rec.id = `${rec.suburb}|${rec.month}`; rec.updated = new Date().toISOString();
  entries = entries.filter((e) => e.id !== oldId && e.id !== rec.id);
  entries.push(rec);
  saveEntries(); dlg.close(); render();
  toast(`Saved listing price for ${rec.suburb} · ${fmtMonth(month)}`);
});
$('#cancelEntry').addEventListener('click', () => dlg.close());
$('#deleteEntry').addEventListener('click', () => {
  const id = dlg.dataset.editing;
  if (!id || !confirm('Delete this listing price?')) return;
  entries = entries.filter((e) => e.id !== id); saveEntries(); dlg.close(); render(); toast('Deleted');
});
$('#addBtn').addEventListener('click', () => openEntry(null));
