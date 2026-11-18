import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'

const db = new DatabaseSync(workerData, { readOnly: true })
try {
  const result = db.prepare('PRAGMA integrity_check').all()
  if (result.length !== 1 || result[0].integrity_check !== 'ok')
    throw Error('Backup integrity check failed')
  parentPort.postMessage(db.prepare('PRAGMA user_version').get().user_version)
} finally {
  db.close()
}
