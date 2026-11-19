import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { registerPersonal } from '../personal.mjs'
import { importText, listPositions, pool, setConfig, transaction } from './ledger.mjs'

const bare={itemId:42,variant:'0',binding:'tradeable'}
function observe(p,id,at,bags,bank) {
  const s=(name,n)=>n===undefined?'':name+'={at='+at+',seq=1,complete=true,items={'+(n?'{itemId=42,quantity='+n+',link="42:0:0:0:0:0:0",binding="tradeable"}':'')+'}},'
  return importText(p,'GoblinLedgerDB={schema=1,characters={["'+id+'"]={id="'+id+'",name="'+id+'",realm="Fixture",className="DRUID",level=24,xp=0,xpMax=100,money=0,build="fixture",interface=16001,lastSeen='+at+',sequence=1,'+s('bags',bags)+s('bank',bank)+'}}}')
}
function fixture(t,a=10,b=0) {
  const p={mode:'live',region:null,db:new DatabaseSync(':memory:')}
  t.after(()=>p.db.close())
  observe(p,'a',1000,a);observe(p,'b',1000,b)
  return p
}
function move(p,options={}) {
  return {...bare,id:'handoff',owner:'a',recipient:'b',confirmed:true,at:2000,quantity:5,action:'transfer',scope:pool(p),...options}
}
function trade(p,action,owner,at,quantity,unitCopper) {
  return transaction(p,{...bare,action,id:owner+'-'+at,owner,at,quantity,unitCopper,feeBps:0})
}
const position=p=>listPositions(p).find(v=>v.asset==='42/0/tradeable')
test('a confirmed transfer conserves stock across both orders of independent export arrival',async t=>{
  for(const first of ['a','b']) await t.test(first+' export first',()=>{
    const p=fixture(t)
    trade(p,'opening','a',1200,10,'5')
    const tx=move(p);transaction(p,tx)
    assert.equal(transaction(p,tx).status,'unchanged')
    assert.throws(()=>transaction(p,{...tx,quantity:4}),/identity/)
    const check=(physical)=>{
      const pos=position(p)
      assert.equal(pos.economic,10);assert.equal(pos.physical,physical);assert.equal(pos.knownBasisCopper,'50')
      assert.deepEqual(pos.receipts,[]);assert.equal(pos.realisedKnownCopper,'0')
      const record=pos.transactions.at(-1)
      assert.equal(record.recipient,'b');assert.equal(record.owner,'a');assert.equal(record.transferStatus,'confirmed');assert.equal(record.unallocatedQuantity,0)
    }
    check(10);observe(p,first,2100,5);check(first==='a'?5:15)
    observe(p,first==='a'?'b':'a',2200,5);check(10)
  })
})
test('a single handoff preserves mixed bag and bank totals as individual scopes refresh',t=>{
  const p=fixture(t,6,0)
  observe(p,'a',1001,6,4)
  trade(p,'opening','a',1100,10,'2')
  transaction(p,move(p,{quantity:7}))
  assert.equal(position(p).economic,10);assert.equal(position(p).knownBasisCopper,'20')
  observe(p,'a',2100,0)
  assert.equal(position(p).economic,10);assert.equal(position(p).timingUncertain,true)
  observe(p,'b',2200,7)
  assert.equal(position(p).economic,10)
  observe(p,'a',2400,0,3)
  assert.equal(position(p).economic,10);assert.equal(position(p).unreconciledUnits,0)
})
test('refreshing just bags does not lose the known units remaining in both source containers',t=>{
  const p=fixture(t,3,0)
  observe(p,'a',1010,3,7)
  transaction(p,move(p,{quantity:2}))
  observe(p,'a',2100,1)
  assert.equal(position(p).economic,10)
  observe(p,'b',2200,2)
  assert.equal(position(p).physical,10);assert.equal(position(p).economic,10)
  assert.equal(position(p).timingUncertain,true)
})
test('a purchase and handoff at the same second retain deterministic order and mark uncertainty',t=>{
  const p=fixture(t,0,0)
  trade(p,'purchase','a',2000,5,'3')
  transaction(p,move(p))
  assert.equal(position(p).economic,5);assert.equal(position(p).knownBasisCopper,'15')
  assert.equal(position(p).timingUncertain,true)
})
test('one alt receiving its first known portable stock can see a later bank-only export',t=>{
  const p=fixture(t,8,undefined)
  observe(p,'c',1000,undefined,0)
  transaction(p,move(p,{recipient:'c',quantity:8}))
  observe(p,'c',2100,undefined,0)
  assert.equal(position(p).economic,8)
  transaction(p,move(p,{id:'to-b',owner:'c',recipient:'b',quantity:8,at:2200}))
  assert.equal(position(p).economic,8)
})
test('a pooled FIFO sale charges the oldest cost while retaining custody of the other alt’s units',t=>{
  const p=fixture(t,0,0)
  trade(p,'purchase','a',1100,5,'1');trade(p,'purchase','b',1200,5,'5')
  trade(p,'sale','b',1300,5,'10')
  assert.equal(position(p).realisedKnownCopper,'45')
  transaction(p,move(p))
  const pos=position(p)
  assert.equal(pos.economic,5);assert.equal(pos.knownBasisCopper,'25');assert.equal(pos.realisedKnownCopper,'45')
  assert.equal(pos.receipts.length,1);assert.equal(pos.receipts[0].known,5)
  assert.throws(()=>transaction(p,move(p,{id:'impossible',quantity:1,at:2100})),/Insufficient/)
  transaction(p,move(p,{id:'return',owner:'b',recipient:'a',quantity:5,at:2200}))
  assert.equal(position(p).economic,5)
})
test('partial known and unknown lots retain original pooled order across a handoff and later sale',t=>{
  const p=fixture(t,3,0) // three unknown units come first
  trade(p,'purchase','a',1100,5,'10')
  trade(p,'purchase','b',1200,5,'20')
  transaction(p,move(p,{quantity:5}))
  const before=position(p)
  assert.equal(before.economic,13);assert.equal(before.unknownUnits,3);assert.equal(before.knownBasisCopper,'150')
  trade(p,'sale','b',2300,6,'40')
  const after=position(p)
  assert.equal(after.economic,7);assert.equal(after.unknownSold,3);assert.equal(after.knownBasisCopper,'120')
  assert.equal(after.receipts[0].known,3);assert.equal(after.realisedKnownCopper,'90')
})
test('same-second snapshots never mint another lot; a late contradictory export flags an existing handoff',t=>{
  const p=fixture(t,10,0)
  transaction(p,move(p,{quantity:8}))
  observe(p,'b',2000,8);observe(p,'a',2000,2)
  assert.equal(position(p).economic,10);assert.equal(position(p).unreconciledUnits,0);assert.equal(position(p).timingUncertain,true)
  observe(p,'a',1900,3)
  const disputed=position(p).transactions.at(-1)
  assert.equal(disputed.transferStatus,'needs-reconciliation');assert.equal(disputed.unallocatedQuantity,5)
  assert.equal(position(p).receipts.length,0);assert.equal(position(p).knownBasisCopper,'0')
  assert.equal(transaction(p,move(p,{quantity:8})).status,'unchanged')
})
test('backdating cannot spend a later committed transfer twice and a changed account cannot accept a stale form',t=>{
  const p=fixture(t,10,0)
  const original=move(p,{quantity:8});transaction(p,original)
  assert.throws(()=>transaction(p,move(p,{id:'backdated',at:1950,quantity:4})),/previously confirmed/)
  assert.equal(position(p).transactions.length,1)
  setConfig(p,{product:'Z:\\Fixture',account:'Other'})
  observe(p,'a',1000,10);observe(p,'b',1000,0)
  assert.throws(()=>transaction(p,original),/account changed/)
  assert.deepEqual(position(p).transactions,[])
  const accepted=move(p,{quantity:8});transaction(p,accepted)
  assert.throws(()=>transaction(p,original),/account changed/)
})
test('public transaction route rejects incomplete evidence, mismatched variant, unimported recipient and monetary fields',async t=>{
  const p=fixture(t),routes=new Map(),hooks=new Map()
  const app={addHook:(k,f)=>hooks.set(k,f)}
  for(const method of ['post','get','put']) app[method]=(route,handler)=>routes.set(method+route,handler)
  registerPersonal(app,{profile:()=>p,marketItem:()=>null,jobs:{register(){}}})
  t.after(()=>hooks.get('onClose')())
  const post=routes.get('post/api/v1/personal/transactions'),get=routes.get('get/api/v1/personal/positions')
  const reply={code(n){this.status=n;return this},send(v){return v}}
  for(const override of [{quantity:11},{recipient:'a'},{recipient:'unseen'},{owner:'manual'},{binding:'bound'},
    {variant:'unknown'},{variant:'-3'},{confirmed:false},{confirmed:undefined},{id:undefined},{id:''},{at:500},{scope:undefined},{unitCopper:'1'}]) {
    const res=await post({body:move(p,override)},reply);assert(res.error,JSON.stringify(override));assert.equal(reply.status,400)
  }
  assert.equal((await post({body:move(p)},reply)).status,'recorded')
  assert.equal((await get({},reply)).positions[0].transactions.length,1)
})
