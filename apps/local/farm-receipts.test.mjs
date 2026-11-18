import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {DatabaseSync} from 'node:sqlite';
import {registerFarms} from './farms.mjs';
import {importText,listPositions,setConfig,transaction} from './personal/ledger.mjs';

const account={product:'example-product',account:'synthetic-account'};
const stack=(units,extra={})=>({itemId:8845,units,exit:'auction',binding:'tradeable',variant:'0',...extra});
function fixture(t) {
  const profile={mode:'live',region:'us',db:new DatabaseSync(':memory:')};
  setConfig(profile,account);
  const app=Fastify();registerFarms(app,{profile:()=>profile});
  t.after(async()=>{await app.close();profile.db.close();});
  importText(profile,'GoblinLedgerDB={schema=1,characters={aa={id="aa",name="Synthetic",realm="Example",className="DRUID",level=24,xp=0,xpMax=100,money=0,build="test",interface=16001,lastLogin=900,lastSeen=1000,sequence=1}}}');
  const request=async(method,path,body,expected=200)=>{
    const result=await app.inject({method,url:'/api/v1/'+path,payload:body});
    assert.equal(result.statusCode,expected,result.body);
    return result.json();
  };
  async function run(id,haul,characterId='aa') {
    const body={id,revision:1,elapsedMinutes:10,coinCopper:30,expenseCopper:10,character:'Synthetic',characterId,haul};
    await request('POST','farms/skulk-rock/runs',body,201);
    // Re-run a deterministic historical observation without waiting for the game clock.
    profile.db.prepare('UPDATE farm_runs SET observed=? WHERE id=?').run(new Date(2000*1000).toISOString(),id);
  }
  function sale(id,details={}) {
    transaction(profile,{id,action:'sale',at:2010,owner:'aa',itemId:8845,quantity:3,unitCopper:'105',feeBps:500,
      depositPaidCopper:'3',depositRefundCopper:'1',...details});
  }
  return {profile,request,run,sale};
}
test('explicit allocations share one net settlement across runs, preserve FIFO and value only the remaining units',async t=>{
  const {profile,request,run,sale}=fixture(t);
  await run('first-run-001',[stack(4)]);
  await run('second-run-002',[stack(1)]);
  transaction(profile,{id:'opening',action:'opening',at:1000,owner:'aa',itemId:8845,quantity:5,unitCopper:'10'});
  sale('settlement-A');
  const position=JSON.stringify(listPositions(profile));
  const first='farm-runs/first-run-001/receipts',second='farm-runs/second-run-002/receipts';
  const body={id:'allocation-001',stack:0,saleId:'settlement-A',units:2};
  const options=await request('GET',first);
  assert.equal(options.choices[0].max,3);
  assert.equal(options.choices[0].settlementNetCopper,'298');
  await request('POST',first,body);
  assert.equal((await request('POST',first,body)).repeated,true);
  assert.equal((await request('GET',first)).linked[0].netCopper,'198');
  await request('POST',second,{...body,id:'allocation-002',units:1});
  assert.equal((await request('GET',second)).linked[0].netCopper,'100');
  await request('POST',first,{...body,id:'allocation-003',units:1},409);
  await request('POST',first,{...body,units:1},409);
  const view=(await request('POST','farms/compare',{unitCopper:100})).routes[0];
  assert.equal(view.realised.saleUnits,3);
  assert.equal(view.realised.settlements,1);
  assert.equal(view.realised.settledCopper,'298');
  assert.equal(view.realised.unsoldAuctionCopper,'190');
  assert.equal(view.realised.combinedCopper,'528');
  assert.equal(JSON.stringify(listPositions(profile)),position);
  await request('DELETE',first+'/allocation-001');
  assert.equal((await request('GET',second)).linked[0].netCopper,'99');
  assert.equal((await request('GET',first)).choices[0].max,2);
  await request('POST',first,body,409);
});
test('rejects incompatible actor, account, item, suffix, binding, chronology and excess attribution against one stack',async t=>{
  const {profile,request,run,sale}=fixture(t);
  await run('eligible-run',[stack(1),stack(2,{variant:'unknown'}),stack(3,{binding:'unknown'}),stack(5,{exit:'vendor',bound:true,binding:'bound'})]);
  await run('unconfirmed-actor',[stack(5)],'unobserved');
  sale('same-second',{at:2000});sale('before',{at:1999});sale('other-actor',{owner:'bb'});
  sale('suffix',{variant:'-3'});sale('other-item',{itemId:2});sale('later');sale('future',{at:Math.floor(Date.now()/1000)+40});
  const path='farm-runs/eligible-run/receipts', options=await request('GET',path);
  assert.deepEqual(options.choices.map(c=>[c.stack,c.saleId,c.max]),[[0,'later',1]]);
  assert.equal((await request('GET','farm-runs/unconfirmed-actor/receipts')).choices.length,0);
  const body={id:'stale-attempt',saleId:'later',stack:0,units:2};
  await request('POST',path,body,409);
  await request('POST',path,{...body,units:1,stack:1},409);
  await request('POST',path,{...body,units:1,saleId:'same-second'},409);
  setConfig(profile,{...account,account:'other'});
  await request('GET',path,undefined,404);
  await request('POST',path,{...body,units:1},404);
  assert.equal((await request('GET','farms/skulk-rock/history')).rows.length,0);
  assert.equal((await request('GET','farms')).routes[0].runCount,0);
});
test('legacy manual runs retain sample history without inferring a verified recipient',async t=>{
  const {profile,request}=fixture(t);
  await request('GET','farms');
  setConfig(profile,{});
  const old={elapsedMinutes:20,characterId:'aa',character:'Synthetic',coinCopper:0,expenseCopper:0,haul:[stack(1)]};
  profile.db.prepare('INSERT INTO farm_runs(id,route,revision,observed,details) VALUES(?,?,?,?,?)')
    .run('legacy-run','skulk-rock',1,new Date(2000*1000).toISOString(),JSON.stringify(old));
  assert.equal((await request('GET','farms/skulk-rock/history')).rows.length,1);
  assert.equal((await request('GET','farm-runs/legacy-run/receipts')).choices.length,0);
});
