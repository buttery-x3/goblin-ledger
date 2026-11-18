import { QueryClient, useQuery } from '@tanstack/react-query'
import { marketReadKey } from './history-data.mjs'

// One workspace session shares in-flight and current queries across its panes.
// Optional provider cross-checks have their own expiry and never enter this client.
const clients = new WeakMap()
function clientFor(api) {
  if (!clients.has(api)) {
    clients.set(
      api,
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            gcTime: 0,
            staleTime: 15000,
            refetchOnWindowFocus: false,
          },
        },
      }),
    )
  }
  return clients.get(api)
}

export function useMarketRead(api, path, mode, region, revision) {
  const query = useQuery(
    {
      queryKey: marketReadKey(path, mode, region, revision),
      enabled: !!path,
      queryFn: ({ signal }) => api(path, { signal, cache: 'no-store' }),
    },
    clientFor(api),
  )
  return {
    data: query.data,
    error: query.error?.message,
    loading: query.isLoading,
  }
}

export function refreshMarketReads(api, mode, region) {
  return clientFor(api).invalidateQueries({
    queryKey: ['market-archive', mode, region ?? null],
  })
}
