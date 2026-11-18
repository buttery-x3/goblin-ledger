import Fastify from 'fastify';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkout, migrate, openProfiles, readPreference, savePreference } from './storage.mjs';
import { createJobs, registerOperations } from './operations.mjs';
import { registerMarket, getMarketNextAttempt } from './market.mjs';
import { getHouse, latest } from './market-store.mjs';
import { registerFarms, getRoutes } from './farms.mjs';
import { registerPersonal } from './personal.mjs';
import { registerResearch } from './research.mjs';

const mime={js:'text/javascript',css:'text/css',svg:'image/svg+xml',png:'image/png',woff2:'font/woff2',ico:'image/x-icon'};
const token = () => randomBytes(32).toString('hex');
function matches(a,b) {
  return typeof a==='string' && /^[0-9a-f]{64}$/.test(a) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
}

export async function createServer({root,assets=join(checkout,'dist'),scheduling=true}={}) {
  const profiles=await openProfiles(root);
  let mode=readPreference(profiles.live.db,'mode','live')==='demo'?'demo':'live';
  const jobs=createJobs();
  const profile=()=>({...profiles[mode]});
  const ctx={migrate,profile,profiles:()=>Object.values(profiles).map(p=>({...p})),jobs};
  const app=Fastify({logger:false,bodyLimit:524288,requestTimeout:30_000});
  // A single per-process session is shared by this user's tabs. Browser pages
  // must obtain both the HttpOnly cookie and the response token on our origin.
  const cookie=token();
  let csrf=token();
  app.addHook('onRequest',async (req,res)=>{
    const host=req.headers.host??'';
    if (!/^(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(host)) return res.code(403).send({error:'Use the local launch URL.'});
    if (req.headers.origin && req.headers.origin!=='http://'+host) return res.code(403).send({error:'Request origin does not match the local service.'});
    res.header('X-Content-Type-Options','nosniff');
    res.header('Referrer-Policy','no-referrer');
    res.header('Cross-Origin-Resource-Policy','same-origin');
    if (req.url.startsWith('/api/')) res.header('Cache-Control','no-store');
    const expected = mode+':'+(profiles[mode].region??'-');
    const advertised = req.headers['x-goblin-profile'] ?? (req.url.startsWith('/api/v1/events') ? req.query?.profile : null);
    if (advertised && advertised!==expected && !req.url.startsWith('/api/v1/bootstrap')) {
      return res.code(409).send({code:'PROFILE_CHANGED',error:'Another tab changed the profile. Refresh this tab.'});
    }
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
      const cookies=(req.headers.cookie??'').split(/;\s*/);
      if (!cookies.includes('gl_session='+cookie) || !matches(req.headers['x-goblin-token'],csrf)) {
        return res.code(403).send({error:'Reopen the dashboard to renew the local session.'});
      }
    }
  });
  app.setErrorHandler((error,req,res)=>{
    let code=Number(error.statusCode??error.status);
    if (!Number.isInteger(code)||code<400||code>599) code=500;
    const message=code>=500?'The operation failed. Open Status / Console for details.':String(error.message||'Invalid request').slice(0,350);
    return res.code(code).send({error:message});
  });
  app.get('/api/v1/health',async()=>({product:'Goblin Ledger',protocol:1,status:'ok',mode}));
  app.get('/api/v1/bootstrap',async (_req,res)=>{
    const p=profile();
    res.header('Set-Cookie','gl_session='+cookie+'; Path=/; HttpOnly; SameSite=Strict');
    const house=getHouse(p);
    const freshness=house?latest(p.db,house.key)?.t??null:null;
    return {mode:p.mode,region:p.region,token:csrf,freshness,workspace:readPreference(p.db,'workspace',null),routes:await getRoutes(p)};
  });
  app.put('/api/v1/workspace',{schema:{body:{type:'object',required:['workspace'],properties:{workspace:{type:'object'}},additionalProperties:false}}},async req=>{
    const value=req.body.workspace;
    if (JSON.stringify(value).length>150_000) throw Object.assign(new Error('Workspace is too large.'),{statusCode:400});
    savePreference(profile().db,'workspace',value);
    return {saved:true};
  });
  app.put('/api/v1/settings',{schema:{body:{type:'object',required:['mode'],properties:{mode:{enum:['live','demo']},region:{enum:['us','eu',null]}},additionalProperties:false}}},async req=>{
    const next=profiles[req.body.mode];
    if (Object.hasOwn(req.body,'region')) {
      savePreference(next.db,'region',req.body.region);
      next.region=req.body.region;
    }
    if (next.mode!==mode || Object.hasOwn(req.body,'region')) csrf=token();
    mode=next.mode;
    savePreference(profiles.live.db,'mode',mode);
    return {mode,region:next.region};
  });
  let stopped=false,timer;
  app.addHook('onClose',async()=>{
    stopped=true;
    clearInterval(timer);
    await jobs.shutdown();
    for (const p of Object.values(profiles)) p.db.close();
  });
  try {
    jobs.register('storage.check',async({profile:p,log})=>{
      const version=p.db.prepare('PRAGMA user_version').get().user_version;
      log('Profile opened with schema '+version,'info',{stage:'Ready'});
      return {version};
    },{source:'sqlite',description:'Profile startup'});
    for (const p of ctx.profiles()) await jobs.run('storage.check',p);
    registerOperations(app,ctx);
    registerMarket(app,ctx);
    registerFarms(app,ctx);
    registerPersonal(app,ctx);
    registerResearch(app,ctx);
    const asset=async (path,type,res)=>{
      try {const data=await readFile(path);return res.type(type).send(data);}
      catch {return res.code(404).send({error:'Build the dashboard using pnpm build.'});}
    };
    app.get('/',async (_req,res)=>asset(join(assets,'index.html'),'text/html; charset=utf-8',res));
    app.get('/assets/:name',async (req,res)=>{
      const name=req.params.name, ext=name.split('.').pop();
      if (!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(name)||!mime[ext]) return res.code(404).send();
      return asset(join(assets,'assets',name),mime[ext],res);
    });
    if (scheduling) {
      let busy=false;
      const tick=async()=>{
        const p={...profiles.live};
        if (stopped || busy || !p.region) return;
        busy=true;
        try {
          for (const job of ['market.refresh','market.recipes']) {
            if(stopped || jobs.list(p).find(j=>j.name===job)?.paused) continue;
            const due=getMarketNextAttempt(p,job);
            jobs.schedule(job,p,due);
            if(due && due>Date.now()) continue;
            try {await jobs.run(job,p);} catch { /* The runner retains the error and the adapter reserves the next attempt. */ }
            jobs.schedule(job,p,getMarketNextAttempt(p,job));
          }
        } finally {busy=false;}
      };
      app.addHook('onListen',async()=>{timer=setInterval(()=>void tick(),30_000);timer.unref();void tick();});
    }
    await app.ready();
    return app;
  } catch(error) {
    await app.close();
    throw error;
  }
}
