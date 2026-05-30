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
  NodeUpdateCheckResult, NodeUpdatePullResult, ResetNodeStateResult,
  WalletCreateResult, WalletFileInfo, WalletInfo,
  MultisigCreateResult, MultisigSpendResult,
  Invoice, InvoiceImportResult,
  SpendEligibilityResult, ProofPolicy, AgreementStatusResult,
  ReputationOutcomeResult, ReputationOutcome, SelfTradeCheckResult,
  SellerStatus, BuyerStatus,
  DisputeEntry, DisputeOpenResult,
  NetworkMetrics, ExplorerAgreement, ExplorerStats,
  ExplorerNetworkStats, ExplorerPeer, ExplorerBlock, NetworkHashrateInfo,
  RichListResponse, PortCheckResult, PoolStats, UpnpDiagnostics,
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

  // Lighter alternative to clearState. Renames ~/.irium/state/ to a
  // timestamped backup and recreates a fresh state dir, but preserves
  // ~/.irium/blocks/ so iriumd rebuilds the UTXO set from local blocks
  // on next start (~5-15 min) instead of a full network resync (~hours).
  // Backend kills the node before touching files; caller should restart
  // iriumd after the call resolves. Use when a user reports tx-signature
  // failures or other UTXO-state corruption.
  resetStateKeepBlocks: () =>
    safeInvoke<ResetNodeStateResult>('reset_node_state_keep_blocks'),

  // Walks <data_dir>/blocks/ for orphaned_<ts>/ subdirs (created by iriumd
  // when a block fails validation) and counts the files inside. Returns
  // zero counts when the blocks dir doesn't exist — never errors on that.
  scanQuarantinedBlocks: () =>
    safeInvoke<{ files: number; dirs: number }>('scan_quarantined_blocks'),

  // Deletes every orphaned_* dir under <data_dir>/blocks/. Backend refuses
  // to run while the node process is alive — node must be stopped first.
  clearQuarantinedBlocks: () =>
    safeInvoke<{ deleted_files: number; deleted_dirs: number; errors: string[] }>(
      'clear_quarantined_blocks',
    ),

  detectPublicIp: (serviceUrl: string) =>
    safeInvoke<string>('detect_public_ip', { serviceUrl }),

  tryUpnpPortMap: () =>
    safeInvoke<string | null>('try_upnp_port_map'),

  // FIX 1 (UPnP): full diagnostic snapshot of the most recent UPnP
  // attempt — adapter enumeration, chosen LAN IP, gateway IP, SSDP
  // location, control URL, external IP, routability verdict, retry
  // chain status, last fault. Help page renders this in a collapsible
  // panel so the user can self-diagnose UPnP failures even when the
  // router UI claims the mapping is active (multi-adapter / double NAT).
  upnpDiagnostics: () =>
    safeInvoke<UpnpDiagnostics>('upnp_diagnostics'),

  // Port-forwarding self-test for the Help page's Test Connection button.
  // Combines a live UPnP probe with iriumd's inbound_accepted_total
  // counter — either non-zero result flips `open` to true.
  checkPortOpen: () =>
    safeInvoke<PortCheckResult>('check_port_open'),

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

  // coinSelect: 'smallest' (default in irium-wallet) drains dust first;
  // 'largest' picks bigger inputs first which reduces input count and fees
  // when the user has many small UTXOs. Omitted entirely if undefined so the
  // wallet binary uses its own default.
  send: (from: string, to: string, amountSats: number, feeSats?: number, coinSelect?: 'smallest' | 'largest') =>
    safeInvoke<SendResult>('wallet_send', { fromAddress: from, to, amountSats, feeSats, coinSelect }),

  transactions: (limit?: number, address?: string) =>
    safeInvoke<Transaction[]>('wallet_transactions', { limit, address }),

  // FIX #126: pending-only view of locally-broadcast outgoing txs.
  // `transactions()` above already inline-merges these as the first
  // entries with pending=true, so most callers do not need this
  // direct accessor; it is exposed for a "X pending" badge or a
  // dedicated pending-only modal.
  pendingTransactions: (address?: string) =>
    safeInvoke<Transaction[]>('wallet_pending_transactions', { address }),

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

  // Full on-chain audit record for an agreement. The Rust command
  // reconstitutes the canonical AgreementObject via
  // `irium-wallet agreement-inspect` and POSTs it to iriumd's
  // /rpc/agreementaudit under the {agreement: ...} envelope the
  // endpoint expects — previously the GUI tried to POST just
  // {agreement_hash} which axum rejected with HTTP 422. The wrapper
  // returns the raw audit JSON so the AuditModal can do its own
  // defensive field extraction.
  audit: (agreementId: string) =>
    safeInvoke<Record<string, unknown>>('agreement_audit', { agreementId }),

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

  // Hub-created agreements persist a random HTLC preimage at
  // <data_dir>/agreement_secrets/<agreement_id>.hex when the GUI is the
  // agreement creator. This fetches it so the Release UI can pre-fill
  // the secret field instead of asking the user to paste 64 hex chars.
  // Errors when the file is absent (e.g. agreement created by a peer).
  getSecret: (agreementId: string) =>
    safeInvoke<string>('get_agreement_secret', { agreementId }),

  // Per-milestone preimage for milestone/contractor templates. Index is
  // 0-based and matches the on-chain milestone order assigned by the
  // settlement_create_milestone / settlement_create_contractor handlers.
  // Errors when absent (peer-created agreement, or index out of range).
  getMilestoneSecret: (agreementId: string, index: number) =>
    safeInvoke<string>('get_milestone_secret', { agreementId, index }),

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

  start: (address: string, platformSel: string | undefined, deviceIndices: number[], intensity: number) =>
    safeInvoke<boolean>('start_gpu_miner', { address, platformSel, deviceIndices, intensity }),

  stop: () =>
    safeInvoke<boolean>('stop_gpu_miner'),

  status: () =>
    safeInvoke<GpuMinerStatus>('get_gpu_miner_status'),
};

