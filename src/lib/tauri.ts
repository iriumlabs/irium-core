import { safeInvoke } from './invoke';
import type {
  NodeStatus, NodeMetrics, NodeStartResult, BinaryCheckResult, SystemInfo, WalletBalance, AddressInfo,
  SendResult, Transaction, Offer, CreateOfferParams, CreateOfferResult,
  OfferTakeResult, FeedEntry, FeedSyncResult, Agreement,
  CreateAgreementParams, AgreementResult, ReleaseResult,
  Proof, ProofSubmitResult, Reputation, MinerStatus, FoundBlock,
  GpuDevice, GpuPlatform, GpuMinerStatus, StratumStatus,
  OtcParams, FreelanceParams, MilestoneParams, DepositParams,
  MerchantDelayedParams, ContractorMilestoneParams,
  PeerInfo, MempoolInfo, DiagnosticsResult, UpdateCheckResult,
  NodeUpdateCheckResult, NodeUpdatePullResult,
  WalletCreateResult, WalletFileInfo, WalletInfo,
  MultisigCreateResult, MultisigSpendResult,
  Invoice, InvoiceImportResult,
  SpendEligibilityResult, ProofPolicy, AgreementStatusResult,
  ReputationOutcomeResult, ReputationOutcome, SelfTradeCheckResult,
  SellerStatus, BuyerStatus,
  DisputeEntry, DisputeOpenResult,
  NetworkMetrics, ExplorerAgreement, ExplorerStats,
  ExplorerNetworkStats, ExplorerPeer, ExplorerBlock, NetworkHashrateInfo,
  FeedDiscoverResult,
  AgreementSignResult, AgreementVerifySignatureResult,
  AgreementDecryptResult, AgreementStoreListResult,
} from './types';

// ── NODE ──────────────────────────────────────────────────────
export const node = {
  start: (dataDir?: string, externalIp?: string) =>
    safeInvoke<NodeStartResult>('start_node', { dataDir, externalIp }),

  stop: () =>
    safeInvoke<boolean>('stop_node'),

  status: () =>
    safeInvoke<NodeStatus>('get_node_status'),

  // Scrapes iriumd's /metrics for the two counters the Settings page needs
  // (inbound_accepted_total, outbound_dial_success_total). Backend returns
  // zeros if the endpoint fails — no special-casing needed at the call site.
  getMetrics: () =>
    safeInvoke<NodeMetrics>('get_node_metrics'),

  checkBinaries: () =>
    safeInvoke<BinaryCheckResult>('check_binaries'),

  setupDataDir: () =>
    safeInvoke<boolean>('setup_data_dir'),

  clearState: () =>
    safeInvoke<boolean>('clear_node_state'),

  detectPublicIp: (serviceUrl: string) =>
    safeInvoke<string>('detect_public_ip', { serviceUrl }),

  tryUpnpPortMap: () =>
    safeInvoke<string | null>('try_upnp_port_map'),

  getAppVersion: () =>
    safeInvoke<string>('get_app_version'),

  getSystemInfo: () =>
    safeInvoke<SystemInfo>('get_system_info'),

  saveDiscoveredPeers: (multiaddrs: string[]) =>
    safeInvoke<number>('save_discovered_peers', { multiaddrs }),

  checkNetworkReachable: () =>
    safeInvoke<boolean>('check_network_reachable'),

  logs: (lines?: number) =>
    safeInvoke<string[]>('get_node_logs', { lines }),
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

  transactions: (limit?: number, address?: string) =>
    safeInvoke<Transaction[]>('wallet_transactions', { limit, address }),

  setPath: (path: string) =>
    safeInvoke<boolean>('wallet_set_path', { path }),

  listFiles: () =>
    safeInvoke<WalletFileInfo[]>('list_wallet_files'),

  // Read-only inspection of a wallet file — does NOT change which wallet
  // is active. Used by the Delete confirmation modal to show contents at
  // stake before unlinking.
  getInfo: (path: string) =>
    safeInvoke<WalletInfo>('get_wallet_info', { path }),

  deleteFile: (path: string) =>
    safeInvoke<void>('delete_wallet_file', { path }),

  renameFile: (oldPath: string, newName: string) =>
    safeInvoke<string>('rename_wallet_file', { oldPath, newName }),

  create: () =>
    safeInvoke<WalletCreateResult>('wallet_create'),

  importMnemonic: (words: string) =>
    safeInvoke<string>('wallet_import_mnemonic', { words }),

  importWif: (wif: string) =>
    safeInvoke<string>('wallet_import_wif', { wif }),

  importPrivateKey: (hexKey: string) =>
    safeInvoke<string>('wallet_import_private_key', { hexKey }),

  exportSeed: () =>
    safeInvoke<string>('wallet_export_seed'),

  exportMnemonic: () =>
    safeInvoke<string>('wallet_export_mnemonic'),

  backup: (outPath: string) =>
    safeInvoke<string>('wallet_backup', { outPath }),

  restoreBackup: (filePath: string) =>
    safeInvoke<string>('wallet_restore_backup', { filePath }),

  exportWif: (address: string, outPath: string) =>
    safeInvoke<string>('wallet_export_wif', { address, outPath }),

  // Optional walletPath — when provided, reads from that specific wallet
  // file. Used by the Create-wallet flow before the new wallet is
  // registered as active. Defaults to the backend's currently-active
  // wallet otherwise. Tauri converts walletPath → wallet_path.
  readWif: (address: string, walletPath?: string) =>
    safeInvoke<string>('wallet_read_wif', { address, walletPath }),
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

  // buyerAddress: optional explicit buyer; falls back to the wallet's first
  // derived address on the backend when omitted. Tauri converts buyerAddress
  // → buyer_address.
  take: (offerId: string, buyerAddress?: string) =>
    safeInvoke<OfferTakeResult>('offer_take', { offerId, buyerAddress }),

  export: (offerId: string, outPath: string) =>
    safeInvoke<boolean>('offer_export', { offerId, outPath }),

  import: (filePath: string) =>
    safeInvoke<boolean>('offer_import', { filePath }),

  remove: (offerId: string) =>
    safeInvoke<boolean>('offer_remove', { offerId }),
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

  // secret: HTLC preimage hex — required when releasing an agreement the
  // wallet did not fund itself. broadcast: default true; pass false to
  // build the tx without transmitting (useful for offline review).
  release: (agreementId: string, secret?: string, broadcast?: boolean) =>
    safeInvoke<ReleaseResult>('agreement_release', { agreementId, secret, broadcast }),

  refund: (agreementId: string, broadcast?: boolean) =>
    safeInvoke<ReleaseResult>('agreement_refund', { agreementId, broadcast }),

  remove: (agreementId: string) =>
    safeInvoke<boolean>('agreement_remove', { agreementId }),
};

