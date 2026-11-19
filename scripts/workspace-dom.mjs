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
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
// jsdom has no layout engine. Supply a deterministic visible viewport and
// observer interface so FlexLayout can mount and exercise its native tabsets.
Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {
  value: function () {
    return { x: 0, y: 0, left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 };
  },
});
window.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
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
  'FormData',
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
const transferRequests = [];
let accountScope = 'demo';
const characters = [{ id: 'sender', name: 'Fern', realm: 'Example' }, { id: 'alt', name: 'Ember', realm: 'Example' }];
const position = {
  itemId: 42, variant: '-2', binding: 'tradeable', asset: '42/-2/tradeable',
  economic: 8, physical: 8, knownUnits: 8, knownBasisCopper: '80', unknownUnits: 0,
  realisedKnownCopper: '0', unreconciledUnits: 0, locations: [], receipts: [], transactions: [],
};
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
  if (path === '/personal/characters') return Response.json({ scope: accountScope, characters });
  if (path === '/personal/positions') return Response.json({ scope: accountScope, positions: [position] });
  if (path === '/personal/transactions') {
    const tx = JSON.parse(options.body);
    transferRequests.push(tx);
    if (tx.scope !== accountScope) return Response.json({ error: 'Selected account changed' }, { status: 409 });
    if (transferRequests.length === 1) {
      position.transactions.push(tx);
      throw new Error('Connection lost after saving');
    }
    assert.deepEqual(tx, transferRequests[0], 'Retry must keep the same transfer and receipt time');
    return Response.json({ status: 'unchanged', id: tx.id });
  }
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
assert.equal(stored.version, 2);
assert.equal(stored.current.dock.layout.children.length, 2);
const separator = one('[role="separator"][aria-orientation="vertical"]');
assert.ok(separator, 'Native splitter exposes keyboard controls');
const before = stored.current.dock.layout.children[0].weight;
separator.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
await until(
  () => stored.current.dock.layout.children[0].weight !== before,
  'Keyboard split resize was not saved',
);
assert.equal(document.querySelectorAll('.workgroup').length, 2);
assert.equal(one('[data-farm-id="route-0"]').getAttribute('aria-pressed'), 'true');

function choose(select, value) {
  select.value = value;
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
}
choose(one('select.pane-menu'), 'Positions');
const transferSection = () => one('section[aria-label="Character transfers"]');
await until(() => transferSection()?.querySelector('button'), 'Positions did not offer the transfer action');
transferSection().closest('details').open = true;
transferSection().querySelector('button').click();
await until(() => transferSection().querySelector('form'), 'Transfer form did not open');
const transferForm = transferSection().querySelector('form');
const [sender, recipient] = transferForm.querySelectorAll('select');
choose(sender, 'sender');
await until(() => !recipient.querySelector('option[value="sender"]'), 'Sender must be excluded as a recipient');
choose(recipient, 'alt');
transferForm.elements.quantity.value = '3';
const confirm = transferForm.querySelector('button[type="submit"]');
await until(() => !confirm.disabled, 'Two characters are required');
confirm.click();
await until(() => transferSection().textContent.includes('Connection lost after saving'), 'Lost response should be visible');
confirm.click();
await until(() => !transferSection().querySelector('form') && transferSection().textContent.includes('Player-confirmed transfer'), 'Retried transfer is missing from history');
assert.equal(transferRequests.length, 2);
const tx = transferRequests[0];
assert.equal(tx.action, 'transfer');
assert.equal(tx.scope, 'demo');
assert.deepEqual([tx.owner, tx.recipient, tx.quantity, tx.itemId, tx.variant, tx.binding],
  ['sender', 'alt', 3, 42, '-2', 'tradeable']);
assert.ok(tx.id && Number.isSafeInteger(tx.at));
assert.equal(transferSection().querySelectorAll('p:not([role="status"])').length, 1);

// The same GUIDs may be imported under another account while the form is open.
transferSection().querySelector('button').click();
await until(() => transferSection().querySelector('form'), 'Second transfer form did not open');
const staleForm = transferSection().querySelector('form');
const [oldSender, oldRecipient] = staleForm.querySelectorAll('select');
choose(oldSender, 'sender');
choose(oldRecipient, 'alt');
staleForm.elements.quantity.value = '1';
accountScope = 'another-fixture-account';
position.transactions = [];
staleForm.querySelector('button[type="submit"]').click();
await until(() => transferRequests.length === 3 && !transferSection().querySelector('form'), 'Account change did not clear the stale draft');
assert.equal(transferRequests[2].scope, 'demo');
assert.equal(position.transactions.length, 0);
assert.ok(!transferSection().textContent.includes('Player-confirmed transfer'));
dom.window.close();
console.log(
  'Production UI DOM smoke passed: Atlas selection, split persistence and idempotent character-transfer retry.',
);
