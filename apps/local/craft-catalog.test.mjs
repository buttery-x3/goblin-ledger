import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import Fastify from 'fastify';
import {registerFarms} from './farms.mjs';
import {registerMarket} from './market.mjs';
import {ensureStore,insertSnapshot,saveHouse,saveCatalog} from './market-store.mjs';
import {normalizeOverview,normalizeRecipes} from '../../packages/domain/market.mjs';

const house = {key:'us-2-110',region:'us',grp:1,faction:'alliance',house:110,ruleset:2};
const time = Date.UTC(2026,10,18,13);
const catalog = {
  recipes:[
    {id:10,name:'Woven cord',prof:'Tailoring',item:50,qty:2,r:[[51,3],[51,1]]},
    {id:11,name:'Hammer',prof:'Blacksmithing',item:52,qty:1,r:[[50,1]]},
    {id:12,name:'Charm',prof:'Enchanting',item:null,qty:1,r:[[50,1]]},
    {id:13,name:'Prospecting',prof:'Jewelcrafting',item:53,qty:1.5,r:[[51,1]]},
  ],
  items:{50:{name:'Silken cord'},51:{name:'Silk thread'},52:{name:'Soft hammer'},53:{name:'Random gem'}},
  vendor:{51:1},
};
function suite(t,raw=catalog) {
  const app=Fastify(), db=new DatabaseSync(':memory:');
  const profile={mode:'live',region:'us',db};
  const handlers=new Map(),calls=[];
  const jobs={register:(name,fn)=>handlers.set(name,fn),run:(name,p,payload)=>handlers.get(name)({profile:p,payload,log(){}})};
  const marketFetch=async url=>{
    const path=new URL(url).pathname;
    calls.push(path);
    if (path==='/api/recipes') return Response.json(raw,{headers:{etag:'"fixture-1"'}});
    assert.equal(path,'/api/m/us-2-110/item/51');
    return Response.json({house,item:{id:51},f:['ask','listed','sold'],series:{t:[],ask:[],listed:[],sold:[]},
      book:[[10,4,1],[20,2,1]],bookMore:1,bookT:time});
  };
  registerMarket(app,{profile:()=>profile,jobs,marketFetch});
  registerFarms(app,{profile:()=>profile});
  ensureStore(profile);
  t.after(async()=>{await app.close();db.close();});
  async function call(path,payload,code=200) {
    const res=await app.inject({method:payload===undefined?'GET':'POST',url:'/api/v1/'+path,payload});
    assert.equal(res.statusCode,code,res.body);return res.json();
  }
  return {profile,db,calls,call};
}

test('bulk import browses 2,493 recipes locally, searches linked items and follows both directions',async t=>{
  const many=Array.from({length:2489},(_,i)=>({id:100+i,name:'Spare thread '+i,prof:'Tailoring',item:60,qty:1,r:[[51,1]]}));
  const {call,calls}=suite(t,{...catalog,recipes:[...catalog.recipes,...many]});
  assert.equal((await call('crafts/imported')).count,0);
  const imported=await call('markets/recipes/refresh',{});
  assert.equal(imported.result.count,2493);
  const first=await call('crafts/imported'),next=await call('crafts/imported?offset=25');
  assert.equal(first.count,2493);assert.equal(first.recipes.length,25);assert.equal(next.recipes.length,25);
  assert.ok(next.recipes.every(r=>!first.recipes.some(previous=>previous.id===r.id)));
  assert.equal((await call('crafts/imported?offset=2492')).recipes.length,1);
  assert.equal((await call('crafts/imported?q=blacksmith')).count,1);
  assert.equal((await call('crafts/imported?q=silken%20cord')).count,3);
  assert.deepEqual((await call('crafts/imported?itemId=50&role=input')).recipes.map(r=>r.id),[12,11]);
  assert.deepEqual((await call('crafts/imported?itemId=50&role=output')).recipes.map(r=>r.id),[10]);
  await call('crafts/imported?limit=200',undefined,400);
  await call('crafts/imported?itemId=50&role=maybe',undefined,400);
  await call('crafts/imported/99',undefined,404);
  const recipe=await call('crafts/imported/10');
  assert.match(recipe.catalog.revision,/^[a-f0-9]{64}$/);assert.ok(recipe.catalog.retrieved>0);
  assert.equal(recipe.catalog.etag,'"fixture-1"');
  assert.equal(recipe.outputName,'Silken cord');
  assert.deepEqual(recipe.inputs,[{itemId:51,name:'Silk thread',units:4,vendorReferenceCopper:1}]);
  assert.deepEqual(calls,['/api/recipes']);
});

