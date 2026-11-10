/* Northern Rivers Prices — Automatic alert-email feed: fetches new property alert emails collected by your
 * Google Apps Script (scripts/gmail-alert-collector.gs) and adds their listings, for sale and sold.
 * Part of the app; the files in js/ load in order and share one scope (see index.html). */
'use strict';

// Settings (on this phone only): { url, since, lastRun, lastCollect, lastError, last: { emails, listings, sold } }
const FEED_KEY = 'nr-prices.feed';
const feedCfg = () => readJson(FEED_KEY, {}) || {};
const saveFeedCfg = (c) => safeSet(FEED_KEY, JSON.stringify(c));
let feedSyncing = false;
const ymdFromMs = (ms) => { const t = new Date(ms); return t.getFullYear() * 10000 + (t.getMonth() + 1) * 100 + t.getDate(); };

async function syncFeed({ quiet = false } = {}) {
  const cfg = feedCfg();
  if (!cfg.url || feedSyncing) return false;
  feedSyncing = true;
  if (!quiet) toast('Checking your alert emails…');
  try {
    const u = new URL(cfg.url);
    u.searchParams.set('since', String(Math.max(0, (cfg.since || 0) - 6 * 3600e3))); // small overlap; emails are de-duplicated by id
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
    const seen = new Set(data.feedSeen || []);
    let emails = 0, listings = 0, sold = 0;
    for (const m of (j.messages || []).sort((a, b) => a.received - b.received)) {
      if (seen.has(m.id)) continue;
      const parsed = parseAlertLines(String(m.text || '').split('\n'), m.subject || '');
      const r = ingestAlert(data, parsed, ymdFromMs(m.received));
      data.files.push({ name: m.subject || 'Alert email', date: r.d, n: r.n, kind: parsed.kind, source: 'feed' });
      seen.add(m.id);
      emails++; listings += r.n - r.sold; sold += r.sold;
    }
    data.feedSeen = [...seen].slice(-5000);
    data.files = data.files.slice(-2000);
    Object.assign(cfg, { since: j.now || Date.now(), lastRun: Date.now(), lastCollect: j.lastCollect || null, lastError: null, last: { emails, listings, sold } });
    saveFeedCfg(cfg);
    if (emails) {
      LISTINGS = data;
      await saveListingsAndRefresh();
      toast(`From ${emails} new alert email${emails === 1 ? '' : 's'}: ${listings} listing${listings === 1 ? '' : 's'}${sold ? `, ${sold} sold` : ''}`);
    } else if (!quiet) toast('No new alert emails since the last check');
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
  if (!cfg.url) { box.textContent = 'Not connected. Follow the steps below once, and new alert emails come in by themselves.'; return; }
  const when = (ms) => (ms ? new Date(ms).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'never');
  const fromFeed = LISTINGS.files.filter((f) => f.source === 'feed').length;
  box.textContent = `Connected. Last checked ${when(cfg.lastRun)}${cfg.last ? ` (${cfg.last.emails} new email${cfg.last.emails === 1 ? '' : 's'})` : ''}. Your Google script last collected emails ${when(cfg.lastCollect)}. ${fromFeed.toLocaleString('en-AU')} alert emails read so far.${cfg.lastError ? ` Last problem: ${cfg.lastError}` : ''}`;
}

$('#feedConnect').addEventListener('click', async () => {
  const url = $('#feedUrl').value.trim().replace(/\/dev(\?|$)/, '/exec$1'); // /dev links only work in the script editor
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
