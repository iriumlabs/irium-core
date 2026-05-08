import { safeInvoke } from './invoke';
import type {
  NodeStatus, NodeStartResult, BinaryCheckResult, WalletBalance, AddressInfo,
  SendResult, Transaction, Offer, CreateOfferParams, CreateOfferResult,
  OfferTakeResult, FeedEntry, FeedSyncResult, Agreement,
  CreateAgreementParams, AgreementResult, ReleaseResult,
  Proof, ProofSubmitResult, Reputation, MinerStatus,
  GpuDevice, GpuMinerStatus, StratumStatus,
  OtcParams, FreelanceParams, MilestoneParams, DepositParams,
  PeerInfo, MempoolInfo, DiagnosticsResult, UpdateCheckResult,
  WalletCreateResult,
} from './types';

// ── NODE ──────────────────────────────────────────────────────
export const node = {
  start: (dataDir?: string) =>
    safeInvoke<NodeStartResult>('start_node', { dataDir }),

  stop: () =>
    safeInvoke<boolean>('stop_node'),

  status: () =>
    safeInvoke<NodeStatus>('get_node_status'),

  checkBinaries: () =>
    safeInvoke<BinaryCheckResult>('check_binaries'),

  setupDataDir: () =>
    safeInvoke<boolean>('setup_data_dir'),

  clearState: () =>
    safeInvoke<boolean>('clear_node_state'),

  saveDiscoveredPeers: (multiaddrs: string[]) =>
    safeInvoke<number>('save_discovered_peers', { multiaddrs }),
};

// ── WALLET ────────────────────────────────────────────────────
export const wallet = {
  balance: () =>
    safeInvoke<WalletBalance>('wallet_get_balance'),

  newAddress: () =>
    safeInvoke<string>('wallet_new_address'),

  listAddresses: () =>
    safeInvoke<AddressInfo[]>('wallet_list_addresses'),

  send: (to: string, amountSats: number, feeSats?: number) =>
    safeInvoke<SendResult>('wallet_send', { to, amountSats, feeSats }),

  transactions: (limit?: number) =>
    safeInvoke<Transaction[]>('wallet_transactions', { limit }),

  setPath: (path: string) =>
    safeInvoke<boolean>('wallet_set_path', { path }),

  create: () =>
    safeInvoke<WalletCreateResult>('wallet_create'),

  importMnemonic: (words: string) =>
    safeInvoke<boolean>('wallet_import_mnemonic', { words }),

  importWif: (wif: string) =>
    safeInvoke<boolean>('wallet_import_wif', { wif }),

  importPrivateKey: (hexKey: string) =>
    safeInvoke<boolean>('wallet_import_private_key', { hexKey }),
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
    safeInvoke<Offer[]>('offer_list', {
      source: params?.source,
      sort: params?.sort,
      limit: params?.limit,
      minAmount: params?.minAmount,
      maxAmount: params?.maxAmount,
      payment: params?.payment,
    }),

  show: (offerId: string) =>
    safeInvoke<Offer>('offer_show', { offerId }),

  create: (params: CreateOfferParams) =>
    safeInvoke<CreateOfferResult>('offer_create', { params }),

  take: (offerId: string) =>
    safeInvoke<OfferTakeResult>('offer_take', { offerId }),

  export: (offerId: string, outPath: string) =>
    safeInvoke<boolean>('offer_export', { offerId, outPath }),

  import: (filePath: string) =>
    safeInvoke<boolean>('offer_import', { filePath }),
};

// ── FEEDS ─────────────────────────────────────────────────────
export const feeds = {
  add: (url: string) =>
    safeInvoke<boolean>('feed_add', { url }),

  remove: (url: string) =>
    safeInvoke<boolean>('feed_remove', { url }),

  list: () =>
    safeInvoke<FeedEntry[]>('feed_list'),

  sync: () =>
    safeInvoke<FeedSyncResult>('feed_sync'),

  fetch: (url: string) =>
    safeInvoke<Offer[]>('feed_fetch', { url }),

  prune: () =>
    safeInvoke<boolean>('feed_prune'),
};

