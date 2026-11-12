/* Northern Rivers Prices — Reading NSW Valuer General zip/DAT files on the phone, import status and the list of files still to download.
 * Part of the app; the files in js/ load in order and share one scope (see index.html). */
'use strict';

// ---------- reading NSW Valuer General zip files on the phone ----------
const VG_BASE = 'https://www.valuergeneral.nsw.gov.au/__psi';

function* zipEntries(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file');
  let count = dv.getUint16(eocd + 10, true), cd = dv.getUint32(eocd + 16, true);
  if ((cd === 0xffffffff || count === 0xffff) && eocd >= 20 && dv.getUint32(eocd - 20, true) === 0x07064b50) { // ZIP64
    const z = Number(dv.getBigUint64(eocd - 12, true));
    count = Number(dv.getBigUint64(z + 32, true)); cd = Number(dv.getBigUint64(z + 48, true));
  }
  let p = cd;
  for (let i = 0; i < count && dv.getUint32(p, true) === 0x02014b50; i++) {
    const method = dv.getUint16(p + 10, true);
    let csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    let off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nlen));
    if (csize === 0xffffffff || off === 0xffffffff) {
      for (let e = p + 46 + nlen; e < p + 46 + nlen + elen;) {
        const id = dv.getUint16(e, true), sz = dv.getUint16(e + 2, true);
        if (id === 1) {
          let q = e + 4;
          if (usize === 0xffffffff) q += 8;
          if (csize === 0xffffffff) { csize = Number(dv.getBigUint64(q, true)); q += 8; }
          if (off === 0xffffffff) off = Number(dv.getBigUint64(q, true));
        }
        e += 4 + sz;
      }
    }
    p += 46 + nlen + elen + clen;
    if (name.endsWith('/')) continue;
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    yield { name, method, data: buf.subarray(start, start + csize) };
  }
}
async function inflate(entry) {
  if (entry.method === 0) return entry.data;
  if (entry.method !== 8) throw new Error('unsupported compression');
  const stream = new Blob([entry.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// % interest of sale: 100 for a whole property; less for a part share (e.g. buying out a co-owner).
const interestPct = (v) => { const n = parseFloat(String(v || '').trim()); return isFinite(n) && n > 0 ? Math.min(100, Math.max(1, Math.round(n))) : 0; };

// 'B' records, post-2001 Valuer General format (semicolon separated). All of NSW is kept.
function parseDat(text, b) {
  let n = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('B;')) continue;
    const f = line.split(';');
    if (f.length < 24) continue;
    const price = parseInt(f[15], 10);
    const contract = f[13].trim() || f[14].trim();
    if (!price || !/^\d{8}$/.test(contract)) continue;
    const a = parseFloat(f[11]);
    const area = isFinite(a) ? Math.round(a * (f[12].trim().toUpperCase() === 'H' ? 10000 : 1)) : null;
    b.put(`${f[1].trim()}|${f[2].trim()}|${f[3].trim()}|${contract}`, [+contract, f[9].trim().toUpperCase(), f[10].trim(), price, area, f[16].trim().toUpperCase(),
      f[17].trim().toUpperCase().slice(0, 1), f[18].trim().toUpperCase(), f[19].trim() ? 1 : 0, f[8].trim().toUpperCase(), f[4].trim(), f[23].trim(), f[7].trim(), interestPct(f[22])]);
    n++;
  }
  return n;
}

const fileId = (name) => { const m = String(name).match(/(\d{8}|\d{4})(?:\s*\d*)?\.zip$/i); return m ? (m[1].length === 8 ? `weekly/${m[1]}` : `yearly/${m[1]}`) : null; };

async function importZipFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  if (typeof DecompressionStream === 'undefined') { toast('This phone’s browser is too old to unzip files (needs iOS 16.4 or later).'); return; }
  const latin1 = new TextDecoder('iso-8859-1');
  const done = new Set(FILES.files);
  const b = builder();
  await b.ensureKeys();
  let read = 0, ok = 0;
  const bad = [];
  const walk = async (buf) => {
    for (const entry of zipEntries(buf)) {
      const lower = entry.name.toLowerCase();
      if (lower.endsWith('.zip')) {
        await walk(await inflate(entry));
        const id = fileId(entry.name); if (id) done.add(id);
      } else if (lower.endsWith('.dat')) {
        read += parseDat(latin1.decode(await inflate(entry)), b);
      }
    }
  };
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    toast(`Reading ${f.name} (${i + 1} of ${files.length})…`);
    try {
      await walk(new Uint8Array(await f.arrayBuffer()));
      const id = fileId(f.name); if (id) done.add(id);
      ok++;
    } catch (e) { bad.push(f.name); console.warn(f.name, e); }
  }
  if (!ok) {
    const msg = `None of the ${files.length} selected file${files.length === 1 ? ' was a sales file' : 's were sales files'} (${bad.slice(0, 3).join(', ')}${bad.length > 3 ? ', …' : ''}). Open one in the Files app: a real one is a .zip of about 1–3 MB (weekly) or much larger (yearly).`;
    try { localStorage.setItem('nr-prices.lastImport', `${new Date().toLocaleString('en-AU')}: ${msg}`); } catch { /* ignore */ }
    toast(msg); renderImportStatus(); return;
  }
  toast('Saving…');
  try { await b.save([...done].sort(), new Date().toISOString()); } catch (e) {
    const msg = `Read ${ok} file${ok === 1 ? '' : 's'} (${read.toLocaleString('en-AU')} NSW sales) but could not save them on this phone: ${(e && (e.name || '') + ' ' + (e.message || '')).trim() || e}`;
    try { localStorage.setItem('nr-prices.lastImport', `${new Date().toLocaleString('en-AU')}: ${msg}`); } catch { /* ignore */ }
    toast(msg); renderImportStatus(); return;
  }
  derive(); render(); renderImportStatus();
  const msg = `Imported ${ok} file${ok === 1 ? '' : 's'}: ${read.toLocaleString('en-AU')} NSW sales read, ${b.added.toLocaleString('en-AU')} new${bad.length ? ` · ${bad.length} skipped (${bad.slice(0, 3).join(', ')}${bad.length > 3 ? ', …' : ''}: not a sales file)` : ''}`;
  try { localStorage.setItem('nr-prices.lastImport', `${new Date().toLocaleString('en-AU')}: ${msg}`); } catch { /* ignore */ }
  toast(msg); renderImportStatus();
}

