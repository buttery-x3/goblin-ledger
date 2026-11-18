import { constants } from 'node:fs'
import {
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  stat,
} from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { expireRestoredMarket } from './retention.mjs'
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite'

const validName = /^ledger-\d{13}-[a-f0-9-]{36}\.sqlite$/

export async function backupProfile(profile) {
  const folder = join(profile.dir, 'backups')
  await mkdir(folder, { recursive: true })
  const id = 'ledger-' + Date.now() + '-' + randomUUID() + '.sqlite'
  const temp = join(folder, '.' + id + '.tmp'),
    target = join(folder, id)
  try {
    if (typeof profile.db.backup === 'function') await profile.db.backup(temp)
    else await sqliteBackup(profile.db, temp)
    await integrity(temp)
    await link(temp, target)
    return { id, bytes: (await stat(target)).size }
  } finally {
    await rm(temp, { force: true })
  }
}

export async function listBackups(profile) {
  const folder = join(profile.dir, 'backups')
  try {
    const entries = await readdir(folder, { withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && validName.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse()
  } catch (e) {
    if (e.code === 'ENOENT') return []
    throw e
  }
}

export function integrity(path) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./verify-worker.mjs', import.meta.url), {
      workerData: path,
    })
    let schema
    worker.once('message', (value) => {
      schema = value
    })
    worker.once('error', reject)
    worker.once('exit', (code) => {
      if (code === 0 && schema !== undefined) resolve(schema)
      else reject(Error('Backup verification worker failed'))
    })
  })
}

export async function restoreBackup(
  source,
  destination,
  { migrate, expire } = {},
) {
  if (resolve(source) === resolve(destination))
    throw Error('Choose a new restore destination')
  const targetDir = dirname(destination)
  await mkdir(targetDir, { recursive: true })
  const staging = await mkdtemp(join(targetDir, '.restore-'))
  const path = join(staging, 'candidate.sqlite')
  try {
    // Only completed, self-contained online backups are expected as input.
    await copyFile(source, path, constants.COPYFILE_EXCL)
    await integrity(path)
    const db = new DatabaseSync(path)
    try {
      if (migrate) await migrate(db)
      expireRestoredMarket(db)
      if (expire) await expire(db)
      // Fold any migrated WAL pages into the file that is about to be linked.
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } finally {
      db.close()
    }
    const schema = await integrity(path)
    // link is exclusive: never replace an existing player's profile.
    await link(path, destination)
    return { schema, bytes: (await stat(destination)).size }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

export async function checkBackup(profile, id, hooks) {
  if (!validName.test(id) || basename(id) !== id) throw Error('Unknown backup')
  const folder = await realpath(join(profile.dir, 'backups'))
  const source = await realpath(join(folder, id))
  if (dirname(source) !== folder) throw Error('Invalid backup')
  const temp = await mkdtemp(join(tmpdir(), 'ledger-restore-check-'))
  try {
    return await restoreBackup(source, join(temp, 'ledger.sqlite'), hooks)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}
