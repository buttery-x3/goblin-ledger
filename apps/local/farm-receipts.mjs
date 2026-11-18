import {checkedInt, farmReturns} from '../../packages/domain/farms.mjs';
import {listCharacters, listPositions, pool} from './personal/ledger.mjs';

const reject = (message, statusCode=409) => {throw Object.assign(new Error(message),{statusCode});};
export function prepareAllocations(db) {
  if (!db.prepare('PRAGMA table_info(farm_runs)').all().some(row => row.name==='account')) {
    db.exec('ALTER TABLE farm_runs ADD COLUMN account TEXT');
  }
  db.exec(`CREATE TABLE IF NOT EXISTS farm_allocations(
    account TEXT NOT NULL, id TEXT NOT NULL, sale TEXT NOT NULL, run TEXT NOT NULL, stack INTEGER NOT NULL,
    units INTEGER NOT NULL, saleUnits INTEGER NOT NULL, netCopper TEXT NOT NULL, voided INTEGER DEFAULT 0,
    PRIMARY KEY(account,id));
    CREATE INDEX IF NOT EXISTS farm_alloc_sale ON farm_allocations(account,sale);
    CREATE INDEX IF NOT EXISTS farm_alloc_run ON farm_allocations(account,run,stack)`);
}

export function recordScope(profile, run) {
  const account=pool(profile);
  const observedActor=!!run.characterId && account!=='manual' && listCharacters(profile).some(c=>c.id===run.characterId);
  return {account,observedActor};
}
export function legacyAccount(profile) {return profile.mode==='demo'?'demo':'manual';}

function forRun(profile,runId) {
  const {db}=profile, account=pool(profile);
  const row=db.prepare('SELECT id,account,observed,details FROM farm_runs WHERE id=? AND COALESCE(account,?)=?')
    .get(runId,legacyAccount(profile),account);
  if (!row) reject('Run is unavailable in the selected account.',404);
  const run={...JSON.parse(row.details),id:row.id,observed:row.observed};
  return {account,run,verified:row.account!=null && account!=='manual' && run.observedActor};
}

// Allocate integer copper cumulatively within a settlement. If an attribution is
// undone, the remaining active allocations receive the same deterministic replay.
function attributed(profile,runIds) {
  if (!runIds.length) return [];
  const account=pool(profile), ids=JSON.stringify(runIds);
  const rows=profile.db.prepare(`WITH allocations AS (
    SELECT id,sale,run,stack,units,saleUnits,netCopper,
      SUM(units) OVER (PARTITION BY sale ORDER BY rowid) AS finish
    FROM farm_allocations WHERE account=? AND voided=0 AND sale IN (
      SELECT sale FROM farm_allocations WHERE account=? AND run IN (SELECT value FROM json_each(?))
    )
  ) SELECT * FROM allocations WHERE run IN (SELECT value FROM json_each(?)) ORDER BY sale,finish`).all(account,account,ids,ids);
  return rows.map(r=>{
    const net=BigInt(r.netCopper),quantity=BigInt(r.saleUnits);
    const value=net*BigInt(r.finish)/quantity-net*BigInt(r.finish-r.units)/quantity;
    return {id:r.id,saleId:r.sale,runId:r.run,stack:r.stack,units:r.units,netCopper:String(value)};
  });
}

export function allocationOptions(profile,runId) {
  const {account,run,verified}=forRun(profile,runId), db=profile.db;
  const linked=attributed(profile,[runId]);
  const result={linked,choices:[],reason:null};
  if (!verified) return {...result,reason:'Record a run with an imported character in the selected account to link a sale.'};
  const positions=listPositions(profile);
  const remaining=db.prepare('SELECT COALESCE(sum(units),0) n FROM farm_allocations WHERE account=? AND sale=? AND voided=0');
  const recordedAt=Math.floor(Date.parse(run.observed)/1000);
  for (const [stack,h] of run.haul.entries()) {
    if (h.exit!=='auction' || h.binding!=='tradeable' || h.variant==null || h.variant==='unknown') continue;
    const position=positions.find(p=>p.itemId===h.itemId && p.binding===h.binding && p.variant===h.variant);
    if (!position) continue;
    const left=h.units-linked.filter(a=>a.stack===stack).reduce((n,a)=>n+a.units,0);
    if (!left) continue;
    const sellerById=new Map(position.transactions.filter(tx=>tx.action==='sale').map(tx=>[tx.id,tx.owner]));
    for (const receipt of position.receipts) {
      if (sellerById.get(receipt.id)!==run.characterId || receipt.at<=recordedAt || receipt.at>Math.floor(Date.now()/1000)) continue;
      const unsplit=receipt.quantity-remaining.get(account,receipt.id).n;
      const max=Math.min(left,unsplit);
      if (max>0) result.choices.push({stack,itemId:h.itemId,variant:h.variant,availableHaul:left,availableSale:unsplit,
        max,saleId:receipt.id,saleTime:receipt.at,settlementUnits:receipt.quantity,settlementNetCopper:receipt.proceedsCopper});
    }
  }
  if (!result.choices.length) result.reason='No available later settlement matches this actor and an explicitly tradeable haul stack with a known variant.';
  return result;
}

export function allocate(profile,runId,input) {
  const db=profile.db, account=pool(profile);
  if (!input || !/^[a-zA-Z0-9-]{8,80}$/.test(input.id??'') || typeof input.saleId!=='string') reject('Supply a valid allocation and receipt ID.',400);
  const stack=checkedInt(input.stack,'Haul stack',0,31),units=checkedInt(input.units,'Allocated units',1,100000);
  db.exec('BEGIN IMMEDIATE');
  try {
    const prior=db.prepare('SELECT run,sale,stack,units,voided FROM farm_allocations WHERE account=? AND id=?').get(account,input.id);
    if (prior) {
      if (prior.run!==runId || prior.sale!==input.saleId || prior.stack!==stack || prior.units!==units || prior.voided) reject('Allocation ID already used.');
    } else {
      const {choices}=allocationOptions(profile,runId);
      const sale=choices.find(c=>c.stack===stack && c.saleId===input.saleId);
      if (!sale || units>sale.max) reject('The selected haul and settlement no longer have that many eligible units.');
      db.prepare('INSERT INTO farm_allocations(account,id,sale,run,stack,units,saleUnits,netCopper) VALUES(?,?,?,?,?,?,?,?)')
        .run(account,input.id,input.saleId,runId,stack,units,sale.settlementUnits,sale.settlementNetCopper);
    }
    db.exec('COMMIT');
    return {id:input.id,repeated:!!prior};
  } catch(error) {db.exec('ROLLBACK');throw error;}
}

export function undoAllocation(profile,runId,id) {
  const {account}=forRun(profile,runId);
  const result=profile.db.prepare('UPDATE farm_allocations SET voided=1 WHERE account=? AND run=? AND id=?').run(account,runId,id);
  if (!result.changes) reject('Allocation was not found.',404);
  return {id,voided:true};
}

export function realisedView(profile,runs,options) {
  const matches=attributed(profile,runs.map(r=>r.id));
  if (!matches.length) return null;
  const sold=new Map(),receipts=new Set();
  let total=0n,units=0;
  for (const link of matches) {
    const key=link.runId+'/'+link.stack;
    sold.set(key,(sold.get(key)??0)+link.units);
    total+=BigInt(link.netCopper);units+=link.units;receipts.add(link.saleId);
  }
  const unsold=runs.map(run=>({...run,haul:run.haul.map((h,stack)=>({...h,units:h.units-(sold.get(run.id+'/'+stack)??0)})).filter(h=>h.units>0)}));
  const remainder=farmReturns(unsold,options);
  const cash=BigInt(remainder.coinCopper)+total-BigInt(remainder.expenseCopper);
  return {saleUnits:units,settlements:receipts.size,settledCopper:String(total),cashAfterExpensesCopper:String(cash),
    unsoldAuctionCopper:remainder.auctionCopper,unsoldVendorCopper:remainder.vendorCopper,gaps:remainder.gaps,
    combinedCopper:remainder.gaps.length?null:String(cash+BigInt(remainder.auctionCopper)+BigInt(remainder.vendorCopper))};
}
