import {
  wallet, offers, agreements, reputation, node, rpc, feeds, feedOps,
  proofs, policies, reputationActions, tradeStatus, disputes, invoices,
  multisig, settlement, agreementSpend, agreementStore, miner, gpuMiner,
  stratum, diagnostics, update, nodeUpdate, metrics, explorer,
  soloStratum, walletCli, rpcCall,
} from './tauri';
import type {
  CreateAgreementParams, CreateOfferParams,
  OtcParams, FreelanceParams, MilestoneParams, DepositParams,
  MerchantDelayedParams, ContractorMilestoneParams, ReputationOutcome,
} from './types';

export type CommandResult =
  | { kind: 'ok'; data: unknown }
  | { kind: 'err'; message: string }
  | { kind: 'text'; text: string };

type Handler = {
  usage: string;
  description: string;
  category: string;
  minArgs: number;
  maxArgs: number;
  run: (args: string[]) => Promise<unknown>;
};

const WALLET_PREFIXES = ['wallet', 'irium-wallet'] as const;
const RPC_PREFIXES = ['rpc', 'iriumd', 'node'] as const;
const MINER_PREFIXES = ['miner', 'irium-miner'] as const;

// Tokenizer that honours double-quoted strings so callers can pass values
// containing whitespace, e.g. wallet offer-create --price-note "1 IRM = $0.10".
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const len = input.length;
  while (i < len) {
    while (i < len && /\s/.test(input[i])) i++;
    if (i >= len) break;
    if (input[i] === '"') {
      i++;
      let token = '';
      while (i < len && input[i] !== '"') {
        token += input[i++];
      }
      if (i < len) i++;
      tokens.push(token);
    } else {
      let token = '';
      while (i < len && !/\s/.test(input[i])) {
        token += input[i++];
      }
      tokens.push(token);
    }
  }
  return tokens;
}

const irmToSats = (amount: string): number => {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`invalid IRM amount: ${amount}`);
  }
  return Math.round(parsed * 1e8);
};

const intArg = (raw: string, name: string): number => {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new Error(`invalid ${name}: ${raw}`);
  return n;
};

const optionalInt = (raw: string | undefined, name: string): number | undefined => {
  if (raw === undefined || raw === '-' || raw === '') return undefined;
  return intArg(raw, name);
};

const optionalStr = (raw: string | undefined): string | undefined => {
  if (raw === undefined || raw === '-' || raw === '') return undefined;
  return raw;
};

const optionalBool = (raw: string | undefined, name: string): boolean | undefined => {
  if (raw === undefined || raw === '-' || raw === '') return undefined;
  const v = raw.toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes' || v === 'y') return true;
  if (v === 'false' || v === '0' || v === 'no' || v === 'n') return false;
  throw new Error(`invalid ${name}: ${raw} (expected true/false)`);
};

const parseCoinSelect = (raw: string | undefined): 'smallest' | 'largest' | undefined => {
  if (raw === undefined || raw === '-' || raw === '') return undefined;
  if (raw === 'smallest' || raw === 'largest') return raw;
  throw new Error(`invalid coin-select: ${raw} (expected smallest|largest)`);
};

const parseOutcome = (raw: string): ReputationOutcome => {
  if (raw === 'satisfied' || raw === 'failed' || raw === 'disputed' || raw === 'timeout') {
    return raw;
  }
  throw new Error(`invalid outcome: ${raw} (expected satisfied|failed|disputed|timeout)`);
};

const parseSource = (raw: string | undefined): 'local' | 'remote' | 'all' | undefined => {
  if (raw === undefined || raw === '-' || raw === '') return undefined;
  if (raw === 'local' || raw === 'remote' || raw === 'all') return raw;
  throw new Error(`invalid source: ${raw} (expected local|remote|all)`);
};

const parseSort = (raw: string | undefined): 'newest' | 'amount' | 'score' | undefined => {
  if (raw === undefined || raw === '-' || raw === '') return undefined;
  if (raw === 'newest' || raw === 'amount' || raw === 'score') return raw;
  throw new Error(`invalid sort: ${raw} (expected newest|amount|score)`);
};

// ── Generic CLI passthrough helpers ───────────────────────────
// A "passthrough" entry forwards the user's raw positional args to the
// underlying irium-wallet subcommand. Lets us expose every documented
// wallet-CLI subcommand without having to define a hard-coded TypeScript
// shape per command. The user types: `wallet agreement-dispute-raise
// --agreement file --raising-party seller …` exactly as documented in
// docs/WALLET-CLI.md.
const cliPassthrough = (subcommand: string, includeRpc: boolean) =>
  (args: string[]) => walletCli.runCmd(subcommand, args, includeRpc);

const rpcGetPassthrough = (path: string) =>
  (args: string[]) => {
    // Args are KEY=VALUE pairs e.g. `address=Q… limit=10`. Anything not
    // matching key=value is dropped silently — most GET endpoints take
    // named query params so positionals would not have a stable mapping.
    const q: Record<string, string> = {};
    for (const a of args) {
      const idx = a.indexOf('=');
      if (idx <= 0) continue;
      q[a.slice(0, idx)] = a.slice(idx + 1);
    }
    return rpcCall.get(path, q);
  };

