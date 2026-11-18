import { randomUUID } from 'node:crypto'
import { readExport, normaliseCharacters, hash, label, integer } from './export.mjs'

const ready = new WeakSet()
export function prepare(db) {
  if (ready.has(db)) return
  db.exec('CREATE TABLE IF NOT EXISTS personal_config (id INTEGER PRIMARY KEY CHECK(id=1), record TEXT NOT NULL);' +
    'CREATE TABLE IF NOT EXISTS personal_char (pool TEXT,id TEXT,at INTEGER,seq INTEGER,record TEXT,PRIMARY KEY(pool,id));' +
    'CREATE TABLE IF NOT EXISTS personal_scope (pool TEXT,id TEXT,scope TEXT,at INTEGER,seq INTEGER,record TEXT,PRIMARY KEY(pool,id,scope));' +
    'CREATE TABLE IF NOT EXISTS personal_observation (pool TEXT,id TEXT,scope TEXT,at INTEGER,seq INTEGER,record TEXT,PRIMARY KEY(pool,id,scope,at,seq));' +
    'CREATE TABLE IF NOT EXISTS personal_import (pool TEXT,hash TEXT,imported TEXT,PRIMARY KEY(pool,hash));' +
    'CREATE TABLE IF NOT EXISTS personal_tx (pool TEXT,id TEXT,at INTEGER,record TEXT,PRIMARY KEY(pool,id));' +
    'CREATE TABLE IF NOT EXISTS personal_notes (pool TEXT,asset TEXT,record TEXT,PRIMARY KEY(pool,asset));')
  db.exec("INSERT OR IGNORE INTO personal_observation SELECT * FROM personal_scope WHERE scope IN ('bags','bank')")
  ready.add(db)
}
export function config({db}) {
  prepare(db)
  return JSON.parse(db.prepare('SELECT record FROM personal_config WHERE id=1').get()?.record || '{}')
}
export function setConfig({db},record) {
  prepare(db);db.prepare('INSERT OR REPLACE INTO personal_config VALUES(1,?)').run(JSON.stringify(record))
}
export function pool(profile) {
  const c=config(profile)
  return profile.mode === 'demo' ? 'demo' : c.account && c.product ? hash(c.product.toLowerCase()+'|'+c.account.toLowerCase()) : 'manual'
}
function atomic(db,fn) { db.exec('BEGIN IMMEDIATE');try { const result=fn();db.exec('COMMIT');return result } catch(e){ db.exec('ROLLBACK');throw e } }
const newer = 'WHERE excluded.at>at OR (excluded.at=at AND excluded.seq>seq)'
export function importText(profile,text) {
  const {db}=profile, p=pool(profile), digest=hash(text)
  if (db.prepare('SELECT 1 FROM personal_import WHERE pool=? AND hash=?').get(p,digest)) return {status:'unchanged',characters:0}
  const exports=normaliseCharacters(readExport(text))
  return atomic(db,()=>{
    const character=db.prepare('INSERT INTO personal_char VALUES(?,?,?,?,?) ON CONFLICT(pool,id) DO UPDATE SET at=excluded.at,seq=excluded.seq,record=excluded.record '+newer)
    const scope=db.prepare('INSERT INTO personal_scope VALUES(?,?,?,?,?,?) ON CONFLICT(pool,id,scope) DO UPDATE SET at=excluded.at,seq=excluded.seq,record=excluded.record '+newer)
    for (const {character:c,scopes} of exports) {
      const previous=db.prepare('SELECT record FROM personal_char WHERE pool=? AND id=?').get(p,c.id)
      if (previous && !c.lastLogin) c.lastLogin=JSON.parse(previous.record).lastLogin
      character.run(p,c.id,c.lastSeen,c.sequence,JSON.stringify(c))
      for (const s of scopes) {
        const fields=[p,c.id,s.scope,s.at,s.seq,JSON.stringify(s.items)]
        scope.run(...fields)
        if (s.scope!=='professions') db.prepare('INSERT OR IGNORE INTO personal_observation VALUES(?,?,?,?,?,?)').run(...fields)
      }
    }
    db.prepare('INSERT INTO personal_import VALUES(?,?,?)').run(p,digest,new Date().toISOString())
    db.prepare('DELETE FROM personal_import WHERE pool=? AND rowid NOT IN (SELECT rowid FROM personal_import WHERE pool=? ORDER BY rowid DESC LIMIT 64)').run(p,p)
    return {status:'imported',characters:exports.length}
  })
}
export function listCharacters(profile) {
  const {db}=profile,p=pool(profile)
  return db.prepare('SELECT record FROM personal_char WHERE pool=? ORDER BY id').all(p).map(row=>{
    const c=JSON.parse(row.record), records=db.prepare('SELECT * FROM personal_scope WHERE pool=? AND id=?').all(p,c.id)
    const scopes=Object.fromEntries(records.map(s=>[s.scope,{at:s.at,seq:s.seq,items:JSON.parse(s.record)}]))
    return {...c,professions:scopes.professions?.items??[],professionsAt:scopes.professions?.at??null,bagsAt:scopes.bags?.at??null,bankAt:scopes.bank?.at??null}
  })
}
export function latestImport(profile) {
  const p=pool(profile)
  return profile.db.prepare('SELECT imported FROM personal_import WHERE pool=? ORDER BY rowid DESC LIMIT 1').get(p)?.imported??null
}

