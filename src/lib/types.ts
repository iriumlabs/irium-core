// Irium Core GUI - TypeScript Types
// Mirrors src-tauri/src/types.rs

// ============================================================
// NODE
// ============================================================

export interface NodeStatus {
  running: boolean;
  synced: boolean;
  height: number;
  network_tip: number;
  tip: string;
  peers: number;
  network: string;
  version: string;
  rpc_url: string;
  upnp_active: boolean;
  upnp_external_ip?: string;
  // FIX 1 (UPnP): router accepted AddPortMapping but the WAN IP it
  // reports is itself RFC1918 / CGNAT / link-local. Mapping is alive
  // on this router but inbound from the public internet still fails.
  // Help / Dashboard surface this as "Inactive (double NAT)" with a
  // tooltip explaining the diagnosis.
  upnp_double_nat?: boolean;
  // FIX 1 interim mitigation. `synced` is the existing "within 10 blocks of
  // network tip" check — it is true throughout the post-restart rewind
  // window and is not safe to gate Send on. `fully_synced` adds two
  // stricter conditions: persisted state has caught up to the in-memory
  // tip, and no gap-healer block holes remain. Send is disabled until
  // all three are satisfied.
  persisted_height: number;
  gap_healer_pending_count: number;
  fully_synced: boolean;
}

// Subset of iriumd's /metrics — only the counters the GUI consumes.
// inbound_accepted_total is the authoritative "port forwarding works"
// signal: it increments whenever iriumd accepts a connection from an
// external peer, regardless of whether UPnP or manual NAT config did
// the work. Settings page uses this to distinguish "UPnP active" from
// "manual forwarding confirmed" vs "inactive — outbound only".
export interface NodeMetrics {
  inbound_accepted_total: number;
  outbound_dial_success_total: number;
}

// Returned by reset_node_state_keep_blocks. The Rust command renames
// ~/.irium/state/ to ~/.irium/state.bak-<unix_ms>/ and recreates a fresh
// state directory; blocks/ is preserved so iriumd rebuilds the UTXO set
// from local block files on next start (~5-15 min) instead of a full
// network resync (~hours). state_existed=false means there was no state
// dir to rename (e.g. fresh install) — backup_path is still computed but
// the UI should show a "no backup needed" message in that case.
export interface ResetNodeStateResult {
  success: boolean;
  backup_path: string | null;
  state_existed: boolean;
}

// Returned by get_system_info — cpu_cores reflects
// std::thread::available_parallelism() on the host.
export interface SystemInfo {
  cpu_cores: number;
}

// Returned by wallet_create — `create-wallet --bip32` produces all three
// fields below via two follow-up CLI calls (list-addresses + export-mnemonic).
// The wallet binary does NOT expose a raw public key or a hex private key, so
// neither is included here. WIF (the portable private-key format) is fetched
// separately via wallet.readWif(address) for any address the caller needs.
export interface WalletCreateResult {
  mnemonic: string;
  address: string;
  wallet_path: string;
}

// Returned by list_wallet_files() — one entry per wallet*.json under ~/.irium/.
export interface WalletFileInfo {
  path:      string;   // absolute path
  name:      string;   // file name (e.g. "wallet.json", "wallet-2.json")
  size:      number;   // bytes
  is_active: boolean;  // matches state.wallet_path
}

// Returned by get_wallet_info(path) — read-only inspection of a wallet
// file. `balance` is null per-address when the RPC didn't return a value
// for that address; `total_balance` is null when EVERY address fetch
// failed (RPC offline). total_balance === 0 means "node confirmed zero"
// across every address — the UI uses this distinction to pick the right
// warning tone in the Delete confirmation modal.
export interface WalletInfoAddress {
  address: string;
  balance: number | null;
}
export interface WalletInfo {
  name:          string;
  address_count: number;
  addresses:     WalletInfoAddress[];
  total_balance: number | null;
}

// Mirror of iriumd's GET /wallet/info response (the on-node wallet
// status, not the per-file inspector above). `mode` discriminates the
// next user-facing flow:
//   - "none"      -> Onboarding (create or recover)
//   - "plaintext" -> forced migration modal before anything else
//   - "encrypted" -> unlock prompt (or already unlocked -> wallet UI)
// `plaintext_backups` lists `.plaintext.bak.<unix-secs>` files left
// behind by migrate_to_encrypted so the UI can warn the operator to
// delete them after verification.
export type NodeWalletMode = 'none' | 'plaintext' | 'encrypted';

export interface NodeWalletInfo {
  exists:             boolean;
  mode:               NodeWalletMode;
  path:               string;
  is_unlocked:        boolean;
  plaintext_backups:  string[];
}

