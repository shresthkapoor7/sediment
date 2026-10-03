import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const effects = [];
const storage = new Map();
const pending = [];
const testModule = { exports: {} };
const code = ts.transpileModule(readFileSync(new URL('../src/lib/feed-bookmarks.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
runInNewContext(code, {
  exports: testModule.exports, module: testModule, process: { env: {} }, Event, AbortSignal,
  window: { dispatchEvent() {} },
  localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
  fetch: () => new Promise(resolve => pending.push(resolve)),
  require: name => name === 'react' ? {
    useMemo: fn => fn(), useSyncExternalStore: (_, snapshot) => snapshot(), useEffect: fn => effects.push(fn),
  } : { feedPaperPath: paper => '/' + paper.id.replace(':', '-') },
});
// React hooks are stubbed above; this exercises the persistence functions.
const readBookmarks = testModule.exports.useFeedBookmarks;
const paper = id => ({ id, title: 'Saved research', abstract: 'Full abstract', authors: [], topics: [], sources: ['openalex'], url: 'https://example.org', published: null });
const key = 'sediment_feed_saved';
const first = paper('openalex:W1');
const second = paper('openalex:W2');
readBookmarks().toggle(first);
// A fresh hook with no active-feed data still has complete paper metadata.
assert.equal(readBookmarks().papers[0].abstract, 'Full abstract');
const staleTab = readBookmarks();
readBookmarks().toggle(second);
staleTab.toggle(first);
assert.equal(readBookmarks().saved.join(','), second.id, 'stale UI must not overwrite a newer save');
storage.set(key, JSON.stringify(['openalex:W3', 'openalex:W4', 'openalex:W5']));
readBookmarks();
effects.splice(0).forEach(fn => fn());
assert.equal(pending.length, 3);
readBookmarks().toggle(paper('openalex:W4')); // Unsave while restoration is pending.
pending.shift()({ ok: true, json: async () => paper('openalex:W3') });
pending.shift()({ ok: true, json: async () => paper('openalex:W4') });
pending.shift()({ ok: false });
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(readBookmarks().papers[0].id, 'openalex:W3');
assert.equal(readBookmarks().saved.includes('openalex:W4'), false, 'must not resurrect removed saves');
assert.equal(readBookmarks().unresolved[0], 'openalex:W5', 'failed lookup must preserve original save');
readBookmarks().retryRestore();
pending.shift()({ ok: true, json: async () => paper('openalex:W5') });
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(readBookmarks().papers.length, 2);
assert.equal(readBookmarks().unresolved.length, 0);
console.log('Bookmark persistence, stale updates, legacy recovery, removal races, and retry passed.');
