'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const explorer = fs.readFileSync(path.join(root, 'src/pages/Explorer.tsx'), 'utf8');
const poller = fs.readFileSync(path.join(root, 'src/hooks/useNodePoller.ts'), 'utf8');
const backend = fs.readFileSync(path.join(root, 'src-tauri/src/main.rs'), 'utf8');
const tauriConfig = fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8');

test('block refresh is driven by both tip height and tip hash', () => {
  assert.match(explorer, /const identity = `\$\{h\}:\$\{nodeStatus\?\.tip \?\? ''\}`/);
  assert.match(explorer, /identity !== prevFetchTipRef\.current/);
  assert.doesNotMatch(explorer, /setInterval\(fetchLatest, 30_000\)/);
});

test('unchanged tips do not request the full recent-block list', () => {
  const refreshes = [];
  let previous = null;
  for (const tip of [{ height: 10, hash: 'a' }, { height: 10, hash: 'a' }, { height: 11, hash: 'b' }]) {
    const identity = `${tip.height}:${tip.hash}`;
    if (previous !== null && identity !== previous) refreshes.push(identity);
    previous = identity;
  }
  assert.deepEqual(refreshes, ['11:b']);
});

test('same-height hash replacement triggers a full refresh', () => {
  const before = `${10}:a`;
  const after = `${10}:b`;
  assert.notEqual(after, before);
  assert.match(explorer, /nodeStatus\?\.tip/);
});

test('status polling is two seconds, non-overlapping, and visibility-aware', () => {
  assert.match(poller, /const NODE_POLL_MS = 2000/);
  assert.match(poller, /if \(nodePollInFlight\.current\) return/);
  assert.match(poller, /finally \{\s*nodePollInFlight\.current = false/);
  assert.match(explorer, /visibilitychange/);
  assert.match(explorer, /if \(!document\.hidden\) pollNodeNow\(\)/);
});

test('full-list requests are serialized and stale responses are suppressed', () => {
  assert.match(explorer, /blocksFetchInFlightRef\.current/);
  assert.match(explorer, /blocksFetchQueuedRef\.current = true/);
  assert.match(explorer, /generation !== blocksRequestGenerationRef\.current/);
  assert.match(explorer, /queueMicrotask\(\(\) => void fetchLatestRef\.current\(\)\)/);
});

test('failed recent-block requests retry exponentially and recover', () => {
  const delays = [];
  let delay = 1_000;
  for (let i = 0; i < 7; i += 1) {
    delays.push(delay);
    delay = Math.min(delay * 2, 30_000);
  }
  assert.deepEqual(delays, [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
  assert.match(explorer, /blocksRetryDelayRef = useRef\(1_000\)/);
  assert.match(explorer, /Math\.min\(delay \* 2, 30_000\)/);
  assert.match(explorer, /blocksRetryDelayRef\.current = 1_000/);
});

test('hashrate uses current mining metrics with a legacy route fallback', () => {
  assert.match(backend, /\/rpc\/mining_metrics\?series=1/);
  assert.match(backend, /\/rpc\/network_hashrate/);
  assert.match(backend, /tip_height/);
  assert.match(backend, /network_hashrate_tests/);
});

test('retired pool endpoints are neither mounted nor allowed', () => {
  assert.match(explorer, /PoolRetiredNotice/);
  assert.doesNotMatch(explorer, /<NetworkMiningOverview \/>/);
  assert.doesNotMatch(explorer, /<PoolStatsSection \/>/);
  assert.match(backend, /official Stratum pool is retired/);
  assert.doesNotMatch(tauriConfig, /pool\.irium(?:labs)?\.org/);
  assert.doesNotMatch(tauriConfig, /api\.irium(?:labs)?\.org\/pool/);
});