export interface NodeStartResult {
  success: boolean;
  message: string;
  pid?: number;
}

export interface BinaryCheckResult {
  iriumd: boolean;
  irium_wallet: boolean;
  irium_miner: boolean;
}

export interface PeerInfo {
  multiaddr: string;
  agent?: string;
  source?: string;
  height?: number;
  last_seen?: number;
  dialable?: boolean;
}

export interface MempoolInfo {
  size: number;
  // H-18 fix: `bytes` removed — iriumd doesn't expose total mempool byte size.
}

// ============================================================
// WALLET
// ============================================================

export interface WalletBalance {
  confirmed: number;
  unconfirmed: number;
  total: number;
}

export interface AddressInfo {
  address: string;
  label?: string;
  balance?: number;
  index?: number;
}

export interface SendResult {
  txid: string;
  amount: number;
  fee: number;
}

export interface Transaction {
  txid: string;
  amount: number; // signed: positive=receive, negative=send (in sats)
  fee?: number;
  confirmations: number;
  // Block height of the tx (undefined / 0 → unconfirmed). Frontend uses this
  // with the current chain-tip height (from `nodeStatus.height`) to compute
  // confirmations consistently across the list view and the detail modal.
  height?: number;
  timestamp?: number;
  direction: "send" | "receive";
  address?: string;
  // Whether this is a coinbase (mining reward) tx. Surfaced from the RPC
  // so the row can render with a Pickaxe icon + "Mining Reward" label.
  is_coinbase?: boolean;
  // FIX #126: true for entries surfaced from the wallet's local
  // pending-tx cache (broadcast but not yet mined). The list view
  // renders them with an amber "Pending — awaiting confirmation"
  // badge. Cleared automatically by the Tauri side once the txid
  // appears in confirmed /rpc/history.
  pending?: boolean;
}

/**
 * Single source of truth for the badge text shown next to a wallet
 * address. The hero, AddressCard, ManageWalletsPanel rows, and TopBar all
 * call this so they stay in lock-step when a user renames an address.
 *
 *   Primary, no label       →  "Primary"
 *   Primary, has label      →  "Primary · <label>"
 *   Non-primary, no label   →  "Addr N"   (N = index + 1)
 *   Non-primary, has label  →  "<label>"
 */
export function getAddressBadgeText(
  address: string,
  index: number,
  labels: Record<string, string>,
): string {
  const custom = labels[address];
  if (index === 0) {
    return custom ? `Primary · ${custom}` : 'Primary';
  }
  return custom || `Addr ${index + 1}`;
}

/**
 * Confirmations a tx has, given its block height and the current chain tip.
 * A tx in the tip block has 1 confirmation, not 0. Returns 0 when the tx is
 * unconfirmed (height undefined or 0) or the tip isn't known yet.
 *
 * Used by both the wallet transaction list and the detail modal so the two
 * views always agree on Pending / Confirmed.
 */
export function computeConfirmations(
  txHeight: number | undefined | null,
  currentTip: number | undefined | null,
): number {
  if (!txHeight || txHeight <= 0) return 0;
  if (!currentTip || currentTip < txHeight) return 0;
  return currentTip - txHeight + 1;
}

// ============================================================
// OFFERS
// ============================================================

export interface OfferReputation {
  score?: number;
  completed?: number;
  default_count?: number;
}

export interface Offer {
  id: string;
  seller?: string;
  amount: number; // satoshis
  description?: string;
  payment_method?: string;
  // Free-text describing what the seller wants in return (e.g. "50 USDT",
  // "200 EUR cash", "1 BTC"). Set at offer-creation time when the user
  // fills in the asset/payment-reference field. Optional because older
  // offers and minimal CreateOfferParams calls may omit it.
  asset_reference?: string;
  status?: string;
  created_at?: number;
  ranking_score?: number;
  reputation?: OfferReputation;
  risk_signal?: string;
  // Block height at which the offer expires. Returned by /offers/feed per
  // API.md §Marketplace L612. Optional because not every offer source
  // (e.g. an offer authored in an older binary) includes it.
  timeout_height?: number;
  // BUG 2 fix: 'local' for offers the user created on this machine (a JSON
  // file exists under ~/.irium/offers/), 'remote:<feed-url>' for offers
  // fetched from another seller's feed. Used by the Marketplace UI to gate
  // the Delete button — only local offers have a file to remove.
  source?: string;
}

