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
**Flood** filter. Floor levels date from 1996 onwards and may be out of date.

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

`index.html`, `styles.css`, `app.js` make up the app (plain HTML/CSS/JS, no build step). `sw.js` and
`manifest.webmanifest` provide offline use and home-screen install (bump `VERSION` in `sw.js` after changing
app files). `scripts/build_geo.py` builds the map positions on GitHub. `data/` holds the sales data.
