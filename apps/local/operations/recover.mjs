import { join, resolve } from 'node:path'
import { mkdir, readdir } from 'node:fs/promises'
import { restoreBackup } from './backup.mjs'
import { migrate } from '../storage.mjs'

const [source, target] = process.argv.slice(2)
if (!source || !target || process.argv.length !== 4) {
  console.error(
    'Usage: node apps/local/operations/recover.mjs <completed-backup.sqlite> <new-empty-profile-folder>',
  )
  process.exitCode = 2
} else {
  try {
    const dest = resolve(target)
    await mkdir(dest, { recursive: true })
    if ((await readdir(dest)).length !== 0)
      throw Error('Choose an empty directory for the restored profile')
    const result = await restoreBackup(
      resolve(source),
      join(dest, 'ledger.sqlite'),
      { migrate },
    )
    console.log(
      'Restored and validated profile. Database schema ' + result.schema + '.',
    )
  } catch (err) {
    console.error('Recovery failed:', err.message)
    process.exitCode = 1
  }
}
