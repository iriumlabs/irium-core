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
  bytes: number;
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
  status?: string;
  created_at?: number;
  ranking_score?: number;
  reputation?: OfferReputation;
  risk_signal?: string;
  // Block height at which the offer expires. Returned by /offers/feed per
  // API.md §Marketplace L612. Optional because not every offer source
  // (e.g. an offer authored in an older binary) includes it.
  timeout_height?: number;
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

export interface GpuMinerStatus {
  running: boolean;
  hashrate_khs: number;
  blocks_found: number;
  uptime_secs: number;
  difficulty: number;
  device_index: number;
  device_name?: string;
  temperature_c?: number;
  fan_pct?: number;
  power_w?: number;
  address?: string;
}

// A block found by the CPU or GPU miner. Mirrors the Rust FoundBlock
// struct in src-tauri/src/types.rs. Hash is "" when the miner sidecar
// hasn't surfaced one yet (text-mode CPU output, for instance). Reward
// is 0 until we wire the coinbase RPC lookup.
export interface FoundBlock {
  height: number;
  hash: string;
  timestamp: number;
  reward_sats: number;
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
  uptime_secs?: number;
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
}

export interface NetworkHashrateInfo {
  hashrate?: number;
  difficulty?: number;
  height?: number;
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
}

// ============================================================
// APP STATE
// ============================================================

export type Theme = "midnight" | "obsidian" | "aurora" | "nebula";

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
 * Format a sats amount as an IRM string with significant-digit-only
 * decimals. Trailing zeros are stripped and the decimal point is omitted
 * entirely when the value is a whole number. The thousands separator is
 * preserved on the integer part.
 *
 *   50_00000000      → "50 IRM"
 *   24_199_00000000  → "24,199 IRM"
 *   24_199_50000000  → "24,199.5 IRM"
 *   100_12340000     → "100.1234 IRM"
 *   10000            → "0.0001 IRM"
 *   0                → "0 IRM"
 *
 * `decimals` caps the maximum significant fractional digits (default 4 to
 * preserve the historic display); values are not rounded — they're shown
 * at full precision up to that cap and then trimmed.
 */
export function formatIRM(sats: number, decimals = 4): string {
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
  return `${sats.toLocaleString()} sats`;
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
