export const overlays = {
  rate: { name: 'Estimated return', unit: 'g/h', field: 'rateCopperPerHour' },
  change: { name: 'Change in return', unit: 'g/h', field: 'changeCopperPerHour' },
  exposure: { name: 'Guide exposure', unit: 'sources', field: 'exposure' },
  coverage: { name: 'Observation coverage', unit: 'observations', field: 'coverage' },
};

export function numberValue(route, overlay) {
  const value = route[overlays[overlay].field];
  return Number.isFinite(value) ? value : null;
}

export function matchesAtlasFilters(route, pane, character) {
  if (pane.routeType && pane.routeType !== 'all' && route.type !== pane.routeType) return false;
  if (pane.yieldBasis && route.yieldBasis !== pane.yieldBasis) return false;
  if (pane.sessionMinutes) {
    const available = pane.sessionMinutes - (route.approachMinutes ?? 0);
    if (available <= 0 || (route.runCount > 0 && route.elapsedMinutes / route.runCount > available))
      return false;
  }
  if (pane.atlasActor) {
    if (!character) return false;
    if (route.class && character.class !== route.class) return false;
    if (route.profession) {
      const skill = character.professions?.find(
        (p) => p.name?.toLowerCase() === route.profession.toLowerCase(),
      )?.skill;
      if (!Number.isFinite(skill) || skill < route.skill) return false;
    }
  }
  return true;
}

export function measure(value, overlay) {
  if (value === null) return 'Unknown';
  if (overlay === 'rate' || overlay === 'change')
    return (value / 10000).toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' g/h';
  return value.toLocaleString() + ' ' + overlays[overlay].unit;
}

export function metricScale(routes, overlay) {
  const values = routes.map((r) => numberValue(r, overlay)).filter((n) => n !== null);
  return { known: values.length > 0, low: Math.min(0, ...values), high: Math.max(0, ...values) };
}

export function colour(value, { low, high }) {
  if (value === null) return null;
  if (value === 0) return '#374c49';
  const fraction = Math.min(1, Math.abs(value / (value < 0 ? low : high)));
  const hue = value < 0 ? 20 : 155;
  return 'hsl(' + hue + ', ' + (22 + 22 * fraction) + '%, ' + (27 + 24 * fraction) + '%)';
}

function asOf(timestamp) {
  const time = timestamp == null ? null : new Date(timestamp);
  return time && Number.isFinite(time.getTime()) ? time.toLocaleString() : 'unobserved';
}

export function zoneSummary(routes, overlay) {
  const eligible = routes.filter((r) => numberValue(r, overlay) !== null);
  if (!eligible.length) return { value: null, detail: 'No qualifying metric' };
  const winning = (list, by) => list.reduce((a, b) => (by(a) >= by(b) ? a : b));
  const winner = winning(eligible, (r) => numberValue(r, overlay));
  const value = numberValue(winner, overlay);
  const details = [
    winner.name,
    measure(value, overlay),
    eligible.length + ' qualifying routes',
    winner.yieldBasis ?? 'Yield basis unknown',
    'Quote ' + asOf(winner.quote?.t),
  ];
  if (overlay === 'change') {
    details.push('Baseline ' + asOf(winner.baselineTime));
    const comparable = eligible.every(
      (r) =>
        Number.isFinite(r.rateCopperPerHour) &&
        r.baselineTime != null &&
        r.baselineTime === winner.baselineTime &&
        r.quote?.t != null &&
        r.quote.t === winner.quote?.t,
    );
    if (comparable) {
      const former = winning(eligible, (r) => r.rateCopperPerHour - r.changeCopperPerHour);
      const now = winning(eligible, (r) => r.rateCopperPerHour);
      if (former.id !== now.id)
        details.push('Highest return changed from ' + former.name + ' to ' + now.name);
    }
  }
  return { value, detail: details.join(' · ') };
}
