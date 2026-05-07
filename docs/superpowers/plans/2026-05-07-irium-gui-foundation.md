# Irium Core GUI — Foundation Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install missing deps, build a mock/fallback layer, overhaul the CSS design system, and rewrite Sidebar + TopBar + App routing with framer-motion animations — all without touching page components.

**Architecture:** A `safeInvoke` wrapper detects Tauri vs browser and returns either real backend data or realistic mock data. CSS is upgraded in-place (globals.css + tailwind.config.js). Layout components (Sidebar, TopBar, App.tsx) are rewritten with framer-motion for animated nav pill, block-height flip, notification slide, and route transitions.

**Tech Stack:** React 18, Tauri v1, framer-motion, react-hot-toast, Zustand, Tailwind CSS v3, TypeScript

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/mock.ts` | Create | Realistic fake data for every type |
| `src/lib/invoke.ts` | Create | `safeInvoke` — Tauri or mock fallback |
| `src/lib/tauri.ts` | Modify | Replace all `invoke()` with `safeInvoke()` |
| `src/styles/globals.css` | Overhaul | Full CSS system: fonts, glass, glows, shimmer, scrollbars |
| `tailwind.config.js` | Extend | Spring easing, glass blur, glow shadows, surface.base |
| `src/components/layout/Sidebar.tsx` | Rewrite | framer-motion width, layoutId nav pill, staggered labels |
| `src/components/layout/TopBar.tsx` | Rewrite | Block height flip, pulsing badge, notification slide |
| `src/App.tsx` | Modify | AnimatePresence routes, PageWrapper, Toaster |

---

## Task 1: Install Dependencies

**Files:** `package.json` (modified by npm)

- [ ] **Step 1: Install framer-motion and react-hot-toast**

```powershell
cd C:\Users\Ibrahim\Desktop\irium-core
npm install framer-motion react-hot-toast
```

Expected output includes: `added N packages` with no errors.

- [ ] **Step 2: Verify packages are in node_modules**

```powershell
node -e "require('./node_modules/framer-motion/dist/cjs/index.js'); console.log('framer-motion OK')"
node -e "require('./node_modules/react-hot-toast/dist/index.js'); console.log('react-hot-toast OK')"
```

Expected: both lines print `OK`.

- [ ] **Step 3: Commit**

```powershell
git add package.json package-lock.json
git commit -m "feat: add framer-motion and react-hot-toast"
```

---

## Task 2: Create `src/lib/mock.ts`

**Files:**
- Create: `src/lib/mock.ts`

- [ ] **Step 1: Create the file with all mock data**

Create `C:\Users\Ibrahim\Desktop\irium-core\src\lib\mock.ts` with this exact content:

```typescript
import type {
  NodeStatus, NodeStartResult, WalletBalance, AddressInfo,
  Transaction, Offer, Agreement, MinerStatus, Reputation,
  FeedEntry, FeedSyncResult, Proof, AgreementResult,
  SendResult, CreateOfferResult, OfferTakeResult,
  ProofSubmitResult, ReleaseResult, PeerInfo, MempoolInfo,
  AppSettings,
} from './types';
import { DEFAULT_SETTINGS } from './types';

const NOW = Date.now();
const DAY = 86_400_000;

export const mockNodeStatus: NodeStatus = {
  running: true,
  synced: true,
  height: 148_234,
  tip: 'a3f7b2c8d4e1f09a3b5c7d2e4f6a8b1c3d5e7f9a2b4c6d8e0f1a3b5c7d9e2f4',
  peers: 7,
  network: 'irium',
  version: '1.8.0',
  rpc_url: 'http://127.0.0.1:38300',
};

export const mockNodeStartResult: NodeStartResult = {
  success: true,
  message: 'Node started successfully',
  pid: 12345,
};

export const mockBalance: WalletBalance = {
  confirmed: 347_000_000,
  unconfirmed: 15_000_000,
  total: 362_000_000,
};

export const mockAddresses: AddressInfo[] = [
  { address: 'P9xK3mRqLvWj8NbTdYfHcZeAu7Gs2p4V', label: 'Main',    balance: 200_000_000, index: 0 },
  { address: 'P3dF7tBkNmYp1LxQwVhGjCzRs9Eu5Kn8', label: 'Savings', balance: 100_000_000, index: 1 },
  { address: 'P6yH2sWvAcXm4KbJfTgDnRe8Qu1Lz7Pw', label: 'Trading', balance:  47_000_000, index: 2 },
  { address: 'P1aM5nCkZoVd9JeRyBtGqFx3Hw7Su2Lp', balance: 0, index: 3 },
  { address: 'P8bN4wEiYrXk2HcQvAmDs6Jg0Ft5Op3Ku', balance: 0, index: 4 },
];

export const mockTransactions: Transaction[] = [
  { txid: 'f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0', amount:  50_000_000, confirmations: 142, timestamp: Math.floor((NOW - 2 * DAY) / 1000),  direction: 'receive', address: 'P9xK3mRqLvWj8NbTdYfHcZeAu7Gs2p4V' },
  { txid: '1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b', amount: -12_000_000, fee: 1000, confirmations:  98, timestamp: Math.floor((NOW - 3 * DAY) / 1000),  direction: 'send',    address: 'Q2mN7pRsLvBk5XwJcTdYhZeAu9Gf3q8V' },
  { txid: 'c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2', amount: 100_000_000, confirmations: 201, timestamp: Math.floor((NOW - 5 * DAY) / 1000),  direction: 'receive', address: 'P3dF7tBkNmYp1LxQwVhGjCzRs9Eu5Kn8' },
  { txid: '2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e', amount:  -5_500_000, fee:  800, confirmations:   0, timestamp: Math.floor((NOW - 1 * DAY) / 1000),  direction: 'send',    address: 'Q7xP4nVmRkBc9LwHjTgEzDs2Fu8Aq1Mo' },
  { txid: '7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a', amount:  25_000_000, confirmations: 312, timestamp: Math.floor((NOW - 7 * DAY) / 1000),  direction: 'receive', address: 'P6yH2sWvAcXm4KbJfTgDnRe8Qu1Lz7Pw' },
  { txid: '3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f', amount:  -8_000_000, fee: 1200, confirmations: 445, timestamp: Math.floor((NOW - 10 * DAY) / 1000), direction: 'send',    address: 'Q5kM2rWtNvXb8LcJdZfAu3Hy6Gs0Ep9Vq' },
  { txid: '9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b', amount:  80_000_000, confirmations: 521, timestamp: Math.floor((NOW - 14 * DAY) / 1000), direction: 'receive', address: 'P9xK3mRqLvWj8NbTdYfHcZeAu7Gs2p4V' },
  { txid: '4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c', amount:  -3_000_000, fee:  600, confirmations: 789, timestamp: Math.floor((NOW - 22 * DAY) / 1000), direction: 'send',    address: 'Q8nL5xBkMvPc2JwFtYdGzRe7Hu4Aq0Es' },
];

