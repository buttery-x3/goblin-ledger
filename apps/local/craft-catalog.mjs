import {SOURCE} from '../../packages/domain/market.mjs';
import {checkedInt} from '../../packages/domain/farms.mjs';
import {quoteCraft} from '../../packages/domain/crafts.mjs';
import {ensureStore, getHouse, latest} from './market-store.mjs';
import {getMarketItem, getMarketBook} from './market.mjs';

const catalogUrl = 'https://' + SOURCE + '/api/recipes';
const missing = () => Object.assign(new Error('Imported recipe not found'), {statusCode:404});

function provenance(db) {
  const data = db.prepare('SELECT revision,retrieved,etag,modified FROM market_catalog_meta WHERE source=?').get(SOURCE);
  return {source:catalogUrl, revision:data?.revision ?? null, retrieved:data?.retrieved ?? null,
    etag:data?.etag ?? null,lastModified:data?.modified ?? null};
}

function browse(profile, query) {
  ensureStore(profile);
  const {db} = profile;
  const offset = checkedInt(Number(query.offset ?? 0), 'Page offset', 0, Number.MAX_SAFE_INTEGER);
  const limit = checkedInt(Number(query.limit ?? 25), 'Page size', 1, 100);
  const q = String(query.q ?? '').trim().toLowerCase().slice(0,150);
  const clauses = [], args = [];
  if (q) {
    clauses.push(`(instr(lower(json_extract(r.data,'$.name')),?)>0
      OR instr(lower(json_extract(r.data,'$.profession')),?)>0 OR CAST(r.id AS TEXT)=?
      OR r.id IN (SELECT u.recipe FROM market_recipe_uses u LEFT JOIN market_recipe_items i ON i.id=u.item
        WHERE instr(lower(i.name),?)>0 OR CAST(u.item AS TEXT)=?))`);
    args.push(q,q,q,q,q);
  }
  if (query.itemId !== undefined) {
    const id = checkedInt(Number(query.itemId), 'Linked item ID', 1, Number.MAX_SAFE_INTEGER);
    if (query.role === 'output') clauses.push("json_extract(r.data,'$.output')=?");
    else if (query.role === 'input') clauses.push("EXISTS (SELECT 1 FROM json_each(r.data,'$.inputs') i WHERE json_extract(i.value,'$.id')=?)");
    else throw Object.assign(new Error('Choose input or output for a linked item'), {statusCode:400});
    args.push(id);
  }
  const from = ' FROM market_recipes r' + (clauses.length ? ' WHERE '+clauses.join(' AND ') : '');
  const count = db.prepare('SELECT count(*) AS n'+from).get(...args).n;
  const rows = db.prepare(`SELECT r.id, json_extract(data,'$.name') AS name,
    json_extract(data,'$.profession') AS profession`+from+' ORDER BY name COLLATE NOCASE,r.id LIMIT ? OFFSET ?')
    .all(...args,limit,offset);
  return {count,offset,limit,recipes:rows,catalog:provenance(db)};
}

function lookup(profile, rawId) {
  ensureStore(profile);
  const id = checkedInt(Number(rawId),'Recipe ID',1,Number.MAX_SAFE_INTEGER);
  const {db} = profile;
  const saved = db.prepare('SELECT data FROM market_recipes WHERE id=?').get(id);
  if (!saved) throw missing();
  const record = JSON.parse(saved.data);
  const itemName = db.prepare('SELECT name FROM market_recipe_items WHERE id=?');
  const vendorPrice = db.prepare('SELECT price FROM market_vendor WHERE id=?');
  const nameOf = item => itemName.get(item)?.name ?? getMarketItem(profile,item)?.name ?? ('Item #'+item);
  const sums = new Map();
  for (const {id,qty} of record.inputs) {
    sums.set(id,checkedInt((sums.get(id) ?? 0)+qty,'Units per craft',1,Number.MAX_SAFE_INTEGER));
  }
  return {id,name:record.name,profession:record.profession,outputId:record.output,
    outputName:record.output == null ? null : nameOf(record.output),
    outputUnits:record.quantity,reportedQuantity:record.reportedQuantity ?? null,
    inputs:[...sums].map(([itemId,units])=>({itemId,units,name:nameOf(itemId),
      vendorReferenceCopper:vendorPrice.get(itemId)?.price ?? null})),
    source:catalogUrl,catalog:provenance(db)};
}

function quote(profile, id, body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('Provide a recipe quote as a JSON object'), {statusCode:400});
  }
  const owned = body.owned === undefined ? {} : body.owned;
  if (owned === null || typeof owned !== 'object' || Array.isArray(owned)) {
    throw Object.assign(new Error('Owned units must be an object keyed by item ID'), {statusCode:400});
  }
  for (const [key,units] of Object.entries(owned)) {
    const itemId = checkedInt(Number(key),'Owned item ID',1,Number.MAX_SAFE_INTEGER);
    if (String(itemId) !== key) {
      throw Object.assign(new Error('Use a positive integer item ID for owned units'), {statusCode:400});
    }
    checkedInt(units,'Owned units',0,1000000);
  }
  const recipe = lookup(profile,id);
  if ('revision' in body && body.revision !== recipe.catalog.revision) {
    throw Object.assign(new Error('The catalog changed. Reload the recipe before quoting.'), {statusCode:409});
  }
  const quantity = checkedInt(body.quantity,'Batch size',1,1000);
  const feeBps = body.feeBps == null ? null : checkedInt(body.feeBps,'Sale cut',0,10000);
  const deposit = body.lostDepositCopper == null ? null : checkedInt(body.lostDepositCopper,'Lost deposit',0,1000000000);
  const house = getHouse(profile)?.key ?? null;
  const snapshot = house && latest(profile.db,house);
  const asks = {}, books = {};
  if (recipe.outputId != null) asks[recipe.outputId] = getMarketItem(profile,recipe.outputId);
  for (const {itemId} of recipe.inputs) {
    asks[itemId] = getMarketItem(profile,itemId);
    books[itemId] = getMarketBook(profile,itemId);
  }
  const result = quoteCraft(recipe,quantity,{asks,books,owned,feeBps,
    lostDepositCopper:deposit,t:snapshot?.t ?? null,house});
  if (!recipe.inputs.length) result.gaps.push('No ingredient quantities reported');
  if (recipe.outputId == null) result.gaps.push('No auctionable output item reported');
  if (deposit == null) result.gaps.push('Lost deposit unknown');
  if (result.gaps.length) result.incrementalCopper = null;
  const rows = result.rows.map(row => {
    const book = books[row.itemId];
    const ask = asks[row.itemId];
    const listed = ask && (ask.listed == null ? ask.ask != null : ask.listed > 0);
    return {...row,canCheck:!!listed && !book && profile.mode === 'live',
      book:book ? {tiers:book.levels.length,more:book.more,t:book.t,method:book.method} : null};
  });
  return {...result,rows,lostDepositCopper:deposit == null ? null : String(deposit),
    catalog:recipe.catalog,marketSource:snapshot?.source ?? null,marketRetrieved:snapshot?.retrieved ?? null,
    outputAskCopper:asks[recipe.outputId]?.ask ?? null,outputMethod:asks[recipe.outputId]?.method ?? null,
    basis:profile.mode};
}

export function registerCraftCatalog(app,ctx) {
  app.get('/api/v1/crafts/imported', req => browse(ctx.profile(),req.query));
  app.get('/api/v1/crafts/imported/:id', req => lookup(ctx.profile(),req.params.id));
  app.post('/api/v1/crafts/imported/:id/quote', req => quote(ctx.profile(),req.params.id,req.body ?? null));
}
