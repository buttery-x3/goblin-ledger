import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { registerPersonal,listCharacters } from '../personal.mjs'
import { valuePosition } from './valuation.mjs'
import { readExport } from './export.mjs'
import { transaction,importText,listPositions,setConfig } from './ledger.mjs'
import { install,inspect,exportFile,browse } from './install.mjs'

const record=(at,seq,bags,bank,login=900)=>'GoblinLedgerDB={schema=1,characters={aa={id="aa",name="Fixture",realm="Test",className="DRUID",level=24,xp=0,xpMax=100,money=0,build="test",interface=16001,lastLogin='+login+',lastSeen='+at+',sequence='+seq+','+
    'bags={at='+at+',seq='+seq+',complete=true,items={'+(bags?'[1]={itemId=42,quantity='+bags+',link="42:0:0:0:0:0:0",binding="tradeable"}':'')+'}},'+(bank?'bank='+bank+',':'')+'}}}'
const live=()=>({mode:'live',region:null,db:new DatabaseSync(':memory:')})
test('literal parser consumes the entire export and rejects code and duplicate keys',()=>{
  assert.equal(readExport('\uFEFF-- header\n'+record(1200,1,5)).characters.aa.level,24)
  for(const invalid of [record(1200,1,5)+'\nprint(1)',record(1200,1,5).replace('xp=0','xp=func()'),record(1200,1,5).replace('schema=1','schema=1,schema=0'),record(1200,1,5).replace('schema=1','schema=2')]) assert.throws(()=>readExport(invalid))
})
test('imports are atomic, ordered by scope and idempotent, with separate account pools',()=>{
  const p=live()
  const fullBank='{at=1200,seq=1,complete=true,items={{itemId=42,quantity=7,link="42:0:0:0:0:0:0",binding="tradeable"}}}'
  const first=record(1200,1,100,fullBank)
  importText(p,first);assert.equal(importText(p,first).status,'unchanged')
  importText(p,record(1300,2,50,'{complete=false}'));assert.equal(listPositions(p)[0].physical,57)
  importText(p,record(1100,7,99));assert.equal(listPositions(p)[0].physical,57)
  assert.throws(()=>importText(p,record(1400,3,7).replace('quantity=7','quantity=-2')))
  assert.equal(listPositions(p)[0].physical,57)
  importText(p,record(1400,3,0));assert.equal(listPositions(p)[0].physical,7)
  assert.equal(listCharacters(p)[0].bankAt,1200)
  setConfig(p,{product:'Z:\\Example',account:'Fixture2'});assert.deepEqual(listPositions(p),[])
  p.db.close()
})
test('FIFO basis, one whole settlement, later inventory reconciliation, idempotency and variants',()=>{
  const p=live()
  const entry={id:'entry',at:1100,owner:'aa',itemId:42,quantity:10000,unitCopper:'100',action:'opening'}
  transaction(p,entry);importText(p,record(1200,1,10000))
  const sale={...entry,at:1250,id:'receipt',quantity:500,unitCopper:'300',action:'sale'}
  transaction(p,sale);assert.equal(transaction(p,sale).status,'unchanged')
  assert.throws(()=>transaction(p,{...sale,quantity:1000}))
  let [pos]=listPositions(p);assert.equal(pos.economic,9500);assert.equal(pos.physical,10000)
  assert.equal(pos.realisedKnownCopper,'92500');assert.equal(pos.receipts[0].proceedsCopper,'142500')
  importText(p,record(1300,2,9500));assert.equal(listPositions(p)[0].economic,9500)
  transaction(p,{...sale,id:'unknown-basis',variant:'12',depositPaidCopper:'105',depositRefundCopper:'10'})
  pos=listPositions(p).find(item=>item.variant==='12')
  assert.equal(pos.unknownSold,500);assert.equal(pos.receipts[0].proceedsCopper,'142405')
  assert.throws(()=>transaction(p,{...sale,id:'bound',binding:'bound'}))
  p.db.close()
})
test('bank-only opening basis and unknown lots keep physical quantities and FIFO order',()=>{
  const bank='{at=1200,seq=1,complete=true,items={{itemId=42,quantity=10,link="42:0:0:0:0:0:0",binding="tradeable"}}}'
  const p=live(),bankOnly=record(1200,1,0,bank).replace('bags={at=1200,seq=1,complete=true,items={}},','')
  importText(p,bankOnly);transaction(p,{id:'opening',at:1250,owner:'aa',itemId:42,quantity:10,unitCopper:'20',action:'opening'})
  assert.equal(listPositions(p)[0].economic,10);assert.equal(listPositions(p)[0].knownBasisCopper,'200');p.db.close()
  const q=live()
  importText(q,record(1200,1,10))
  transaction(q,{id:'new',at:1250,owner:'aa',itemId:42,quantity:5,unitCopper:'100',action:'purchase'})
  transaction(q,{id:'sale',at:1300,owner:'aa',itemId:42,quantity:2,unitCopper:'200',action:'sale'})
  const [a]=listPositions(q)
  assert.equal(a.economic,13);assert.equal(a.unknownSold,2);assert.equal(a.realisedKnownCopper,'0');assert.equal(a.knownUnits,5)
  importText(q,record(1400,2,13));assert.equal(listPositions(q)[0].unknownSold,2)
  q.db.close()
})
test('valuations distinguish bound, suffix-specific, base-item and absent sources',()=>{
  const item={id:42,t:1000,house:'sample',source:'fixture',sell:100,ask:300}
  const pos={itemId:42,economic:500,binding:'tradeable',variant:'0'}
  assert.equal(valuePosition(pos,item).scenarioNetCopper,'142500')
  assert.equal(valuePosition({...pos,binding:'bound'},item).scenarioNetCopper,null)
  assert.equal(valuePosition({...pos,variant:'-2'},item).scenarioNetCopper,null)
  assert.equal(valuePosition(pos,item).vendorCopper,'50000')
  assert.equal(valuePosition(pos,null),null)
})
test('demo characters, fixtures and holdings are isolated',()=>{
  const p=live(),d={...p,mode:'demo',db:new DatabaseSync(':memory:')}
  assert.equal(listCharacters(d).length,2)
  assert.equal(listPositions(d)[0].economic,9500);assert.equal(listPositions(p).length,0)
  p.db.close();d.db.close()
})
async function fakeInstall(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ledger-personal-'))
  t.after(async()=>{const full=path.resolve(root);assert.equal(path.dirname(full),path.resolve(os.tmpdir()));await fs.rm(full,{recursive:true,force:true})})
  const parent=path.join(root,'WoW synthetic'),product=path.join(parent,'_forever_')
  await fs.mkdir(product,{recursive:true});await fs.writeFile(path.join(product,'Wow.exe'),'fixture marker')
  return {root,parent,product}
}
test('verified parent and product, ownership, export path, reruns, rollback and conflicts', async t=>{
  const {root,parent,product}=await fakeInstall(t)
  assert.equal((await inspect(parent)).product,product)
  assert.equal((await inspect(product)).installed,false)
  assert.deepEqual((await browse(parent)).folders,[product])
  await assert.rejects(inspect(root))
  const {destination}=await install(parent);assert.equal((await install(product)).action,'unchanged')
  const addons=path.dirname(destination)
  await fs.rename(destination,path.join(addons,'.GoblinLedger-previous'))
  await fs.writeFile(path.join(addons,'.GoblinLedger-install.json'),'{"owner":"GoblinLedger","version":1}')
  assert.equal((await install(product)).action,'unchanged')
  await fs.mkdir(path.join(product,'WTF','Account','Example','SavedVariables'),{recursive:true})
  assert.equal(await exportFile(product,'Example'),path.join(product,'WTF','Account','Example','SavedVariables','GoblinLedger.lua'))
  await assert.rejects(exportFile(product,'..'))
  await fs.writeFile(path.join(destination,'foreign.lua'),'preserve')
  await assert.rejects(install(product),/Unowned/)
  assert.equal(await fs.readFile(path.join(destination,'foreign.lua'),'utf8'),'preserve')
})
test('HTTP handlers and runner publish a normal import from a selected account',async t=>{
  const {parent,product}=await fakeInstall(t),p=live(), routes=new Map(),registry=new Map(),hooks={}
  for(const account of ['Alt','Main']) await fs.mkdir(path.join(product,'WTF','Account',account,'SavedVariables'),{recursive:true})
  const app={addHook:(n,f)=>{hooks[n]=f}}
  for(const method of ['get','post','put'])app[method]=(path,fn)=>routes.set(method+path,fn)
  registerPersonal(app,{profile:()=>p,marketItem:()=>null,jobs:{register:(k,v)=>registry.set(k,v),run:(k,profile,payload)=>registry.get(k)({profile,payload,log(){}})}})
  t.after(async()=>{await hooks.onClose();p.db.close()})
  const reply={code(n){this.status=n;return this},send(v){return v}}
  const call=(method,n,body)=>routes.get(method+'/api/v1/personal/'+n)({body},reply)
  await call('post','inspect',{path:parent});await call('post','select-account',{account:'Alt'})
  assert.match((await call('post','import')).error,/Waiting/)
  await fs.writeFile(await exportFile(product,'Alt'),record(1300,1,70))
  await fs.writeFile(await exportFile(product,'Main'),record(1300,1,99))
  assert.equal((await call('post','import')).status,'imported')
  assert.equal((await call('get','positions')).positions[0].economic,70)
  assert.equal((await call('get','characters')).characters[0].lastLogin,900)
  assert.match((await call('post','install',{product:'wrong'})).error,/Verify/)
  assert.equal((await call('post','install',{product})).action,'installed')
})
