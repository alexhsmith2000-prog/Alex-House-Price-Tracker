// Automated checks for the parts of the app most likely to break: the readers for sales files,
// council flood PDFs and property alert emails, and the price maths. Run with:  node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, loadCollector, fixture } from './load-app.mjs';

const app = loadApp();
// values made inside the sandbox have their own Array/Object types: compare plain copies
const plain = (x) => JSON.parse(JSON.stringify(x));

test('month and price helpers', () => {
  assert.equal(app('addMonths')('2025-11', 3), '2026-02');
  assert.equal(app('monthDiff')('2024-11', '2026-02'), 15);
  assert.equal(app('median')([5, 1, 3]), 3);
  assert.equal(app('median')([4, 1, 3, 2]), 2.5);
  assert.equal(app('median')([]), null);
  assert.equal(app('parsePrice')('$585,000'), 585000);
  assert.equal(app('parsePrice')('585k'), 585000);
  assert.equal(app('parsePrice')('1.2m'), 1200000);
  assert.ok(Number.isNaN(app('parsePrice')('abc')));
  assert.equal(app('parseMonth')('Mar 2026'), '2026-03');
  assert.equal(app('parseMonth')('2026/3'), '2026-03');
  assert.equal(app('fmtShort')(1250000), '$1.25m');
  assert.equal(app('fmtShort')(649000), '$649k');
});

test('street names: full and short forms match', () => {
  const norm = app('normStreet');
  assert.equal(norm('Centre Street'), 'CENTRE ST');
  assert.equal(norm('CENTRE ST'), 'CENTRE ST');
  assert.equal(norm('Ballina Road'), 'BALLINA RD');
  assert.equal(norm('Carrabeen Crescent'), 'CARRABEEN CRES');
});

test('property types from zoning, land size, strata and use', () => {
  const classify = app('classify');
  const base = { zone: 'R2', purpose: 'RESIDENCE', nature: 'R', strata: false, area: 650 };
  assert.equal(classify(base), 'house');
  assert.equal(classify({ ...base, strata: true }), 'unit');
  assert.equal(classify({ ...base, nature: 'V' }), 'land');
  assert.equal(classify({ ...base, zone: 'R5', area: 20000 }), 'lifestyle');
  assert.equal(classify({ ...base, zone: 'RU1', area: 500000 }), 'farm');
  assert.equal(classify({ ...base, zone: 'RU1', purpose: 'GRAZING', area: 150000 }), 'farm');
  assert.equal(classify({ ...base, zone: 'E4' }), 'other');
});

test('reads a Valuer General weekly file: nested zip, all fields, bad lines skipped', async () => {
  const zipEntries = app('zipEntries'), inflate = app('inflate'), parseDat = app('parseDat');
  const records = [];
  const collector = { put: (key, r) => records.push({ key, r }) };
  const walk = async (buf) => {
    for (const e of zipEntries(buf)) {
      if (e.name.toLowerCase().endsWith('.zip')) await walk(await inflate(e));
      else if (e.name.toLowerCase().endsWith('.dat')) parseDat(new TextDecoder('iso-8859-1').decode(await inflate(e)), collector);
    }
  };
  await walk(new Uint8Array(fixture('sales-week.zip')));
  assert.equal(records.length, 5, 'five valid sales, the malformed line is skipped');
  const byStreet = Object.fromEntries(records.map(({ r }) => [r[9], r]));
  const house = byStreet['SAMPLE ST'];
  assert.equal(house[0], 20251220); // contract date
  assert.equal(house[1], 'CASINO');
  assert.equal(house[2], '2470');
  assert.equal(house[3], 455000);
  assert.equal(house[4], 651); // 650.5 m² rounded
  assert.equal(house[12], '12'); // house number
  assert.equal(byStreet['EXAMPLE RD'][4], 452000, 'hectares converted to m²');
  assert.equal(byStreet['TEST AVE'][8], 1, 'strata lot recorded');
  assert.equal(byStreet['HALF ST'][13], 50, 'part-share sale keeps its % interest');
  assert.equal(app('propOfKey')(records[0].key), 1001);
});

test('part shares and token transfers are recognised', () => {
  const pct = app('interestPct');
  assert.equal(pct('100'), 100);
  assert.equal(pct(' 50 '), 50);
  assert.equal(pct(''), 0);
  assert.ok(app('MIN_PRICE') > 1);
});

