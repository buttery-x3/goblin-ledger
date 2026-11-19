import { promises as fs, watch } from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { inspect, install, browse, exportFile, plainPath, recoverPendingInstall } from './personal/install.mjs'
import { MAX_EXPORT } from './personal/export.mjs'
import { valuePosition } from './personal/valuation.mjs'
import { config,setConfig,pool,importText,latestImport,listCharacters as characters,listPositions,transaction,saveNote } from './personal/ledger.mjs'

const demoSeeded=new WeakSet()
function seed(profile) {
  if (profile.mode!=='demo' || demoSeeded.has(profile.db)) return
  const sample=(id,name,cls,lv,quantity,at,prof,skill)=>'["'+id+'"]={id="'+id+'",name="'+name+'",realm="Example",className="'+cls+'",level='+lv+
    ',xp=16200,xpMax=28000,money=482200,lastSeen='+at+',lastLogin='+(at-1200)+',restedXp=5200,build="70888",interface=16001,sequence=1,'+
    'bags={at='+at+',seq=1,complete=true,items={{itemId=18945,quantity='+quantity+',link="18945:0:0:0:0:0:0",binding="tradeable"}}},'+
    'professions={at='+at+',seq=1,complete=true,items={{name="'+prof+'",skill='+skill+'}}}}'
  importText(profile,'GoblinLedgerDB={schema=1,characters={'+sample('demo-fern','Fern','DRUID',24,6000,1794916800,'Herbalism',180)+','+
    sample('demo-ember','Ember','MAGE',33,4000,1794920400,'Alchemy',123)+'}}')
  for (const [owner,quantity] of [['demo-fern',6000],['demo-ember',4000]]) transaction(profile,{id:'demo-basis-'+owner,at:1794910000,owner,
    action:'opening',itemId:18945,quantity,unitCopper:'100'})
  transaction(profile,{id:'demo-sale',at:1794924000,owner:'demo-fern',action:'sale',itemId:18945,quantity:500,unitCopper:'300'})
  demoSeeded.add(profile.db)
}
export function listCharacters(profile){seed(profile);return characters(profile)}
function live(profile) { if (profile.mode==='demo') throw Error('Switch to Live to select a real installation or import an account.') }
function selected(profile) {
  live(profile)
  const c=config(profile)
  if (!c.product || !c.account) throw Error('Select a Forever installation and account in Settings.')
  return c
}
async function importFile(profile) {
  const selectedPool=pool(profile),c=selected(profile),file=await exportFile(c.product,c.account)
  let handle
  try {
    await plainPath(file);handle=await fs.open(file,'r')
    const before=await handle.stat()
    if (!before.isFile() || before.size>MAX_EXPORT) throw Error('Export exceeds the local size limit.')
    await delay(160)
    await plainPath(file)
    const current=await fs.stat(file)
    if (current.ino!==before.ino || current.size!==before.size || current.mtimeMs!==before.mtimeMs) throw Error('Export is still being written. Retry after it settles.')
    const bytes=Buffer.alloc(before.size)
    let offset=0
    while (offset<bytes.length) {
      const {bytesRead}=await handle.read(bytes,offset,bytes.length-offset,offset)
      if (!bytesRead) throw Error('The export changed during import. Retry after it settles.')
      offset+=bytesRead
    }
    const after=await handle.stat(),replaced=await fs.stat(file)
    if (after.mtimeMs!==before.mtimeMs || after.size!==before.size || replaced.ino!==before.ino || replaced.mtimeMs!==before.mtimeMs)
      throw Error('The export changed during import. Retry after it settles.')
    if (selectedPool!==pool(profile)) throw Error('The selected account changed. Retry the import.')
    return importText(profile,bytes.toString('utf8'))
  } catch (err) {
    if (err.code==='ENOENT') throw Error('Waiting for the first export. WoW writes SavedVariables on normal logout or UI reload.')
    throw err
  } finally {await handle?.close()}
}
function friendly(e) {
  if (e.code==='EACCES' || e.code==='EPERM') return 'Windows denied access. Check the selected folder and its permissions.'
  if (e.code==='ENOENT' || e.code==='ENOTDIR') return 'The selected folder has moved or is unavailable.'
  if (e.code) return 'The local file operation failed. Check the selected folder in Settings.'
  return e.message
}
export function registerPersonal(app,ctx) {
  let watcher=null,watchPath=null,lastProbe='',active=false
  function stopWatch() {watcher?.close();watcher=null;watchPath=null;lastProbe=''}
  function checkConfigured() {
    const p=ctx.profile()
    if (p.mode==='demo' || !config(p).account) {stopWatch();return}
    if (!active) void ctx.jobs.run('personal.watch',p).catch(()=>{})
  }
  async function probe(p) {
    if (active) return
    active=true
    try {
      if (p.mode==='demo') {stopWatch();return}
      const c=config(p)
      if (!c.product || !c.account) {stopWatch();return}
      const file=await exportFile(c.product,c.account),dir=path.dirname(file)
      if (watchPath!==dir || !watcher) {
        stopWatch()
        try {
          watcher=watch(dir,(event,name)=>{if (!name || String(name).toLowerCase()==='goblinledger.lua') checkConfigured()})
          watcher.on('error',()=>{stopWatch()});watchPath=dir
        } catch { /* A later scan detects a newly created or moved SavedVariables folder. */ }
      }
      const s=await fs.stat(file).catch(()=>null)
      if (!s) return
      const sig=[pool(p),s.ino,s.size,s.mtimeMs].join('/')
      if (sig===lastProbe) return
      await ctx.jobs.run('personal.import',p)
      lastProbe=sig
    } finally {active=false}
  }
  app.addHook('onReady',async()=>{
    const p=ctx.profile()
    if (p.mode==='live' && config(p).product) await ctx.jobs.run('personal.recover',p).catch(()=>{})
    queueMicrotask(checkConfigured)
  })
  const timer=setInterval(checkConfigured,30000);timer.unref()
  app.addHook('onClose',async()=>{clearInterval(timer);stopWatch()})
  const register=(name,handler,options)=>ctx.jobs.register(name,async arg=>{
    try {return await handler(arg)} catch(e) {throw Error(friendly(e))}
  },{modes:['live'],...options})
  register('personal.recover',async({profile,log})=>{
    const product=config(profile).product
    const recovered=product ? await recoverPendingInstall(product) : false
    log(recovered?'Recovered the interrupted addon installation.':'No interrupted addon installation.')
    return {recovered}
  },{source:'Addon',description:'Recover an interrupted addon installation'})
  register('personal.watch',async({profile,log})=>{await probe(profile);log('Checked selected account for a saved export.');return {status:'checked'}},{manual:true,source:'SavedVariables',description:'Check the selected account for file changes'})
  register('personal.import',async({profile,log})=>{
    const result=await importFile(profile);log(result.status==='unchanged'?'Previously imported export.':'Stored complete character observations.','info',{processed:result.characters})
    return result
  },{manual:true,retry:true,source:'SavedVariables',description:'Import the selected account export'})
  register('personal.install',async({profile,log,payload})=>{
    live(profile)
    if (!payload?.product || config(profile).product!==payload.product) throw Error('Verify the destination in Settings before installing.')
    const result=await install(payload.product);log('Addon '+result.action+'.');return {action:result.action}
  },{source:'Addon',description:'Install or update the bundled addon'})
  function route(method,name,fn) {
    app[method]('/api/v1/personal/'+name,async(request,reply)=>{
      try {
        const p=ctx.profile();seed(p)
        return await fn(p,request.body??{},request.query??{})
      } catch (e) {return reply.code(400).send({error:friendly(e)})}
    })
  }
  route('get','setup',async p=>{
    const c=config(p)
    let install=null,warning=null,candidates=[]
    if (c.product && p.mode!=='demo') try {install=await inspect(c.product)}catch(e){warning=friendly(e)}
    if (p.mode!=='demo' && !c.product) {
      for (const base of [process.env.ProgramFiles,process.env['ProgramFiles(x86)']].filter(Boolean)) {
        const candidate=path.join(base,'World of Warcraft')
        try {const item=await inspect(candidate);if (!candidates.includes(item.product)) candidates.push(item.product)} catch { /* Not a Forever installation. */ }
      }
    }
    return {...c,install,warning,candidates,importedAt:latestImport(p)}
  })
  route('post','browse',async(p,b)=>{live(p);return browse(b.path)})
  route('post','inspect',async(p,b)=>{
    live(p);const r=await inspect(b.path),c=config(p)
    setConfig(p,{product:r.product,account:c.product===r.product && r.accounts.includes(c.account)?c.account:null})
    return r
  })
  route('post','select-account',async(p,b)=>{
    live(p);const c=config(p);await exportFile(c.product,b.account);setConfig(p,{...c,account:b.account});stopWatch();return {account:b.account}
  })
  route('post','install',(p,b)=>ctx.jobs.run('personal.install',p,{product:b.product}))
  route('post','import',p=>ctx.jobs.run('personal.import',p))
  route('get','characters',p=>({scope:pool(p),characters:listCharacters(p)}))
  route('get','positions',async p=>{
    const scope=pool(p),positions=listPositions(p)
    if (!positions.length) return {scope,positions}
    const getItem=ctx.marketItem??(await import('./market.mjs')).getMarketItem
    return {scope,positions:positions.map(position=>({...position,valuation:valuePosition(position,getItem(p,position.itemId))}))}
  })
  route('post','transactions',(p,b)=>transaction(p,b))
  route('put','notes',(p,b)=>saveNote(p,b))
}
