import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {DatabaseSync} from 'node:sqlite';
import {registerFarms} from './farms.mjs';
import {normalizeOverview} from '../../packages/domain/market.mjs';
import {ensureStore,saveHouse,insertSnapshot} from './market-store.mjs';

function suite(mode,region=mode==='demo'?'us':null) {
  const app=Fastify();
  const db=new DatabaseSync(':memory:');
  const profile={mode,region,db};
  registerFarms(app,{profile:() => profile});
  const inject=async (method,path,body) => {
    const result=await app.inject({method,url:'/api/v1/'+path,payload:body});
    assert.ok(result.statusCode<300,result.body);
    return result.json();
  };
  return {app,db,inject,close:async()=>{await app.close();db.close();}};
}

test('demo endpoints produce fixed-haul price changes and coherent quantity-sensitive craft quotes', async t => {
  const {inject,close}=suite('demo'); t.after(close);
  const {routes}=await inject('GET','farms');
  assert.equal(routes.find(r => r.id==='skulk-rock').rateCopperPerHour,228000);
  assert.equal(routes.find(r => r.id==='jintha-alor').rateCopperPerHour,266000);
  for (const route of routes) {
    assert.equal(route.changeCopperPerHour,0);
    assert.ok(route.baselineTime<route.quote.t);
  }
  const {routes:scenario}=await inject('POST','farms/compare',{sessionMinutes:30,unitCopper:10000,approaches:{'jintha-alor':10}});
  assert.equal(scenario.find(r => r.id==='jintha-alor').sessionGoldCopper,66500);
  assert.equal(scenario[0].changeCopperPerHour,null);
  const quote=await inject('POST','crafts/quote',{recipeId:'menders-potion',quantity:10});
  assert.equal(quote.incrementalCopper,'-10150');
});

test('live starts without synthetic yield or asks, persists one run on retry and preserves revision history',async t => {
  const {inject,app,close}=suite('live');t.after(close);
  const {routes}=await inject('GET','farms');
  assert.equal(routes.length,3);
  for (const r of routes) assert.deepEqual([r.rateCopperPerHour,r.quote,r.changeCopperPerHour],[null,null,null]);
  const run={id:'example-run-001',revision:1,elapsedMinutes:30,coinCopper:200,haul:[{itemId:8845,units:5,exit:'auction'}]};
  await inject('POST','farms/skulk-rock/runs',run);
  assert.equal((await inject('POST','farms/skulk-rock/runs',run)).repeated,true);
  const observed=(await inject('POST','farms/compare',{unitCopper:2500})).routes.find(r => r.id==='skulk-rock');
  assert.equal(observed.runCount,1);assert.equal(observed.rateCopperPerHour,24150);
  await inject('PUT','farms/skulk-rock',{revision:1,name:'Short loop',notes:'Start and end at cave entrance.',approachMinutes:12});
  assert.equal((await app.inject({method:'POST',url:'/api/v1/farms/skulk-rock/runs',payload:run})).statusCode,409);
  const {rows}=await inject('GET','farms/skulk-rock/history');
  assert.equal(rows.length,1);assert.equal(rows[0].revision,1);
  assert.equal((await inject('GET','farms')).routes.find(r => r.id==='skulk-rock').runCount,0);
});

test('actor identity changes the best route on one house, with labelled aggregate fallback and strict gaps',async t => {
  const {inject,db,close}=suite('live','us');t.after(close);
  const house={key:'us-2-110',region:'us',ruleset:2,house:110,grp:1,faction:'alliance'};
  ensureStore({db,region:'us',mode:'live'});saveHouse(db,house);
  const latest=Date.UTC(2026,10,18,13,17);
  // Synthetic observations follow the provider's named-column bulk contract.
  for (const [time,price] of [[latest-3600000,9000],[latest,10000]]) {
    const raw={house,t:time,f:['depth5','listed','ask2','ask','listings','vol24','value24','flowHours'],
      items:[{id:8845,name:'Synthetic herb',cls:'Herb',sell:200,o:[20,20,null,price,1,null,null,1]}]};
    insertSnapshot(db,normalizeOverview(raw,house,time));
  }
  let i=0;
  for (const [route,actor,units] of [['skulk-rock','player-1',12],['jintha-alor','player-1',5],
        ['skulk-rock','player-2',3],['jintha-alor','player-2',15]]) {
    await inject('POST','farms/'+route+'/runs',{id:'actor-run-'+(++i),characterId:actor,character:'Same display name',
      revision:1,elapsedMinutes:30,haul:[{itemId:8845,units,exit:'auction'}]});
  }
  const compare=async body => (await inject('POST','farms/compare',{sessionMinutes:30,...body})).routes;
  const best = rows => [...rows].filter(r=>r.sessionGoldCopper!=null).sort((a,b)=>b.sessionGoldCopper-a.sessionGoldCopper)[0];
  const first=best(await compare({characterId:'player-1'})), second=best(await compare({characterId:'player-2'}));
  assert.equal(first.id,'skulk-rock');assert.equal(first.sessionGoldCopper,114000);
  assert.equal(second.id,'jintha-alor');assert.equal(second.sessionGoldCopper,142500);
  assert.equal(first.changeCopperPerHour,22800);assert.equal(second.changeCopperPerHour,28500);
  assert.equal(first.sampleScope,'Selected character');
  const fallback=best(await compare({characterId:'unmeasured'}));assert.equal(fallback.sampleScope,'All characters · fallback');
  assert.equal(fallback.runCount,2);
  const strict=await compare({characterId:'unmeasured',allowAggregate:false});
  assert.ok(strict.every(r=>r.sessionGoldCopper==null && r.sampleScope==='Selected character · no runs'));
});

test('alternative bundles and mutually exclusive exits are available as editable scenarios on the live profile',async t => {
  const {inject,close}=suite('live'); t.after(close);
  const result=await inject('POST','crafts/choices',{prices:{248682:{price:200,units:3},2447:{price:20,units:40},
    279450:{price:160000,units:1}},count:2,first:'available',hasBox:true});
  assert.equal(result.basis,'Scenario');
  assert.equal(result.crate.options.find(o => o.itemId===2447).incrementalCostCopper,'1200');
  assert.equal(result.crate.introFavor,50);assert.equal(result.box.differenceCopper,74000);
});
