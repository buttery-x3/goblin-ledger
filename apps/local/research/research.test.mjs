import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {accountProgress,articles,writeRevision} from './store.mjs';
import {fetchGuide,annotateLocally} from './sources.mjs';
import {registerResearch,routeExposure} from '../research.mjs';
import {canonicalUrl,compareWindows,guideRecord,normalizeArticle} from '../../../packages/domain/research.mjs';
import {progressionForCharacter} from '../../../packages/domain/progression.mjs';

test('canonical revisions retain a single route marker and respect local decision time',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    const source={...guideRecord,url:'https://example.com/guide?edition=1&utm_medium=site#foo'};
    const a=writeRevision(db,source,'2026-11-06T00:00:00Z');
    assert.deepEqual(writeRevision(db,{...source,url:'https://example.com/guide?edition=1'},'2026-11-07T00:00:00Z'),{...a,changed:false});
    assert.equal(articles(db,{asOf:'2026-11-05T23:59:59Z'}).length,0);
    const b=writeRevision(db,{...source,revisedOn:'2026-11-08',action:'buy',routeId:null,summary:'Buy the herb.'},'2026-11-08T12:00:00Z');
    assert.equal(b.revision,2);
    const options={asOf:'2026-11-07T23:59:59Z',routeId:'skulk-rock'};
    assert.equal(articles(db,options)[0].revision,1);
    assert.equal(articles(db,{asOf:'2026-11-09T00:00:00Z',routeId:'skulk-rock'}).length,0);
    assert.equal(articles(db,{asOf:'2026-11-09T00:00:00Z',itemId:8845})[0].action,'buy');
    assert.equal(articles(db,{asOf:'2026-11-09T00:00:00Z',includeHistory:true}).length,2);
    assert.equal(routeExposure({db},'jintha-alor').length,0);
    assert(articles(db).every(a=>a.reach===null));
  } finally {db.close();}
});
test('unscoped observations survive the migration under the manual profile',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE legacy_completion(id TEXT PRIMARY KEY,state INTEGER NOT NULL,observed_at TEXT NOT NULL); INSERT INTO legacy_completion VALUES('class:druid:25',1,'2026-11-18')");
    assert.equal(accountProgress(db,'manual').completion['class:druid:25'],true);
    assert.equal(accountProgress(db,'another').completion['class:druid:25'],undefined);
  } finally {db.close();}
});
test('a source without an original publication date retains its note and source link',()=>{
  const data=normalizeArticle({...guideRecord,publishedOn:'',revisedOn:''});
  assert.equal(data.publishedOn,null);
  assert.throws(()=>normalizeArticle({...guideRecord,publishedOn:'2026-02-29'}));
  assert.equal(canonicalUrl('https://a.example/x?pages=1#link'),'https://a.example/x?pages=1');
  assert.throws(()=>canonicalUrl('javascript:alert(1)'));
});
test('pair matching hours only within one source, house and method; missing pre-period yields no change',()=>{
  const row={provider:'source',house:'EU Alliance',method:'v1',ask:100,listed:200};
  const after={...row,observedAt:'2026-10-06T05:01:00Z',ask:120,listed:170};
  const before={...row,observedAt:'2026-10-04T05:27:00Z'};
  const day='2026-10-05';
  const comparison=compareWindows([before,after,{...after,observedAt:'2026-10-06T06:00:00Z',ask:9999}],day);
  assert.deepEqual([comparison.priceChangeCopper,comparison.supplyChange,comparison.pairs,comparison.after],[20,-30,1,2]);
  assert.equal(compareWindows([after],day).priceChangeCopper,null);
  assert.equal(compareWindows([before,{...after,method:'v2'}],day).priceChangeCopper,null);
  assert.equal(compareWindows([before,{...after,house:'US'}],day).priceChangeCopper,null);
  assert.equal(compareWindows([before,after],day,{cutoff:Date.parse(day)}).pairs,0);
});
test('intake keeps publisher dates, reports missing advice, and refuses failed or oversized pages',async()=>{
  const page='<h1>Herbalism Leveling Guide</h1><p>At 245 take a detour into Skulk Rock for Ghost Mushroom.</p><p>Last Updated: Nov 4, 2026</p><p>03 Nov. 2026: Guide created.</p>';
  const fake=(body,extra={})=>async()=>new Response(body,{headers:{'content-type':'text/html',...extra}});
  const data=await fetchGuide({fetchImpl:fake(page)});
  assert.equal(data.publishedOn,'2026-11-03');assert.equal(data.revisedOn,'2026-11-04');
  assert.equal((await fetchGuide({fetchImpl:fake(page.split('<p>Last Updated')[0])})).publishedOn,null);
  await assert.rejects(fetchGuide({fetchImpl:fake('Herbalism Leveling Guide')}),/Advice changed/);
  await assert.rejects(fetchGuide({fetchImpl:fake(page,{'content-length':String(1024*1024+1)})}),/size limit/);
  await assert.rejects(fetchGuide({fetchImpl:async()=>new Response('',{status:403})}),/HTTP 403/);
});
test('model notes cannot attach unmentioned items; failure leaves source unchanged',async()=>{
  const db=new DatabaseSync(':memory:');
  try {
    const source=articles(db)[0], config={model:'test',port:1234};
    const ask=ids=>async(url,init)=>{
      assert.equal(url,'http://127.0.0.1:1234/v1/chat/completions');assert.equal(init.redirect,'error');
      const body=JSON.parse(init.body);assert.equal(JSON.parse(body.messages[1].content).routeId,'skulk-rock');
      return Response.json({choices:[{message:{content:JSON.stringify({summary:'Look for Ghost Mushroom inside Skulk Rock.',itemIds:ids})}}]});
    };
    assert.deepEqual((await annotateLocally(source,config,{fetchImpl:ask([8845])})).itemIds,[8845]);
    await assert.rejects(annotateLocally(source,config,{fetchImpl:ask([42])}),/failed/);
    await assert.rejects(annotateLocally(source,config,{fetchImpl:async()=>{throw new Error('offline');}}),/offline/);
    assert.equal(articles(db)[0].annotation,null);assert.equal(articles(db)[0].url,source.url);
  } finally {db.close();}
});
test('class and profession challenges use account status, learning uses the character, rested values stay per alt',()=>{
  const info=rank=>({level:24,className:'Druid',professions:[{name:'Alchemy',skill:123},{name:'Herbalism',skill:150}],restedXp:rank*150,wellRestedRank:rank});
  for(const [value,outcome] of [[true,'already earned'],[false,'new point'],[undefined,'completion unknown']]) {
    const ch=progressionForCharacter(info(1),{'class:druid:25':value,'profession:alchemy:150':true});
    assert.equal(ch.classChallenge.remaining,1);assert.equal(ch.classChallenge.status,outcome);
    assert.equal(ch.recipe.remaining,7);assert.equal(ch.professionChallenges.length,1);
  }
  const atThreshold=progressionForCharacter({...info(2),level:25},{'class:druid:25':true});
  assert.equal(atThreshold.classChallenge.status,'already earned');
  assert.equal(atThreshold.rested.amount,300);assert.equal(atThreshold.rested.projected,null);
  assert.equal(progressionForCharacter(info(1)).rested.amount,150);
});
test('research routes retain changes across house lookups and allow clearing observed account completion', async()=>{
  const db = new DatabaseSync(':memory:'), handlers = new Map();
  try {
    const app=Object.fromEntries(['get','put','post'].map(k=>[k,(path,fn)=>handlers.set(k+' '+path,fn)]));
    let scope='first';
    registerResearch(app,{profile:()=>({db,mode:'live',region:null}),personalPool:()=>scope,jobs:{register(){}}});
    const get=handlers.get('get /api/v1/research');
    const change=await handlers.get('post /api/v1/research')({body:{...guideRecord,url:'https://example.com/quest',publishedOn:null,revisedOn:null,
      action:'changed use',routeId:null,effectiveOn:'2026-11-25',itemIds:[18945],summary:'Observed the material at a turn-in.'}});
    const item=(await get({query:{itemId:'18945'}})).items.find(a=>a.id===change.id);
    assert.equal(item.effectiveOn,'2026-11-25');
    assert.equal((await get({query:{routeId:'jintha-alor'}})).items.length,0);
    const account=handlers.get('put /api/v1/progression/account'),id='class:druid:25';
    assert.equal((await account({body:{id,state:true}})).completion[id],true);
    scope='second';
    const getProgress=handlers.get('get /api/v1/progression/account');
    assert.equal((await getProgress()).completion[id],undefined);
    await assert.rejects(account({body:{id,state:true,scope:'first'}}),/selection changed/);
    scope='first';
    assert.equal((await getProgress()).completion[id],true);
    assert.equal((await account({body:{id,state:null}})).completion[id],undefined);
    const preview=handlers.get('post /api/v1/progression/preview');
    await assert.rejects(preview({body:{character:{knownRecipeIds:{}}}}),/known recipe IDs/);
    await assert.rejects(account({body:{id:'profession:herbalism:150',state:true}}),/Invalid/);
  } finally {db.close();}
});
