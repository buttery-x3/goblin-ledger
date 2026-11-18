import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { insertSnapshot, transaction } from './market-store.mjs'
const db = new DatabaseSync(workerData.file)
try {
  db.exec('PRAGMA busy_timeout=5000')
  parentPort.postMessage(
    transaction(db, () => insertSnapshot(db, workerData.snapshot)),
  )
} finally {
  db.close()
}
