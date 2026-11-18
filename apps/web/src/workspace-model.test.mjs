import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activate,
  addTab,
  closeTab,
  makeLayout,
  makeWorkspace,
  moveTab,
  openTool,
  patchPane,
  restoreWorkspace,
  saveNamed,
  selectFarm,
  validLayout,
} from './workspace-model.js';

const active = (g) => g.tabs.find((t) => t.id === g.active);
const groupWith = (layout, type) => layout.groups.find((g) => active(g)?.type === type);

test('all four arrangements round-trip including extent, filters and named layouts', () => {
  for (const preset of ['single', 'pair', 'terminal', 'eight']) {
    const current = patchPane(makeLayout(preset), 'tab-0', { extent: [400, 321, 2], overlay: 'coverage' });
    const saved = saveNamed({ ...makeWorkspace(), current }, 'My desk');
    const restored = restoreWorkspace(JSON.parse(JSON.stringify(saved)));
    assert.deepEqual(restored.current, current);
    assert.deepEqual(restored.named[0].layout, current);
    assert.equal(restored.named[0].name, 'My desk');
  }
});

test('last visible Farms receives each distinct route and preserves filters, Atlas and scanner state', () => {
  let layout = makeLayout();
  layout = patchPane(layout, 'tab-0', { extent: [160, 80, 3] });
  layout = patchPane(layout, 'tab-2', { sort: 'volume', selectedItem: 7046 });
  layout = addTab(layout, 'group-3', 'Farms');
  const secondId = layout.groups[3].active;
  layout = patchPane(layout, secondId, { filter: 'dungeons' });
  layout = activate(layout, 'group-0', 'tab-0');
  for (const id of ['take-west', 'take-east', 'take-east']) {
    layout = selectFarm(layout, id, 'tab-0');
    assert.equal(active(layout.groups[3]).selectedRoute, id);
    assert.equal(active(layout.groups[3]).revealRoute, id);
    assert.equal(active(layout.groups[3]).filter, 'dungeons');
    assert.equal(active(layout.groups[1]).selectedRoute, undefined);
    assert.deepEqual(active(layout.groups[2]), {
      id: 'tab-2',
      type: 'Opportunities',
      sort: 'volume',
      selectedItem: 7046,
    });
    assert.deepEqual(active(layout.groups[0]).extent, [160, 80, 3]);
  }
  assert.equal(layout.groups[3].tabs.length, 2);
});

test('existing hidden side tab wins over creating a new pane', () => {
  let layout = addTab(makeLayout('pair'), 'group-1', 'Markets');
  layout = selectFarm(layout, 'cave-2', 'tab-0');
  assert.equal(layout.groups[1].active, 'tab-1');
  assert.equal(layout.groups[1].tabs.length, 2);
});

test('a Farms sibling behind Atlas moves into an empty side viewport without hiding Atlas', () => {
  let layout = makeLayout();
  layout = moveTab(layout, 'group-1', 'tab-1', 'group-0');
  layout = activate(layout, 'group-0', 'tab-0');
  layout = selectFarm(layout, 'cave-1', 'tab-0');
  assert.equal(active(layout.groups[0]).type, 'Atlas');
  assert.equal(active(layout.groups[1]).id, 'tab-1');
  assert.equal(layout.groups.flatMap((g) => g.tabs).filter((t) => t.type === 'Farms').length, 1);
});

test('empty groups precede recency; a full layout uses the last active side group', () => {
  let layout = closeTab(makeLayout(), 'group-1', 'tab-1');
  layout = activate(layout, 'group-3', 'tab-3');
  let chosen = selectFarm(layout, 'empty', 'tab-0');
  assert.equal(active(chosen.groups[1]).selectedRoute, 'empty');
  layout = addTab(layout, 'group-1', 'Markets');
  layout = activate(layout, 'group-3', 'tab-3');
  chosen = selectFarm(layout, 'full', 'tab-0');
  assert.equal(active(chosen.groups[3]).selectedRoute, 'full');
  assert.equal(active(chosen.groups[2]).type, 'Opportunities');
});

test('a solo maximized Atlas creates a right split; reverse selection updates only the linked route', () => {
  let layout = { ...makeLayout('single'), maximized: 'group-0' };
  layout = selectFarm(layout, 'north', 'tab-0');
  assert.equal(layout.preset, 'pair');
  assert.equal(layout.groups.length, 2);
  assert.equal(layout.maximized, null);
  assert.equal(active(layout.groups[0]).type, 'Atlas');
  const farms = groupWith(layout, 'Farms');
  const reversed = selectFarm(layout, 'south', farms.active);
  assert.equal(reversed.selectedRoute, 'south');
  assert.equal(active(reversed.groups[1]).selectedRoute, 'south');
  assert.deepEqual(reversed.groups[0], layout.groups[0]);
  assert.deepEqual(reversed.recentGroups, layout.recentGroups);
});

test('tab reordering and transfer preserve pane settings and activate destination', () => {
  let layout = addTab(makeLayout('pair'), 'group-1', 'Markets');
  const markets = active(layout.groups[1]);
  layout = patchPane(layout, markets.id, { search: 'ink' });
  layout = moveTab(layout, 'group-1', markets.id, 'group-1', 'tab-1');
  assert.equal(layout.groups[1].tabs[0].id, markets.id);
  layout = moveTab(layout, 'group-1', markets.id, 'group-0');
  assert.equal(active(layout.groups[0]).search, 'ink');
  assert.equal(layout.groups[1].active, 'tab-1');
  layout = openTool(layout, 'Farms');
  assert.equal(layout.recentGroups[0], 'group-1');
  assert.ok(validLayout(layout));
});

test('malformed and future saved data recover to a usable default', () => {
  assert.deepEqual(restoreWorkspace({ version: 2 }), makeWorkspace());
  const invalid = makeWorkspace();
  invalid.current.groups[1].tabs[0].id = 'tab-0';
  assert.deepEqual(restoreWorkspace(invalid), makeWorkspace());
});
