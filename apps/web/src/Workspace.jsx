import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient, profileKey } from './client-api.js';
import {
  PANELS,
  PRESETS,
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
} from './workspace-model.js';
import { Atlas } from './Atlas.jsx';
import { Markets, Opportunities } from './Markets.jsx';
import { Farms } from './Farms.jsx';
import { Characters, Positions, AddonSettings } from './Personal.jsx';
import { Research, Professions } from './Research.jsx';
import { ConsolePanel } from './Console.jsx';

const panels = {
  Atlas,
  Markets,
  Opportunities,
  Farms,
  Characters,
  Positions,
  Research,
  Professions,
  Console: ConsolePanel,
};
const symbols = {
  Atlas: '⌖',
  Farms: '♧',
  Opportunities: '↗',
  Characters: '♙',
  Markets: '≋',
  Positions: '▤',
  Research: '▧',
  Professions: '⚒',
  Settings: '⚙',
  Console: '›_',
};

class PanelBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { broken: false };
  }
  static getDerivedStateFromError() {
    return { broken: true };
  }
  render() {
    return this.state.broken ? (
      <div className="state-card" role="alert">
        <h3>Panel could not open</h3>
        <button onClick={() => this.setState({ broken: false })}>Try again</button>
      </div>
    ) : (
      this.props.children
    );
  }
}

function ProfileForm({ mode, region, onApply }) {
  const [nextMode, setMode] = useState(mode);
  const [nextRegion, setRegion] = useState(region || '');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setMode(mode);
    setRegion(region || '');
  }, [mode, region]);
  return (
    <form
      className="profile-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onApply(nextMode, nextRegion || null);
          setStatus('Profile saved.');
        } catch (error) {
          setStatus(error.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Home market</h3>
      <label>
        Data profile
        <select value={nextMode} onChange={(e) => setMode(e.target.value)}>
          <option value="live">Live</option>
          <option value="demo">Demo</option>
        </select>
      </label>
      <label>
        Region
        <select value={nextRegion} onChange={(e) => setRegion(e.target.value)}>
          <option value="">Choose a region</option>
          <option value="us">US</option>
          <option value="eu">EU</option>
        </select>
      </label>
      <p className="muted">PvP · Alliance. Demo uses a separate local database.</p>
      <button type="submit" disabled={busy}>
        {busy ? 'Applying…' : 'Apply profile'}
      </button>
      {status && <p role="status">{status}</p>}
    </form>
  );
}