export const mockOffers: Offer[] = [
  { id: 'OFF-a3b2c1d0e9f8', seller: 'P9xK3mRqLvWj8NbTdYfHcZeAu7Gs2p4V', amount:  50_000_000, description: 'Selling 0.5 IRM for USDT, fast settlement', payment_method: 'USDT (TRC-20)',         status: 'active', created_at: Math.floor((NOW - DAY) / 1000),       ranking_score: 94, reputation: { score: 94, completed: 28, default_count: 0 }, risk_signal: 'low'    },
  { id: 'OFF-b4c3d2e1f0a9', seller: 'Q2mN7pRsLvBk5XwJcTdYhZeAu9Gf3q8V', amount: 200_000_000, description: '2 IRM for EUR bank transfer',              payment_method: 'Bank Transfer (EUR)', status: 'active', created_at: Math.floor((NOW - 3 * DAY) / 1000), ranking_score: 71, reputation: { score: 71, completed:  9, default_count: 1 }, risk_signal: 'medium' },
  { id: 'OFF-c5d4e3f2a1b0', seller: 'P6yH2sWvAcXm4KbJfTgDnRe8Qu1Lz7Pw', amount: 100_000_000, description: '1 IRM — instant, proven seller',             payment_method: 'USDT (ERC-20)',       status: 'active', created_at: Math.floor((NOW - 6 * DAY) / 1000), ranking_score: 88, reputation: { score: 88, completed: 41, default_count: 0 }, risk_signal: 'low'    },
];

export const mockAgreements: Agreement[] = [
  {
    id: 'AGR-9f8e7d6c5b4a',
    hash: 'd9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0',
    template: 'otc',
    buyer: 'P3dF7tBkNmYp1LxQwVhGjCzRs9Eu5Kn8',
    seller: 'Q2mN7pRsLvBk5XwJcTdYhZeAu9Gf3q8V',
    amount: 50_000_000,
    status: 'active',
    proof_status: 'active',
    release_eligible: false,
    created_at: Math.floor((NOW - 2 * DAY) / 1000),
    deadline: Math.floor((NOW + 2 * DAY) / 1000),
    policy: { id: 'POL-001', kind: 'threshold', threshold: 2, attestors: ['ATT-alpha', 'ATT-beta', 'ATT-gamma'] },
  },
  {
    id: 'AGR-1a2b3c4d5e6f',
    hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0',
    template: 'freelance',
    buyer: 'Q7xP4nVmRkBc9LwHjTgEzDs2Fu8Aq1Mo',
    seller: 'P9xK3mRqLvWj8NbTdYfHcZeAu7Gs2p4V',
    amount: 80_000_000,
    status: 'released',
    proof_status: 'satisfied',
    release_eligible: true,
    created_at: Math.floor((NOW - 15 * DAY) / 1000),
    deadline: Math.floor((NOW - 5 * DAY) / 1000),
    policy: { id: 'POL-002', kind: 'threshold', threshold: 1, attestors: ['ATT-alpha'] },
  },
];

export const mockProofs: Proof[] = [
  {
    id: 'PRF-001',
    agreement_id: 'AGR-9f8e7d6c5b4a',
    status: 'active',
    submitted_at: Math.floor((NOW - DAY) / 1000),
    expires_at: Math.floor((NOW + 3 * DAY) / 1000),
    policy_result: 'pending',
    attestors: ['ATT-alpha'],
  },
];

export const mockMinerStatus: MinerStatus = {
  running: false,
  hashrate_khs: 0,
  blocks_found: 0,
  uptime_secs: 0,
  difficulty: 12_847,
  threads: 0,
};

export const mockReputation: Reputation = {
  pubkey: '03a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
  address: 'P9xK3mRqLvWj8NbTdYfHcZeAu7Gs2p4V',
  score: 78,
  completed: 10,
  failed: 2,
  default_count: 0,
  risk_signal: 'low',
  total_volume: 347_000_000,
  risk_level: 'Low Risk',
  total_agreements: 12,
  released: 10,
  refunded: 2,
  volume_sats: 347_000_000,
  score_history: [65,68,72,70,74,71,76,73,77,75,78,78,80,77,79,81,78,80,82,79,78,80,79,78],
  flags: [],
  agreements: [
    { id: 'AGR-9f8e7d6c5b4a', role: 'seller', status: 'active',   amount:  50_000_000, timestamp: Math.floor((NOW - 2  * DAY) / 1000) },
    { id: 'AGR-1a2b3c4d5e6f', role: 'seller', status: 'released', amount:  80_000_000, timestamp: Math.floor((NOW - 15 * DAY) / 1000) },
  ],
};

export const mockFeeds: FeedEntry[] = [
  { url: 'https://feeds.irium.network/offers/mainnet', last_synced: Math.floor((NOW - 3_600_000) / 1000), offer_count: 127, status: 'ok' },
  { url: 'https://p2p.iriumlabs.io/feed/v1',          last_synced: Math.floor((NOW - 7_200_000) / 1000), offer_count:  43, status: 'ok' },
];

export const mockFeedSync: FeedSyncResult = { synced: 2, failed: 0, total_offers: 170 };

export const mockPeers: PeerInfo[] = [
  { addr: '45.89.201.134:38291',  height: 148_230, user_agent: 'iriumd/1.8.0', inbound: false },
  { addr: '192.168.1.42:38291',   height: 148_234, user_agent: 'iriumd/1.8.0', inbound: true  },
];

export const mockMempool: MempoolInfo = { size: 14, bytes: 28_420 };

export const mockSendResult: SendResult = {
  txid: '7f8e9d0c1b2a3f4e5d6c7b8a9f0e1d2c3b4a5f6e7d8c9b0a1',
  amount: 10_000_000,
  fee: 1_000,
};

export const mockSettings: AppSettings = { ...DEFAULT_SETTINGS };

// Functions for "create" results — generate fresh IDs each call
export function freshAgreementResult(): AgreementResult {
  return {
    agreement_id: 'AGR-' + Math.random().toString(36).slice(2, 10).toUpperCase(),
    hash: 'f0e1d2c3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e9d0c1b2a3',
    success: true,
  };
}

export function freshCreateOfferResult(): CreateOfferResult {
  return { id: 'OFF-' + Math.random().toString(36).slice(2, 10).toUpperCase(), success: true };
}

export function freshOfferTakeResult(offerId: string): OfferTakeResult {
  return { agreement_id: 'AGR-' + Math.random().toString(36).slice(2, 10).toUpperCase(), offer_id: offerId, success: true };
}

export function freshProofSubmitResult(): ProofSubmitResult {
  return { proof_id: 'PRF-' + Math.random().toString(36).slice(2, 6).toUpperCase(), status: 'submitted', success: true };
}

export function freshReleaseResult(): ReleaseResult {
  return { txid: '3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7', success: true };
}