const mondaysOf = (year, until) => {
  const out = [];
  for (let d = new Date(Date.UTC(year, 0, 1)); d <= until && d.getUTCFullYear() === year; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() === 1) out.push(d.toISOString().slice(0, 10).replace(/-/g, ''));
  }
  return out;
};
const historyStart = () => { try { return +localStorage.getItem('nr-prices.historyFrom') || 2024; } catch { return 2024; } };
// every file not yet imported: yearly files for past years, weekly files for this year
function missingFiles() {
  const have = new Set(FILES.files);
  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const year = today.getUTCFullYear();
  const urls = [];
  for (let y = historyStart(); y < year; y++) {
    if (have.has(`yearly/${y}`)) continue;
    // early in a new year the yearly file may not be out yet: fall back to its weekly files
    if (today.getUTCMonth() === 0 && y === year - 1) { for (const w of mondaysOf(y, today)) if (!have.has(`weekly/${w}`)) urls.push(`${VG_BASE}/weekly/${w}.zip`); continue; }
    urls.push(`${VG_BASE}/yearly/${y}.zip`);
  }
  for (const w of mondaysOf(year, today)) if (!have.has(`weekly/${w}`)) urls.push(`${VG_BASE}/weekly/${w}.zip`);
  return urls;
}

function renderImportStatus() {
  const box = $('#importStatus'); if (!box) return;
  const n = N;
  const weeks = FILES.files.filter((f) => f.startsWith('weekly/')).sort();
  const years = FILES.files.filter((f) => f.startsWith('yearly/')).map((f) => f.slice(7));
  const missing = missingFiles();
  let reimport = false; try { reimport = localStorage.getItem('nr-prices.reimport') === '1' && !FILES.files.length; } catch { /* ignore */ }
  box.textContent = reimport
    ? `${n.toLocaleString('en-AU')} Northern Rivers sales kept from before. The app now keeps all of NSW: import your sales files again (they're probably still in the NR Prices folder) to add the rest of the state. Nothing will be doubled up.`
    : n
    ? `${n.toLocaleString('en-AU')} sales imported on this phone${years.length ? ` · years ${years.join(', ')}` : ''}${weeks.length ? ` · latest week ${fmtDate(weeks[weeks.length - 1].slice(7))}` : ''}. ${missing.length ? `${missing.length} file${missing.length === 1 ? '' : 's'} still to download.` : 'Up to date.'}`
    : `No sales imported yet. ${missing.length} files to download to build your history (see the steps below).`;
  let last = ''; try { last = localStorage.getItem('nr-prices.lastImport') || ''; } catch { /* ignore */ }
  let lastErr = ''; try { lastErr = localStorage.getItem('nr-prices.lastError') || ''; } catch { /* ignore */ }
  $('#lastImport').textContent = [last && `Last import: ${last}`, lastErr && `Last error: ${lastErr}`].filter(Boolean).join(' — ');
  const hs = $('#historyFrom');
  if (hs && !hs.options.length) {
    const y = new Date().getFullYear();
    for (let k = y - 1; k >= 2016; k--) hs.append(el('option', { value: k }, `${k} (${y - k + 1} years)`));
    hs.value = String(historyStart());
    hs.addEventListener('change', () => { try { localStorage.setItem('nr-prices.historyFrom', hs.value); } catch { /* ignore */ } renderImportStatus(); });
  }
  const br = $('#regionBreakdown');
  if (br) {
    const counts = new Map();
    for (const [, c] of LOC_COUNTS) { const a = AREAS.find((x) => x.group !== 'Northern Rivers' && x.id !== 'nsw' && areaHas(x, c.pc)) || (areaHas(areaOf('all'), c.pc) ? areaOf('all') : null); const k = a ? a.name : 'Other'; counts.set(k, (counts.get(k) || 0) + c.n); }
    const parts = [...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n.toLocaleString('en-AU')}`);
    br.textContent = N ? `${DATA_INFO && DATA_INFO.needsReimport ? 'Import your files again (nothing will double up) so part-share sales can be left out. ' : ''}${DATA_INFO && DATA_INFO.excluded ? `${DATA_INFO.excluded.toLocaleString('en-AU')} token transfers and part-share sales left out. ` : ''}Sales by area: ${parts.join(' · ')}. Imported files: ${FILES.files.length ? FILES.files.length + ' (' + FILES.files.slice(0, 3).map((f) => f.replace(/^\w+\//, '')).join(', ') + (FILES.files.length > 3 ? ', …' : '') + ')' : 'none recorded'}.` : '';
  }
  const latest = missing.filter((u) => u.includes('/weekly/')).pop();
  const link = $('#latestFileLink');
  link.hidden = !latest;
  if (latest) { link.href = latest; link.textContent = `Download week of ${fmtDate(latest.match(/(\d{8})\.zip/)[1])}`; }
}

// monthly stats, optionally pooled over a rolling window of months
const monthlyCache = new WeakMap();
function monthly(list, smooth) {
  let memo = monthlyCache.get(list);
  if (!memo) monthlyCache.set(list, (memo = {}));
  if (!memo[smooth]) memo[smooth] = monthlyCalc(list, smooth);
  return memo[smooth];
}
function monthlyCalc(list, smooth) {
  const by = new Map();
  const earlyBy = new Map(); // sales from your sold alerts (not yet in the official records)
  for (const s of list) { const m = s.m; let a = by.get(m); if (!a) by.set(m, (a = [])); a.push(s.price); if (s.early) earlyBy.set(m, (earlyBy.get(m) || 0) + 1); }
  if (!by.size) return [];
  const ms = [...by.keys()].sort();
  const rows = [];
  for (let m = ms[0]; m <= ms[ms.length - 1]; m = addMonths(m, 1)) {
    const own = by.get(m) || [];
    let pool = own, pe = earlyBy.get(m) || 0;
    if (smooth > 1) { pool = []; pe = 0; for (let i = 0; i < smooth; i++) { const mm = addMonths(m, -i); pool = pool.concat(by.get(mm) || []); pe += earlyBy.get(mm) || 0; } }
    rows.push({ month: m, n: own.length, early: earlyBy.get(m) || 0, pooled: pool.length, pooledEarly: pe, median: median(pool), avg: mean(pool) });
  }
  return rows;
}
