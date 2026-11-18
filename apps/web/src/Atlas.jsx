import React, { useEffect, useId, useRef, useState } from 'react';

import {
  overlays,
  numberValue,
  measure,
  metricScale,
  colour,
  zoneSummary,
  matchesAtlasFilters,
} from './atlas-metrics.js';

// Original overview silhouettes, in a north-up schematic frame. Route positions
// are locality markers. The outlines are never used for distances or pathfinding.
const coasts = [
  'M142 63l19 5 10-9 15 9 1 14 14 7-1 13 12 8 16-4 7 9-8 18 11 15-1 19 12 10-8 18 4 10-14 17-4 18 10 14 15 4 12 19-1 13 17 13-3 13 9 16-6 16 8 14-9 11 3 12-17 5-7 12-19-2-17 9-21-7-14 5-20-12-6-22-9-7 5-14-11-11 7-14-15-11 3-12-13-6 4-18-12-6-4-18 12-11-3-22 12-3 1-15 15-8 1-12-11-12 9-9-7-17 7-13-12-9 7-10-10-15 7-8-8-12z',
  'M471 102l18-13 12 5 13-6 8 7 16-3 3 15 18 1 3 15 15 11-6 10 12 8-4 14 15 9-7 11 9 9-5 13-20 3-7 10-12-1-9 12 7 10 2 16 9 9-11 10 4 13 13 7 1 14 13 15-6 8 11 21-9 14-2 16-14 6-4 17-7 8 3 10-11 8-5 16-14-6-6-18-12-7 5-18-17-11 1-14-13-6-4-16-10-9 7-18-12-7 4-15 15-8-8-11 12-13-5-9 11-8-1-14-15-3-4-12-16-8-5-18 9-5-4-13-10-9 4-14-8-5 11-14-3-10 15-5-9-12 10-4z',
];
const ranges = [
  'M137 104q34 17 50 48t19 46m-62-69q24 11 40 47t14 38m-43-12q35 11 52 40t37 53m-80-63q19 7 33 31t27 43m-41 20q26-12 56 4m-47 8q25-9 48 6',
  'M476 141q26 16 59 9t33 11m-82-5q18 11 40 3t39 8m-58 38q10-12 30-6m-28 20q5-11 21-10m-48 66q25 10 48 3m-45 9q16 9 38 2m-23 29q16 3 35 23m-33-14q17 7 29 24',
];
const regions = [
  { name: 'Desolace', path: 'M143 253l14-7 19 5 11-4 15 13-4 18-11 9-23 0-9-12-12-4z', label: [169, 298] },
  {
    name: 'The Hinterlands',
    path: 'M502 201l15-7 12 4 14-4 15 7 7 14-9 9-15-2-9 9-18-3-2-12-12-4z',
    label: [544, 244],
  },
];
const mapWidth = 680;
const mapHeight = 500;

