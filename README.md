# Northern Rivers Prices

A small phone app (installable web app / PWA) for tracking house prices in
**Casino, Lismore, Evans Head and Ballina** month by month:

- **Median sold price**, **average sold price** and **average listing (asking) price**
- Optional number sold and active listings
- Trend chart per suburb (1Y / 2Y / 5Y / All), with change vs 12 months ago
- "Compare all" view to put the four towns on one chart
- Highlights months missing from the last two years so you know what to fill in
- Works offline; no account, no server — data stays on your phone
- Export / import backups (JSON or CSV) and paste CSV rows for bulk entry

## Put it on your phone

1. In the GitHub repo go to **Settings → Pages** and set **Source** to **GitHub Actions**.
   (GitHub Pages on a private repo needs a paid GitHub plan; otherwise make the repo public —
   your price data is *not* in the repo, it lives only on your phone.)
2. The included workflow (`.github/workflows/pages.yml`) publishes the site on every push.
   The address will be `https://<your-username>.github.io/<repo-name>/`.
3. Open that address on your phone:
   - **iPhone (Safari):** Share → **Add to Home Screen**
   - **Android (Chrome):** ⋮ menu → **Add to Home screen / Install app**

It then opens full-screen like a normal app and works without internet.

## Filling in the last couple of years

Typing 24 months × 4 towns by hand is tedious, so the fastest way is a spreadsheet:

1. Make a sheet with these columns (month is `YYYY-MM`):

   ```
   suburb,month,median,avgSold,avgListing,sales,listings,notes
   Ballina,2026-09,895000,930000,989000,31,142,Domain
   ```
2. Save as CSV and use **⋯ → Import backup or CSV**, or copy the rows and use **⋯ → Paste CSV rows**.

After that, add each new month with **+ Add month** (prices can be typed as `585000`, `$585,000` or `585k`).
Tap any row in the table to edit or delete it.

### Where to get the numbers

| Figure | Sources |
| --- | --- |
| Median sold | realestate.com.au / Domain suburb profiles, Cotality (CoreLogic) reports, NSW Valuer General property sales data |
| Average sold | Average the month's sold results on realestate.com.au or Domain, or NSW Valuer General sales data |
| Average listing | Average current "Buy" listing prices, or SQM Research asking prices |

Use the same source each month so the trend lines stay comparable.

## Backups

Data is kept in the browser storage of your phone. Use **⋯ → Export backup (JSON)** every so often
(e.g. save it to iCloud Drive / Google Drive). If you change phones, import that file on the new one.

## Files

`index.html`, `styles.css`, `app.js` — the app (plain HTML/CSS/JS, no build step).
`sw.js` + `manifest.webmanifest` — offline support and home-screen install.
When you change app files, bump `VERSION` in `sw.js` so phones fetch the update.
