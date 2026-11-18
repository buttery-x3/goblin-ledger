import * as fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { constants } from 'node:fs'
import { hash } from './export.mjs'

const bundle = fileURLToPath(new URL('../../../addon/GoblinLedger/',import.meta.url))
const files = ['GoblinLedger.lua','GoblinLedger.toc']
const marker = '.goblin-ledger-manifest.json'
const currentName = 'GoblinLedger', priorName = '.GoblinLedger-previous', stageName = '.GoblinLedger-staged'
const swaps = new Set()

async function stat(p) { try { return await fs.lstat(p) } catch (e) { if (e.code === 'ENOENT') return null; throw e } }
function localPath(input) {
  if (typeof input !== 'string' || !path.isAbsolute(input) || input.length > 800 || /[\0\r\n]/.test(input) || /^[/\\]{2}/.test(input))
    throw Error('Choose an absolute folder on a local drive.')
  return path.resolve(input)
}
export async function plainPath(input) {
  const p = localPath(input), root = path.parse(p).root
  let dir = root
  for (const part of p.slice(root.length).split(path.sep).filter(Boolean)) {
    dir = path.join(dir,part)
    const s = await stat(dir)
    if (s?.isSymbolicLink()) throw Error('Choose folders without junctions or symbolic links.')
    if (!s) break
  }
  return p
}
async function folders(dir) {
  const items = await fs.opendir(dir), result = []
  try {
    for await (const ent of items) {
      if (ent.isDirectory() && !ent.isSymbolicLink() && !ent.name.startsWith('.')) result.push(ent.name)
      if (result.length >= 300) break
    }
  } finally { await items.close().catch(()=>{}) }
  return result.sort((a,b)=>a.localeCompare(b))
}
export async function browse(input) {
  if (!input) {
    const roots = process.platform === 'win32' ? await Promise.all(['C','D','E','F','G','H'].map(async letter=>{
      const candidate = letter + ':\\'
      return (await stat(candidate))?.isDirectory() ? candidate : null
    })) : ['/']
    return {path:'',parent:null,folders:roots.filter(Boolean)}
  }
  const dir = await plainPath(input)
  return {path:dir,parent:path.dirname(dir)===dir ? '' : path.dirname(dir),folders:(await folders(dir)).map(n=>path.join(dir,n))}
}
async function checkedSmallFile(file,limit) {
  await plainPath(file)
  const s = await stat(file)
  if (!s?.isFile() || s.size > limit) throw Error('An expected file is unavailable or too large.')
  return fs.readFile(file)
}
async function installedBuild(product) {
  const info = path.resolve(product,'..','.build.info')
  if (!(await stat(info))) return null
  const [header,...rows] = (await checkedSmallFile(info,256000)).toString('utf8').trim().split(/\r?\n/)
  const keys = header.split('|').map(s=>s.split('!')[0].toLowerCase())
  const records = rows.map(row=>Object.fromEntries(row.split('|').map((v,i)=>[keys[i],v])))
  return records.find(row=>/forever/i.test(row.product || '') && row.active !== '0')?.version || null
}
async function manifest(dir) {
  const st = await stat(dir)
  if (!st) return null
  await plainPath(dir)
  if (!st.isDirectory()) throw Error('Addon destination conflicts with an existing file.')
  const entries = await fs.readdir(dir)
  if (entries.length !== files.length+1 || ![...files,marker].every(f=>entries.includes(f)))
    throw Error('Unowned or extra files at the addon destination. Move them aside in Explorer before updating.')
  let stamp
  try { stamp = JSON.parse((await checkedSmallFile(path.join(dir,marker),8192)).toString()) } catch { throw Error('Invalid addon ownership manifest.') }
  if (stamp.owner !== 'GoblinLedger' || stamp.schema !== 1) throw Error('Unowned addon destination.')
  for (const f of files) {
    if (hash(await checkedSmallFile(path.join(dir,f),2*1024*1024)) !== stamp.hashes?.[f])
      throw Error('Installed addon files were modified. Move the modified copy aside before updating.')
  }
  return stamp
}
export async function inspect(input) {
  const candidate = await plainPath(input)
  const product = path.basename(candidate).toLowerCase() === '_forever_' ? candidate : path.join(candidate,'_forever_')
  await plainPath(product)
  if (!(await stat(product))?.isDirectory()) throw Error('Select the World of Warcraft parent or its _forever_ folder.')
  const build = await installedBuild(product)
  let hasClient = false
  for (const name of ['Wow.exe','WowForever.exe','WowClassic.exe']) {
    const exe = path.join(product,name); if ((await stat(exe))?.isFile()) {hasClient=true;break}
  }
  if (!hasClient && !build) throw Error('No Forever client executable or matching build record in this installation.')
  const addons = path.join(product,'Interface','AddOns'), destination = path.join(addons,currentName)
  await plainPath(destination)
  const accountsRoot = path.join(product,'WTF','Account')
  await plainPath(accountsRoot)
  const accounts = (await stat(accountsRoot))?.isDirectory() ? await folders(accountsRoot) : []
  let installed = false, conflict = null
  try { installed = Boolean(await manifest(destination)) } catch (e) { conflict=e.message }
  let writeable=true, ancestor=addons
  while (!(await stat(ancestor))) ancestor=path.dirname(ancestor)
  try { await fs.access(ancestor,constants.W_OK) } catch { writeable=false }
  return {product,destination,build,interface:16001,accounts,installed,conflict,writeable}
}
async function removeOwned(dir) {
  if (!(await manifest(dir))) return
  for (const f of [...files,marker]) { await plainPath(dir); await fs.unlink(path.join(dir,f)) }
  await fs.rmdir(dir)
}
async function safeRename(a,b) {
  await plainPath(a);await plainPath(b)
  if (await stat(b)) throw Error('An addon swap destination is occupied.')
  await fs.rename(a,b)
}
const journalName = '.GoblinLedger-install.json'
async function recover(addons) {
  const journal = path.join(addons,journalName)
  if (!(await stat(journal))) return
  const j=JSON.parse((await checkedSmallFile(journal,1024)).toString())
  if (j.version !== 1 || j.owner !== currentName) throw Error('An unknown installer journal needs manual inspection.')
  const dest=path.join(addons,currentName), prev=path.join(addons,priorName), stage=path.join(addons,stageName)
  const installed=await manifest(dest), prior=await manifest(prev), staged=await manifest(stage)
  if (!installed && prior) await safeRename(prev,dest)
  else if (!installed && staged) await safeRename(stage,dest)
  if (await stat(stage)) await removeOwned(stage)
  await plainPath(journal);await fs.unlink(journal)
}
export async function recoverPendingInstall(input) {
  const {product,destination}=await inspect(input)
  const addons=path.dirname(destination),key=product.toLowerCase()
  if (swaps.has(key) || !(await stat(path.join(addons,journalName)))) return false
  swaps.add(key)
  try {await recover(addons);return true} finally {swaps.delete(key)}
}
export async function install(input) {
  const first=await inspect(input), key=first.product.toLowerCase()
  if (swaps.has(key)) throw Error('Another install is running.')
  swaps.add(key)
  try {
    const {destination,product,conflict,writeable} = await inspect(first.product)
    if (conflict) throw Error(conflict)
    if (!writeable) throw Error('The current Windows user needs write access to the addon folder.')
    const addons=path.dirname(destination)
    await plainPath(addons);await fs.mkdir(addons,{recursive:true})
    await recover(addons)
    const installed=await manifest(destination), stamp={owner:currentName,schema:1,hashes:{}}
    const bytes={}
    for (const f of files) { bytes[f]=await fs.readFile(path.join(bundle,f));stamp.hashes[f]=hash(bytes[f]) }
    if (installed && files.every(f=>installed.hashes[f]===stamp.hashes[f])) return {action:'unchanged',...(await inspect(product))}
    const prev=path.join(addons,priorName), stage=path.join(addons,stageName), journal=path.join(addons,journalName)
    if (await stat(stage)) throw Error('A staging folder already exists. Inspect the addon folder before updating.')
    if (await stat(prev)) await removeOwned(prev)
    await plainPath(stage);await fs.mkdir(stage)
    // A failed write only cleans up known files in the stage this invocation created.
    try {
      for (const f of files) { await plainPath(stage);await fs.writeFile(path.join(stage,f),bytes[f],{flag:'wx'}) }
      await fs.writeFile(path.join(stage,marker),JSON.stringify(stamp),{flag:'wx'})
      await manifest(stage)
      await plainPath(journal);await fs.writeFile(journal,JSON.stringify({owner:currentName,version:1}),{flag:'wx'})
    } catch (error) {
      for (const f of [...files,marker]) {
        const p=path.join(stage,f);await plainPath(p)
        if ((await stat(p))?.isFile()) await fs.unlink(p)
      }
      await fs.rmdir(stage); throw error
    }
    try {
      if (installed) await safeRename(destination,prev)
      await safeRename(stage,destination)
      await plainPath(journal);await fs.unlink(journal)
    } catch (e) { await recover(addons);throw e }
    return {action:installed?'updated':'installed',...(await inspect(product))}
  } finally {swaps.delete(key)}
}
export async function exportFile(product,account) {
  const target=await inspect(product)
  if (!target.accounts.includes(account) || !account || /[\\/]/.test(account)) throw Error('Select an account listed for this installation.')
  return plainPath(path.join(target.product,'WTF','Account',account,'SavedVariables','GoblinLedger.lua'))
}