const REGISTRY: Record<string, Handler> = {
  // ── WALLET — keys & balances (typed) ──────────────────────
  'wallet balance': {
    usage: 'wallet balance', description: 'Show confirmed and pending wallet balance.',
    category: 'Wallet — Keys & Balances', minArgs: 0, maxArgs: 0,
    run: () => wallet.balance(),
  },
  'wallet new-address': {
    usage: 'wallet new-address', description: 'Derive and store a new address.',
    category: 'Wallet — Keys & Balances', minArgs: 0, maxArgs: 0,
    run: () => wallet.newAddress(),
  },
  'wallet list-addresses': {
    usage: 'wallet list-addresses', description: 'List every address derived from the active wallet.',
    category: 'Wallet — Keys & Balances', minArgs: 0, maxArgs: 0,
    run: () => wallet.listAddresses(),
  },
  'wallet create': {
    usage: 'wallet create', description: 'Create a brand-new wallet (BIP39 mnemonic).',
    category: 'Wallet — Keys & Balances', minArgs: 0, maxArgs: 0,
    run: () => wallet.create(),
  },
  'wallet create-wallet': {
    usage: 'wallet create-wallet [--bip32]',
    description: 'Create wallet via irium-wallet binary. --bip32 generates BIP39 mnemonic.',
    category: 'Wallet — Keys & Balances', minArgs: 0, maxArgs: 5,
    run: cliPassthrough('create-wallet', false),
  },
  'wallet init': {
    usage: 'wallet init [--seed <64hex>]',
    description: 'Initialise wallet, optionally from a hex seed.',
    category: 'Wallet — Keys & Balances', minArgs: 0, maxArgs: 2,
    run: cliPassthrough('init', false),
  },
  'wallet import-mnemonic': {
    usage: 'wallet import-mnemonic <words...>',
    description: 'Import a wallet from a BIP39 mnemonic. Quote the full phrase.',
    category: 'Wallet — Keys & Balances', minArgs: 1, maxArgs: 24,
    run: (args) => wallet.importMnemonic(args.join(' ')),
  },
  'wallet export-mnemonic': {
    usage: 'wallet export-mnemonic [--force]', description: 'Print the BIP39 mnemonic (sensitive).',
    category: 'Wallet — Keys & Balances', minArgs: 0, maxArgs: 1,
    run: (args) => args.length ? walletCli.exportMnemonic(true) : wallet.exportMnemonic(),
  },
  'wallet import-wif': {
    usage: 'wallet import-wif <wif>', description: 'Import a private key in WIF format.',
    category: 'Wallet — Keys & Balances', minArgs: 1, maxArgs: 1,
    run: ([wif]) => wallet.importWif(wif),
  },
  'wallet import-private-key': {
    usage: 'wallet import-private-key <hex>', description: 'Import a private key as 64-char hex.',
    category: 'Wallet — Keys & Balances', minArgs: 1, maxArgs: 1,
    run: ([hex]) => wallet.importPrivateKey(hex),
  },
  'wallet export-seed': {
    usage: 'wallet export-seed [out_path]',
    description: 'Print or write the wallet seed (sensitive).',
    category: 'Wallet — Keys & Balances', minArgs: 0, maxArgs: 1,
    run: ([out]) => out ? walletCli.exportSeed(out) : wallet.exportSeed(),
  },
  'wallet import-seed': {
    usage: 'wallet import-seed <64hex> [--force]',
    description: 'Import a wallet seed (sensitive). --force overrides current seed.',
    category: 'Wallet — Keys & Balances', minArgs: 1, maxArgs: 2,
    run: cliPassthrough('import-seed', false),
  },
  'wallet export-wif': {
    usage: 'wallet export-wif <addr> <out_path>',
    description: 'Export the private key for an address to a WIF file.',
    category: 'Wallet — Keys & Balances', minArgs: 2, maxArgs: 2,
    run: ([addr, out]) => wallet.exportWif(addr, out),
  },
  'wallet read-wif': {
    usage: 'wallet read-wif <addr> [wallet_path]',
    description: 'Print the WIF for an address without writing to disk.',
    category: 'Wallet — Keys & Balances', minArgs: 1, maxArgs: 2,
    run: ([addr, walletPath]) => wallet.readWif(addr, optionalStr(walletPath)),
  },
  'wallet backup': {
    usage: 'wallet backup <out_path>', description: 'Write a wallet backup JSON.',
    category: 'Wallet — Keys & Balances', minArgs: 1, maxArgs: 1,
    run: ([out]) => wallet.backup(out),
  },
  'wallet restore-backup': {
    usage: 'wallet restore-backup <file> [--force]',
    description: 'Restore wallet from a backup file.',
    category: 'Wallet — Keys & Balances', minArgs: 1, maxArgs: 2,
    run: (args) => args.length > 1 ? walletCli.restoreBackup(args[0], true) : wallet.restoreBackup(args[0]),
  },
  'wallet files': {
    usage: 'wallet files', description: 'List wallet files discoverable on disk.',
    category: 'Wallet — Keys & Balances', minArgs: 0, maxArgs: 0,
    run: () => wallet.listFiles(),
  },
  'wallet info': {
    usage: 'wallet info <wallet_path>',
    description: 'Inspect a wallet file (read-only).',
    category: 'Wallet — Keys & Balances', minArgs: 1, maxArgs: 1,
    run: ([path]) => wallet.getInfo(path),
  },
  'wallet address-to-pkh': {
    usage: 'wallet address-to-pkh <addr>', description: 'Convert address to its public-key hash (hex).',
    category: 'Wallet — Keys & Balances', minArgs: 1, maxArgs: 1,
    run: ([addr]) => walletCli.addressToPkh(addr),
  },
  'wallet qr': {
    usage: 'wallet qr <addr>', description: 'Render an Irium address as an ASCII / SVG QR.',
    category: 'Wallet — Keys & Balances', minArgs: 1, maxArgs: 1,
    run: ([addr]) => walletCli.qr(addr),
  },

  // ── WALLET — chain queries (irium-wallet binary) ──────────
  'wallet list-unspent': {
    usage: 'wallet list-unspent <addr>', description: 'UTXOs for an address (via wallet binary).',
    category: 'Wallet — Chain Queries', minArgs: 1, maxArgs: 1,
    run: ([addr]) => walletCli.listUnspent(addr),
  },
  'wallet estimate-fee': {
    usage: 'wallet estimate-fee', description: 'Current minimum fee per byte from the node.',
    category: 'Wallet — Chain Queries', minArgs: 0, maxArgs: 0,
    run: () => walletCli.estimateFee(),
  },
  'wallet watch': {
    usage: 'wallet watch [--auto-release]',
    description: 'Long-running watcher; --auto-release auto-broadcasts release tx at finality.',
    category: 'Wallet — Chain Queries', minArgs: 0, maxArgs: 1,
    run: cliPassthrough('watch', true),
  },

  // ── WALLET — transactions ─────────────────────────────────
  'wallet send': {
    usage: 'wallet send <from> <to> <amount_irm> [fee_irm|-] [smallest|largest]',
    description: 'Send IRM. Use - to skip fee. Coin-select selects UTXOs.',
    category: 'Wallet — Transactions', minArgs: 3, maxArgs: 5,
    run: ([from, to, amount, fee, coinSelect]) => {
      const feeSats = (fee === undefined || fee === '-' || fee === '') ? undefined : irmToSats(fee);
      return wallet.send(from, to, irmToSats(amount), feeSats, parseCoinSelect(coinSelect));
    },
  },
  'wallet history': {
    usage: 'wallet history [limit] [address]', description: 'Recent transactions (limit default 20, max 500).',
    category: 'Wallet — Transactions', minArgs: 0, maxArgs: 2,
    run: ([limitArg, address]) => {
      const limit = (limitArg === undefined || limitArg === '-' || limitArg === '')
        ? 20
        : Math.max(1, Math.min(500, intArg(limitArg, 'limit')));
      return wallet.transactions(limit, optionalStr(address));
    },
  },
  'wallet pending': {
    usage: 'wallet pending [address]', description: 'Locally-broadcast outgoing transactions still pending.',
    category: 'Wallet — Transactions', minArgs: 0, maxArgs: 1,
    run: ([address]) => wallet.pendingTransactions(optionalStr(address)),
  },

  // ── OFFERS ────────────────────────────────────────────────
  'wallet offer-list': {
    usage: 'wallet offer-list [source] [sort] [limit] [min_irm] [max_irm] [payment]',
    description: 'List offers. source=local|remote|all, sort=newest|amount|score.',
    category: 'Offers', minArgs: 0, maxArgs: 6,
    run: ([source, sort, limit, minIrm, maxIrm, payment]) => offers.list({
      source: parseSource(source),
      sort: parseSort(sort),
      limit: optionalInt(limit, 'limit'),
      minAmount: (minIrm === undefined || minIrm === '-' || minIrm === '') ? undefined : irmToSats(minIrm),
      maxAmount: (maxIrm === undefined || maxIrm === '-' || maxIrm === '') ? undefined : irmToSats(maxIrm),
      payment: optionalStr(payment),
    }),
  },
  'wallet offer-show': {
    usage: 'wallet offer-show <offer_id>', description: 'Show full detail for a specific offer.',
    category: 'Offers', minArgs: 1, maxArgs: 1, run: ([id]) => offers.show(id),
  },
  'wallet offer-create': {
    usage: 'wallet offer-create <amount_irm> [payment_method] [description] [payment_instructions] [timeout_blocks] [seller] [offer_id]',
    description: 'Create a sell offer (typed wrapper). Quote values with spaces.',
    category: 'Offers', minArgs: 1, maxArgs: 7,
    run: ([amount, payment, desc, instructions, timeout, seller, offerId]) => {
      const params: CreateOfferParams = {
        amount_sats: irmToSats(amount),
        payment_method: optionalStr(payment),
        description: optionalStr(desc),
        payment_instructions: optionalStr(instructions),
        timeout_blocks: optionalInt(timeout, 'timeout_blocks'),
        seller_address: optionalStr(seller),
        offer_id: optionalStr(offerId),
      };
      return offers.create(params);
    },
  },
  'wallet offer-take': {
    usage: 'wallet offer-take <offer_id> [buyer_address]', description: 'Take an open offer as a buyer.',
    category: 'Offers', minArgs: 1, maxArgs: 2,
    run: ([id, buyer]) => offers.take(id, optionalStr(buyer)),
  },
  'wallet offer-export': {
    usage: 'wallet offer-export <offer_id> <out_path>', description: 'Export an offer JSON to a file.',
    category: 'Offers', minArgs: 2, maxArgs: 2, run: ([id, out]) => offers.export(id, out),
  },
  'wallet offer-import': {
    usage: 'wallet offer-import <file>', description: 'Import an offer JSON from a file.',
    category: 'Offers', minArgs: 1, maxArgs: 1, run: ([file]) => offers.import(file),
  },
  'wallet offer-remove': {
    usage: 'wallet offer-remove <offer_id>', description: 'Remove a locally-stored offer.',
    category: 'Offers', minArgs: 1, maxArgs: 1, run: ([id]) => offers.remove(id),
  },
  'wallet offer-fetch': {
    usage: 'wallet offer-fetch <url>', description: 'Fetch a single offer from a URL.',
    category: 'Offers', minArgs: 1, maxArgs: 1, run: ([url]) => walletCli.offerFetch(url),
  },
  'wallet offer-feed-fetch': {
    usage: 'wallet offer-feed-fetch <url>', description: 'Fetch all offers from a feed endpoint URL.',
    category: 'Offers', minArgs: 1, maxArgs: 1, run: ([url]) => walletCli.offerFeedFetch(url),
  },
  'wallet offer-feed-export': {
    usage: 'wallet offer-feed-export [out_path] [limit]',
    description: 'Export the local offer-feed cache.',
    category: 'Offers', minArgs: 0, maxArgs: 2,
    run: ([out, limit]) => walletCli.offerFeedExport(optionalStr(out), optionalInt(limit, 'limit')),
  },
  'wallet marketplace-sync': {
    usage: 'wallet marketplace-sync', description: 'One-shot sync of feeds + offers + reputation outcomes.',
    category: 'Offers', minArgs: 0, maxArgs: 0, run: () => walletCli.marketplaceSync(),
  },

  // ── FEEDS ─────────────────────────────────────────────────
  'wallet feed-list': {
    usage: 'wallet feed-list', description: 'List configured offer feed URLs.',
    category: 'Feeds', minArgs: 0, maxArgs: 0, run: () => feeds.list(),
  },
  'wallet feed-add': {
    usage: 'wallet feed-add <url>', description: 'Add a feed URL to the sync set.',
    category: 'Feeds', minArgs: 1, maxArgs: 1, run: ([url]) => feeds.add(url),
  },
  'wallet feed-remove': {
    usage: 'wallet feed-remove <url>', description: 'Remove a feed URL from the sync set.',
    category: 'Feeds', minArgs: 1, maxArgs: 1, run: ([url]) => feeds.remove(url),
  },
  'wallet feed-sync': {
    usage: 'wallet feed-sync', description: 'Sync offers from every configured feed URL.',
    category: 'Feeds', minArgs: 0, maxArgs: 0, run: () => feeds.sync(),
  },
  'wallet feed-fetch': {
    usage: 'wallet feed-fetch <url>', description: 'Fetch offers from a single feed URL.',
    category: 'Feeds', minArgs: 1, maxArgs: 1, run: ([url]) => feeds.fetch(url),
  },
  'wallet feed-prune': {
    usage: 'wallet feed-prune', description: 'Prune expired offers from the local feed cache.',
    category: 'Feeds', minArgs: 0, maxArgs: 0, run: () => feeds.prune(),
  },
  'wallet feed-bootstrap': {
    usage: 'wallet feed-bootstrap', description: 'Add the built-in bootstrap feed URLs.',
    category: 'Feeds', minArgs: 0, maxArgs: 0, run: () => feedOps.bootstrap(),
  },
  'wallet feed-discover': {
    usage: 'wallet feed-discover', description: 'Walk seeds and peers for new offer-feed URLs.',
    category: 'Feeds', minArgs: 0, maxArgs: 0, run: () => feedOps.discover(),
  },

  // ── AGREEMENTS — templates & creation ─────────────────────
  'wallet template-list': {
    usage: 'wallet template-list', description: 'List the built-in agreement templates.',
    category: 'Agreements — Templates & Creation', minArgs: 0, maxArgs: 0,
    run: () => walletCli.templateList(),
  },
  'wallet template-show': {
    usage: 'wallet template-show <id>', description: 'Print the canonical JSON for a template.',
    category: 'Agreements — Templates & Creation', minArgs: 1, maxArgs: 1,
    run: ([id]) => walletCli.templateShow(id),
  },
  'wallet agreement-create-simple-settlement': {
    usage: 'wallet agreement-create-simple-settlement <flags...>',
    description: 'Low-level simple-settlement creation. Pass --flag value pairs.',
    category: 'Agreements — Templates & Creation', minArgs: 0, maxArgs: 30,
    run: cliPassthrough('agreement-create-simple-settlement', false),
  },
  'wallet agreement-create-otc': {
    usage: 'wallet agreement-create-otc <flags...>',
    description: 'Low-level OTC creation (CLI flags).',
    category: 'Agreements — Templates & Creation', minArgs: 0, maxArgs: 30,
    run: cliPassthrough('agreement-create-otc', false),
  },
  'wallet agreement-create-deposit': {
    usage: 'wallet agreement-create-deposit <flags...>',
    description: 'Low-level deposit-agreement creation.',
    category: 'Agreements — Templates & Creation', minArgs: 0, maxArgs: 30,
    run: cliPassthrough('agreement-create-deposit', false),
  },
  'wallet agreement-create-milestone': {
    usage: 'wallet agreement-create-milestone <flags...>',
    description: 'Low-level milestone-agreement creation.',
    category: 'Agreements — Templates & Creation', minArgs: 0, maxArgs: 30,
    run: cliPassthrough('agreement-create-milestone', false),
  },
  'wallet agreement-create-from-template': {
    usage: 'wallet agreement-create-from-template --template <id> [overrides...]',
    description: 'Build an agreement from a template with field overrides.',
    category: 'Agreements — Templates & Creation', minArgs: 2, maxArgs: 30,
    run: cliPassthrough('agreement-create-from-template', false),
  },
  'wallet agreement-template': {
    usage: 'wallet agreement-template <sub> [args...]',
    description: 'Manage user-saved agreement templates.',
    category: 'Agreements — Templates & Creation', minArgs: 1, maxArgs: 30,
    run: cliPassthrough('agreement-template', false),
  },
  'wallet flow-otc-demo': {
    usage: 'wallet flow-otc-demo', description: 'End-to-end OTC demo flow against a local node.',
    category: 'Agreements — Templates & Creation', minArgs: 0, maxArgs: 0,
    run: () => walletCli.flowOtcDemo(),
  },

  // ── AGREEMENTS — core ─────────────────────────────────────
  'wallet agreement-list': {
    usage: 'wallet agreement-list', description: 'List settlement agreements your wallet knows about.',
    category: 'Agreements — Core', minArgs: 0, maxArgs: 0, run: () => agreements.list(),
  },
  'wallet agreement-show': {
    usage: 'wallet agreement-show <agreement_id>', description: 'Show full agreement detail.',
    category: 'Agreements — Core', minArgs: 1, maxArgs: 1, run: ([id]) => agreements.show(id),
  },
  'wallet agreement-create': {
    usage: 'wallet agreement-create <template> <counterparty> <amount_irm> [deadline_hours] [memo]',
    description: 'Generic agreement creation. Quote memo if it contains spaces.',
    category: 'Agreements — Core', minArgs: 3, maxArgs: 5,
    run: ([template, counterparty, amount, deadline, memo]) => {
      const params: CreateAgreementParams = {
        template, counterparty,
        amount_sats: irmToSats(amount),
        deadline_hours: optionalInt(deadline, 'deadline_hours'),
        memo: optionalStr(memo),
      };
      return agreements.create(params);
    },
  },
  'wallet agreement-audit': {
    usage: 'wallet agreement-audit <agreement_id>', description: 'Full on-chain audit record.',
    category: 'Agreements — Core', minArgs: 1, maxArgs: 1, run: ([id]) => agreements.audit(id),
  },
  'wallet agreement-pack': {
    usage: 'wallet agreement-pack <agreement_id> <out_path>',
    description: 'Bundle agreement + policy + signatures + proofs into one file.',
    category: 'Agreements — Core', minArgs: 2, maxArgs: 2,
    run: ([id, out]) => agreements.pack(id, out),
  },
  'wallet agreement-unpack': {
    usage: 'wallet agreement-unpack <file>', description: 'Verify and import an agreement pack.',
    category: 'Agreements — Core', minArgs: 1, maxArgs: 1, run: ([file]) => agreements.unpack(file),
  },
  'wallet agreement-remove': {
    usage: 'wallet agreement-remove <agreement_id>', description: 'Remove a locally-stored agreement.',
    category: 'Agreements — Core', minArgs: 1, maxArgs: 1, run: ([id]) => agreements.remove(id),
  },
  'wallet agreement-store-list': {
    usage: 'wallet agreement-store-list', description: 'List every agreement in the local store.',
    category: 'Agreements — Core', minArgs: 0, maxArgs: 0, run: () => agreementStore.list(),
  },
  'wallet agreement-timeline': {
    usage: 'wallet agreement-timeline <ref>', description: 'Full event timeline for an agreement.',
    category: 'Agreements — Core', minArgs: 1, maxArgs: 1,
    run: ([ref]) => walletCli.agreementTimeline(ref),
  },
  'wallet agreement-milestones': {
    usage: 'wallet agreement-milestones <ref>', description: 'Milestone status for milestone-type agreements.',
    category: 'Agreements — Core', minArgs: 1, maxArgs: 1,
    run: ([ref]) => walletCli.agreementMilestones(ref),
  },
  'wallet agreement-hash': {
    usage: 'wallet agreement-hash <ref>', description: 'Deterministic hash of an agreement.',
    category: 'Agreements — Core', minArgs: 1, maxArgs: 1,
    run: ([ref]) => walletCli.agreementHash(ref),
  },
  'wallet agreement-inspect': {
    usage: 'wallet agreement-inspect <ref>', description: 'Parsed agreement fields for verification.',
    category: 'Agreements — Core', minArgs: 1, maxArgs: 1,
    run: ([ref]) => walletCli.agreementInspect(ref),
  },
  'wallet agreement-save': {
    usage: 'wallet agreement-save <ref> [--label <label>]',
    description: 'Save an agreement to local wallet storage.',
    category: 'Agreements — Core', minArgs: 1, maxArgs: 3,
    run: cliPassthrough('agreement-save', false),
  },
  'wallet agreement-load': {
    usage: 'wallet agreement-load <ref>', description: 'Load an agreement from the local store.',
    category: 'Agreements — Core', minArgs: 1, maxArgs: 1,
    run: ([ref]) => walletCli.agreementLoad(ref),
  },
  'wallet agreement-export': {
    usage: 'wallet agreement-export <ref> [out_path]', description: 'Export an agreement JSON.',
    category: 'Agreements — Core', minArgs: 1, maxArgs: 2,
    run: ([ref, out]) => walletCli.agreementExport(ref, optionalStr(out)),
  },
  'wallet agreement-import': {
    usage: 'wallet agreement-import <file>', description: 'Import a plaintext agreement JSON.',
    category: 'Agreements — Core', minArgs: 1, maxArgs: 1,
    run: ([file]) => walletCli.agreementImport(file),
  },
  'wallet agreement-store-private': {
    usage: 'wallet agreement-store-private <file>',
    description: 'Store an agreement only in the local private-agreements dir.',
    category: 'Agreements — Core', minArgs: 1, maxArgs: 1,
    run: ([file]) => walletCli.agreementStorePrivate(file),
  },
  'wallet agreement-funding-legs': {
    usage: 'wallet agreement-funding-legs <ref>',
    description: 'Show candidate funding-leg UTXOs for an agreement.',
    category: 'Agreements — Core', minArgs: 1, maxArgs: 1,
    run: ([ref]) => walletCli.agreementFundingLegs(ref),
  },
  'wallet agreement-audit-export': {
    usage: 'wallet agreement-audit-export <ref> [out_path]',
    description: 'Export the audit record as a signed JSON file.',
    category: 'Agreements — Core', minArgs: 1, maxArgs: 2,
    run: ([ref, out]) => walletCli.agreementAuditExport(ref, optionalStr(out)),
  },
  'wallet agreement-statement': {
    usage: 'wallet agreement-statement <ref>',
    description: 'Print human-readable settlement statement.',
    category: 'Agreements — Core', minArgs: 1, maxArgs: 1,
    run: ([ref]) => walletCli.agreementStatement(ref),
  },
  'wallet agreement-statement-export': {
    usage: 'wallet agreement-statement-export <ref> [text|html|json] [out_path]',
    description: 'Export the statement in chosen format.',
    category: 'Agreements — Core', minArgs: 1, maxArgs: 3,
    run: ([ref, fmt, out]) => walletCli.agreementStatementExport(
      ref, fmt as 'text' | 'html' | 'json' | undefined, optionalStr(out),
    ),
  },
  'wallet agreement-receipt': {
    usage: 'wallet agreement-receipt <ref> [html|json] [out_path]',
    description: 'Export a signed escrow receipt.',
    category: 'Agreements — Core', minArgs: 1, maxArgs: 3,
    run: ([ref, fmt, out]) => walletCli.agreementReceipt(
      ref, fmt as 'html' | 'json' | undefined, optionalStr(out),
    ),
  },
  'wallet agreement-verify-artifacts': {
    usage: 'wallet agreement-verify-artifacts <ref>',
    description: 'Verify document hash, agreement hash, signatures, and on-chain status.',
    category: 'Agreements — Core', minArgs: 1, maxArgs: 1,
    run: ([ref]) => walletCli.agreementVerifyArtifacts(ref),
  },
  'wallet agreement-export-receipt': {
    usage: 'wallet agreement-export-receipt <ref> [out_path]',
    description: 'Export the legacy single-file receipt (Group F).',
    category: 'Agreements — Core', minArgs: 1, maxArgs: 2,
    run: ([ref, out]) => walletCli.agreementExportReceipt(ref, optionalStr(out)),
  },
  'wallet agreement-flag-non-response': {
    usage: 'wallet agreement-flag-non-response <ref>',
    description: 'Locally record a counterparty non-response.',
    category: 'Agreements — Core', minArgs: 1, maxArgs: 1,
    run: ([ref]) => walletCli.agreementFlagNonResponse(ref),
  },
  'wallet agreement-share': {
    usage: 'wallet agreement-share <agreement_hash> <recipient_pubkey> [out_path]',
    description: 'Encrypt and export an agreement for a recipient.',
    category: 'Agreements — Core', minArgs: 2, maxArgs: 3,
    run: ([hash, pub, out]) => walletCli.agreementShare(hash, pub, optionalStr(out)),
  },

  // ── AGREEMENTS — spend / status ───────────────────────────
  'wallet agreement-status': {
    usage: 'wallet agreement-status <agreement_id>', description: 'Current on-chain lifecycle state.',
    category: 'Agreements — Spend & Status', minArgs: 1, maxArgs: 1,
    run: ([id]) => agreementSpend.status(id),
  },
  'wallet agreement-fund': {
    usage: 'wallet agreement-fund <agreement_id> [broadcast]',
    description: 'Build (and optionally broadcast) the funding tx.',
    category: 'Agreements — Spend & Status', minArgs: 1, maxArgs: 2,
    run: ([id, b]) => agreementSpend.fund(id, optionalBool(b, 'broadcast')),
  },
  'wallet agreement-release': {
    usage: 'wallet agreement-release <agreement_id> [secret_hex] [broadcast]',
    description: 'Build (and optionally broadcast) the release tx.',
    category: 'Agreements — Spend & Status', minArgs: 1, maxArgs: 3,
    run: ([id, s, b]) => agreements.release(id, optionalStr(s), optionalBool(b, 'broadcast')),
  },
  'wallet agreement-refund': {
    usage: 'wallet agreement-refund <agreement_id> [broadcast]',
    description: 'Build (and optionally broadcast) the refund tx.',
    category: 'Agreements — Spend & Status', minArgs: 1, maxArgs: 2,
    run: ([id, b]) => agreements.refund(id, optionalBool(b, 'broadcast')),
  },
  'wallet agreement-release-eligibility': {
    usage: 'wallet agreement-release-eligibility <agreement_id> [funding_txid]',
    description: 'Check whether the agreement is currently releasable.',
    category: 'Agreements — Spend & Status', minArgs: 1, maxArgs: 2,
    run: ([id, txid]) => agreementSpend.releaseEligibility(id, optionalStr(txid)),
  },
  'wallet agreement-refund-eligibility': {
    usage: 'wallet agreement-refund-eligibility <agreement_id> [funding_txid]',
    description: 'Check whether the agreement is currently refundable.',
    category: 'Agreements — Spend & Status', minArgs: 1, maxArgs: 2,
    run: ([id, txid]) => agreementSpend.refundEligibility(id, optionalStr(txid)),
  },
  'wallet agreement-secret': {
    usage: 'wallet agreement-secret <agreement_id>',
    description: 'Read the Hub-stored HTLC preimage for an agreement.',
    category: 'Agreements — Spend & Status', minArgs: 1, maxArgs: 1,
    run: ([id]) => agreements.getSecret(id),
  },
  'wallet agreement-milestone-secret': {
    usage: 'wallet agreement-milestone-secret <agreement_id> <milestone_index>',
    description: 'Read the per-milestone HTLC preimage (0-based).',
    category: 'Agreements — Spend & Status', minArgs: 2, maxArgs: 2,
    run: ([id, idx]) => agreements.getMilestoneSecret(id, intArg(idx, 'milestone_index')),
  },
  'wallet agreement-milestone-fund': {
    usage: 'wallet agreement-milestone-fund <ref> --milestone <id>',
    description: 'Fund a single milestone HTLC leg.',
    category: 'Agreements — Spend & Status', minArgs: 1, maxArgs: 10,
    run: cliPassthrough('agreement-milestone-fund', true),
  },
  'wallet agreement-milestone-release': {
    usage: 'wallet agreement-milestone-release <ref> --milestone <id> --secret <hex>',
    description: 'Release a single milestone with its preimage.',
    category: 'Agreements — Spend & Status', minArgs: 1, maxArgs: 10,
    run: cliPassthrough('agreement-milestone-release', true),
  },

  // ── AGREEMENTS — signatures & bundles ─────────────────────
  'wallet agreement-sign': {
    usage: 'wallet agreement-sign <agreement_id> <signer_addr> [role] [out_path]',
    description: 'Sign an agreement with the private key of <signer_addr>.',
    category: 'Agreements — Signatures & Bundles', minArgs: 2, maxArgs: 4,
    run: ([id, addr, role, out]) =>
      agreementStore.sign(id, addr, optionalStr(role), optionalStr(out)),
  },
  'wallet agreement-verify-signature': {
    usage: 'wallet agreement-verify-signature <signature_path> [agreement_id]',
    description: 'Verify a detached signature against its agreement.',
    category: 'Agreements — Signatures & Bundles', minArgs: 1, maxArgs: 2,
    run: ([sig, id]) => agreementStore.verifySignature(sig, optionalStr(id)),
  },
  'wallet agreement-decrypt': {
    usage: 'wallet agreement-decrypt <blob_path>',
    description: 'Decrypt a received share blob with the local wallet keys.',
    category: 'Agreements — Signatures & Bundles', minArgs: 1, maxArgs: 1,
    run: ([blob]) => agreementStore.decrypt(blob),
  },
  'wallet agreement-signature-inspect': {
    usage: 'wallet agreement-signature-inspect <file>',
    description: 'Print the signed envelope fields for a single signature.',
    category: 'Agreements — Signatures & Bundles', minArgs: 1, maxArgs: 1,
    run: ([f]) => walletCli.agreementSignatureInspect(f),
  },
  'wallet agreement-bundle-create': {
    usage: 'wallet agreement-bundle-create <ref> <out_path>',
    description: 'Create a bundle wrapping an agreement and its signatures.',
    category: 'Agreements — Signatures & Bundles', minArgs: 2, maxArgs: 2,
    run: ([ref, out]) => walletCli.agreementBundleCreate(ref, out),
  },
  'wallet agreement-bundle-inspect': {
    usage: 'wallet agreement-bundle-inspect <ref>',
    description: 'Print the contents of a bundle.',
    category: 'Agreements — Signatures & Bundles', minArgs: 1, maxArgs: 1,
    run: ([ref]) => walletCli.agreementBundleInspect(ref),
  },
  'wallet agreement-bundle-verify': {
    usage: 'wallet agreement-bundle-verify <ref>',
    description: 'Verify all signatures in a bundle.',
    category: 'Agreements — Signatures & Bundles', minArgs: 1, maxArgs: 1,
    run: ([ref]) => walletCli.agreementBundleVerify(ref),
  },
  'wallet agreement-bundle-sign': {
    usage: 'wallet agreement-bundle-sign <bundle> <signer_addr>',
    description: 'Add a signature to a bundle.',
    category: 'Agreements — Signatures & Bundles', minArgs: 2, maxArgs: 2,
    run: ([bundle, signer]) => walletCli.agreementBundleSign(bundle, signer),
  },
  'wallet agreement-bundle-pack': {
    usage: 'wallet agreement-bundle-pack <ref> [out_path]',
    description: 'Build a bundle without registering on a node.',
    category: 'Agreements — Signatures & Bundles', minArgs: 1, maxArgs: 2,
    run: ([ref, out]) => walletCli.agreementBundlePack(ref, optionalStr(out)),
  },
  'wallet agreement-bundle-unpack': {
    usage: 'wallet agreement-bundle-unpack <file> [--json]',
    description: 'Verify and import a bundle from disk.',
    category: 'Agreements — Signatures & Bundles', minArgs: 1, maxArgs: 2,
    run: cliPassthrough('agreement-bundle-unpack', true),
  },
  'wallet agreement-bundle-verify-signatures': {
    usage: 'wallet agreement-bundle-verify-signatures <file>',
    description: 'Verify only embedded signatures (no chain check).',
    category: 'Agreements — Signatures & Bundles', minArgs: 1, maxArgs: 1,
    run: ([f]) => walletCli.agreementBundleVerifySignatures(f),
  },

  // ── AGREEMENTS — share packages ───────────────────────────
  'wallet agreement-share-package': {
    usage: 'wallet agreement-share-package --out <file>',
    description: 'Create a share package.',
    category: 'Agreements — Share Packages', minArgs: 1, maxArgs: 5,
    run: cliPassthrough('agreement-share-package', false),
  },
  'wallet agreement-share-package-inspect': {
    usage: 'wallet agreement-share-package-inspect <file>',
    description: 'Manifest and verification status of a package.',
    category: 'Agreements — Share Packages', minArgs: 1, maxArgs: 1,
    run: ([f]) => walletCli.agreementSharePackageInspect(f),
  },
  'wallet agreement-share-package-verify': {
    usage: 'wallet agreement-share-package-verify <file>',
    description: 'Full verification against the chain.',
    category: 'Agreements — Share Packages', minArgs: 1, maxArgs: 1,
    run: ([f]) => walletCli.agreementSharePackageVerify(f),
  },
  'wallet agreement-share-package-import': {
    usage: 'wallet agreement-share-package-import <file>',
    description: 'Import after successful verify.',
    category: 'Agreements — Share Packages', minArgs: 1, maxArgs: 1,
    run: ([f]) => walletCli.agreementSharePackageImport(f),
  },
  'wallet agreement-share-package-list': {
    usage: 'wallet agreement-share-package-list',
    description: 'List packages in the local inbox.',
    category: 'Agreements — Share Packages', minArgs: 0, maxArgs: 0,
    run: () => walletCli.agreementSharePackageList(),
  },
  'wallet agreement-share-package-show': {
    usage: 'wallet agreement-share-package-show <ref>',
    description: 'Show one package by id or filename.',
    category: 'Agreements — Share Packages', minArgs: 1, maxArgs: 1,
    run: ([r]) => walletCli.agreementSharePackageShow(r),
  },
  'wallet agreement-share-package-archive': {
    usage: 'wallet agreement-share-package-archive <ref>',
    description: 'Move a package into the archive directory.',
    category: 'Agreements — Share Packages', minArgs: 1, maxArgs: 1,
    run: ([r]) => walletCli.agreementSharePackageArchive(r),
  },
  'wallet agreement-share-package-prune': {
    usage: 'wallet agreement-share-package-prune [--older-than-days N] [--dry-run]',
    description: 'Remove old packages from the inbox / archive.',
    category: 'Agreements — Share Packages', minArgs: 0, maxArgs: 4,
    run: cliPassthrough('agreement-share-package-prune', false),
  },
  'wallet agreement-share-package-remove': {
    usage: 'wallet agreement-share-package-remove <ref>',
    description: 'Hard-delete a package by id.',
    category: 'Agreements — Share Packages', minArgs: 1, maxArgs: 1,
    run: ([r]) => walletCli.agreementSharePackageRemove(r),
  },

  // ── OTC SHORTCUTS ─────────────────────────────────────────
  'wallet otc-create': {
    usage: 'wallet otc-create --seller <a> --buyer <a> --amount <irm> --asset <s> --payment-method <s> --timeout <h>',
    description: 'Single-command OTC agreement creation.',
    category: 'OTC Shortcuts', minArgs: 4, maxArgs: 20,
    run: cliPassthrough('otc-create', false),
  },
  'wallet otc-attest': {
    usage: 'wallet otc-attest --agreement <ref> --message <text> --address <addr>',
    description: 'Add an attestation message to an OTC agreement.',
    category: 'OTC Shortcuts', minArgs: 1, maxArgs: 10,
    run: cliPassthrough('otc-attest', false),
  },
  'wallet otc-settle': {
    usage: 'wallet otc-settle --agreement <ref>',
    description: 'Execute the full settlement flow for an OTC agreement.',
    category: 'OTC Shortcuts', minArgs: 1, maxArgs: 5,
    run: cliPassthrough('otc-settle', true),
  },
  'wallet otc-status': {
    usage: 'wallet otc-status --agreement <ref>',
    description: 'Status of an OTC agreement.',
    category: 'OTC Shortcuts', minArgs: 1, maxArgs: 5,
    run: cliPassthrough('otc-status', true),
  },

  // ── SETTLEMENT TEMPLATES (typed) ──────────────────────────
  'wallet settlement-otc': {
    usage: 'wallet settlement-otc <buyer> <seller> <amount_irm> [asset_ref] [payment_method] [deadline_hours] [memo]',
    description: 'Create an OTC agreement from the OTC template.',
    category: 'Settlement Templates', minArgs: 3, maxArgs: 7,
    run: ([buyer, seller, amount, asset, payment, deadline, memo]) => {
      const params: OtcParams = {
        buyer, seller, amount_sats: irmToSats(amount),
        asset_reference: optionalStr(asset), payment_method: optionalStr(payment),
        deadline_hours: optionalInt(deadline, 'deadline_hours'), memo: optionalStr(memo),
      };
      return settlement.otc(params);
    },
  },
  'wallet settlement-freelance': {
    usage: 'wallet settlement-freelance <client> <contractor> <amount_irm> [deadline_hours] [scope]',
    description: 'Create a freelance/contractor agreement.',
    category: 'Settlement Templates', minArgs: 3, maxArgs: 5,
    run: ([client, contractor, amount, deadline, scope]) => {
      const params: FreelanceParams = {
        client, contractor, amount_sats: irmToSats(amount),
        deadline_hours: optionalInt(deadline, 'deadline_hours'), scope: optionalStr(scope),
      };
      return settlement.freelance(params);
    },
  },
  'wallet settlement-milestone': {
    usage: 'wallet settlement-milestone <payer> <payee> <amount_irm> <milestone_count>',
    description: 'Create a milestone agreement.',
    category: 'Settlement Templates', minArgs: 4, maxArgs: 4,
    run: ([payer, payee, amount, count]) => {
      const params: MilestoneParams = {
        payer, payee, amount_sats: irmToSats(amount),
        milestone_count: intArg(count, 'milestone_count'),
      };
      return settlement.milestone(params);
    },
  },
  'wallet settlement-deposit': {
    usage: 'wallet settlement-deposit <depositor> <recipient> <amount_irm> [deadline_hours] [purpose]',
    description: 'Create a deposit-protection agreement.',
    category: 'Settlement Templates', minArgs: 3, maxArgs: 5,
    run: ([depositor, recipient, amount, deadline, purpose]) => {
      const params: DepositParams = {
        depositor, recipient, amount_sats: irmToSats(amount),
        deadline_hours: optionalInt(deadline, 'deadline_hours'), purpose: optionalStr(purpose),
      };
      return settlement.deposit(params);
    },
  },
  'wallet settlement-merchant-delayed': {
    usage: 'wallet settlement-merchant-delayed <buyer> <merchant> <amount_irm> [cooldown_hours] [deadline_hours] [memo]',
    description: 'Create a merchant-delayed agreement.',
    category: 'Settlement Templates', minArgs: 3, maxArgs: 6,
    run: ([buyer, merchant, amount, cooldown, deadline, memo]) => {
      const params: MerchantDelayedParams = {
        buyer, merchant, amount_sats: irmToSats(amount),
        cooldown_hours: optionalInt(cooldown, 'cooldown_hours'),
        deadline_hours: optionalInt(deadline, 'deadline_hours'), memo: optionalStr(memo),
      };
      return settlement.merchantDelayed(params);
    },
  },
  'wallet settlement-contractor': {
    usage: 'wallet settlement-contractor <client> <contractor> <amount_irm> <milestone_count> [scope]',
    description: 'Create a contractor-milestone agreement.',
    category: 'Settlement Templates', minArgs: 4, maxArgs: 5,
    run: ([client, contractor, amount, count, scope]) => {
      const params: ContractorMilestoneParams = {
        client, contractor, amount_sats: irmToSats(amount),
        milestone_count: intArg(count, 'milestone_count'), scope: optionalStr(scope),
      };
      return settlement.contractor(params);
    },
  },

  // ── PROOFS ────────────────────────────────────────────────
  'wallet proof-list': {
    usage: 'wallet proof-list [agreement_id]',
    description: 'List proofs, optionally filtered.',
    category: 'Proofs', minArgs: 0, maxArgs: 1,
    run: ([id]) => proofs.list(optionalStr(id)),
  },
  'wallet proof-sign': {
    usage: 'wallet proof-sign <agreement_id> <proof_data> <out_path>',
    description: 'Sign a proof JSON with a wallet key.',
    category: 'Proofs', minArgs: 3, maxArgs: 3,
    run: ([id, data, out]) => proofs.sign(id, data, out),
  },
  'wallet proof-submit': {
    usage: 'wallet proof-submit <agreement_id> <proof_file>',
    description: 'Submit a pre-built proof JSON.',
    category: 'Proofs', minArgs: 2, maxArgs: 2,
    run: ([id, f]) => proofs.submit(id, f),
  },
  'wallet proof-create-and-submit': {
    usage: 'wallet proof-create-and-submit <agreement_hash> <proof_type> <attested_by> <address> [evidence_summary] [evidence_hash]',
    description: 'End-to-end: sign proof from fields and broadcast.',
    category: 'Proofs', minArgs: 4, maxArgs: 6,
    run: ([hash, type, by, addr, summary, eh]) => proofs.createAndSubmit({
      agreementHash: hash, proofType: type, attestedBy: by, address: addr,
      evidenceSummary: optionalStr(summary), evidenceHash: optionalStr(eh),
    }),
  },
  'wallet agreement-proof-get': {
    usage: 'wallet agreement-proof-get --proof-id <id>',
    description: 'Return a single proof by ID.',
    category: 'Proofs', minArgs: 1, maxArgs: 5,
    run: cliPassthrough('agreement-proof-get', true),
  },
  'wallet proof-template-list': {
    usage: 'wallet proof-template-list',
    description: 'List built-in proof-schema templates.',
    category: 'Proofs', minArgs: 0, maxArgs: 0,
    run: () => walletCli.proofTemplateList(),
  },
  'wallet proof-template-create': {
    usage: 'wallet proof-template-create --template <id> --out <file>',
    description: 'Render a starter proof JSON from a template.',
    category: 'Proofs', minArgs: 2, maxArgs: 10,
    run: cliPassthrough('proof-template-create', false),
  },

  // ── POLICIES ──────────────────────────────────────────────
  'wallet policy-list': {
    usage: 'wallet policy-list [active_only]',
    description: 'List stored release policies.',
    category: 'Policies', minArgs: 0, maxArgs: 1,
    run: ([b]) => policies.list(optionalBool(b, 'active_only')),
  },
  'wallet policy-evaluate': {
    usage: 'wallet policy-evaluate <agreement_id>',
    description: 'Evaluate the stored policy against submitted proofs.',
    category: 'Policies', minArgs: 1, maxArgs: 1,
    run: ([id]) => policies.evaluate(id),
  },
  'wallet policy-build-otc': {
    usage: 'wallet policy-build-otc <policy_id> <agreement_hash> <attestor> <release_proof_type> [out_path]',
    description: 'Build an OTC release policy.',
    category: 'Policies', minArgs: 4, maxArgs: 5,
    run: ([pid, h, a, p, out]) => policies.buildOtc(pid, h, a, p, optionalStr(out)),
  },
  'wallet policy-build-contractor': {
    usage: 'wallet policy-build-contractor <policy_id> <agreement_hash> <attestor> <milestone> [out_path]',
    description: 'Build a contractor milestone policy.',
    category: 'Policies', minArgs: 4, maxArgs: 5,
    run: ([pid, h, a, m, out]) => policies.buildContractor(pid, h, a, m, optionalStr(out)),
  },
  'wallet policy-build-preorder': {
    usage: 'wallet policy-build-preorder <policy_id> <agreement_hash> <attestor> <delivery_proof_type> [out_path]',
    description: 'Build a preorder/delivery policy.',
    category: 'Policies', minArgs: 4, maxArgs: 5,
    run: ([pid, h, a, p, out]) => policies.buildPreorder(pid, h, a, p, optionalStr(out)),
  },
  'wallet agreement-policy-set': {
    usage: 'wallet agreement-policy-set --policy <policy.json>',
    description: 'Store a policy on the node.',
    category: 'Policies', minArgs: 1, maxArgs: 5,
    run: cliPassthrough('agreement-policy-set', true),
  },
  'wallet agreement-policy-get': {
    usage: 'wallet agreement-policy-get --agreement-hash <hex>',
    description: 'Return the stored policy for an agreement.',
    category: 'Policies', minArgs: 1, maxArgs: 5,
    run: cliPassthrough('agreement-policy-get', true),
  },

  // ── REPUTATION ────────────────────────────────────────────
  'wallet reputation-show': {
    usage: 'wallet reputation-show <pubkey_or_address>',
    description: 'Show reputation ledger entries.',
    category: 'Reputation', minArgs: 1, maxArgs: 1,
    run: ([who]) => reputation.show(who),
  },
  'wallet reputation-record-outcome': {
    usage: 'wallet reputation-record-outcome <seller> <satisfied|failed|disputed|timeout> [proof_response_secs] [self_trade]',
    description: 'Record a trade outcome.',
    category: 'Reputation', minArgs: 2, maxArgs: 4,
    run: ([seller, outcome, secs, selfTrade]) => reputationActions.recordOutcome(
      seller, parseOutcome(outcome),
      optionalInt(secs, 'proof_response_secs'), optionalBool(selfTrade, 'self_trade'),
    ),
  },
  'wallet reputation-export': {
    usage: 'wallet reputation-export <seller> [out_path]',
    description: 'Export the local outcomes store for a seller.',
    category: 'Reputation', minArgs: 1, maxArgs: 2,
    run: ([seller, out]) => reputationActions.export(seller, optionalStr(out)),
  },
  'wallet reputation-import': {
    usage: 'wallet reputation-import <file>',
    description: 'Merge an exported outcomes file.',
    category: 'Reputation', minArgs: 1, maxArgs: 1,
    run: ([file]) => reputationActions.import(file),
  },
  'wallet reputation-self-trade-check': {
    usage: 'wallet reputation-self-trade-check <seller> <buyer>',
    description: 'Detect self-trade patterns inflating reputation.',
    category: 'Reputation', minArgs: 2, maxArgs: 2,
    run: ([s, b]) => reputationActions.selfTradeCheck(s, b),
  },

  // ── TRADE STATUS ──────────────────────────────────────────
  'wallet seller-status': {
    usage: 'wallet seller-status [address]', description: 'Seller agreements + reputation.',
    category: 'Trade Status', minArgs: 0, maxArgs: 1,
    run: ([a]) => tradeStatus.seller(optionalStr(a)),
  },
  'wallet buyer-status': {
    usage: 'wallet buyer-status [address]', description: 'Active agreements for a buyer.',
    category: 'Trade Status', minArgs: 0, maxArgs: 1,
    run: ([a]) => tradeStatus.buyer(optionalStr(a)),
  },

  // ── ATTESTORS ─────────────────────────────────────────────
  'wallet attestor-list': {
    usage: 'wallet attestor-list [--json]', description: 'Attestors known to the node, with bond status.',
    category: 'Attestors', minArgs: 0, maxArgs: 1,
    run: cliPassthrough('attestor-list', true),
  },
  'wallet attestor-register': {
    usage: 'wallet attestor-register --bond <irm> --from <addr>',
    description: 'Anchor a bond commitment for an attestor.',
    category: 'Attestors', minArgs: 2, maxArgs: 10,
    run: cliPassthrough('attestor-register', true),
  },
  'wallet attestor-bond-status': {
    usage: 'wallet attestor-bond-status [--address <addr>] [--json]',
    description: 'Bond state for one or all attestors.',
    category: 'Attestors', minArgs: 0, maxArgs: 5,
    run: cliPassthrough('attestor-bond-status', true),
  },
  'wallet attestor-slash': {
    usage: 'wallet attestor-slash --attestor <addr> --proof1 <id> --proof2 <id> --agreement <hash>',
    description: 'Record an on-chain slash for two contradicting proofs.',
    category: 'Attestors', minArgs: 4, maxArgs: 15,
    run: cliPassthrough('attestor-slash', true),
  },
  'wallet attestor-withdraw-bond': {
    usage: 'wallet attestor-withdraw-bond --from <addr>',
    description: 'Anchor a bond withdrawal after cooldown.',
    category: 'Attestors', minArgs: 1, maxArgs: 5,
    run: cliPassthrough('attestor-withdraw-bond', true),
  },

  // ── DISPUTES & RESOLVERS ──────────────────────────────────
  'wallet dispute-list': {
    usage: 'wallet dispute-list', description: 'Local disputes from typed wrapper.',
    category: 'Disputes & Resolvers', minArgs: 0, maxArgs: 0, run: () => disputes.list(),
  },
  'wallet dispute-open': {
    usage: 'wallet dispute-open <agreement_id> [reason]',
    description: 'Open a dispute against an agreement.',
    category: 'Disputes & Resolvers', minArgs: 1, maxArgs: 2,
    run: ([id, reason]) => disputes.open(id, optionalStr(reason)),
  },
  'wallet agreement-dispute-list': {
    usage: 'wallet agreement-dispute-list', description: 'All open disputes the node knows about.',
    category: 'Disputes & Resolvers', minArgs: 0, maxArgs: 0,
    run: () => walletCli.agreementDisputeList(),
  },
  'wallet agreement-dispute-show': {
    usage: 'wallet agreement-dispute-show --agreement <file> [--json]',
    description: 'Inspect dispute state.',
    category: 'Disputes & Resolvers', minArgs: 1, maxArgs: 5,
    run: cliPassthrough('agreement-dispute-show', true),
  },
  'wallet agreement-dispute-raise': {
    usage: 'wallet agreement-dispute-raise --agreement <f> --raising-party <r> --reason <t> --evidence-file <p> --key <k>',
    description: 'Raise a dispute, anchor on-chain.',
    category: 'Disputes & Resolvers', minArgs: 5, maxArgs: 20,
    run: cliPassthrough('agreement-dispute-raise', true),
  },
  'wallet agreement-dispute-respond': {
    usage: 'wallet agreement-dispute-respond --agreement <f> --submitter-party <r> --evidence-file <p> --evidence-type <t> --message <s> --key <k>',
    description: 'Submit evidence on an open dispute.',
    category: 'Disputes & Resolvers', minArgs: 6, maxArgs: 20,
    run: cliPassthrough('agreement-dispute-respond', true),
  },
  'wallet agreement-dispute-resolve': {
    usage: 'wallet agreement-dispute-resolve --agreement <f> --outcome <release|refund> --resolver-role <primary|fallback> --message <s> --key <k>',
    description: 'Resolver records the resolution.',
    category: 'Disputes & Resolvers', minArgs: 5, maxArgs: 20,
    run: cliPassthrough('agreement-dispute-resolve', true),
  },
  'wallet agreement-dispute-reresolve': {
    usage: 'wallet agreement-dispute-reresolve --agreement <f> --new-resolver <a> --new-fallback <a> --key-a <k> --key-b <k>',
    description: 'Co-signed nomination of a new resolver pair.',
    category: 'Disputes & Resolvers', minArgs: 5, maxArgs: 20,
    run: cliPassthrough('agreement-dispute-reresolve', true),
  },
  'wallet resolver-register': {
    usage: 'wallet resolver-register --display-name <t> [--bio <t>] [--fee-bps <n>] --key <k>',
    description: 'Register as a resolver (miner-recency check enforced).',
    category: 'Disputes & Resolvers', minArgs: 3, maxArgs: 15,
    run: cliPassthrough('resolver-register', true),
  },
  'wallet resolver-list': {
    usage: 'wallet resolver-list [--limit N] [--cursor c]',
    description: 'Browse the public resolver feed.',
    category: 'Disputes & Resolvers', minArgs: 0, maxArgs: 5,
    run: cliPassthrough('resolver-list', true),
  },

  // ── INVOICES ──────────────────────────────────────────────
  'wallet invoice-generate': {
    usage: 'wallet invoice-generate <recipient> <amount_irm> <reference> [expires_blocks] [out_path]',
    description: 'Generate an invoice (typed).',
    category: 'Invoices', minArgs: 3, maxArgs: 5,
    run: ([r, a, ref, exp, out]) => invoices.generate(
      r, Number(a), ref, optionalInt(exp, 'expires_blocks'), optionalStr(out),
    ),
  },
  'wallet invoice-import': {
    usage: 'wallet invoice-import <file>', description: 'Import an invoice JSON.',
    category: 'Invoices', minArgs: 1, maxArgs: 1, run: ([f]) => invoices.import(f),
  },

  // ── MULTISIG ──────────────────────────────────────────────
  'wallet multisig-create': {
    usage: 'wallet multisig-create <threshold> <pubkey1,pubkey2,...>',
    description: 'Build a k-of-n multisig address.',
    category: 'Multisig', minArgs: 2, maxArgs: 2,
    run: ([t, keys]) => multisig.create(intArg(t, 'threshold'),
      keys.split(',').map((s) => s.trim()).filter(Boolean)),
  },
  'wallet multisig-broadcast': {
    usage: 'wallet multisig-broadcast <raw_tx_hex>',
    description: 'Broadcast a fully-signed multisig tx.',
    category: 'Multisig', minArgs: 1, maxArgs: 1, run: ([raw]) => multisig.broadcast(raw),
  },

  // ── IRIUMD — node status ──────────────────────────────────
  'rpc status': {
    usage: 'rpc status', description: 'Live node status: height, peers, sync.',
    category: 'iriumd — Node Status', minArgs: 0, maxArgs: 0, run: () => node.status(),
  },
  'rpc network-status': {
    usage: 'rpc network-status', description: 'Rich network-status payload.',
    category: 'iriumd — Node Status', minArgs: 0, maxArgs: 0, run: () => rpcCall.networkStatus(),
  },
  'rpc metrics': {
    usage: 'rpc metrics', description: 'Scraped iriumd /metrics counters.',
    category: 'iriumd — Node Status', minArgs: 0, maxArgs: 0, run: () => node.getMetrics(),
  },
  'rpc metrics-raw': {
    usage: 'rpc metrics-raw', description: 'Raw Prometheus-format /metrics text.',
    category: 'iriumd — Node Status', minArgs: 0, maxArgs: 0, run: () => rpcCall.metrics(),
  },
  'rpc network-metrics': {
    usage: 'rpc network-metrics', description: 'Aggregated network metrics.',
    category: 'iriumd — Node Status', minArgs: 0, maxArgs: 0, run: () => metrics.network(),
  },
  'rpc app-version': {
    usage: 'rpc app-version', description: 'Desktop app version string.',
    category: 'iriumd — Node Status', minArgs: 0, maxArgs: 0, run: () => node.getAppVersion(),
  },
  'rpc system-info': {
    usage: 'rpc system-info', description: 'Host OS / CPU info.',
    category: 'iriumd — Node Status', minArgs: 0, maxArgs: 0, run: () => node.getSystemInfo(),
  },
  'rpc binaries': {
    usage: 'rpc binaries', description: 'Binary discovery state.',
    category: 'iriumd — Node Status', minArgs: 0, maxArgs: 0, run: () => node.checkBinaries(),
  },
  'rpc logs': {
    usage: 'rpc logs [lines]', description: 'Tail of iriumd logs.',
    category: 'iriumd — Node Status', minArgs: 0, maxArgs: 1,
    run: ([n]) => node.logs(optionalInt(n, 'lines')),
  },
  'rpc network-reachable': {
    usage: 'rpc network-reachable', description: 'Probe bootstrap seeds for reachability.',
    category: 'iriumd — Node Status', minArgs: 0, maxArgs: 0, run: () => node.checkNetworkReachable(),
  },
  'rpc upnp-diagnostics': {
    usage: 'rpc upnp-diagnostics', description: 'Most recent UPnP attempt snapshot.',
    category: 'iriumd — Node Status', minArgs: 0, maxArgs: 0, run: () => node.upnpDiagnostics(),
  },
  'rpc port-check': {
    usage: 'rpc port-check', description: 'Port-forwarding self-test.',
    category: 'iriumd — Node Status', minArgs: 0, maxArgs: 0, run: () => node.checkPortOpen(),
  },
  'rpc detect-public-ip': {
    usage: 'rpc detect-public-ip <service_url>', description: 'Query a public-IP echo service.',
    category: 'iriumd — Node Status', minArgs: 1, maxArgs: 1, run: ([u]) => node.detectPublicIp(u),
  },
  'rpc scan-quarantined': {
    usage: 'rpc scan-quarantined', description: 'Count quarantined blocks under the data dir.',
    category: 'iriumd — Node Status', minArgs: 0, maxArgs: 0, run: () => node.scanQuarantinedBlocks(),
  },
  'rpc add-seed': {
    usage: 'rpc add-seed <ip:port>', description: 'Add a peer to the runtime seed list.',
    category: 'iriumd — Node Status', minArgs: 1, maxArgs: 1, run: ([a]) => rpcCall.addSeed(a),
  },

  // ── IRIUMD — chain ────────────────────────────────────────
  'rpc peers': {
    usage: 'rpc peers', description: 'List currently known peers.',
    category: 'iriumd — Chain & Mempool', minArgs: 0, maxArgs: 0, run: () => rpc.peers(),
  },
  'rpc mempool': {
    usage: 'rpc mempool', description: 'Mempool size and recent txs.',
    category: 'iriumd — Chain & Mempool', minArgs: 0, maxArgs: 0, run: () => rpc.mempool(),
  },
  'rpc block': {
    usage: 'rpc block <height_or_hash>',
    description: 'Block at integer height or 64-hex hash.',
    category: 'iriumd — Chain & Mempool', minArgs: 1, maxArgs: 1, run: ([h]) => rpc.block(h),
  },
  'rpc block-by-hash': {
    usage: 'rpc block-by-hash <hash>', description: 'Block lookup by hash (raw RPC).',
    category: 'iriumd — Chain & Mempool', minArgs: 1, maxArgs: 1, run: ([h]) => rpcCall.blockByHash(h),
  },
  'rpc blocks': {
    usage: 'rpc blocks <from> <count>', description: 'Contiguous range of blocks (max 500).',
    category: 'iriumd — Chain & Mempool', minArgs: 2, maxArgs: 2,
    run: ([from, count]) => rpcCall.blocks(intArg(from, 'from'), intArg(count, 'count')),
  },
  'rpc tx': {
    usage: 'rpc tx <txid>', description: 'Transaction lookup by id.',
    category: 'iriumd — Chain & Mempool', minArgs: 1, maxArgs: 1, run: ([t]) => rpc.tx(t),
  },
  'rpc address': {
    usage: 'rpc address <address>', description: 'Address summary: balance, utxos, history.',
    category: 'iriumd — Chain & Mempool', minArgs: 1, maxArgs: 1, run: ([a]) => rpc.address(a),
  },
  'rpc balance-rpc': {
    usage: 'rpc balance-rpc <address>', description: 'Raw /rpc/balance lookup.',
    category: 'iriumd — Chain & Mempool', minArgs: 1, maxArgs: 1, run: ([a]) => rpcCall.balance(a),
  },
  'rpc utxos': {
    usage: 'rpc utxos <address>', description: 'All UTXOs for an address (raw RPC).',
    category: 'iriumd — Chain & Mempool', minArgs: 1, maxArgs: 1, run: ([a]) => rpcCall.utxos(a),
  },
  'rpc utxo': {
    usage: 'rpc utxo <txid> <index>', description: 'Single UTXO by txid + index.',
    category: 'iriumd — Chain & Mempool', minArgs: 2, maxArgs: 2,
    run: ([t, i]) => rpcCall.utxo(t, intArg(i, 'index')),
  },
  'rpc history-rpc': {
    usage: 'rpc history-rpc <address>', description: 'Raw /rpc/history lookup.',
    category: 'iriumd — Chain & Mempool', minArgs: 1, maxArgs: 1, run: ([a]) => rpcCall.history(a),
  },
  'rpc recent-blocks': {
    usage: 'rpc recent-blocks [limit] [end_height]',
    description: 'Recent blocks. Default limit 20.',
    category: 'iriumd — Chain & Mempool', minArgs: 0, maxArgs: 2,
    run: ([l, e]) => rpc.recentBlocks(
      (l === undefined || l === '-' || l === '') ? 20 : intArg(l, 'limit'),
      optionalInt(e, 'end_height'),
    ),
  },
  'rpc network-hashrate': {
    usage: 'rpc network-hashrate', description: 'Estimated network hashrate.',
    category: 'iriumd — Chain & Mempool', minArgs: 0, maxArgs: 0, run: () => rpc.networkHashrate(),
  },
  'rpc richlist': {
    usage: 'rpc richlist [limit]', description: 'Top-N IRM holders.',
    category: 'iriumd — Chain & Mempool', minArgs: 0, maxArgs: 1,
    run: ([l]) => rpc.richlist(optionalInt(l, 'limit')),
  },
  'rpc fee-estimate': {
    usage: 'rpc fee-estimate', description: 'Current minimum fee per byte.',
    category: 'iriumd — Chain & Mempool', minArgs: 0, maxArgs: 0, run: () => rpcCall.feeEstimate(),
  },
  'rpc pool-stats': {
    usage: 'rpc pool-stats', description: 'iriumlabs.org pool stats.',
    category: 'iriumd — Chain & Mempool', minArgs: 0, maxArgs: 0, run: () => rpc.poolStats(),
  },
  'rpc offers-feed': {
    usage: 'rpc offers-feed', description: 'Raw /offers/feed payload.',
    category: 'iriumd — Chain & Mempool', minArgs: 0, maxArgs: 0, run: () => rpc.offersFeed(),
  },
  'rpc mining-metrics': {
    usage: 'rpc mining-metrics', description: 'Extended mining metrics.',
    category: 'iriumd — Chain & Mempool', minArgs: 0, maxArgs: 0, run: () => rpcCall.miningMetrics(),
  },
  'rpc get-block-template': {
    usage: 'rpc get-block-template', description: 'Block template for mining.',
    category: 'iriumd — Chain & Mempool', minArgs: 0, maxArgs: 0,
    run: () => rpcCall.getBlockTemplate(),
  },
  'rpc submit-block': {
    usage: 'rpc submit-block <block_hex>', description: 'Submit a solved block.',
    category: 'iriumd — Chain & Mempool', minArgs: 1, maxArgs: 1,
    run: ([h]) => rpcCall.submitBlock(h),
  },
  'rpc submit-tx': {
    usage: 'rpc submit-tx <tx_hex>', description: 'Broadcast a signed transaction.',
    category: 'iriumd — Chain & Mempool', minArgs: 1, maxArgs: 1,
    run: ([h]) => rpcCall.submitTx(h),
  },
  'rpc broadcast-offer-take': {
    usage: 'rpc broadcast-offer-take <offer_id> <taker_addr> <agreement_hash>',
    description: 'Gossip an offer.taken notification.',
    category: 'iriumd — Chain & Mempool', minArgs: 3, maxArgs: 3,
    run: ([o, t, a]) => rpcCall.broadcastOfferTake(o, t, a),
  },

  // ── IRIUMD — explorer ─────────────────────────────────────
  'rpc explorer-agreements': {
    usage: 'rpc explorer-agreements [limit]', description: 'Paginated agreements.',
    category: 'iriumd — Explorer', minArgs: 0, maxArgs: 1,
    run: ([l]) => explorer.agreements(optionalInt(l, 'limit')),
  },
  'rpc explorer-agreement': {
    usage: 'rpc explorer-agreement <hash>', description: 'Single agreement detail.',
    category: 'iriumd — Explorer', minArgs: 1, maxArgs: 1,
    run: ([h]) => rpcCall.explorerAgreement(h),
  },
  'rpc explorer-proofs': {
    usage: 'rpc explorer-proofs [agreement_hash] [page] [limit]',
    description: 'Paginated proofs list.',
    category: 'iriumd — Explorer', minArgs: 0, maxArgs: 3,
    run: ([h, p, l]) => rpcCall.explorerProofs(
      optionalStr(h), optionalInt(p, 'page'), optionalInt(l, 'limit'),
    ),
  },
  'rpc explorer-reputation': {
    usage: 'rpc explorer-reputation <pubkey>', description: 'Reputation summary by pubkey.',
    category: 'iriumd — Explorer', minArgs: 1, maxArgs: 1,
    run: ([p]) => rpcCall.explorerReputation(p),
  },
  'rpc explorer-stats': {
    usage: 'rpc explorer-stats', description: 'Network-wide settlement statistics.',
    category: 'iriumd — Explorer', minArgs: 0, maxArgs: 0, run: () => explorer.stats(),
  },
  'rpc explorer-network-stats': {
    usage: 'rpc explorer-network-stats', description: 'Explorer-sidecar network stats.',
    category: 'iriumd — Explorer', minArgs: 0, maxArgs: 0, run: () => explorer.networkStats(),
  },
  'rpc explorer-peers': {
    usage: 'rpc explorer-peers', description: 'Explorer-sidecar peer list.',
    category: 'iriumd — Explorer', minArgs: 0, maxArgs: 0, run: () => explorer.networkPeers(),
  },
  'rpc explorer-blocks': {
    usage: 'rpc explorer-blocks', description: 'Explorer-sidecar recent blocks.',
    category: 'iriumd — Explorer', minArgs: 0, maxArgs: 0, run: () => explorer.networkBlocks(),
  },

  // ── IRIUMD — HTLC ─────────────────────────────────────────
  'rpc inspect-htlc': {
    usage: 'rpc inspect-htlc <txid> <index>', description: 'Inspect an HTLC output on-chain.',
    category: 'iriumd — HTLC', minArgs: 2, maxArgs: 2,
    run: ([t, i]) => rpcCall.inspectHtlc(t, intArg(i, 'index')),
  },
  'rpc create-htlc': {
    usage: 'rpc create-htlc <secret_hash> <recipient> <refund> <timeout_height>',
    description: 'Create a new HTLC output.',
    category: 'iriumd — HTLC', minArgs: 4, maxArgs: 4,
    run: ([sh, r, ref, t]) => rpcCall.createHtlc({
      secret_hash: sh, recipient_address: r, refund_address: ref,
      timeout_height: intArg(t, 'timeout_height'),
    }),
  },
  'rpc decode-htlc': {
    usage: 'rpc decode-htlc <script_hex>', description: 'Decode an HTLC script.',
    category: 'iriumd — HTLC', minArgs: 1, maxArgs: 1, run: ([h]) => rpcCall.decodeHtlc(h),
  },

  // ── IRIUMD — settlement (raw RPC) ─────────────────────────
  'rpc list-proofs': {
    usage: 'rpc list-proofs <agreement_hash>', description: 'All proofs for an agreement.',
    category: 'iriumd — Settlement RPC', minArgs: 1, maxArgs: 1,
    run: ([h]) => rpcCall.listProofs(h),
  },
  'rpc get-proof': {
    usage: 'rpc get-proof <proof_id>', description: 'Single proof by ID.',
    category: 'iriumd — Settlement RPC', minArgs: 1, maxArgs: 1,
    run: ([id]) => rpcCall.getProof(id),
  },
  'rpc get-policy': {
    usage: 'rpc get-policy <agreement_hash>', description: 'Stored policy for an agreement.',
    category: 'iriumd — Settlement RPC', minArgs: 1, maxArgs: 1,
    run: ([h]) => rpcCall.getPolicy(h),
  },
  'rpc agreement-receipt': {
    usage: 'rpc agreement-receipt <agreement_hash>', description: 'Receipt data for an agreement.',
    category: 'iriumd — Settlement RPC', minArgs: 1, maxArgs: 1,
    run: ([h]) => rpcCall.agreementReceipt(h),
  },
  'rpc reputation-by-address': {
    usage: 'rpc reputation-by-address <address>', description: 'Reputation by address (raw RPC).',
    category: 'iriumd — Settlement RPC', minArgs: 1, maxArgs: 1,
    run: ([a]) => rpcCall.reputationByAddress(a),
  },

  // ── IRIUMD — mining ───────────────────────────────────────
  'rpc miner-status': {
    usage: 'rpc miner-status', description: 'CPU miner status snapshot.',
    category: 'iriumd — Mining', minArgs: 0, maxArgs: 0, run: () => miner.status(),
  },
  'rpc miner-start': {
    usage: 'rpc miner-start <payout_address> [threads]', description: 'Start CPU miner.',
    category: 'iriumd — Mining', minArgs: 1, maxArgs: 2,
    run: ([a, t]) => miner.start(a, optionalInt(t, 'threads')),
  },
  'rpc miner-stop': {
    usage: 'rpc miner-stop', description: 'Stop the CPU miner.',
    category: 'iriumd — Mining', minArgs: 0, maxArgs: 0, run: () => miner.stop(),
  },
  'rpc found-blocks': {
    usage: 'rpc found-blocks', description: 'Blocks the session miners found.',
    category: 'iriumd — Mining', minArgs: 0, maxArgs: 0, run: () => miner.getFoundBlocks(),
  },
  'rpc gpu-devices': {
    usage: 'rpc gpu-devices', description: 'Detected GPU devices.',
    category: 'iriumd — Mining', minArgs: 0, maxArgs: 0, run: () => gpuMiner.listDevices(),
  },
  'rpc gpu-platforms': {
    usage: 'rpc gpu-platforms', description: 'Detected OpenCL platforms.',
    category: 'iriumd — Mining', minArgs: 0, maxArgs: 0, run: () => gpuMiner.listPlatforms(),
  },
  'rpc gpu-status': {
    usage: 'rpc gpu-status', description: 'GPU miner status.',
    category: 'iriumd — Mining', minArgs: 0, maxArgs: 0, run: () => gpuMiner.status(),
  },
  'rpc gpu-start': {
    usage: 'rpc gpu-start <payout_address> [platform_sel|-] [device_indices_comma|-] [intensity]',
    description: 'Start GPU miner. Use - to skip optional fields.',
    category: 'iriumd — Mining', minArgs: 1, maxArgs: 4,
    run: ([a, p, d, i]) => {
      const platformSel = optionalStr(p);
      const indices = (d === undefined || d === '-' || d === '')
        ? [] : d.split(',').map((s) => intArg(s.trim(), 'device_index'));
      const intensity = (i === undefined || i === '-' || i === '') ? 0 : intArg(i, 'intensity');
      return gpuMiner.start(a, platformSel, indices, intensity);
    },
  },
  'rpc gpu-stop': {
    usage: 'rpc gpu-stop', description: 'Stop the GPU miner.',
    category: 'iriumd — Mining', minArgs: 0, maxArgs: 0, run: () => gpuMiner.stop(),
  },
  'rpc stratum-status': {
    usage: 'rpc stratum-status', description: 'Stratum pool connection status.',
    category: 'iriumd — Mining', minArgs: 0, maxArgs: 0, run: () => stratum.status(),
  },
  'rpc stratum-connect': {
    usage: 'rpc stratum-connect <pool_url> <worker> <password> [platform_sel|-] [device_indices_comma]',
    description: 'Connect to a Stratum pool.',
    category: 'iriumd — Mining', minArgs: 3, maxArgs: 5,
    run: ([u, w, pw, p, d]) => {
      const platformSel = optionalStr(p);
      const indices = (d === undefined || d === '-' || d === '')
        ? undefined : d.split(',').map((s) => intArg(s.trim(), 'device_index'));
      return stratum.connect(u, w, pw, platformSel, indices);
    },
  },
  'rpc stratum-disconnect': {
    usage: 'rpc stratum-disconnect', description: 'Disconnect from the Stratum pool.',
    category: 'iriumd — Mining', minArgs: 0, maxArgs: 0, run: () => stratum.disconnect(),
  },

  // ── IRIUMD — diagnostics & updates ────────────────────────
  'rpc diagnostics': {
    usage: 'rpc diagnostics', description: 'Run the diagnostics suite.',
    category: 'iriumd — Diagnostics & Updates', minArgs: 0, maxArgs: 0, run: () => diagnostics.run(),
  },
  'rpc update-check': {
    usage: 'rpc update-check', description: 'Check the GUI updater feed.',
    category: 'iriumd — Diagnostics & Updates', minArgs: 0, maxArgs: 0, run: () => update.check(),
  },
  'rpc node-update-check': {
    usage: 'rpc node-update-check', description: 'Check iriumd source for upstream commits.',
    category: 'iriumd — Diagnostics & Updates', minArgs: 0, maxArgs: 0, run: () => nodeUpdate.check(),
  },

  // ── IRIUMD — raw HTTP passthrough ─────────────────────────
  'rpc get': {
    usage: 'rpc get <path> [key=value ...]',
    description: 'Raw GET request. Path may start with /; query params as KEY=VALUE.',
    category: 'iriumd — Raw HTTP', minArgs: 1, maxArgs: 30,
    run: ([path, ...rest]) => rpcGetPassthrough(path)(rest),
  },
  'rpc post': {
    usage: 'rpc post <path> [json_body]',
    description: 'Raw POST request. json_body must be a single JSON string (quote it).',
    category: 'iriumd — Raw HTTP', minArgs: 1, maxArgs: 2,
    run: ([path, body]) => {
      let parsed: unknown = undefined;
      if (body !== undefined && body !== '') {
        try { parsed = JSON.parse(body); }
        catch { throw new Error(`invalid JSON body: ${body}`); }
      }
      return rpcCall.post(path, parsed);
    },
  },

  // ── MINER — solo stratum bridge ───────────────────────────
  'miner start-solo-stratum': {
    usage: 'miner start-solo-stratum [listen_addr]',
    description: 'Spawn irium-miner --solo-stratum. Default listen 0.0.0.0:3333.',
    category: 'Miner — Solo Stratum', minArgs: 0, maxArgs: 1,
    run: ([listen]) => soloStratum.start(optionalStr(listen)),
  },
  'miner stop-solo-stratum': {
    usage: 'miner stop-solo-stratum', description: 'Stop the solo Stratum bridge.',
    category: 'Miner — Solo Stratum', minArgs: 0, maxArgs: 0, run: () => soloStratum.stop(),
  },
  'miner solo-status': {
    usage: 'miner solo-status', description: 'Solo Stratum bridge status.',
    category: 'Miner — Solo Stratum', minArgs: 0, maxArgs: 0, run: () => soloStratum.status(),
  },
};

