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
pub struct NodeStatus {
    pub running: bool,
    pub synced: bool,
    pub height: u64,
    pub tip: String,
    pub peers: u32,
    pub network: String,
    pub version: String,
    pub rpc_url: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct RpcInfo {
    pub height: Option<u64>,
    pub tip: Option<String>,
    pub peers: Option<u32>,
    pub network: Option<String>,
    pub version: Option<String>,
    pub synced: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PeerInfo {
    pub addr: String,
    pub height: Option<u64>,
    pub user_agent: Option<String>,
    pub inbound: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MempoolInfo {
    pub size: u64,
    pub bytes: u64,
}

// ============================================================
// WALLET TYPES
// ============================================================

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
    pub direction: String, // "send" | "receive"
    pub address: Option<String>,
}

// ============================================================
// OFFER TYPES
// ============================================================

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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OfferReputation {
    pub score: Option<f64>,
    pub completed: Option<u64>,
    pub default_count: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateOfferParams {
    pub amount_sats: u64,
    pub description: Option<String>,
    pub payment_method: Option<String>,
    pub offer_id: Option<String>,
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
// ============================================================

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
// ============================================================

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

// ============================================================
// SETTLEMENT TEMPLATE PARAMS
// ============================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct OtcParams {
    pub buyer: String,
    pub seller: String,
    pub amount_sats: u64,
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