export interface CreateOfferParams {
  amount_sats: number;
  description?: string;
  payment_method?: string;
  payment_instructions?: string;
  timeout_blocks?: number;
  offer_id?: string;
  // Optional explicit seller address. Falls back to the wallet's first
  // derived address on the backend when omitted.
  seller_address?: string;
  // FIX 3: settlement template — when set, the wallet sidecar at
  // offer-take time dispatches to the corresponding agreement builder.
  // Omitted means legacy OTC behaviour.
  template_type?: 'otc' | 'freelance' | 'milestone' | 'deposit';
  // FIX 3: number of milestones for template_type==='milestone'.
  milestone_count?: number;
}

export interface CreateOfferResult {
  id: string;
  success: boolean;
  message?: string;
}

export interface OfferTakeResult {
  agreement_id: string;
  offer_id: string;
  success: boolean;
  message?: string;
}

// ============================================================
// FEEDS
// ============================================================

export interface FeedEntry {
  url: string;
  last_synced?: number;
  offer_count?: number;
  status?: string;
}

export interface FeedSyncResult {
  synced: number;
  failed: number;
  total_offers: number;
}

// ============================================================
// AGREEMENTS
// ============================================================

export type AgreementStatus =
  | "open"
  | "pending"   // created locally, awaiting agreement-fund broadcast
  | "funded"
  | "released"
  | "refunded"
  | "expired"   // deadline passed without proof or release
  | "disputed_metadata_only";  // dispute raised, awaiting resolver attestation

export type ProofStatus =
  | "none"
  | "active"
  | "expired"
  | "satisfied"
  | "unsatisfied";

export interface AgreementPolicy {
  id: string;
  kind: string;
  threshold?: number;
  attestors?: string[];
}

export interface Agreement {
  id: string;
  hash?: string;
  template?: string;
  buyer?: string;
  seller?: string;
  amount: number; // satoshis
  status: AgreementStatus;
  proof_status?: ProofStatus;
  release_eligible?: boolean;
  created_at?: number;
  deadline?: number;
  policy?: AgreementPolicy;
}

export interface CreateAgreementParams {
  template: string;
  counterparty: string;
  amount_sats: number;
  deadline_hours?: number;
  memo?: string;
}

export interface AgreementResult {
  agreement_id: string;
  hash?: string;
  success: boolean;
  message?: string;
}

export interface ReleaseResult {
  txid?: string;
  success: boolean;
  message?: string;
}

// ============================================================
// PROOFS
// ============================================================

export interface Proof {
  id: string;
  agreement_id: string;
  status: ProofStatus;
  submitted_at?: number;
  expires_at?: number;
  policy_result?: string;
  attestors?: string[];
}

export interface ProofSubmitResult {
  proof_id: string;
  status: string;
  success: boolean;
  message?: string;
}

// ============================================================
// REPUTATION
// ============================================================

export type RiskSignal = "low" | "medium" | "high" | "unknown";

// Sub-object inside Reputation — recent-window summary.
// success_rate is returned as a formatted string like "83.3" (not a float),
// so callers should parseFloat() before doing numeric comparisons.
export interface ReputationRecent {
  satisfied:    number | null;
  defaults:     number | null;
  success_rate: string | null;
  risk:         RiskSignal;
  window:       number | null;  // block-window size used for the rollup
}

// Matches the exact JSON returned by `irium-wallet reputation-show --json`.
// Nullable fields are null when the seller has no history on this node.
// Rate fields (success_rate, completion_rate, dispute_rate) are returned as
// formatted strings like "83.3" — use parseFloat() when computing numerically.
export interface Reputation {
  seller:                   string;
  total_agreements:         number;
  satisfied:                number | null;
  defaults:                 number | null;
  success_rate:             string | null;
  completion_rate:          string | null;
  dispute_rate:             string | null;
  avg_proof_response_secs:  number | null;
  disputes:                 number | null;
  self_trade_count:         number;
  sybil_suppressed:         boolean;
  summary:                  string;
  risk:                     RiskSignal;
  recent:                   ReputationRecent;
}

// ============================================================
// MINER
// ============================================================

export interface MinerStatus {
  running: boolean;
  hashrate_khs: number;
  blocks_found: number;
  uptime_secs: number;
  difficulty: number;
  threads: number;
  address?: string;
  // Last sync-progress line from the miner sidecar (e.g.
  // "[sync] Miner downloading blocks 1..21269 from node"). Present
  // during the 30–60 s startup window where the miner catches up to
  // the chain tip; cleared the moment the first rate line arrives.
  sync_status?: string;
}

export interface GpuDevice {
  index: number;
  name: string;
  vram_mb: number;
  vendor: string;
}

export interface GpuPlatformDevice {
  index: number;
  name: string;
}

export interface GpuPlatform {
  index: number;
  name: string;
  devices: GpuPlatformDevice[];
  is_discrete: boolean;
}

