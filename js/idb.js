/* Northern Rivers Prices — IndexedDB key-value helpers.
 * Part of the app; the files in js/ load in order and share one scope (see index.html). */
'use strict';

// ---------- IndexedDB (imported sales can be a few MB: too big for localStorage) ----------
let dbPromise;
const idb = () => dbPromise || (dbPromise = new Promise((res, rej) => {
  const r = indexedDB.open('nr-prices', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
}));
async function idbGet(k) {
  try {
    const db = await idb();
    return await new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  } catch { return undefined; }
}
async function idbSet(k, v) {
  const db = await idb();
  return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}