// ── STRATUM POOL ──────────────────────────────────────────────
export const stratum = {
  // v1.0.63: platformSel + deviceIndices are optional. When deviceIndices
  // is a non-empty array the backend spawns irium-miner-gpu with
  // --pool / --platform / --devices CLI flags. When both are omitted (or
  // deviceIndices is empty) the backend falls back to the original
  // irium-miner (CPU) sidecar spawn for backwards compatibility with
  // ASIC/CPU pool users who never had a GPU detected.
  connect: (
    poolUrl: string,
    worker: string,
    password: string,
    platformSel?: string,
    deviceIndices?: number[],
  ) =>
    safeInvoke<boolean>('stratum_connect', {
      poolUrl, worker, password, platformSel, deviceIndices,
    }),

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

  // Top-N IRM holders. Default 100; clamped to [1, 500] in iriumd. The
  // Tauri command is a 10-second-timeout passthrough — the actual
  // aggregation is done on the node side under a single chain-lock.
  richlist: (limit?: number) =>
    safeInvoke<RichListResponse>('get_richlist', { limit }),

  // Official-pool stats — hits the iriumlabs.org public proxy via the
  // Rust get_pool_stats Tauri command. Returns a PoolStats snapshot.
  // Failure path returns null; the Explorer surface handles that with an
  // empty state rather than a toast (the section is informational).
  poolStats: () =>
    safeInvoke<PoolStats>('get_pool_stats'),

  offersFeed: () =>
    safeInvoke<unknown>('rpc_get_offers_feed'),

  setUrl: (url: string) =>
    safeInvoke<boolean>('rpc_set_url', { url }),

  // FIX 3 (Remote node): probe a remote iriumd's /status with a 5s
  // timeout and the supplied bearer token. Backend command resolves
  // a successful 2xx response into Ok(true); anything else (timeout,
  // 401, 5xx) bubbles up as Err so the Settings page can surface the
  // exact reason. Used by the Test Remote button to confirm rpc_url
  // + rpc_token are correct before flipping node_mode.
  testRemoteConnection: (rpcUrl: string, rpcToken?: string) =>
    safeInvoke<boolean>('test_remote_connection', { rpcUrl, rpcToken }),
};

// ── SOLO STRATUM BRIDGE ───────────────────────────────────────
// Manages a long-running irium-miner --solo-stratum sidecar so an ASIC
// can submit work directly to the user's iriumd. Distinct from the
// CPU/GPU miner_process slot, so the user can run both at once.
export interface SoloStratumStatusResult {
  running: boolean;
  listen_addr: string | null;
}
export const soloStratum = {
  start: (listen?: string) =>
    safeInvoke<string>('start_solo_stratum', { listen }),
  stop: () =>
    safeInvoke<boolean>('stop_solo_stratum'),
  status: () =>
    safeInvoke<SoloStratumStatusResult>('solo_stratum_status'),
};

// ── GENERIC IRIUM-WALLET CLI ──────────────────────────────────
// Thin wrappers over the wallet_cli_run Tauri command — one per
// irium-wallet subcommand documented in docs/WALLET-CLI.md. The backend
// shells out to the bundled irium-wallet sidecar and returns parsed
// JSON when stdout is JSON, otherwise the raw stdout wrapped as a JSON
// string. Pass `includeRpc: true` for subcommands that hit iriumd
// (balance, history, send, agreement-*, offer-*, etc) so the active
// rpc_url is appended as --rpc. Subcommands that don't accept --rpc
// (init, new-address, qr, address-to-pkh, etc) call with rpc=false.
const cliInvoke = (subcommand: string, args: string[] = [], includeRpc = false) =>
  safeInvoke<unknown>('wallet_cli_run', { subcommand, args, includeRpc });

const flag = (name: string, value: string | number | undefined | null): string[] =>
  value === undefined || value === null || value === '' ? [] : [`--${name}`, String(value)];

const boolFlag = (name: string, present: boolean | undefined): string[] =>
  present ? [`--${name}`] : [];