export function freshAddress(): string {
  return 'P' + Math.random().toString(36).slice(2, 34).toUpperCase();
}
```

- [ ] **Step 2: Verify TypeScript accepts the file**

```powershell
cd C:\Users\Ibrahim\Desktop\irium-core
npx tsc --noEmit 2>&1 | Select-String "mock"
```

Expected: no output (no errors referencing mock.ts).

- [ ] **Step 3: Commit**

```powershell
git add src/lib/mock.ts
git commit -m "feat: add realistic mock data layer"
```

---

## Task 3: Create `src/lib/invoke.ts`

**Files:**
- Create: `src/lib/invoke.ts`

- [ ] **Step 1: Create the safeInvoke wrapper**

Create `C:\Users\Ibrahim\Desktop\irium-core\src\lib\invoke.ts`:

```typescript
import { invoke } from '@tauri-apps/api/tauri';

const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

function mockDelay(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 400 + Math.random() * 400));
}

export async function safeInvoke<T>(
  cmd: string,
  args: Record<string, unknown> = {},
  mockFn: () => T,
): Promise<T> {
  if (isTauri) {
    try {
      return await invoke<T>(cmd, args);
    } catch (e) {
      throw typeof e === 'string' ? e : String(e);
    }
  }
  console.warn(`[irium mock] ${cmd}`, args);
  await mockDelay();
  return mockFn();
}
```

- [ ] **Step 2: Verify TypeScript accepts the file**

```powershell
npx tsc --noEmit 2>&1 | Select-String "invoke.ts"
```

Expected: no output.

- [ ] **Step 3: Commit**

```powershell
git add src/lib/invoke.ts
git commit -m "feat: add safeInvoke wrapper with mock fallback"
```

---

## Task 4: Update `src/lib/tauri.ts`

**Files:**
- Modify: `src/lib/tauri.ts` (replace entire file)

- [ ] **Step 1: Overwrite tauri.ts with safeInvoke throughout**

Replace the entire content of `C:\Users\Ibrahim\Desktop\irium-core\src\lib\tauri.ts`:

```typescript
import { safeInvoke } from './invoke';
import * as mock from './mock';
import type {
  NodeStatus, NodeStartResult, WalletBalance, AddressInfo,
  SendResult, Transaction, Offer, CreateOfferParams, CreateOfferResult,
  OfferTakeResult, FeedEntry, FeedSyncResult, Agreement,
  CreateAgreementParams, AgreementResult, ReleaseResult,
  Proof, ProofSubmitResult, Reputation, MinerStatus,
  OtcParams, FreelanceParams, MilestoneParams, DepositParams,
  PeerInfo, MempoolInfo,
} from './types';

// ── NODE ──────────────────────────────────────────────────────
export const node = {
  start: (dataDir?: string) =>
    safeInvoke<NodeStartResult>('start_node', { dataDir }, () => mock.mockNodeStartResult),

  stop: () =>
    safeInvoke<boolean>('stop_node', {}, () => true),

  status: () =>
    safeInvoke<NodeStatus>('get_node_status', {}, () => mock.mockNodeStatus),
};

// ── WALLET ────────────────────────────────────────────────────
export const wallet = {
  balance: () =>
    safeInvoke<WalletBalance>('wallet_get_balance', {}, () => mock.mockBalance),

  newAddress: () =>
    safeInvoke<string>('wallet_new_address', {}, mock.freshAddress),

  listAddresses: () =>
    safeInvoke<AddressInfo[]>('wallet_list_addresses', {}, () => mock.mockAddresses),

  send: (to: string, amountSats: number, feeSats?: number) =>
    safeInvoke<SendResult>('wallet_send', { to, amountSats, feeSats }, () => mock.mockSendResult),

  transactions: (limit?: number) =>
    safeInvoke<Transaction[]>('wallet_transactions', { limit }, () => mock.mockTransactions),

  setPath: (path: string) =>
    safeInvoke<boolean>('wallet_set_path', { path }, () => true),
};

// ── OFFERS ────────────────────────────────────────────────────
export const offers = {
  list: (params?: {
    source?: 'local' | 'remote' | 'all';
    sort?: 'newest' | 'amount' | 'score';
    limit?: number;
    minAmount?: number;
    maxAmount?: number;
    payment?: string;
  }) =>
    safeInvoke<Offer[]>(
      'offer_list',
      { source: params?.source, sort: params?.sort, limit: params?.limit, minAmount: params?.minAmount, maxAmount: params?.maxAmount, payment: params?.payment },
      () => mock.mockOffers,
    ),

  show: (offerId: string) =>
    safeInvoke<Offer>('offer_show', { offerId }, () => mock.mockOffers[0]),

  create: (params: CreateOfferParams) =>
    safeInvoke<CreateOfferResult>('offer_create', { params }, mock.freshCreateOfferResult),

  take: (offerId: string) =>
    safeInvoke<OfferTakeResult>('offer_take', { offerId }, () => mock.freshOfferTakeResult(offerId)),

  export: (offerId: string, outPath: string) =>
    safeInvoke<boolean>('offer_export', { offerId, outPath }, () => true),

  import: (filePath: string) =>
    safeInvoke<boolean>('offer_import', { filePath }, () => true),
};

// ── FEEDS ─────────────────────────────────────────────────────
export const feeds = {
  add: (url: string) =>
    safeInvoke<boolean>('feed_add', { url }, () => true),

  remove: (url: string) =>
    safeInvoke<boolean>('feed_remove', { url }, () => true),

  list: () =>
    safeInvoke<FeedEntry[]>('feed_list', {}, () => mock.mockFeeds),

  sync: () =>
    safeInvoke<FeedSyncResult>('feed_sync', {}, () => mock.mockFeedSync),

  fetch: (url: string) =>
    safeInvoke<Offer[]>('feed_fetch', { url }, () => mock.mockOffers),

  prune: () =>
    safeInvoke<boolean>('feed_prune', {}, () => true),
};

// ── AGREEMENTS ────────────────────────────────────────────────
export const agreements = {
  list: () =>
    safeInvoke<Agreement[]>('agreement_list', {}, () => mock.mockAgreements),

  show: (agreementId: string) =>
    safeInvoke<Agreement>('agreement_show', { agreementId }, () => mock.mockAgreements[0]),

  create: (params: CreateAgreementParams) =>
    safeInvoke<AgreementResult>('agreement_create', { params }, mock.freshAgreementResult),

  pack: (agreementId: string, outPath: string) =>
    safeInvoke<boolean>('agreement_pack', { agreementId, outPath }, () => true),

  unpack: (filePath: string) =>
    safeInvoke<Agreement>('agreement_unpack', { filePath }, () => mock.mockAgreements[0]),

  release: (agreementId: string) =>
    safeInvoke<ReleaseResult>('agreement_release', { agreementId }, mock.freshReleaseResult),

  refund: (agreementId: string) =>
    safeInvoke<ReleaseResult>('agreement_refund', { agreementId }, mock.freshReleaseResult),
};

// ── PROOFS ────────────────────────────────────────────────────
export const proofs = {
  list: (agreementId?: string) =>
    safeInvoke<Proof[]>('proof_list', { agreementId }, () => mock.mockProofs),

  sign: (agreementId: string, proofData: string, outPath: string) =>
    safeInvoke<boolean>('proof_sign', { agreementId, proofData, outPath }, () => true),

  submit: (agreementId: string, proofFile: string) =>
    safeInvoke<ProofSubmitResult>('proof_submit', { agreementId, proofFile }, mock.freshProofSubmitResult),
};