function wholeCopper(value) {
  if (!/^\d{1,18}$/.test(String(value))) throw Error('Copper must be a non-negative whole number.')
  return BigInt(value).toString()
}
function identity(input) {
  const itemId=integer(input.itemId,1,10_000_000), variant=label(input.variant??'0',32),binding=input.binding??'tradeable'
  if (!/^(unknown|-?\d{1,10})$/.test(variant) || !['bound','unknown','tradeable'].includes(binding)) throw Error('Invalid variant or binding.')
  return {itemId,variant,binding,asset:[itemId,variant,binding].join('/')}
}
export function saveNote(profile,input) {
  const asset=identity(input).asset, p=pool(profile)
  const note={}
  for (const key of ['reason','target','revisit']) {
    if (typeof input[key] !== 'string' || input[key].length > 2000) throw Error('Invalid position note.')
    note[key]=input[key].trim()
  }
  profile.db.prepare('INSERT OR REPLACE INTO personal_notes VALUES(?,?,?)').run(p,asset,JSON.stringify(note))
  return {asset,...note}
}
export function transaction(profile,input) {
  const p=pool(profile),{db}=profile
  const action=input.action
  if (!['opening','purchase','sale'].includes(action)) throw Error('Select a purchase, opening balance or sale.')
  const tx={...identity(input),action,id:label(input.id??randomUUID(),120),owner:label(input.owner??'manual'),at:integer(input.at,1,Math.floor(Date.now()/1000)+60),
    quantity:integer(input.quantity,1,1_000_000_000),unitCopper:input.unitCopper == null && action!=='sale' ? null : wholeCopper(input.unitCopper),
    feeBps:integer(input.feeBps??500,0,10000),depositPaidCopper:wholeCopper(input.depositPaidCopper??'0'),depositRefundCopper:wholeCopper(input.depositRefundCopper??'0')}
  if (action === 'sale' && tx.binding !== 'tradeable') throw Error('An auction sale requires a verified tradeable item.')
  if (BigInt(tx.depositRefundCopper)>BigInt(tx.depositPaidCopper)) throw Error('Refund exceeds the original deposit.')
  const prior=db.prepare('SELECT record FROM personal_tx WHERE pool=? AND id=?').get(p,tx.id)
  if (prior) {
    if (prior.record !== JSON.stringify(tx)) throw Error('That transaction identity already has different details.')
    return {id:tx.id,status:'unchanged'}
  }
  db.prepare('INSERT INTO personal_tx VALUES(?,?,?,?)').run(p,tx.id,tx.at,JSON.stringify(tx))
  return {id:tx.id,status:'recorded'}
}
function settle(tx,asset) {
  if (tx.action!=='sale') {
    let remaining=tx.quantity
    if (tx.action==='opening') {
      // An opening balance can supply basis for this owner's previously observed stock.
      for (let i=0; i<asset.lots.length && remaining>0; i++) {
        const lot=asset.lots[i]
        if (lot.owner!==tx.owner || !lot.physicalOnly || !lot.left) continue
        const priced=Math.min(lot.left,remaining)
        lot.left-=priced;remaining-=priced
        asset.lots.splice(i++,0,{owner:lot.owner,left:priced,unit:tx.unitCopper})
      }
    }
    if (remaining) asset.lots.push({owner:tx.owner,left:remaining,unit:tx.unitCopper})
    return
  }
  const gross=BigInt(tx.quantity)*BigInt(tx.unitCopper)
  const proceeds=gross-gross*BigInt(tx.feeBps)/10000n-BigInt(tx.depositPaidCopper)+BigInt(tx.depositRefundCopper)
  let remaining=tx.quantity,known=0,basis=0n
  for (const lot of asset.lots) {
    if (!remaining) break
    const used=Math.min(lot.left,remaining)
    lot.left-=used;remaining-=used
    if (lot.unit!==null) {known+=used;basis+=BigInt(lot.unit)*BigInt(used)}
  }
  asset.realisedKnownCopper+=proceeds*BigInt(known)/BigInt(tx.quantity)-basis
  asset.unknownSold+=tx.quantity-known
  asset.receipts.push({id:tx.id,at:tx.at,quantity:tx.quantity,known,proceedsCopper:proceeds.toString()})
}
export function listPositions(profile) {
  const p=pool(profile),{db}=profile, assets=new Map()
  function get(i) {
    const {asset,...key}=identity(i)
    if (!assets.has(asset)) assets.set(asset,{asset,...key,physical:0,economic:0,locations:[],lots:[],receipts:[],transactions:[],realisedKnownCopper:0n,unknownSold:0,timingUncertain:false})
    return assets.get(asset)
  }
  const clocks=new Map(),scopeTimes=new Map()
  for (const s of db.prepare("SELECT * FROM personal_scope WHERE pool=? AND scope IN ('bags','bank')").all(p)) {
    const times=scopeTimes.get(s.id)??{}
    times[s.scope]=s.at;scopeTimes.set(s.id,times)
    clocks.set(s.id,times.bags??times.bank)
    for (const i of JSON.parse(s.record)) {
      const a=get(i);a.physical+=i.quantity;a.economic+=i.quantity
      const loc=a.locations.find(l=>l.id===s.id&&l.scope===s.scope&&l.link===i.link)
      if (loc) loc.quantity+=i.quantity
      else a.locations.push({id:s.id,scope:s.scope,quantity:i.quantity,at:s.at,link:i.link})
    }
  }
  const history=db.prepare("SELECT id,scope,at,seq,record FROM personal_observation WHERE pool=? ORDER BY at,seq").all(p)
  const receipts=db.prepare('SELECT at,record FROM personal_tx WHERE pool=? ORDER BY at,rowid').all(p)
  // At the same second actual capture order is unknown. Observe unknown units before allocating known gain.
  const timeline=[...history,...receipts].sort((a,b)=>a.at-b.at)
  const observedByOwner=new Map()
  for (const row of timeline) {
    if (row.scope) {
      const totals=new Map()
      for (const item of JSON.parse(row.record)) {
        const a=get(item)
        totals.set(a.asset,(totals.get(a.asset)??0)+item.quantity)
      }
      const byScope=observedByOwner.get(row.id)??new Map()
      byScope.set(row.scope,totals);observedByOwner.set(row.id,byScope)
      // Two containers captured at different times may contain the same transferred items.
      // Only a same-time snapshot can raise the lower bound by summing the two.
      for (const [key,count] of totals) {
        const a=assets.get(key)
        const owned=a.lots.filter(l=>l.owner===row.id).reduce((n,l)=>n+l.left,0)
        const other=row.scope==='bank'?'bags':'bank'
        const previous=byScope.get(other),sibling=previous?.get(key)??0
        const sameTime=byScope.get(other+'At')===row.at
        const observed=sameTime?count+sibling:Math.max(count,sibling)
        if (observed>owned) a.lots.push({owner:row.id,left:observed-owned,unit:null,physicalOnly:true})
        if (sibling && !sameTime) a.timingUncertain=true
      }
      byScope.set(row.scope+'At',row.at)
      continue
    }
    const tx=JSON.parse(row.record),a=get(tx)
    a.transactions.push(tx)
    const observed=clocks.get(tx.owner),times=scopeTimes.get(tx.owner)
    if (observed===undefined || (tx.action!=='opening' && tx.at>observed)) a.economic+=(tx.action==='sale'?-1:1)*tx.quantity
    if (observed===tx.at || (times?.bank && times.bags && tx.at>Math.min(times.bank,times.bags) && tx.at<=Math.max(times.bank,times.bags))) a.timingUncertain=true
    settle(tx,a)
  }
  for (const row of db.prepare('SELECT * FROM personal_notes WHERE pool=?').all(p)) {
    const [item,variant,binding]=row.asset.split('/')
    get({itemId:Number(item),variant,binding}).note=JSON.parse(row.record)
  }
  return Array.from(assets.values()).map(a=>{
    const {lots,realisedKnownCopper,...result}=a
    const knownUnits=lots.reduce((n,l)=>l.unit===null?n:n+l.left,0),bookUnits=lots.reduce((n,l)=>n+l.left,0)
    return {...result,knownUnits,unknownUnits:Math.max(0,a.economic-knownUnits),unreconciledUnits:bookUnits-a.economic,
      knownBasisCopper:lots.reduce((n,l)=>n+(l.unit===null?0n:BigInt(l.left)*BigInt(l.unit)),0n).toString(),realisedKnownCopper:realisedKnownCopper.toString()}
  }).sort((a,b)=>a.itemId-b.itemId||a.asset.localeCompare(b.asset))
}
