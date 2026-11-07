// Loads the app's data and parsing files into a sandbox (no browser needed) so their functions can be tested.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// Only the files with no start-up screen work; their order matches index.html.
const FILES = ['core', 'sales-data', 'geo', 'idb', 'import-sales', 'charts', 'flood', 'listings'];

export function loadApp() {
  // a do-nothing stand-in for page elements, enough for code that only wires up buttons
  const stubEl = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : stubEl), apply: () => stubEl });
  const store = new Map();
  const sandbox = {
    console, Blob, Response, DecompressionStream, TextDecoder, URL, setTimeout, clearTimeout, structuredClone,
    window: { addEventListener() {} },
    document: { getElementById: () => null, querySelector: () => stubEl, querySelectorAll: () => [], addEventListener() {} },
    navigator: {},
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    indexedDB: undefined,
  };
  vm.createContext(sandbox);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(root, 'js', `${f}.js`), 'utf8'), sandbox, { filename: `js/${f}.js` });
  // names declared with const/let live in the shared scope: reach them through an expression
  return (expr) => vm.runInContext(expr, sandbox);
}
export const fixture = (name) => fs.readFileSync(path.join(root, 'tests', 'fixtures', name));