const BUILTIN_HELP: { command: string; description: string }[] = [
  { command: 'help', description: 'Show this list of commands.' },
  { command: 'help <substring>', description: 'Show only commands matching <substring>.' },
  { command: 'clear', description: 'Clear the terminal output.' },
  { command: 'history', description: 'List previously entered commands this session.' },
];

const normalizeKey = (tokens: string[]): { key: string; argsStart: number } | null => {
  if (tokens.length === 0) return null;
  const first = tokens[0].toLowerCase();
  if ((WALLET_PREFIXES as readonly string[]).includes(first)) {
    if (tokens.length < 2) return null;
    return { key: `wallet ${tokens[1]}`, argsStart: 2 };
  }
  if ((RPC_PREFIXES as readonly string[]).includes(first)) {
    if (tokens.length < 2) return null;
    return { key: `rpc ${tokens[1]}`, argsStart: 2 };
  }
  if ((MINER_PREFIXES as readonly string[]).includes(first)) {
    if (tokens.length < 2) return null;
    return { key: `miner ${tokens[1]}`, argsStart: 2 };
  }
  return null;
};

export function isBuiltin(input: string): 'help' | 'clear' | 'history' | null {
  // Only the bare 'help' is a built-in shortcut so Terminal.tsx renders
  // the full help text directly. 'help <substring>' falls through to
  // runCommand() which renders a filtered listing.
  const t = input.trim().toLowerCase();
  if (t === 'help') return 'help';
  if (t === 'clear') return 'clear';
  if (t === 'history') return 'history';
  return null;
}

