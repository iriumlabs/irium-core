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
