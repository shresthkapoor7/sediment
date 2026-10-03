import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('../src/lib/feeds-api.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function setup(responses, blockedStorage = false) {
  const calls = [];
  const storage = new Map([['sediment_feed_session', 'expired']]);
  const testModule = { exports: {} };
  class APIError extends Error { constructor(message, status) { super(message); this.status = status; } }
  runInNewContext(code, {
    exports: testModule.exports, module: testModule, process: { env: {} },
    localStorage: {
      getItem: key => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => { if (blockedStorage) throw new Error('blocked'); storage.delete(key); },
    },
    fetch: async (url, options) => {
      calls.push({ url, ...options });
      const response = responses.shift();
      assert.ok(response, 'Unexpected extra request');
      return { ok: response.status === 200, status: response.status, json: async () => response.body };
    },
    require: () => ({ APIError }),
  });
  return { fetchFeed: testModule.exports.fetchFeed, calls, storage };
}
for (const blocked of [false, true]) {
  const { fetchFeed, calls, storage } = setup([
    { status: 401, body: { detail: 'Expired session' } },
    { status: 200, body: { token: 'fresh' } },
    { status: 200, body: { papers: [] } },
  ], blocked);
  await assert.rejects(fetchFeed({ action: 'refresh' }), error => error.status === 401);
  assert.equal(calls.length, 1, 'Rejected POST must never be replayed');
  assert.equal(calls[0].method, 'POST');
  if (!blocked) assert.equal(storage.has('sediment_feed_session'), false);
  await fetchFeed();
  assert.equal(calls[1].url.endsWith('/api/feed-session'), true);
  assert.equal(calls[2].headers.Authorization, 'Bearer fresh', 'Memory credential must be cleared too');
}
const retry = setup([
  { status: 401, body: {} },
  { status: 200, body: { token: 'fresh' } },
  { status: 200, body: { papers: [] } },
]);
await retry.fetchFeed();
assert.equal(retry.calls.length, 3);
assert.equal(retry.calls[0].method, 'GET');
assert.equal(retry.calls[2].method, 'GET');
const forbidden = setup([{ status: 403, body: { detail: 'Forbidden' } }]);
await assert.rejects(forbidden.fetchFeed(), error => error.status === 403);
assert.equal(forbidden.calls.length, 1);
assert.equal(forbidden.storage.get('sediment_feed_session'), 'expired');
console.log('POST 401 cleanup without replay, GET recovery, blocked storage, and non-401 behavior passed.');
