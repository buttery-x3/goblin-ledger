import {randomUUID} from 'node:crypto';
import {ACTIONS,compareWindows,comparisonDay,normalizeArticle,utcInstant} from '../../packages/domain/research.mjs';
import {challengeCatalog,legacyRules,progressionForCharacter} from '../../packages/domain/progression.mjs';
import {accountProgress,articles,initResearch,writeRevision} from './research/store.mjs';
import {annotateLocally,fetchGuide} from './research/sources.mjs';

const bad = message => Object.assign(new Error(message),{statusCode:400});
const maxDay = 86400000;

function filters(query = {}) {
  const {asOf,routeId,history} = query;
  let cutoff;
  if (asOf) {
    try {cutoff = utcInstant(asOf);} catch {throw bad('Supply a valid timestamp with a timezone for replay.');}
  }
  const itemId = query.itemId === undefined ? null : Number(query.itemId);
  if (itemId !== null && (!Number.isSafeInteger(itemId) || itemId < 1)) throw bad('Invalid item ID.');
  return {asOf:cutoff,routeId,itemId,includeHistory:history === 'true'};
}

export function routeExposure(profile,routeId,asOf) {
  return articles(profile.db,{routeId,asOf}).filter(a => a.action === 'gather');
}

function aiConfig(db) {
  initResearch(db);
  return JSON.parse(db.prepare("SELECT data FROM research_settings WHERE id='ai'").get()?.data || 'null');
}

export function registerResearch(app,ctx) {
  const profile = () => ctx.profile();
  async function account(p) {
    const getPool = ctx.personalPool || (await import('./personal/ledger.mjs')).pool;
    return accountProgress(p.db,getPool(p));
  }
  ctx.jobs.register('research.refresh',async ({profile,log,signal,finishAs}) => {
    log('Checking Icy Veins for the dated Skulk Rock recommendation.');
    const article = await fetchGuide({signal});
    const result = writeRevision(profile.db,article);
    if (!result.changed) finishAs?.('no-change','Source revision unchanged');
    log(result.changed ? 'Published a new guide revision.' : 'Saved revision still matches the source.');
    return result;
  },{manual:true,retry:true,description:'Check the herbalism guide for revised advice',source:'Icy Veins'});
  ctx.jobs.register('research.annotate',async ({profile,payload,signal,log}) => {
    const db = profile.db, article = articles(db).find(a => a.id === payload.id && a.revision === payload.revision);
    if (!article) throw new Error('The article changed. Reload it before generating a note.');
    const note = await annotateLocally(article,aiConfig(db),{signal});
    db.prepare('INSERT OR REPLACE INTO research_notes VALUES(?,?,?,?)').run(article.id,article.revision,new Date().toISOString(),JSON.stringify(note));
    log('Stored one model note linked to its source revision.');
    return note;
  },{description:'Generate an optional local article note',source:'Local language model'});
  app.get('/api/v1/research',async request => {
    const db = profile().db;
    const options = filters(request.query);
    return {items:articles(db,options),actions:ACTIONS,ai:aiConfig(db),asOf:options.asOf || null};
  });
  app.post('/api/v1/research',async request => {
    let article;
    const body = request.body ?? {};
    const isNewObservation = body.action === 'changed use' && body.useKind === 'observed turn-in' && body.baseRevision === undefined;
    const localId = body.localId ?? (isNewObservation ? randomUUID() : undefined);
    try {article = normalizeArticle({...body,localId,evidence:'player note'});} catch(e){throw bad(e.message);}
    return writeRevision(profile().db,article,undefined,request.body?.baseRevision);
  });
  app.post('/api/v1/research/refresh',async () => ctx.jobs.run('research.refresh',profile()));
  app.put('/api/v1/research/ai',async request => {
    const {port,model} = request.body ?? {};
    if (!Number.isInteger(port) || port < 1 || port > 65535 || typeof model !== 'string' || model.length > 160) throw bad('Set a valid localhost port and model name.');
    const db = profile().db; initResearch(db);
    db.prepare('INSERT OR REPLACE INTO research_settings VALUES(?,?)').run('ai',JSON.stringify(model.trim() ? {port,model:model.trim()} : null));
    return {ai:aiConfig(db)};
  });
  app.post('/api/v1/research/:id/annotation',async request => {
    if (!Number.isSafeInteger(request.body?.revision)) throw bad('Select an article revision.');
    return ctx.jobs.run('research.annotate',profile(),{id:request.params.id,revision:request.body.revision});
  });
  app.get('/api/v1/research/:id/response',async request => {
    const p = profile(), options = filters(request.query);
    const article = articles(p.db,options).find(a => a.id === request.params.id);
    if (!article) throw Object.assign(new Error('Research record unavailable at that time.'),{statusCode:404});
    const id = options.itemId || article.itemIds[0], day = comparisonDay(article);
    if (!day || !id) return {comparison:null,reason:'An item and dated source are required.'};
    const start = Date.parse(day+'T00:00:00Z'), cutoff = options.asOf ? Date.parse(options.asOf) : Date.now();
    const {getMarketSeries} = await import('./market.mjs');
    const history = getMarketSeries(p,id,{after:start-maxDay,before:start+2*maxDay});
    const rows = history.map(h => ({provider:h.source,house:h.house,method:h.method,ask:h.ask,listed:h.listed,
      observedAt:new Date(h.t).toISOString(),availableAt:h.retrievedAt ? new Date(h.retrievedAt).toISOString() : null}));
    // A historical replay requires dated acquisition evidence as well as market times.
    const usable = options.asOf ? rows.filter(h => h.availableAt) : rows;
    return {itemId:id,day,scope:p.region,comparison:compareWindows(usable,day,{cutoff})};
  });
  app.get('/api/v1/progression/account',async () => account(profile()));
  app.put('/api/v1/progression/account',async request => {
    const {id,state} = request.body ?? {};
    if (!challengeCatalog().some(c => c.id === id) || ![true,false,null].includes(state)) throw bad('Invalid challenge or completion state.');
    const p=profile(), {scope}=await account(p), db=p.db;
    if (request.body.scope !== undefined && scope !== request.body.scope) throw Object.assign(new Error('Account selection changed. Reload this panel.'),{statusCode:409});
    if (state === null) db.prepare('DELETE FROM legacy_completion WHERE pool=? AND id=?').run(scope,id);
    else db.prepare('INSERT OR REPLACE INTO legacy_completion VALUES(?,?,?,?)').run(scope,id,Number(state),new Date().toISOString());
    return accountProgress(db,scope);
  });
  app.post('/api/v1/progression/preview',async request => {
    const c = request.body?.character;
    if (!c || typeof c !== 'object' || (c.level != null && (!Number.isSafeInteger(c.level) || c.level < 1 || c.level > 60))) throw bad('Select a level between 1 and 60.');
    if ((c.professions != null && (!Array.isArray(c.professions) || c.professions.length>20 || c.professions.some(p => !p || typeof p.name!=='string' || !Number.isSafeInteger(p.skill) || p.skill<0 || p.skill>10000))) ||
        (c.knownRecipeIds != null && (!Array.isArray(c.knownRecipeIds) || c.knownRecipeIds.length>10000 || c.knownRecipeIds.some(id=>!Number.isSafeInteger(id) || id<1)))) throw bad('Supply numeric skills and a list of known recipe IDs.');
    return {result:progressionForCharacter(c,(await account(profile())).completion),rules:legacyRules};
  });
}