function Splitter({ orientation, value, label, onChange, min, max }) {
  const start = useRef(null);
  const vertical = orientation === 'vertical';
  return (
    <div
      className={'splitter ' + orientation}
      role="separator"
      tabIndex="0"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      onPointerDown={(e) => {
        const parent = e.currentTarget.parentElement.getBoundingClientRect();
        start.current = {
          origin: vertical ? e.clientX : e.clientY,
          length: vertical ? parent.width : parent.height,
          initial: value,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const drag = start.current;
        if (drag?.length) {
          const diff = (vertical ? e.clientX : e.clientY) - drag.origin;
          onChange(Math.min(max, Math.max(min, drag.initial + (100 * diff) / drag.length)));
        }
      }}
      onPointerUp={() => {
        start.current = null;
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
      onKeyDown={(e) => {
        const direction = (vertical ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 })[
          e.key
        ];
        if (direction) {
          e.preventDefault();
          onChange(Math.min(max, Math.max(min, value + direction * 2)));
        }
      }}
    />
  );
}

function LayoutDialog({ workspace, change, onClose }) {
  const [name, setName] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.showModal?.();
  }, []);
  const layout = workspace.current;
  return (
    <dialog
      ref={ref}
      open={
        typeof HTMLDialogElement === 'undefined' || !HTMLDialogElement.prototype.showModal ? true : undefined
      }
      className="layout-dialog"
      onCancel={onClose}
    >
      <div className="section-line">
        <h2>Workspace layouts</h2>
        <button aria-label="Close layouts" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="presets">
        {Object.entries(PRESETS).map(([key, title]) => (
          <button
            key={key}
            aria-pressed={key === layout.preset}
            onClick={() => {
              change((w) => ({ ...w, current: makeLayout(key) }));
              onClose();
            }}
          >
            <span className={'diagram ' + key} aria-hidden="true">
              {Array.from({ length: { single: 1, pair: 2, terminal: 4, eight: 8 }[key] }, (_, i) => (
                <i key={i} />
              ))}
            </span>
            {title}
          </button>
        ))}
      </div>
      <label className="density-control">
        Table density
        <select
          value={layout.density}
          onChange={(e) => change((w) => ({ ...w, current: { ...w.current, density: e.target.value } }))}
        >
          <option value="compact">Compact</option>
          <option value="comfortable">Comfortable</option>
        </select>
      </label>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          change((w) => saveNamed(w, name));
          setName('');
        }}
      >
        <label>
          Save current arrangement
          <input
            value={name}
            maxLength="60"
            required
            onChange={(e) => setName(e.target.value)}
            placeholder="Layout name"
          />
        </label>
        <button
          type="submit"
          disabled={
            !name.trim() ||
            (workspace.named.length >= 24 && !workspace.named.some((n) => n.name === name.trim()))
          }
        >
          {workspace.named.some((n) => n.name === name.trim()) ? 'Update saved layout' : 'Save layout'}
        </button>
      </form>
      {workspace.named.length > 0 && (
        <ul>
          {workspace.named.map((n) => (
            <li key={n.name}>
              <button
                onClick={() => {
                  change((w) => ({ ...w, current: structuredClone(n.layout) }));
                  onClose();
                }}
              >
                {n.name}
              </button>
              <button
                aria-label={'Remove saved layout ' + n.name}
                onClick={() => change((w) => ({ ...w, named: w.named.filter((x) => x.name !== n.name) }))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </dialog>
  );
}

export function Workspace() {
  const [boot, setBoot] = useState(null);
  const [problem, setProblem] = useState('');
  const [stream, setStream] = useState('Connecting');
  const [lastContact, setLastContact] = useState(null);
  const [workspace, setWorkspace] = useState(makeWorkspace);
  const [layoutsOpen, setLayoutsOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [saving, setSaving] = useState('');
  const current = useRef(workspace),
    session = useRef({ token: '', profile: '' }),
    dirty = useRef(false),
    serial = useRef(Promise.resolve()),
    activeProfile = useRef(0),
    dragTab = useRef(null);
  const switching = useRef(false),
    timer = useRef(null);
  const stale = useRef(null);
  const api = useMemo(
    () =>
      createClient(
        () => session.current,
        () => stale.current?.(),
      ),
    [],
  );
  const refreshRoutes = useCallback(async () => {
    const profile = activeProfile.current,
      data = await api('/bootstrap');
    if (profile !== activeProfile.current || switching.current) return;
    if (profileKey(data) !== session.current.profile) {
      stale.current?.();
      return;
    }
    session.current = { profile: profileKey(data), token: data.token };
    setBoot((old) =>
      old ? { ...old, routes: data.routes, market: data.market, freshness: data.freshness } : old,
    );
  }, [api]);
  const load = useCallback(async () => {
    try {
      const data = await api('/bootstrap');
      session.current = { profile: profileKey(data), token: data.token };
      const restored = restoreWorkspace(data.workspace);
      current.current = restored;
      dirty.current = false;
      setWorkspace(restored);
      setBoot(data);
      setProblem('');
      setSaving('');
      setLastContact(new Date());
    } catch (error) {
      setProblem(error.message);
      throw error;
    }
  }, [api]);
  stale.current = () => {
    if (switching.current) return;
    switching.current = true;
    activeProfile.current++;
    clearTimeout(timer.current);
    const hadEdits = dirty.current;
    dirty.current = false;
    load()
      .then(() =>
        setProblem(
          hadEdits
            ? 'Another tab switched profiles. Recent layout edits for the previous profile could not be saved.'
            : 'Another tab switched profiles. This workspace now shows the active profile.',
        ),
      )
      .catch(() => {})
      .finally(() => {
        switching.current = false;
      });
  };
  useEffect(() => {
    load().catch(() => {});
  }, [load]);
  useEffect(() => {
    if (!boot) return;
    let disposed = false;
    setStream('Connecting');
    const events = new EventSource('/api/v1/events?profile=' + encodeURIComponent(profileKey(boot)));
    events.onopen = () => {
      setStream('Connected');
      setLastContact(new Date());
    };
    events.onerror = () => {
      setStream('Disconnected');
      refreshRoutes().catch(() => {});
    };
    events.onmessage = (e) => {
      if (disposed) return;
      let data;
      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }
      if (data.mode && data.mode !== boot.mode) {
        refreshRoutes().catch(() => {});
        return;
      }
      setLastContact(new Date());
      window.dispatchEvent(new CustomEvent('ledger:operations', { detail: data }));
      if (
        data.kind === 'reset' ||
        (data.kind === 'run' && ['succeeded', 'partial', 'no-change'].includes(data.status))
      ) {
        setRefreshKey((n) => n + 1);
        refreshRoutes().catch(() => {});
      }
    };
    return () => {
      disposed = true;
      events.close();
    };
  }, [boot?.mode, boot?.region, !!boot, refreshRoutes]);
  const persist = useCallback(() => {
    clearTimeout(timer.current);
    const profile = activeProfile.current;
    const attempt = () => {
      if (!dirty.current || profile !== activeProfile.current) return;
      const snapshot = current.current;
      setSaving('Saving layout…');
      return api('/workspace', { method: 'PUT', body: { workspace: snapshot } })
        .then(() => {
          if (snapshot === current.current) {
            dirty.current = false;
            setSaving('');
          }
        })
        .catch((error) => {
          if (profile === activeProfile.current) setSaving('Layout save failed · ' + error.message);
          throw error;
        });
    };
    const task = serial.current.then(attempt, attempt);
    serial.current = task.catch(() => {});
    return task;
  }, [api]);
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === 'hidden' && dirty.current) persist().catch(() => {});
    };
    document.addEventListener('visibilitychange', flush);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      clearTimeout(timer.current);
    };
  }, [persist]);
  const change = useCallback(
    (fn) => {
      if (switching.current) return;
      const next = fn(current.current);
      if (next === current.current) return;
      dirty.current = true;
      current.current = next;
      setWorkspace(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => persist().catch(() => {}), 160);
    },
    [persist],
  );
  const changeLayout = useCallback(
    (fn) =>
      change((w) => {
        const layout = fn(w.current);
        return layout === w.current ? w : { ...w, current: layout };
      }),
    [change],
  );
  const applyProfile = async (mode, region) => {
    if (switching.current) return;
    switching.current = true;
    activeProfile.current++;
    try {
      await persist();
      await api('/settings', { method: 'PUT', body: { mode, region } });
      await load();
      setRefreshKey((n) => n + 1);
    } finally {
      switching.current = false;
    }
  };
  if (!boot)
    return (
      <main className="startup">
        <h1>Goblin Ledger</h1>
        <p role="status">
          {problem ? 'Could not reach the local service. ' + problem : 'Opening your workspace…'}
        </p>
        {problem && <button onClick={() => load().catch(() => {})}>Reconnect</button>}
      </main>
    );

  const layout = workspace.current;
  const routes = Array.isArray(boot.routes) ? boot.routes : [];
  const open = (type) => changeLayout((l) => openTool(l, type));
  const drop = (e, groupId, before = null) => {
    e.preventDefault();
    e.stopPropagation();
    const value = dragTab.current;
    if (!value) return;
    dragTab.current = null;
    changeLayout((l) => moveTab(l, value.group, value.tab, groupId, before));
  };
  function renderGroup(group) {
    const pane = group.tabs.find((t) => t.id === group.active);
    const Component = panels[pane?.type];
    const props = pane
      ? {
          api,
          mode: boot.mode,
          region: boot.region,
          pane,
          refreshKey,
          refreshRoutes,
          updatePane: (patch) => changeLayout((l) => patchPane(l, pane.id, patch)),
          selectedRoute: pane.type === 'Farms' ? (pane.selectedRoute ?? null) : layout.selectedRoute,
          onSelectRoute: (id) => changeLayout((l) => selectFarm(l, id, pane.id)),
          routes,
        }
      : null;
    return (
      <section
        key={group.id}
        className={'workgroup ' + (pane?.type === 'Atlas' ? 'atlas-group' : '')}
        data-group={group.id}
        aria-label={(pane?.type || 'Empty') + ' viewport'}
        onPointerDownCapture={() => {
          if (pane) changeLayout((l) => activate(l, group.id, pane.id));
        }}
        onFocusCapture={() => {
          if (pane) changeLayout((l) => activate(l, group.id, pane.id));
        }}
      >
        <header
          className="group-bar"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => drop(e, group.id)}
        >
          <div className="tab-list" role="tablist" aria-label="Viewport tabs">
            {group.tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                id={'label-' + t.id}
                aria-selected={t.id === group.active}
                aria-controls={'panel-' + t.id}
                draggable
                onDragStart={(e) => {
                  dragTab.current = { group: group.id, tab: t.id };
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', t.id);
                }}
                onDragEnd={() => {
                  dragTab.current = null;
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => drop(e, group.id, t.id)}
                onClick={() => changeLayout((l) => activate(l, group.id, t.id))}
              >
                <span aria-hidden="true">{symbols[t.type]}</span>
                {t.type === 'Console' ? 'Status / Console' : t.type}
              </button>
            ))}
          </div>
          <select
            className="pane-menu"
            aria-label={'Manage tabs in ' + group.id}
            title="Add or manage tabs"
            value=""
            onChange={(e) => {
              const command = e.target.value;
              if (command === 'close' && pane) changeLayout((l) => closeTab(l, group.id, pane.id));
              else if (command.startsWith('move:') && pane)
                changeLayout((l) => moveTab(l, group.id, pane.id, command.slice(5)));
              else if (command === 'earlier' && pane) {
                const index = group.tabs.indexOf(pane);
                if (index > 0)
                  changeLayout((l) => moveTab(l, group.id, pane.id, group.id, group.tabs[index - 1].id));
              } else changeLayout((l) => addTab(l, group.id, command));
            }}
          >
            <option value="">＋</option>
            <optgroup label="Add tab">
              {PANELS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </optgroup>
            {pane && (
              <optgroup label="Current tab">
                <option value="close">Close {pane.type}</option>
                {group.tabs.indexOf(pane) > 0 && <option value="earlier">Move tab left</option>}
                {layout.groups
                  .filter((g) => g.id !== group.id)
                  .map((g, i) => (
                    <option value={'move:' + g.id} key={g.id}>
                      Move to {g.tabs.find((t) => t.id === g.active)?.type || 'empty pane'} (
                      {layout.groups.indexOf(g) + 1})
                    </option>
                  ))}
              </optgroup>
            )}
          </select>
          <button
            className="maximize"
            aria-label={layout.maximized ? 'Restore panes' : 'Maximize pane'}
            onClick={() =>
              changeLayout((l) => ({ ...l, maximized: l.maximized === group.id ? null : group.id }))
            }
          >
            {layout.maximized ? '⊟' : '⛶'}
          </button>
        </header>
        <div
          className="pane-content"
          role="tabpanel"
          id={pane ? 'panel-' + pane.id : undefined}
          aria-labelledby={pane ? 'label-' + pane.id : undefined}
        >
          {pane ? (
            <PanelBoundary key={boot.mode + group.id + pane.id}>
              {pane.type === 'Settings' ? (
                <div className="settings-body">
                  <ProfileForm mode={boot.mode} region={boot.region} onApply={applyProfile} />
                  <AddonSettings {...props} />
                </div>
              ) : (
                <Component {...props} />
              )}
            </PanelBoundary>
          ) : (
            <div className="state-card">
              <h3>Empty viewport</h3>
              <p>Use the + menu to add a tool.</p>
            </div>
          )}
        </div>
      </section>
    );
  }
  const maxGroup = layout.groups.find((g) => g.id === layout.maximized);
  const multi = layout.preset === 'terminal' || layout.preset === 'pair';
  return (
    <main className={'app density-' + layout.density}>
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <h1>
          Goblin <span>Ledger</span>
        </h1>
        <div className="toolbar-divider" />
        <button className="market-button" onClick={() => open('Settings')}>
          {boot.region ? String(boot.region).toUpperCase() + ' · PvP Alliance' : 'Choose home market'}{' '}
          <span>⌄</span>
        </button>
        <span className={'mode-label ' + (boot.mode === 'demo' ? 'demo' : '')}>
          {boot.mode === 'demo' ? 'Demo profile' : 'Live profile'}
        </span>
        <div className="header-actions">
          <button onClick={() => setLayoutsOpen(true)}>
            ▦ <span>Layouts</span>
          </button>
          <button onClick={() => open('Console')}>
            ›_ <span>Console</span>
          </button>
          <button aria-label="Settings" onClick={() => open('Settings')}>
            ⚙
          </button>
        </div>
      </header>
      <nav className="tool-nav" aria-label="Open workspace tool">
        {PANELS.filter((p) => p !== 'Settings' && p !== 'Console').map((p) => (
          <button key={p} onClick={() => open(p)}>
            {p}
          </button>
        ))}
      </nav>
      <div className="desk" data-preset={layout.preset}>
        {maxGroup ? (
          renderGroup(maxGroup)
        ) : multi ? (
          <div
            className="desk-split"
            style={{
              gridTemplateColumns:
                'minmax(0,' + layout.primaryWidth + 'fr) 6px minmax(0,' + (100 - layout.primaryWidth) + 'fr)',
            }}
          >
            {renderGroup(layout.groups[0])}
            <Splitter
              orientation="vertical"
              label="Primary viewport width"
              value={layout.primaryWidth}
              min={22}
              max={78}
              onChange={(v) => changeLayout((l) => ({ ...l, primaryWidth: v }))}
            />
            {layout.preset === 'terminal' ? (
              <div
                className="side-stack"
                style={{
                  gridTemplateRows:
                    'minmax(0,' +
                    layout.sideHeights[0] +
                    'fr) 6px minmax(0,' +
                    layout.sideHeights[1] +
                    'fr) 6px minmax(0,' +
                    layout.sideHeights[2] +
                    'fr)',
                }}
              >
                {layout.groups.slice(1).map((g, i) => (
                  <React.Fragment key={g.id}>
                    {i > 0 && (
                      <Splitter
                        orientation="horizontal"
                        label={'Side viewport ' + i + ' height'}
                        value={layout.sideHeights[i - 1]}
                        min={10}
                        max={Math.min(80, layout.sideHeights[i - 1] + layout.sideHeights[i] - 10)}
                        onChange={(v) =>
                          changeLayout((l) => {
                            const h = [...l.sideHeights];
                            h[i] += h[i - 1] - v;
                            h[i - 1] = v;
                            return { ...l, sideHeights: h };
                          })
                        }
                      />
                    )}{' '}
                    {renderGroup(g)}
                  </React.Fragment>
                ))}
              </div>
            ) : (
              renderGroup(layout.groups[1])
            )}
          </div>
        ) : (
          <div className={'desk-grid ' + layout.preset}>{layout.groups.map(renderGroup)}</div>
        )}
      </div>
      <footer className="statusbar">
        <span className={'connection ' + (stream === 'Connected' ? 'ok' : '')}>{stream}</span>
        <span>Last contact {lastContact?.toLocaleTimeString() ?? 'unknown'}</span>
        <span className="market-freshness">
          {boot.freshness
            ? 'Market as of ' + new Date(boot.freshness).toLocaleString()
            : 'Market snapshot time unavailable'}
        </span>
        {saving && (
          <button className="save-state" onClick={() => persist().catch(() => {})}>
            {saving}
            {saving.startsWith('Layout save failed') ? ' · Retry' : ''}
          </button>
        )}
        <span className="layout-status">{PRESETS[layout.preset]}</span>
      </footer>
      {problem && (
        <div className="problem" role="alert">
          {problem}{' '}
          <button aria-label="Dismiss notification" onClick={() => setProblem('')}>
            ×
          </button>
        </div>
      )}
      {layoutsOpen && (
        <LayoutDialog workspace={workspace} change={change} onClose={() => setLayoutsOpen(false)} />
      )}
    </main>
  );
}
