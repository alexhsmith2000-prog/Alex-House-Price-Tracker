/* Northern Rivers Prices — The ⋯ menu: imports, exports, backups and clearing data.
 * Part of the app; the files in js/ load in order and share one scope (see index.html). */
'use strict';

// ---------- menu: import / export ----------
const menu = $('#menuDialog');
$('#menuBtn').addEventListener('click', () => { renderImportStatus(); renderFloodStatus(); renderListingStatus(); renderFeedStatus(); menu.showModal(); });
$('#importFlood').addEventListener('change', async (ev) => { const files = ev.target.files; await importFloodPdfs(files); ev.target.value = ''; });
$('#importListings').addEventListener('change', async (ev) => { const files = ev.target.files; await importListingPdfs(files); ev.target.value = ''; });
$('#clearListings').addEventListener('click', async () => {
  if (!Object.keys(LISTINGS.recs).length) return toast('No listings to delete');
  if (!confirm('Delete all listings imported from alert emails?')) return;
  LISTINGS = { recs: {}, files: [] }; LINFO = null; ADDR_SALES = null;
  try { await idbSet('listings', LISTINGS); } catch { /* ignore */ }
  render(); renderListingStatus();
});
$('#clearFlood').addEventListener('click', async () => {
  if (!FLOOD) return toast('No flood levels to delete');
  if (!confirm('Delete the imported flood and floor levels?')) return;
  FLOOD = null; try { await idbSet('flood-levels', null); } catch { /* ignore */ }
  derive(); render(); renderFloodStatus();
});
$('#importZip').addEventListener('change', async (ev) => { const files = ev.target.files; await importZipFiles(files); ev.target.value = ''; });
$('#copyList').addEventListener('click', async () => {
  const list = missingFiles();
  if (!list.length) return toast('Nothing to download: you are up to date');
  const text = list.join('\n');
  try { await navigator.clipboard.writeText(text); toast(`Copied ${list.length} download links. Now run the “NR Prices catch-up” shortcut.`); }
  catch { const ta = $('#copyFallback'); ta.hidden = false; ta.value = text; ta.select(); toast('Select all and copy the links below'); }
});
$('#clearImported').addEventListener('click', async () => {
  if (!N) return toast('No imported sales to delete');
  if (!confirm('Delete all sales imported on this phone? You can import the files again later.')) return;
  C = emptyStore(); FILES = { files: [], updated: null };
  try { await idbSet('store2', C); await idbSet('store2-keys', []); await idbSet('store2-files', FILES); } catch { /* ignore */ }
  derive(); render(); renderImportStatus(); toast('Imported sales deleted');
});
$('#closeMenu').addEventListener('click', () => menu.close());
function download(name, text, type) {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const stamp = () => new Date().toISOString().slice(0, 10);
const csvEsc = (v) => { if (v == null) return ''; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const ENTRY_COLS = ['suburb', 'month', 'avgListing', 'listings', 'notes'];

$('#exportJson').addEventListener('click', () => download(`nr-prices-backup-${stamp()}.json`, JSON.stringify({ app: 'nr-prices', version: 2, exported: new Date().toISOString(), views, entries }, null, 2), 'application/json'));
$('#exportSales').addEventListener('click', () => {
  const v = currentView();
  if (!v) return toast('Pick one of your searches first');
  const rows = salesFor(v);
  const lines = ['contract_date,price,street,locality,postcode,type,land_m2,zone',
    ...rows.map((s) => [String(s.d).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'), s.price, titleCase(s.street), titleCase(s.loc), s.pc, typeName(s.type), s.area ?? '', s.zone].map(csvEsc).join(','))];
  download(`${v.name.replace(/[^\w]+/g, '-')}-sales-${stamp()}.csv`, lines.join('\n'), 'text/csv');
});
$('#exportCsv').addEventListener('click', () => download(`nr-prices-listings-${stamp()}.csv`, [ENTRY_COLS.join(','), ...entries.map((e) => ENTRY_COLS.map((c) => csvEsc(e[c])).join(','))].join('\n'), 'text/csv'));

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
function csvToRecords(text) {
  const rows = parseCsv(text); if (!rows.length) return [];
  const norm = (h) => h.trim().toLowerCase().replace(/[^a-z]/g, '');
  const alias = { suburb: 'suburb', search: 'suburb', month: 'month', date: 'month', avglisting: 'avgListing', averagelisting: 'avgListing', averagelistingprice: 'avgListing', listing: 'avgListing', listings: 'listings', activelistings: 'listings', notes: 'notes', source: 'notes' };
  let header = rows[0].map((h) => alias[norm(h)]), body = rows.slice(1);
  if (!header.includes('suburb') || !header.includes('month')) { header = ENTRY_COLS; body = rows; }
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]]).filter(([h]) => h)));
}
function importEntries(list) {
  let added = 0; const skipped = [];
  for (const raw of list) {
    const name = String(raw.suburb || '').trim();
    const v = views.find((x) => x.name.toLowerCase() === name.toLowerCase());
    const month = parseMonth(raw.month);
    if (!v) { skipped.push(`no saved search called “${name}”`); continue; }
    if (!month) { skipped.push(`bad month “${raw.month}”`); continue; }
    const avgListing = parsePrice(raw.avgListing), listings = parsePrice(raw.listings);
    if (avgListing == null || Number.isNaN(avgListing)) { skipped.push(`${v.name} ${month}: no listing price`); continue; }
    const rec = { suburb: v.name, month, avgListing, listings: Number.isNaN(listings) ? null : listings, notes: raw.notes ? String(raw.notes).trim() || undefined : undefined };
    rec.id = `${rec.suburb}|${month}`; rec.updated = new Date().toISOString();
    entries = entries.filter((e) => e.id !== rec.id); entries.push(rec); added++;
  }
  saveEntries(); render();
  return { added, skipped };
}
const report = ({ added, skipped }) => { if (menu.open) menu.close(); toast(`Imported ${added} row${added === 1 ? '' : 's'}${skipped.length ? `, skipped ${skipped.length}` : ''}`); };

