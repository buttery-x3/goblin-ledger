export function profileKey({ mode, region }) {
  return mode + ':' + (region || '-');
}

export function createClient(session, onProfileChanged, request = globalThis.fetch) {
  return async function api(path, options = {}) {
    const headers = new Headers(options.headers);
    const before = session();
    headers.set('Accept', 'application/json');
    if (path !== '/bootstrap' && before.profile) headers.set('X-Goblin-Profile', before.profile);
    const outgoing = { ...options, headers, credentials: 'same-origin' };
    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      outgoing.body = JSON.stringify(options.body);
    }
    if (options.method && options.method !== 'GET') headers.set('X-Goblin-Token', before.token);
    const response = await request('/api/v1' + path, outgoing);
    const json = response.status === 204 ? null : await response.json().catch(() => null);
    if (response.status === 409 && json?.code === 'PROFILE_CHANGED') {
      if (session().profile === before.profile) onProfileChanged();
      throw new Error('The active profile changed in another tab.');
    }
    if (!response.ok)
      throw new Error(
        typeof json?.error === 'string'
          ? json.error
          : json?.message || 'Service returned HTTP ' + response.status,
      );
    return json;
  };
}
