export const GUIDE = 'https://www.icy-veins.com/wow-forever/herbalism-leveling-guide';
export const ACTIONS = ['gather', 'buy', 'craft', 'sell', 'changed use', 'watch'];
export const guideRecord = Object.freeze({
  url: GUIDE, publisher: 'Icy Veins', title: 'Herbalism leveling guide',
  publishedOn: '2026-11-03', revisedOn: '2026-11-04', effectiveOn: null,
  action: 'gather', routeId: 'skulk-rock', itemIds: [8845],
  summary: 'At Herbalism 245, take the detour into Skulk Rock for Ghost Mushroom, then rejoin the Hinterlands circuit.',
  evidence: 'curated guide', reach: null
});

export function canonicalUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter a valid HTTPS source link.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 2000) throw new Error('Use an HTTPS source link without credentials.');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.href;
}

export function dateOnly(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Use a calendar date in YYYY-MM-DD format.');
  const time = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0,10) !== value) throw new Error('Invalid calendar date.');
  return value;
}

function field(value, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error('Missing or oversized research field.');
  return value.trim();
}

export const USE_KINDS = ['source report', 'build change', 'observed turn-in'];

export function utcInstant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value)))
    throw new Error('Supply an observation time with a timezone.');
  dateOnly(value.slice(0,10));
  return new Date(value).toISOString();
}

export function normalizeArticle(input) {
  const action = input.action;
  if (!ACTIONS.includes(action)) throw new Error('Unknown research action.');
  const routeId = input.routeId || null;
  if (routeId !== null && (typeof routeId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(routeId))) throw new Error('Invalid route ID.');
  const raw = input.itemIds ?? [];
  if (!Array.isArray(raw) || raw.length > 20 || raw.some(i => !Number.isSafeInteger(i) || i < 1 || i > 2147483647)) throw new Error('Enter positive numeric item IDs.');
  const itemIds = [...new Set(raw)].sort((a,b) => a-b);
  const publishedOn = dateOnly(input.publishedOn), revisedOn = dateOnly(input.revisedOn);
  if (revisedOn && publishedOn && revisedOn < publishedOn) throw new Error('Revision predates publication.');
  const kind = action === 'changed use' ? input.useKind || 'source report' : null;
  const effectiveOn = dateOnly(input.effectiveOn);
  if (kind && !USE_KINDS.includes(kind)) throw new Error('Unknown item-use evidence type.');
  if (kind && !itemIds.length) throw new Error('Link at least one affected item ID.');
  if (kind === 'build change' && !effectiveOn) throw new Error('Enter the build change’s effective date.');
  const localId = input.localId;
  if (localId != null && (typeof localId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(localId)))
    throw new Error('Invalid local observation ID.');
  const url = !input.url && localId && (kind === 'observed turn-in' || action === 'watch') ? null : canonicalUrl(input.url);
  const change = {};
  if (localId) change.localId = localId.toLowerCase();
  if (kind && kind !== 'source report') {
    change.useKind = kind;
    change.useContext = field(input.useContext,160);
    if (kind === 'observed turn-in') {
      change.observedAt = utcInstant(input.observedAt);
      if (effectiveOn && change.observedAt.slice(0,10) < effectiveOn) throw new Error('The hand-in predates the effective date.');
    }
  }
  return {url, publisher: field(input.publisher,100), title: field(input.title,200), summary: field(input.summary,800),
    publishedOn, revisedOn, effectiveOn, action, routeId, itemIds,
    scope: routeId ? 'route' : 'item', reach: null, evidence: field(input.evidence || 'player note',50), ...change};
}

// Each surviving source revision is one piece of evidence about its tagged items.
export function itemUseThesis(article, asOf) {
  if (article.action !== 'changed use' || !article.itemIds.length) return null;
  if (article.useKind === 'observed turn-in') return 'Turn-in observed';
  if (article.useKind !== 'build change') return 'Possible item use';
  const day = asOf.slice(0,10);
  if (article.effectiveOn > day) return 'Scheduled build change';
  if (article.effectiveOn === day) return 'Build change dated today (time unknown)';
  return 'Build change reported effective';
}

export function comparisonDay(article) {
  if (article.useKind === 'observed turn-in') return article.observedAt.slice(0,10);
  if (article.action === 'changed use') return article.effectiveOn || article.revisedOn || article.publishedOn;
  return article.revisedOn || article.publishedOn;
}

// Pair hours at equal offsets either side of the guide date; omit the entire
// publication/revision day because the publisher did not establish a UTC instant.
export function compareWindows(observations, day, {hours = 24, cutoff = Date.now()} = {}) {
  dateOnly(day);
  const start = Date.parse(day + 'T00:00:00Z');
  const hour = 3600000, afterStart = start + 24 * hour;
  const result = {hours, before: 0, after: 0, pairs: 0, priceChangeCopper: null, supplyChange: null, reason: 'No comparable observations'};
  if (!Number.isFinite(start)) return {...result,reason:'Source date unknown'};
  const sides = [new Map(), new Map()];
  const identities = new Set();
  for (const obs of observations) {
    const t = Date.parse(obs.observedAt);
    if (!Number.isFinite(t) || t > cutoff || (obs.availableAt && Date.parse(obs.availableAt) > cutoff)) continue;
    let side, slot;
    if (t >= start - hours*hour && t < start) {side=0; slot=Math.floor((t - start + hours*hour)/hour);}
    else if (t >= afterStart && t < afterStart + hours*hour) {side=1; slot=Math.floor((t-afterStart)/hour);}
    else continue;
    if (!obs.provider || !obs.house || !obs.method || obs.ask === null || obs.listed === null ||
        !Number.isSafeInteger(obs.ask) || !Number.isSafeInteger(obs.listed) || obs.ask <= 0 || obs.listed < 0) continue;
    identities.add(JSON.stringify([obs.provider,obs.house,obs.method]));
    const prev = sides[side].get(slot);
    if (!prev || t > prev.t) sides[side].set(slot, {...obs,t});
  }
  [result.before,result.after] = sides.map(side => side.size);
  if (identities.size !== 1) {
    if (identities.size > 1) result.reason = 'House, provider or method changed';
    return result;
  }
  let price = 0, supply = 0;
  for (const [slot, before] of sides[0]) {
    const after = sides[1].get(slot);
    if (!after) continue;
    price += after.ask - before.ask;
    supply += after.listed - before.listed;
    result.pairs++;
  }
  if (result.pairs) {
    result.priceChangeCopper = price / result.pairs;
    result.supplyChange = supply / result.pairs;
    result.reason = null;
  }
  return result;
}