test('same-house batch quote only consumes observed depth, preserves unknown fees/yields and needs one explicit item check',async t=>{
  const {call,calls,db}=suite(t);
  await call('markets/recipes/refresh',{});
  saveHouse(db,house);
  const raw={house,t:time,f:['ask','ask2','listed','depth5','listings','vol24','value24','flowHours'],
    items:[{id:50,name:'Silken cord',o:[80,null,20,20,1,null,null,0]},
      {id:51,name:'Silk thread',o:[10,20,10,4,2,null,null,0]}]};
  insertSnapshot(db,normalizeOverview(raw,house,time+1000));
  const scenario={quantity:1,feeBps:500,lostDepositCopper:0};
  const quote=(body=scenario,id=10)=>call('crafts/imported/'+id+'/quote',body);
  const missing=await quote();
  assert.equal(missing.incrementalCopper,null);assert.equal(missing.rows[0].canCheck,true);
  assert.equal(missing.rows[0].shortfall,4);assert.equal(missing.rows[0].book,null);
  const req=await call('markets/51/detail',{});
  assert.equal(req.result.levels,2);
  const result=await quote();
  assert.equal(result.incrementalCopper,'112');assert.equal(result.netOutputCopper,'152');
  assert.equal(result.cashCostCopper,'40');assert.equal(result.rows[0].book.more,1);
  assert.equal(result.t,time);assert.equal(result.house,'us-2-110');assert.equal(result.marketRetrieved,time+1000);
  const held=await quote({...scenario,quantity:2,owned:{51:2}});
  assert.equal(held.rows[0].required,8);assert.equal(held.rows[0].shortfall,0);
  assert.equal(held.cashCostCopper,'80');assert.equal(held.alternativeCopper,'19');assert.equal(held.incrementalCopper,'205');
  const short=await quote({...scenario,quantity:2});
  assert.equal(short.rows[0].shortfall,2);assert.equal(short.incrementalCopper,null);
  const unknown=await quote({quantity:1});
  assert.equal(unknown.feeBps,null);assert.equal(unknown.lostDepositCopper,null);assert.equal(unknown.incrementalCopper,null);
  assert.equal((await quote(scenario,12)).netOutputCopper,null);
  assert.equal((await quote(scenario,13)).incrementalCopper,null);
  assert.deepEqual([(await call('crafts/imported/13')).outputUnits,(await call('crafts/imported/13')).reportedQuantity],[null,1.5]);
  await call('crafts/imported/10/quote',{...scenario,revision:'old'},409);
  insertSnapshot(db,normalizeOverview({...raw,t:time+3600000},house,time+3601000));
  assert.equal((await quote()).rows[0].shortfall,4);
  assert.deepEqual(calls,['/api/recipes','/api/m/us-2-110/item/51']);
});

test('preexisting catalog survives additive tables and a failed refresh leaves the previous revision intact',async t=>{
  const {call,db}=suite(t);
  const normalized=normalizeRecipes(catalog);
  db.prepare('INSERT INTO market_recipes VALUES(?,?)').run(10,JSON.stringify(normalized.entries[0]));
  let recipe=await call('crafts/imported/10');
  assert.equal(recipe.catalog.revision,null);assert.equal(recipe.inputs[0].name,'Item #51');
  saveCatalog(db,normalized,time);
  assert.throws(()=>saveCatalog(db,{...normalized,entries:[...normalized.entries,normalized.entries[0]]},time+800));
  recipe=await call('crafts/imported/10');
  assert.equal(recipe.catalog.retrieved,time);assert.equal(recipe.inputs[0].name,'Silk thread');
  saveCatalog(db,{...normalized,entries:[{...normalized.entries[0],inputs:[{id:51,qty:Number.MAX_SAFE_INTEGER}]}]},time);
  await call('crafts/imported/10/quote',{quantity:2},400);
});