// ── PROOFS ────────────────────────────────────────────────────
export const proofs = {
  list: (agreementId?: string) =>
    safeInvoke<Proof[]>('proof_list', { agreementId }),

  sign: (agreementId: string, proofData: string, outPath: string) =>
    safeInvoke<boolean>('proof_sign', { agreementId, proofData, outPath }),

  submit: (agreementId: string, proofFile: string) =>
    safeInvoke<ProofSubmitResult>('proof_submit', { agreementId, proofFile }),

  // End-to-end: create a signed proof JSON from form fields, broadcast it,
  // and clean up the temp file. The user never sees the .json. Mirrors the
  // two-step `agreement-proof-create` + `agreement-proof-submit` CLI flow
  // documented in SETTLEMENT-DEV.md §"Step 5".
  createAndSubmit: (params: {
    agreementHash: string;
    proofType: string;
    attestedBy: string;
    address: string;
    evidenceSummary?: string;
    evidenceHash?: string;
  }) =>
    safeInvoke<ProofSubmitResult>('proof_create_and_submit', {
      agreementHash: params.agreementHash,
      proofType: params.proofType,
      attestedBy: params.attestedBy,
      address: params.address,
      evidenceSummary: params.evidenceSummary,
      evidenceHash: params.evidenceHash,
    }),
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

  merchantDelayed: (params: MerchantDelayedParams) =>
    safeInvoke<AgreementResult>('settlement_create_merchant_delayed', { params }),

  contractor: (params: ContractorMilestoneParams) =>
    safeInvoke<AgreementResult>('settlement_create_contractor', { params }),
};

