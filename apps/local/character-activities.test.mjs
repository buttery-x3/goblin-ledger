import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import Fastify from 'fastify';
import {registerFarms} from './farms.mjs';
import {pool,importText,setConfig} from './personal/ledger.mjs';
import {ensureStore,saveHouse,insertSnapshot} from './market-store.mjs';
import {normalizeOverview} from '../../packages/domain/market.mjs';
import {activityAccess} from '../../packages/domain/character-activities.mjs';

test('an access warning on any guarded route requires a matching character run to resolve it',()=>{
  const route={id:'new-guide-site',accessCheck:'Verify entry.',actorId:'hunter',sampleScope:'Selected character',runCount:4};
  assert.equal(activityAccess(route,{id:'mage'}).state,'check');
  assert.equal(activityAccess(route,{id:'hunter'}).state,'available');
  assert.equal(activityAccess({...route,sampleScope:'Synthetic benchmark'},{id:'hunter'}).state,'check');
});

const t0=Date.UTC(2026,10,18,12,17);
function environment(t) {
  const db=new DatabaseSync(':memory:'), app=Fastify(),profile={db,mode:'live',region:'us'};
  registerFarms(app,{profile:()=>profile});
  setConfig(profile,{account:'test-one',product:'test-product'});
  t.after(async()=>{await app.close();db.close()});
  async function request(path,method='GET',payload) {
    return app.inject({url:'/api/v1/'+path,method,payload});
  }
  async function suggestions(id,minutes=30) {
    const response=await request('personal/characters/'+id+'/activities?sessionMinutes='+minutes+'&scope='+pool(profile));
    assert.equal(response.statusCode,200,response.body);
    return response.json();
  }
  function character(id,level,profession,skill,complete=true) {
    const record={id,name:'Test '+id,realm:'Example',className:'Hunter',lastSeen:1800000000,level};
    const data='GoblinLedgerDB={schema=1,characters={["'+id+'"]={'+
      Object.entries(record).map(([k,v])=>k+'='+JSON.stringify(v)).join(',')+
      ',sequence=1,xp=1,xpMax=100,money=10,build="synthetic",interface=16001,'+
      'professions={at=1800000000,seq=1,complete='+complete+',items={{name='+JSON.stringify(profession)+',skill='+skill+'}}}}}}';
    importText(profile,data);
  }
  function market(region,time,rows) {
    const house={key:region+'-2-110',region,house:110,ruleset:2,grp:1,faction:'alliance'};
    ensureStore(profile);saveHouse(db,house);
    const raw={house,t:time,f:['ask','listed','listings','ask2','depth5','vol24','value24','flowHours'],
      items:rows.map(([id,ask,listed])=>({id,name:'Synthetic '+id,cls:'Trade Goods',o:[ask,listed,1,null,listed,null,null,1]}))};
    insertSnapshot(db,normalizeOverview(raw,house,time));
  }
  async function run(route,id,actor,minutes,itemId,units) {
    const response=await request('farms/'+route+'/runs','POST',
      {id,revision:1,characterId:actor,elapsedMinutes:minutes,haul:[{itemId,units,exit:'auction'}]});
    assert.equal(response.statusCode,201,response.body);
  }
  return {profile,request,suggestions,character,market,run};
}

