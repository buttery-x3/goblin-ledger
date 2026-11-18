import assert from 'node:assert/strict'
import { spawn, fork } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { once } from 'node:events'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = process.cwd()
const args = process.argv.slice(2)
if (args.length && (args.length !== 1 || args[0] !== '--injection-smoke')) throw Error('Use node scripts/package-release.mjs [--injection-smoke].')
const injectionOnly = args.length === 1
const archiveName = injectionOnly ? 'GoblinLedger-windows-injection-checked.zip' : 'GoblinLedger-windows.zip'
const appName = 'GoblinLedger'

async function run(exe, args, cwd, env = process.env, timeout = 0) {
  const child = spawn(exe, args, { cwd, env, stdio: ['ignore','inherit','inherit'], windowsHide: true, timeout })
  const [code] = await once(child, 'exit')
  if (code !== 0) throw Error(basename(exe) + ' exited with code ' + code)
}

function inside(rootDir, target) {
  const subpath = relative(rootDir, target)
  return !!subpath && !isAbsolute(subpath) && subpath !== '..' && !subpath.startsWith('..' + sep)
}

async function copyFiles(stage, folder, accept) {
  const src = join(root, folder)
  await cp(src, join(stage, folder), {
    recursive: true,
    filter: async file => {
      const entry = await lstat(file)
      if (entry.isSymbolicLink()) throw Error('Unexpected link in release input: ' + relative(root, file))
      return entry.isDirectory() || (entry.isFile() && accept(file))
    },
  })
}

async function stageProduct(stage) {
  await mkdir(stage)
  for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'Start-GoblinLedger.cmd', '.node-version']) {
    await cp(join(root, name), join(stage, name))
  }
  await copyFiles(stage, 'apps/local', f => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))
  await copyFiles(stage, 'packages/domain', f => /\.(?:mjs|ts)$/.test(f) && !f.endsWith('.test.mjs'))
  await copyFiles(stage, 'addon/GoblinLedger', f => /\.(?:lua|toc)$/i.test(f))
  const docs = join(stage,'docs'), dist = join(stage,'dist')
  await mkdir(docs)
  await mkdir(dist)
  for (const name of ['Goblin-Ledger-Agent-Plan-v2.md','Goblin-Ledger-Design-v2.md','implementation-status.md','market-verification.md']) {
    await cp(join(root,'docs',name),join(docs,name))
  }
  await cp(join(root,'dist/index.html'),join(dist,'index.html'))
  await copyFiles(stage, 'dist/assets', f => /-[A-Za-z0-9_-]{8,}\.(?:js|css|png|ico|svg|webp|woff2?)$/i.test(basename(f)))
  const readme = await readFile(join(root, 'README.md'), 'utf8')
  const start=readme.indexOf('## First session'), end=readme.indexOf('## Development');
  if(start<0 || end<=start) throw Error('Player guide sections are missing from README.md');
  const playerGuide=readme.slice(start,end).trimEnd();
  const quickStart = '# Goblin Ledger for Windows\n\nExtract the entire ZIP into a folder. Install the Node.js runtime listed in .node-version, then double-click Start-GoblinLedger.cmd and open the local URL it prints. The web build and runtime packages are included.\n\n'
  await writeFile(join(stage, 'README.md'), quickStart + playerGuide + '\n\n[Implementation and source verification](docs/implementation-status.md)\n')
  await run(process.env.ComSpec || 'cmd.exe', [
    '/d', '/c', 'pnpm.cmd install --prod --frozen-lockfile --config.node-linker=hoisted --config.package-import-method=copy',
  ], stage)
  // The hoisted install is relocatable. pnpm's private metadata and development
  // command shims can include absolute builder paths and are unnecessary at runtime.
  const modules = join(stage, 'node_modules')
  for (const entry of await readdir(modules)) {
    if (entry.startsWith('.')) await rm(join(modules, entry), { recursive: true, force: true })
  }
  for (const item of await readdir(modules, {recursive:true,withFileTypes:true})) {
    if (item.isSymbolicLink()) throw Error('A runtime dependency is linked outside the portable install: '+item.name)
  }
  const fastify = createRequire(join(stage, 'package.json')).resolve('fastify')
  assert(inside(modules, await realpath(fastify)), 'The release needs its own Fastify installation')
}

// Windows PowerShell and .NET ship with supported Windows versions. Use a fixed
// ZIP timestamp and ordinal entry order so file enumeration and build time do not alter it.
const zipScript = [
  "$ErrorActionPreference='Stop'",
  "Add-Type -AssemblyName System.IO.Compression",
  "Add-Type -AssemblyName System.IO.Compression.FileSystem",
  "$root=$env:GOBLIN_PACKAGE_SOURCE",
  "$files=[IO.Directory]::GetFiles($root,'*',[IO.SearchOption]::AllDirectories)",
  "[Array]::Sort($files,[StringComparer]::Ordinal)",
  "$out=[IO.File]::Open($env:GOBLIN_PACKAGE_ARCHIVE,[IO.FileMode]::CreateNew)",
  "try {",
  "  $zip=[IO.Compression.ZipArchive]::new($out,[IO.Compression.ZipArchiveMode]::Create,$true)",
  "  try { foreach($file in $files) {",
  "    $name='GoblinLedger/'+$file.Substring($root.Length+1).Replace('\\','/')",
  "    $entry=$zip.CreateEntry($name,[IO.Compression.CompressionLevel]::Optimal)",
  "    $entry.LastWriteTime=[DateTimeOffset]::new(2000,1,1,0,0,0,[TimeSpan]::Zero)",
  "    $source=[IO.File]::OpenRead($file)",
  "    try {$dest=$entry.Open(); try {$source.CopyTo($dest)} finally {$dest.Dispose()}} finally {$source.Dispose()}",
  "  }} finally {$zip.Dispose()}",
  "} finally {$out.Dispose()}",
].join('\n')

