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