test('council flood PDF rows: plain, ranges with spaces, unit/street numbers', () => {
  const parse = app('parseFloodLine');
  const a = parse('16 Ballina Road Lismore 8.723 8.397 8.858 Ampol Service Station 12.3');
  assert.deepEqual([a.num, a.street, a.suburb, a.floor, a.flood], ['16', 'BALLINA RD', 'LISMORE', 8.723, 12.3]);
  const b = parse('5 - 7 Carrington Street Lismore 10.425 10.18 10.33 Accountants 12.4');
  assert.equal(b.num, '5');
  const c = parse('2-3/101 Union Street South Lismore 11.217 11.021 11.362 Mowers 12.2');
  assert.deepEqual([c.num, c.suburb], ['101', 'SOUTH LISMORE']);
  const d = parse('124a Ballina Road Lismore 12.75 9.66 10.07 12.4');
  assert.equal(d.num, '124A');
  assert.equal(parse('4 . Note during a flood event the estimated flood height is measured'), null);
  assert.equal(parse('2017 Est. Flood Extent'), null);
});

test('2022 and 2017 flood estimates use each home’s own 1-in-100 level', () => {
  const over = app('overEvent');
  // floor 1.0 m below the home's 1-in-100 level; 2022 peaked about 1.97 m above the gauge's 1-in-100
  assert.ok(Math.abs(over(-1.0, 2022) - -2.97) < 0.01);
  assert.ok(Math.abs(over(-1.0, 2017) - -0.19) < 0.01);
});

test('advertised prices: single, range, guides, flags, no price', () => {
  const ask = app('parseAsking');
  assert.deepEqual({ ...ask('$650,000') }, { low: 650000, high: 650000, flag: '' });
  assert.deepEqual({ ...ask('$529,000 - $549,000') }, { low: 529000, high: 549000, flag: '' });
  assert.equal(ask('Price Guide $3,900,000').low, 3900000);
  assert.equal(ask('NEW PRICE $499,000').flag, 'New price');
  assert.equal(ask('PRICE RELEASE $1,180,000').flag, 'Price released');
  assert.equal(ask('Offers over $629k').low, 629000);
  assert.equal(ask('Contact agent').low, null);
});

test('alert email: date, featured and standard listings, units, flags', () => {
  app("LOC_COUNTS = new Map([['EVANS HEAD', { pc: '2473', n: 1 }], ['CASINO', { pc: '2470', n: 1 }], ['LISMORE', { pc: '2480', n: 1 }]])");
  const { date, listings } = app('parseAlertLines')([
    'Example Alert <noreply@example.com> Sat, Nov 7, 2026 at 5:48 PM',
    'Home Alert Sat, 07 Nov 2026',
    'A lovely home, 62B Sample Street offers relaxed living', // description text: not an address
    '$1,550,000',
    'Agent Name',
    '62B Sample Street, Evans Head Example Realty Evans', // featured listing: agency name follows the suburb
    'Head',
    '4 beds 2 baths 2 cars',
    '$220,000 - $242,000',
    '75/115 Example Street, Casino',
    'Details',
    '2 beds 1 bath 1 car',
    'NEW PRICE $499,000',
    '98 Sample Street, Lismore',
    'Details',
    '3 beds 1 bath 2 cars',
  ]);
  assert.equal(date, 20261107);
  assert.equal(listings.length, 3);
  const [f, u, n] = listings;
  assert.deepEqual([f.num, f.suburb, f.beds, f.baths, f.cars, f.priceText], ['62B', 'EVANS HEAD', 4, 2, 2, '$1,550,000']);
  assert.deepEqual([u.unit, u.num, u.suburb], ['75', '115', 'CASINO']);
  assert.equal(n.priceText, 'NEW PRICE $499,000');
});

test('trend line: steady 5% a year comes back as 5% a year', () => {
  const pts = [];
  for (let i = 0; i < 36; i++) pts.push({ month: app('addMonths')('2019-01', i), v: 500000 * Math.pow(1.05, i / 12) });
  const f = app('fitTrend')(pts, '2019-01', '2021-12', 6);
  assert.ok(Math.abs(f.yearly - 0.05) < 0.0005, `got ${f.yearly}`);
});

test('collector: email HTML becomes one line per row, cells joined, entities decoded', () => {
  const htmlToLines = loadCollector()('htmlToLines');
  const html = `<html><head><style>.x{}</style></head><body><table>
    <tr><td>$529,000&nbsp;-&nbsp;$549,000</td></tr>
    <tr><td><a href="#">123 Sample Street, Lismore</a></td><td>Details</td></tr>
    <tr><td><img src="bed.png">3 beds</td><td>2 baths</td><td>1 car</td></tr>
    <tr><td>Tom &amp; Jo&#39;s Realty</td></tr></table><p>Line one<br>Line two</p></body></html>`;
  assert.deepEqual(plain(htmlToLines(html)), ['$529,000 - $549,000', '123 Sample Street, Lismore Details', '3 beds 2 baths 1 car', 'Tom & Jo’s Realty', 'Line one', 'Line two']);
});

