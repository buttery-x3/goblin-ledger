// Independent player-scan checks live only in the HTTP response, never in SQLite or backups.
export function registerCrosscheck(app, ctx, request) {
  let nextAt = 0
  ctx.jobs.register(
    'market.crosscheck',
    async ({ profile, payload, signal, log }) => {
      const id = Number(payload?.id)
      if (!Number.isSafeInteger(id) || id < 1)
        throw Object.assign(Error('Enter a positive item ID.'), {
          statusCode: 400,
        })
      if (profile.mode !== 'live' || !['us', 'eu'].includes(profile.region))
        throw Object.assign(
          Error('Select a live house before checking an item.'),
          { statusCode: 409 },
        )
      if (nextAt > Date.now())
        throw Object.assign(
          Error(
            'Independent source is cooling down until ' +
              new Date(nextAt).toISOString(),
          ),
          { statusCode: 429 },
        )
      const market = 'forever.pvp.alliance.' + profile.region
      log('Checking an independent scan for one item')
      nextAt = Date.now() + 2000
      let expires = Date.now()
      try {
        const raw = await request(
          '/v1/prices/' + market + '/' + id + '?range=24h',
          signal,
          {
            host: 'api.ahledger.com',
            maxBytes: 512 * 1024,
            headers(h) {
              const cc = h.get('cache-control') ?? ''
              const seconds = cc.match(/(?:^|,)\s*max-age\s*=\s*(\d+)/i)?.[1]
              const age = Number(h.get('age') ?? 0)
              if (
                seconds !== undefined &&
                !/no-(?:store|cache)/i.test(cc) &&
                Number.isFinite(age)
              )
                expires =
                  Date.now() +
                  Math.min(24 * 3600, Math.max(0, Number(seconds) - age)) * 1000
            },
          },
        )
        if (raw?.market !== market || raw.item?.id !== id)
          throw Error('Independent source returned a different item or house.')
        const latest = raw.latest
        const observedAt = latest ? Date.parse(latest.observedAt) : null
        if (
          latest &&
          (!Number.isFinite(observedAt) ||
            !['minBuyout', 'quantity', 'auctions'].every(
              (k) =>
                latest[k] == null ||
                (Number.isSafeInteger(latest[k]) && latest[k] >= 0),
            ))
        )
          throw Error('Independent source returned an invalid scan.')
        if (latest === undefined)
          throw Error('Independent source returned no scan field.')
        return {
          id,
          market,
          source: 'AHledger',
          url:
            'https://ahledger.com/markets/forever/pvp/alliance/' +
            profile.region,
          name: typeof raw.item.name === 'string' ? raw.item.name : null,
          observedAt,
          method:
            typeof latest?.source === 'string' ? latest.source : 'Player scan',
          ask: latest?.minBuyout ?? null,
          listed: latest?.quantity ?? null,
          auctions: latest?.auctions ?? null,
          expires,
        }
      } catch (error) {
        if (error.retryAfter)
          nextAt = Math.max(nextAt, Date.now() + error.retryAfter)
        throw error
      }
    },
    {
      description: 'Independent item-price cross-check',
      source: 'AHledger',
      modes: ['live'],
    },
  )
  app.post('/api/v1/markets/:id/crosscheck', async (req, reply) => {
    reply?.header('Cache-Control', 'no-store')
    return ctx.jobs.run(
      'market.crosscheck',
      { ...ctx.profile() },
      { id: req.params.id },
    )
  })
}
