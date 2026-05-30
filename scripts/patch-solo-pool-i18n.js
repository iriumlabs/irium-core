/* Patches all locale files (except en) with the explorer.solo_pool block,
 * using English text as a placeholder. Actual localization can be done
 * later — i18next will render the placeholder copy in all 14 languages
 * meanwhile, which beats logging "missing key" warnings for every key on
 * every render. Idempotent: skips locales that already have the block.
 */
const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', 'src', 'i18n', 'locales');

const SOLO_POOL_EN = {
  title: 'Solo Pool',
  subtitle: 'Coinbase pays the full block reward directly to the block finder. Zero fees.',
  connect_here: 'Connect with your own Irium address as the worker name',
  fee_label: 'Pool fee {{fee}}%',
  connect_help: 'Paste this URL into your ASIC firmware. Use your Irium address as the worker username (Q-prefix) and any password.',
  active_miners: 'Active Solo Miners',
  blocks_found: 'Solo Blocks Found',
  hashrate: 'Solo Hashrate',
  pool_fee: 'Pool Fee',
  port_sub: 'port {{port}}',
  fee_sub: 'of 50 IRM reward',
  solo_miners: 'Solo Miners',
  worker_singular: 'worker',
  worker_plural: 'workers',
  no_miners: 'No solo miners connected yet — be the first.',
  load_error: 'Could not load solo pool stats — proxy may be unreachable',
  col_worker: 'Worker',
  col_accepted: 'Accepted',
  col_rejected: 'Rejected',
  col_reject_pct: 'Reject %',
  col_hashrate: '15m H/s',
  col_last_share: 'Last share',
};

const TARGETS = ['ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'pt', 'ru', 'tr', 'vi', 'zh'];

let patched = 0;
for (const code of TARGETS) {
  const file = path.join(LOCALES_DIR, `${code}.json`);
  if (!fs.existsSync(file)) {
    console.warn(`skip: ${file} missing`);
    continue;
  }
  const raw = fs.readFileSync(file, 'utf-8');
  const json = JSON.parse(raw);
  json.explorer = json.explorer || {};
  if (json.explorer.solo_pool === undefined) {
    json.explorer.solo_pool = { ...SOLO_POOL_EN };
  }
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  patched++;
}
console.log(`patched ${patched} locale files`);