test('alert email: bedrooms, bathrooms and cars split over separate lines', () => {
  app("LOC_COUNTS = new Map([['LISMORE', { pc: '2480', n: 1 }], ['CASINO', { pc: '2470', n: 1 }]])");
  const { listings } = app('parseAlertLines')([
    'Home Alert Mon, 09 Nov 2026',
    '$650,000', '12 Sample Street, Casino', '4', 'beds', '4 beds', '2 baths', '1 car',
    '$480,000', '7 Example Road, Lismore', '3 beds', '1 bath', // no car line, next listing follows
    '$520,000', '9 Test Avenue, Lismore', '3 beds 2 baths',
  ]);
  assert.equal(listings.length, 3);
  assert.deepEqual(plain(listings.map((l) => [l.num, l.beds, l.baths, l.cars])), [['12', 4, 2, 1], ['7', 3, 1, null], ['9', 3, 2, null]]);
});

test('realestate.com.au alert: bare bed/bath/car numbers, postcodes, split suburbs, cells on one line', () => {
  app("LOC_COUNTS = new Map([['LISMORE', { pc: '2480', n: 1 }], ['SOUTH LISMORE', { pc: '2480', n: 1 }], ['PORT EXAMPLE', { pc: '2999', n: 1 }]])");
  const htmlToLines = loadCollector()('htmlToLines');
  // as the automatic feed sees it: price and agent cells on one row, then address, then icon cells with numbers
  const html = `<table><tr><td>$875,000</td><td>Sam Agent</td></tr><tr><td>76 Sample Street, Lismore 2480</td></tr>
    <tr><td><img alt=""></td><td>4</td><td><img alt=""></td><td>2</td><td><img alt=""></td><td>3</td></tr><tr><td>View Property</td></tr>
    <tr><td>Contact Agent Pat Agent 2/46 Example Road, South Lismore 2480</td></tr><tr><td>3</td></tr><tr><td>2</td></tr><tr><td>2</td></tr></table>`;
  const lines = [...htmlToLines(html),
    // as a saved PDF reads: the suburb runs onto the next line
    '$649,000 - $699,000', 'Jo Agent', '73 Test Road, Port', 'Example 2999', '3 1 2', 'View Property'];
  const parsed = app('parseAlertLines')(lines, 'Coming Soon properties: Alert for your "NSW" saved search');
  assert.equal(parsed.kind, 'sale');
  assert.ok(parsed.comingSoon);
  assert.deepEqual(plain(parsed.listings.map((l) => [l.unit, l.num, l.suburb, l.priceText, l.beds, l.baths, l.cars])), [
    ['', '76', 'LISMORE', '$875,000', 4, 2, 3],
    ['2', '46', 'SOUTH LISMORE', 'Contact Agent', 3, 2, 2],
    ['', '73', 'PORT EXAMPLE', '$649,000 - $699,000', 3, 1, 2],
  ]);
});

test('sold alert: recognised as sold, with sold price and date', () => {
  app("LOC_COUNTS = new Map([['LISMORE', { pc: '2480', n: 1 }]])");
  const parsed = app('parseAlertLines')([
    'Sold Alert Tue, 10 Nov 2026',
    'Here are properties that have recently sold',
    'SOLD $512,000', '15 Sample Street, Lismore', '3 beds 1 bath 1 car',
    'Sold 03 Nov 2026 Price withheld', '2/40 Example Road, Lismore', '2 beds 1 bath 1 car',
  ], 'Sold properties in Lismore');
  assert.equal(parsed.kind, 'sold');
  assert.equal(parsed.listings.length, 2);
  const [a, b] = parsed.listings;
  assert.ok(a.sold && b.sold);
  assert.equal(app('parseAsking')(a.priceText).low, 512000);
  assert.equal(b.soldDate, 20261103);
  assert.equal(b.unit, '2');
});

test('importing alerts: price history, sold reports, no duplicates', () => {
  app("LOC_COUNTS = new Map([['CASINO', { pc: '2470', n: 1 }]])");
  const data = app("({ recs: {}, files: [] })");
  const ingest = app('ingestAlert'), parse = app('parseAlertLines');
  ingest(data, parse(['Home Alert Mon, 02 Nov 2026', '$650,000', '12 Sample Street, Casino', '4 beds 2 baths 1 car']));
  ingest(data, parse(['Home Alert Mon, 02 Nov 2026', '$650,000', '12 Sample Street, Casino', '4 beds 2 baths 1 car'])); // same email again
  ingest(data, parse(['Home Alert Mon, 09 Nov 2026', 'NEW PRICE $615,000', '12 Sample Street, Casino', '4 beds 2 baths 1 car']));
  let r = data.recs['CASINO|SAMPLE ST|12|'];
  assert.equal(Object.keys(data.recs).length, 1);
  assert.deepEqual(plain(r.prices.map((p) => p.low)), [650000, 615000]);
  assert.equal(r.firstSeen, 20261102);
  ingest(data, parse(['Sold Alert Mon, 30 Nov 2026', 'SOLD $600,000', '12 Sample Street, Casino', '4 beds 2 baths 1 car'], 'Sold properties'));
  r = data.recs['CASINO|SAMPLE ST|12|'];
  assert.equal(r.soldAlert.price, 600000);
  assert.equal(r.prices.length, 2, 'the sold report does not change the asking history');
  ingest(data, parse(['Sold Alert Mon, 30 Nov 2026', 'SOLD $455,000', '3 Other Street, Casino', '3 beds 1 bath 1 car'], 'Sold properties'));
  const s = data.recs['CASINO|OTHER ST|3|'];
  assert.ok(s.soldOnly && s.prices.length === 0 && s.beds === 3);
});