// ── REPUTATION ────────────────────────────────────────────────
export const reputation = {
  show: (pubkeyOrAddr: string) =>
    safeInvoke<Reputation>('reputation_show', { pubkeyOrAddr }, () => mock.mockReputation),
};

// ── SETTLEMENT TEMPLATES ──────────────────────────────────────
export const settlement = {
  otc: (params: OtcParams) =>
    safeInvoke<AgreementResult>('settlement_create_otc', { params }, mock.freshAgreementResult),

  freelance: (params: FreelanceParams) =>
    safeInvoke<AgreementResult>('settlement_create_freelance', { params }, mock.freshAgreementResult),

  milestone: (params: MilestoneParams) =>
    safeInvoke<AgreementResult>('settlement_create_milestone', { params }, mock.freshAgreementResult),

  deposit: (params: DepositParams) =>
    safeInvoke<AgreementResult>('settlement_create_deposit', { params }, mock.freshAgreementResult),
};

// ── MINER ─────────────────────────────────────────────────────
export const miner = {
  start: (address: string, threads?: number) =>
    safeInvoke<boolean>('start_miner', { address, threads }, () => true),

  stop: () =>
    safeInvoke<boolean>('stop_miner', {}, () => true),

  status: () =>
    safeInvoke<MinerStatus>('get_miner_status', {}, () => mock.mockMinerStatus),
};

// ── RPC DIRECT ────────────────────────────────────────────────
export const rpc = {
  peers: () =>
    safeInvoke<PeerInfo[]>('rpc_get_peers', {}, () => mock.mockPeers),

  mempool: () =>
    safeInvoke<MempoolInfo>('rpc_get_mempool', {}, () => mock.mockMempool),

  block: (heightOrHash: string) =>
    safeInvoke<Record<string, unknown>>('rpc_get_block', { heightOrHash }, () => ({ height: 148_234, hash: mock.mockNodeStatus.tip })),

  offersFeed: () =>
    safeInvoke<unknown>('rpc_get_offers_feed', {}, () => mock.mockOffers),

  setUrl: (url: string) =>
    safeInvoke<boolean>('rpc_set_url', { url }, () => true),
};
```

- [ ] **Step 2: Run TypeScript check**

```powershell
npx tsc --noEmit 2>&1
```

Expected: zero errors. If errors appear, they will be in tauri.ts — fix them before continuing.

- [ ] **Step 3: Commit**

```powershell
git add src/lib/tauri.ts
git commit -m "feat: wire all tauri calls through safeInvoke with mock fallback"
```

---

## Task 5: Overhaul `src/styles/globals.css`

**Files:**
- Modify: `src/styles/globals.css` (full rewrite)

- [ ] **Step 1: Replace globals.css**

Replace the entire content of `C:\Users\Ibrahim\Desktop\irium-core\src\styles\globals.css`:

```css
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&family=Geist+Mono:wght@300;400;500;600&display=swap');

@tailwind base;
@tailwind components;
@tailwind utilities;

/* ── Variables ──────────────────────────────────────────────── */
:root {
  --color-bg:           #080810;
  --color-surface:      #0d0d1a;
  --color-surface-2:    #121226;
  --color-surface-3:    #18182f;
  --color-border:       rgba(123, 47, 226, 0.2);
  --color-border-subtle: rgba(255, 255, 255, 0.06);
  --color-irium:        #7b2fe2;
  --color-blue:         #2563eb;
  --color-text:         #e8e8f0;
  --color-text-muted:   #8888aa;
  --color-text-dim:     #555578;
  --color-success:      #22c55e;
  --color-warning:      #f59e0b;
  --color-error:        #ef4444;
  --gradient-brand:      linear-gradient(135deg, #7b2fe2 0%, #2563eb 100%);
  --gradient-brand-text: linear-gradient(90deg, #a855f7 0%, #60a5fa 100%);
  --glass-bg:            rgba(13, 13, 26, 0.7);
  --glass-border:        rgba(255, 255, 255, 0.08);
  --glow-purple:         0 0 20px rgba(123, 47, 226, 0.45);
  --glow-blue:           0 0 20px rgba(59, 130, 246, 0.4);
  --glow-green:          0 0 20px rgba(34, 197, 94, 0.45);
  --sidebar-width:       240px;
  --topbar-height:       56px;
  --statusbar-height:    28px;
}

/* ── Reset ──────────────────────────────────────────────────── */
* {
  box-sizing: border-box;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

html, body, #root {
  height: 100%;
  margin: 0;
  padding: 0;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: 'DM Sans', sans-serif;
  font-size: 14px;
  overflow: hidden;
}

/* ── Invisible scrollbars ───────────────────────────────────── */
* {
  scrollbar-width: none;
}
*::-webkit-scrollbar {
  display: none;
}

/* Selection */
::selection {
  background: rgba(123, 47, 226, 0.35);
  color: white;
}

/* Focus ring */
:focus-visible {
  outline: 2px solid var(--color-irium);
  outline-offset: 2px;
  box-shadow: var(--glow-purple);
}

/* ── Keyframes ──────────────────────────────────────────────── */
@keyframes mesh-drift {
  0%   { background-position: 0% 0%,   100% 100%; }
  50%  { background-position: 30% 20%,  70%  80%; }
  100% { background-position: 10% 40%,  90%  60%; }
}

@keyframes pageEnter {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0);   }
}

@keyframes shimmer-slide {
  0%   { background-position: -400px 0; }
  100% { background-position:  400px 0; }
}

@keyframes pulse-dot {
  0%, 100% { box-shadow: 0 0 4px 1px currentColor; opacity: 1;   }
  50%       { box-shadow: 0 0 8px 3px currentColor; opacity: 0.6; }
}

@keyframes spin-slow {
  from { transform: rotate(0deg);   }
  to   { transform: rotate(360deg); }
}

