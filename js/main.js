/* Northern Rivers Prices — Start-up: first render, loading data, offline support and update checks.
 * Part of the app; the files in js/ load in order and share one scope (see index.html). */
'use strict';

render();
loadSales().then(() => syncFeed({ quiet: true })); // then fetch any new alert emails
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});

// Is a newer version published? Offer a one-tap update (iPhones keep old copies of home-screen apps).
async function updateNow() {
  toast('Updating…');
  try {
    const regs = navigator.serviceWorker ? await navigator.serviceWorker.getRegistrations() : [];
    await Promise.all(regs.map((r) => r.unregister()));
    if (window.caches) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
  } catch { /* reload anyway */ }
  location.reload();
}
async function checkForUpdate() {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const { version } = await res.json();
    $('#versionInfo').textContent = `App version ${APP_VERSION}${version !== APP_VERSION ? ` · version ${version} is available` : ' · up to date'}`;
    if (version !== APP_VERSION) $('#updateBar').hidden = false;
  } catch { $('#versionInfo').textContent = `App version ${APP_VERSION} (offline)`; }
}
$('#updateBtn').addEventListener('click', updateNow);
$('#forceUpdate').addEventListener('click', updateNow);
$('#versionInfo').textContent = `App version ${APP_VERSION}`;
checkForUpdate();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });
