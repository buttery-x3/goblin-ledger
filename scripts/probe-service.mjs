// A bounded live acceptance check against the same API and storage used by the dashboard.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from '../apps/local/server.mjs';

const region=process.argv[2];
if (!['eu','us'].includes(region)) throw Error('Choose one diagnostic region (eu or us).');
const root=await mkdtemp(join(tmpdir(),'Ledger contract '));
const app=await createServer({root,scheduling:false});
const evidence={region,checkedAt:new Date().toISOString(),secondary:[]};
let headers={host:'127.0.0.1'};
async function request(path,method='GET',payload) {
  const r=await app.inject({url:'/api/v1'+path,method,headers,payload});
  if(r.statusCode!==200) throw Error('HTTP '+r.statusCode+' '+r.json().error);
  return r.json();
}
async function session() {
  const res=await app.inject({url:'/api/v1/bootstrap',headers:{host:'127.0.0.1'}});
  const state=res.json();
  headers={host:'127.0.0.1',cookie:res.headers['set-cookie'].split(';')[0],'x-goblin-token':state.token,'x-goblin-profile':state.mode+':'+(state.region??'-')};
}
try {
  await session();
  await request('/settings','PUT',{mode:'live',region});
  await session();
  await request('/markets/refresh','POST',{});
  const market=await request('/markets?limit=10');
  if(!market.snapshot?.t || !market.count) throw Error('No coherent market published');
  evidence.archive={house:market.house,observedAt:market.snapshot.t,count:market.count};
  const opportunity=await request('/opportunities?limit=2');
  evidence.scanner={observedAt:opportunity.snapshot?.t,rows:opportunity.count};
  const known=await request('/markets?q=18945&limit=1');
  const ids=[...new Set([...known.items,...market.items].map(i=>i.id))].slice(0,3);
  if(ids.length) {
    await request('/markets/'+ids[0]+'/detail','POST',{});
    const item=await request('/markets/'+ids[0]+'?quantity=12');
    evidence.detail={id:ids[0],historyRows:item.history.length,bookTime:item.detail?.book?.t,tiers:item.detail?.book?.levels?.length};
  }
  for(const id of ids) {
    const primary=await request('/markets/'+id);
    try {
      const secondary=await request('/markets/'+id+'/crosscheck','POST',{});
      const comparable=Number.isFinite(secondary.observedAt) && Math.abs(secondary.observedAt-market.snapshot.t)<=3600000 && secondary.ask!=null && primary.item?.ask!=null;
      evidence.secondary.push({id,state:comparable?'comparable':'different-time-or-unavailable',sameAsk:comparable?secondary.ask===primary.item.ask:null,observedAt:secondary.observedAt});
    } catch(error){evidence.secondary.push({id,state:'unavailable',reason:error.message});break;}
    if(id!==ids.at(-1)) await delay(2100);
  }
} catch(error) {
  evidence.blocker=error.message;
  const logs=await request('/job-logs?level=error&limit=3').catch(()=>null);
  evidence.errors=logs?.logs?.map(l=>l.message);
} finally {
  await app.close();await rm(root,{recursive:true,force:true,maxRetries:3});
}
console.log('SERVICE_PROBE '+JSON.stringify(evidence));
