export const PANELS = [
  'Atlas',
  'Farms',
  'Opportunities',
  'Characters',
  'Markets',
  'Positions',
  'Research',
  'Professions',
  'Settings',
  'Console',
];
export const PRESETS = {
  single: 'Single pane',
  pair: 'Side by side',
  terminal: 'One plus three',
  eight: 'Eight panes',
};
const presetPanels = {
  single: ['Atlas'],
  pair: ['Atlas', 'Farms'],
  terminal: ['Atlas', 'Farms', 'Opportunities', 'Characters'],
  eight: ['Atlas', 'Farms', 'Opportunities', 'Characters', 'Markets', 'Positions', 'Research', 'Professions'],
};

export function makeLayout(preset = 'terminal') {
  const groups = presetPanels[preset].map((type, i) => ({
    id: 'group-' + i,
    active: 'tab-' + i,
    tabs: [{ id: 'tab-' + i, type }],
  }));
  return {
    preset,
    groups,
    primaryWidth: 58,
    sideHeights: [33, 34, 33],
    density: 'compact',
    selectedRoute: null,
    recentGroups: [],
    maximized: null,
    nextId: groups.length,
  };
}

export function makeWorkspace() {
  return { version: 1, current: makeLayout(), named: [] };
}

export function validLayout(layout) {
  if (
    !layout ||
    !Object.hasOwn(PRESETS, layout.preset) ||
    !Array.isArray(layout.groups) ||
    layout.groups.length !== presetPanels[layout.preset].length ||
    !Array.isArray(layout.recentGroups) ||
    !Number.isSafeInteger(layout.nextId) ||
    layout.nextId < 0 ||
    !Number.isFinite(layout.primaryWidth) ||
    layout.primaryWidth < 0 ||
    layout.primaryWidth > 100 ||
    !Array.isArray(layout.sideHeights) ||
    layout.sideHeights.length !== 3 ||
    !layout.sideHeights.every((n) => Number.isFinite(n) && n >= 0 && n <= 100)
  )
    return false;
  const ids = new Set();
  const groups = new Set();
  return layout.groups.every((g) => {
    if (!g || typeof g.id !== 'string' || groups.has(g.id) || !Array.isArray(g.tabs) || g.tabs.length > 32)
      return false;
    groups.add(g.id);
    if (g.tabs.length ? !g.tabs.some((t) => t?.id === g.active) : g.active !== null) return false;
    return g.tabs.every((t) => {
      if (!t || !PANELS.includes(t.type) || typeof t.id !== 'string' || ids.has(t.id)) return false;
      ids.add(t.id);
      return true;
    });
  });
}

export function restoreWorkspace(raw) {
  if (!raw || raw.version !== 1 || !validLayout(raw.current)) return makeWorkspace();
  return {
    version: 1,
    current: raw.current,
    named: Array.isArray(raw.named)
      ? raw.named.filter((n) => n && typeof n.name === 'string' && validLayout(n.layout)).slice(0, 24)
      : [],
  };
}

export function saveNamed(workspace, name) {
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed) return workspace;
  const other = workspace.named.filter((entry) => entry.name !== trimmed);
  if (other.length >= 24) return workspace;
  return { ...workspace, named: [...other, { name: trimmed, layout: structuredClone(workspace.current) }] };
}

export function activate(layout, groupId, tabId) {
  const group = layout.groups.find((g) => g.id === groupId);
  if (!group || !group.tabs.some((t) => t.id === tabId)) return layout;
  const recentGroups = [groupId, ...layout.recentGroups.filter((id) => id !== groupId)];
  if (group.active === tabId && layout.recentGroups[0] === groupId) return layout;
  return {
    ...layout,
    recentGroups,
    groups: layout.groups.map((g) => (g === group ? { ...g, active: tabId } : g)),
  };
}

export function patchPane(layout, tabId, update) {
  return {
    ...layout,
    groups: layout.groups.map((g) =>
      g.tabs.some((t) => t.id === tabId)
        ? {
            ...g,
            tabs: g.tabs.map((t) =>
              t.id === tabId
                ? { ...t, ...(typeof update === 'function' ? update(t) : update), type: t.type, id: t.id }
                : t,
            ),
          }
        : g,
    ),
  };
}

export function addTab(layout, groupId, type) {
  if (!PANELS.includes(type)) return layout;
  const target = layout.groups.find((g) => g.id === groupId);
  if (!target || target.tabs.length >= 32) return layout;
  let next = layout.nextId;
  let id;
  do {
    id = 'tab-' + next++;
  } while (layout.groups.some((g) => g.tabs.some((t) => t.id === id)));
  return activate(
    {
      ...layout,
      nextId: next,
      groups: layout.groups.map((g) =>
        g === target ? { ...g, tabs: [...g.tabs, { id, type }], active: id } : g,
      ),
    },
    groupId,
    id,
  );
}

