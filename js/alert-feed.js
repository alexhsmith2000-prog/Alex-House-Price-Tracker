/* Northern Rivers Prices — Automatic alert-email feed: fetches new property alert emails collected by your
 * Google Apps Script (scripts/gmail-alert-collector.gs) and adds their listings, for sale and sold.
 * Part of the app; the files in js/ load in order and share one scope (see index.html). */
'use strict';

// Settings (on this phone only): { url, since, lastRun, lastCollect, lastError, last: { emails, listings, sold } }
const FEED_KEY = 'nr-prices.feed';
const feedCfg = () => readJson(FEED_KEY, {}) || {};
const saveFeedCfg = (c) => safeSet(FEED_KEY, JSON.stringify(c));
let feedSyncing = false;
let salesWaiting = [];
// Weekly sales files your iPhone Shortcut sent to your Google script: fetch the ones not imported yet and import them.
async function importFeedSales(feedUrl, names) {
  const files = [];
  for (const name of names.slice(0, 12)) {
    toast(`Fetching sales file ${name} from your Google script…`);
    try {
      const u = new URL(feedUrl); u.searchParams.delete('since'); u.searchParams.delete('collect');
      u.searchParams.set('sales', 'file'); u.searchParams.set('name', name);
      const j = await (await fetch(u.toString(), { cache: 'no-store' })).json();
      if (!j.ok || !j.data) continue;
      const bin = atob(j.data), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      files.push(new File([bytes], name, { type: 'application/zip' }));
    } catch (e) { console.warn('sales file', name, e); }
  }
  if (files.length) await importZipFiles(files);
  const cfg = feedCfg(); cfg.lastSales = { at: Date.now(), names: files.map((f) => f.name) }; saveFeedCfg(cfg);
}
// Bump when the email reader improves: the app then reads every collected email again once.
const FEED_READER = 2;
const ymdFromMs = (ms) => { const t = new Date(ms); return t.getFullYear() * 10000 + (t.getMonth() + 1) * 100 + t.getDate(); };

