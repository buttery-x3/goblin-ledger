import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, profileKey } from './client-api.js';

test('requests carry the tab’s active profile; writes carry the bootstrap token and cookie', async () => {
  const requests = [];
  const api = createClient(
    () => ({ profile: profileKey({ mode: 'live', region: null }), token: 'fixture-token' }),
    () => {},
    async (path, options) => {
      requests.push({ path, ...options });
      return Response.json({ ok: true });
    },
  );
  await api('/bootstrap');
  await api('/personal/characters');
  await api('/workspace', { method: 'PUT', body: { workspace: { version: 1 } } });
  assert.equal(requests[0].headers.has('X-Goblin-Profile'), false);
  assert.equal(requests[1].headers.get('X-Goblin-Profile'), 'live:-');
  assert.equal(requests[2].credentials, 'same-origin');
  assert.equal(requests[2].headers.get('X-Goblin-Token'), 'fixture-token');
  assert.equal(requests[2].body, '{"workspace":{"version":1}}');
});

test('a stale save reports the profile conflict and never replays the old data under the new profile', async () => {
  const session = { profile: 'demo:us', token: 'old' };
  let sent = 0,
    changed = 0;
  const api = createClient(
    () => session,
    () => {
      changed++;
      session.profile = 'live:eu';
    },
    async () => {
      sent++;
      return Response.json({ code: 'PROFILE_CHANGED' }, { status: 409 });
    },
  );
  await assert.rejects(
    api('/workspace', { method: 'PUT', body: { workspace: { version: 1 } } }),
    /another tab/,
  );
  assert.equal(changed, 1);
  assert.equal(sent, 1);
});

test('application-level conflicts preserve the active profile', async () => {
  const api = createClient(
    () => ({ profile: 'demo:us', token: 'old' }),
    () => assert.fail('profile conflict erroneously issued'),
    async () => Response.json({ error: 'The route was edited.' }, { status: 409 }),
  );
  await assert.rejects(api('/farms/example', { method: 'PUT', body: {} }), /route was edited/);
});