export interface GpuMinerStatus {
  running: boolean;
  hashrate_khs: number;
  blocks_found: number;
  // C-9 fix: TS previously declared uptime_secs, difficulty, device_index,
  // fan_pct, address as required/optional fields that the Rust GpuMinerStatus
  // struct does not actually serialize. Removed to match what the backend
  // sends. If those fields are needed in the future, add them to the Rust
  // side first (src-tauri/src/types.rs and the get_gpu_miner_status builder).
  device_name?: string;
  temperature_c?: number;
  power_w?: number;
}

// A block found by the CPU or GPU miner. Mirrors the Rust FoundBlock
// struct in src-tauri/src/types.rs. Hash is "" when the miner sidecar
// hasn't surfaced one yet (text-mode CPU output). Header fields (prev_hash,
// merkle_root, bits, nonce) are "" / 0 until fetch_block_details fills them
// from the iriumd RPC response.
export interface FoundBlock {
  height: number;
  hash: string;
  timestamp: number;
  reward_sats: number;
  prev_hash: string;
  merkle_root: string;
  bits: string;
  nonce: number;
  miner_address?: string;
  // True when the chain's canonical miner for this height differs from the
  // user's wallet address (i.e. another miner won the race). Defaulted to
  // false by the Rust shell; older shells that don't emit it will leave
  // this undefined which JS treats as falsy — back-compatible.
  orphaned?: boolean;
}

// Phase 1A: discriminator for stratum-tab activity-log entries.
// Matches Rust StratumEventKind with #[serde(rename_all = "snake_case")].
export type StratumEventKind = 'accepted' | 'rejected' | 'error';

// Phase 1A: one entry in the stratum-tab activity log. ts is unix seconds
// (same clock as StratumStatus.last_share_time). detail carries the reject
// reason or error text; omitted for accepted entries.
export interface StratumEvent {
  ts: number;
  kind: StratumEventKind;
  detail?: string;
}

export interface StratumStatus {
  connected: boolean;
  pool_url?: string;
  worker?: string;
  shares_accepted: number;
  shares_rejected: number;
  pool_hashrate_khs?: number;
  pool_diff?: number;
  last_share_time?: number;
  // Phase 1A: own miner's local hashrate in kH/s. Populated from the
  // shared `miner_hashrate` field in Rust AppState (same value the CPU
  // miner tab reads). undefined until the first rate line arrives from
  // the sidecar; UI should render "—" in that case.
  your_hashrate_khs?: number;
  // Phase 1A: ring buffer of the last 10 stratum events, newest-first.
  // Always present (defaults to []) when status comes back from
  // get_stratum_status — even an empty array is a valid value.
  recent_events?: StratumEvent[];
  // M-23 fix: Rust serializes this as a required `u64` (always emitted) so
  // marking it optional in TS forced unnecessary `?? 0` guards on every
  // call site. Promoted to required to match the backend contract.
  uptime_secs: number;
}

// ============================================================
// SETTLEMENT TEMPLATES
// ============================================================

export type SettlementTemplate = "otc" | "freelance" | "milestone" | "deposit";

export interface OtcParams {
  buyer: string;
  seller: string;
  amount_sats: number;
  asset_reference?: string;
  payment_method?: string;
  deadline_hours?: number;
  memo?: string;
}

export interface FreelanceParams {
  client: string;
  contractor: string;
  amount_sats: number;
  deadline_hours?: number;
  scope?: string;
}

export interface MilestoneParams {
  payer: string;
  payee: string;
  amount_sats: number;
  milestone_count: number;
}

export interface DepositParams {
  depositor: string;
  recipient: string;
  amount_sats: number;
  deadline_hours?: number;
  purpose?: string;
}

export interface MerchantDelayedParams {
  buyer: string;
  merchant: string;
  amount_sats: number;
  cooldown_hours?: number;
  deadline_hours?: number;
  memo?: string;
}

export interface ContractorMilestoneParams {
  client: string;
  contractor: string;
  amount_sats: number;
  milestone_count: number;
  scope?: string;
}

// ============================================================
// DIAGNOSTICS
// ============================================================

export interface DiagnosticCheck {
  label: string;
  passed: boolean;
  detail?: string;
}

export interface DiagnosticsResult {
  checks: DiagnosticCheck[];
  passed: number;
  total: number;
}

// ============================================================
// UPDATE
// ============================================================

export interface UpdateCheckResult {
  available: boolean;
  current_version: string;
  latest_version: string;
  release_notes?: string;
  release_url?: string;
}

/** Result of checking the irium node source repo for new commits. */
export interface NodeUpdateCheckResult {
  has_update: boolean;
  current_commit: string;
  current_commit_short: string;
  latest_commit: string;
  latest_commit_short: string;
  latest_message: string;
  latest_author: string;
  latest_date: string;
  commits_behind: number;
  compare_url: string;
}