async function syncFeed({ quiet = false } = {}) {
  const cfg = feedCfg();
  if (!cfg.url || feedSyncing) return false;
  feedSyncing = true;
  if (!quiet) toast('Checking your alert emails…');
  try {
    const u = new URL(cfg.url);
    const reread = cfg.reader !== FEED_READER, before = !!cfg.since;
    u.searchParams.set('collect', '1'); // newer scripts collect new emails first instead of waiting for the hourly run
    u.searchParams.set('since', reread ? '0' : String(Math.max(0, (cfg.since || 0) - 6 * 3600e3))); // small overlap; emails are de-duplicated by id
    let res;
    try { res = await fetch(u.toString(), { cache: 'no-store' }); }
    catch (e) { throw new Error('Google didn’t let the app in. In the script, Deploy → Manage deployments → ✏️ → Who has access must be “Anyone”, and the link must end in /exec?key=…'); }
    if (!res.ok) throw new Error(`Google answered ${res.status}${res.status === 404 ? ' (no web app at that link; check it was copied in full and the deployment still exists)' : ''}`);
    const body = await res.text();
    let j;
    try { j = JSON.parse(body); }
    catch (e) { throw new Error(/sign ?in|accounts\.google/i.test(body) ? 'Google asked for a sign-in. Set Who has access to “Anyone” (Deploy → Manage deployments → ✏️), and use the /exec link, not /dev' : 'the link answered with a web page instead of your feed. Use the Web app link ending in /exec?key=…'); }
    if (!j.ok) throw new Error(j.error || 'the feed refused the request');
    const data = structuredClone(LISTINGS);
    if (reread) data.files = data.files.filter((f) => f.source !== 'feed');
    const seen = new Set(reread ? [] : data.feedSeen || []);
    let emails = 0, listings = 0, sold = 0;
    for (const m of (j.messages || []).sort((a, b) => a.received - b.received)) {
      if (seen.has(m.id)) continue;
      const parsed = parseAlertLines(String(m.text || '').split('\n'), m.subject || '');
      const r = ingestAlert(data, parsed, ymdFromMs(m.received));
      data.files.push({ name: m.subject || 'Alert email', date: r.d, n: r.n, kind: parsed.kind, source: 'feed', from: String(m.from || '').replace(/\s*<.*$/, '').replace(/"/g, '') });
      seen.add(m.id);
      emails++; listings += r.n - r.sold; sold += r.sold;
    }
    data.feedSeen = [...seen].slice(-5000);
    salesWaiting = Array.isArray(j.sales) ? j.sales.filter((n) => fileId(n) && !FILES.files.includes(fileId(n))) : [];
    data.files = data.files.slice(-2000);
    Object.assign(cfg, { reader: FEED_READER, since: j.now || Date.now(), lastRun: Date.now(), lastCollect: j.lastCollect || null, lastError: null, last: { emails, listings, sold } });
    saveFeedCfg(cfg);
    if (emails && reread && before) {
      LISTINGS = data;
      await saveListingsAndRefresh();
      toast(`Read your ${emails} alert emails again with the improved reader: ${listings} listing${listings === 1 ? '' : 's'}${sold ? `, ${sold} sold` : ''}`);
    } else if (emails) {
      LISTINGS = data;
      await saveListingsAndRefresh();
      toast(`From ${emails} new alert email${emails === 1 ? '' : 's'}: ${listings} listing${listings === 1 ? '' : 's'}${sold ? `, ${sold} sold` : ''}`);
    } else if (!quiet && !salesWaiting.length) toast('No new alert emails since the last check');
    if (salesWaiting.length) await importFeedSales(u, salesWaiting.slice().sort());
    return true;
  } catch (e) {
    cfg.lastError = `${new Date().toLocaleString('en-AU')}: ${e.message || e}`;
    saveFeedCfg(cfg);
    if (!quiet) toast(`Couldn't reach your alert feed: ${e.message || e}`);
    return false;
  } finally {
    feedSyncing = false;
    renderFeedStatus();
  }
}

function renderFeedStatus() {
  const box = $('#feedStatus'); if (!box) return;
  const cfg = feedCfg();
  $('#feedConnected').hidden = !cfg.url;
  $('#feedSetup').hidden = !!cfg.url;
  if (!cfg.url) { $('#feedRecent').replaceChildren(); box.textContent = 'Not connected. Follow the steps below once, and new alert emails come in by themselves.'; return; }
  const when = (ms) => (ms ? new Date(ms).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'never');
  const fromFeed = LISTINGS.files.filter((f) => f.source === 'feed').length;
  const recent = LISTINGS.files.filter((f) => f.source === 'feed').slice(-8).reverse();
  $('#feedRecent').replaceChildren(...recent.map((f) => el('li', { class: f.n ? '' : 'none' },
    `${fmtDate(f.date)} · ${f.from ? `${f.from}: ` : ''}${f.name} · `, el('b', {}, f.n ? `${f.n} ${f.kind === 'sold' ? 'sold' : 'listings'}` : 'no listings found'))));
  const ls = cfg.lastSales && cfg.lastSales.names.length ? ` Last sales file from your Shortcut: ${cfg.lastSales.names[cfg.lastSales.names.length - 1]} (imported ${when(cfg.lastSales.at)}).` : '';
  box.textContent = `Connected. Last checked ${when(cfg.lastRun)}${cfg.last ? ` (${cfg.last.emails} new email${cfg.last.emails === 1 ? '' : 's'})` : ''}. Your Google script last collected emails ${when(cfg.lastCollect)}. ${fromFeed.toLocaleString('en-AU')} alert emails read so far.${ls}${cfg.lastError ? ` Last problem: ${cfg.lastError}` : ''}`;
}

$('#feedConnect').addEventListener('click', async () => {
  const url = $('#feedUrl').value.trim();
  // /dev links only work inside the script editor, and their code differs from the real web-app link
  if (/\/dev(\?|$)/.test(url)) {
    $('#feedStatus').textContent = 'That’s the editor-only /dev link, which the app can’t use. In the script: Deploy → Manage deployments → copy the Web app URL (it ends in /exec), then add ?key= and your key (the part after key= in this link).';
    return;
  }
  if (!/^https:\/\/script\.google(usercontent)?\.com\/.+key=/.test(url)) return toast('That doesn’t look like your script’s link. It starts with https://script.google.com/ and ends with ?key=…');
  saveFeedCfg({ url });
  if (await syncFeed()) { $('#feedUrl').value = ''; return; }
  // the first check failed: don't stay connected to a link that doesn't work
  const err = feedCfg().lastError;
  safeSet(FEED_KEY, '{}');
  renderFeedStatus();
  $('#feedStatus').textContent = `That link didn’t work: ${String(err || '').replace(/^.*?(am|pm): /, '')}.`;
});
$('#feedSync').addEventListener('click', () => syncFeed());
$('#feedDisconnect').addEventListener('click', () => {
  if (!confirm('Disconnect the automatic alert feed? Listings already imported stay.')) return;
  safeSet(FEED_KEY, '{}');
  renderFeedStatus();
});
// check again when the app comes back to the screen, at most once an hour
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const cfg = feedCfg();
  if (cfg.url && Date.now() - (cfg.lastRun || 0) > 3600e3) syncFeed({ quiet: true });
});
