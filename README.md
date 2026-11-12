# Northern Rivers Prices

A phone app (installable web app) for tracking house prices around **Casino, Lismore, Evans Head,
Ballina** and the rest of the Northern Rivers.

## What it does

- **Saved searches.** Each search has an **area**, optional **locations** within it, **property types**
  and a **min/max price**. It starts with Casino, Lismore, Evans Head and Ballina, and you can add your own
  (e.g. "Casino acreage under $1m").
- **Property types:** House in town · Unit / townhouse · Vacant block (town) · Rural lifestyle / acreage ·
  Farm (40 ha+) · Commercial / other. These are worked out from zoning, land size, strata title and land use
  in the sales records (the rules are listed in the app's ⋯ menu).
- **Sold prices.** Monthly median and average with the number of sales, a 3-month rolling option,
  1/2/3-year charts, change against the same months a year earlier, and a list of every matching sale.
- **Compare** puts all your saved searches on one chart.
- **Listing (asking) prices** can be added by hand for any search and show as a dashed line.
- Works offline. Saved searches and listing prices stay on your phone (⋯ → Export backup).

## Where the sold prices come from

The **NSW Valuer General's bulk property sales information** is the official public record of every NSW sale
(contract date, price, street, locality, zoning, land area). The files are downloaded on the iPhone by
Shortcuts and imported in the app, which keeps **all of NSW** (about 200,000 sales a year) in a compact form
in the phone's storage. Sales take about 4–8 weeks to appear in the records, so the last two months are
marked as incomplete.

### Updating the data (from your iPhone)

The Valuer General's server refuses downloads from GitHub's servers, and a web app can't fetch files from
another site in the background. So **iPhone Shortcuts** download the files and the app imports them:

1. A **"NR Prices weekly"** shortcut runs every Tuesday morning and saves Monday's sales file into
   Files › iCloud Drive › Shortcuts › NR Prices.
2. A **"NR Prices catch-up"** shortcut downloads any list of files. **⋯ → Copy links of files still to
   download** puts the right list on the clipboard (the 2024 and 2025 yearly files plus this year's weeks).
3. **⋯ → Import sales files**, then select the files in that folder. Importing a file twice does no harm.

Step-by-step instructions are in the app under **⋯ → Set up the iPhone Shortcuts**.

## Areas

The Area list has the Northern Rivers towns plus NSW regions (Tweed & Byron, Mid North Coast, Newcastle &
Lake Macquarie, Greater Sydney, Riverina, …) and **All of NSW**. Regions are groups of postcodes, so their
edges are approximate; pick individual suburbs under **Locations** for precision.

## Map and parts of town

Sales are placed on the map using **G-NAF**, the free national address file (Geoscape Australia, open data on
data.gov.au). `scripts/build_geo.py` runs on GitHub every quarter, when G-NAF is updated, and writes:

- `data/geo.json`: **house-level** positions for the Northern Rivers (2469–2480) and **Newcastle & Lake
  Macquarie** (2264–2267, 2278, 2280–2308). Each sale is matched on street, house number and suburb.
- `data/suburbs.json`: one **suburb-level** position (the centre of its addresses) for every suburb in NSW.

In house-level areas each sale is a dot at its house. Elsewhere, sales are grouped into one bubble per suburb.
More areas can be made house-level by adding their postcodes to `HOUSE_POSTCODES` in the script (each region
adds a few MB).

In a search's **Filters**, use **Map area → Draw on map** to tap out the corners of an area, or drop a pin
and choose a distance. Small areas (up to about 30 km² or a 3 km radius) only count sales placed at their
house. Larger areas also count whole suburbs whose centre falls inside.

Map images © OpenStreetMap contributors. The map library (Leaflet) is bundled in `vendor/`.

## Flood levels (Lismore)

Lismore City Council publishes "Flood & Floor Levels" PDFs: for each listed address, the floor level and the
1-in-100-year flood level (metres AHD). In the app, **⋯ → Import council flood & floor levels (PDF)** reads the
table on the phone (pdf.js, bundled in `vendor/pdfjs/`) and keeps it on the phone only; nothing is published.
Sales at a listed address then show "Floor X m above/below the 1-in-100 flood level", and searches get a
**Flood** filter. The 2022 and 2017 floods are estimated per home from their peaks at the Lismore gauge
(about 14.37 m and 11.59 m AHD, against a gauge 1-in-100 level of 12.4 m) plus the home's own 1-in-100 level.
Floor levels date from 1996 onwards and may be out of date.
The map's **Flood layer** (Off / 1-in-100 / 2022 / 2017) draws a smoothed water surface: the depth over the floor
at each listed home, blended between neighbouring homes (within about 70 m) and blurred. It's a picture of the
council list, not a flood model. The map has a **Full screen** button.

## Trend lines

Charts can show straight-line trends (fitted to the log of the median, so the slope reads as % per year) over
the last 3 and 6 months and 1, 3 and 5 years (each switched on or off under the chart), leaving out the incomplete recent months. In Compare, each search gets one trend
over the range shown.

## Listings from property alert emails

**⋯ → Import a property alert email (PDF)** reads a Domain "Home Alert" email saved as a PDF (Gmail: ⋯ → Print →
pinch out → Share → Save to Files). Each listing's address, advertised price (ranges, price guides, "new price"
flags), bedrooms, bathrooms and car spaces are kept on the phone; importing again updates listings and records
price changes. Searches get a **For sale now** section and hollow map markers, and when a listed home later appears
in the Valuer General sales it shows bedrooms/bathrooms and how far the sale was over or under the asking price.

Each listing also shows: its previous sale and the change to today's asking price; comparable recent sales (same
suburb and kind, nearby, similar land when known); flood exposure from the council floor-level list; days on market;
price cuts; and whether it has sold (and for how much against asking). Listings can be starred and given notes;
a banner reports price changes and sales of starred homes. Each search gets a **Market activity** section (days on
market, sold vs asking, sold above the range, price cuts, new listings a week, months of supply, stale listings) and a
**Listed vs sold each month** chart, and the main chart gains a median asking price line.

