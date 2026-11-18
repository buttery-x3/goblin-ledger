// Exercise the built production bundle in a simulated DOM, without a browser driver.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { makeLayout } from '../apps/web/src/workspace-model.js';

const base = new URL('../dist/', import.meta.url);
const html = await readFile(new URL('index.html', base), 'utf8');
const entry = html.match(/src=["']\/assets\/([^"']+\.js)["']/)?.[1];
assert.ok(entry, 'Production shell must contain its JavaScript asset');
const dom = new JSDOM(html, { url: 'http://127.0.0.1/', pretendToBeVisual: true });
const { window } = dom;
for (const key of [
  'window',
  'document',
  'HTMLElement',
  'HTMLDialogElement',
  'navigator',
  'MutationObserver',
  'CustomEvent',
  'Event',
  'Node',
]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: key === 'window' ? window : window[key],
  });
}
class LocalEvents {
  constructor() {
    queueMicrotask(() => this.onopen?.());
  }
  close() {}
}
globalThis.EventSource = LocalEvents;
const routes = ['West cave', 'East cave'].map((name, i) => ({
  id: 'route-' + i,
  name,
  zone: 'The Hinterlands',
  type: 'Gathering',
  output: 'Example herb',
  outputId: 1,
  revision: 1,
  sessionGoldCopper: 0,
  rateCopperPerHour: i ? null : 0,
  yieldBasis: 'Fixture',
  geometry: { space: 'world-schematic', precision: 'Approximate locality', x: 76 + i * 3, y: 43 + i * 2 },
}));
let stored = { version: 1, current: makeLayout('single'), named: [] };
let saves = 0;
globalThis.fetch = async (url, options = {}) => {
  const path = String(url).replace('/api/v1', '');
  if (path === '/bootstrap')
    return Response.json({ token: 'test', mode: 'demo', region: 'us', workspace: stored, routes });
  if (path === '/workspace') {
    assert.equal(options.headers.get('X-Goblin-Profile'), 'demo:us');
    stored = JSON.parse(options.body).workspace;
    saves++;
    return Response.json({ saved: true });
  }
  if (path === '/farms/compare') return Response.json({ routes });
  if (path === '/personal/characters') return Response.json({ characters: [] });
  throw new Error('Unexpected DOM fixture request ' + path);
};
const until = async (check, message) => {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(message);
};
await import(new URL('assets/' + entry, base));
const one = (selector) => document.querySelector(selector);
await until(() => one('[data-farm-id="route-1"]'), 'Atlas did not mount');
one('[data-farm-id="route-1"]').dispatchEvent(
  new window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }),
);
await until(
  () => one('.farm-detail h3')?.textContent === 'East cave',
  'Keyboard selection did not open target Farms detail',
);
assert.equal(document.querySelectorAll('.workgroup').length, 2);
one('[data-farm-id="route-0"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await until(
  () => one('.farm-detail h3')?.textContent === 'West cave',
  'Same-zone route selected wrong detail',
);
await until(
  () => saves > 0 && stored.current.selectedRoute === 'route-0',
  'Layout did not save the selection',
);
assert.equal(stored.current.preset, 'pair');
assert.equal(document.querySelectorAll('.workgroup').length, 2);
assert.equal(one('[data-farm-id="route-0"]').getAttribute('aria-pressed'), 'true');
dom.window.close();
console.log(
  'Production UI DOM smoke passed: keyboard activation, distinct same-zone routes, split creation, detail, reuse and profile-bound persistence.',
);
