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

`scripts/fetch_sales.py` downloads the **NSW Valuer General's bulk property sales information**. This is the
official public record of every NSW sale (contract date, price, street, locality, zoning, land area). It keeps
the Northern Rivers postcodes (2469–2480) from 2024 onwards and writes `data/sales.json`, which the app reads.

Sales take about 4–8 weeks to appear in the records, so the last two months are marked as incomplete.

### Updating the data (from your iPhone)

The Valuer General's server refuses downloads from GitHub's servers, and a web app can't fetch
files from another site in the background. So the files are downloaded by **iPhone Shortcuts**
and then imported into the app:

1. A **"NR Prices weekly"** shortcut runs automatically every Tuesday morning. It downloads Monday's
   sales file into Files › iCloud Drive › Shortcuts › NR Prices.
2. A **"NR Prices catch-up"** shortcut downloads any list of files. The app's **⋯ → Copy links of files
   still to download** button puts the right list on the clipboard. Use it the first time to build the
   history (the 2024 and 2025 yearly files plus this year's weeks) and whenever you've missed some weeks.
3. In the app, **⋯ → Import sales files**, then select the files in that folder. The app unzips them
   on the phone, keeps only Northern Rivers sales and merges them. Importing a file twice does no harm.

Step-by-step instructions for building both shortcuts are in the app under
**⋯ → Set up the iPhone Shortcuts**. Imported sales are stored on the phone (IndexedDB).

On a computer you can instead run `python3 scripts/fetch_sales.py`, which writes `data/sales.json`.
Pushing that file publishes it to everyone who uses the app, and the app merges it with anything
imported on the phone.

## Map and parts of town

Each sale is placed on the map by matching its street, house number and suburb against **G-NAF**, the free
national address file (Geoscape Australia, open data on data.gov.au). `scripts/build_geo.py` runs on GitHub
every quarter, when G-NAF is updated. It keeps the Northern Rivers addresses (about 65,000) and writes
`data/geo.json` (about 1.5 MB).

In a search's **Filters**, use **Map area → Draw on map** to tap out the corners of part of town, or drop a pin
and choose a distance. Only sales inside that area count. Sales that can't be placed (mostly lot-only rural
addresses) are left out of map-area searches, and the filter screen says how many.

Map images © OpenStreetMap contributors. The map library (Leaflet) is bundled in `vendor/`.

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
app files). `scripts/fetch_sales.py` is a computer-side downloader (optional). `data/` holds the sales data.
