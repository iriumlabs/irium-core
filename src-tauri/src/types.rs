use serde::{Deserialize, Serialize};

// ============================================================
// NODE TYPES
// ============================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct NodeStartResult {
    pub success: bool,
    pub message: String,
    pub pid: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BinaryCheckResult {
    pub iriumd: bool,
    pub irium_wallet: bool,
    pub irium_miner: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeStatus {
    pub running: bool,
    pub synced: bool,
    pub height: u64,
    pub network_tip: u64,
    pub tip: String,
    pub peers: u32,
    pub network: String,
    pub version: String,
    pub rpc_url: String,
    pub upnp_active: bool,
    pub upnp_external_ip: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WalletCreateResult {
    pub mnemonic: String,
    pub address: String,
    pub wallet_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BestHeaderTip {
    pub height: u64,
    pub hash: String,
}

// Matches real GET /status response:
// {"height":20725,"peer_count":0,"anchor_loaded":true,"network_era":"Early Miner Era",
//  "best_header_tip":{"height":20725,"hash":"000000..."},...}
#[derive(Debug, Serialize, Deserialize, Default)]
pub struct RpcInfo {
    pub height: Option<u64>,
    pub peer_count: Option<u32>,
    pub best_header_tip: Option<BestHeaderTip>,
    pub anchor_loaded: Option<bool>,
    pub network_era: Option<String>,
}

// Matches real GET /peers response:
// {"peers":[{"multiaddr":"/ip4/...","agent":null,"source":"live","height":20296,...}]}
#[derive(Debug, Serialize, Deserialize)]
pub struct PeersResponse {
    pub peers: Vec<PeerInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PeerInfo {
    pub multiaddr: String,
    pub agent: Option<String>,
    pub source: Option<String>,
    pub height: Option<u64>,
    pub last_seen: Option<f64>,
    pub dialable: Option<bool>,
}

// Parsed subset of GET /metrics. The endpoint returns Prometheus-style
// text (`metric_name <value>` per line); we extract only the two
// counters the GUI cares about. Other metrics are ignored.
//
// Frontend uses inbound_accepted_total to distinguish:
//   - 0 + UPnP failed → port forwarding not working (or no peer has
//     discovered us yet)
//   - 0 + UPnP active → UPnP did its job; counter increments later as
//     peers dial in
//   - > 0 → inbound connections are arriving regardless of UPnP, which
//     confirms manual port forwarding is working
#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct NodeMetrics {
    pub inbound_accepted_total: u64,
    pub outbound_dial_success_total: u64,
}

// Returned by get_system_info() — small hardware snapshot the GUI fetches
// once at startup. cpu_cores comes from std::thread::available_parallelism()
// which is more accurate than navigator.hardwareConcurrency for container
// and scheduler-constrained environments.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SystemInfo {
    pub cpu_cores: usize,
}

// Matches GET /rpc/fee_estimate: {"min_fee_per_byte":1.0,"mempool_size":0}
#[derive(Debug, Serialize, Deserialize)]
pub struct FeeEstimateResponse {
    pub min_fee_per_byte: Option<f64>,
    pub mempool_size: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MempoolInfo {
    pub size: u64,
    pub bytes: u64,
}

// Matches GET /rpc/balance: {"address":"Q...","balance":0,"mined_balance":0,...}
#[derive(Debug, Serialize, Deserialize)]
pub struct RpcBalance {
    pub address: String,
    pub balance: u64,
    pub mined_balance: Option<u64>,
    pub utxo_count: Option<u64>,
}

// Matches GET /rpc/history: {"txid":"...","height":N,"received":N,"spent":N,"net":N,"is_coinbase":bool}
#[derive(Debug, Serialize, Deserialize)]
pub struct RpcHistoryEntry {
    pub txid: String,
    pub height: u64,
    pub received: u64,
    pub spent: u64,
    pub net: i64,
    pub is_coinbase: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RpcHistoryResponse {
    pub address: String,
    pub height: u64,
    pub txs: Vec<RpcHistoryEntry>,
}

// ============================================================
// WALLET TYPES (frontend-facing)
// ============================================================

#[derive(Debug, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct NewAddressResult {
    pub address: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WalletBalance {
    pub confirmed: u64,
    pub unconfirmed: u64,
    pub total: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AddressInfo {
    pub address: String,
    pub label: Option<String>,
    pub balance: Option<u64>,
    pub index: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SendResult {
    pub txid: String,
    pub amount: u64,
    pub fee: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Transaction {
    pub txid: String,
    pub amount: i64,
    pub fee: Option<u64>,
    pub confirmations: u64,
    /// Block height of the tx (0 if unconfirmed). Surfaced so the frontend
    /// can compute `currentTip - height + 1` consistently in both the list
    /// and the detail modal — `confirmations` from the binary alone has been
    /// observed to disagree with the modal's RPC-derived figure.
    pub height: Option<u64>,
    pub timestamp: Option<i64>,
    pub direction: String,
    pub address: Option<String>,
    /// Whether the transaction is a coinbase (mining reward). Surfaced
    /// directly from `/rpc/history` so the frontend can render the row
    /// with a Pickaxe icon + "Mining Reward" label instead of a regular
    /// Receive.
    pub is_coinbase: Option<bool>,
}

// ============================================================
// OFFER TYPES — raw wallet output
//
// Real offer-list/offer-show --json output:
// {"offer_id":"d1-gossip-t4","seller_address":"Q9Kx...","seller_pubkey":"03e9...",
//  "amount_irm":100000000,"payment_method":"bank-transfer","status":"open",
//  "created_at":1777624133,"timeout_height":25000,"source":"remote:..."}
// ============================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RawOffer {
    pub offer_id: String,
    pub seller_address: Option<String>,
    pub seller_pubkey: Option<String>,
    pub amount_irm: u64,
    pub payment_method: Option<String>,
    pub status: Option<String>,
    pub created_at: Option<i64>,
    pub timeout_height: Option<u64>,
    pub price_note: Option<String>,
    pub payment_instructions: Option<String>,
    pub source: Option<String>,
}

// offer-list wraps offers: {"count":13,"offers":[...]}
#[derive(Debug, Serialize, Deserialize)]
pub struct RawOfferListResponse {
    pub count: u64,
    pub offers: Vec<RawOffer>,
}

// ============================================================
// OFFER TYPES — frontend-facing
// ============================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OfferReputation {
    pub score: Option<f64>,
    pub completed: Option<u64>,
    pub default_count: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Offer {
    pub id: String,
    pub seller: Option<String>,
    pub amount: u64,
    pub description: Option<String>,
    pub payment_method: Option<String>,
    pub status: Option<String>,
    pub created_at: Option<i64>,
    pub ranking_score: Option<f64>,
    pub reputation: Option<OfferReputation>,
    pub risk_signal: Option<String>,
}

impl From<RawOffer> for Offer {
    fn from(r: RawOffer) -> Self {
        Offer {
            id: r.offer_id,
            seller: r.seller_address,
            amount: r.amount_irm,
            description: r.price_note.or(r.payment_instructions),
            payment_method: r.payment_method,
            status: r.status,
            created_at: r.created_at,
            ranking_score: None,
            reputation: None,
            risk_signal: None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateOfferParams {
    pub amount_sats: u64,
    pub description: Option<String>,
    pub payment_method: Option<String>,
    pub payment_instructions: Option<String>,
    pub timeout_blocks: Option<u64>,
    pub offer_id: Option<String>,
    // Optional explicit seller. Falls back to the wallet's first address
    // when None — preserves the prior implicit behaviour.
    pub seller_address: Option<String>,
}

// offer-create --json output (same fields as offer show, plus saved_path)
#[derive(Debug, Serialize, Deserialize)]
pub struct OfferCreateRaw {
    pub offer_id: String,
    pub saved_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateOfferResult {
    pub id: String,
    pub success: bool,
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OfferTakeResult {
    pub agreement_id: String,
    pub offer_id: String,
    pub success: bool,
    pub message: Option<String>,
}

// ============================================================
// FEED TYPES
//
// feed-list --json: {"feeds":["url1","url2"],"total":2}
// offer-feed-sync --json: {"feeds":[...],"feeds_processed":3,"total_errors":2,"total_imported":0,...}
// ============================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct RawFeedListResponse {
    pub feeds: Vec<String>,
    pub total: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct FeedSyncRawResponse {
    pub feeds_processed: Option<u64>,
    pub total_errors: Option<u64>,
    pub total_imported: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FeedEntry {
    pub url: String,
    pub last_synced: Option<i64>,
    pub offer_count: Option<u64>,
    pub status: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FeedSyncResult {
    pub synced: u32,
    pub failed: u32,
    pub total_offers: u64,
}

// ============================================================
// AGREEMENT TYPES
//
// agreement-local-store-list --json after creating an agreement:
// {"raw_agreement_count":1,"stored_raw_agreements":[
//   {"agreement_id":"test-otc-001","agreement_hash":"80e0c2...","path":"/.irium/..."}
// ],...}
//
// otc-create --json output:
// {"agreement_hash":"80e0c2...","agreement_id":"test-otc-001","saved_path":"/.irium/..."}
// ============================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct RawAgreementEntry {
    pub agreement_id: String,
    pub agreement_hash: String,
    pub path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct AgreementStoreListResponse {
    pub raw_agreement_count: Option<u64>,
    pub bundle_count: Option<u64>,
    pub stored_raw_agreements: Option<Vec<RawAgreementEntry>>,
    pub stored_bundles: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OtcCreateResult {
    pub agreement_id: String,
    pub agreement_hash: String,
    pub saved_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Agreement {
    pub id: String,
    pub hash: Option<String>,
    pub template: Option<String>,
    pub buyer: Option<String>,
    pub seller: Option<String>,
    pub amount: u64,
    pub status: String,
    pub proof_status: Option<String>,
    pub release_eligible: Option<bool>,
    pub created_at: Option<i64>,
    pub deadline: Option<i64>,
    pub policy: Option<AgreementPolicy>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgreementPolicy {
    pub id: String,
    pub kind: String,
    pub threshold: Option<u64>,
    pub attestors: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateAgreementParams {
    pub template: String,
    pub counterparty: String,
    pub amount_sats: u64,
    pub deadline_hours: Option<u64>,
    pub memo: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AgreementResult {
    pub agreement_id: String,
    pub hash: Option<String>,
    pub success: bool,
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReleaseResult {
    pub txid: Option<String>,
    pub success: bool,
    pub message: Option<String>,
}

// ============================================================
// PROOF TYPES
// ============================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct Proof {
    pub id: String,
    pub agreement_id: String,
    pub status: String,
    pub submitted_at: Option<i64>,
    pub expires_at: Option<i64>,
    pub policy_result: Option<String>,
    pub attestors: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProofSubmitResult {
    pub proof_id: String,
    pub status: String,
    pub success: bool,
    pub message: Option<String>,
}

// ============================================================
// REPUTATION TYPES
//
// Mirrors the exact JSON shape returned by
//   `irium-wallet reputation-show <addr> --json`
//
// Note on field types: success_rate, completion_rate, dispute_rate and
// recent.success_rate are returned as formatted *strings* ("83.3"), not
// numbers, so they are deserialized as Option<String> and parsed on the
// frontend with parseFloat() at render time.
// ============================================================

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct ReputationRecent {
    pub satisfied: Option<u64>,
    pub defaults: Option<u64>,
    pub success_rate: Option<String>,
    pub risk: String,
    pub window: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Reputation {
    pub seller: String,
    pub total_agreements: u64,
    pub satisfied: Option<u64>,
    pub defaults: Option<u64>,
    pub success_rate: Option<String>,
    pub completion_rate: Option<String>,
    pub dispute_rate: Option<String>,
    pub avg_proof_response_secs: Option<f64>,
    pub disputes: Option<u64>,
    pub self_trade_count: u64,
    pub sybil_suppressed: bool,
    pub summary: String,
    pub risk: String,
    pub recent: ReputationRecent,
}

// ============================================================
// MINER TYPES
// ============================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct MinerStatus {
    pub running: bool,
    pub hashrate_khs: f64,
    pub blocks_found: u64,
    pub uptime_secs: u64,
    pub difficulty: u64,
    pub threads: u32,
    pub address: Option<String>,
    // Last sync-progress line captured from the miner sidecar's stdout.
    // None once mining actually starts (a rate line clears it). Surfaced
    // to the GUI so the user sees "Syncing blocks…" rather than 0 KH/s
    // during the 30–60 s startup window where irium-miner is downloading
    // chain state from iriumd before it begins hashing.
    pub sync_status: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GpuDevice {
    pub index: u32,
    pub name: String,
    pub vendor: String,
    pub vram_mb: u64,
}

// ============================================================
// EXPLORER (irium-explorer sidecar on localhost:38310)
// ============================================================

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct ExplorerNetworkStats {
    pub height: u64,
    pub total_blocks: u64,
    pub supply_irm: f64,
    pub peer_count: u32,
    pub active_miners: u32,
    pub hashrate: f64,
    pub difficulty: f64,
    pub diff_change_1h_pct: f64,
    pub diff_change_24h_pct: f64,
    pub avg_block_time: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExplorerPeer {
    pub multiaddr: String,
    pub dialable: bool,
    pub height: Option<u64>,
    pub last_seen: Option<f64>,
    pub agent: Option<String>,
    pub source: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExplorerBlock {
    pub height: u64,
    pub hash: String,
    pub miner_address: Option<String>,
    pub time: u64,
    pub tx_count: u32,
    pub prev_hash: Option<String>,
    pub merkle_root: Option<String>,
    pub bits: Option<String>,
    pub nonce: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct NetworkHashrateInfo {
    pub hashrate: Option<f64>,
    pub difficulty: Option<f64>,
    pub height: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GpuMinerStatus {
    pub running: bool,
    pub hashrate_khs: f64,
    pub blocks_found: u64,
    pub device_name: Option<String>,
    pub temperature_c: Option<f64>,
    pub power_w: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StratumStatus {
    pub connected: bool,
    pub pool_url: Option<String>,
    pub worker: Option<String>,
    pub shares_accepted: u64,
    pub shares_rejected: u64,
    pub uptime_secs: u64,
}

// ============================================================
// SETTLEMENT TEMPLATE PARAMS
// ============================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct OtcParams {
    pub buyer: String,
    pub seller: String,
    pub amount_sats: u64,
    pub asset_reference: Option<String>,
    pub payment_method: Option<String>,
    pub deadline_hours: Option<u64>,
    pub memo: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FreelanceParams {
    pub client: String,
    pub contractor: String,
    pub amount_sats: u64,
    pub deadline_hours: Option<u64>,
    pub scope: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MilestoneParams {
    pub payer: String,
    pub payee: String,
    pub amount_sats: u64,
    pub milestone_count: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DepositParams {
    pub depositor: String,
    pub recipient: String,
    pub amount_sats: u64,
    pub deadline_hours: Option<u64>,
}

// ============================================================
// UPDATE CHECK
// ============================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateCheckResult {
    pub available: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_notes: Option<String>,
    pub release_url: Option<String>,
}

/// Result of checking the irium node source repo for new commits.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NodeUpdateCheckResult {
    pub has_update: bool,
    pub current_commit: String,
    pub current_commit_short: String,
    pub latest_commit: String,
    pub latest_commit_short: String,
    pub latest_message: String,
    pub latest_author: String,
    pub latest_date: String,
    pub commits_behind: u32,
    pub compare_url: String,
}

/// Result of pulling the irium-source submodule to the latest remote commit.
#[derive(Debug, Serialize, Deserialize)]
pub struct NodeUpdatePullResult {
    pub success: bool,
    pub new_commit: String,
    pub new_commit_short: String,
    pub message: String,
}

// ============================================================
// MULTISIG TYPES
// ============================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct MultisigCreateResult {
    pub script_pubkey: String,
    pub address: String,
    pub threshold: u32,
    pub pubkeys: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MultisigSpendResult {
    pub raw_tx: Option<String>,
    pub txid: Option<String>,
    pub success: bool,
    pub message: Option<String>,
}

// ============================================================
// INVOICE TYPES
// ============================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Invoice {
    pub id: String,
    pub recipient: String,
    pub amount: u64,
    pub reference: String,
    pub expires_height: Option<u64>,
    pub created_at: Option<i64>,
    pub status: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct InvoiceImportResult {
    pub success: bool,
    pub invoice_id: Option<String>,
    pub invoice: Option<Invoice>,
    pub message: Option<String>,
}

// ============================================================
// ELIGIBILITY / SPEND TYPES
// ============================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct SpendEligibilityResult {
    pub eligible: bool,
    pub reason: Option<String>,
    pub funding_txid: Option<String>,
    pub amount: Option<u64>,
    pub timelock_remaining: Option<u64>,
}

// ============================================================
// POLICY TYPES
// ============================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProofPolicy {
    pub policy_id: String,
    pub agreement_hash: String,
    pub kind: String,
    pub attestor: Option<String>,
    pub proof_type: Option<String>,
    pub created_at: Option<i64>,
    pub raw: Option<serde_json::Value>,
}

// ============================================================
// AGREEMENT STATUS
// ============================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct AgreementStatusResult {
    pub agreement_id: String,
    pub agreement_hash: Option<String>,
    pub status: String,
    pub funded: Option<bool>,
    pub funding_txid: Option<String>,
    pub release_eligible: Option<bool>,
    pub refund_eligible: Option<bool>,
    pub current_height: Option<u64>,
    pub proof_status: Option<String>,
}

// ============================================================
// REPUTATION ACTION TYPES
// ============================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct ReputationOutcomeResult {
    pub success: bool,
    pub seller: String,
    pub outcome: String,
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SelfTradeCheckResult {
    pub is_self_trade: bool,
    pub seller: String,
    pub buyer: String,
    pub message: Option<String>,
}

// ============================================================
// SELLER / BUYER STATUS TYPES
// ============================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct SellerStatus {
    pub address: String,
    pub active_offers: Option<u64>,
    pub completed_agreements: Option<u64>,
    pub open_agreements: Option<u64>,
    pub total_volume: Option<u64>,
    pub reputation_score: Option<f64>,
    pub can_create_offers: Option<bool>,
    pub restrictions: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BuyerStatus {
    pub address: String,
    pub active_agreements: Option<u64>,
    pub completed_agreements: Option<u64>,
    pub total_spent: Option<u64>,
    pub reputation_score: Option<f64>,
    pub can_take_offers: Option<bool>,
    pub restrictions: Option<Vec<String>>,
}

// ============================================================
// DISPUTE TYPES
// ============================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DisputeEntry {
    pub id: String,
    pub agreement_id: String,
    pub reason: Option<String>,
    pub status: String,
    pub opened_at: Option<i64>,
    pub resolved_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DisputeOpenResult {
    pub dispute_id: Option<String>,
    pub success: bool,
    pub message: Option<String>,
}

// ============================================================
// NETWORK METRICS
// ============================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct NetworkMetrics {
    pub height: u64,
    pub peers: u32,
    pub mempool_size: u64,
    pub hashrate_khs: Option<f64>,
    pub difficulty: Option<f64>,
    pub synced: bool,
}

// ============================================================
// EXPLORER TYPES
// ============================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExplorerAgreement {
    pub id: String,
    pub hash: Option<String>,
    pub template: Option<String>,
    pub buyer: Option<String>,
    pub seller: Option<String>,
    pub amount: u64,
    pub status: String,
    pub created_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExplorerStats {
    pub total_agreements: Option<u64>,
    pub active_agreements: Option<u64>,
    pub total_volume: Option<u64>,
    pub total_proofs: Option<u64>,
    pub registered_attestors: Option<u64>,
}

// ============================================================
// FEED OPS TYPES
// ============================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct FeedDiscoverResult {
    pub discovered: Vec<String>,
    pub count: u64,
}

// ============================================================
// AGREEMENT SIGNING / STORE TYPES
// ============================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct AgreementSignResult {
    pub agreement_hash: String,
    pub signer: String,
    pub success: bool,
    pub signature_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AgreementVerifySignatureResult {
    pub valid: bool,
    pub signer: Option<String>,
    pub agreement_hash: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AgreementDecryptResult {
    pub agreement_id: Option<String>,
    pub agreement_hash: Option<String>,
    pub decrypted: serde_json::Value,
    pub success: bool,
}

// ============================================================
// DIAGNOSTICS
// ============================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct DiagnosticCheck {
    pub label: String,
    pub passed: bool,
    pub detail: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DiagnosticsResult {
    pub checks: Vec<DiagnosticCheck>,
    pub passed: u32,
    pub total: u32,
}