/** Result of pulling the irium-source submodule to the latest remote commit. */
export interface NodeUpdatePullResult {
  success: boolean;
  new_commit: string;
  new_commit_short: string;
  message: string;
}

// ============================================================
// MULTISIG
// ============================================================

export interface MultisigCreateResult {
  script_pubkey: string;
  address: string;
  threshold: number;
  pubkeys: string[];
}

export interface MultisigSpendResult {
  raw_tx?: string;
  txid?: string;
  success: boolean;
  message?: string;
}

// ============================================================
// INVOICES
// ============================================================

export interface Invoice {
  id: string;
  recipient: string;
  amount: number;
  reference: string;
  expires_height?: number;
  created_at?: number;
  status?: string;
}

export interface InvoiceImportResult {
  success: boolean;
  invoice_id?: string;
  invoice?: Invoice;
  message?: string;
}

// ============================================================
// ELIGIBILITY / SPEND
// ============================================================

export interface SpendEligibilityResult {
  eligible: boolean;
  reason?: string;
  funding_txid?: string;
  amount?: number;
  timelock_remaining?: number;
}

// ============================================================
// POLICIES
// ============================================================

export interface ProofPolicy {
  policy_id: string;
  agreement_hash: string;
  kind: string;
  attestor?: string;
  proof_type?: string;
  created_at?: number;
  raw?: Record<string, unknown>;
}

// ============================================================
// AGREEMENT STATUS
// ============================================================

export interface AgreementStatusResult {
  agreement_id: string;
  agreement_hash?: string;
  status: string;
  funded?: boolean;
  funding_txid?: string;
  release_eligible?: boolean;
  refund_eligible?: boolean;
  current_height?: number;
  proof_status?: string;
  // Per SETTLEMENT-DEV.md §"Proof Finality" — iriumd returns these alongside
  // release_eligible. Optional here because the Tauri shell may not yet
  // forward them; UI gracefully degrades when undefined.
  proof_depth?: number | null;
  proof_final?: boolean;
}

// ============================================================
// REPUTATION ACTIONS
// ============================================================

export type ReputationOutcome = "satisfied" | "failed" | "disputed" | "timeout";

export interface ReputationOutcomeResult {
  success: boolean;
  seller: string;
  outcome: string;
  message?: string;
}

export interface SelfTradeCheckResult {
  is_self_trade: boolean;
  seller: string;
  buyer: string;
  message?: string;
}

// ============================================================
// SELLER / BUYER STATUS
// ============================================================

export interface SellerStatus {
  address: string;
  active_offers?: number;
  completed_agreements?: number;
  open_agreements?: number;
  total_volume?: number;
  reputation_score?: number;
  can_create_offers?: boolean;
  restrictions?: string[];
}

export interface BuyerStatus {
  address: string;
  active_agreements?: number;
  completed_agreements?: number;
  total_spent?: number;
  reputation_score?: number;
  can_take_offers?: boolean;
  restrictions?: string[];
}

// ============================================================
// DISPUTES
// ============================================================

export interface DisputeEntry {
  id: string;
  agreement_id: string;
  reason?: string;
  status: string;
  opened_at?: number;
  resolved_at?: number;
}

export interface DisputeOpenResult {
  dispute_id?: string;
  success: boolean;
  message?: string;
}

// ============================================================
// NETWORK METRICS
// ============================================================

export interface NetworkMetrics {
  height: number;
  peers: number;
  mempool_size: number;
  hashrate_khs?: number;
  difficulty?: number;
  synced: boolean;
}

// ============================================================
// EXPLORER
// ============================================================

export interface ExplorerAgreement {
  id: string;
  hash?: string;
  template?: string;
  buyer?: string;
  seller?: string;
  amount: number;
  status: string;
  created_at?: number;
}

export interface ExplorerStats {
  total_agreements?: number;
  active_agreements?: number;
  total_volume?: number;
  total_proofs?: number;
  registered_attestors?: number;
}

export interface ExplorerNetworkStats {
  height: number;
  total_blocks: number;
  supply_irm: number;
  peer_count: number;
  active_miners: number;
  hashrate: number;       // H/s
  difficulty: number;
  diff_change_1h_pct: number;
  diff_change_24h_pct: number;
  avg_block_time: number; // seconds
}

export interface ExplorerPeer {
  multiaddr: string;
  dialable: boolean;
  height?: number;
  last_seen?: number;
  agent?: string;
  source?: string;
}

