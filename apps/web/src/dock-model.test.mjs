import test from 'node:test';
import assert from 'node:assert/strict';
import { Actions, DockLocation, Model } from 'flexlayout-react';
import { activate, addTab, makeLayout, makeWorkspace, patchPane, saveNamed } from './workspace-model.js';
import { decodeWorkspace, dockJson, encodeWorkspace, readDock } from './dock-model.js';

test('all v1 arrangements and named records migrate to native docking trees with independent per-pane state', () => {
  for (const preset of ['single', 'pair', 'terminal', 'eight']) {
    let layout = addTab(makeLayout(preset), 'group-0', 'Markets');
    layout = patchPane(layout, layout.groups[0].active, { search: 'scope', sort: 'quantity' });
    layout = patchPane(layout, 'tab-0', { extent: [128, 140, 2], overlay: 'coverage' });
    layout = activate(layout, 'group-0', 'tab-0');
    const legacy = saveNamed({ ...makeWorkspace(), current: layout }, 'Evening');
    const v2 = encodeWorkspace(decodeWorkspace(legacy));
    assert.equal(v2.version, 2);
    assert.equal(v2.current.dock.layout.type, 'row');
    assert.equal(v2.current.groups, undefined);
    const restored = decodeWorkspace(JSON.parse(JSON.stringify(v2)));
    for (const copy of [restored.current, restored.named[0].layout]) {
      assert.equal(copy.preset, preset);
      assert.deepEqual(copy.groups, layout.groups);
      assert.deepEqual(copy.recentGroups, layout.recentGroups);
      assert.equal(copy.primaryWidth, layout.primaryWidth);
      assert.deepEqual(copy.sideHeights, layout.sideHeights);
    }
  }
});

test('native resizing, tab docking and maximize survive save and reload with pane state intact', () => {
  const state = patchPane(makeLayout(), 'tab-2', { sort: 'Supply', selectedItem: 3 });
  const model = Model.fromJson(dockJson(state));
  model.doAction(Actions.adjustWeights('dock-root', [72, 28]));
  model.doAction(Actions.adjustWeights('dock-stack', [10, 30, 60]));
  model.doAction(Actions.moveNode('tab-2', 'group-3', DockLocation.CENTER, -1, true));
  model.doAction(Actions.maximizeToggle('group-3'));
  const current = readDock(state, model.toJson());
  const restored = decodeWorkspace(encodeWorkspace({ ...makeWorkspace(), current })).current;
  assert.equal(restored.primaryWidth, 72);
  assert.deepEqual(restored.sideHeights, [10, 30, 60]);
  assert.equal(restored.groups[2].tabs.length, 0);
  assert.equal(restored.groups[3].active, 'tab-2');
  assert.equal(restored.groups[3].tabs.at(-1).sort, 'Supply');
  assert.equal(restored.maximized, 'group-3');
});

test('a native eight-pane splitter restores independently in each column', () => {
  const state = makeLayout('eight'),
    model = Model.fromJson(dockJson(state));
  model.doAction(Actions.adjustWeights('dock-root', [10, 20, 30, 40]));
  model.doAction(Actions.adjustWeights('dock-column-2', [37, 63]));
  const current = readDock(state, model.toJson());
  assert.deepEqual(current.eightWeights, { columns: [10, 20, 30, 40], upper: [50, 50, 37, 50] });
  const saved = encodeWorkspace({ ...makeWorkspace(), current });
  const restored = decodeWorkspace(saved).current;
  assert.deepEqual(restored.eightWeights, current.eightWeights);
  assert.deepEqual(restored.groups, current.groups);
});

test('a damaged named layout cannot displace the current valid native model', () => {
  const saved = encodeWorkspace(makeWorkspace());
  saved.named.push({
    name: 'Bad',
    layout: {
      preset: 'eight',
      recentGroups: [],
      paneStates: {},
      dock: { layout: { type: 'row', children: [] } },
    },
  });
  assert.equal(decodeWorkspace(saved).named.length, 0);
  assert.equal(decodeWorkspace(saved).current.preset, 'terminal');
});