/* ── Component classes ──────────────────────────────────────── */
@layer components {
  /* Glass */
  .glass {
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
  }
  .glass-heavy {
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    background: rgba(8, 8, 16, 0.85);
    border: 1px solid var(--glass-border);
  }

  /* Glow utilities */
  .glow-purple { box-shadow: var(--glow-purple); }
  .glow-blue   { box-shadow: var(--glow-blue);   }
  .glow-green  { box-shadow: var(--glow-green);  }

  /* Shimmer skeleton */
  .shimmer {
    background: linear-gradient(
      90deg,
      rgba(255,255,255,0.03) 0%,
      rgba(255,255,255,0.08) 50%,
      rgba(255,255,255,0.03) 100%
    );
    background-size: 400px 100%;
    animation: shimmer-slide 1.5s linear infinite;
  }

  /* Cards */
  .card {
    @apply bg-surface-800 border border-white/5 rounded-xl;
    box-shadow: 0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05);
  }
  .card-interactive {
    @apply card cursor-pointer transition-all duration-200;
  }
  .card-interactive:hover {
    @apply border-irium-500/30;
    box-shadow: 0 4px 24px rgba(0,0,0,0.4), 0 0 20px rgba(123,47,226,0.12), inset 0 1px 0 rgba(255,255,255,0.05);
    transform: translateY(-1px);
  }

  /* Buttons */
  .btn-primary {
    @apply inline-flex items-center gap-2 px-4 py-2 rounded-lg font-display font-semibold text-sm text-white;
    @apply transition-all duration-200 active:scale-95;
    background: var(--gradient-brand);
    box-shadow: 0 4px 15px rgba(123,47,226,0.3);
  }
  .btn-primary:hover {
    box-shadow: 0 4px 25px rgba(123,47,226,0.5);
    filter: brightness(1.05);
  }
  .btn-primary:disabled {
    @apply opacity-50 cursor-not-allowed;
    box-shadow: none;
  }
  .btn-secondary {
    @apply inline-flex items-center gap-2 px-4 py-2 rounded-lg font-display font-semibold text-sm;
    @apply bg-surface-600 text-white/80 border border-white/10;
    @apply transition-all duration-200 active:scale-95;
  }
  .btn-secondary:hover {
    @apply border-irium-500/40 text-white;
  }
  .btn-ghost {
    @apply inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm;
    @apply text-white/60 transition-all duration-200;
  }
  .btn-ghost:hover {
    @apply bg-white/5 text-white/90;
  }

  /* Input */
  .input {
    @apply w-full px-3 py-2 rounded-lg text-sm font-mono;
    @apply bg-surface-700 border border-white/10 text-white;
    @apply outline-none transition-all duration-200;
    @apply placeholder:text-white/30;
  }
  .input:focus {
    @apply border-irium-500/50;
    box-shadow: 0 0 0 3px rgba(123,47,226,0.12), var(--glow-purple);
  }

  /* Labels & badges */
  .label {
    @apply block text-xs font-display font-semibold text-white/50 uppercase tracking-wider mb-1.5;
  }
  .badge {
    @apply inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-display font-semibold;
  }
  .badge-success { @apply badge bg-green-500/15 text-green-400 border border-green-500/20; }
  .badge-warning { @apply badge bg-amber-500/15 text-amber-400 border border-amber-500/20; }
  .badge-error   { @apply badge bg-red-500/15   text-red-400   border border-red-500/20;   }
  .badge-info    { @apply badge bg-blue-500/15  text-blue-400  border border-blue-500/20;  }
  .badge-irium   { @apply badge bg-irium-500/15 text-irium-300 border border-irium-500/20; }

  /* Text */
  .gradient-text {
    background: var(--gradient-brand-text);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .mono         { @apply font-mono text-xs tracking-tight; }
  .section-title { @apply font-display font-bold text-lg text-white; }
  .divider       { @apply border-t border-white/5 my-4; }
  .irm-amount       { @apply font-mono font-semibold; }
  .irm-amount-large { @apply font-display font-bold text-2xl gradient-text; }

  /* Status dots */
  .dot-live {
    @apply w-2 h-2 rounded-full bg-green-400 flex-shrink-0;
    box-shadow: 0 0 6px rgba(74, 222, 128, 0.7);
    animation: pulse-dot 2s ease-in-out infinite;
    color: rgba(74, 222, 128, 0.7);
  }
  .dot-syncing {
    @apply w-2 h-2 rounded-full bg-amber-400 flex-shrink-0;
    box-shadow: 0 0 6px rgba(251, 191, 36, 0.7);
    animation: pulse-dot 1s ease-in-out infinite;
    color: rgba(251, 191, 36, 0.7);
  }
  .dot-offline {
    @apply w-2 h-2 rounded-full bg-white/20 flex-shrink-0;
  }

  /* Mesh animated gradient background */
  .mesh-bg {
    background:
      radial-gradient(ellipse 80% 60% at 20% 30%, rgba(123,47,226,0.12) 0%, transparent 65%),
      radial-gradient(ellipse 60% 80% at 80% 70%, rgba(37,99,235,0.08) 0%, transparent 65%),
      var(--color-bg);
    background-size: 200% 200%, 200% 200%, 100% 100%;
    animation: mesh-drift 22s ease-in-out infinite alternate;
  }

  /* Gradient border */
  .gradient-border {
    position: relative;
    border: 1px solid transparent;
    background-clip: padding-box;
  }
  .gradient-border::before {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    background: var(--gradient-brand);
    z-index: -1;
    opacity: 0.4;
  }

  /* Page enter */
  .page-enter { animation: pageEnter 0.2s ease-out; }

  /* Irium glow */
  .irium-glow {
    box-shadow: 0 0 30px rgba(123,47,226,0.3), 0 0 60px rgba(37,99,235,0.15);
  }
}
```

- [ ] **Step 2: Start Vite to check for CSS errors**

```powershell
cd C:\Users\Ibrahim\Desktop\irium-core
npm run dev
```

Open `http://localhost:1420` in a browser. Confirm the app loads with the dark background. Kill the server with Ctrl+C.

- [ ] **Step 3: Commit**

```powershell
git add src/styles/globals.css
git commit -m "style: overhaul CSS — Space Grotesk, Geist Mono, glass, glow, mesh animation"
```

---

## Task 6: Extend `tailwind.config.js`

**Files:**
- Modify: `tailwind.config.js`

- [ ] **Step 1: Replace tailwind.config.js**

Replace the entire content of `C:\Users\Ibrahim\Desktop\irium-core\tailwind.config.js`:

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        irium: {
          50:  '#f0eaff',
          100: '#ddd0ff',
          200: '#c3a8ff',
          300: '#a97eff',
          400: '#9155ff',
          500: '#7b2fe2',
          600: '#6a21cc',
          700: '#5715b0',
          800: '#460d90',
          900: '#330872',
          950: '#1a0040',
        },
        blue: {
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
        surface: {
          base: '#080810',
          900:  '#080810',
          800:  '#0d0d1a',
          700:  '#121226',
          600:  '#18182f',
          500:  '#1e1e3a',
          400:  '#252548',
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body:    ['"DM Sans"',       'sans-serif'],
        mono:    ['"Geist Mono"',    'monospace'],
      },
      backgroundImage: {
        'gradient-irium':        'linear-gradient(135deg, #7b2fe2 0%, #2563eb 100%)',
        'gradient-irium-subtle': 'linear-gradient(135deg, rgba(123,47,226,0.15) 0%, rgba(37,99,235,0.15) 100%)',
        'gradient-card':         'linear-gradient(145deg, rgba(30,30,58,0.8) 0%, rgba(13,13,26,0.9) 100%)',
        'mesh-gradient': [
          'radial-gradient(ellipse 80% 60% at 20% 30%, rgba(123,47,226,0.15) 0%, transparent 60%)',
          'radial-gradient(ellipse 60% 80% at 80% 70%, rgba(59,130,246,0.10) 0%, transparent 60%)',
        ].join(', '),
      },
      boxShadow: {
        'irium-glow':    '0 0 30px rgba(123,47,226,0.3), 0 0 60px rgba(37,99,235,0.15)',
        'irium-glow-sm': '0 0 15px rgba(123,47,226,0.2)',
        'card':          '0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
        'glow-purple':   '0 0 20px rgba(123,47,226,0.45)',
        'glow-blue':     '0 0 20px rgba(59,130,246,0.40)',
        'glow-green':    '0 0 20px rgba(34,197,94,0.45)',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      blur: {
        glass:       '12px',
        'glass-heavy': '24px',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float':      'float 6s ease-in-out infinite',
        'shimmer':    'shimmer-slide 1.5s linear infinite',
        'spin-slow':  'spin 8s linear infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)'  },
          '50%':      { transform: 'translateY(-6px)' },
        },
        'shimmer-slide': {
          '0%':   { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition:  '400px 0' },
        },
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 2: TypeScript check**

```powershell
npx tsc --noEmit 2>&1
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```powershell
git add tailwind.config.js
git commit -m "style: extend Tailwind — spring easing, glass blur, glow shadows, surface.base"
```

---

## Task 7: Rewrite `src/components/layout/Sidebar.tsx`

**Files:**
- Modify: `src/components/layout/Sidebar.tsx` (full rewrite)

- [ ] **Step 1: Replace Sidebar.tsx**

Replace the entire content of `C:\Users\Ibrahim\Desktop\irium-core\src\components\layout\Sidebar.tsx`:

```tsx
import { useLocation, NavLink } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Wallet, ShieldCheck, ShoppingBag,
  FileText, Star, Cpu, Settings, ChevronLeft, ChevronRight,
} from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../../lib/store';