export interface ExplorerBlock {
  height: number;
  hash: string;
  miner_address?: string;
  time: number;
  tx_count: number;
  prev_hash?: string;
  merkle_root?: string;
  bits?: string;
  nonce?: number;
  // Optional override for the height-based blockReward() formula. Currently
  // populated only when arriving via the Miner page's Found Blocks list
  // (which forwards FoundBlock.reward_sats from the backend). Unused by the
  // modal today — kept for parity with the source object so we don't drop
  // it on the deep-link hop.
  reward_sats?: number;
}

export interface NetworkHashrateInfo {
  hashrate?: number;
  difficulty?: number;
  height?: number;
}

// Rich-list passthrough — mirrors iriumd's /rpc/richlist?limit=N response.
// balance_sats / total_supply_sats are u64 on the wire; carried as `number`
// here because IRM single-address holdings stay well under 2^53 sats. Use
// these for exact arithmetic; balance_irm / percentage are f64 conveniences.
export interface RichListEntry {
  rank: number;
  address: string;
  balance_sats: number;
  balance_irm: number;
  utxo_count: number;
  percentage: number;
}

export interface RichListResponse {
  count: number;
  total_supply_sats: number;
  generated_at_height: number;
  entries: RichListEntry[];
}

// Pool stats fetched from the official-pool stats proxy via the
// get_pool_stats Tauri command. Mirrors PoolStats / PoolProfileStats in
// src-tauri/src/types.rs. Counts default to 0 and integrity to "unknown"
// when the proxy returns no data for a profile.
export interface PoolProfileStats {
  active_miners: number;
  // Raw TCP-socket count from the stratum server. Includes port scanners
  // and abandoned sessions; shown separately so users can distinguish
  // these from actual miners (sessions with accepted shares). Older
  // proxies that don't emit this field default to 0 server-side.
  tcp_sessions: number;
  accepted_shares: number;
  rejected_shares: number;
  blocks_found: number;
  integrity: string;
  // Rolling-window hashrate estimate from the stats proxy. Null until the
  // proxy has accumulated enough samples (>= 120s window); 0 when the
  // window is mature but no accepted shares have been seen.
  hashrate_estimate_hps: number | null;
  hashrate_window_seconds: number;
  hashrate_confidence: "low" | "medium" | "high";
}

export interface PoolStats {
  pool: string;
  url: string;
  asic_port: number;
  cpu_gpu_port: number;
  asic: PoolProfileStats;
  cpu_gpu: PoolProfileStats;
  total_miners: number;
  total_blocks_found: number;
}

// Full stats-proxy /stats response. Superset of PoolStats — includes the
// solo profile and blocks_found_today which the get_pool_stats Tauri command
// (and the Rust PoolStats struct it mirrors) don't expose yet. Explorer
// fetches this directly via tauriFetch so the Pool Hashrate aggregate can
// use the proxy's authoritative per-profile hashrate_estimate_hps instead
// of summing per-miner vardiff samples and clamping to network on overshoot.
export interface StatsProxyResponse {
  pool: string;
  url: string;
  asic_port: number;
  cpu_gpu_port: number;
  solo_port?: number;
  asic: PoolProfileStats;
  cpu_gpu: PoolProfileStats;
  solo?: PoolProfileStats;
  total_miners: number;
  total_blocks_found: number;
  blocks_found_today?: number | null;
}

// Returned by check_port_open. `open` is the simple boolean the UI uses
// to flip a green/red status; `reason` is a human-readable explanation.
// `upnp_external_ip` and `inbound_count` carry the two underlying signals
// so the UI can display full diagnostic context when useful.
export interface PortCheckResult {
  open: boolean;
  reason: string;
  upnp_external_ip: string | null;
  inbound_count: number;
  // FIX 1 (UPnP): see NodeStatus.upnp_double_nat. Set when UPnP
  // mapping was accepted but the router's WAN IP is private (CGNAT
  // / double NAT), so inbound from the public internet won't work.
  double_nat?: boolean;
}

// FIX 1 (UPnP): full diagnostic trace from the most recent UPnP
// AddPortMapping attempt. Returned by the `upnp_diagnostics` Tauri
// command and rendered on the Help page so the user can see exactly
// what happened: which local IPv4 candidates were enumerated, which
// one was selected as NewInternalClient, the gateway IP that was
// matched against, the SSDP LOCATION URL and control URL, the
// external IP returned by GetExternalIPAddress and whether it is
// publicly routable, every AddPortMapping variant that was attempted
// with its UPnP fault text, and the final verdict.
export interface UpnpDiagnostics {
  last_attempt_at_unix: number | null;
  local_ipv4_candidates: string[];
  local_ipv4_chosen: string | null;
  gateway_ipv4: string | null;
  ssdp_location: string | null;
  control_url: string | null;
  external_ip: string | null;
  external_ip_routable: boolean | null;
  // Count of AddPortMapping variants attempted in the retry chain
  // (lease 3600/0 × empty_remote_host self-closing/explicit = up to 4).
  add_port_mapping_attempts: number;
  last_fault: string | null;
  succeeded: boolean;
  double_nat_detected: boolean;
}

