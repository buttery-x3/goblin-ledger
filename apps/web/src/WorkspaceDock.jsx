import React, { useRef } from 'react';
import { Actions, DockLocation, Layout, Model } from 'flexlayout-react';
import 'flexlayout-react/style/dark.css';
import { PANELS, addTab } from './workspace-model.js';
import { dockJson, readDock } from './dock-model.js';

export function WorkspaceDock({ layout, changeLayout, renderPane, symbols }) {
  const latest = useRef(null);
  latest.current = layout;
  const live = useRef(null);
  const json = dockJson(layout),
    signature = JSON.stringify(json);
  // A normal tab edit changes only pane data. Keep the same native model so
  // text inputs, in-progress drags and scroll positions survive those edits.
  if (live.current?.signature !== signature) {
    live.current = { signature, model: Model.fromJson(json) };
  }
  const { model } = live.current;
  const groups = new Map(layout.groups.map((g) => [g.id, g]));
  function onModelChange(nextModel) {
    if (live.current.model !== nextModel) return;
    const next = readDock(latest.current, nextModel.toJson());
    latest.current = next;
    live.current.signature = JSON.stringify(dockJson(next));
    changeLayout(() => next);
  }
  function menu(node) {
    const group = groups.get(node.getId());
    if (!group) return null;
    const pane = group.tabs.find((t) => t.id === group.active);
    const index = group.tabs.indexOf(pane);
    return (
      <select
        key="tools"
        value=""
        className="pane-menu"
        aria-label={'Manage tabs in ' + group.id}
        title="Add or manage tabs"
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const command = e.target.value;
          if (command === 'close' && pane) model.doAction(Actions.deleteTab(pane.id));
          else if (command === 'earlier' && index > 0)
            model.doAction(Actions.moveNode(pane.id, group.id, DockLocation.CENTER, index - 1, true));
          else if (command.startsWith('move:') && pane)
            model.doAction(Actions.moveNode(pane.id, command.slice(5), DockLocation.CENTER, -1, true));
          else if (PANELS.includes(command)) changeLayout((l) => addTab(l, group.id, command));
        }}
      >
        <option value="">＋</option>
        <optgroup label="Add tab">
          {PANELS.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </optgroup>
        {pane && (
          <optgroup label="Current tab">
            <option value="close">Close {pane.type}</option>
            {index > 0 && <option value="earlier">Move tab left</option>}
            {layout.groups
              .filter((g) => g.id !== group.id)
              .map((g) => (
                <option key={g.id} value={'move:' + g.id}>
                  Move to {g.tabs.find((t) => t.id === g.active)?.type ?? 'empty pane'} (
                  {layout.groups.indexOf(g) + 1})
                </option>
              ))}
          </optgroup>
        )}
      </select>
    );
  }
  return (
    <div className="native-dock">
      <Layout
        model={model}
        onContextMenu={(_node, event) => event.preventDefault()}
        onAction={(action) => {
          if (action.type === Actions.MOVE_NODE) {
            const destination = groups.get(action.data.toNode);
            const sourceGroup = model.getNodeById(action.data.fromNode)?.getParent()?.getId();
            if (!destination || (destination.id !== sourceGroup && destination.tabs.length >= 32))
              return undefined;
          }
          return action;
        }}
        onModelChange={onModelChange}
        factory={(node) => {
          const group = groups.get(node.getParent()?.getId());
          const pane = group?.tabs.find((t) => t.id === node.getId());
          if (!pane) return null;
          return (
            <section
              className={'workgroup ' + (pane.type === 'Atlas' ? 'atlas-group' : '')}
              data-group={group.id}
              aria-label={pane.type + ' viewport'}
              onFocusCapture={() => {
                if (group.active === pane.id && latest.current.recentGroups[0] !== group.id)
                  model.doAction(Actions.setActiveTabset(group.id));
              }}
            >
              <div className="pane-content">{renderPane(group, pane)}</div>
            </section>
          );
        }}
        onRenderTab={(node, values) => {
          values.leading = (
            <span className="dock-icon" aria-hidden="true">
              {symbols[node.getComponent()]}
            </span>
          );
        }}
        onRenderTabSet={(node, values) => values.buttons.push(menu(node))}
        onTabSetPlaceHolder={() => (
          <div className="state-card">
            <h3>Empty viewport</h3>
            <p>Use the + menu to add a tool.</p>
          </div>
        )}
        keyMap={{ focusNextTabset: 'Alt+PageDown', focusPreviousTabset: 'Alt+PageUp', focusTabToggle: 'F6' }}
      />
    </div>
  );
}