const CATEGORY_ORDER = [
  'Wallet — Keys & Balances',
  'Wallet — Chain Queries',
  'Wallet — Transactions',
  'Offers',
  'Feeds',
  'Agreements — Templates & Creation',
  'Agreements — Core',
  'Agreements — Spend & Status',
  'Agreements — Signatures & Bundles',
  'Agreements — Share Packages',
  'OTC Shortcuts',
  'Settlement Templates',
  'Proofs',
  'Policies',
  'Reputation',
  'Trade Status',
  'Attestors',
  'Disputes & Resolvers',
  'Invoices',
  'Multisig',
  'iriumd — Node Status',
  'iriumd — Chain & Mempool',
  'iriumd — Explorer',
  'iriumd — HTLC',
  'iriumd — Settlement RPC',
  'iriumd — Mining',
  'iriumd — Diagnostics & Updates',
  'iriumd — Raw HTTP',
  'Miner — Solo Stratum',
];

export function buildHelpText(filter?: string): string {
  const lines: string[] = [];
  const f = filter?.trim().toLowerCase();

  const byCategory = new Map<string, Handler[]>();
  for (const handler of Object.values(REGISTRY)) {
    if (f && !handler.usage.toLowerCase().includes(f) && !handler.description.toLowerCase().includes(f)) {
      continue;
    }
    const list = byCategory.get(handler.category) ?? [];
    list.push(handler);
    byCategory.set(handler.category, list);
  }

  if (f) {
    lines.push(`Commands matching "${f}":`);
  } else {
    lines.push('Allowed commands. Quote any value containing spaces, e.g. "with spaces".');
  }
  lines.push('');

  let printedAny = false;
  for (const category of CATEGORY_ORDER) {
    const list = byCategory.get(category);
    if (!list || list.length === 0) continue;
    printedAny = true;
    lines.push(`# ${category}`);
    for (const h of list) {
      lines.push(`  ${h.usage.padEnd(82)}  ${h.description}`);
    }
    lines.push('');
  }
  if (!printedAny) {
    lines.push('(no commands matched the filter)');
    lines.push('');
  }

  lines.push('# Built-in');
  for (const b of BUILTIN_HELP) {
    lines.push(`  ${b.command.padEnd(82)}  ${b.description}`);
  }
  lines.push('');
  lines.push('Notes:');
  lines.push('  - "irium-wallet" aliases "wallet"; "iriumd"/"node" alias "rpc"; "irium-miner" aliases "miner".');
  lines.push('  - Amounts in IRM are decimal (e.g. 1.5) and converted to satoshis internally.');
  lines.push('  - Use "-" to skip an optional positional argument so later args stay aligned.');
  lines.push('  - Quote arguments with double quotes when they contain spaces.');
  lines.push('  - Passthrough commands forward raw irium-wallet CLI flags — see docs/WALLET-CLI.md.');
  lines.push('  - "rpc get/post" reach any endpoint in docs/API.md not already aliased above.');
  lines.push('  - Use up/down arrows to navigate previously entered commands.');
  return lines.join('\n');
}