// ── AGREEMENTS ────────────────────────────────────────────────
export const agreements = {
  list: () =>
    safeInvoke<Agreement[]>('agreement_list'),

  show: (agreementId: string) =>
    safeInvoke<Agreement>('agreement_show', { agreementId }),

  create: (params: CreateAgreementParams) =>
    safeInvoke<AgreementResult>('agreement_create', { params }),

  pack: (agreementId: string, outPath: string) =>
    safeInvoke<boolean>('agreement_pack', { agreementId, outPath }),

  unpack: (filePath: string) =>
    safeInvoke<Agreement>('agreement_unpack', { filePath }),

  release: (agreementId: string) =>
    safeInvoke<ReleaseResult>('agreement_release', { agreementId }),

  refund: (agreementId: string) =>
    safeInvoke<ReleaseResult>('agreement_refund', { agreementId }),
};

// ── PROOFS ────────────────────────────────────────────────────
export const proofs = {
  list: (agreementId?: string) =>
    safeInvoke<Proof[]>('proof_list', { agreementId }),

  sign: (agreementId: string, proofData: string, outPath: string) =>
    safeInvoke<boolean>('proof_sign', { agreementId, proofData, outPath }),

  submit: (agreementId: string, proofFile: string) =>
    safeInvoke<ProofSubmitResult>('proof_submit', { agreementId, proofFile }),
};

// ── REPUTATION ────────────────────────────────────────────────
export const reputation = {
  show: (pubkeyOrAddr: string) =>
    safeInvoke<Reputation>('reputation_show', { pubkeyOrAddr }),
};

// ── SETTLEMENT TEMPLATES ──────────────────────────────────────
export const settlement = {
  otc: (params: OtcParams) =>
    safeInvoke<AgreementResult>('settlement_create_otc', { params }),

  freelance: (params: FreelanceParams) =>
    safeInvoke<AgreementResult>('settlement_create_freelance', { params }),

  milestone: (params: MilestoneParams) =>
    safeInvoke<AgreementResult>('settlement_create_milestone', { params }),

  deposit: (params: DepositParams) =>
    safeInvoke<AgreementResult>('settlement_create_deposit', { params }),
};

// ── CPU MINER ─────────────────────────────────────────────────
export const miner = {
  start: (address: string, threads?: number) =>
    safeInvoke<boolean>('start_miner', { address, threads }),

  stop: () =>
    safeInvoke<boolean>('stop_miner'),

  status: () =>
    safeInvoke<MinerStatus>('get_miner_status'),
};

// ── GPU MINER ─────────────────────────────────────────────────
export const gpuMiner = {
  listDevices: () =>
    safeInvoke<GpuDevice[]>('list_gpu_devices'),

  start: (address: string, deviceIndex: number, intensity: number) =>
    safeInvoke<boolean>('start_gpu_miner', { address, deviceIndex, intensity }),

  stop: () =>
    safeInvoke<boolean>('stop_gpu_miner'),

  status: () =>
    safeInvoke<GpuMinerStatus>('get_gpu_miner_status'),
};

// ── STRATUM POOL ──────────────────────────────────────────────
export const stratum = {
  connect: (poolUrl: string, worker: string, password: string) =>
    safeInvoke<boolean>('stratum_connect', { poolUrl, worker, password }),

  disconnect: () =>
    safeInvoke<boolean>('stratum_disconnect'),

  status: () =>
    safeInvoke<StratumStatus>('get_stratum_status'),
};

// ── DIAGNOSTICS ───────────────────────────────────────────────
export const diagnostics = {
  run: () =>
    safeInvoke<DiagnosticsResult>('run_diagnostics'),
};

// ── UPDATE ────────────────────────────────────────────────────
export const update = {
  check: () =>
    safeInvoke<UpdateCheckResult>('check_for_updates'),
};

// ── CONFIG ────────────────────────────────────────────────────
export const config = {
  setWalletConfig: (walletPath: string | null, dataDir: string | null) =>
    safeInvoke<boolean>('set_wallet_config', { walletPath, dataDir }),

  saveSettings: (settingsJson: string) =>
    safeInvoke<boolean>('save_settings', { settingsJson }),

  loadSettings: () =>
    safeInvoke<string | null>('load_settings'),
};

// ── RPC DIRECT ────────────────────────────────────────────────
export const rpc = {
  peers: () =>
    safeInvoke<PeerInfo[]>('rpc_get_peers'),

  mempool: () =>
    safeInvoke<MempoolInfo>('rpc_get_mempool'),

  block: (heightOrHash: string) =>
    safeInvoke<Record<string, unknown>>('rpc_get_block', { heightOrHash }),

  offersFeed: () =>
    safeInvoke<unknown>('rpc_get_offers_feed'),

  setUrl: (url: string) =>
    safeInvoke<boolean>('rpc_set_url', { url }),
};