export function closeTab(layout, groupId, tabId) {
  return {
    ...layout,
    groups: layout.groups.map((g) => {
      if (g.id !== groupId) return g;
      const tabs = g.tabs.filter((t) => t.id !== tabId);
      return { ...g, tabs, active: g.active === tabId ? (tabs.at(-1)?.id ?? null) : g.active };
    }),
  };
}

export function moveTab(layout, sourceId, tabId, destinationId, beforeId = null) {
  const source = layout.groups.find((g) => g.id === sourceId);
  const destination = layout.groups.find((g) => g.id === destinationId);
  const tab = source?.tabs.find((t) => t.id === tabId);
  if (!tab || !destination || tabId === beforeId || (source !== destination && destination.tabs.length >= 32))
    return layout;
  const changed = closeTab(layout, sourceId, tabId);
  return activate(
    {
      ...changed,
      groups: changed.groups.map((g) => {
        if (g.id !== destinationId) return g;
        const tabs = [...g.tabs];
        const at = beforeId ? tabs.findIndex((t) => t.id === beforeId) : tabs.length;
        tabs.splice(at < 0 ? tabs.length : at, 0, tab);
        return { ...g, tabs, active: tabId };
      }),
    },
    destinationId,
    tabId,
  );
}

function byRecency(layout) {
  const order = [...new Set([...layout.recentGroups, ...layout.groups.map((g) => g.id)])];
  return order.map((id) => layout.groups.find((g) => g.id === id)).filter(Boolean);
}

export function openTool(layout, type) {
  const ordered = byRecency(layout);
  const existing =
    ordered.find((g) => g.tabs.find((t) => t.id === g.active)?.type === type) ??
    ordered.find((g) => g.tabs.some((t) => t.type === type));
  if (existing) {
    const tab =
      existing.tabs.find((t) => t.id === existing.active && t.type === type) ??
      existing.tabs.find((t) => t.type === type);
    return activate({ ...layout, maximized: null }, existing.id, tab.id);
  }
  const target =
    ordered.find((g) => g.tabs.length === 0) ??
    ordered.find((g) => g.tabs.find((t) => t.id === g.active)?.type !== 'Atlas') ??
    ordered[0];
  return addTab({ ...layout, maximized: null }, target.id, type);
}

// Select by route identity. The route's item or zone may be shared by any number of farms.
export function selectFarm(layout, routeId, sourceId, activity) {
  const sourceGroup = layout.groups.find((g) => g.tabs.some((t) => t.id === sourceId));
  const sourceTab = sourceGroup?.tabs.find((t) => t.id === sourceId);
  if (!routeId || !sourceTab) return layout;
  const selected = { ...layout, selectedRoute: routeId };
  if (sourceTab.type === 'Farms') return patchPane(selected, sourceId, { selectedRoute: routeId });
  let next = { ...selected, maximized: null };
  let side = byRecency(next).filter((g) => g.id !== sourceGroup.id);
  const visible = side.find((g) => g.tabs.find((t) => t.id === g.active)?.type === 'Farms');
  const hidden = side.find((g) => g.tabs.some((t) => t.type === 'Farms'));
  let target = visible ?? hidden;
  let tabId;
  if (target) {
    tabId = visible ? target.active : target.tabs.find((t) => t.type === 'Farms').id;
  } else {
    if (side.length === 0) {
      const newGroup = { id: 'group-side-' + next.nextId, active: null, tabs: [] };
      next = { ...next, preset: 'pair', nextId: next.nextId + 1, groups: [...next.groups, newGroup] };
      side = [newGroup];
    }
    target = next.groups.find((g) => g.id !== sourceGroup.id && g.tabs.length === 0) ?? side[0];
    const sibling = sourceGroup.tabs.find((t) => t.type === 'Farms');
    if (sibling) {
      tabId = sibling.id;
      next = moveTab(next, sourceGroup.id, tabId, target.id);
    } else {
      next = addTab(next, target.id, 'Farms');
      tabId = next.groups.find((g) => g.id === target.id).active;
    }
  }
  if (!next.groups.find((g) => g.id === target.id)?.tabs.some((t) => t.type === 'Farms' && t.id === tabId))
    return selected;
  next = activate(next, target.id, tabId);
  return patchPane(next, tabId, (tab) => ({
    selectedRoute: routeId,
    revealRoute: routeId,
    ...(activity && {
      actor: activity.actor,
      sessionMinutes: activity.sessionMinutes,
      farmOptions: { ...tab.farmOptions, targetCopperPerHour: activity.targetCopperPerHour },
    }),
  }));
}