async function verifyRoutes(get) {
  const health = await (await get('/api/v1/health')).json()
  assert.equal(health.product, 'Goblin Ledger')
  assert.equal(health.status, 'ok')
  const bootstrap = await (await get('/api/v1/bootstrap')).json()
  assert.equal(bootstrap.mode, 'live')
  assert(bootstrap.routes.length > 0)
  assert.deepEqual((await (await get('/api/v1/personal/characters')).json()).characters, [])
  const html = await (await get('/')).text()
  const assets = Array.from(html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g), m => m[1])
  assert(assets.some(s => s.endsWith('.js')) && assets.some(s => s.endsWith('.css')), 'Missing built entry assets')
  for (const asset of assets) assert((await (await get(asset)).arrayBuffer()).byteLength > 0)
}

async function smoke(unpacked, profile) {
  const env = { ...process.env, GOBLIN_LEDGER_PORT: '0', GOBLIN_LEDGER_HOME: profile, GOBLIN_LEDGER_DISABLE_SCHEDULE: '1' }
  delete env.NODE_PATH
  delete env.NODE_OPTIONS
  const service = fork(join(unpacked, 'apps/local/start.mjs'), [], {
    cwd: unpacked, env, execArgv: [], stdio: ['ignore', 'inherit', 'inherit', 'ipc'], windowsHide: true,
  })
  const exited = once(service, 'exit')
  const timeout = AbortSignal.timeout(20000)
  try {
    const result = await Promise.race([once(service, 'message', { signal: timeout }), exited.then(([code]) => {throw Error('Packaged service exited before startup: '+code)})])
    const address = new URL(result[0].address)
    assert.equal(address.hostname, '127.0.0.1')
    const get = async path => {
      const reply = await fetch(new URL(path, address), {signal: timeout})
      assert.equal(reply.status, 200, path)
      return reply
    }
    if (injectionOnly) {
      const { createServer } = await import(pathToFileURL(join(unpacked, 'apps/local/server.mjs')))
      const server = await createServer({ root: profile+' injection', scheduling:false })
      try {
        await verifyRoutes(async path => {
          const res = await server.inject({method:'GET',url:path,headers:{host:'127.0.0.1'}})
          assert.equal(res.statusCode, 200, path)
          return new Response(res.rawPayload)
        })
      } finally { await server.close() }
      console.log('Packaged process bound successfully. Fastify injection verified routes and assets. Loopback HTTP and CMD reuse require the default release smoke.')
      return
    }
    await verifyRoutes(get)
    // Exercise the shipped CMD, including its healthy-instance reuse check.
    await run(env.ComSpec || 'cmd.exe', ['/d', '/c', 'Start-GoblinLedger.cmd'], unpacked, {...env,GOBLIN_LEDGER_PORT: address.port}, 10000)
    console.log('Packaged launch, HTTP assets, live cold start and launcher reuse passed.')
  } finally {
    if (service.connected) service.send('shutdown')
    if (service.exitCode === null) {
      const ended = await Promise.race([exited.then(()=>true), delay(3000, false, {ref:false})])
      if (!ended) { service.kill(); await exited }
    }
  }
}

if (process.platform !== 'win32') throw Error('Run the Windows release packager on Windows.')
await stat(join(root, 'dist/index.html'))
const tempRoot = await realpath(tmpdir())
const work = await mkdtemp(join(tempRoot, 'Goblin Ledger Release '))
try {
  const stage = join(work, appName), archive = join(work, archiveName), extract = join(work, 'Clean install with spaces')
  await stageProduct(stage)
  await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',zipScript],work,{
    ...process.env,GOBLIN_PACKAGE_SOURCE:stage,GOBLIN_PACKAGE_ARCHIVE:archive,
  })
  await mkdir(extract)
  await run('tar.exe',['-xf',archive,'-C',extract],work)
  await smoke(join(extract, appName), join(work, 'Fresh private profile'))
  const out = join(root, 'dist', archiveName)
  // Use same-volume replacement. A failed build or smoke leaves the prior verified ZIP intact.
  const candidate = join(root, 'dist', archiveName+'.'+process.pid+'.tmp')
  try {
    await cp(archive, candidate, {force:false,errorOnExist:true})
    await rename(candidate, out)
  } finally { await rm(candidate, {force:true}) }
  const sha = createHash('sha256')
  for await (const chunk of createReadStream(out)) sha.update(chunk)
  console.log('Release: '+out+'\nSHA-256: '+sha.digest('hex'))
} finally {
  if (dirname(await realpath(work)) !== tempRoot || !basename(work).startsWith('Goblin Ledger Release ')) throw Error('Unexpected release staging location.')
  await rm(work, {recursive:true,force:true,maxRetries:3,retryDelay:300})
}
