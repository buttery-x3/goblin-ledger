import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from '../server.mjs';
import {articles, writeRevision} from './store.mjs';

const build = {
  action:'changed use', useKind:'build change', useContext:'Fixture build A',
  url:'https://example.test/build-a', publisher:'Fixture release notes', title:'Reagent change',
  summary:'The sample recipe now takes the marked reagent.', itemIds:[900001],
  effectiveOn:'2025-01-08', publishedOn:'2025-01-04'
};

test('an item thesis distinguishes local knowledge, source revision and effective day', () => {
  const db = new DatabaseSync(':memory:');
  const read = (day,id=900001) => articles(db,{itemId:id,asOf:'2025-01-'+day+'T12:00:00Z'});
  try {
    writeRevision(db,build,'2025-01-06T09:00:00Z');
    assert.equal(read('05').length,0);
    assert.equal(read('07')[0].useThesis,'Scheduled build change');
    assert.equal(read('08')[0].useThesis,'Build change dated today (time unknown)');
    assert.equal(read('09')[0].useThesis,'Build change reported effective');
    const corrected = {...build,itemIds:[900002],revisedOn:'2025-01-12'};
    writeRevision(db,corrected,'2025-01-10T09:00:00Z',1);
    assert.equal(read('11')[0].revision,1);
    assert.equal(read('11',900002).length,0);
    assert.equal(read('12').length,0);
    const [updated] = read('12',900002);
    assert.equal(updated.revision,2);
    assert.equal(updated.url,build.url);
    assert.equal(updated.availableAt,'2025-01-10T09:00:00.000Z');
    assert.equal(updated.firstSeenAt,'2025-01-06T09:00:00.000Z');
    assert.throws(()=>writeRevision(db,build,'2025-01-13T09:00:00Z',1),/revised/);
    writeRevision(db,{...corrected,action:'watch'},'2025-01-14T09:00:00Z',2);
    assert.equal(read('14',900002)[0].useThesis,null);
    assert.equal(read('13',900002)[0].revision,2);
    assert.throws(()=>writeRevision(db,{...build,itemIds:[]}),/affected item/);
    assert.throws(()=>writeRevision(db,{...build,effectiveOn:null}),/effective date/);
  } finally {db.close();}
});

test('a local turn-in entered through Research also appears in the unlisted item read and survives corrections', async () => {
  const root = await mkdtemp(join(tmpdir(),'ledger-use-test-'));
  const app = await createServer({root,scheduling:false});
  try {
    const base = {host:'127.0.0.1:4774'};
    const boot = await app.inject({url:'/api/v1/bootstrap',headers:base});
    const headers = {...base,cookie:boot.headers['set-cookie'].split(';')[0],
      'x-goblin-token':boot.json().token,'x-goblin-profile':'live:-'};
    const get = async path => {
      const result = await app.inject({url:'/api/v1'+path,headers});
      assert.equal(result.statusCode,200,result.body);
      return result.json();
    };
    const post = payload => app.inject({url:'/api/v1/research',method:'POST',headers,payload});
    const observation = {
      action:'changed use',useKind:'observed turn-in',title:'Fixture hand-in',publisher:'Test observer',
      summary:'A sample NPC accepted the reagent once.',useContext:'Fixture quest on test realm',
      observedAt:'2025-01-02T15:30:00+02:00',itemIds:[900001],
      localId:'07dda083-b95e-47a5-80b4-66be0d099daf',url:''
    };
    const saved = await post(observation);
    assert.equal(saved.statusCode,200,saved.body);
    const {id} = saved.json();
    const [entry] = (await get('/research?itemId=900001')).items;
    assert.equal(entry.id,id);
    assert.equal(entry.useThesis,'Turn-in observed');
    assert.equal(entry.observedAt,'2025-01-02T13:30:00.000Z');
    assert.equal(entry.publisher,observation.publisher);
    assert.equal(entry.url,null);
    assert.deepEqual((await get('/research')).items.find(row=>row.id===id),entry);
    const market = await get('/markets/900001');
    assert.equal(market.item,null);
    assert.equal(market.quote.status,'unavailable');
    const comparison = await get('/research/'+id+'/response');
    assert.equal(comparison.day,'2025-01-02');
    assert.equal(comparison.comparison.pairs,0);
    const before = new Date(Date.parse(entry.availableAt)-1).toISOString();
    assert.equal((await get('/research?itemId=900001&asOf='+encodeURIComponent(before))).items.length,0);
    assert.equal((await post(observation)).json().changed,false);
    const correction = {...observation,baseRevision:1,itemIds:[900002],summary:'Correction to the marked item.'};
    assert.equal((await post(correction)).json().revision,2);
    assert.equal((await get('/research?itemId=900001')).items.length,0);
    assert.equal((await get('/research?itemId=900002')).items[0].id,id);
    assert.equal((await post({...observation,observedAt:'2099-01-01T00:00:00Z'})).statusCode,400);
    assert.equal((await post({...observation,observedAt:'2025-02-30T12:00:00Z'})).statusCode,400);
    assert.equal((await post({...observation,localId:'not-an-id'})).statusCode,400);
  } finally {
    await app.close();
    await rm(root,{recursive:true,force:true,maxRetries:3});
  }
});