// ============================================================
// FEED OPS
// ============================================================

export interface FeedDiscoverResult {
  discovered: string[];
  count: number;
}

// ============================================================
// AGREEMENT STORE / SIGN / VERIFY
// ============================================================

export interface AgreementSignResult {
  agreement_hash: string;
  signer: string;
  success: boolean;
  signature_path?: string;
}

export interface AgreementVerifySignatureResult {
  valid: boolean;
  signer?: string;
  agreement_hash?: string;
  message?: string;
}

export interface AgreementDecryptResult {
  agreement_id?: string;
  agreement_hash?: string;
  decrypted: Record<string, unknown>;
  success: boolean;
}

export interface AgreementStoreEntry {
  agreement_id: string;
  agreement_hash: string;
  path?: string;
}

export interface AgreementStoreListResult {
  raw_agreement_count?: number;
  bundle_count?: number;
  stored_raw_agreements?: AgreementStoreEntry[];
  // H-17 fix: the Rust AgreementStoreListResponse serializes a `stored_bundles`
  // array (Option<Vec<serde_json::Value>>) that was previously absent from
  // this TS type. Typed as a loose record list because the bundle shape isn't
  // tightly modeled on the frontend yet.
  stored_bundles?: Record<string, unknown>[];
}

// ============================================================
// APP STATE
// ============================================================

export type Theme = "midnight" | "obsidian" | "aurora" | "nebula" | "solar" | "ocean" | "rose";

export interface AppSettings {
  rpc_url: string;
  wallet_path?: string;
  data_dir?: string;
  auto_start_node: boolean;
  minimize_to_tray: boolean;
  currency_display: "IRM" | "sats";
  network: "mainnet";
  external_ip?: string;
  theme: Theme;
  // FIX 2 (IRIUM_RPC_TOKEN): user-supplied Bearer token for outbound
  // GUI RPC calls. When unset, the GUI falls back to the auto-minted
  // local token (which is fine for talking to the bundled iriumd).
  // Required when pointing the GUI at a remote iriumd whose token is
  // not on local disk — see node_mode.
  rpc_token?: string;
  // FIX 3 (Remote node): "local" spawns the bundled iriumd sidecar
  // as before. "remote" skips the sidecar entirely and points GUI
  // RPC traffic at rpc_url (which the user sets to the remote node's
  // RPC endpoint). Default "local".
  node_mode?: "local" | "remote";
}

export const DEFAULT_SETTINGS: AppSettings = {
  rpc_url: "http://127.0.0.1:38300",
  auto_start_node: true,
  minimize_to_tray: true,
  currency_display: "IRM",
  network: "mainnet",
  theme: "midnight",
};

// ============================================================
// UTILITY
// ============================================================

// 1 IRM = 100,000,000 satoshis
export const SATS_PER_IRM = 100_000_000;

export function satsToIRM(sats: number): number {
  return sats / SATS_PER_IRM;
}

export function IRMToSats(irm: number): number {
  return Math.round(irm * SATS_PER_IRM);
}

/**
 * Resolve the user's preferred amount display unit from persisted Settings.
 *
 * Reads localStorage directly rather than importing the zustand store to
 * avoid a circular dependency (store.ts already imports from this file).
 * Components that need their formatted output to react to a Settings toggle
 * must subscribe to `useStore((s) => s.settings)` (App.tsx already does, so
 * the entire tree re-renders on toggle — no per-component change needed).
 */
function readCurrencyPreference(): 'IRM' | 'sats' {
  try {
    const raw = localStorage.getItem('irium_core_settings');
    // Fast string check avoids JSON.parse on every formatIRM call. The
    // preference value is always one of the two literal strings, so a
    // substring match is unambiguous.
    if (raw && raw.includes('"currency_display":"sats"')) return 'sats';
  } catch {
    // localStorage unavailable (SSR, locked-down browser) — fall back to IRM
  }
  return 'IRM';
}