export function Atlas({
  routes,
  pane,
  updatePane,
  onSelectRoute,
  selectedRoute,
  api,
  mode,
  region,
  refreshKey,
}) {
  const id = useId().replace(/:/g, '');
  const svg = useRef(null);
  const overlay = Object.hasOwn(overlays, pane.overlay) ? pane.overlay : 'rate';
  const type = pane.routeType || 'all';
  const [showFilters, setShowFilters] = useState(false);
  const [actors, setActors] = useState([]);
  const [actorError, setActorError] = useState('');
  useEffect(() => {
    if (!showFilters && !pane.atlasActor) return;
    let current = true;
    api('/personal/characters')
      .then((data) => {
        if (current) {
          setActors(data.characters ?? []);
          setActorError('');
        }
      })
      .catch((error) => {
        if (current) {
          setActors([]);
          setActorError(error.message);
        }
      });
    return () => {
      current = false;
    };
  }, [api, showFilters, pane.atlasActor, mode, region, refreshKey]);
  const manual = { professions: [{ name: pane.manualProfession, skill: pane.manualSkill }] };
  const character = pane.atlasActor === 'manual' ? manual : actors.find((a) => a.id === pane.atlasActor);
  const filtered = routes.filter((r) => matchesAtlasFilters(r, pane, character));
  const selection = routes.find((r) => r.id === selectedRoute);
  const tones = metricScale(filtered, overlay);
  const bounds =
    Array.isArray(pane.extent) && pane.extent.length === 3 && pane.extent.every(Number.isFinite)
      ? pane.extent
      : [340, 250, 1];
  const scale = Math.max(1, Math.min(4, bounds[2]));
  const width = mapWidth / scale,
    height = mapHeight / scale;
  const [cx, cy] = bounds;
  const viewX = Math.max(0, Math.min(mapWidth - width, cx - width / 2));
  const viewY = Math.max(0, Math.min(mapHeight - height, cy - height / 2));
  const zoom = (amount) => updatePane({ extent: [cx, cy, Math.max(1, Math.min(4, scale * amount))] });
  const pan = (dx, dy) =>
    updatePane({
      extent: [
        Math.max(width / 2, Math.min(mapWidth - width / 2, viewX + width / 2 + dx * width * 0.15)),
        Math.max(height / 2, Math.min(mapHeight - height / 2, viewY + height / 2 + dy * height * 0.15)),
        scale,
      ],
    });
  const visible = filtered.filter(
    (r) =>
      r.geometry?.space === 'world-schematic' &&
      [r.geometry.x, r.geometry.y].every((n) => Number.isFinite(n) && n >= 0 && n <= 100),
  );
  return (
    <div className="atlas">
      <div className="atlas-toolbar">
        <label>
          Overlay
          <select value={overlay} onChange={(e) => updatePane({ overlay: e.target.value })}>
            {Object.entries(overlays).map(([key, o]) => (
              <option key={key} value={key}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Farm type
          <select value={type} onChange={(e) => updatePane({ routeType: e.target.value })}>
            <option value="all">All routes</option>
            {[...new Set(routes.map((r) => r.type))].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <button aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}>
          Filters{pane.atlasActor || pane.yieldBasis || pane.sessionMinutes ? ' •' : ''}
        </button>
      </div>
      {showFilters && (
        <div className="atlas-toolbar">
          <label>
            Session
            <select
              value={pane.sessionMinutes || 0}
              onChange={(e) => updatePane({ sessionMinutes: Number(e.target.value) })}
            >
              <option value="0">Any duration</option>
              {[15, 30, 60, 120].map((n) => (
                <option key={n} value={n}>
                  {n} min
                </option>
              ))}
            </select>
          </label>
          <label>
            Yield basis
            <select
              value={pane.yieldBasis || ''}
              onChange={(e) => updatePane({ yieldBasis: e.target.value })}
            >
              <option value="">All evidence</option>
              {[...new Set([...routes.map((r) => r.yieldBasis), pane.yieldBasis].filter(Boolean))].map(
                (b) => (
                  <option key={b}>{b}</option>
                ),
              )}
            </select>
          </label>
          <label>
            Character
            <select
              value={pane.atlasActor || ''}
              onChange={(e) => updatePane({ atlasActor: e.target.value })}
            >
              <option value="">Any character</option>
              {actors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
              <option value="manual">Manual skill</option>
            </select>
          </label>
          {pane.atlasActor === 'manual' && (
            <>
              <label>
                Profession
                <select
                  value={pane.manualProfession || ''}
                  onChange={(e) => updatePane({ manualProfession: e.target.value })}
                >
                  <option value="">Choose</option>
                  {[...new Set(routes.map((r) => r.profession).filter(Boolean))].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              <label>
                Skill
                <input
                  type="number"
                  min="0"
                  max="1000"
                  value={pane.manualSkill ?? ''}
                  onChange={(e) =>
                    updatePane({
                      manualSkill:
                        e.target.value === ''
                          ? null
                          : Math.max(0, Math.min(1000, Math.trunc(Number(e.target.value)))),
                    })
                  }
                />
              </label>
            </>
          )}
          {actorError && <p role="status">{actorError}</p>}
          {pane.sessionMinutes > 0 && (
            <small>Includes unmeasured routes. Timed routes must fit one complete loop after travel.</small>
          )}
        </div>
      )}
      <div className="atlas-canvas">
        <div className="map-caption">
          <span className="eyebrow">World Atlas</span>
          <strong>Azeroth</strong>
        </div>
        <svg
          className="world-map"
          ref={svg}
          role="group"
          aria-label="Schematic world farm map"
          viewBox={[viewX, viewY, width, height].join(' ')}
          onKeyDown={(e) => {
            const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
              e.key
            ];
            if (delta && e.target === svg.current) {
              e.preventDefault();
              pan(...delta);
            }
          }}
          tabIndex="0"
        >
          <defs>
            <pattern id={id + '-grid'} width="22" height="22" patternUnits="userSpaceOnUse">
              <path d="M22 0H0V22" fill="none" stroke="#42625b" opacity=".22" strokeWidth=".65" />
            </pattern>
            <pattern id={id + '-unknown'} width="5" height="5" patternUnits="userSpaceOnUse">
              <rect width="5" height="5" fill="#33463f" />
              <path d="M0 5L5 0" stroke="#62746b" strokeWidth=".8" />
            </pattern>
          </defs>
          <rect width="680" height="500" fill={'url(#' + id + '-grid)'} />
          {coasts.map((d, i) => (
            <g key={d}>
              <path d={d} fill="#34483f" stroke="#233e38" strokeWidth="9" strokeLinejoin="round" />
              <path d={d} fill="#34483f" stroke="#859083" strokeWidth="1.1" />
              <path d={ranges[i]} fill="none" stroke="#899984" opacity=".32" strokeWidth=".9" />
            </g>
          ))}
          <text x="98" y="86" className="map-label">
            KALIMDOR
          </text>
          <text x="403" y="77" className="map-label">
            EASTERN KINGDOMS
          </text>
          {regions.map((z) => {
            const matches = filtered.filter(
              (r) => r.zone.replace(/^The /, '') === z.name.replace(/^The /, ''),
            );
            const { value, detail } = zoneSummary(matches, overlay);
            return (
              <g key={z.name}>
                <path
                  fill={
                    matches.length
                      ? value === null
                        ? 'url(#' + id + '-unknown)'
                        : colour(value, tones)
                      : '#34483f'
                  }
                  stroke="#78897c"
                  strokeWidth=".7"
                  d={z.path}
                >
                  <title>{z.name + ' · ' + detail}</title>
                </path>
                <text className="zone-label" x={z.label[0]} y={z.label[1]} textAnchor="middle">
                  {z.name}
                </text>
              </g>
            );
          })}
          {visible.map((r) => {
            const x = (r.geometry.x * mapWidth) / 100,
              y = (r.geometry.y * mapHeight) / 100;
            return (
              <g
                key={r.id}
                data-farm-id={r.id}
                role="button"
                tabIndex="0"
                aria-label={'Select ' + r.name}
                aria-pressed={selectedRoute === r.id}
                transform={'translate(' + x + ' ' + y + ')'}
                className={'hotspot ' + (r.id === selectedRoute ? 'chosen' : '')}
                onClick={() => onSelectRoute(r.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectRoute(r.id);
                  }
                }}
              >
                <title>
                  {r.name +
                    ' · ' +
                    (r.geometry.precision || 'approximate locality') +
                    ' · ' +
                    measure(numberValue(r, overlay), overlay)}
                </title>
                <circle r="9.5" fill="transparent" />
                <circle r="8" className="map-ring" />
                {r.type === 'Instance' ? (
                  <path className="map-dot dungeon" d="M0-5L5 0 0 5-5 0Z" />
                ) : (
                  <circle r="3.5" className="map-dot" />
                )}
              </g>
            );
          })}
        </svg>
        <div className="map-controls" aria-label="Map extent">
          <button aria-label="Zoom in" disabled={scale >= 4} onClick={() => zoom(1.5)}>
            +
          </button>
          <button aria-label="Zoom out" disabled={scale <= 1} onClick={() => zoom(1 / 1.5)}>
            −
          </button>
          <button aria-label="Reset map extent" onClick={() => updatePane({ extent: [340, 250, 1] })}>
            ⌖
          </button>
        </div>
        {scale > 1 && (
          <div className="pan-controls">
            {[
              ['←', -1, 0, 'west'],
              ['↑', 0, -1, 'north'],
              ['↓', 0, 1, 'south'],
              ['→', 1, 0, 'east'],
            ].map(([c, dx, dy, name]) => (
              <button key={name} aria-label={'Pan ' + name} onClick={() => pan(dx, dy)}>
                {c}
              </button>
            ))}
          </div>
        )}
        <div className="map-legend">
          <span className="hatch" /> Missing {overlay === 'rate' ? 'yield or price' : 'evidence'}
          {tones.known && (
            <>
              <span
                className="ramp"
                style={{
                  background:
                    'linear-gradient(90deg,' +
                    colour(tones.low, tones) +
                    ',#374c49,' +
                    colour(tones.high, tones) +
                    ')',
                }}
              />
              {tones.low === tones.high
                ? measure(tones.low, overlay)
                : measure(tones.low, overlay) + ' to ' + measure(tones.high, overlay)}
            </>
          )}
        </div>
      </div>
      <div className="atlas-directory">
        <div className="section-line">
          <h3>Route index</h3>
          <span>{filtered.length} routes · schematic locations</span>
        </div>
        {filtered.length === 0 && <p className="muted">No routes match this filter.</p>}
        <div className="route-index">
          {filtered.map((r) => (
            <button key={r.id} aria-pressed={r.id === selectedRoute} onClick={() => onSelectRoute(r.id)}>
              <i className={'route-symbol ' + (r.type === 'Instance' ? 'instance' : '')} />
              {r.name}
              <small>{r.zone}</small>
            </button>
          ))}
        </div>
        {selection && (
          <div className="atlas-selection">
            <strong>{selection.name}</strong>
            <span>
              {selection.output} · {measure(numberValue(selection, overlay), overlay)}
            </span>
          </div>
        )}
        <p className="atlas-basis">
          {mode === 'demo' ? 'Demo observations' : 'Latest available evidence'} ·{' '}
          {overlay === 'change'
            ? 'Comparable route and time window required'
            : overlay === 'rate'
              ? 'Estimated proceeds per elapsed hour'
              : overlays[overlay].name}
        </p>
      </div>
    </div>
  );
}