export const walletCli = {
  // Direct passthrough — call any wallet subcommand with custom args.
  runCmd: (subcommand: string, args?: string[], includeRpc?: boolean) =>
    cliInvoke(subcommand, args ?? [], includeRpc ?? false),

  // ── Wallet setup & keys ─
  init: (seedHex?: string) => cliInvoke('init', flag('seed', seedHex)),
  createWallet: (bip32?: boolean) => cliInvoke('create-wallet', boolFlag('bip32', bip32)),
  newAddress: () => cliInvoke('new-address'),
  listAddresses: () => cliInvoke('list-addresses'),
  importMnemonic: (words: string) => cliInvoke('import-mnemonic', words.trim().split(/\s+/)),
  exportMnemonic: (force?: boolean) => cliInvoke('export-mnemonic', boolFlag('force', force)),
  importWif: (wif: string) => cliInvoke('import-wif', [wif]),
  exportWif: (address: string, outPath: string) =>
    cliInvoke('export-wif', [address, ...flag('out', outPath)]),
  importSeed: (hex: string, force?: boolean) =>
    cliInvoke('import-seed', [hex, ...boolFlag('force', force)]),
  exportSeed: (outPath: string) => cliInvoke('export-seed', flag('out', outPath)),
  backup: (outPath?: string) => cliInvoke('backup', flag('out', outPath)),
  restoreBackup: (file: string, force?: boolean) =>
    cliInvoke('restore-backup', [file, ...boolFlag('force', force)]),
  addressToPkh: (address: string) => cliInvoke('address-to-pkh', [address]),
  qr: (address: string) => cliInvoke('qr', [address]),
  watch: (autoRelease?: boolean) => cliInvoke('watch', boolFlag('auto-release', autoRelease), true),

  // ── Chain queries (need iriumd) ─
  balance: (address: string) => cliInvoke('balance', [address], true),
  listUnspent: (address: string) => cliInvoke('list-unspent', [address], true),
  history: (address: string) => cliInvoke('history', [address], true),
  estimateFee: () => cliInvoke('estimate-fee', [], true),

  // ── Sending ─
  send: (from: string, to: string, amountIrm: string | number, feeIrm?: string | number, coinSelect?: 'smallest' | 'largest') =>
    cliInvoke('send', [
      from, to, String(amountIrm),
      ...flag('fee', feeIrm),
      ...flag('coin-select', coinSelect),
    ], true),

  // ── Offer lifecycle ─
  offerCreate: (params: {
    seller: string; amount: string | number; paymentMethod: string;
    timeout: number; priceNote?: string; paymentInstructions?: string; offerId?: string;
  }) => cliInvoke('offer-create', [
    ...flag('seller', params.seller),
    ...flag('amount', String(params.amount)),
    ...flag('payment-method', params.paymentMethod),
    ...flag('timeout', params.timeout),
    ...flag('price-note', params.priceNote),
    ...flag('payment-instructions', params.paymentInstructions),
    ...flag('offer-id', params.offerId),
  ]),
  offerList: (params?: {
    status?: 'open' | 'taken' | 'settled';
    source?: 'local' | 'imported' | 'remote' | 'all';
    seller?: string;
    payment?: string;
    minAmount?: string | number;
    maxAmount?: string | number;
    sort?: 'score' | 'newest' | 'amount' | 'seller';
    limit?: number;
    summary?: boolean;
    json?: boolean;
  }) => cliInvoke('offer-list', [
    ...flag('status', params?.status),
    ...flag('source', params?.source),
    ...flag('seller', params?.seller),
    ...flag('payment', params?.payment),
    ...flag('min-amount', params?.minAmount),
    ...flag('max-amount', params?.maxAmount),
    ...flag('sort', params?.sort),
    ...flag('limit', params?.limit),
    ...boolFlag('summary', params?.summary),
    ...boolFlag('json', params?.json),
  ]),
  offerShow: (offerId: string) => cliInvoke('offer-show', flag('offer', offerId)),
  offerTake: (offerId: string, buyer: string) =>
    cliInvoke('offer-take', [...flag('offer', offerId), ...flag('buyer', buyer)], true),
  offerExport: (offerId: string, outPath: string) =>
    cliInvoke('offer-export', [...flag('offer', offerId), ...flag('out', outPath)]),
  offerImport: (file: string) => cliInvoke('offer-import', flag('file', file)),
  offerFetch: (url: string) => cliInvoke('offer-fetch', flag('url', url)),
  offerFeedFetch: (url: string) => cliInvoke('offer-feed-fetch', flag('url', url)),
  offerFeedSync: (json?: boolean) => cliInvoke('offer-feed-sync', boolFlag('json', json)),
  offerFeedExport: (outPath?: string, limit?: number) =>
    cliInvoke('offer-feed-export', [...flag('out', outPath), ...flag('limit', limit)]),
  offerFeedPrune: (olderThanDays?: number, dryRun?: boolean, json?: boolean) =>
    cliInvoke('offer-feed-prune', [
      ...flag('older-than-days', olderThanDays),
      ...boolFlag('dry-run', dryRun),
      ...boolFlag('json', json),
    ]),
  offerFeedDiscover: () => cliInvoke('offer-feed-discover'),
  marketplaceSync: () => cliInvoke('marketplace-sync', [], true),

  // ── Feed registry ─
  feedAdd: (url: string) => cliInvoke('feed-add', [url]),
  feedRemove: (url: string) => cliInvoke('feed-remove', [url]),
  feedList: () => cliInvoke('feed-list'),
  feedBootstrap: () => cliInvoke('feed-bootstrap'),

  // ── Reputation ─
  reputationShow: (who: string, json?: boolean) =>
    cliInvoke('reputation-show', [who, ...boolFlag('json', json)]),
  reputationRecordOutcome: (seller: string, outcome: 'satisfied' | 'failed' | 'disputed' | 'timeout') =>
    cliInvoke('reputation-record-outcome', [...flag('seller', seller), ...flag('outcome', outcome)]),
  reputationExport: (outPath?: string) => cliInvoke('reputation-export', flag('out', outPath)),
  reputationImport: (file: string) => cliInvoke('reputation-import', [file]),
  reputationSelfTradeCheck: (seller: string) =>
    cliInvoke('reputation-self-trade-check', flag('seller', seller)),

  // ── Agreement creation (low-level templates) ─
  agreementCreateSimpleSettlement: (args: string[]) =>
    cliInvoke('agreement-create-simple-settlement', args),
  agreementCreateOtc: (args: string[]) => cliInvoke('agreement-create-otc', args),
  agreementCreateDeposit: (args: string[]) => cliInvoke('agreement-create-deposit', args),
  agreementCreateMilestone: (args: string[]) => cliInvoke('agreement-create-milestone', args),
  agreementCreateFromTemplate: (templateId: string, extra: string[] = []) =>
    cliInvoke('agreement-create-from-template', [...flag('template', templateId), ...extra]),
  templateList: () => cliInvoke('template-list'),
  templateShow: (id: string) => cliInvoke('template-show', [id]),
  agreementTemplate: (subArgs: string[]) => cliInvoke('agreement-template', subArgs),
  flowOtcDemo: () => cliInvoke('flow-otc-demo', [], true),

  // ── Agreement operations ─
  agreementFund: (ref: string, broadcast?: boolean) =>
    cliInvoke('agreement-fund', [ref, ...boolFlag('broadcast', broadcast)], true),
  agreementStatus: (ref: string) => cliInvoke('agreement-status', [ref], true),
  agreementTimeline: (ref: string) => cliInvoke('agreement-timeline', [ref], true),
  agreementRelease: (ref: string, secret?: string, broadcast?: boolean) =>
    cliInvoke('agreement-release', [
      ref,
      ...flag('secret', secret),
      ...boolFlag('broadcast', broadcast),
    ], true),
  agreementRefund: (ref: string, broadcast?: boolean) =>
    cliInvoke('agreement-refund', [ref, ...boolFlag('broadcast', broadcast)], true),
  agreementReleaseEligibility: (ref: string) =>
    cliInvoke('agreement-release-eligibility', [ref], true),
  agreementRefundEligibility: (ref: string) =>
    cliInvoke('agreement-refund-eligibility', [ref], true),
  agreementMilestones: (ref: string) => cliInvoke('agreement-milestones', [ref], true),
  agreementHash: (ref: string) => cliInvoke('agreement-hash', [ref]),
  agreementInspect: (ref: string) => cliInvoke('agreement-inspect', [ref]),
  agreementList: () => cliInvoke('agreement-list'),
  agreementSave: (ref: string, label?: string) =>
    cliInvoke('agreement-save', [ref, ...flag('label', label)]),
  agreementLoad: (ref: string) => cliInvoke('agreement-load', [ref]),
  agreementExport: (ref: string, outPath?: string) =>
    cliInvoke('agreement-export', [ref, ...flag('out', outPath)]),
  agreementImport: (file: string) => cliInvoke('agreement-import', [file]),
  agreementStorePrivate: (file: string) => cliInvoke('agreement-store-private', [file]),
  agreementLocalStoreList: () => cliInvoke('agreement-local-store-list'),
  agreementFundingLegs: (ref: string) => cliInvoke('agreement-funding-legs', [ref], true),
  agreementAudit: (ref: string) => cliInvoke('agreement-audit', [ref], true),
  agreementAuditExport: (ref: string, outPath?: string) =>
    cliInvoke('agreement-audit-export', [ref, ...flag('out', outPath)], true),
  agreementStatement: (ref: string) => cliInvoke('agreement-statement', [ref], true),
  agreementStatementExport: (ref: string, format?: 'text' | 'html' | 'json', outPath?: string) =>
    cliInvoke('agreement-statement-export', [
      ref,
      ...flag('format', format),
      ...flag('out', outPath),
    ]),
  agreementReceipt: (ref: string, format?: 'html' | 'json', outPath?: string) =>
    cliInvoke('agreement-receipt', [ref, ...flag('format', format), ...flag('out', outPath)]),
  agreementVerifyArtifacts: (ref: string) => cliInvoke('agreement-verify-artifacts', [ref]),
  agreementExportReceipt: (ref: string, outPath?: string) =>
    cliInvoke('agreement-export-receipt', [ref, ...flag('out', outPath)], true),
  agreementFlagNonResponse: (ref: string) => cliInvoke('agreement-flag-non-response', [ref]),

  // ── Proof operations ─
  agreementProofCreate: (params: {
    agreementHash: string; proofType: string; attestedBy: string; address: string;
    evidenceSummary?: string; evidenceHash?: string; outPath?: string;
  }) => cliInvoke('agreement-proof-create', [
    ...flag('agreement-hash', params.agreementHash),
    ...flag('proof-type', params.proofType),
    ...flag('attested-by', params.attestedBy),
    ...flag('address', params.address),
    ...flag('evidence-summary', params.evidenceSummary),
    ...flag('evidence-hash', params.evidenceHash),
    ...flag('out', params.outPath),
  ]),
  agreementProofSubmit: (proof: string) =>
    cliInvoke('agreement-proof-submit', flag('proof', proof), true),
  agreementProofList: (agreementHash?: string) =>
    cliInvoke('agreement-proof-list', flag('agreement-hash', agreementHash), true),
  agreementProofGet: (proofId: string) =>
    cliInvoke('agreement-proof-get', flag('proof-id', proofId), true),
  proofSign: (proof: string, key: string) =>
    cliInvoke('proof-sign', [...flag('proof', proof), ...flag('key', key)]),
  proofSubmitJson: (proof: string) =>
    cliInvoke('proof-submit-json', flag('proof', proof), true),
  proofTemplateList: () => cliInvoke('proof-template-list'),
  proofTemplateCreate: (template: string, outPath: string) =>
    cliInvoke('proof-template-create', [...flag('template', template), ...flag('out', outPath)]),

  // ── Policy operations ─
  policyBuildOtc: (params: {
    policyId: string; agreementHash: string; attestor: string; releaseProofType: string;
  }) => cliInvoke('policy-build-otc', [
    ...flag('policy-id', params.policyId),
    ...flag('agreement-hash', params.agreementHash),
    ...flag('attestor', params.attestor),
    ...flag('release-proof-type', params.releaseProofType),
  ]),
  agreementPolicySet: (policy: string) =>
    cliInvoke('agreement-policy-set', flag('policy', policy), true),
  agreementPolicyGet: (agreementHash: string) =>
    cliInvoke('agreement-policy-get', flag('agreement-hash', agreementHash), true),
  agreementPolicyEvaluate: (agreementRef: string) =>
    cliInvoke('agreement-policy-evaluate', flag('agreement', agreementRef), true),
  agreementPolicyList: (activeOnly?: boolean) =>
    cliInvoke('agreement-policy-list', boolFlag('active-only', activeOnly), true),

  // ── Signing & bundles ─
  agreementSign: (agreement: string, signer: string) =>
    cliInvoke('agreement-sign', [...flag('agreement', agreement), ...flag('signer', signer)]),
  agreementVerifySignature: (agreement: string, signature: string) =>
    cliInvoke('agreement-verify-signature', [
      ...flag('agreement', agreement),
      ...flag('signature', signature),
    ]),
  agreementSignatureInspect: (file: string) => cliInvoke('agreement-signature-inspect', [file]),
  agreementBundleCreate: (ref: string, outPath: string) =>
    cliInvoke('agreement-bundle-create', [ref, ...flag('out', outPath)]),
  agreementBundleInspect: (ref: string) => cliInvoke('agreement-bundle-inspect', [ref]),
  agreementBundleVerify: (ref: string) => cliInvoke('agreement-bundle-verify', [ref]),
  agreementBundleSign: (bundle: string, signer: string) =>
    cliInvoke('agreement-bundle-sign', [...flag('bundle', bundle), ...flag('signer', signer)]),
  agreementBundlePack: (ref: string, outPath?: string) =>
    cliInvoke('agreement-bundle-pack', [ref, ...flag('out', outPath)]),
  agreementBundleUnpack: (file: string, json?: boolean) =>
    cliInvoke('agreement-bundle-unpack', [file, ...boolFlag('json', json)], true),
  agreementBundleVerifySignatures: (file: string) =>
    cliInvoke('agreement-bundle-verify-signatures', [file]),

  // ── Agreement pack / unpack ─
  agreementPack: (agreement: string, outPath: string, json?: boolean) =>
    cliInvoke('agreement-pack', [
      ...flag('agreement', agreement),
      ...flag('out', outPath),
      ...boolFlag('json', json),
    ], true),
  agreementUnpack: (file: string, json?: boolean) =>
    cliInvoke('agreement-unpack', [...flag('file', file), ...boolFlag('json', json)], true),

  // ── Share packages ─
  agreementSharePackage: (outPath: string) =>
    cliInvoke('agreement-share-package', flag('out', outPath)),
  agreementSharePackageInspect: (file: string) =>
    cliInvoke('agreement-share-package-inspect', [file]),
  agreementSharePackageVerify: (file: string) =>
    cliInvoke('agreement-share-package-verify', [file], true),
  agreementSharePackageImport: (file: string) =>
    cliInvoke('agreement-share-package-import', [file], true),
  agreementSharePackageList: () => cliInvoke('agreement-share-package-list'),
  agreementSharePackageShow: (ref: string) => cliInvoke('agreement-share-package-show', [ref]),
  agreementSharePackageArchive: (ref: string) => cliInvoke('agreement-share-package-archive', [ref]),
  agreementSharePackagePrune: (olderThanDays?: number, dryRun?: boolean) =>
    cliInvoke('agreement-share-package-prune', [
      ...flag('older-than-days', olderThanDays),
      ...boolFlag('dry-run', dryRun),
    ]),
  agreementSharePackageRemove: (ref: string) => cliInvoke('agreement-share-package-remove', [ref]),

  // ── Private agreement exchange ─
  agreementShare: (agreementHash: string, recipientPubkey: string, outPath?: string) =>
    cliInvoke('agreement-share', [agreementHash, recipientPubkey, ...flag('out', outPath)]),
  agreementDecrypt: (file: string, walletPath?: string, storePrivate?: boolean, json?: boolean) =>
    cliInvoke('agreement-decrypt', [
      file,
      ...flag('wallet', walletPath),
      ...boolFlag('store-private', storePrivate),
      ...boolFlag('json', json),
    ]),

  // ── OTC shortcuts ─
  otcCreate: (params: {
    seller: string; buyer: string; amount: string | number;
    asset: string; paymentMethod: string; timeout: number;
  }) => cliInvoke('otc-create', [
    ...flag('seller', params.seller),
    ...flag('buyer', params.buyer),
    ...flag('amount', String(params.amount)),
    ...flag('asset', params.asset),
    ...flag('payment-method', params.paymentMethod),
    ...flag('timeout', params.timeout),
  ]),
  otcAttest: (agreement: string, message: string, address: string) =>
    cliInvoke('otc-attest', [
      ...flag('agreement', agreement),
      ...flag('message', message),
      ...flag('address', address),
    ]),
  otcSettle: (agreement: string) => cliInvoke('otc-settle', flag('agreement', agreement), true),
  otcStatus: (agreement: string) => cliInvoke('otc-status', flag('agreement', agreement), true),

  // ── Per-milestone operations ─
  agreementMilestoneFund: (ref: string, milestone: string) =>
    cliInvoke('agreement-milestone-fund', [ref, ...flag('milestone', milestone)], true),
  agreementMilestoneRelease: (ref: string, milestone: string, secret: string) =>
    cliInvoke('agreement-milestone-release', [
      ref,
      ...flag('milestone', milestone),
      ...flag('secret', secret),
    ], true),

  // ── Seller / buyer status ─
  sellerStatus: (address?: string) =>
    cliInvoke('seller-status', flag('address', address), true),
  buyerStatus: (address?: string) =>
    cliInvoke('buyer-status', flag('address', address), true),

  // ── Attestor commands ─
  attestorList: (json?: boolean) => cliInvoke('attestor-list', boolFlag('json', json), true),
  attestorRegister: (bond: string | number, from: string) =>
    cliInvoke('attestor-register', [...flag('bond', bond), ...flag('from', from)], true),
  attestorBondStatus: (address?: string, json?: boolean) =>
    cliInvoke('attestor-bond-status', [...flag('address', address), ...boolFlag('json', json)], true),
  attestorSlash: (attestor: string, proof1: string, proof2: string, agreement: string) =>
    cliInvoke('attestor-slash', [
      ...flag('attestor', attestor),
      ...flag('proof1', proof1),
      ...flag('proof2', proof2),
      ...flag('agreement', agreement),
    ], true),
  attestorWithdrawBond: (from: string) =>
    cliInvoke('attestor-withdraw-bond', flag('from', from), true),

  // ── Dispute & resolver commands ─
  agreementDisputeRaise: (params: {
    agreement: string; raisingParty: string; reason: string; evidenceFile: string; key: string;
  }) => cliInvoke('agreement-dispute-raise', [
    ...flag('agreement', params.agreement),
    ...flag('raising-party', params.raisingParty),
    ...flag('reason', params.reason),
    ...flag('evidence-file', params.evidenceFile),
    ...flag('key', params.key),
  ], true),
  agreementDisputeRespond: (params: {
    agreement: string; submitterParty: string; evidenceFile: string;
    evidenceType: string; message: string; key: string;
  }) => cliInvoke('agreement-dispute-respond', [
    ...flag('agreement', params.agreement),
    ...flag('submitter-party', params.submitterParty),
    ...flag('evidence-file', params.evidenceFile),
    ...flag('evidence-type', params.evidenceType),
    ...flag('message', params.message),
    ...flag('key', params.key),
  ], true),
  agreementDisputeResolve: (params: {
    agreement: string; outcome: 'release' | 'refund';
    resolverRole: 'primary' | 'fallback'; message: string; key: string;
  }) => cliInvoke('agreement-dispute-resolve', [
    ...flag('agreement', params.agreement),
    ...flag('outcome', params.outcome),
    ...flag('resolver-role', params.resolverRole),
    ...flag('message', params.message),
    ...flag('key', params.key),
  ], true),
  agreementDisputeReresolve: (params: {
    agreement: string; newResolver: string; newFallback: string; keyA: string; keyB: string;
  }) => cliInvoke('agreement-dispute-reresolve', [
    ...flag('agreement', params.agreement),
    ...flag('new-resolver', params.newResolver),
    ...flag('new-fallback', params.newFallback),
    ...flag('key-a', params.keyA),
    ...flag('key-b', params.keyB),
  ], true),
  agreementDisputeShow: (agreement: string, json?: boolean) =>
    cliInvoke('agreement-dispute-show', [...flag('agreement', agreement), ...boolFlag('json', json)], true),
  agreementDisputeList: () => cliInvoke('agreement-dispute-list', [], true),
  resolverRegister: (params: {
    displayName: string; bio?: string; feeBps?: number; key: string;
  }) => cliInvoke('resolver-register', [
    ...flag('display-name', params.displayName),
    ...flag('bio', params.bio),
    ...flag('fee-bps', params.feeBps),
    ...flag('key', params.key),
  ], true),
  resolverList: (limit?: number, cursor?: string) =>
    cliInvoke('resolver-list', [...flag('limit', limit), ...flag('cursor', cursor)], true),

  // ── Invoices ─
  invoiceGenerate: (agreement: string, outPath?: string) =>
    cliInvoke('invoice-generate', [...flag('agreement', agreement), ...flag('out', outPath)]),
  invoiceImport: (file: string) => cliInvoke('invoice-import', [file]),
};

