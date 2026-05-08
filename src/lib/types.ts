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
}

export interface WalletCreateResult {
  mnemonic: string;
  address: string;
  pubkey?: string;
  private_key?: string;
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
  timestamp?: number;
  direction: "send" | "receive";
  address?: string;
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
}

export interface CreateOfferParams {
  amount_sats: number;
  description?: string;
  payment_method?: string;
  offer_id?: string;
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
  | "funded"
  | "released"
  | "refunded";

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

export interface Reputation {
  pubkey: string;
  address?: string;
  score: number;
  completed: number;
  failed: number;
  default_count: number;
  risk_signal: RiskSignal;
  total_volume?: number;
  // Extended fields used by Reputation page
  risk_level?: string;
  total_agreements?: number;
  released?: number;
  refunded?: number;
  volume_sats?: number;
  score_history?: number[];
  flags?: string[];
  agreements?: Array<{
    id: string;
    role: string;
    status: string;
    amount: number;
    timestamp: number;
  }>;
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

// ============================================================
// APP STATE
// ============================================================

export interface AppSettings {
  rpc_url: string;
  wallet_path?: string;
  data_dir?: string;
  auto_start_node: boolean;
  minimize_to_tray: boolean;
  currency_display: "IRM" | "sats";
  network: "mainnet";
}

export const DEFAULT_SETTINGS: AppSettings = {
  rpc_url: "http://127.0.0.1:38300",
  auto_start_node: false,
  minimize_to_tray: true,
  currency_display: "IRM",
  network: "mainnet",
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

export function formatIRM(sats: number, decimals = 4): string {
  const irm = satsToIRM(sats);
  return `${irm.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} IRM`;
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