test('the screen redraw calls every section (none commented out)', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../js/screen.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('function render()'), src.indexOf('\n}', src.indexOf('function render()')))
    .replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const fn of ['renderChart', 'renderMapPanel', 'renderListings', 'renderTable', 'renderResales', 'renderSalesList', 'renderWatchBar', 'renderMissingBar'])
    assert.ok(new RegExp(`\\b${fn}\\(\\)`).test(body), `render() should call ${fn}()`);
});

test('collector: receives weekly sales files from the Shortcut and hands them to the app', () => {
  // stand-ins for Google's services
  const props = new Map([['KEY', 'k1']]);
  const files = [];
  const mkFile = (name, bytes) => ({ name, bytes, trashed: false, getName() { return this.name; }, setTrashed(t) { this.trashed = t; },
    getBlob() { return { getBytes: () => this.bytes }; } });
  const folder = {
    getId: () => 'f1',
    createFile: (blob) => { files.push(mkFile(blob.name, blob.bytes)); },
    getFilesByName: (n) => { const l = files.filter((f) => !f.trashed && f.name === n); let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; },
    getFiles: () => { const l = files.filter((f) => !f.trashed); let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; },
  };
  const g = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }) },
    DriveApp: { getFolderById: () => folder, createFolder: () => folder },
    Utilities: {
      base64Decode: (t) => [...Buffer.from(t, 'base64')].map((b) => (b > 127 ? b - 256 : b)),
      base64Encode: (b) => Buffer.from(b.map((x) => x & 255)).toString('base64'),
      newBlob: (bytes, type, name) => ({ bytes, type, name }),
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => JSON.parse(t) }) },
  };
  const gs = loadCollector(g);
  const zip = Buffer.concat([Buffer.from('PK'), Buffer.alloc(2000, 7)]).toString('base64');
  const post = (q, body) => gs('doPost')({ parameter: q, postData: { contents: body } });
  assert.equal(post({ key: 'bad', name: '20261109.zip' }, zip).ok, false);
  assert.match(post({ key: 'k1', name: 'whatever.zip' }, zip).error, /name=/);
  assert.match(post({ key: 'k1', name: '20261109.zip' }, Buffer.from('<html>not published</html>' + 'x'.repeat(2000)).toString('base64')).error, /isn't a zip/);
  const ok = post({ key: 'k1', name: '20261109.zip' }, zip);
  assert.equal(ok.ok, true); assert.equal(ok.bytes, 2002);
  post({ key: 'k1', name: '20261109.zip' }, zip); // sent twice: replaced, not doubled
  post({ key: 'k1', name: '20261102.zip' }, zip);
  const sheetless = gs('salesFiles_')().map((f) => f.getName());
  assert.deepEqual(plain(sheetless), ['20261109.zip', '20261102.zip']);
  const got = gs('doGet')({ parameter: { key: 'k1', sales: 'file', name: '20261109.zip' } });
  assert.equal(got.ok, true);
  assert.equal(Buffer.from(got.data, 'base64').subarray(0, 2).toString(), 'PK');
  assert.equal(Buffer.from(got.data, 'base64').length, 2002);
});

test('missing sales files: this week only counts as missing from Wednesday', () => {
  app("var RealDate = Date; var realMissing = missingFiles; missingFiles = () => ['https://x/__psi/yearly/2025.zip', 'https://x/__psi/weekly/20261102.zip', 'https://x/__psi/weekly/20261109.zip']; 0");
  const on = (iso) => { app(`Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super('${iso}'); } }; 0`); return plain(app('overdueFiles()')).map((u) => u.split('/').pop()); };
  try {
    assert.deepEqual(on('2026-11-10T09:00:00'), ['2025.zip', '20261102.zip']);                 // Tuesday: Monday's file not overdue yet
    assert.deepEqual(on('2026-11-11T09:00:00'), ['2025.zip', '20261102.zip', '20261109.zip']); // Wednesday: it is
  } finally { app('Date = RealDate; missingFiles = realMissing; 0'); }
});