### Automatic alert feed (Gmail → the app)

Alert emails can come in by themselves: any number of saved searches, for sale and sold, from Domain or
realestate.com.au. A small Google Apps Script (`scripts/gmail-alert-collector.gs`) runs **in your own Google
account** every hour. It finds alert emails from domain.com.au and realestate.com.au (the `SENDERS` list at the top; anything you
label **NR Prices** by hand is included too), saves a PDF copy of each to the
Drive folder **NR Prices alert emails**, keeps their text in the Sheet **NR Prices alert feed**, and labels them
**NR Prices** and **NR Prices/Collected**, then archives them out of your inbox (set `ARCHIVE = false` to keep
them there). Nothing is deleted. When the app opens (and when it comes back on screen, at most once an hour) it fetches new
emails from the script's private link and reads them. For-sale alerts add or update listings; sold alerts mark
homes as sold with the price straight away, weeks before the Valuer General record arrives. Emails are never read
twice. Setup steps are in the app under **⋯ → Listings → Automatic alert feed**. Keep the script's link private,
because it includes the key that protects your feed.

### Early sold prices from your alerts

Valuer General records arrive weeks after a sale. Until they do, homes reported sold (with a price) in your sold
alerts count in the recent, shaded months of the chart and table, and in an **Early figures** card, labelled as
coming from your alerts. The official records always come first: when a home's Valuer General record arrives it
replaces the alert sale (a different price is noted, and the official price is used), and an alert sale still
missing once its month is complete is left out and listed under the chart. Complete months, trend lines and the
headline comparison use the official records only.

## Put it on your phone

1. In the GitHub repo go to **Settings → Pages** and set **Source** to **GitHub Actions**.
   (Pages on a private repo needs a paid GitHub plan. On the free plan, make the repo public.)
2. Every push to the branch publishes the app at `https://<username>.github.io/<repo>/`.
3. Open that address on your phone. On iPhone, use Safari's Share button and then **Add to Home Screen**.
   On Android, use Chrome's ⋮ menu and then **Install app**.

## Costs

GitHub Actions and Pages are free for public repos. Private repos get 2,000 free Actions minutes a month,
and a daily run uses about 1–2 minutes. The Valuer General data is free.

## Files

- `index.html`, `styles.css`: the page and its styles.
- `js/`: the app, split by area. The files load in order (see the bottom of `index.html`) and share one scope:
  `core.js` (settings, reference data, helpers), `sales-data.js` (sold-sales store and filtering), `geo.js` (map positions),
  `idb.js`, `import-sales.js` (Valuer General files), `screen.js`, `charts.js`, `flood.js`, `listings.js`,
  `listing-insights.js`, `early-sales.js`, `alert-feed.js`, `market.js`, `resales.js`, `maps.js`, `filters.js`, `listing-entry.js`, `menu.js`, and `main.js` (start-up).
- `sw.js` + `manifest.webmanifest`: offline use and home-screen install. Bump `VERSION` in `sw.js`, `APP_VERSION` in
  `js/core.js` and `version.json` together when app files change.
- `tests/`: automated checks for the file readers (sales files, council flood PDFs, alert emails) and price maths, using
  made-up sample data. Run `node --test tests/*.test.mjs` (Node 22). GitHub runs them before every publish and won't
  publish if one fails.
- `scripts/build_geo.py`: builds the map positions on GitHub.
- `scripts/gmail-alert-collector.gs`: the Google Apps Script for the automatic alert feed (you paste it into your own Google account; it isn't published with the app).