test('an imported character and the current house yield named actions without runs, stock, or transactions',async t=>{
  const {profile,suggestions,character,market}=environment(t);
  character('reed',26,'Herbalism',151);
  character('ember',8,'Alchemy',123);
  character('unknown',34,'Herbalism',299,false);
  market('us',t0,[[3357,500,18],[2589,800,44],[2592,200,33]]);
  market('us',t0+3600000,[[3357,1000,3],[2589,600,50],[2592,200,21]]);
  const first=await suggestions('reed');
  assert.equal(first.house,'us-2-110');
  const [best]=first.activities;
  assert.equal(best.routeId,'dun-modr-liferoot');
  assert.deepEqual([best.category,best.quote.ask,best.quote.priorAsk,best.quote.listed,best.quote.t,best.requiredUnitsPerHour,best.sessionCopper],
    ['lead',1000,500,3,t0+3600000,106,null]);
  assert.ok(!first.activities.some(a=>a.category==='ranked'));
  assert.ok(first.activities.find(a=>a.itemId===8845).access.reason.includes('94 skill points'));
  const novice=await suggestions('ember');
  assert.equal(novice.activities.find(a=>a.routeId==='jangolode-linen').category,'check');
  assert.equal(novice.activities.find(a=>a.itemId===3357).category,'unlock');
  assert.equal(novice.alchemy.remaining,7);
  assert.equal((await suggestions('unknown')).activities.find(a=>a.itemId===3357).access.state,'check');
  market('eu',t0+3600000,[[2589,100,2]]);
  profile.region='eu';
  const switched=await suggestions('reed');
  assert.equal(switched.house,'eu-2-110');
  assert.equal(switched.activities[0].itemId,2589);
  assert.equal(switched.activities[0].requiredUnitsPerHour,1053);
  assert.equal(switched.activities[0].quote.priorAsk,undefined);
  assert.equal(switched.activities.find(a=>a.itemId===3357).quote,null);
});

test('rank whole sessions using this character’s runs, keep borrowed yields and incomplete haul prices out of that rank',async t=>{
  const {suggestions,character,market,run}=environment(t);
  character('sage',32,'Herbalism',160);
  character('brook',32,'Herbalism',160);
  market('us',t0,[[3357,1000,10],[2589,100,50],[2592,80,15]]);
  await run('dun-modr-liferoot','thirty-minute-herb','sage',30,3357,20);
  await run('jangolode-linen','fifteen-minute-linen','sage',15,2589,75);
  await run('mosshide-wool','another-actors-run','brook',10,2592,900);
  await run('mirror-lake-peacebloom','missing-haul-quote','sage',5,2447,7);
  const short=await suggestions('sage',15), longer=await suggestions('sage',30);
  assert.equal(short.activities[0].routeId,'jangolode-linen');
  assert.equal(short.activities.find(a=>a.itemId===3357).category,'low-return');
  assert.equal(longer.activities[0].routeId,'dun-modr-liferoot');
  assert.equal(longer.activities[0].sessionCopper,19000);
  const borrowed=longer.activities.find(a=>a.itemId===2592);
  assert.equal(borrowed.ownRuns,false);
  assert.ok(borrowed.sessionCopper>longer.activities[0].sessionCopper);
  assert.equal(borrowed.category,'lead');
  const missing=longer.activities.find(a=>a.itemId===2447);
  assert.equal(missing.sessionCopper,null);
  assert.ok(missing.gaps.some(g=>g.includes('2447')));
  assert.equal((await suggestions('brook')).activities[0].routeId,'mosshide-wool');
  character('novice',9,'Herbalism',20);
  const novice=await suggestions('novice');
  for (const [id,state] of [['dun-modr-liferoot','unlock'],['jangolode-linen','check']]) {
    const row=novice.activities.find(a=>a.routeId===id);
    assert.equal(row.access.state,state);
    assert.ok(row.runCount>0 && row.quote.ask>0);
    assert.deepEqual([row.sessionCopper,row.requiredUnitsPerHour,row.loops],[null,null,null]);
  }
});

test('a named character report is scoped to the active account and rejects invalid sessions',async t=>{
  const {profile,request,character}=environment(t);
  character('A',25,'Mining',50);
  const oldScope=pool(profile);
  const url='personal/characters/A/activities';
  assert.equal((await request(url+'?sessionMinutes=-1')).statusCode,400);
  assert.equal((await request(url+'?targetCopperPerHour=0')).statusCode,400);
  setConfig(profile,{account:'test-two',product:'test-product'});
  assert.equal((await request(url+'?scope='+oldScope)).statusCode,409);
  assert.equal((await request(url)).statusCode,404);
});
