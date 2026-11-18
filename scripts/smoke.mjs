import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root=await mkdtemp(join(tmpdir(),'Goblin Ledger smoke '));
let running;
async function start() {
  const child=fork(new URL('../apps/local/start.mjs',import.meta.url),[],{stdio:['ignore','pipe','pipe','ipc'],
    env:{...process.env,GOBLIN_LEDGER_HOME:root,GOBLIN_LEDGER_PORT:'0',GOBLIN_LEDGER_DISABLE_SCHEDULE:'1'}});
  running=child;
  let output='';
  child.stdout.on('data',s=>output=(output+s).slice(-2000));child.stderr.on('data',s=>output=(output+s).slice(-2000));
  const address=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(Error('Local startup timed out. '+output));},20_000);
    child.once('error',e=>{clearTimeout(timer);reject(e);});
    child.once('message',msg=>{clearTimeout(timer);resolve(msg.address);});
    child.once('exit',code=>{clearTimeout(timer);reject(Error('Local service exited '+code+' '+output));});
  });
  return address;
}
async function stop() {
  const child=running;
  if(!child || child.exitCode!==null || child.signalCode!==null) return;
  const ended=once(child,'exit');
  const timer=setTimeout(()=>child.kill(),8000);
  if (child.connected) child.send('shutdown');else child.kill();
  try {const [code]=await ended;assert.equal(code,0,'Service must shut down cleanly');} finally {clearTimeout(timer);}
  running=null;
}
try {
  let url=await start(), headers;
  const request=(path,opts={})=>fetch(url+'/api/v1'+path,{signal:AbortSignal.timeout(10000),...opts});
  async function boot() {
    const res=await request('/bootstrap');
    assert.equal(res.status,200);
    const data=await res.json();
    headers={'Content-Type':'application/json',Origin:url,Cookie:res.headers.get('set-cookie').split(';')[0],'X-Goblin-Token':data.token,'X-Goblin-Profile':data.mode+':'+(data.region??'-')};
    return data;
  }
  const change=(path,body,method='POST')=>request(path,{method,headers,body:JSON.stringify(body)});
  const shell=await fetch(url);assert.equal(shell.status,200);const html=await shell.text();
  const assets=[...html.matchAll(/(?:href|src)="(\/assets\/[^"]+)"/g)].map(m=>m[1]);
  assert.ok(assets.some(a=>a.endsWith('.js')));assert.ok(assets.some(a=>a.endsWith('.css')));
  for(const asset of assets) assert.equal((await fetch(url+asset)).status,200);
  assert.equal((await (await request('/health')).json()).product,'Goblin Ledger');
  const live=await boot();assert.equal(live.mode,'live');assert.equal(live.region,null);assert.ok(live.routes.length>=3);
  assert.equal((await request('/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:'{"mode":"demo"}'})).status,403);
  assert.equal((await change('/settings',{mode:'demo',region:'us'},'PUT')).status,200);
  const demo=await boot();assert.equal(demo.mode,'demo');
  for(const path of ['/markets','/opportunities','/personal/characters','/personal/positions','/research','/crafts/catalog','/jobs','/farms']) {
    const res=await request(path,{headers});assert.equal(res.status,200,path+' '+await res.text());
  }
  const saved={version:1,current:{preset:'terminal'},named:[]};
  assert.equal((await change('/workspace',{workspace:saved},'PUT')).status,200);
  const failed=await change('/jobs/demo.diagnostic/run',{});assert.ok(failed.status>=400);
  let history=await (await request('/job-runs?name=demo.diagnostic')).json();
  assert.equal(history.runs[0].status,'failed');
  assert.equal((await change('/jobs/demo.diagnostic/retry',{runId:history.runs[0].id})).status,200);
  history=await (await request('/job-runs?name=demo.diagnostic')).json();
  assert.equal(history.runs[0].status,'succeeded');assert.equal(history.runs[0].retryOf,history.runs[1].id);
  const controller=new AbortController(),events=await request('/events?profile=demo:us',{signal:controller.signal});
  assert.match(events.headers.get('content-type'),/text\/event-stream/);
  const reader=events.body.getReader();await reader.read();controller.abort();
  assert.equal((await change('/jobs/maintenance.backup/run',{})).status,200);
  assert.equal((await change('/jobs/maintenance.verify-backup/run',{})).status,200);
  await stop();url=await start();assert.deepEqual((await boot()).workspace,saved);
  assert.equal((await change('/settings',{mode:'live'},'PUT')).status,200);
  const original=await boot();assert.equal(original.workspace,null);assert.equal(original.region,null);
  console.log('Production HTTP, assets, sessions, profile isolation, operations, backup/restore and restart passed.');
} finally {
  try {await stop();} finally {await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
}