export async function runCommand(input: string): Promise<CommandResult> {
  const trimmed = input.trim();
  if (!trimmed) {
    return { kind: 'text', text: '' };
  }
  const lower = trimmed.toLowerCase();
  if (lower === 'help') {
    return { kind: 'text', text: buildHelpText() };
  }
  if (lower.startsWith('help ')) {
    const filter = trimmed.slice(5).trim();
    return { kind: 'text', text: buildHelpText(filter) };
  }
  if (lower === 'clear' || lower === 'history') {
    return { kind: 'text', text: '' };
  }

  const tokens = tokenize(trimmed);
  const normalized = normalizeKey(tokens);
  if (!normalized) {
    return {
      kind: 'err',
      message: `unknown command: ${tokens[0]}. type 'help' to see allowed commands.`,
    };
  }

  const handler = REGISTRY[normalized.key];
  if (!handler) {
    return {
      kind: 'err',
      message: `command not in whitelist: ${normalized.key}. type 'help' to see allowed commands.`,
    };
  }

  const args = tokens.slice(normalized.argsStart);
  if (args.length < handler.minArgs || args.length > handler.maxArgs) {
    return {
      kind: 'err',
      message: `usage: ${handler.usage}`,
    };
  }

  try {
    const data = await handler.run(args);
    return { kind: 'ok', data };
  } catch (e) {
    return { kind: 'err', message: e instanceof Error ? e.message : String(e) };
  }
}