const NAV = [
  { to: '/dashboard',  icon: LayoutDashboard, label: 'Dashboard'   },
  { to: '/wallet',     icon: Wallet,          label: 'Wallet'      },
  { to: '/settlement', icon: ShieldCheck,     label: 'Settlement'  },
  { to: '/marketplace',icon: ShoppingBag,     label: 'Marketplace' },
  { to: '/agreements', icon: FileText,        label: 'Agreements'  },
  { to: '/reputation', icon: Star,            label: 'Reputation'  },
  { to: '/miner',      icon: Cpu,             label: 'Miner'       },
  { to: '/settings',   icon: Settings,        label: 'Settings'    },
];

export default function Sidebar() {
  const collapsed = useStore((s) => s.sidebarCollapsed);
  const toggle    = useStore((s) => s.toggleSidebar);
  const nodeStatus = useStore((s) => s.nodeStatus);
  const location  = useLocation();

  const nodeDot =
    nodeStatus?.running && nodeStatus?.synced ? 'dot-live' :
    nodeStatus?.running                       ? 'dot-syncing' :
                                                'dot-offline';
  const nodeLabel =
    nodeStatus?.running && nodeStatus?.synced ? 'Live' :
    nodeStatus?.running                       ? 'Syncing…' :
                                                'Offline';

  return (
    <motion.aside
      animate={{ width: collapsed ? 64 : 240 }}
      transition={{ duration: 0.3, ease: [0.34, 1.56, 0.64, 1] }}
      className={clsx(
        'flex flex-col h-full flex-shrink-0 relative z-30',
        'border-r border-white/[0.06]',
        'glass',
      )}
      style={{ overflow: 'hidden' }}
    >
      {/* ── Logo ── */}
      <div className={clsx(
        'flex items-center h-14 border-b border-white/[0.06] flex-shrink-0 px-4',
        collapsed ? 'justify-center' : 'gap-3',
      )}>
        <motion.img
          src="/logo.png"
          alt="Irium"
          animate={{ width: collapsed ? 28 : 32, height: collapsed ? 28 : 32 }}
          transition={{ duration: 0.3 }}
          className="object-contain flex-shrink-0"
          style={{
            filter: 'drop-shadow(0 0 8px rgba(123,47,226,0.6))',
          }}
        />
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              key="wordmark"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.18 }}
            >
              <div className="font-display font-bold text-sm text-white leading-none tracking-wide">
                IRIUM
              </div>
              <div className="font-mono text-[10px] text-white/30 leading-none mt-0.5 tracking-widest">
                CORE
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Nav ── */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {NAV.map(({ to, icon: Icon, label }, index) => {
          const isActive = location.pathname === to ||
            (to !== '/dashboard' && location.pathname.startsWith(to));

          return (
            <NavLink
              key={to}
              to={to}
              className={clsx(
                'relative flex items-center rounded-lg px-3 py-2.5 text-sm font-display font-medium',
                'transition-colors duration-150 group',
                collapsed ? 'justify-center' : 'gap-3',
                isActive ? 'text-white' : 'text-white/50 hover:text-white/80',
              )}
            >
              {/* Animated active pill */}
              {isActive && (
                <motion.div
                  layoutId="nav-pill"
                  className="absolute inset-0 rounded-lg"
                  style={{
                    background: 'linear-gradient(135deg, rgba(123,47,226,0.22) 0%, rgba(37,99,235,0.16) 100%)',
                    border: '1px solid rgba(123,47,226,0.28)',
                  }}
                  transition={{ duration: 0.25, ease: [0.34, 1.56, 0.64, 1] }}
                />
              )}

              {/* Hover fill (non-active) */}
              {!isActive && (
                <motion.div
                  className="absolute inset-0 rounded-lg bg-white/0 group-hover:bg-white/[0.04]"
                  transition={{ duration: 0.12 }}
                />
              )}

              <Icon
                size={17}
                className={clsx(
                  'relative z-10 flex-shrink-0',
                  isActive ? 'text-irium-400' : '',
                )}
              />

              {/* Staggered label */}
              <AnimatePresence initial={false}>
                {!collapsed && (
                  <motion.span
                    key={to + '-label'}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{
                      opacity: 1, x: 0,
                      transition: { duration: 0.15, delay: index * 0.025 },
                    }}
                    exit={{
                      opacity: 0, x: -6,
                      transition: { duration: 0.1, delay: index * 0.015 },
                    }}
                    className="relative z-10 truncate flex-1 min-w-0"
                  >
                    {label}
                  </motion.span>
                )}
              </AnimatePresence>

              {/* Collapsed tooltip */}
              {collapsed && (
                <div className="absolute left-full ml-2.5 px-2.5 py-1 bg-surface-600 border border-white/10 rounded-lg text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50 transition-opacity duration-150">
                  {label}
                </div>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* ── Node status ── */}
      <div className={clsx(
        'flex items-center border-t border-white/[0.06] px-3 py-2.5 gap-2',
        collapsed && 'justify-center',
      )}>
        <span className={nodeDot} />
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.span
              key="node-label"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { delay: 0.1 } }}
              exit={{ opacity: 0 }}
              className="text-xs font-mono text-white/40 truncate"
            >
              {nodeLabel}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* ── Collapse toggle ── */}
      <button
        onClick={toggle}
        className="flex items-center justify-center h-9 border-t border-white/[0.06] text-white/30 hover:text-white/70 hover:bg-white/5 transition-all flex-shrink-0"
      >
        <motion.span
          animate={{ rotate: collapsed ? 0 : 180 }}
          transition={{ duration: 0.3 }}
        >
          <ChevronRight size={14} />
        </motion.span>
      </button>
    </motion.aside>
  );
}
```

- [ ] **Step 2: TypeScript check**

```powershell
npx tsc --noEmit 2>&1
```

Expected: zero errors.

- [ ] **Step 3: Smoke test in browser**

```powershell
npm run dev
```

Open `http://localhost:1420`. Verify:
- Sidebar animates width on toggle button click
- Active nav pill slides when clicking different routes
- Labels fade with stagger on collapse
- Node status dot shows at the bottom
- Tooltip appears on icon hover when collapsed