$('#importFile').addEventListener('change', async (ev) => {
  const file = ev.target.files[0]; ev.target.value = '';
  if (!file) return;
  const text = await file.text();
  try {
    if (/^\s*[[{]/.test(text)) {
      const j = JSON.parse(text);
      if (Array.isArray(j.views) && j.views.length) {
        for (const v of j.views) { const i = views.findIndex((x) => x.id === v.id || x.name === v.name); if (i >= 0) views[i] = v; else views.push(v); }
        saveViews();
      }
      const list = Array.isArray(j) ? j : j.entries;
      if (!Array.isArray(list)) throw new Error('no entries in file');
      report(importEntries(list));
    } else report(importEntries(csvToRecords(text)));
  } catch (e) { toast('Could not read that file: ' + e.message); }
});

const pasteDlg = $('#pasteDialog');
$('#pasteCsvBtn').addEventListener('click', () => { menu.close(); $('#pasteError').hidden = true; pasteDlg.showModal(); });
$('#cancelPaste').addEventListener('click', () => pasteDlg.close());
$('#pasteForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const res = importEntries(csvToRecords(ev.target.csv.value));
  if (!res.added) { const e = $('#pasteError'); e.textContent = res.skipped[0] ? `Nothing imported: ${res.skipped[0]}` : 'Nothing to import.'; e.hidden = false; return; }
  ev.target.csv.value = ''; pasteDlg.close(); report(res);
});
$('#resetViews').addEventListener('click', () => {
  if (!confirm('Restore the four starting searches (Casino, Lismore, Evans Head, Ballina)? Your other saved searches are kept.')) return;
  for (const d of DEFAULT_VIEWS) { const i = views.findIndex((v) => v.id === d.id); if (i >= 0) views[i] = structuredClone(d); else views.push(structuredClone(d)); }
  saveViews(); menu.close(); render();
});
$('#clearAll').addEventListener('click', () => {
  if (!entries.length) return toast('No listing prices to delete');
  if (!confirm(`Delete all ${entries.length} listing prices you've entered? Export a backup first if you might want them.`)) return;
  entries = []; saveEntries(); menu.close(); render(); toast('Deleted');
});

for (const d of document.querySelectorAll('dialog:not(#mapDialog)')) d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(renderChart, 120); });
