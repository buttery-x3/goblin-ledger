import { createJobs, jobError } from './operations/runner.mjs'
import {
  backupProfile,
  listBackups,
  checkBackup,
} from './operations/backup.mjs'

export { createJobs, backupProfile }
const prefix = '/api/v1'

export function registerOperations(app, ctx) {
  const jobs = ctx.jobs
  const sockets = new Set()
  jobs.register(
    'demo.diagnostic',
    async ({ profile, log, runId }) => {
      if (profile.mode !== 'demo')
        throw jobError('Open the Demo profile to run its diagnostic', 400)
      const attempt = profile.db
        .prepare('SELECT retry_of FROM ops_runs WHERE id=?')
        .get(runId)
      if (!attempt.retry_of) {
        log('Simulating an unavailable source', 'warn', {
          stage: 'Checking fixture',
        })
        throw Error(
          'Demo source unavailable. Retry this attempt to simulate recovery.',
        )
      }
      log('Fixture source recovered', 'info', {
        stage: 'Reconnected',
        processed: 1,
        total: 1,
      })
      return { recovered: true }
    },
    {
      manual: true,
      retry: true,
      description: 'Demo connection diagnostic',
      source: 'fixture',
      modes: ['demo'],
    },
  )
  jobs.register(
    'maintenance.backup',
    async ({ profile, log }) => {
      log('Copying a consistent SQLite snapshot', 'info', {
        stage: 'Backing up',
      })
      const item = await backupProfile(profile)
      log('Backup validated (' + item.bytes + ' bytes)')
      return item
    },
    {
      manual: true,
      retry: true,
      description: 'Back up this profile',
      source: 'sqlite',
    },
  )
  jobs.register(
    'maintenance.verify-backup',
    async ({ profile, log, payload }) => {
      const id = payload?.id ?? (await listBackups(profile))[0]
      if (!id)
        throw jobError('Create a backup before running its restore check', 400)
      log('Restoring into an isolated temporary profile', 'info', {
        stage: 'Restoring',
      })
      const result = await checkBackup(profile, id, {
        migrate: ctx.migrate,
        expire: ctx.expire,
      })
      log('Restored copy passed the integrity check')
      return result
    },
    {
      manual: true,
      retry: true,
      description: 'Verify latest backup',
      source: 'sqlite',
    },
  )
  app.get(prefix + '/jobs', () => ({ jobs: jobs.list(ctx.profile()) }))
  app.get(prefix + '/job-runs', (req) => ({
    runs: jobs.history(ctx.profile(), req.query),
  }))
  app.get(prefix + '/job-logs', (req) => ({
    logs: jobs.logs(ctx.profile(), req.query),
  }))
  app.get(prefix + '/backups', async () => ({
    backups: await listBackups(ctx.profile()),
  }))
  app.post(prefix + '/jobs/:name/:action', async (req) =>
    jobs.control(
      ctx.profile(),
      req.params.name,
      req.params.action,
      req.body?.runId,
    ),
  )
  app.get(prefix + '/events', (req, reply) => {
    // The workspace owns one connection and reopens it on a profile switch.
    const profile = ctx.profile()
    reply.hijack()
    const res = reply.raw
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write('retry: 3000\n\n')
    sockets.add(res)
    const unsubscribe = jobs.subscribe(
      profile,
      req.headers['last-event-id'] ?? req.query.cursor,
      (event) => {
        if (res.destroyed || res.writableEnded) return
        if (res.writableLength > 256 * 1024) {
          res.destroy()
          return
        }
        res.write(
          'id: ' + event.cursor + '\ndata: ' + JSON.stringify(event) + '\n\n',
        )
      },
    )
    const ping = setInterval(() => {
      if (!res.destroyed && !res.writableEnded) res.write(': heartbeat\n\n')
    }, 20_000)
    ping.unref()
    res.once('close', () => {
      clearInterval(ping)
      unsubscribe()
      sockets.delete(res)
    })
  })
  app.addHook('preClose', async () => {
    for (const res of sockets) res.end()
  })
}