// ── CPU MINER ─────────────────────────────────────────────────
export const miner = {
  start: (address: string, threads?: number) =>
    safeInvoke<boolean>('start_miner', { address, threads }),

  stop: () =>
    safeInvoke<boolean>('stop_miner'),

  status: () =>
    safeInvoke<MinerStatus>('get_miner_status'),

  // Phase / Bug 1 — list of blocks the CPU or GPU miner has found during
  // this app session (capped server-side at 100 entries). Shared with the
  // GPU miner since both populate the same AppState list.
  getFoundBlocks: () =>
    safeInvoke<FoundBlock[]>('get_found_blocks'),
};

// ── GPU MINER ─────────────────────────────────────────────────
export const gpuMiner = {
  listDevices: () =>
    safeInvoke<GpuDevice[]>('list_gpu_devices'),

  listPlatforms: () =>
    safeInvoke<GpuPlatform[]>('list_gpu_platforms'),

  start: (address: string, platformSel: string | undefined, deviceIndices: number[]) =>
    safeInvoke<boolean>('start_gpu_miner', { address, platformSel, deviceIndices }),

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

// ── UPDATE (GUI app) ──────────────────────────────────────────
export const update = {
  check: () =>
    safeInvoke<UpdateCheckResult>('check_for_updates'),
};

// ── NODE SOURCE UPDATE ────────────────────────────────────────
// Checks the iriumlabs/irium GitHub repo for commits newer than what
// the current binaries were compiled from, and pulls the latest source.
export const nodeUpdate = {
  check: () =>
    safeInvoke<NodeUpdateCheckResult>('check_node_update'),

  pull: () =>
    safeInvoke<NodeUpdatePullResult>('update_node_source'),
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

// ── MULTISIG ──────────────────────────────────────────────────
export const multisig = {
  create: (threshold: number, pubkeys: string[]) =>
    safeInvoke<MultisigCreateResult>('multisig_create', { threshold, pubkeys }),

  broadcast: (rawTx: string) =>
    safeInvoke<MultisigSpendResult>('multisig_broadcast', { rawTx }),
};

// ── INVOICES ──────────────────────────────────────────────────
export const invoices = {
  generate: (recipient: string, amountIrm: number, reference: string, expiresBlocks?: number, outPath?: string) =>
    safeInvoke<Invoice>('invoice_generate', { recipient, amountIrm, reference, expiresBlocks, outPath }),

  import: (filePath: string) =>
    safeInvoke<InvoiceImportResult>('invoice_import', { filePath }),
};

// ── AGREEMENT ELIGIBILITY & STATUS ────────────────────────────
export const agreementSpend = {
  releaseEligibility: (agreementId: string, fundingTxid?: string) =>
    safeInvoke<SpendEligibilityResult>('agreement_release_eligibility', { agreementId, fundingTxid }),

  refundEligibility: (agreementId: string, fundingTxid?: string) =>
    safeInvoke<SpendEligibilityResult>('agreement_refund_eligibility', { agreementId, fundingTxid }),

  status: (agreementId: string) =>
    safeInvoke<AgreementStatusResult>('agreement_status', { agreementId }),

  fund: (agreementId: string, broadcast?: boolean) =>
    safeInvoke<ReleaseResult>('agreement_fund', { agreementId, broadcast }),
};

// ── POLICIES ──────────────────────────────────────────────────
export const policies = {
  buildOtc: (policyId: string, agreementHash: string, attestor: string, releaseProofType: string, outPath?: string) =>
    safeInvoke<ProofPolicy>('policy_build_otc', { policyId, agreementHash, attestor, releaseProofType, outPath }),

  buildContractor: (policyId: string, agreementHash: string, attestor: string, milestone: string, outPath?: string) =>
    safeInvoke<ProofPolicy>('policy_build_contractor', { policyId, agreementHash, attestor, milestone, outPath }),

  buildPreorder: (policyId: string, agreementHash: string, attestor: string, deliveryProofType: string, outPath?: string) =>
    safeInvoke<ProofPolicy>('policy_build_preorder', { policyId, agreementHash, attestor, deliveryProofType, outPath }),

  list: (activeOnly?: boolean) =>
    safeInvoke<ProofPolicy[]>('agreement_policy_list', { activeOnly }),

  evaluate: (agreementId: string) =>
    safeInvoke<Record<string, unknown>>('agreement_policy_evaluate', { agreementId }),
};

// ── REPUTATION ACTIONS ────────────────────────────────────────
export const reputationActions = {
  recordOutcome: (seller: string, outcome: ReputationOutcome, proofResponseSecs?: number, selfTrade?: boolean) =>
    safeInvoke<ReputationOutcomeResult>('reputation_record_outcome', { seller, outcome, proofResponseSecs, selfTrade }),

  export: (seller: string, outPath?: string) =>
    safeInvoke<Record<string, unknown>>('reputation_export', { seller, outPath }),

  import: (filePath: string) =>
    safeInvoke<boolean>('reputation_import', { filePath }),

  selfTradeCheck: (seller: string, buyer: string) =>
    safeInvoke<SelfTradeCheckResult>('reputation_self_trade_check', { seller, buyer }),
};

// ── TRADE STATUS ──────────────────────────────────────────────
export const tradeStatus = {
  seller: (address?: string) =>
    safeInvoke<SellerStatus>('seller_status', { address }),

  buyer: (address?: string) =>
    safeInvoke<BuyerStatus>('buyer_status', { address }),
};

// ── DISPUTES ──────────────────────────────────────────────────
export const disputes = {
  open: (agreementId: string, reason?: string) =>
    safeInvoke<DisputeOpenResult>('agreement_dispute', { agreementId, reason }),

  list: () =>
    safeInvoke<DisputeEntry[]>('agreement_dispute_list'),
};

// ── NETWORK METRICS ───────────────────────────────────────────
export const metrics = {
  network: () =>
    safeInvoke<NetworkMetrics>('get_network_metrics'),
};

// ── EXPLORER ──────────────────────────────────────────────────
export const explorer = {
  agreements: (limit?: number) =>
    safeInvoke<ExplorerAgreement[]>('explorer_agreements', { limit }),

  stats: () =>
    safeInvoke<ExplorerStats>('explorer_stats'),

  // irium-explorer sidecar commands (port 38310)
  startSidecar: () =>
    safeInvoke<boolean>('start_explorer_sidecar'),
  networkStats: () =>
    safeInvoke<ExplorerNetworkStats>('get_explorer_stats'),
  networkPeers: () =>
    safeInvoke<ExplorerPeer[]>('get_explorer_peers'),
  networkBlocks: () =>
    safeInvoke<ExplorerBlock[]>('get_explorer_blocks'),
};

// ── FEED OPS ──────────────────────────────────────────────────
export const feedOps = {
  discover: () =>
    safeInvoke<FeedDiscoverResult>('offer_feed_discover'),

  bootstrap: () =>
    safeInvoke<boolean>('feed_bootstrap'),
};

// ── AGREEMENT STORE ───────────────────────────────────────────
export const agreementStore = {
  list: () =>
    safeInvoke<AgreementStoreListResult>('agreement_local_store_list'),

  sign: (agreementId: string, signerAddr: string, role?: string, outPath?: string) =>
    safeInvoke<AgreementSignResult>('agreement_sign_cmd', { agreementId, signerAddr, role, outPath }),

  verifySignature: (signaturePath: string, agreementId?: string) =>
    safeInvoke<AgreementVerifySignatureResult>('agreement_verify_signature', { signaturePath, agreementId }),

  decrypt: (blobPath: string) =>
    safeInvoke<AgreementDecryptResult>('agreement_decrypt', { blobPath }),
};

// ── RPC DIRECT ────────────────────────────────────────────────
export const rpc = {
  peers: () =>
    safeInvoke<PeerInfo[]>('rpc_get_peers'),

  mempool: () =>
    safeInvoke<MempoolInfo>('rpc_get_mempool'),

  block: (heightOrHash: string) =>
    safeInvoke<Record<string, unknown>>('rpc_get_block', { heightOrHash }),

  tx: (txid: string) =>
    safeInvoke<Record<string, unknown>>('rpc_get_tx', { txid }),

  address: (address: string) =>
    safeInvoke<Record<string, unknown>>('rpc_get_address', { address }),

  recentBlocks: (limit = 20, endHeight?: number) =>
    safeInvoke<ExplorerBlock[]>('get_recent_blocks', { limit, endHeight }),

  networkHashrate: () =>
    safeInvoke<NetworkHashrateInfo>('get_network_hashrate'),

  offersFeed: () =>
    safeInvoke<unknown>('rpc_get_offers_feed'),

  setUrl: (url: string) =>
    safeInvoke<boolean>('rpc_set_url', { url }),
};