/**
 * Format a sats amount as an IRM string with significant-digit-only
 * decimals — OR as a raw "N sats" string when the user has chosen the
 * sats display unit in Settings. Trailing zeros are stripped and the
 * decimal point is omitted entirely when the IRM value is a whole number.
 * The thousands separator is preserved on the integer part.
 *
 * IRM mode (default):
 *   50_00000000      → "50 IRM"
 *   24_199_00000000  → "24,199 IRM"
 *   24_199_50000000  → "24,199.5 IRM"
 *   100_12340000     → "100.1234 IRM"
 *   10000            → "0.0001 IRM"
 *   0                → "0 IRM"
 *
 * sats mode (Settings → Currency display = "sats"):
 *   50_00000000      → "5,000,000,000 sats"
 *   10000            → "10,000 sats"
 *   0                → "0 sats"
 *
 * `decimals` caps the maximum significant fractional digits in IRM mode
 * (default 4 to preserve the historic display); ignored in sats mode since
 * sats are always whole numbers on-chain. Values are not rounded — they're
 * shown at full precision up to that cap and then trimmed.
 */
export function formatIRM(sats: number, decimals = 4): string {
  if (readCurrencyPreference() === 'sats') {
    // sats are u64 on-chain; floor any fractional inputs (defensive — should
    // never happen from on-chain data, but UI math may pass intermediate
    // floats). Negative values come through unchanged so the caller's sign
    // semantics survive.
    const n = Number.isFinite(sats) ? Math.trunc(sats) : 0;
    return `${n.toLocaleString('en-US')} sats`;
  }
  const irm = satsToIRM(sats);
  const [intRaw, fracRaw = ''] = irm.toFixed(decimals).split('.');
  // Trim trailing zeros from the fractional part. If nothing remains,
  // drop the decimal point entirely.
  const fracTrimmed = fracRaw.replace(/0+$/, '');
  // Thousands separator on the integer portion via Number.toLocaleString.
  // toFixed can return "-0" for tiny negatives; coerce to a Number first
  // so the locale formatter renders "0" cleanly.
  const intFormatted = Number(intRaw).toLocaleString('en-US');
  return `${fracTrimmed ? `${intFormatted}.${fracTrimmed}` : intFormatted} IRM`;
}

export function formatSats(sats: number): string {
  // Locale arg forces US-style 1,000,000,000 grouping. Without it the
  // grouping inherits the user's system locale, which on Indian locales
  // produces 1,00,00,00,000 (the indic crore/lakh grouping) — confusing
  // for a financial display where reproducibility across users matters.
  return `${sats.toLocaleString('en-US')} sats`;
}

export function truncateHash(hash: string, len = 8): string {
  if (!hash) return "";
  return `${hash.slice(0, len)}...${hash.slice(-len)}`;
}

export function truncateAddr(addr: string, front = 6, back = 6): string {
  if (!addr || addr.length <= front + back + 3) return addr;
  return `${addr.slice(0, front)}...${addr.slice(-back)}`;
}

export function timeAgo(timestamp: number): string {
  const now = Date.now();
  const ts = timestamp < 1e12 ? timestamp * 1000 : timestamp;
  const diff = Math.floor((now - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const days = Math.floor(diff / 86400);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Canonical timestamp formatter. Returns BOTH the user's local-timezone
// string and a UTC equivalent so callers can show local in the main
// surface and surface UTC via a hover tooltip. This is the single
// source of truth for every clock-time display in the app — explorer
// block modal, transaction detail, agreement deadlines, swap order
// "updated at", etc. Before this helper existed every surface called
// `new Date(...).toLocaleString('en-US')` directly, which produced
// confusing per-surface variation between local and UTC depending on
// the Tauri webview's TZ environment.
//
// Accepts seconds-since-epoch OR milliseconds: values < 1e12 are
// treated as seconds (same heuristic as timeAgo).
export interface FormattedTimestamp {
  local: string;
  utc: string;
}

function normalizeEpoch(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts;
}

export function formatLocalDateTime(ts: number): FormattedTimestamp {
  const ms = normalizeEpoch(ts);
  const d = new Date(ms);
  const local = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
  const utc = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(d) + ' UTC';
  return { local, utc };
}

export function formatLocalTime(ts: number): FormattedTimestamp {
  const ms = normalizeEpoch(ts);
  const d = new Date(ms);
  const local = new Intl.DateTimeFormat(undefined, {
    timeStyle: 'medium',
  }).format(d);
  const utc = new Intl.DateTimeFormat('en-GB', {
    timeStyle: 'medium',
    timeZone: 'UTC',
  }).format(d) + ' UTC';
  return { local, utc };
}

export function riskColor(signal: RiskSignal): string {
  switch (signal) {
    case "low": return "text-green-400";
    case "medium": return "text-amber-400";
    case "high": return "text-red-400";
    default: return "text-white/40";
  }
}

export function statusColor(status: AgreementStatus | string): string {
  switch (status) {
    case "funded": return "badge-info";
    case "released": return "badge-success";
    case "refunded": return "badge-warning";
    case "open": return "badge-irium";
    default: return "badge-irium";
  }
}