// ── GENERIC IRIUMD RPC ────────────────────────────────────────
// Thin wrappers over rpc_proxy that target each documented HTTP
// endpoint in docs/API.md. The backend forwards method/path/query/body
// to the active rpc_url with the active bearer token. Returns parsed
// JSON (or raw text wrapped as a JSON string).
const rpcGet = (path: string, query?: Record<string, string | number | undefined>) => {
  const q: Record<string, string> = {};
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') q[k] = String(v);
  }
  return safeInvoke<unknown>('rpc_proxy', { method: 'GET', path, query: q });
};
const rpcPost = (path: string, body?: unknown) =>
  safeInvoke<unknown>('rpc_proxy', { method: 'POST', path, body: body ?? null });

export const rpcCall = {
  // Generic passthroughs.
  get: rpcGet,
  post: rpcPost,

  // ── Node status & health ─
  status: () => rpcGet('/status'),
  peers: () => rpcGet('/peers'),
  networkStatus: () => rpcGet('/network-status'),
  metrics: () => rpcGet('/metrics'),
  addSeed: (addr: string) => rpcPost('/admin/add-seed', { addr }),

  // ── Chain queries ─
  balance: (address: string) => rpcGet('/rpc/balance', { address }),
  utxos: (address: string) => rpcGet('/rpc/utxos', { address }),
  utxo: (txid: string, index: number) => rpcGet('/rpc/utxo', { txid, index }),
  history: (address: string) => rpcGet('/rpc/history', { address }),
  tx: (txid: string) => rpcGet('/rpc/tx', { txid }),
  block: (height: number) => rpcGet('/rpc/block', { height }),
  blockByHash: (hash: string) => rpcGet('/rpc/block_by_hash', { hash }),
  blocks: (from: number, count: number) => rpcGet('/rpc/blocks', { from, count }),
  richlist: (limit?: number) => rpcGet('/rpc/richlist', { limit }),
  feeEstimate: () => rpcGet('/rpc/fee_estimate'),

  // ── Mining ─
  networkHashrate: () => rpcGet('/rpc/network_hashrate'),
  miningMetrics: () => rpcGet('/rpc/mining_metrics'),
  getBlockTemplate: () => rpcGet('/rpc/getblocktemplate'),
  submitBlock: (blockHex: string) => rpcPost('/rpc/submit_block', { block_hex: blockHex }),

  // ── Transactions ─
  submitTx: (txHex: string) => rpcPost('/rpc/submit_tx', { tx_hex: txHex }),

  // ── Marketplace ─
  offersFeed: () => rpcGet('/offers/feed'),
  broadcastOfferTake: (offerId: string, takerAddress: string, agreementHash: string) =>
    rpcPost('/rpc/broadcast_offer_take', {
      offer_id: offerId, taker_address: takerAddress, agreement_hash: agreementHash,
    }),

  // ── Explorer ─
  explorerAgreements: (page?: number, limit?: number) =>
    rpcGet('/explorer/agreements', { page, limit }),
  explorerAgreement: (hash: string) => rpcGet(`/explorer/agreement/${hash}`),
  explorerProofs: (agreementHash?: string, page?: number, limit?: number) =>
    rpcGet('/explorer/proofs', { agreement_hash: agreementHash, page, limit }),
  explorerReputation: (pubkey: string) => rpcGet(`/explorer/reputation/${pubkey}`),
  explorerStats: () => rpcGet('/explorer/stats'),

  // ── HTLC ─
  createHtlc: (body: {
    secret_hash: string; recipient_address: string; refund_address: string; timeout_height: number;
  }) => rpcPost('/rpc/createhtlc', body),
  decodeHtlc: (scriptHex: string) => rpcPost('/rpc/decodehtlc', { script_hex: scriptHex }),
  claimHtlc: (body: Record<string, unknown>) => rpcPost('/rpc/claimhtlc', body),
  refundHtlc: (body: Record<string, unknown>) => rpcPost('/rpc/refundhtlc', body),
  inspectHtlc: (txid: string, index: number) => rpcGet('/rpc/inspecthtlc', { txid, index }),

  // ── BTC SPV header relay (Phase 4 Part 1) ─
  submitBtcHeaders: (body: {
    headers_hex: string; broadcast?: boolean; fee_per_byte?: number;
  }) => rpcPost('/rpc/submitbtcheaders', body),
  getBtcRelayTip: () => rpcGet('/rpc/btcrelaytip'),
  getBtcHeader: (params: { hash?: string; height?: number }) =>
    rpcGet('/rpc/btcheader', params),

  // ── HtlcBtcSwap (Phase 4 Part 2) ─
  createBtcSwap: (body: {
    irm_amount: string; btc_amount_sats: number;
    btc_recipient_address: string;
    recipient_address: string; refund_address: string;
    confirmations_required: number; timeout_height: number;
    fee_per_byte?: number; broadcast?: boolean;
  }) => rpcPost('/rpc/createbtcswap', body),
  claimBtcSwap: (body: {
    funding_txid: string; vout: number;
    destination_address: string;
    btc_block_hash: string; btc_tx_hex: string;
    btc_merkle_branch_hex: string[]; btc_merkle_index: number;
    fee_per_byte?: number; broadcast?: boolean;
  }) => rpcPost('/rpc/claimbtcswap', body),
  refundBtcSwap: (body: {
    funding_txid: string; vout: number; destination_address: string;
    fee_per_byte?: number; broadcast?: boolean;
  }) => rpcPost('/rpc/refundbtcswap', body),
  inspectBtcSwap: (txid: string, vout: number) =>
    rpcGet('/rpc/inspectbtcswap', { txid, vout }),

  // ── SwapOrder book (Phase 4 Part 3) ─
  postSwapOrder: (body: {
    direction: 'sell_irm' | 'buy_irm';
    irm_amount: string; btc_amount_sats: number;
    maker_iriumd_address: string; maker_btc_address: string;
    confirmations_required: number; expiry_blocks_from_now: number;
    expected_hash_hex?: string;
    fee_per_byte?: number; broadcast?: boolean;
  }) => rpcPost('/rpc/postswaporder', body),
  listSwapOrders: (params?: {
    direction?: 'sell_irm' | 'buy_irm' | 'both';
    min_irm?: number; max_irm?: number;
    min_btc?: number; max_btc?: number;
    limit?: number; offset?: number;
    sort?: 'price_asc' | 'price_desc' | 'recent';
  }) => rpcGet('/rpc/listswaporders', params ?? {}),
  getSwapOrder: (txid: string, vout: number) =>
    rpcGet('/rpc/getswaporder', { txid, vout }),
  cancelSwapOrder: (body: {
    order_txid: string; order_vout: number; destination_address: string;
    fee_per_byte?: number; broadcast?: boolean;
  }) => rpcPost('/rpc/cancelswaporder', body),
  fillSwapOrder: (body: {
    order_txid: string; order_vout: number;
    taker_iriumd_address: string; taker_btc_address?: string;
    timeout_blocks_from_now: number;
    fee_per_byte?: number; broadcast?: boolean;
  }) => rpcPost('/rpc/fillswaporder', body),
  sweepExpiredOrder: (body: {
    order_txid: string; order_vout: number;
    fee_per_byte?: number; broadcast?: boolean;
  }) => rpcPost('/rpc/sweepexpiredorder', body),

  // ── LTC SPV header relay (Phase E.1) ─
  submitLtcHeaders: (body: {
    headers_hex: string; broadcast?: boolean; fee_per_byte?: number;
  }) => rpcPost('/rpc/submitltcheaders', body),
  getLtcRelayTip: () => rpcGet('/rpc/ltcrelaytip'),
  getLtcHeader: (params: { hash?: string; height?: number }) =>
    rpcGet('/rpc/ltcheader', params),

  // ── HtlcLtcSwap (Phase C) ─
  createLtcSwap: (body: {
    irm_amount: string; ltc_amount_sats: number;
    ltc_recipient_address: string;
    recipient_address: string; refund_address: string;
    confirmations_required: number; timeout_height: number;
    fee_per_byte?: number; broadcast?: boolean;
  }) => rpcPost('/rpc/createltcswap', body),
  claimLtcSwap: (body: {
    funding_txid: string; vout: number;
    destination_address: string;
    ltc_block_hash: string; ltc_tx_hex: string;
    ltc_merkle_branch_hex: string[]; ltc_merkle_index: number;
    fee_per_byte?: number; broadcast?: boolean;
  }) => rpcPost('/rpc/claimltcswap', body),
  refundLtcSwap: (body: {
    funding_txid: string; vout: number; destination_address: string;
    fee_per_byte?: number; broadcast?: boolean;
  }) => rpcPost('/rpc/refundltcswap', body),
  inspectLtcSwap: (txid: string, vout: number) =>
    rpcGet('/rpc/inspectltcswap', { txid, vout }),

  // ── LtcSwapOrder book (Phase D) ─
  postLtcSwapOrder: (body: {
    direction: 'sell_irm' | 'buy_irm';
    irm_amount: string; ltc_amount_sats: number;
    maker_iriumd_address: string; maker_ltc_address: string;
    confirmations_required: number; expiry_blocks_from_now: number;
    expected_hash_hex?: string;
    fee_per_byte?: number; broadcast?: boolean;
  }) => rpcPost('/rpc/postltcswaporder', body),
  listLtcSwapOrders: (params?: {
    direction?: 'sell_irm' | 'buy_irm' | 'both';
    min_irm?: number; max_irm?: number;
    min_ltc?: number; max_ltc?: number;
    limit?: number; offset?: number;
    sort?: 'price_asc' | 'price_desc' | 'recent';
  }) => rpcGet('/rpc/listltcswaporders', params ?? {}),
  getLtcSwapOrder: (txid: string, vout: number) =>
    rpcGet('/rpc/getltcswaporder', { txid, vout }),
  cancelLtcSwapOrder: (body: {
    order_txid: string; order_vout: number; destination_address: string;
    fee_per_byte?: number; broadcast?: boolean;
  }) => rpcPost('/rpc/cancelltcswaporder', body),
  fillLtcSwapOrder: (body: {
    order_txid: string; order_vout: number;
    taker_iriumd_address: string; taker_ltc_address?: string;
    timeout_blocks_from_now: number;
    fee_per_byte?: number; broadcast?: boolean;
  }) => rpcPost('/rpc/fillltcswaporder', body),
  sweepLtcExpiredOrder: (body: {
    order_txid: string; order_vout: number;
    fee_per_byte?: number; broadcast?: boolean;
  }) => rpcPost('/rpc/sweepltcexpiredorder', body),

  // ── Settlement ─
  createAgreement: (agreement: unknown) => rpcPost('/rpc/createagreement', agreement),
  computeAgreementHash: (agreement: unknown) => rpcPost('/rpc/computeagreementhash', agreement),
  inspectAgreement: (agreement: unknown) => rpcPost('/rpc/inspectagreement', agreement),
  fundAgreement: (body: Record<string, unknown>) => rpcPost('/rpc/fundagreement', body),
  agreementStatus: (agreement: unknown) => rpcPost('/rpc/agreementstatus', { agreement }),
  agreementTimeline: (agreement: unknown) => rpcPost('/rpc/agreementtimeline', { agreement }),
  agreementAudit: (agreement: unknown) => rpcPost('/rpc/agreementaudit', { agreement }),
  agreementReleaseEligibility: (body: Record<string, unknown>) =>
    rpcPost('/rpc/agreementreleaseeligibility', body),
  agreementRefundEligibility: (body: Record<string, unknown>) =>
    rpcPost('/rpc/agreementrefundeligibility', body),
  buildAgreementRelease: (body: Record<string, unknown>) =>
    rpcPost('/rpc/buildagreementrelease', body),
  buildAgreementRefund: (body: Record<string, unknown>) =>
    rpcPost('/rpc/buildagreementrefund', body),
  buildSettlementTx: (body: Record<string, unknown>) =>
    rpcPost('/rpc/buildsettlementtx', body),
  buildOtcTemplate: (body: Record<string, unknown>) =>
    rpcPost('/rpc/buildotctemplate', body),
  checkPolicy: (body: Record<string, unknown>) => rpcPost('/rpc/checkpolicy', body),
  agreementFundingLegs: (body: Record<string, unknown>) =>
    rpcPost('/rpc/agreementfundinglegs', body),
  agreementReceipt: (agreementHash: string) =>
    rpcGet('/rpc/agreementreceipt', { agreement_hash: agreementHash }),
  reputationByAddress: (address: string) => rpcGet(`/rpc/reputation/${address}`),
  listProofs: (agreementHash: string) =>
    rpcPost('/rpc/listproofs', { agreement_hash: agreementHash }),
  getProof: (proofId: string) => rpcPost('/rpc/getproof', { proof_id: proofId }),
  storePolicy: (policy: unknown) => rpcPost('/rpc/storepolicy', policy),
  getPolicy: (agreementHash: string) =>
    rpcPost('/rpc/getpolicy', { agreement_hash: agreementHash }),
  evaluatePolicy: (body: Record<string, unknown>) => rpcPost('/rpc/evaluatepolicy', body),
  listAgreementTxs: (body: Record<string, unknown>) => rpcPost('/rpc/listagreementtxs', body),
  agreementMilestones: (body: Record<string, unknown>) =>
    rpcPost('/rpc/agreementmilestones', body),
  verifyAgreementLink: (body: Record<string, unknown>) =>
    rpcPost('/rpc/verifyagreementlink', body),
  submitProof: (proof: unknown) => rpcPost('/rpc/submitproof', proof),

  // ── Wallet HTTP endpoints (mirror irium-wallet CLI; rarely used
  //     directly from the GUI, exposed for completeness) ─
  walletCreate: (body?: unknown) => rpcPost('/wallet/create', body),
  walletUnlock: (passphrase: string) => rpcPost('/wallet/unlock', { passphrase }),
  walletLock: () => rpcPost('/wallet/lock'),
  walletAddresses: () => rpcGet('/wallet/addresses'),
  walletReceive: () => rpcGet('/wallet/receive'),
  walletNewAddress: () => rpcPost('/wallet/new_address'),
  walletExportWif: (address: string) => rpcGet('/wallet/export_wif', { address }),
  walletImportWif: (wif: string) => rpcPost('/wallet/import_wif', { wif }),
  walletExportSeed: () => rpcGet('/wallet/export_seed'),
  walletImportSeed: (seedHex: string) => rpcPost('/wallet/import_seed', { seed_hex: seedHex }),
  walletSendHttp: (body: Record<string, unknown>) => rpcPost('/wallet/send', body),
};