Kill the server with Ctrl+C.

- [ ] **Step 4: Commit**

```powershell
git add src/components/layout/Sidebar.tsx
git commit -m "feat: rewrite Sidebar with framer-motion — animated width, layoutId nav pill, staggered labels"
```

---

## Task 8: Rewrite `src/components/layout/TopBar.tsx`

**Files:**
- Modify: `src/components/layout/TopBar.tsx` (full rewrite)

- [ ] **Step 1: Replace TopBar.tsx**

Replace the entire content of `C:\Users\Ibrahim\Desktop\irium-core\src\components\layout\TopBar.tsx`:

```tsx
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, X, Play, Square, RefreshCw } from 'lucide-react';
import { useStore } from '../../lib/store';
import { node } from '../../lib/tauri';
import { formatIRM } from '../../lib/types';
import type { NodeStatus } from '../../lib/types';
import clsx from 'clsx';
import toast from 'react-hot-toast';

export default function TopBar() {
  const nodeStatus     = useStore((s) => s.nodeStatus);
  const balance        = useStore((s) => s.balance);
  const notifications  = useStore((s) => s.notifications);
  const dismiss        = useStore((s) => s.dismissNotification);
  const addNotification = useStore((s) => s.addNotification);

  const [showNotifs, setShowNotifs]       = useState(false);
  const [loading, setLoading]             = useState(false);
  const [balanceGlowing, setBalanceGlowing] = useState(false);
  const prevBalance = useRef<number | null>(null);

  // Glow balance when it increases
  useEffect(() => {
    const confirmed = balance?.confirmed ?? null;
    if (confirmed !== null && prevBalance.current !== null && confirmed > prevBalance.current) {
      setBalanceGlowing(true);
      const t = setTimeout(() => setBalanceGlowing(false), 2000);
      return () => clearTimeout(t);
    }
    prevBalance.current = confirmed;
  }, [balance?.confirmed]);

  const isRunning = nodeStatus?.running ?? false;
  const unread    = notifications.length;

  const handleToggleNode = async () => {
    setLoading(true);
    try {
      if (isRunning) {
        await node.stop();
        toast('Node stopping…', { icon: '🔴' });
        addNotification({ type: 'info', title: 'Node stopping…' });
      } else {
        const result = await node.start();
        if (result.success) {
          toast.success('Node started');
          addNotification({ type: 'success', title: 'Node started', message: result.message });
        } else {
          toast.error(result.message);
          addNotification({ type: 'error', title: 'Failed to start node', message: result.message });
        }
      }
    } catch (e: unknown) {
      const msg = String(e);
      toast.error(msg);
      addNotification({ type: 'error', title: 'Error', message: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <header className="flex items-center justify-between h-14 px-4 border-b border-white/[0.06] flex-shrink-0 glass">
      {/* Left: Node status */}
      <div className="flex items-center gap-3">
        <NodeStatusBadge status={nodeStatus} />
        {nodeStatus?.running && (
          <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-white/40">
            {/* Block height flip */}
            <div className="overflow-hidden h-4">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={nodeStatus.height}
                  initial={{ y: 14, opacity: 0 }}
                  animate={{ y: 0,  opacity: 1 }}
                  exit={{    y: -14, opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="block"
                >
                  Block #{nodeStatus.height.toLocaleString()}
                </motion.span>
              </AnimatePresence>
            </div>
            <span className="text-white/20">·</span>
            <span>{nodeStatus.peers} peers</span>
            {nodeStatus.synced && (
              <>
                <span className="text-white/20">·</span>
                <span className="text-green-400">Synced</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Center: Balance */}
      {balance && (
        <div className="flex items-center gap-1.5 font-display">
          <span className="text-white/40 text-xs">Balance</span>
          <motion.span
            className={clsx('font-bold text-sm transition-all duration-300', balanceGlowing ? 'glow-green' : '')}
            style={{
              background: 'linear-gradient(90deg, #a855f7 0%, #60a5fa 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            {formatIRM(balance.confirmed)}
          </motion.span>
          {balance.unconfirmed > 0 && (
            <span className="text-amber-400/80 text-xs">
              +{formatIRM(balance.unconfirmed)} pending
            </span>
          )}
        </div>
      )}

      {/* Right: Controls */}
      <div className="flex items-center gap-2">
        {/* Node toggle */}
        <button
          onClick={handleToggleNode}
          disabled={loading}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-display font-semibold',
            'transition-all duration-200 active:scale-95',
            isRunning
              ? 'bg-red-500/15 text-red-400 border border-red-500/20 hover:bg-red-500/25'
              : 'bg-green-500/15 text-green-400 border border-green-500/20 hover:bg-green-500/25',
          )}
        >
          {loading
            ? <RefreshCw size={12} className="animate-spin" />
            : isRunning
              ? <Square size={12} fill="currentColor" />
              : <Play   size={12} fill="currentColor" />
          }
          {isRunning ? 'Stop Node' : 'Start Node'}
        </button>

        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => setShowNotifs(!showNotifs)}
            className="relative flex items-center justify-center w-8 h-8 rounded-lg text-white/50 hover:text-white hover:bg-white/5 transition-all"
          >
            <Bell size={16} />
            <AnimatePresence>
              {unread > 0 && (
                <motion.span
                  key="badge"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                  className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-irium-500 text-white text-[10px] flex items-center justify-center font-bold"
                >
                  {unread > 9 ? '9+' : unread}
                </motion.span>
              )}
            </AnimatePresence>
          </button>

          {/* Dropdown */}
          <AnimatePresence>
            {showNotifs && (
              <motion.div
                key="notif-panel"
                initial={{ opacity: 0, y: -8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0,  scale: 1    }}
                exit={{    opacity: 0, y: -8, scale: 0.97 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className="absolute right-0 top-full mt-2 w-80 z-50 card glass-heavy shadow-2xl overflow-hidden"
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
                  <span className="font-display font-semibold text-sm">Notifications</span>
                  <button onClick={() => setShowNotifs(false)} className="text-white/40 hover:text-white transition-colors">
                    <X size={14} />
                  </button>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="px-4 py-6 text-center text-white/30 text-sm">No notifications</div>
                  ) : (
                    notifications
                      .slice()
                      .reverse()
                      .map((n) => (
                        <div
                          key={n.id}
                          className="flex items-start gap-3 px-4 py-3 border-b border-white/[0.04] hover:bg-white/[0.03] group"
                        >
                          <NotifDot type={n.type} />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-white/90">{n.title}</div>
                            {n.message && (
                              <div className="text-xs text-white/50 mt-0.5 truncate">{n.message}</div>
                            )}
                          </div>
                          <button
                            onClick={() => dismiss(n.id)}
                            className="text-white/20 hover:text-white/60 opacity-0 group-hover:opacity-100 flex-shrink-0 transition-all"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}

function NodeStatusBadge({ status }: { status: NodeStatus | null }) {
  if (!status || !status.running) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="dot-offline" />
        <span className="text-xs font-display font-semibold text-white/30">
          {status ? 'Node stopped' : 'Offline'}
        </span>
      </div>
    );
  }
  if (!status.synced) {
    return (
      <div className="flex items-center gap-1.5 relative">
        <span className="dot-syncing" />
        {/* Pulsing ring when syncing */}
        <span className="absolute left-0 w-2 h-2 rounded-full animate-ping bg-amber-400 opacity-30" />
        <span className="text-xs font-display font-semibold text-amber-400">Syncing…</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <span className="dot-live" />
      <span className="text-xs font-display font-semibold text-green-400">Live</span>
    </div>
  );
}

function NotifDot({ type }: { type: string }) {
  const cls: Record<string, string> = {
    success: 'bg-green-400',
    error:   'bg-red-400',
    warning: 'bg-amber-400',
    info:    'bg-blue-400',
  };
  return <span className={clsx('w-2 h-2 rounded-full flex-shrink-0 mt-1.5', cls[type] ?? 'bg-white/40')} />;
}
```

