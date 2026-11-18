import {randomUUID} from 'node:crypto';
import {routesCatalog, checkedInt, validRun, farmReturns} from '../../packages/domain/farms.mjs';
import {recipes, quoteCraft, unlockPayback} from '../../packages/domain/crafts.mjs';
import {choices, boxComparison} from '../../packages/domain/transformations.mjs';
import {getMarketBook, getMarketItem, getMarketSeries} from './market.mjs';
import {routeExposure} from './research.mjs';
import {apprenticeCrate, herbBundles, fragment, compareBox, compareCrate} from '../../packages/domain/farm-choices.mjs';

function fail(message, code = 400) { throw Object.assign(new Error(message), {statusCode:code}); }
function initialise(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS farm_revisions (
      route TEXT NOT NULL, revision INTEGER NOT NULL, settings TEXT NOT NULL,
      PRIMARY KEY(route,revision)
    );
    CREATE TABLE IF NOT EXISTS farm_runs (
      id TEXT PRIMARY KEY, route TEXT NOT NULL, revision INTEGER NOT NULL,
      observed TEXT NOT NULL, details TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS farm_runs_route ON farm_runs(route,revision,observed DESC)
  `);
}

function mergedRoute(db, base) {
  const latest = db.prepare('SELECT revision,settings FROM farm_revisions WHERE route=? ORDER BY revision DESC LIMIT 1').get(base.id);
  return {...base,approachMinutes:0,...(latest ? JSON.parse(latest.settings) : {}),revision:latest?.revision ?? base.revision};
}
function savedRuns(db, route, characterId = null) {
  const actorClause = characterId ? " AND json_extract(details,'$.characterId')=?" : '';
  const args = [route.id,route.revision];
  if (characterId) args.push(characterId);
  return db.prepare('SELECT id,observed,details FROM farm_runs WHERE route=? AND revision=?'+actorClause+' ORDER BY observed DESC, id DESC LIMIT 500')
    .all(...args).map(r => ({id:r.id,observed:r.observed,...JSON.parse(r.details)}));
}

const demoRuns = {
  'skulk-rock': [30,12], 'jintha-alor': [15,7], 'maraudon-purple': [24,9]
};
function fixtureRun(route) {
  const numbers = demoRuns[route.id];
  if (!numbers || route.revision !== 1) return [];
  return [{elapsedMinutes:numbers[0],haul:[{itemId:route.outputId,units:numbers[1],exit:'auction'}],expenseCopper:0,coinCopper:0}];
}

function historicalBasis(profile, row) {
  if (!row) return null;
  const hour = 3600000, slot = Math.floor(row.t/hour)*hour;
  const series = getMarketSeries(profile,row.id,{after:slot-hour,before:slot});
  return series.filter(previous => previous.source===row.source && previous.house===row.house &&
    previous.method===row.method && previous.resolution===row.resolution).at(-1) ?? null;
}

function routeReport(profile, base, options, lookup, history) {
  const route = mergedRoute(profile.db,base);
  const actorId = options.characterId || null;
  if (actorId && (typeof actorId!=='string' || actorId.length>160)) fail('Invalid character ID');
  let saved = savedRuns(profile.db,route,actorId);
  let scope = actorId ? 'Selected character' : 'All characters';
  const allowFallback = !actorId || options.allowAggregate !== false;
  if (actorId && !saved.length && allowFallback) {
    saved = savedRuns(profile.db,route);
    scope = 'All characters · fallback';
  }
  const draft = options.scenarios?.[route.id];
  const samples = draft ? [validRun(draft)] : saved.length ? saved : profile.mode === 'demo' && allowFallback ? fixtureRun(route) : [];
  if (draft) scope = 'Manual scenario';
  else if (samples.length && !saved.length) scope = 'Synthetic benchmark';
  else if (actorId && !samples.length) scope = 'Selected character · no runs';
  const prices = {}, previous = {};
  const itemIds = new Set([route.outputId,...samples.flatMap(r => r.haul.map(s => s.itemId))]);
  const primaryOverride = options.unitCopper;
  for (const id of itemIds) {
    const item = lookup(id);
    if (item) {
      prices[id] = {ask:item.ask,sell:item.sell,t:item.t,house:item.house,source:item.source};
      if (primaryOverride == null && samples.length) previous[id] = history(id,item);
    }
  }
  if (primaryOverride != null) {
    prices[route.outputId] = {...prices[route.outputId],ask:checkedInt(primaryOverride,'Scenario price',0,1000000000)};
  }
  const approachMinutes = options.approaches?.[route.id] ?? route.approachMinutes;
  const fixed = {sessionMinutes:options.sessionMinutes ?? 60,approachMinutes,feeBps:options.feeBps ?? 500,
    primaryItemId:route.outputId,targetCopperPerHour:options.targetCopperPerHour ?? 100000};
  const returns = farmReturns(samples,{...fixed,prices});
  const usedIds = new Set(samples.flatMap(s => s.haul.filter(h => h.exit!=='keep').map(h => h.itemId)));
  const baseTimes = new Set([...usedIds].map(id => previous[id]?.t));
  const currentTimes = new Set([...usedIds].map(id => prices[id]?.t));
  let changeCopperPerHour = null, baselineTime = null;
  if (primaryOverride == null && returns.rateCopperPerHour != null && baseTimes.size===1 && currentTimes.size===1 &&
      !baseTimes.has(undefined) && !currentTimes.has(undefined)) {
    const earlier = farmReturns(samples,{...fixed,prices:previous}).rateCopperPerHour;
    if (earlier != null && Number.isSafeInteger(returns.rateCopperPerHour-earlier)) {
      changeCopperPerHour=returns.rateCopperPerHour-earlier;
      baselineTime=[...baseTimes][0];
    }
  }
  const guideArticles = routeExposure(profile,route.id);
  return {...route,...returns,approachMinutes,exposure:guideArticles.length,guideArticles,changeCopperPerHour,baselineTime,
    coverage:samples.length,quote:prices[route.outputId] ?? null,feeBps:options.feeBps ?? 500,
    actorId,sampleScope:scope,sampleLimit:500,
    yieldBasis:draft ? 'Scenario' : saved.length ? 'Personal runs' : samples.length ? 'Demo scenario' : 'Yield unknown',
    priceBasis:primaryOverride != null ? 'Scenario' : profile.mode === 'demo' ? 'Demo house' : prices[route.outputId]?.ask != null ? 'House ask' : 'Price unknown',
    runHistory:saved.slice(0,25)};
}

export function getRoutes(profile, options = {}) {
  initialise(profile.db);
  if (options.feeBps != null) checkedInt(options.feeBps,'Sale cut',0,10000);
  if (options.targetCopperPerHour != null) checkedInt(options.targetCopperPerHour,'Target hourly copper',0,1000000000);
  const cache = new Map();
  const lookup = id => {
    if (!cache.has(id)) cache.set(id,getMarketItem(profile,id));
    return cache.get(id);
  };
  const prior = new Map();
  const history = (id,row) => {
    if (!prior.has(id)) prior.set(id,historicalBasis(profile,row));
    return prior.get(id);
  };
  return routesCatalog.map(base => routeReport(profile,base,options,lookup,history));
}

function requireRoute(profile,id) {
  initialise(profile.db);
  const base = routesCatalog.find(r => r.id === id);
  if (!base) fail('Unknown route',404);
  return mergedRoute(profile.db,base);
}

function compareChoices(profile) {
  const example = profile.mode === 'demo' ? boxComparison(160000,16000) : null;
  return choices.map(choice => ({
    ...choice,result:choice.id === 'alcaz-box' && example
      ? 'Demo case: vendoring and buying one fragment leaves 7g 40s more; hand-in XP is forgone.'
      : 'Compare after confirming prices, holdings and gates.',
  }));
}

export function registerFarms(app,ctx) {
  app.get('/api/v1/farms', () => ({routes:getRoutes(ctx.profile())}));
  app.post('/api/v1/farms/compare', req => ({routes:getRoutes(ctx.profile(),req.body ?? {})}));
  app.put('/api/v1/farms/:id', req => {
    const profile = ctx.profile(), route = requireRoute(profile,req.params.id), body = req.body ?? {};
    if (body.revision !== route.revision) fail('Route changed. Reload its current revision before editing.',409);
    const name = body.name?.trim(), notes = body.notes?.trim();
    if (!name || name.length > 100 || !notes || notes.length > 1500) fail('Provide a route name and notes within the field limits.');
    const settings = {name,notes,approachMinutes:checkedInt(body.approachMinutes,'Approach',0,1440)};
    profile.db.prepare('INSERT INTO farm_revisions(route,revision,settings) VALUES(?,?,?)').run(route.id,route.revision+1,JSON.stringify(settings));
    return {id:route.id,revision:route.revision+1};
  });
  app.post('/api/v1/farms/:id/runs', (req,reply) => {
    const profile = ctx.profile(), route = requireRoute(profile,req.params.id), body = req.body ?? {};
    if (body.revision !== route.revision) fail('This route changed. Check which circuit the run belongs to.',409);
    const run = validRun(body);
    const id = String(body.id ?? randomUUID());
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(id)) fail('Invalid run identifier');
    const details = JSON.stringify(run);
    const previous = profile.db.prepare('SELECT route,revision,details FROM farm_runs WHERE id=?').get(id);
    if (previous) {
      const existing = JSON.stringify(validRun(JSON.parse(previous.details)));
      if (previous.route !== route.id || previous.revision !== route.revision || existing !== details) fail('Run ID already used',409);
      return {id,repeated:true};
    }
    profile.db.prepare('INSERT INTO farm_runs(id,route,revision,observed,details) VALUES(?,?,?,?,?)')
      .run(id,route.id,route.revision,new Date().toISOString(),details);
    reply.code(201);
    return {id,repeated:false};
  });
  app.get('/api/v1/farms/:id/history', req => {
    const profile = ctx.profile(), route = requireRoute(profile,req.params.id);
    const offset = checkedInt(Number(req.query?.offset ?? 0),'History offset',0,100000000);
    const rows = profile.db.prepare('SELECT id,revision,observed,details FROM farm_runs WHERE route=? ORDER BY observed DESC,id DESC LIMIT 50 OFFSET ?')
      .all(route.id,offset).map(r => ({id:r.id,revision:r.revision,observed:r.observed,...JSON.parse(r.details)}));
    return {rows,offset};
  });
  app.get('/api/v1/crafts/catalog', () => ({recipes,transformations:choices}));
  app.get('/api/v1/crafts/choices', () => ({choices:compareChoices(ctx.profile())}));
  app.post('/api/v1/crafts/choices', req => {
    const profile = ctx.profile(), body = req.body ?? {};
    const candidates = [apprenticeCrate,...herbBundles,fragment], asks = {}, books = {};
    let t = null, house = null;
    for (const item of candidates) {
      const ask = getMarketItem(profile,item.itemId);
      if (!ask) continue;
      t ??= ask.t;
      house ??= ask.house;
      asks[item.itemId] = ask;
      books[item.itemId] = getMarketBook(profile,item.itemId);
    }
    const scenario = body.prices ?? {};
    if (Object.keys(scenario).length) {
      // Manual prices form a complete separate scenario. Unset tiers remain gaps.
      t = 0; house = 'manual scenario';
      for (const item of candidates) {
        const entry = scenario[item.itemId];
        if (entry == null) continue;
        const price = checkedInt(entry.price,'Scenario price',0,1000000000);
        const units = checkedInt(entry.units,'Scenario depth',0,1000000);
        asks[item.itemId] = {t,house,ask:price};
        books[item.itemId] = {t,house,levels:[{price,units}]};
      }
    }
    const market = {t,house,asks,books,owned:body.owned ?? {},feeBps:500};
    const writReady = body.hasWrit===true && body.hasTunic===true && body.daily==='available';
    return {basis:Object.keys(scenario).length ? 'Scenario' : profile.mode, t,house,
      crate:compareCrate(body,market),box:compareBox(body,market),
      writ:{ready:writReady,reputation:writReady ? 75 : null,
        source:'https://www.wowhead.com/forever/quest=94241/craftsmans-writ-dark-leather-tunic'}};
  });
  app.post('/api/v1/crafts/quote', req => {
    const profile = ctx.profile(), body = req.body ?? {};
    const recipe = recipes.find(r => r.id === body.recipeId);
    if (!recipe) fail('Unknown recipe',404);
    const quantity = checkedInt(body.quantity,'Batch size',1,1000);
    const output = getMarketItem(profile,recipe.outputId);
    const asks = {[recipe.outputId]:output}, books = {}, vendors = {};
    for (const reagent of recipe.inputs) {
      asks[reagent.itemId] = getMarketItem(profile,reagent.itemId);
      books[reagent.itemId] = getMarketBook(profile,reagent.itemId);
      if (reagent.vendor && (body.vendor || profile.mode === 'demo')) {
        vendors[reagent.itemId] = body.vendor ?? {bundleUnits:1,bundleCopper:100,stockBundles:1000};
      }
    }
    const inputs = {books,asks,owned:body.owned ?? {},vendors,
      t:output?.t,house:output?.house,feeBps:checkedInt(body.feeBps ?? 500,'Sale cut',0,10000),
      lostDepositCopper:body.lostDepositCopper ?? 0};
    const result = quoteCraft(recipe,quantity,inputs);
    if (body.unlockCopper != null) result.breakEvenSales = unlockPayback(recipe,quantity,inputs,body.unlockCopper);
    return {...result,basis:profile.mode,source:output?.source ?? recipe.source,vendorBasis:body.vendor ? 'Scenario' : profile.mode === 'demo' ? 'Demo scenario' : 'Current book only'};
  });
}
