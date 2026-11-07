// Automated checks for the parts of the app most likely to break: the readers for sales files,
// council flood PDFs and property alert emails, and the price maths. Run with:  node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, fixture } from './load-app.mjs';

const app = loadApp();

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
