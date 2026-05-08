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
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WalletCreateResult {
    pub mnemonic: String,
    pub address: String,
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

// Matches GET /rpc/history: {"address":"Q...","height":20725,"txs":[...]}
#[derive(Debug, Serialize, Deserialize)]
pub struct RpcHistoryEntry {
    pub txid: String,
    pub height: Option<i64>,
    pub output_value: Option<u64>,
    pub is_coinbase: Option<bool>,
    pub index: Option<u32>,
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
    pub timestamp: Option<i64>,
    pub direction: String,
    pub address: Option<String>,
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
    pub offer_id: Option<String>,
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
// ============================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct Reputation {
    pub pubkey: String,
    pub address: Option<String>,
    pub score: f64,
    pub completed: u64,
    pub failed: u64,
    pub default_count: u64,
    pub risk_signal: String,
    pub total_volume: Option<u64>,
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
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GpuDevice {
    pub index: u32,
    pub name: String,
    pub vendor: String,
    pub vram_mb: u64,
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
