import { Model } from 'flexlayout-react';
import { PANELS, PRESETS, makeLayout, restoreWorkspace, validLayout } from './workspace-model.js';

const globalOptions = {
  enableEdgeDock: false,
  tabSetEnableDivide: false,
  tabSetEnableDrag: false,
  tabSetEnableDeleteWhenEmpty: false,
  tabSetEnableClose: false,
  tabEnableClose: false,
  tabEnablePin: false,
  tabEnableRename: false,
  tabEnablePopout: false,
  tabSetMinWidth: 60,
  tabSetMinHeight: 36,
};

export function dockJson(layout) {
  const group = (index, weight = 100) => {
    const g = layout.groups[index];
    return {
      type: 'tabset',
      id: g.id,
      weight,
      active: layout.recentGroups[0] === g.id,
      maximized: layout.maximized === g.id,
      selected: g.tabs.findIndex((t) => t.id === g.active),
      children: g.tabs.map((t) => ({
        type: 'tab',
        id: t.id,
        name: t.type === 'Console' ? 'Status / Console' : t.type,
        component: t.type,
      })),
    };
  };
  let children;
  if (layout.preset === 'single') children = [group(0)];
  else if (layout.preset === 'pair')
    children = [group(0, layout.primaryWidth), group(1, 100 - layout.primaryWidth)];
  else if (layout.preset === 'terminal')
    children = [
      group(0, layout.primaryWidth),
      {
        type: 'row',
        id: 'dock-stack',
        weight: 100 - layout.primaryWidth,
        children: layout.sideHeights.map((v, i) => group(i + 1, v)),
      },
    ];
  else {
    const sizes = layout.eightWeights ?? { columns: [25, 25, 25, 25], upper: [50, 50, 50, 50] };
    children = sizes.columns.map((w, i) => ({
      type: 'row',
      id: 'dock-column-' + i,
      weight: w,
      children: [group(i, sizes.upper[i]), group(i + 4, 100 - sizes.upper[i])],
    }));
  }
  return { global: globalOptions, borders: [], layout: { type: 'row', id: 'dock-root', children } };
}

function weightFractions(nodes) {
  const numbers = nodes.map((n) => n.weight ?? 100);
  if (!numbers.every((v) => Number.isFinite(v) && v >= 0)) throw Error('Invalid dock weights');
  const total = numbers.reduce((a, b) => a + b, 0);
  if (total === 0) throw Error('Empty dock weights');
  return numbers.map((v) => (100 * v) / total);
}

export function readDock(
  base,
  json,
  panels = Object.fromEntries(base.groups.flatMap((g) => g.tabs.map((t) => [t.id, t]))),
) {
  const root = json?.layout;
  if (root?.type !== 'row' || !Array.isArray(root.children)) throw Error('Invalid dock');
  const children = root.children;
  let tabsets,
    ratios = {};
  if (base.preset === 'eight') {
    if (children.length !== 4 || !children.every((n) => n.type === 'row' && n.children?.length === 2))
      throw Error('Invalid columns');
    tabsets = [...children.map((c) => c.children[0]), ...children.map((c) => c.children[1])];
    ratios.eightWeights = {
      columns: weightFractions(children),
      upper: children.map((c) => weightFractions(c.children)[0]),
    };
  } else if (base.preset === 'terminal') {
    if (children.length !== 2 || children[1]?.type !== 'row' || children[1].children?.length !== 3)
      throw Error('Invalid stack');
    tabsets = [children[0], ...children[1].children];
    ratios.primaryWidth = weightFractions(children)[0];
    ratios.sideHeights = weightFractions(children[1].children);
  } else {
    if (children.length !== (base.preset === 'pair' ? 2 : 1)) throw Error('Invalid group count');
    tabsets = children;
    if (children.length === 2) ratios.primaryWidth = weightFractions(children)[0];
  }
  const groups = tabsets.map((g) => {
    if (g.type !== 'tabset' || typeof g.id !== 'string' || !Array.isArray(g.children))
      throw Error('Invalid tab group');
    const tabs = g.children.map((t) => {
      if (t.type !== 'tab' || typeof t.id !== 'string' || !PANELS.includes(t.component))
        throw Error('Invalid tab');
      return { ...(Object.hasOwn(panels, t.id) ? panels[t.id] : {}), id: t.id, type: t.component };
    });
    return { id: g.id, tabs, active: tabs[g.selected ?? 0]?.id ?? null };
  });
  const recent = tabsets.find((g) => g.active)?.id;
  return {
    ...base,
    ...ratios,
    groups,
    maximized: tabsets.find((g) => g.maximized)?.id ?? null,
    recentGroups: recent ? [recent, ...base.recentGroups.filter((id) => id !== recent)] : base.recentGroups,
  };
}

function encodeLayout(layout) {
  const { groups, primaryWidth, sideHeights, eightWeights, maximized, ...meta } = layout;
  const paneStates = Object.fromEntries(
    groups.flatMap((g) => g.tabs.map(({ id, type, ...state }) => [id, state])),
  );
  return { ...meta, dock: Model.fromJson(dockJson(layout)).toJson(), paneStates };
}

export function encodeWorkspace(workspace) {
  return {
    version: 2,
    current: encodeLayout(workspace.current),
    named: workspace.named.map((n) => ({ name: n.name, layout: encodeLayout(n.layout) })),
  };
}

export function decodeWorkspace(record) {
  if (record?.version !== 2) return restoreWorkspace(record);
  const decode = (src) => {
    if (!src || !Object.hasOwn(PRESETS, src.preset) || !Array.isArray(src.recentGroups) || !src.paneStates)
      throw Error('Invalid saved arrangement');
    const { dock, paneStates, preset, ...metadata } = src;
    const layout = readDock({ ...makeLayout(preset), ...metadata }, dock, paneStates);
    if (!validLayout(layout)) throw Error('Invalid saved panes');
    return layout;
  };
  try {
    const current = decode(record.current),
      named = [];
    for (const n of (Array.isArray(record.named) ? record.named : []).slice(0, 24)) {
      try {
        if (typeof n.name === 'string') named.push({ name: n.name, layout: decode(n.layout) });
      } catch {
        /* One damaged preset can be omitted independently. */
      }
    }
    return { version: 1, current, named };
  } catch {
    return restoreWorkspace(null);
  }
}
