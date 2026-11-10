/**
 * Northern Rivers Prices — property alert email collector (Google Apps Script).
 *
 * Runs in YOUR Google account, not on any server of ours. Every hour it:
 *   1. finds new property alert emails from the senders listed in SENDERS (and anything you label "NR Prices"),
 *   2. saves a PDF copy of each email to the Google Drive folder "NR Prices alert emails",
 *   3. records the email's text in the Google Sheet "NR Prices alert feed",
 *   4. labels the email "NR Prices" and "NR Prices/Collected" (so it isn't collected twice) and, if ARCHIVE
 *      is true, archives it out of your inbox. Nothing is deleted.
 * The app then fetches new emails from this script's web address (protected by a secret key)
 * and reads the listings itself, so improvements to the reading happen in the app, not here.
 *
 * Setup (once): paste this file into a new Apps Script project, run setup(), deploy as a web app
 * (Execute as: Me, Who has access: Anyone), then run showAppLink() and paste the link into the app.
 */

const SENDERS = ['domain.com.au', 'realestate.com.au']; // add other alert senders here
const ARCHIVE = true;                      // false keeps collected alerts in your inbox
const LOOK_BACK_DAYS = 60;                 // how far back to look for emails not yet collected
const LABEL = 'NR Prices';                 // collected alerts get this label (you can also add it by hand)
const DONE_LABEL = 'NR Prices/Collected';  // added once an email has been collected
const FOLDER_NAME = 'NR Prices alert emails';
const SHEET_TITLE = 'NR Prices alert feed';
const MAX_TEXT = 45000;                    // a Sheets cell holds up to 50,000 characters

function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('KEY')) props.setProperty('KEY', Utilities.getUuid().replace(/-/g, ''));
  sheet_();
  folder_();
  if (!GmailApp.getUserLabelByName(LABEL)) GmailApp.createLabel(LABEL);
  if (!GmailApp.getUserLabelByName(DONE_LABEL)) GmailApp.createLabel(DONE_LABEL);
  // one hourly trigger
  for (const t of ScriptApp.getProjectTriggers()) if (t.getHandlerFunction() === 'collect') ScriptApp.deleteTrigger(t);
  ScriptApp.newTrigger('collect').timeBased().everyHours(1).create();
  const n = collect();
  Logger.log(`Set up. Collected ${n} email(s) so far. Next: Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone), then run showAppLink().`);
}

/** Collects new alert emails. Runs every hour (and from setup). Returns how many were collected. */
function collect() {
  const props = PropertiesService.getScriptProperties();
  const sh = sheet_();
  const folder = folder_();
  const done = GmailApp.getUserLabelByName(DONE_LABEL) || GmailApp.createLabel(DONE_LABEL);
  const seen = new Set(sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map((r) => String(r[0])) : []);
  const label = GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL);
  // Gmail search uses hyphens for spaces and slashes in label names
  const query = `{from:(${SENDERS.join(' OR ')}) label:${slug_(LABEL)}} -label:${slug_(DONE_LABEL)} newer_than:${LOOK_BACK_DAYS}d`;
  let collected = 0;
  for (let start = 0; start < 500; start += 50) {
    const threads = GmailApp.search(query, start, 50);
    if (!threads.length) break;
    for (const thread of threads) {
      for (const msg of thread.getMessages()) {
        const id = msg.getId();
        if (seen.has(id)) continue;
        const html = msg.getBody();
        const text = htmlToLines(html).join('\n').slice(0, MAX_TEXT);
        sh.appendRow([id, msg.getDate().getTime(), msg.getFrom(), msg.getSubject(), text]);
        seen.add(id);
        try {
          const name = `${Utilities.formatDate(msg.getDate(), Session.getScriptTimeZone(), 'yyyy-MM-dd HHmm')} ${msg.getSubject()}`.replace(/[\\/:*?"<>|]/g, ' ').slice(0, 120);
          folder.createFile(Utilities.newBlob(html, 'text/html', `${name}.html`).getAs('application/pdf').setName(`${name}.pdf`));
        } catch (e) { console.warn(`PDF copy failed for ${id}: ${e}`); }
        collected++;
      }
      thread.addLabel(label);
      thread.addLabel(done);
      if (ARCHIVE) thread.moveToArchive();
    }
    if (threads.length < 50) break;
  }
  props.setProperty('LAST_COLLECT', String(Date.now()));
  return collected;
}

/** Turns an email's HTML into lines of text, one line per table row or paragraph. */
function htmlToLines(html) {
  let s = String(html || '');
  s = s.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|tr|h[1-6]|li|table|tbody|thead|section|article|header|footer)>/gi, '\n');
  s = s.replace(/<(td|th)\b[^>]*>/gi, ' ');   // cells on one row stay on one line
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;|&rsquo;|&#8217;/gi, '’').replace(/&ndash;|&#8211;/gi, '–').replace(/&mdash;|&#8212;/gi, '—')
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)));
  return s.split(/\n/).map((l) => l.replace(/[ \t\r\f\v​ ]+/g, ' ').trim()).filter(Boolean);
}

/** The app calls this web address to fetch emails collected after a given time. */
function doGet(e) {
  const key = PropertiesService.getScriptProperties().getProperty('KEY');
  const p = (e && e.parameter) || {};
  if (!key || p.key !== key) return json_({ ok: false, error: 'wrong or missing key' });
  const since = Number(p.since || 0);
  const sh = sheet_();
  const rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues() : [];
  const messages = rows.filter((r) => Number(r[1]) > since).slice(-400)
    .map((r) => ({ id: String(r[0]), received: Number(r[1]), from: String(r[2]), subject: String(r[3]), text: String(r[4]) }));
  return json_({ ok: true, now: Date.now(), lastCollect: Number(PropertiesService.getScriptProperties().getProperty('LAST_COLLECT') || 0), messages });
}

/** Run after deploying: shows the link to paste into the app (keep it private). */
function showAppLink() {
  const url = ScriptApp.getService().getUrl();
  if (!url) { Logger.log('Deploy the script as a web app first (Deploy → New deployment → Web app).'); return; }
  Logger.log(`Paste this into the app (⋯ → Listings → Connect automatic alert feed):\n${url}?key=${PropertiesService.getScriptProperties().getProperty('KEY')}`);
}

function sheet_() {
  const props = PropertiesService.getScriptProperties();
  let ss = null;
  const id = props.getProperty('SHEET_ID');
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create(SHEET_TITLE);
    props.setProperty('SHEET_ID', ss.getId());
    ss.getSheets()[0].getRange(1, 1, 1, 5).setValues([['email id', 'received (ms)', 'from', 'subject', 'text']]);
  }
  return ss.getSheets()[0];
}
function folder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* recreate */ } }
  const f = DriveApp.createFolder(FOLDER_NAME);
  props.setProperty('FOLDER_ID', f.getId());
  return f;
}
function slug_(label) { return label.toLowerCase().replace(/[\s/]+/g, '-'); }
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