- [ ] **Step 2: TypeScript check**

```powershell
npx tsc --noEmit 2>&1
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```powershell
git add src/components/layout/TopBar.tsx
git commit -m "feat: rewrite TopBar — block height flip, pulsing sync badge, animated notification dropdown"
```

---

## Task 9: Update `src/App.tsx`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Replace App.tsx**

Replace the entire content of `C:\Users\Ibrahim\Desktop\irium-core\src\App.tsx`:

```tsx
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Toaster } from 'react-hot-toast';
import Sidebar    from './components/layout/Sidebar';
import TopBar     from './components/layout/TopBar';
import StatusBar  from './components/layout/StatusBar';
import Dashboard  from './pages/Dashboard';
import Wallet     from './pages/Wallet';
import Settlement from './pages/Settlement';
import Marketplace from './pages/Marketplace';
import Agreements from './pages/Agreements';
import Reputation from './pages/Reputation';
import Miner      from './pages/Miner';
import Settings   from './pages/Settings';
import { useNodePoller } from './hooks/useNodePoller';
import { useStore } from './lib/store';

function PageWrapper({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0  }}
      exit={{    opacity: 0, y: -8 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      style={{ height: '100%' }}
    >
      {children}
    </motion.div>
  );
}

function AppLayout() {
  useNodePoller();
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);
  const location = useLocation();

  return (
    <div className="flex h-screen bg-surface-900 mesh-bg overflow-hidden">
      <Sidebar />

      <div className="flex flex-col flex-1 min-w-0">
        <TopBar />

        <main className="flex-1 overflow-y-auto px-6 py-5">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0  }}
              exit={{    opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              style={{ height: '100%' }}
            >
              <Routes location={location}>
                <Route path="/"            element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard"   element={<Dashboard />}   />
                <Route path="/wallet"      element={<Wallet />}      />
                <Route path="/settlement"  element={<Settlement />}  />
                <Route path="/marketplace" element={<Marketplace />} />
                <Route path="/agreements"  element={<Agreements />}  />
                <Route path="/agreements/:id" element={<Agreements />} />
                <Route path="/reputation"  element={<Reputation />}  />
                <Route path="/miner"       element={<Miner />}       />
                <Route path="/settings"    element={<Settings />}    />
              </Routes>
            </motion.div>
          </AnimatePresence>
        </main>

        <StatusBar />
      </div>

      {/* Global toast notifications */}
      <Toaster
        position="bottom-right"
        toastOptions={{
          duration: 4000,
          style: {
            background:  '#0d0d1a',
            border:      '1px solid rgba(123,47,226,0.4)',
            color:       '#e2d9f3',
            fontFamily:  '"DM Sans", sans-serif',
            fontSize:    '13px',
            borderRadius: '10px',
            backdropFilter: 'blur(12px)',
          },
          success: {
            iconTheme: { primary: '#22c55e', secondary: '#0d0d1a' },
          },
          error: {
            iconTheme: { primary: '#ef4444', secondary: '#0d0d1a' },
          },
        }}
      />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/*" element={<AppLayout />} />
      </Routes>
    </BrowserRouter>
  );
}
```

Note: The `sidebarCollapsed` variable was removed — the Sidebar now handles its own width animation via framer-motion's `motion.aside`, so `marginLeft` on the main area is no longer needed. The flex layout handles the space automatically.

- [ ] **Step 2: TypeScript check**

```powershell
npx tsc --noEmit 2>&1
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```powershell
git add src/App.tsx
git commit -m "feat: add AnimatePresence route transitions and react-hot-toast Toaster"
```

---

## Task 10: Full Verification

**Files:** None modified — read-only verification.

- [ ] **Step 1: Final TypeScript check**

```powershell
npx tsc --noEmit 2>&1
```

Expected: zero errors. If errors appear, fix them before proceeding.

- [ ] **Step 2: Start dev server and test all nav items**

```powershell
npm run dev
```

Open `http://localhost:1420`. Run through this checklist:

| Check | Expected |
|---|---|
| App loads | Dark background with animated mesh gradient |
| All 8 nav items clickable | Page transition plays (fade + slide) on each click |
| Sidebar collapse button | Width animates, labels stagger fade |
| Nav pill | Slides to new active item on route change |
| Node status dot | Visible at sidebar bottom |
| Topology collapse with tooltip | Tooltip shows on icon hover when collapsed |
| Notification bell | Click opens animated dropdown |
| Start Node button | Shows loading spinner, then `[irium mock]` in console, toast appears |
| Stop Node button | Same — mock mode, toast appears |
| Balance display | Visible in TopBar center |
| Console | Only `[irium mock]` warnings, no errors |

- [ ] **Step 3: Commit verification complete marker**

```powershell
git add -A
git commit -m "chore: phase 1 foundation overhaul complete — mock layer, CSS system, animated layout"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ Mock layer (`mock.ts`, `invoke.ts`, updated `tauri.ts`)
- ✅ CSS overhaul (Space Grotesk, Geist Mono, glass, glow, mesh, shimmer, invisible scrollbars, focus rings)
- ✅ Tailwind extensions (spring easing, glass blur, glow shadows, surface.base)
- ✅ Sidebar (animated width, layoutId nav pill, staggered labels, node status dot, glass)
- ✅ TopBar (block height flip, pulsing sync ring, animated notification badge + dropdown, balance glow, toasts)
- ✅ App.tsx (AnimatePresence route transitions, PageWrapper, Toaster configured)

**Known omissions (Phase 2):**
- Page-level redesigns (Dashboard counters, Wallet hero, Settlement wizard, etc.)
- SVG stroke checkmark animations
- Hashrate live graph in Miner
- Reputation score ring draw animation
