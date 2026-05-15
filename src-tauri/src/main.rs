// Irium Core GUI - Tauri Backend
// RPC: 127.0.0.1:38300 | P2P: 38291 | Amounts: satoshis (1 IRM = 100,000,000 sats)
// Addresses: Q/P prefix Base58Check | Node data dir: ~/.irium

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Manager, SystemTray, SystemTrayMenu, SystemTrayMenuItem, CustomMenuItem, State};
use tauri::api::path::app_data_dir;
use tauri::api::process::{Command, CommandChild, CommandEvent};
use dirs;

mod types;
use types::*;
use std::collections::HashMap;

// ============================================================
// STATE
// ============================================================

struct AppState {
    node_process: Arc<Mutex<Option<CommandChild>>>,
    miner_process: Arc<Mutex<Option<CommandChild>>>,
    explorer_process: Arc<Mutex<Option<CommandChild>>>,
    rpc_url: Arc<Mutex<String>>,
    wallet_path: Arc<Mutex<Option<String>>>,
    data_dir: Arc<Mutex<Option<String>>>,
    miner_start_time: Arc<Mutex<Option<std::time::Instant>>>,
    miner_address: Arc<Mutex<Option<String>>>,
    miner_threads: Arc<Mutex<u32>>,
    miner_hashrate: Arc<Mutex<f64>>,
    // Last sync-progress line from the miner sidecar (e.g. `[sync] Miner
    // downloading blocks 1..21269 from node`). Populated by start_miner's
    // event loop while no rate line has arrived yet; cleared on the first
    // successful rate parse so the UI flips from "Syncing…" to live hashrate.
    miner_sync_status: Arc<Mutex<Option<String>>>,
    last_node_status: Arc<Mutex<Option<NodeStatus>>>,
    pool_url: Arc<Mutex<Option<String>>>,
    upnp_external_ip: Arc<Mutex<Option<String>>>,
    node_logs: Arc<Mutex<Vec<String>>>,
    // Bug 1 fix — cumulative blocks-found counter and the most-recent
    // entries list, populated by the miner spawn loops as they parse
    // block-accept / block-mined lines from the sidecar's stdout. Both
    // accumulate across miner stop/start within a single GUI session;
    // they reset only when the app restarts.
    blocks_found: Arc<Mutex<u64>>,
    found_blocks: Arc<Mutex<Vec<FoundBlock>>>,
}

impl AppState {
    fn new() -> Self {
        // Always start with wallet.json as the active wallet so the user sees
        // their primary wallet's addresses and balance immediately on launch.
        // The user can switch to wallet-2.json etc. via the Manage Wallets
        // panel; settings persistence (set_wallet_config from saved settings)
        // overrides this default if a different wallet was last active.
        let default_wallet = resolve_wallet_path();
        AppState {
            node_process: Arc::new(Mutex::new(None)),
            miner_process: Arc::new(Mutex::new(None)),
            explorer_process: Arc::new(Mutex::new(None)),
            rpc_url: Arc::new(Mutex::new("http://127.0.0.1:38300".to_string())),
            wallet_path: Arc::new(Mutex::new(Some(default_wallet))),
            data_dir: Arc::new(Mutex::new(None)),
            miner_start_time: Arc::new(Mutex::new(None)),
            miner_address: Arc::new(Mutex::new(None)),
            miner_threads: Arc::new(Mutex::new(0)),
            miner_hashrate: Arc::new(Mutex::new(0.0)),
            miner_sync_status: Arc::new(Mutex::new(None)),
            last_node_status: Arc::new(Mutex::new(None)),
            pool_url: Arc::new(Mutex::new(None)),
            upnp_external_ip: Arc::new(Mutex::new(None)),
            node_logs: Arc::new(Mutex::new(Vec::new())),
            blocks_found: Arc::new(Mutex::new(0)),
            found_blocks: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

// ============================================================
// BOOTSTRAP FILES — embedded at compile time from irium-source/bootstrap/
//
// These come directly from the irium node source repository submodule so
// they always match the node binary being built. The signed anchors.json and
// seedlist.txt are write-once on disk (never overwritten) to preserve any
// newer signed versions downloaded from the network. Trust keys and static
// peers are refreshed on every start so they track the installed node version.
// ============================================================

const BOOTSTRAP_ANCHORS_JSON:           &str = include_str!("../../irium-source/bootstrap/anchors.json");
const BOOTSTRAP_SEEDLIST_TXT:           &str = include_str!("../../irium-source/bootstrap/seedlist.txt");
const BOOTSTRAP_SEEDLIST_SIG:           &str = include_str!("../../irium-source/bootstrap/seedlist.txt.sig");
const BOOTSTRAP_STATIC_PEERS:          &str = include_str!("../../irium-source/bootstrap/static_peers.txt");
const BOOTSTRAP_ALLOWED_SIGNERS:        &str = include_str!("../../irium-source/bootstrap/trust/allowed_signers");
const BOOTSTRAP_ALLOWED_ANCHOR_SIGNERS: &str = include_str!("../../irium-source/bootstrap/trust/allowed_anchor_signers");
const BOOTSTRAP_ALLOWED_BAN_SIGNERS:    &str = include_str!("../../irium-source/bootstrap/trust/allowed_ban_signers");

// ============================================================
// HELPERS
// ============================================================

fn sats_to_irm(sats: u64) -> f64 {
    sats as f64 / 100_000_000.0
}

fn parse_hashrate_khs(line: &str) -> Option<f64> {
    // Match the first float/int followed by optional space then kH/s, H/s, etc.
    let re_pat = line
        .split_whitespace()
        .zip(line.split_whitespace().skip(1))
        .find(|(_, unit)| {
            let u = unit.to_lowercase();
            u.starts_with("gh/s") || u.starts_with("ghs") ||
            u.starts_with("mh/s") || u.starts_with("mhs") ||
            u.starts_with("kh/s") || u.starts_with("khs") ||
            u.starts_with("h/s") || u.starts_with("hs")
        });
    if let Some((val_str, unit)) = re_pat {
        if let Ok(val) = val_str.trim_end_matches(',').parse::<f64>() {
            let u = unit.to_lowercase();
            if u.starts_with("gh") {
                return Some(val * 1_000_000.0);
            } else if u.starts_with("mh") {
                return Some(val * 1_000.0);
            } else if u.starts_with("kh") {
                return Some(val);
            } else {
                return Some(val / 1000.0);
            }
        }
    }
    // Fallback: find any number adjacent to GH/s, MH/s, or kH/s in the line
    let lower = line.to_lowercase();
    for (unit_str, multiplier) in &[("gh/s", 1_000_000.0_f64), ("mh/s", 1_000.0), ("kh/s", 1.0)] {
        if let Some(pos) = lower.find(unit_str) {
            let before = &line[..pos].trim_end();
            if let Some(num_str) = before.split_whitespace().last() {
                if let Ok(v) = num_str.trim_end_matches(',').parse::<f64>() {
                    return Some(v * multiplier);
                }
            }
        }
    }
    None
}


fn lock_err(e: impl std::fmt::Display) -> String {
    format!("Lock error: {}", e)
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Probe bootstrap seeds over raw TCP (3-second timeout, all in parallel).
/// Returns true if ANY seed is reachable — a single boolean so the frontend
/// can detect a blocked port-38291 without any IP addresses leaking to the UI.
#[tauri::command]
async fn check_network_reachable() -> bool {
    let seeds = bootstrap_seeds_for_ui();
    let timeout_dur = std::time::Duration::from_secs(3);

    let mut join_set = tokio::task::JoinSet::new();
    for addr in seeds.into_iter().take(5) {
        let d = timeout_dur;
        join_set.spawn(async move {
            tokio::time::timeout(
                d,
                tokio::net::TcpStream::connect(format!("{}:38291", addr)),
            )
            .await
            .map(|r| r.is_ok())
            .unwrap_or(false)
        });
    }

    while let Some(result) = join_set.join_next().await {
        if let Ok(true) = result {
            return true;
        }
    }
    false
}

// Returns hardware info the GUI needs at startup. cpu_cores is what
// std::thread::available_parallelism() reports — accounts for cgroup limits,
// container CPU shares, Windows scheduling masks, etc, which the browser
// API navigator.hardwareConcurrency doesn't. Used to drive the Miner page's
// threads slider's max and its default value (half of cores).
#[tauri::command]
fn get_system_info() -> SystemInfo {
    let cpu_cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);
    SystemInfo { cpu_cores }
}

fn resolve_wallet_path() -> String {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".irium")
        .join("wallet.json")
        .to_string_lossy()
        .to_string()
}

// Returns the first non-existing wallet path: wallet.json, wallet-2.json, wallet-3.json…
// Used by wallet_create so a new wallet never silently overwrites an existing one.
fn find_unique_wallet_path() -> String {
    let irium_dir = dirs::home_dir().unwrap_or_default().join(".irium");
    let base = irium_dir.join("wallet.json");
    if !base.exists() {
        return base.to_string_lossy().to_string();
    }
    for n in 2u32..=999 {
        let candidate = irium_dir.join(format!("wallet-{}.json", n));
        if !candidate.exists() {
            return candidate.to_string_lossy().to_string();
        }
    }
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    irium_dir.join(format!("wallet-{}.json", ts)).to_string_lossy().to_string()
}

async fn get_rpc_info(rpc_url: &str) -> Result<RpcInfo, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/status", rpc_url))
        .timeout(Duration::from_secs(3))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.json::<RpcInfo>().await.map_err(|e| e.to_string())
}

async fn get_current_height(rpc_url: &str) -> u64 {
    get_rpc_info(rpc_url).await
        .ok()
        .and_then(|i| i.height)
        .unwrap_or(0)
}

// ─── File staging for macOS TCC safety ──────────────────────────────────────
//
// macOS TCC permissions are scoped per-binary. When the user picks a file via
// the native open/save dialog, the Tauri main process gets implicit read or
// write access, but the spawned irium-wallet sidecar — a separate executable
// with its own TCC profile — does NOT inherit that grant. Without staging,
// every "pick a file → pass to sidecar" command fails on macOS with
// EPERM/EACCES the moment the user's path is under ~/Downloads, ~/Documents,
// ~/Desktop, or iCloud Drive (the TCC-gated directories).
//
// These helpers route all user-path I/O through the main process:
//   - stage_input:    main reads user path  → writes staged copy under data_dir
//                     → sidecar reads from staged path (always allowed)
//   - stage_output:   sidecar writes to staged path under data_dir
//                     → main copies staged file out to user destination
//
// The staging directory lives at <data_dir>/staging or ~/.irium/staging. The
// sidecar has unrestricted access there because iriumd already writes to
// data_dir continuously.

fn staging_dir(data_dir: &Option<String>) -> PathBuf {
    data_dir
        .as_ref()
        .map(|d| PathBuf::from(d).join("staging"))
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join(".irium").join("staging"))
}

fn next_staged_path(prefix: &str, ext: &str, data_dir: &Option<String>) -> Result<PathBuf, String> {
    let dir = staging_dir(data_dir);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create staging dir: {}", e))?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    Ok(dir.join(format!("{}-{}.{}", prefix, stamp, ext)))
}

fn stage_input(src: &str, prefix: &str, data_dir: &Option<String>) -> Result<PathBuf, String> {
    let dest = next_staged_path(prefix, "bin", data_dir)?;
    std::fs::copy(src, &dest).map_err(|e| format!(
        "Could not read file at {}: {}. On macOS, grant Files & Folders access in \
         System Settings > Privacy & Security > Files and Folders > Irium Core.",
        src, e
    ))?;
    Ok(dest)
}

fn finalize_output(staged: &Path, dest: &str) -> Result<(), String> {
    std::fs::copy(staged, dest).map_err(|e| format!(
        "Could not write output to {}: {}. On macOS, grant Files & Folders access in \
         System Settings > Privacy & Security > Files and Folders > Irium Core.",
        dest, e
    ))?;
    let _ = std::fs::remove_file(staged);
    Ok(())
}

async fn run_wallet_cmd(
    args: Vec<String>,
    wallet_path: Option<String>,
    data_dir: Option<String>,
) -> Result<String, String> {
    let mut env_vars: HashMap<String, String> = HashMap::new();
    if let Some(wp) = wallet_path {
        env_vars.insert("IRIUM_WALLET_FILE".to_string(), wp);
    }
    if let Some(dd) = data_dir {
        env_vars.insert("IRIUM_DATA_DIR".to_string(), dd);
    }

    let cmd = Command::new_sidecar("irium-wallet")
        .map_err(|e| format!("irium-wallet sidecar not found: {}. Place binary in src-tauri/binaries/", e))?
        .envs(env_vars)
        .args(&args);

    let output = cmd.output().map_err(|e| format!("Failed to run wallet command: {}", e))?;

    if output.status.success() {
        Ok(output.stdout)
    } else {
        Err(format!("Wallet command failed: {}", output.stderr.trim()))
    }
}

async fn run_wallet_cmd_with_rpc(
    args: Vec<String>,
    wallet_path: Option<String>,
    data_dir: Option<String>,
    rpc_url: String,
) -> Result<String, String> {
    let mut full_args = args;
    full_args.push("--rpc".to_string());
    full_args.push(rpc_url);
    run_wallet_cmd(full_args, wallet_path, data_dir).await
}

async fn get_first_wallet_address(
    wallet_path: Option<String>,
    data_dir: Option<String>,
) -> Result<String, String> {
    let output = run_wallet_cmd(vec!["list-addresses".to_string()], wallet_path, data_dir).await?;
    output
        .lines()
        .map(|l| l.trim().to_string())
        .find(|l| !l.is_empty())
        .ok_or_else(|| "No wallet addresses found — run new-address first".to_string())
}

async fn fetch_address_balance_sats(client: &reqwest::Client, rpc_url: &str, address: &str) -> Option<u64> {
    let url = format!("{}/rpc/balance?address={}", rpc_url, address);
    let resp = client.get(&url).timeout(Duration::from_secs(3)).send().await.ok()?;
    let b = resp.json::<RpcBalance>().await.ok()?;
    Some(b.balance)
}

// ============================================================
// NODE MANAGEMENT
// ============================================================

/// Read previously discovered peers from iriumd's own organic seedlist.extra file.
/// iriumd writes this file via P2P gossip — no external servers involved.
/// We pass these peers through IRIUM_ADDNODE (highest-priority, always-retried)
/// so iriumd reconnects to every peer it has ever seen, not just the 11 hardcoded ones.
fn read_extra_seeds() -> Vec<String> {
    let home_dir = match dirs::home_dir() {
        Some(d) => d,
        None => return vec![],
    };
    let extra_path = home_dir.join(".irium").join("bootstrap").join("seedlist.extra");
    let contents = match std::fs::read_to_string(&extra_path) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    contents
        .lines()
        .filter_map(|line| {
            let l = line.trim();
            if l.is_empty() || l.starts_with('#') { return None; }
            // seedlist.extra stores IP:PORT — we only want the IP for IRIUM_ADDNODE
            let ip = l.split(':').next().unwrap_or("").trim().to_string();
            if ip.is_empty() { None } else { Some(ip) }
        })
        .collect()
}

/// Resolve bootstrap seed IPs for the GUI's TCP pre-check and auto-inject.
/// Priority: runtime seeds (iriumd /admin/add-seed appends here) →
/// dialable peers in peers.json (top 10 by last_seen) →
/// bundled seedlist.txt → hardcoded fallback.
fn bootstrap_seeds_for_ui() -> Vec<String> {
    let mut seeds: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    let home_dir = match dirs::home_dir() {
        Some(d) => d,
        None => {
            for line in BOOTSTRAP_SEEDLIST_TXT.lines() {
                let l = line.trim();
                if !l.is_empty() && !l.starts_with('#') && seen.insert(l.to_string()) {
                    seeds.push(l.to_string());
                }
            }
            for ip in &["207.244.247.86", "157.173.116.134"] {
                if seen.insert(ip.to_string()) { seeds.push(ip.to_string()); }
            }
            return seeds;
        }
    };
    let irium_dir = home_dir.join(".irium");

    // Priority 1: ~/.irium/bootstrap/seedlist.runtime (IP:PORT lines written by /admin/add-seed)
    let runtime_path = irium_dir.join("bootstrap").join("seedlist.runtime");
    if let Ok(content) = std::fs::read_to_string(&runtime_path) {
        for line in content.lines() {
            let l = line.trim();
            if l.is_empty() || l.starts_with('#') { continue; }
            let ip = l.split(':').next().unwrap_or("").trim().to_string();
            if !ip.is_empty() && seen.insert(ip.clone()) { seeds.push(ip); }
        }
    }

    // Priority 2: peers.json dialable entries, top 10 by last_seen
    // Keys are multiaddr /ip4/X.X.X.X/tcp/PORT; values have dialable+last_seen.
    let peers_path = irium_dir.join("state").join("peers.json");
    if let Ok(raw) = std::fs::read_to_string(&peers_path) {
        if let Ok(serde_json::Value::Object(map)) = serde_json::from_str::<serde_json::Value>(&raw) {
            let mut dialable: Vec<(f64, String)> = map
                .iter()
                .filter_map(|(k, v)| {
                    let is_dialable = v.get("dialable").and_then(|d| d.as_bool()).unwrap_or(false);
                    let last_seen = v.get("last_seen").and_then(|s| s.as_f64()).unwrap_or(0.0);
                    if is_dialable && last_seen > 0.0 {
                        let parts: Vec<&str> = k.split('/').collect();
                        let ip = parts.get(2).copied().unwrap_or("").to_string();
                        if !ip.is_empty() { Some((last_seen, ip)) } else { None }
                    } else {
                        None
                    }
                })
                .collect();
            dialable.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
            for (_, ip) in dialable.iter().take(10) {
                if seen.insert(ip.clone()) { seeds.push(ip.clone()); }
            }
        }
    }

    // Priority 3: bundled seedlist.txt (IP-only, one per line, signed)
    for line in BOOTSTRAP_SEEDLIST_TXT.lines() {
        let l = line.trim();
        if !l.is_empty() && !l.starts_with('#') && seen.insert(l.to_string()) {
            seeds.push(l.to_string());
        }
    }

    // Priority 4: hardcoded fallback — guarantees the two official seeds are always present
    for ip in &["207.244.247.86", "157.173.116.134"] {
        if seen.insert(ip.to_string()) { seeds.push(ip.to_string()); }
    }

    seeds
}

/// Trim seedlist.extra to MAX_KEPT_EXTRA_SEEDS entries on app start.
/// iriumd's SeedlistManager (irium-source/src/network.rs:326) merges
/// seedlist.txt (12 signed) + seedlist.extra (this file) + static + runtime
/// into a single bootstrap dial list, with no priority distinction between
/// them. Without trimming, accumulated gossip-discovered IPs can reach 60+
/// entries, and iriumd's bootstrap maintenance loop (iriumd.rs:7798) dials
/// only 5 peers per 5s cycle when peer_count is 0 — so cycling through 70+
/// candidates (most dead) takes minutes before settling on the alive few.
///
/// This function bounds the file size BEFORE iriumd starts, so the merged
/// list stays small (~32 = 12 signed + 20 extras) and bootstrap is fast.
///
/// Random selection (Fisher-Yates with LCG seeded by SystemTime nanos):
/// each restart picks a different 20-entry subset. Dead IPs eventually get
/// cycled out; `save_discovered_peers` re-adds live peers whenever the
/// poller observes them, so the file recovers organically. No `rand` crate
/// dependency.
///
/// Below the threshold the file is left untouched. On trim we write a
/// clean sorted file (matches the format produced by `save_discovered_peers`).
fn trim_seedlist_extra() {
    const MAX_KEPT_EXTRA_SEEDS: usize = 20;

    let home_dir = match dirs::home_dir() {
        Some(d) => d,
        None => return,
    };
    let extra_path = home_dir.join(".irium").join("bootstrap").join("seedlist.extra");
    let contents = match std::fs::read_to_string(&extra_path) {
        Ok(s) => s,
        Err(_) => return, // file doesn't exist — first run, nothing to trim
    };

    // Collect valid IP:PORT lines, drop empties and comments.
    let mut entries: Vec<String> = contents
        .lines()
        .filter_map(|l| {
            let t = l.trim();
            if t.is_empty() || t.starts_with('#') { None } else { Some(t.to_string()) }
        })
        .collect();

    let original_len = entries.len();
    if original_len <= MAX_KEPT_EXTRA_SEEDS {
        return; // below threshold, leave file untouched
    }

    // Fisher-Yates shuffle with an LCG seeded by current time nanos.
    // Constants are MMIX (Knuth) — not cryptographic, just deterministic
    // distribution for picking a different subset on each restart.
    let mut seed: u64 = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(1)
        .max(1);
    for i in (1..entries.len()).rev() {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let j = (seed % (i as u64 + 1)) as usize;
        entries.swap(i, j);
    }
    entries.truncate(MAX_KEPT_EXTRA_SEEDS);
    entries.sort(); // sorted output matches save_discovered_peers' format

    let body = entries.join("\n") + "\n";
    match std::fs::write(&extra_path, &body) {
        Ok(_) => tracing::info!(
            "[trim_seedlist_extra] trimmed seedlist.extra: {} → {} entries (random subset; live peers will be re-added by save_discovered_peers)",
            original_len, MAX_KEPT_EXTRA_SEEDS
        ),
        Err(e) => tracing::warn!("[trim_seedlist_extra] failed to write trimmed file: {}", e),
    }
}

/// Trim peers.json to MAX_KEPT_PEERS entries BEFORE iriumd starts.
/// iriumd reads ~/.irium/state/peers.json at startup via load_persisted_startup_seeds
/// (iriumd.rs:1405) and promotes every `dialable=true` entry into the bootstrap
/// seed dial list. An unbounded file means hundreds of stale/dead addresses compete
/// with the two live seeds, slowing initial peer connect significantly.
///
/// Trim peers.json to a tight, high-quality dial pool before each iriumd spawn.
///
/// Selection priority (within the MAX_KEPT_PEERS cap):
///   1. Official VPS seed IPs — always kept even if dialable=false.
///   2. Other dialable=true entries, sorted by last_seen descending.
///   3. Non-dialable entries (most recently seen) to fill any remaining slots.
///
/// This prevents the 38-stale-gossip-peer problem where iriumd burns 5 s per
/// dead address before the real seeds get a dial slot.
fn trim_peers_json() {
    const MAX_KEPT_PEERS: usize = 10;
    const VPS_IPS: [&str; 2] = ["207.244.247.86", "157.173.116.134"];

    let home_dir = match dirs::home_dir() {
        Some(d) => d,
        None => return,
    };
    let peers_path = home_dir.join(".irium").join("state").join("peers.json");
    let raw = match std::fs::read_to_string(&peers_path) {
        Ok(s) => s,
        Err(_) => return, // file doesn't exist yet — first run, nothing to trim
    };

    let value: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return, // corrupt file — leave iriumd to handle it
    };

    let map = match value.as_object() {
        Some(m) => m,
        None => return,
    };

    if map.len() <= MAX_KEPT_PEERS {
        return; // already small enough, leave file untouched
    }

    let original_len = map.len();

    // Tag each entry: (is_vps, dialable, last_seen, addr, value)
    // Sort key: VPS first → dialable first → most recently seen first.
    let mut entries: Vec<(bool, bool, f64, String, serde_json::Value)> = map
        .iter()
        .map(|(k, v)| {
            let dialable = v.get("dialable").and_then(|d| d.as_bool()).unwrap_or(false);
            let last_seen = v.get("last_seen").and_then(|s| s.as_f64()).unwrap_or(0.0);
            let is_vps = VPS_IPS.iter().any(|ip| k.contains(ip));
            (is_vps, dialable, last_seen, k.clone(), v.clone())
        })
        .collect();

    entries.sort_by(|a, b| {
        b.0.cmp(&a.0) // VPS seeds first
            .then(b.1.cmp(&a.1)) // dialable before non-dialable
            .then(b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal)) // most recent first
    });
    entries.truncate(MAX_KEPT_PEERS);

    let mut kept = serde_json::Map::new();
    for (_, _, _, multiaddr, entry) in entries {
        kept.insert(multiaddr, entry);
    }

    let body = match serde_json::to_string_pretty(&serde_json::Value::Object(kept)) {
        Ok(s) => s,
        Err(_) => return,
    };

    match std::fs::write(&peers_path, body.as_bytes()) {
        Ok(_) => tracing::info!(
            "[trim_peers_json] trimmed peers.json: {} → {} entries (VPS pinned, dialable preferred)",
            original_len, MAX_KEPT_PEERS
        ),
        Err(e) => tracing::warn!("[trim_peers_json] failed to write trimmed file: {}", e),
    }
}

/// Reset the reputation score for official seeds when they have been temp-banned.
/// iriumd's reputation manager bans peers whose score drops below 20. On a
/// congested network the seeds often close connections early (inbound queue full),
/// recording failures that drive our score for them below the ban threshold.
/// After the ban, iriumd skips them entirely — even after the seed is less busy.
/// We reset only the seed entries that are below the ban threshold so iriumd
/// can reconnect on the next start without losing reputation for other peers.
fn reset_seed_reputation() {
    const BAN_THRESHOLD: i64 = 20;
    const VPS_IPS: [&str; 2] = ["207.244.247.86", "157.173.116.134"];

    let home_dir = match dirs::home_dir() {
        Some(d) => d,
        None => return,
    };
    let rep_path = home_dir.join(".irium").join("state").join("peer_reputation.json");
    let raw = match std::fs::read_to_string(&rep_path) {
        Ok(s) => s,
        Err(_) => return,
    };
    let mut value: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return,
    };
    let map = match value.as_object_mut() {
        Some(m) => m,
        None => return,
    };
    let mut reset_count = 0usize;
    for (key, entry) in map.iter_mut() {
        let is_seed = VPS_IPS.iter().any(|ip| key.starts_with(ip));
        if !is_seed { continue; }
        let score = entry.get("score").and_then(|v| v.as_i64()).unwrap_or(100);
        if score < BAN_THRESHOLD {
            if let Some(obj) = entry.as_object_mut() {
                obj.insert("score".to_string(), serde_json::Value::from(100));
                obj.insert("failed_connections".to_string(), serde_json::Value::from(0));
            }
            reset_count += 1;
        }
    }
    if reset_count == 0 { return; }
    let body = match serde_json::to_string_pretty(&value) {
        Ok(s) => s,
        Err(_) => return,
    };
    match std::fs::write(&rep_path, body.as_bytes()) {
        Ok(_) => tracing::info!("[reset_seed_reputation] cleared ban on {} seed(s) in peer_reputation.json", reset_count),
        Err(e) => tracing::warn!("[reset_seed_reputation] failed to write peer_reputation.json: {}", e),
    }
}

// ============================================================
// UPnP — decentralized NAT traversal using tokio + reqwest.
// Opens TCP port 38291 on the router so other NAT-behind nodes
// can dial us inbound. No relay, no central server — each node
// does this independently using its own router's UPnP service.
// ============================================================

fn upnp_local_ipv4() -> Option<std::net::Ipv4Addr> {
    use std::net::{IpAddr, UdpSocket};
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("8.8.8.8:80").ok()?;
    match sock.local_addr().ok()?.ip() {
        IpAddr::V4(ip) => Some(ip),
        _ => None,
    }
}

async fn upnp_discover_location() -> Option<String> {
    use tokio::net::UdpSocket;

    let sock = UdpSocket::bind("0.0.0.0:0").await.ok()?;

    // Send SSDP M-SEARCH for the WAN IP service directly
    let msearch = concat!(
        "M-SEARCH * HTTP/1.1\r\n",
        "HOST: 239.255.255.250:1900\r\n",
        "MAN: \"ssdp:discover\"\r\n",
        "MX: 2\r\n",
        "ST: urn:schemas-upnp-org:service:WANIPConnection:1\r\n",
        "\r\n"
    );
    sock.send_to(msearch.as_bytes(), "239.255.255.250:1900").await.ok()?;

    let mut buf = vec![0u8; 4096];
    let (n, _) = tokio::time::timeout(
        Duration::from_secs(3),
        sock.recv_from(&mut buf),
    ).await.ok()?.ok()?;

    // Parse LOCATION header from SSDP response
    let text = String::from_utf8_lossy(&buf[..n]);
    for line in text.lines() {
        if line.to_ascii_lowercase().starts_with("location:") {
            let loc = line.splitn(2, ':')
                .nth(1).unwrap_or("").trim().to_string();
            // Normalise — some routers omit the scheme
            return Some(if loc.starts_with("http") {
                loc
            } else if loc.starts_with("//") {
                format!("http:{}", loc)
            } else if !loc.is_empty() {
                format!("http://{}", loc)
            } else {
                return None;
            });
        }
    }
    None
}

fn upnp_resolve_control_url(xml: &str, base: &str) -> Option<(String, String)> {
    // Find the WANIPConnection (or WANPPPConnection) service block.
    let svc_pos = xml.find("WANIPConnection")
        .or_else(|| xml.find("WANPPPConnection"))?;
    let svc_type = if xml[svc_pos..].starts_with("WANIPConnection") {
        "urn:schemas-upnp-org:service:WANIPConnection:1"
    } else {
        "urn:schemas-upnp-org:service:WANPPPConnection:1"
    };

    let after = &xml[svc_pos..];
    let ctrl_open = "<controlURL>";
    let ctrl_close = "</controlURL>";
    let cs = after.find(ctrl_open)? + ctrl_open.len();
    let ce = after[cs..].find(ctrl_close)? + cs;
    let path = after[cs..ce].trim();
    if path.is_empty() { return None; }

    // Resolve path against gateway origin
    let ctrl_url = if path.starts_with("http") {
        path.to_string()
    } else {
        let origin: &str = {
            let p = base.find("://").map(|i| i + 3).unwrap_or(0);
            let rest = &base[p..];
            let end = rest.find('/').map(|i| p + i).unwrap_or(base.len());
            &base[..end]
        };
        if path.starts_with('/') {
            format!("{}{}", origin, path)
        } else {
            format!("{}/{}", origin, path)
        }
    };

    Some((ctrl_url, svc_type.to_string()))
}

async fn upnp_soap<B: Into<reqwest::Body>>(
    url: &str,
    action: &str,
    body: B,
) -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build().ok()?;
    let resp = client.post(url)
        .header("SOAPAction", action)
        .header("Content-Type", "text/xml; charset=\"utf-8\"")
        .body(body)
        .send().await.ok()?;
    resp.text().await.ok()
}

async fn try_upnp(port: u16) -> Option<String> {
    let local_ip = upnp_local_ipv4()?.to_string();
    let location = upnp_discover_location().await?;

    // Fetch device description
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build().ok()?;
    let xml = client.get(&location).send().await.ok()?.text().await.ok()?;

    let (ctrl_url, svc_type) = upnp_resolve_control_url(&xml, &location)?;

    // GetExternalIPAddress
    let ext_ip_soap = format!(
        r#"<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:GetExternalIPAddress xmlns:u="{svc}"/></s:Body></s:Envelope>"#,
        svc = svc_type
    );
    let action = format!("\"{}#GetExternalIPAddress\"", svc_type);
    let resp_xml = upnp_soap(&ctrl_url, &action, ext_ip_soap).await?;
    let ext_ip = {
        const TAG: &str = "NewExternalIPAddress>";
        let s = resp_xml.find(TAG)? + TAG.len();
        let e = resp_xml[s..].find('<')? + s;
        resp_xml[s..e].trim().to_string()
    };
    if ext_ip.is_empty() { return None; }

    // DeletePortMapping first (clear stale lease)
    let del_soap = format!(
        r#"<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:DeletePortMapping xmlns:u="{svc}"><NewRemoteHost/><NewExternalPort>{p}</NewExternalPort><NewProtocol>TCP</NewProtocol></u:DeletePortMapping></s:Body></s:Envelope>"#,
        svc = svc_type, p = port
    );
    let _ = upnp_soap(&ctrl_url, &format!("\"{}#DeletePortMapping\"", svc_type), del_soap).await;

    // AddPortMapping
    let add_soap = format!(
        r#"<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:AddPortMapping xmlns:u="{svc}"><NewRemoteHost/><NewExternalPort>{p}</NewExternalPort><NewProtocol>TCP</NewProtocol><NewInternalPort>{p}</NewInternalPort><NewInternalClient>{ip}</NewInternalClient><NewEnabled>1</NewEnabled><NewPortMappingDescription>Irium Core P2P</NewPortMappingDescription><NewLeaseDuration>3600</NewLeaseDuration></u:AddPortMapping></s:Body></s:Envelope>"#,
        svc = svc_type, p = port, ip = local_ip
    );
    let add_resp = upnp_soap(&ctrl_url, &format!("\"{}#AddPortMapping\"", svc_type), add_soap).await?;

    // Success if response contains the success envelope (no fault element)
    if add_resp.contains("Fault") || add_resp.contains("fault") {
        tracing::warn!("[upnp] AddPortMapping rejected: {}", &add_resp[..add_resp.len().min(200)]);
        return None;
    }

    tracing::info!("[upnp] TCP {} mapped → {}:{}", port, ext_ip, port);
    Some(ext_ip)
}

#[tauri::command]
async fn try_upnp_port_map(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let ip = try_upnp(38291).await;
    *state.upnp_external_ip.lock().map_err(lock_err)? = ip.clone();
    Ok(ip)
}

#[tauri::command]
async fn start_node(
    state: State<'_, AppState>,
    data_dir: Option<String>,
    external_ip: Option<String>,
) -> Result<NodeStartResult, String> {
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    // If RPC is already reachable the node is running — don't spawn a second instance.
    if get_rpc_info(&rpc_url).await.is_ok() {
        return Ok(NodeStartResult {
            success: true,
            message: "Node is already running".to_string(),
            pid: None,
        });
    }

    // Check GUI-managed sidecar handle as well.
    {
        let proc_lock = state.node_process.lock().map_err(lock_err)?;
        if proc_lock.is_some() {
            return Ok(NodeStartResult {
                success: false,
                message: "Node process exists but RPC is unreachable — try stopping first".to_string(),
                pid: None,
            });
        }
    }

    // Pre-flight: with RPC unreachable AND no GUI-managed child handle, port
    // 38291 should be free. If it isn't, something else holds it — a stale
    // iriumd from a previous session that survived an unclean shutdown,
    // another Irium Core instance, or an unrelated application. Spawning
    // iriumd here would just see it immediately exit with an EADDRINUSE
    // error that lands in the log buffer with no UI surfacing. Surface a
    // specific structured error so the frontend can render an actionable
    // message. We deliberately do NOT auto-kill the holding process —
    // it might be a legitimate second instance, or an unrelated app that
    // happens to share the port; the user should decide what to stop.
    //
    // The TcpListener is dropped at end-of-statement, releasing the port
    // before we proceed to spawn iriumd below.
    if std::net::TcpListener::bind("0.0.0.0:38291").is_err() {
        return Err(
            "Port 38291 is already in use by another process. Stop any \
             running iriumd from the system tray or Task Manager, then try \
             again."
                .to_string(),
        );
    }

    // Refresh bootstrap / seed files before starting.
    let _ = setup_data_dir().await;

    // Trim accumulated gossip-discovered peers in seedlist.extra to a small
    // random subset BEFORE iriumd reads the file. Without this, iriumd's
    // SeedlistManager hands its bootstrap loop 60+ candidates, most of which
    // are dead nodes from past sessions, and cycling through them at 5
    // peers/5s pushes initial peer connect time into the minutes range.
    trim_seedlist_extra();
    trim_peers_json();
    reset_seed_reputation();

    let mut args = vec!["--http-rpc".to_string()];
    if let Some(dir) = &data_dir {
        args.push("--data-dir".to_string());
        args.push(dir.clone());
    }

    let home_dir = dirs::home_dir().unwrap_or_default();
    let irium_dir = home_dir.join(".irium");

    // Pass configuration via env vars — all verified against irium-source/src/bin/iriumd.rs
    // and irium-source/src/p2p.rs. Only variables actually read by those files are set here.
    let mut node_env = HashMap::new();

    // Data directory hint. storage.rs configured_dir() silently rejects Windows absolute
    // paths (drive-letter prefix causes normalize_under to return None), so we also set
    // HOME and USERPROFILE so os_home_dir() resolves to the right place on Windows.
    node_env.insert("IRIUM_DATA_DIR".to_string(), irium_dir.to_string_lossy().to_string());
    if let Some(home) = dirs::home_dir() {
        let home_str = home.to_string_lossy().to_string();
        node_env.insert("HOME".to_string(), home_str.clone());
        node_env.insert("USERPROFILE".to_string(), home_str);
    }

    // REQUIRED: iriumd starts RPC-only with no peer connections unless this is set.
    node_env.insert("IRIUM_P2P_BIND".to_string(), "0.0.0.0:38291".to_string());

    // Official bootstrap seeds (matches irium-source/bootstrap/seedlist.txt exactly).
    // IRIUM_ADDNODE feeds the seed dial loop directly (highest priority, always retried).
    // NOTE: We deliberately do NOT set IRIUM_TRUSTED_PEERS to these seeds.
    // Trusted seeds trigger a tie-break in connect_and_handshake (p2p.rs:3828):
    // if local_ip > remote_ip (u32), iriumd refuses the outbound dial with "prefer inbound".
    // Our private IP (192.168.x.x ≈ 3.2B) > 157.173.116.134 (≈ 2.6B), so marking that
    // seed as trusted permanently blocks our outbound connection to it. The ADDNODE seed
    // dial loop has no such restriction and handles seeds independently of trusted status.
    // Only the official seed nodes from irium-source/bootstrap/seedlist.txt.
    // Parsed from the bundled constant so adding a seed to the signed file
    // automatically propagates here without a separate code change.
    // Community IPs are deliberately excluded — they go stale as participants
    // change nodes. The gossip system discovers new peers from these seeds.
    let builtin_seeds: Vec<String> = BOOTSTRAP_SEEDLIST_TXT
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .map(|l| l.to_string())
        .collect();

    // Peers organically discovered by iriumd in previous sessions via P2P gossip.
    // No external server dependency — purely local data iriumd wrote itself.
    //
    // We deliberately do NOT chain these into IRIUM_ADDNODE anymore: that list
    // was treating every stale gossip IP as a high-priority dial target, and
    // with 60+ accumulated dead peers in seedlist.extra the seed-dial loop
    // would burn 4-5 minutes timing out + banning each one before settling
    // on the alive few. iriumd's SeedlistManager (irium-source/src/network.rs)
    // reads seedlist.extra independently, so those IPs are still dialed —
    // just at lower priority, after the hardcoded seeds have connected and
    // gossip can re-validate them. We keep the read here only to log the
    // count so it's visible in app logs how many extras the node knows about.
    let extra_seeds = read_extra_seeds();
    if !extra_seeds.is_empty() {
        tracing::info!("[start_node] {} extra seeds in seedlist.extra (iriumd reads these via SeedlistManager; not promoted to IRIUM_ADDNODE)", extra_seeds.len());
    }

    // UPnP: ask the router to open TCP 38291 so other NAT-behind nodes can
    // dial us inbound. Seeds learn our dialable address and share it via PEX.
    // On success the router's external IP is returned (same as public IP).
    let upnp_ip = try_upnp(38291).await;
    if let Some(ref ip) = upnp_ip {
        tracing::info!("[start_node] UPnP active — TCP 38291 mapped via router, external IP: {}", ip);
        *state.upnp_external_ip.lock().map_err(lock_err)? = Some(ip.clone());
    } else {
        tracing::info!("[start_node] UPnP not available — relying on manual port forwarding or inbound-only mode");
        *state.upnp_external_ip.lock().map_err(lock_err)? = None;
    }

    // Dialable IP: only set when the user has EXPLICITLY confirmed the port
    // is open (via the external-IP override in Settings). UPnP can map the
    // router port, but we have no way to verify the mapped port is actually
    // reachable from the internet (ISP firewall, double-NAT, etc.). If we
    // announce an unreachable IP, the seed's sybil challenge issues a
    // reachability probe (connect-back to IP:38291) that fails silently,
    // giving success=0 on every outbound handshake — the node never connects.
    // The CLI never sets IRIUM_NODE_PUBLIC_IP and connects in 10-15 s.
    // UPnP port mapping is still performed above (other nodes may reach us
    // via gossip without us announcing), but we do NOT use it to set dialable_ip.
    let dialable_ip: Option<String> = if let Some(ref ip) = external_ip {
        let t = ip.trim();
        if !t.is_empty() { Some(t.to_string()) } else { None }
    } else {
        None // Never announce from UPnP — reachability unverified
    };

    // Detected IP: used only for self-dial prevention (own_ip filter below).
    // iriumd gossip can propagate our address to other peers; without knowing
    // our external IP, iriumd can't filter it out via is_self_ip and may try
    // to dial itself. We detect the IP via HTTP even in outbound-only mode,
    // but do NOT pass it to iriumd as IRIUM_NODE_PUBLIC_IP (that would
    // re-introduce the reachability-probe failure described above).
    let detected_ip: Option<String> = if dialable_ip.is_some() {
        dialable_ip.clone()
    } else {
        detect_public_ip("https://api4.ipify.org".to_string())
            .await
            .ok()
            .map(|ip| ip.trim().to_string())
    };

    // High-priority dial list — only the known-reliable official seeds.
    // Own public IP filtered out so iriumd doesn't try to dial itself.
    // seedlist.extra entries are intentionally NOT included here (see the
    // longer comment above where extra_seeds is read).
    let own_ip = detected_ip.as_deref().unwrap_or("").trim().to_string();
    let mut seen = std::collections::HashSet::new();
    let bootstrap_seeds: String = builtin_seeds
        .into_iter()
        .filter(|ip| !ip.is_empty() && ip.as_str() != own_ip.as_str() && seen.insert(ip.clone()))
        .collect::<Vec<_>>()
        .join(",");
    node_env.insert("IRIUM_ADDNODE".to_string(), bootstrap_seeds);

    // Seed dial backoff tuning (iriumd.rs uses these for the bootstrap reconnect loop).
    // Retry disconnected seeds quickly (base 1 s, cap at 60 s) on a small network.
    node_env.insert("IRIUM_SEED_DIAL_BASE_SECS".to_string(), "1".to_string());
    node_env.insert("IRIUM_SEED_DIAL_MAX_SECS".to_string(), "60".to_string());
    node_env.insert("IRIUM_SEED_DIAL_BANNED_SECS".to_string(), "30".to_string());
    // Seeds on a small network are often saturated; give them 300 s to send the sybil challenge
    // (default 120 s times out before the overloaded seed responds).
    node_env.insert("IRIUM_P2P_SYBIL_CHALLENGE_TIMEOUT_SECS".to_string(), "300".to_string());

    // Temp-ban window: 30 s instead of the default 120 s so transient failures
    // don't lock out the only available peers for long on a small network.
    node_env.insert("IRIUM_P2P_TEMP_BAN_SECS".to_string(), "30".to_string());

    // Parallel blocking threads for header/block processing (default 2).
    node_env.insert("IRIUM_P2P_BLOCKING_CONCURRENCY".to_string(), "4".to_string());

    // RPC rate limit: bump from default 120/min (2/s) to 600/min (10/s).
    // The GUI's 15s wallet poll fires 8 sequential /rpc/balance calls in a
    // burst, and the Explorer Refresh button can fire up to ~30 /rpc/block
    // calls. At the default 120 limit the burst depletes the token bucket
    // (shared per IP across all RPC endpoints), causing /rpc/balance to
    // return 429 and the wallet UI to render "—" for some addresses.
    node_env.insert("IRIUM_RATE_LIMIT_PER_MIN".to_string(), "600".to_string());

    // Raise the total peer ceiling so iriumd keeps seeking peers via gossip.
    // Real var is IRIUM_P2P_MAX_PEERS (clamp 10-500, default 100). 24 gives
    // room to grow well beyond the 11 seed nodes without going overboard.
    node_env.insert("IRIUM_P2P_MAX_PEERS".to_string(), "24".to_string());

    // Gap healer: fill missing persisted blocks more aggressively than defaults
    // (default 30 s / 100 blocks → 15 s / 200 blocks).
    node_env.insert("IRIUM_GAP_HEALER_SECS".to_string(), "15".to_string());
    node_env.insert("IRIUM_GAP_HEALER_BATCH".to_string(), "200".to_string());

    // Sync cooldown between block-range requests per peer (default 2 s → 1 s).
    node_env.insert("IRIUM_P2P_SYNC_COOLDOWN_SECS".to_string(), "1".to_string());

    // Per-peer outbound TCP connect timeout (p2p.rs IRIUM_P2P_CONNECT_TIMEOUT_SECS,
    // default 8 s, clamped [2, 30]). Tightened to 3 s so dead gossip seeds
    // fail fast — with peers.json trimmed to 10 entries the total worst-case
    // dial drain is 30 s instead of the former 190 s (38 stale × 5 s each).
    node_env.insert("IRIUM_P2P_CONNECT_TIMEOUT_SECS".to_string(), "3".to_string());

    // Only announce the node's public IP when the port is confirmed open.
    // If UPnP succeeded (dialable_ip is Some), seeds can reach us inbound and
    // will mark us as dialable via PEX. If UPnP failed, we skip this entirely:
    // announcing an unreachable IP causes the seed's sybil challenge to issue a
    // reachability probe (connect-back to our IP:38291) which fails silently,
    // giving success=0 on every outbound handshake attempt. Without this var
    // iriumd operates in outbound-only mode — still fully syncs and connects.
    if let Some(ref ip) = dialable_ip {
        if !ip.is_empty() {
            node_env.insert("IRIUM_NODE_PUBLIC_IP".to_string(), ip.clone());
            node_env.insert("IRIUM_PUBLIC_IP".to_string(), ip.clone());
            tracing::info!("[start_node] announcing dialable public IP: {} (UPnP confirmed)", ip);
        }
    } else {
        tracing::info!("[start_node] UPnP unavailable — outbound-only mode, not announcing public IP");
    }

    // Try Tauri sidecar first; fall back to launching iriumd from system PATH.
    match Command::new_sidecar("iriumd") {
        Ok(cmd) => {
            match cmd
                .envs(node_env)
                .args(&args)
                .current_dir(irium_dir.clone())
                .spawn()
            {
                Ok((mut rx, child)) => {
                    let pid = child.pid();
                    let node_ref = Arc::clone(&state.node_process);
                    {
                        let mut proc_lock = state.node_process.lock().map_err(lock_err)?;
                        *proc_lock = Some(child);
                    }
                    let logs_ref = Arc::clone(&state.node_logs);
                    tauri::async_runtime::spawn(async move {
                        while let Some(event) = rx.recv().await {
                            match event {
                                CommandEvent::Stdout(line) => {
                                    tracing::info!("[iriumd] {}", line);
                                    if let Ok(mut logs) = logs_ref.lock() {
                                        logs.push(line);
                                        if logs.len() > 2000 { logs.drain(0..500); }
                                    }
                                },
                                CommandEvent::Stderr(line) => {
                                    tracing::warn!("[iriumd stderr] {}", line);
                                    if let Ok(mut logs) = logs_ref.lock() {
                                        logs.push(format!("[stderr] {}", line));
                                        if logs.len() > 2000 { logs.drain(0..500); }
                                    }
                                },
                                CommandEvent::Terminated(_) => {
                                    // iriumd exited — clear the slot so start_node can relaunch.
                                    if let Ok(mut lock) = node_ref.lock() { *lock = None; }
                                    break;
                                }
                                _ => {}
                            }
                        }
                    });
                    Ok(NodeStartResult {
                        success: true,
                        message: "Node started (sidecar)".to_string(),
                        pid: Some(pid),
                    })
                }
                Err(e) => Err(format!("Failed to spawn iriumd sidecar: {}", e)),
            }
        }
        Err(_) => {
            // Sidecar binary not in src-tauri/binaries/ — try iriumd from system PATH.
            let mut sys_cmd = std::process::Command::new("iriumd");
            for (k, v) in &node_env {
                sys_cmd.env(k, v);
            }
            for arg in &args {
                sys_cmd.arg(arg);
            }
            sys_cmd.current_dir(&irium_dir);

            // Suppress the console window on Windows so it doesn't flash open.
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x08000000;
                sys_cmd.creation_flags(CREATE_NO_WINDOW);
            }

            match sys_cmd.spawn() {
                Ok(child) => {
                    let pid = child.id();
                    // stop_node uses taskkill/pkill so it handles PATH-started processes too.
                    Ok(NodeStartResult {
                        success: true,
                        message: format!("Node started from PATH (PID {})", pid),
                        pid: Some(pid),
                    })
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    Ok(NodeStartResult {
                        success: false,
                        message: "iriumd not found. Place the binary in src-tauri/binaries/ or add it to your system PATH.".to_string(),
                        pid: None,
                    })
                }
                Err(e) => Ok(NodeStartResult {
                    success: false,
                    message: format!("Failed to start iriumd: {}", e),
                    pid: None,
                }),
            }
        }
    }
}

#[tauri::command]
async fn stop_node(state: State<'_, AppState>) -> Result<bool, String> {
    // Kill the GUI-spawned sidecar if it exists
    {
        let mut proc_lock = state.node_process.lock().map_err(lock_err)?;
        if let Some(child) = proc_lock.take() {
            let _ = child.kill();
        }
    }
    // Kill the explorer sidecar
    {
        let mut proc_lock = state.explorer_process.lock().map_err(lock_err)?;
        if let Some(child) = proc_lock.take() {
            let _ = child.kill();
        }
    }
    // Also kill any externally-started iriumd process (handles nodes started outside the GUI)
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/IM", "iriumd-x86_64-pc-windows-msvc.exe"])
            .output();
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/IM", "iriumd.exe"])
            .output();
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/IM", "irium-explorer-x86_64-pc-windows-msvc.exe"])
            .output();
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/IM", "irium-explorer.exe"])
            .output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("pkill")
            .args(["-9", "-f", "iriumd"])
            .output();
        let _ = std::process::Command::new("pkill")
            .args(["-9", "-f", "irium-explorer"])
            .output();
    }
    Ok(true)
}

// clear_node_state: wipes ~/.irium/state/ and ~/.irium/blocks/ so iriumd resyncs
// from scratch on next start. Wallet files and bootstrap config are preserved.
#[tauri::command]
async fn clear_node_state(state: State<'_, AppState>) -> Result<bool, String> {
    // Kill the node first (same logic as stop_node).
    {
        let mut proc_lock = state.node_process.lock().map_err(lock_err)?;
        if let Some(child) = proc_lock.take() {
            let _ = child.kill();
        }
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/IM", "iriumd-x86_64-pc-windows-msvc.exe"])
            .output();
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/IM", "iriumd.exe"])
            .output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("pkill").args(["-9", "-f", "iriumd"]).output();
    }

    // Give the process a moment to fully exit before we delete files it may have open.
    std::thread::sleep(std::time::Duration::from_millis(1500));

    let home_dir = dirs::home_dir()
        .ok_or_else(|| "Cannot determine home directory".to_string())?;
    let irium_dir = home_dir.join(".irium");

    // Preserve state/peers.json — iriumd's persistent peer database with metadata.
    // Keeping it means we reconnect to known-good peers instead of cold-starting.
    let peers_path = irium_dir.join("state").join("peers.json");
    let saved_peers = std::fs::read_to_string(&peers_path).ok();

    // Delete chain state directories — iriumd rebuilds these on next start.
    // Wallet files (wallet.json, *.key) live directly in ~/.irium/ and are untouched.
    for dir_name in &["state", "blocks"] {
        let dir = irium_dir.join(dir_name);
        if dir.exists() {
            std::fs::remove_dir_all(&dir)
                .map_err(|e| format!("Failed to remove ~/.irium/{}: {}", dir_name, e))?;
        }
    }

    // Restore peers.json so the node inherits its peer knowledge.
    if let Some(peers_json) = saved_peers {
        let state_dir = irium_dir.join("state");
        let _ = std::fs::create_dir_all(&state_dir);
        let _ = std::fs::write(state_dir.join("peers.json"), peers_json);
    }

    // Refresh seed files so the fresh node connects to the latest known peers.
    let _ = setup_data_dir_inner().await;

    Ok(true)
}

// setup_data_dir: creates ~/.irium/bootstrap/ and writes all seed/anchor files.
#[tauri::command]
async fn setup_data_dir() -> Result<bool, String> {
    setup_data_dir_inner().await
}

async fn setup_data_dir_inner() -> Result<bool, String> {
    let home_dir = dirs::home_dir()
        .ok_or_else(|| "Cannot determine home directory".to_string())?;
    let irium_dir     = home_dir.join(".irium");
    let bootstrap_dir = irium_dir.join("bootstrap");
    let trust_dir     = bootstrap_dir.join("trust");

    for dir in &[&irium_dir, &bootstrap_dir, &trust_dir] {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Cannot create {}: {}", dir.display(), e))?;
    }

    // Repair: remove seedlist.txt if broken format or too few seeds (forces refresh from embedded list).
    let seedlist_path = bootstrap_dir.join("seedlist.txt");
    if seedlist_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&seedlist_path) {
            let seed_count = content.lines()
                .filter(|l| !l.starts_with('#') && !l.trim().is_empty())
                .count();
            if seed_count < 5
                || content.contains("\\ip4\\") || content.contains("\\tcp\\")
                || content.contains("/ip4/") || content.contains(":38291")
            {
                let _ = std::fs::remove_file(&seedlist_path);
            }
        }
    }

    // Write-once: files with cryptographic signatures must never be overwritten
    // once present on disk — a newer signed version from the network takes precedence.
    let write_once: &[(&str, &str)] = &[
        ("bootstrap/anchors.json",      BOOTSTRAP_ANCHORS_JSON),
        ("bootstrap/seedlist.txt",      BOOTSTRAP_SEEDLIST_TXT),
        ("bootstrap/seedlist.txt.sig",  BOOTSTRAP_SEEDLIST_SIG),
        ("bootstrap/banned_peers.txt",  ""),
    ];
    for (rel_path, content) in write_once {
        let full_path = irium_dir.join(rel_path);
        if !full_path.exists() {
            std::fs::write(&full_path, content)
                .map_err(|e| format!("Cannot write {}: {}", full_path.display(), e))?;
        }
    }

    // Always-refresh: trust keys and static peers update with each new node build.
    let always: &[(&str, &str)] = &[
        ("bootstrap/trust/allowed_signers",         BOOTSTRAP_ALLOWED_SIGNERS),
        ("bootstrap/trust/allowed_anchor_signers",  BOOTSTRAP_ALLOWED_ANCHOR_SIGNERS),
        ("bootstrap/trust/allowed_ban_signers",     BOOTSTRAP_ALLOWED_BAN_SIGNERS),
        ("bootstrap/static_peers.txt",              BOOTSTRAP_STATIC_PEERS),
    ];
    for (rel_path, content) in always {
        let full_path = irium_dir.join(rel_path);
        std::fs::write(&full_path, content)
            .map_err(|e| format!("Cannot write {}: {}", full_path.display(), e))?;
    }

    // Promote all peers from peers.json → seedlist.extra so iriumd's seed dial loop
    // can reach them directly at startup (bypassing the last_height filter in
    // connect_known_peers that blocks newly-discovered peers with no known height).
    // Without this, 1000+ discovered peers sit in the peer directory forever undialed.
    let peers_json_path = irium_dir.join("state").join("peers.json");
    if let Ok(raw) = std::fs::read_to_string(&peers_json_path) {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(obj) = val.as_object() {
                let extra_path = bootstrap_dir.join("seedlist.extra");
                let existing = std::fs::read_to_string(&extra_path).unwrap_or_default();
                let mut entries: std::collections::HashSet<String> = existing
                    .lines()
                    .filter(|l| !l.trim().is_empty() && !l.trim().starts_with('#'))
                    .map(|l| l.trim().to_string())
                    .collect();
                let before = entries.len();
                for multiaddr in obj.keys() {
                    // Convert /ip4/X.X.X.X/tcp/PORT → X.X.X.X:PORT
                    // Only include stable listening ports (< 32768 threshold).
                    // Ephemeral ports (> 32768) are outbound client ports from inbound
                    // connections to us — they're useless for outbound dialing.
                    let parts: Vec<&str> = multiaddr.split('/').collect();
                    if parts.len() >= 5 && parts[1] == "ip4" && parts[3] == "tcp" {
                        // Only include the standard Irium P2P port (38291).
                        // Ephemeral client ports recorded from inbound connections
                        // are useless for outbound dialing.
                        if parts[4] == "38291" {
                            entries.insert(format!("{}:38291", parts[2]));
                        }
                    }
                }
                if entries.len() > before {
                    let content: String = entries.iter()
                        .cloned()
                        .collect::<Vec<_>>()
                        .join("\n") + "\n";
                    let _ = std::fs::write(&extra_path, content);
                    tracing::info!(
                        "[setup_data_dir] promoted {} peers from peers.json to seedlist.extra (was {}, now {})",
                        entries.len() - before, before, entries.len()
                    );
                }
            }
        }
    }

    // One-time block migration: previous versions of this app stored blocks in
    // AppData\Roaming\Irium\IriumCore\data\.irium\blocks\ (the Tauri app_data_dir).
    // The current version uses ~/.irium/blocks/ (iriumd's native home-dir layout).
    // Hard-link any blocks from the legacy location so iriumd resumes from the
    // highest already-synced height instead of re-downloading from genesis.
    // Hard links are instant on the same drive and use no extra disk space.
    let local_blocks = irium_dir.join("blocks");
    let _ = std::fs::create_dir_all(&local_blocks);
    if let Some(data_dir) = dirs::data_dir() {
        let legacy_blocks = data_dir
            .join("Irium").join("IriumCore").join("data").join(".irium").join("blocks");
        if legacy_blocks.exists() && legacy_blocks != local_blocks {
            let legacy_count = std::fs::read_dir(&legacy_blocks)
                .map(|d| d.count()).unwrap_or(0);
            let local_count = std::fs::read_dir(&local_blocks)
                .map(|d| d.count()).unwrap_or(0);
            if legacy_count > local_count + 10 {
                let mut migrated = 0usize;
                if let Ok(entries) = std::fs::read_dir(&legacy_blocks) {
                    for entry in entries.flatten() {
                        let src = entry.path();
                        if src.is_file() {
                            if let Some(name) = src.file_name() {
                                let dst = local_blocks.join(name);
                                if !dst.exists() {
                                    if std::fs::hard_link(&src, &dst).is_err() {
                                        let _ = std::fs::copy(&src, &dst);
                                    }
                                    migrated += 1;
                                }
                            }
                        }
                    }
                }
                if migrated > 0 {
                    tracing::info!(
                        "[setup_data_dir] migrated {} block files from legacy AppData path to ~/.irium/blocks/",
                        migrated
                    );
                }
            }
        }
    }

    // Also migrate state files (node_id, peers.json) so the node keeps its identity
    // and peer history across the data-dir change.
    let local_state = irium_dir.join("state");
    let _ = std::fs::create_dir_all(&local_state);
    if let Some(data_dir) = dirs::data_dir() {
        let legacy_state = data_dir
            .join("Irium").join("IriumCore").join("data").join(".irium").join("state");
        for file in &["node_id", "peers.json", "peer_reputation.json"] {
            let src = legacy_state.join(file);
            let dst = local_state.join(file);
            if src.exists() && !dst.exists() {
                let _ = std::fs::copy(&src, &dst);
            }
        }
    }

    Ok(true)
}

// Parses /ip4/X.X.X.X/tcp/PORT → "X.X.X.X:PORT"
fn multiaddr_to_ip_port(addr: &str) -> Option<String> {
    let parts: Vec<&str> = addr.split('/').collect();
    // expected: ["", "ip4", "X.X.X.X", "tcp", "PORT", ...]
    if parts.len() >= 5 && parts[1] == "ip4" && parts[3] == "tcp" {
        Some(format!("{}:{}", parts[2], parts[4]))
    } else {
        None
    }
}

// save_discovered_peers: appends live peer addresses discovered via /peers into
// bootstrap/seedlist.extra — the unsigned extra seeds file that iriumd merges
// dynamically. Format is IP:PORT one per line (never multiaddr in this file).
// seedlist.txt is signed and must never be touched here.
#[tauri::command]
async fn save_discovered_peers(multiaddrs: Vec<String>) -> Result<u32, String> {
    if multiaddrs.is_empty() { return Ok(0); }

    let home_dir = dirs::home_dir()
        .ok_or_else(|| "Cannot determine home directory".to_string())?;
    let irium_dir  = home_dir.join(".irium");
    let extra_path = irium_dir.join("bootstrap").join("seedlist.extra");

    // Ensure bootstrap dir exists.
    let _ = std::fs::create_dir_all(irium_dir.join("bootstrap"));

    // Read existing entries from seedlist.extra.
    let existing = std::fs::read_to_string(&extra_path).unwrap_or_default();
    let mut entries: std::collections::HashSet<String> = existing
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.trim().to_string())
        .collect();

    let before = entries.len();

    for addr in &multiaddrs {
        let trimmed = addr.trim().to_string();
        if trimmed.is_empty() { continue; }
        // seedlist.extra uses IP:PORT format only.
        if let Some(ip_port) = multiaddr_to_ip_port(&trimmed) {
            entries.insert(ip_port);
        } else if trimmed.contains(':') && !trimmed.starts_with('/') {
            // Already in host:port form.
            entries.insert(trimmed);
        }
    }

    let added = (entries.len().saturating_sub(before)) as u32;
    if added == 0 { return Ok(0); }

    // Sort for deterministic output; cap at 500 entries to bound file size.
    let mut sorted: Vec<String> = entries.into_iter().collect();
    sorted.sort();
    sorted.truncate(500);
    let content = sorted.join("\n") + "\n";

    std::fs::write(&extra_path, &content)
        .map_err(|e| format!("Failed to write seedlist.extra: {}", e))?;

    Ok(added)
}

// check_binaries: returns which sidecar binaries are present.
// Command::new_sidecar returns Err if the binary file cannot be found.
#[tauri::command]
async fn check_binaries() -> Result<BinaryCheckResult, String> {
    Ok(BinaryCheckResult {
        iriumd:       Command::new_sidecar("iriumd").is_ok(),
        irium_wallet: Command::new_sidecar("irium-wallet").is_ok(),
        irium_miner:  Command::new_sidecar("irium-miner").is_ok(),
    })
}

// get_node_metrics: scrapes iriumd's Prometheus-style /metrics endpoint and
// extracts the two counters the GUI cares about — inbound_accepted_total
// (used to detect whether port forwarding is actually working, independent
// of UPnP success) and outbound_dial_success_total. Returns zeros on any
// failure so the UI can render without special-casing — a stuck/offline
// node simply shows 0 inbound, same as a healthy node before peers dial in.
#[tauri::command]
async fn get_node_metrics(state: State<'_, AppState>) -> Result<NodeMetrics, String> {
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let client = reqwest::Client::new();
    let resp = match client
        .get(format!("{}/metrics", rpc_url))
        .timeout(Duration::from_secs(3))
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return Ok(NodeMetrics::default()),
    };
    let text = match resp.text().await {
        Ok(t) => t,
        Err(_) => return Ok(NodeMetrics::default()),
    };

    // Each metric line is `metric_name <value>`. Lines starting with '#'
    // are HELP/TYPE annotations — Prometheus convention. We only need two
    // counters here, so a line-by-line scan is simpler than a real parser.
    let mut metrics = NodeMetrics::default();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') { continue; }
        let mut parts = line.splitn(2, char::is_whitespace);
        let name = match parts.next() { Some(n) => n, None => continue };
        let value_str = match parts.next() { Some(v) => v.trim(), None => continue };
        match name {
            "irium_inbound_accepted_total" => {
                if let Ok(v) = value_str.parse::<u64>() {
                    metrics.inbound_accepted_total = v;
                }
            }
            "irium_outbound_dial_success_total" => {
                if let Ok(v) = value_str.parse::<u64>() {
                    metrics.outbound_dial_success_total = v;
                }
            }
            _ => {}
        }
    }
    Ok(metrics)
}

// get_node_status: fully decentralized — reads only from the local node's RPC.
// network_tip is derived from the maximum height reported by connected peers.
// best_header_tip from /status mirrors the local chain height, not the true peer tip.
#[tauri::command]
async fn get_node_status(state: State<'_, AppState>) -> Result<NodeStatus, String> {
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    match get_rpc_info(&rpc_url).await {
        Ok(info) => {
            let tip = info.best_header_tip.as_ref()
                .map(|t| t.hash.clone())
                .unwrap_or_default();
            let local_height = info.height.unwrap_or(0);
            let peers = info.peer_count.unwrap_or(0);

            // Query /peers to get heights reported by each connected peer.
            // This gives the true network tip, not just what iriumd has locally committed.
            let peer_max_height: u64 = {
                let client = reqwest::Client::new();
                match client
                    .get(format!("{}/peers", rpc_url))
                    .timeout(Duration::from_secs(3))
                    .send()
                    .await
                {
                    Ok(resp) => match resp.json::<PeersResponse>().await {
                        Ok(pr) => pr.peers.iter().filter_map(|p| p.height).max().unwrap_or(0),
                        Err(_) => 0,
                    },
                    Err(_) => 0,
                }
            };

            // Use the maximum of: peer-reported tip, best_header_tip, local height.
            // peer_max_height is the authoritative network tip when peers are connected.
            let best_header_height = info.best_header_tip.as_ref().map(|t| t.height).unwrap_or(0);
            let network_tip = peer_max_height.max(best_header_height).max(local_height);

            // Synced when: anchor loaded, at least one peer, and within 10 blocks of tip.
            let synced = info.anchor_loaded.unwrap_or(false)
                && peers > 0
                && network_tip > 0
                && local_height >= network_tip.saturating_sub(10);

            let upnp_ip = state.upnp_external_ip.lock().map_err(lock_err)?.clone();
            let status = NodeStatus {
                running: true,
                synced,
                height: local_height,
                network_tip,
                tip,
                peers,
                network: info.network_era.unwrap_or_else(|| "irium".to_string()),
                version: String::new(),
                rpc_url: rpc_url.clone(),
                upnp_active: upnp_ip.is_some(),
                upnp_external_ip: upnp_ip,
            };
            *state.last_node_status.lock().map_err(lock_err)? = Some(status.clone());
            Ok(status)
        }
        Err(_) => {
            // RPC not reachable — node is offline
            *state.last_node_status.lock().map_err(lock_err)? = None;
            let upnp_ip = state.upnp_external_ip.lock().map_err(lock_err)?.clone();
            Ok(NodeStatus {
                running: false,
                synced: false,
                height: 0,
                network_tip: 0,
                tip: String::new(),
                peers: 0,
                network: "irium".to_string(),
                version: String::new(),
                rpc_url,
                upnp_active: upnp_ip.is_some(),
                upnp_external_ip: upnp_ip,
            })
        }
    }
}

// ============================================================
// WALLET COMMANDS
// ============================================================

// wallet_get_balance: lists all addresses, sums balances via /rpc/balance
#[tauri::command]
async fn wallet_get_balance(state: State<'_, AppState>) -> Result<WalletBalance, String> {
    // Mirror wallet_list_addresses: pass whatever wallet_path is in state to the
    // binary (None → binary uses its own default ~/.irium/wallet.json). This was
    // previously short-circuiting to all-zeros when wallet_path was None, which
    // made the hero balance read 0 even though wallet_list_addresses correctly
    // surfaced the same wallet's addresses with balances via the binary default.
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    let addr_output = run_wallet_cmd(
        vec!["list-addresses".to_string()],
        wallet_path, data_dir,
    ).await.unwrap_or_default();

    let addresses: Vec<String> = addr_output
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    if addresses.is_empty() {
        return Ok(WalletBalance { confirmed: 0, unconfirmed: 0, total: 0 });
    }

    let client = reqwest::Client::new();
    let mut total: u64 = 0;
    for addr in &addresses {
        let url = format!("{}/rpc/balance?address={}", rpc_url, addr);
        if let Ok(resp) = client.get(&url).timeout(Duration::from_secs(5)).send().await {
            if let Ok(b) = resp.json::<RpcBalance>().await {
                total = total.saturating_add(b.balance);
            }
        }
    }

    Ok(WalletBalance { confirmed: total, unconfirmed: 0, total })
}

// wallet_new_address: derives a new address and returns it
#[tauri::command]
async fn wallet_new_address(state: State<'_, AppState>) -> Result<String, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();

    run_wallet_cmd(vec!["new-address".to_string()], wallet_path.clone(), data_dir.clone()).await?;

    let list = run_wallet_cmd(vec!["list-addresses".to_string()], wallet_path, data_dir).await?;
    Ok(list.lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .last()
        .unwrap_or_default())
}

// wallet_list_addresses: list-addresses outputs one address per line.
// Also fetches RPC balance per address (best-effort — returns None if node offline).
#[tauri::command]
async fn wallet_list_addresses(state: State<'_, AppState>) -> Result<Vec<AddressInfo>, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    let output = run_wallet_cmd(vec!["list-addresses".to_string()], wallet_path, data_dir).await?;

    let raw_addrs: Vec<String> = output
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    let client = reqwest::Client::new();
    let mut results = Vec::with_capacity(raw_addrs.len());
    for (idx, address) in raw_addrs.into_iter().enumerate() {
        let balance = fetch_address_balance_sats(&client, &rpc_url, &address).await;
        results.push(AddressInfo { address, label: None, balance, index: Some(idx as u32) });
    }

    Ok(results)
}

// wallet_send: send <from_addr> <to_addr> <amount_irm> [--fee <irm>] --rpc <url>
#[tauri::command]
async fn wallet_send(
    state: State<'_, AppState>,
    to: String,
    amount_sats: u64,
    fee_sats: Option<u64>,
) -> Result<SendResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    let from = get_first_wallet_address(wallet_path.clone(), data_dir.clone()).await?;

    let amount_irm = format!("{:.8}", sats_to_irm(amount_sats));
    let mut args = vec![
        "send".to_string(),
        from,
        to.clone(),
        amount_irm,
    ];
    if let Some(fee) = fee_sats {
        args.push(format!("--fee={:.8}", sats_to_irm(fee)));
    }

    let output = run_wallet_cmd_with_rpc(args, wallet_path, data_dir, rpc_url).await?;
    let txid = output.trim().to_string();
    Ok(SendResult { txid, amount: amount_sats, fee: fee_sats.unwrap_or(0) })
}

// wallet_transactions: queries /rpc/history for each wallet address
#[tauri::command]
async fn wallet_transactions(
    state: State<'_, AppState>,
    limit: Option<u32>,
    address: Option<String>,
) -> Result<Vec<Transaction>, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    // If the caller passes an explicit `address`, query only that one —
    // mirrors the binary's `history <base58_addr>` command and the RPC's
    // `?address=` filter. Otherwise fall back to listing every wallet
    // address and concatenating their histories (legacy "all transactions"
    // behaviour used by the Dashboard's recent-activity feed).
    let addresses: Vec<String> = if let Some(addr) = address {
        let trimmed = addr.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }
        vec![trimmed.to_string()]
    } else {
        let addr_output = run_wallet_cmd(
            vec!["list-addresses".to_string()],
            wallet_path,
            data_dir,
        )
        .await
        .unwrap_or_default();
        addr_output
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect()
    };

    let client = reqwest::Client::new();
    let mut all_txs: Vec<Transaction> = Vec::new();

    for addr in &addresses {
        let url = format!("{}/rpc/history?address={}", rpc_url, addr);
        if let Ok(resp) = client.get(&url).timeout(Duration::from_secs(10)).send().await {
            if let Ok(history) = resp.json::<RpcHistoryResponse>().await {
                let current_height = history.height;
                for tx in history.txs {
                    // Off-by-one fix: a tx in the tip block has 1 confirmation,
                    // not 0. Frontend recomputes this from `height` anyway, but
                    // we keep the field accurate too so any consumer using
                    // `confirmations` directly gets the right value.
                    let confirmations = if tx.height > 0 && current_height >= tx.height {
                        current_height - tx.height + 1
                    } else {
                        0
                    };
                    let direction = if tx.net >= 0 { "receive" } else { "send" };
                    all_txs.push(Transaction {
                        txid: tx.txid,
                        amount: tx.net,
                        fee: None,
                        confirmations,
                        height: if tx.height > 0 { Some(tx.height) } else { None },
                        timestamp: None,
                        direction: direction.to_string(),
                        address: Some(addr.clone()),
                        is_coinbase: Some(tx.is_coinbase),
                    });
                }
            }
        }
    }

    if let Some(n) = limit {
        all_txs.truncate(n as usize);
    }

    Ok(all_txs)
}

#[tauri::command]
async fn wallet_set_path(state: State<'_, AppState>, path: String) -> Result<bool, String> {
    *state.wallet_path.lock().map_err(lock_err)? = Some(path);
    Ok(true)
}

// Info about a wallet file on disk — used by the Manage Wallets panel to list
// every wallet*.json under ~/.irium/ so the user can switch between them.
#[derive(serde::Serialize)]
struct WalletFileInfo {
    path:      String,
    name:      String,
    size:      u64,
    is_active: bool,
}

// Known non-wallet JSON files written by iriumd or the GUI into ~/.irium/.
// Fast-pathed by name so we don't even bother opening them. If new config
// files appear in the future, the wallet-content check below will still
// reject them defensively, but adding the name here saves a parse.
const NON_WALLET_JSON_FILES: &[&str] = &[
    "anchors.json",
    "discovered_feeds.json",
    "feeds.json",
    "node.json",
    "settings.json",
    "config.json",
];

// Returns true if the file at `path` parses as a wallet JSON document.
// Wallet files have at least one of these distinguishing top-level keys:
//   - "bip32_seed"  (BIP32 wallets — current default)
//   - "mnemonic"    (HD wallets with a recovery phrase)
//   - "keys"        (legacy single-key wallets)
// anchors.json has "anchors"; discovered_feeds.json has "feeds"; neither
// has any of the wallet markers, so they're correctly filtered out by the
// content check alone — the name list above is just a fast-path.
fn is_wallet_json_file(path: &std::path::Path) -> bool {
    let Ok(contents) = std::fs::read_to_string(path) else { return false };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&contents) else { return false };
    let Some(obj) = parsed.as_object() else { return false };
    obj.contains_key("bip32_seed")
        || obj.contains_key("mnemonic")
        || obj.contains_key("keys")
}

// Scan ~/.irium/ for any .json file that looks like a wallet. Returns a
// list with wallet.json (if present) first, then every other wallet file
// alphabetically. Files renamed away from the wallet*.json glob (e.g.
// "Primary-wallet.json", "savings.json") still appear because the
// detection is content-based, not name-based. The currently-active wallet
// (state.wallet_path) is flagged so the UI can show the green dot /
// "Active" badge.
#[tauri::command]
async fn list_wallet_files(state: State<'_, AppState>) -> Result<Vec<WalletFileInfo>, String> {
    let irium_dir = dirs::home_dir().unwrap_or_default().join(".irium");
    let active_path = state.wallet_path.lock().map_err(lock_err)?.clone();

    // Resolve "active" — when wallet_path is unset the binary defaults to
    // ~/.irium/wallet.json, so report that as active in that case.
    let active_resolved = active_path.unwrap_or_else(resolve_wallet_path);

    let read = match std::fs::read_dir(&irium_dir) {
        Ok(r) => r,
        Err(_) => return Ok(Vec::new()), // no .irium dir yet — nothing to list
    };

    let mut files: Vec<WalletFileInfo> = Vec::new();
    for entry in read.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|s| s.to_str()).map(|s| s.to_string()) else { continue };

        // Must be a regular *.json file (not a subdirectory, not anchors etc).
        if !name.to_ascii_lowercase().ends_with(".json") {
            continue;
        }
        if !path.is_file() {
            continue;
        }
        if NON_WALLET_JSON_FILES
            .iter()
            .any(|n| n.eq_ignore_ascii_case(&name))
        {
            continue;
        }

        // Content check — defensive against new config files. Files small
        // (a few KB at most), and list_wallet_files only fires when the
        // panel opens or after a wallet operation, so the parse cost is
        // negligible.
        if !is_wallet_json_file(&path) {
            continue;
        }

        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        let path_s = path.to_string_lossy().to_string();
        let is_active = path_s == active_resolved;
        files.push(WalletFileInfo { path: path_s, name, size, is_active });
    }

    // Sort: wallet.json first (case-insensitive — Windows is flexible
    // about filename case), then everything else alphabetically.
    files.sort_by(|a, b| {
        let a_is_primary = a.name.eq_ignore_ascii_case("wallet.json");
        let b_is_primary = b.name.eq_ignore_ascii_case("wallet.json");
        match (a_is_primary, b_is_primary) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()),
        }
    });

    Ok(files)
}

// Info about a single address inside a wallet file inspected via
// get_wallet_info — `balance` is None when the RPC is offline or returns
// nothing for that address (NOT zero, which means "node confirmed zero").
#[derive(serde::Serialize)]
struct WalletInfoAddress {
    address: String,
    balance: Option<u64>,
}

// Inspect a wallet file WITHOUT activating it. Returns the file's name,
// addresses, and total balance — used by the Delete confirmation modal
// so the user sees what's at stake before unlinking the file. The active
// wallet (state.wallet_path) is NOT touched: we pass the requested path
// directly to the binary via IRIUM_WALLET_FILE, so this is read-only and
// has no side-effects on the rest of the app.
//
// Defensive checks mirror delete_wallet_file: path must canonicalise to
// inside ~/.irium/, extension must be .json, and the file must content-
// verify as a wallet via is_wallet_json_file. Anything else returns an
// error before the binary is even invoked.
//
// total_balance is None if every per-address fetch failed (e.g. RPC
// offline). It is Some(0) only when the node confirmed zero across every
// address — these two states are visually distinct in the UI.
#[derive(serde::Serialize)]
struct WalletInfo {
    name:          String,
    address_count: u32,
    addresses:     Vec<WalletInfoAddress>,
    total_balance: Option<u64>,
}

#[tauri::command]
async fn get_wallet_info(
    state: State<'_, AppState>,
    path: String,
) -> Result<WalletInfo, String> {
    let irium_dir = dirs::home_dir().unwrap_or_default().join(".irium");
    let target = std::path::PathBuf::from(&path);

    if !target.exists() {
        return Err(format!("Wallet file not found: {}", path));
    }

    let canonical = target
        .canonicalize()
        .map_err(|e| format!("Cannot resolve wallet path: {}", e))?;
    let canonical_dir = irium_dir
        .canonicalize()
        .map_err(|e| format!("Cannot resolve data dir: {}", e))?;
    if !canonical.starts_with(&canonical_dir) {
        return Err("Refusing to inspect file outside ~/.irium/".to_string());
    }

    let name = canonical
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Wallet file has no name".to_string())?
        .to_string();

    if !name.to_ascii_lowercase().ends_with(".json") {
        return Err(format!("Not a JSON file: {}", name));
    }
    if NON_WALLET_JSON_FILES.iter().any(|n| n.eq_ignore_ascii_case(&name)) {
        return Err(format!("Not a wallet file: {}", name));
    }
    if !is_wallet_json_file(&canonical) {
        return Err(format!("File is not a wallet: {}", name));
    }

    // Pass the requested path directly to the binary — do NOT touch
    // state.wallet_path. The active wallet stays exactly as it was.
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url  = state.rpc_url.lock().map_err(lock_err)?.clone();
    let inspect_path = canonical.to_string_lossy().to_string();

    let output = run_wallet_cmd(
        vec!["list-addresses".to_string()],
        Some(inspect_path),
        data_dir,
    )
    .await?;

    let raw_addrs: Vec<String> = output
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    let client = reqwest::Client::new();
    let mut addresses: Vec<WalletInfoAddress> = Vec::with_capacity(raw_addrs.len());
    let mut sum: u64 = 0;
    let mut any_success = false;
    for address in raw_addrs {
        let balance = fetch_address_balance_sats(&client, &rpc_url, &address).await;
        if let Some(b) = balance {
            sum = sum.saturating_add(b);
            any_success = true;
        }
        addresses.push(WalletInfoAddress { address, balance });
    }

    // total_balance distinguishes "node confirmed all zeros" (Some(0))
    // from "every fetch failed" (None). The UI uses this to pick between
    // the safe-zero warning and the cautionary-unknown warning.
    let total_balance = if addresses.is_empty() {
        Some(0)
    } else if any_success {
        Some(sum)
    } else {
        None
    };

    let address_count = addresses.len() as u32;
    Ok(WalletInfo { name, address_count, addresses, total_balance })
}

// Permanently delete a wallet*.json file from disk. Used by the Manage
// Wallets panel's per-file delete button.
//
// Multiple defensive checks before any unlink runs:
//   * Path MUST canonicalise to inside ~/.irium/ — refuse anything outside
//     the data dir, even if the caller passes an absolute path.
//   * Filename MUST end in .json AND content-verify as a wallet file so a
//     typo or malicious caller can't remove unrelated files in ~/.irium/
//     (anchors.json, seedlist.txt etc).
//   * Path MUST NOT be the currently active wallet (switch first, then
//     delete) — otherwise the running app would be holding handles to a
//     file that just disappeared. This is the ONLY identity-based rule;
//     wallet.json is no longer special-cased — any non-active wallet file
//     (including wallet.json) is deletable.
#[tauri::command]
async fn delete_wallet_file(
    state: State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    let irium_dir = dirs::home_dir().unwrap_or_default().join(".irium");
    let target = std::path::PathBuf::from(&path);

    // Confirm the file actually exists before any other check — gives a
    // clearer error than "outside data dir" if the caller passes garbage.
    if !target.exists() {
        return Err(format!("Wallet file not found: {}", path));
    }

    // Resolve symlinks etc, then verify the canonical path lives under
    // ~/.irium/. canonicalize() requires the file to exist, hence the
    // earlier exists() check.
    let canonical = target
        .canonicalize()
        .map_err(|e| format!("Cannot resolve wallet path: {}", e))?;
    let canonical_dir = irium_dir
        .canonicalize()
        .map_err(|e| format!("Cannot resolve data dir: {}", e))?;
    if !canonical.starts_with(&canonical_dir) {
        return Err("Refusing to delete file outside ~/.irium/".to_string());
    }

    let name = canonical
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Wallet file has no name".to_string())?;

    // Must be a .json file AND content-verified as a wallet. Renamed files
    // (e.g. "Primary-wallet.json", "savings.json") no longer match the old
    // wallet*.json glob, so we use the same wallet-content check that
    // list_wallet_files uses — keeps the two commands in sync.
    if !name.to_ascii_lowercase().ends_with(".json") {
        return Err(format!("Refusing to delete non-JSON file: {}", name));
    }
    if NON_WALLET_JSON_FILES.iter().any(|n| n.eq_ignore_ascii_case(name)) {
        return Err(format!("Refusing to delete non-wallet file: {}", name));
    }
    if !is_wallet_json_file(&canonical) {
        return Err(format!("Refusing to delete file that is not a wallet: {}", name));
    }

    // Compare against the explicitly-active wallet path. We deliberately do
    // NOT fall back to resolve_wallet_path() when state.wallet_path is None —
    // None means "the user has not confirmed an active wallet yet" (fresh
    // install, or just after the user cancelled a create-wallet flow). In
    // that case nothing is "active" and the file is safe to delete.
    // A non-None state.wallet_path is set by:
    //   • set_wallet_config on app startup from persisted settings
    //   • wallet_set_path (explicit user switch via the Manage panel, or the
    //     Done button after a successful create)
    //   • wallet_import_mnemonic / wallet_import_wif (implicit on import)
    let active_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    if let Some(active) = active_path {
        let active_canonical = std::path::PathBuf::from(&active).canonicalize().ok();
        if active_canonical.as_ref() == Some(&canonical) {
            return Err("This is the currently active wallet. Switch to another wallet first.".to_string());
        }
    }

    std::fs::remove_file(&canonical)
        .map_err(|e| format!("Failed to delete wallet file: {}", e))?;

    Ok(())
}

// Rename a wallet*.json file. Used by the Manage Wallets panel's inline
// rename affordance. Validates the new name, ensures both old and new
// paths live inside ~/.irium/, refuses to clobber an existing file, then
// std::fs::rename. If the renamed file was the currently-active wallet,
// state.wallet_path is updated so subsequent commands use the new path.
//
// Returns the new full path string on success — the frontend uses this
// to persist `settings.wallet_path` if the active wallet was the one
// being renamed.
#[tauri::command]
async fn rename_wallet_file(
    state: State<'_, AppState>,
    old_path: String,
    new_name: String,
) -> Result<String, String> {
    let irium_dir = dirs::home_dir().unwrap_or_default().join(".irium");
    let old = std::path::PathBuf::from(&old_path);

    if !old.exists() {
        return Err(format!("Wallet file not found: {}", old_path));
    }

    let old_canonical = old
        .canonicalize()
        .map_err(|e| format!("Cannot resolve wallet path: {}", e))?;
    let dir_canonical = irium_dir
        .canonicalize()
        .map_err(|e| format!("Cannot resolve data dir: {}", e))?;
    if !old_canonical.starts_with(&dir_canonical) {
        return Err("Refusing to rename file outside ~/.irium/".to_string());
    }

    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err("Name cannot be empty".to_string());
    }
    if trimmed.len() > 64 {
        return Err("Name must be 64 characters or fewer".to_string());
    }
    if !trimmed.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("Name can contain only letters, numbers, hyphens, and underscores".to_string());
    }

    let new_filename = format!("{}.json", trimmed);
    let new_path = dir_canonical.join(&new_filename);

    // Same name — nothing to do, return current path so the UI flow can
    // close its inline editor without showing an error.
    if new_path == old_canonical {
        return Ok(old_canonical.to_string_lossy().to_string());
    }
    if new_path.exists() {
        return Err(format!("A wallet file named {} already exists", new_filename));
    }

    std::fs::rename(&old_canonical, &new_path)
        .map_err(|e| format!("Failed to rename: {}", e))?;

    // If the renamed file was the active wallet, update state so subsequent
    // wallet commands keep working with the same wallet under its new name.
    let active_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let active_resolved = active_path.unwrap_or_else(resolve_wallet_path);
    let active_canonical_old = std::path::PathBuf::from(&active_resolved)
        .canonicalize()
        .ok();
    if active_canonical_old.as_ref() == Some(&old_canonical) {
        *state.wallet_path.lock().map_err(lock_err)? =
            Some(new_path.to_string_lossy().to_string());
    }

    Ok(new_path.to_string_lossy().to_string())
}

// wallet_create: creates a new BIP32 wallet with a 24-word BIP39 mnemonic.
//
// Uses find_unique_wallet_path() so a second wallet goes to wallet-2.json,
// wallet-3.json, etc. — the existing primary wallet.json is never touched.
//
// Verified stdout format for `create-wallet --bip32`:
//   BIP32 wallet created
//   derivation path: m/44'/1'/0'/0/0
//   mnemonic stored in wallet; export with: irium-wallet export-mnemonic --out <file>
//   wallet /path/to/wallet.json
//
// No address is printed — must call list-addresses after creation.
// Mnemonic is stored in the wallet file — must call export-mnemonic after creation.
#[tauri::command]
async fn wallet_create(state: State<'_, AppState>) -> Result<WalletCreateResult, String> {
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();

    // find_unique_wallet_path never returns an existing file, so create-wallet
    // won't hit its own "wallet already exists" guard.
    let wallet_file = find_unique_wallet_path();

    // Step 1: create the BIP32 wallet
    run_wallet_cmd(
        vec!["create-wallet".to_string(), "--bip32".to_string()],
        Some(wallet_file.clone()),
        data_dir.clone(),
    ).await?;

    // Step 2: get the address — list-addresses outputs one bare address per line
    let addr_output = run_wallet_cmd(
        vec!["list-addresses".to_string()],
        Some(wallet_file.clone()),
        data_dir.clone(),
    ).await?;

    let address = addr_output
        .lines()
        .map(|l| l.trim())
        .find(|l| !l.is_empty())
        .unwrap_or("")
        .to_string();

    if address.is_empty() {
        return Err(format!(
            "Wallet created but list-addresses returned no address: {}",
            &addr_output[..addr_output.len().min(200)]
        ));
    }

    // Step 3: export the mnemonic from the wallet file via temp file
    let tmp = std::env::temp_dir().join(format!(
        "irium_mnemonic_{}.txt",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    ));

    run_wallet_cmd(
        vec!["export-mnemonic".to_string(), "--out".to_string(), tmp.to_string_lossy().to_string()],
        Some(wallet_file.clone()),
        data_dir,
    ).await?;

    let mnemonic = std::fs::read_to_string(&tmp)
        .map_err(|e| format!("Failed to read mnemonic file: {}", e))?;
    let _ = std::fs::remove_file(&tmp);
    let mnemonic = mnemonic.trim().to_string();

    // Intentionally do NOT register the new wallet as state.wallet_path here.
    // Registration is deferred to the frontend's Done-button flow (which calls
    // wallet_set_path explicitly after the user has confirmed they saved the
    // recovery phrase). This makes the cancel-after-create path work: the
    // newly-created file is on disk but isn't "active", so delete_wallet_file
    // can remove it without tripping the active-wallet safety check.

    Ok(WalletCreateResult { mnemonic, address, wallet_path: wallet_file })
}

// wallet_import_mnemonic: restores a BIP32 wallet from a 12/24-word seed phrase.
// The binary refuses to overwrite an existing wallet file, so we remove it first.
// Returns the resolved wallet file path so the frontend can persist it.
#[tauri::command]
async fn wallet_import_mnemonic(
    state: State<'_, AppState>,
    words: String,
) -> Result<String, String> {
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();

    // Non-destructive: write the imported wallet to the next free slot
    // (wallet.json, wallet-2.json, wallet-3.json, …). Previously this
    // unconditionally deleted ~/.irium/wallet.json before importing, which
    // could silently nuke an existing wallet the user thought was safe.
    let wallet_file = find_unique_wallet_path();

    run_wallet_cmd(
        vec!["import-mnemonic".to_string(), words],
        Some(wallet_file.clone()),
        data_dir,
    ).await?;

    *state.wallet_path.lock().map_err(lock_err)? = Some(wallet_file.clone());
    Ok(wallet_file)
}

// wallet_import_wif: adds a WIF private key to the currently-active wallet
// so the user keeps their existing addresses and gains the new WIF address
// alongside them. If no wallet is currently active, falls back to the
// resolved default path. Returns the wallet file path the WIF was written
// to so the frontend can persist the active selection.
//
// Bug 3 fix — previous implementation called find_unique_wallet_path()
// which created an isolated single-key wallet file each time, so the user
// ended up with a wallet containing only the imported WIF address and
// could no longer see their other addresses. Honoring the function's own
// header comment ("ADDS to an existing wallet — does not replace it") by
// targeting the active wallet path instead.
#[tauri::command]
async fn wallet_import_wif(
    state: State<'_, AppState>,
    wif: String,
) -> Result<String, String> {
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let wallet_file = {
        let active = state.wallet_path.lock().map_err(lock_err)?.clone();
        match active {
            Some(ref p) if !p.is_empty() => p.clone(),
            _ => resolve_wallet_path(),
        }
    };

    run_wallet_cmd(
        vec!["import-wif".to_string(), wif],
        Some(wallet_file.clone()),
        data_dir,
    ).await?;

    *state.wallet_path.lock().map_err(lock_err)? = Some(wallet_file.clone());
    Ok(wallet_file)
}

// wallet_import_private_key: the irium-wallet binary does not have an import-private-key
// command; use import-wif for key import. This stub returns an error immediately.
#[tauri::command]
async fn wallet_import_private_key(
    _state: State<'_, AppState>,
    _hex_key: String,
) -> Result<String, String> {
    Err("Raw hex private key import is not supported by this wallet version. Convert to WIF format and use Import WIF instead.".to_string())
}

#[tauri::command]
async fn wallet_export_seed(state: State<'_, AppState>) -> Result<String, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();

    let tmp = std::env::temp_dir().join(format!(
        "irium_seed_{}.txt",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    ));

    run_wallet_cmd(
        vec!["export-seed".to_string(), "--out".to_string(), tmp.to_string_lossy().to_string()],
        wallet_path,
        data_dir,
    ).await?;

    let content = std::fs::read_to_string(&tmp)
        .map_err(|e| format!("Failed to read seed file: {}", e))?;
    let _ = std::fs::remove_file(&tmp);
    Ok(content.trim().to_string())
}

#[tauri::command]
async fn wallet_export_mnemonic(state: State<'_, AppState>) -> Result<String, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();

    let tmp = std::env::temp_dir().join(format!(
        "irium_mnemonic_{}.txt",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    ));

    run_wallet_cmd(
        vec!["export-mnemonic".to_string(), "--out".to_string(), tmp.to_string_lossy().to_string()],
        wallet_path,
        data_dir,
    ).await?;

    let content = std::fs::read_to_string(&tmp)
        .map_err(|e| format!("Failed to read mnemonic file: {}", e))?;
    let _ = std::fs::remove_file(&tmp);
    Ok(content.trim().to_string())
}

#[tauri::command]
async fn wallet_backup(state: State<'_, AppState>, out_path: String) -> Result<String, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let staged = next_staged_path("backup", "bak", &data_dir)?;
    let result = run_wallet_cmd(
        vec!["backup".to_string(), "--out".to_string(), staged.to_string_lossy().to_string()],
        wallet_path,
        data_dir,
    ).await;
    match result {
        Ok(_) => {
            finalize_output(&staged, &out_path)?;
            Ok(out_path)
        }
        Err(e) => {
            let _ = std::fs::remove_file(&staged);
            Err(e)
        }
    }
}

#[tauri::command]
async fn wallet_restore_backup(state: State<'_, AppState>, file_path: String) -> Result<String, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let staged = stage_input(&file_path, "restore", &data_dir)?;
    let result = run_wallet_cmd(
        vec!["restore-backup".to_string(), staged.to_string_lossy().to_string(), "--force".to_string()],
        wallet_path,
        data_dir,
    ).await;
    let _ = std::fs::remove_file(&staged);
    result?;
    Ok("Wallet restored successfully".to_string())
}

#[tauri::command]
async fn wallet_export_wif(
    state: State<'_, AppState>,
    address: String,
    out_path: String,
) -> Result<String, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let staged = next_staged_path("wif", "txt", &data_dir)?;
    let result = run_wallet_cmd(
        vec!["export-wif".to_string(), address, "--out".to_string(), staged.to_string_lossy().to_string()],
        wallet_path,
        data_dir,
    ).await;
    match result {
        Ok(_) => {
            finalize_output(&staged, &out_path)?;
            Ok(out_path)
        }
        Err(e) => {
            let _ = std::fs::remove_file(&staged);
            Err(e)
        }
    }
}

// wallet_read_wif: exports WIF to a temp file, reads it back, returns the WIF string.
// Used to display the WIF key inline in the UI without requiring a user-chosen file path.
//
// Optional wallet_path parameter — when provided, reads from that specific
// wallet file instead of state.wallet_path. Used by handleCreate after a
// wallet creation, before the new wallet has been registered as active
// (registration is deferred to the Done button). Without the explicit path
// the call would target the previous wallet, where the just-created address
// doesn't exist, and the WIF read would fail.
#[tauri::command]
async fn wallet_read_wif(
    state: State<'_, AppState>,
    address: String,
    wallet_path: Option<String>,
) -> Result<String, String> {
    let resolved_path = match wallet_path {
        Some(p) => Some(p),
        None => state.wallet_path.lock().map_err(lock_err)?.clone(),
    };
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();

    // Use the staging dir (under ~/.irium/staging/) instead of system temp.
    // The sidecar has guaranteed write access there; system temp is unreliable
    // in the Tauri sidecar context on some platforms.
    let tmp = next_staged_path("wif", "txt", &data_dir)?;

    run_wallet_cmd(
        vec!["export-wif".to_string(), address, "--out".to_string(), tmp.to_string_lossy().to_string()],
        resolved_path,
        data_dir,
    ).await?;

    let content = std::fs::read_to_string(&tmp)
        .map_err(|e| format!("Failed to read WIF file: {}", e))?;
    let _ = std::fs::remove_file(&tmp);
    Ok(content.trim().to_string())
}

// ============================================================
// OFFER / MARKETPLACE
// ============================================================

#[tauri::command]
async fn offer_list(
    state: State<'_, AppState>,
    source: Option<String>,
    sort: Option<String>,
    limit: Option<u32>,
    min_amount: Option<f64>,
    max_amount: Option<f64>,
    payment: Option<String>,
) -> Result<Vec<Offer>, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();

    // offer-list --json returns {"count":N,"offers":[...]}
    let mut args = vec!["offer-list".to_string(), "--json".to_string()];
    if let Some(s) = source { args.push("--source".to_string()); args.push(s); }
    if let Some(s) = sort { args.push("--sort".to_string()); args.push(s); }
    if let Some(n) = limit { args.push("--limit".to_string()); args.push(n.to_string()); }
    if let Some(a) = min_amount { args.push("--min-amount".to_string()); args.push(a.to_string()); }
    if let Some(a) = max_amount { args.push("--max-amount".to_string()); args.push(a.to_string()); }
    if let Some(p) = payment { args.push("--payment".to_string()); args.push(p); }

    let output = run_wallet_cmd(args, wallet_path, data_dir).await?;

    let response = serde_json::from_str::<RawOfferListResponse>(&output)
        .map_err(|e| format!("Parse error: {} | raw: {}", e, &output[..output.len().min(200)]))?;

    Ok(response.offers.into_iter().map(Offer::from).collect())
}

#[tauri::command]
async fn offer_show(state: State<'_, AppState>, offer_id: String) -> Result<Offer, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();

    // offer-show --offer <id> --json
    let output = run_wallet_cmd(
        vec!["offer-show".to_string(), "--offer".to_string(), offer_id, "--json".to_string()],
        wallet_path, data_dir,
    ).await?;

    let raw = serde_json::from_str::<RawOffer>(&output)
        .map_err(|e| format!("Parse error: {} | raw: {}", e, &output[..output.len().min(200)]))?;
    Ok(Offer::from(raw))
}

#[tauri::command]
async fn offer_create(
    state: State<'_, AppState>,
    params: CreateOfferParams,
) -> Result<CreateOfferResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    // Seller address: use the caller-supplied value when present, otherwise
    // fall back to the wallet's first derived address (the prior behaviour).
    // The address must still be one whose key the wallet can sign with; the
    // binary will fail at sign time otherwise.
    let seller = match params.seller_address.as_ref() {
        Some(s) if !s.trim().is_empty() => s.trim().to_string(),
        _ => get_first_wallet_address(wallet_path.clone(), data_dir.clone()).await?,
    };
    let height = get_current_height(&rpc_url).await;
    let timeout = height + params.timeout_blocks.unwrap_or(1000);

    // offer-create --seller <addr> --amount <irm> --payment-method <text> --timeout <height>
    let mut args = vec![
        "offer-create".to_string(),
        "--seller".to_string(), seller,
        "--amount".to_string(), format!("{:.8}", sats_to_irm(params.amount_sats)),
        "--payment-method".to_string(),
        params.payment_method.unwrap_or_else(|| "bank-transfer".to_string()),
        "--timeout".to_string(), timeout.to_string(),
    ];
    if let Some(note) = params.description {
        args.push("--price-note".to_string());
        args.push(note);
    }
    if let Some(instr) = params.payment_instructions {
        args.push("--payment-instructions".to_string());
        args.push(instr);
    }
    if let Some(id) = params.offer_id {
        args.push("--offer-id".to_string());
        args.push(id);
    }
    args.push("--json".to_string());

    let output = run_wallet_cmd(args, wallet_path, data_dir).await?;
    let raw = serde_json::from_str::<OfferCreateRaw>(&output)
        .map_err(|e| format!("Parse error: {} | raw: {}", e, &output[..output.len().min(200)]))?;

    Ok(CreateOfferResult { id: raw.offer_id, success: true, message: None })
}

#[tauri::command]
async fn offer_take(
    state: State<'_, AppState>,
    offer_id: String,
    buyer_address: Option<String>,
) -> Result<OfferTakeResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    // Buyer address: caller-supplied when present, otherwise wallet first
    // address (prior behaviour). Empty/whitespace strings are treated as None.
    let buyer = match buyer_address.as_ref() {
        Some(b) if !b.trim().is_empty() => b.trim().to_string(),
        _ => get_first_wallet_address(wallet_path.clone(), data_dir.clone()).await?,
    };

    // offer-take --offer <id> --buyer <addr> --rpc <url> --json
    let output = run_wallet_cmd_with_rpc(
        vec![
            "offer-take".to_string(),
            "--offer".to_string(), offer_id.clone(),
            "--buyer".to_string(), buyer,
            "--json".to_string(),
        ],
        wallet_path, data_dir, rpc_url,
    ).await?;

    let raw: serde_json::Value = serde_json::from_str(&output)
        .map_err(|e| format!("Parse error: {} | raw: {}", e, &output[..output.len().min(200)]))?;
    Ok(OfferTakeResult {
        agreement_id: raw["agreement_id"].as_str().unwrap_or("").to_string(),
        offer_id,
        success: true,
        message: None,
    })
}

#[tauri::command]
async fn offer_export(
    state: State<'_, AppState>,
    offer_id: String,
    out_path: String,
) -> Result<bool, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let staged = next_staged_path("offer", "json", &data_dir)?;
    let result = run_wallet_cmd(
        vec!["offer-export".to_string(), "--offer".to_string(), offer_id, "--out".to_string(), staged.to_string_lossy().to_string()],
        wallet_path, data_dir,
    ).await;
    match result {
        Ok(_) => { finalize_output(&staged, &out_path)?; Ok(true) }
        Err(e) => { let _ = std::fs::remove_file(&staged); Err(e) }
    }
}

#[tauri::command]
async fn offer_import(state: State<'_, AppState>, file_path: String) -> Result<bool, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let staged = stage_input(&file_path, "offer-import", &data_dir)?;
    let result = run_wallet_cmd(
        vec!["offer-import".to_string(), "--file".to_string(), staged.to_string_lossy().to_string()],
        wallet_path, data_dir,
    ).await;
    let _ = std::fs::remove_file(&staged);
    result?;
    Ok(true)
}

#[tauri::command]
async fn offer_remove(state: State<'_, AppState>, offer_id: String) -> Result<bool, String> {
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let irium_dir = data_dir
        .as_ref()
        .map(|d| PathBuf::from(d))
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join(".irium"));
    let offers_dir = irium_dir.join("offers");
    if !offers_dir.exists() {
        return Err("Offers directory not found".to_string());
    }
    let entries = std::fs::read_dir(&offers_dir)
        .map_err(|e| format!("Cannot read offers directory: {}", e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let contents = std::fs::read_to_string(&path).unwrap_or_default();
        let parsed: serde_json::Value = serde_json::from_str(&contents)
            .unwrap_or(serde_json::Value::Null);
        if parsed["offer_id"].as_str() == Some(offer_id.as_str()) {
            std::fs::remove_file(&path)
                .map_err(|e| format!("Failed to delete offer: {}", e))?;
            return Ok(true);
        }
    }
    Err(format!("Offer '{}' not found", offer_id))
}

// ============================================================
// FEED MANAGEMENT
// ============================================================

#[tauri::command]
async fn feed_add(state: State<'_, AppState>, url: String) -> Result<bool, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    // feed-add <url> — URL is positional, not a flag
    run_wallet_cmd(vec!["feed-add".to_string(), url], wallet_path, data_dir).await?;
    Ok(true)
}

#[tauri::command]
async fn feed_remove(state: State<'_, AppState>, url: String) -> Result<bool, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    run_wallet_cmd(vec!["feed-remove".to_string(), url], wallet_path, data_dir).await?;
    Ok(true)
}

#[tauri::command]
async fn feed_list(state: State<'_, AppState>) -> Result<Vec<FeedEntry>, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();

    // feed-list --json returns {"feeds":["url1","url2"],"total":2}
    let output = run_wallet_cmd(vec!["feed-list".to_string(), "--json".to_string()], wallet_path, data_dir).await?;

    let response = serde_json::from_str::<RawFeedListResponse>(&output)
        .map_err(|e| format!("Parse error: {} | raw: {}", e, &output[..output.len().min(200)]))?;

    Ok(response.feeds.into_iter().map(|url| FeedEntry {
        url,
        last_synced: None,
        offer_count: None,
        status: Some("active".to_string()),
    }).collect())
}

#[tauri::command]
async fn feed_sync(state: State<'_, AppState>) -> Result<FeedSyncResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();

    // offer-feed-sync --json returns {"feeds_processed":N,"total_errors":N,"total_imported":N,...}
    let output = run_wallet_cmd(
        vec!["offer-feed-sync".to_string(), "--json".to_string()],
        wallet_path, data_dir,
    ).await?;

    let raw = serde_json::from_str::<FeedSyncRawResponse>(&output)
        .unwrap_or_default();
    let processed = raw.feeds_processed.unwrap_or(0);
    let errors = raw.total_errors.unwrap_or(0);

    Ok(FeedSyncResult {
        synced: processed.saturating_sub(errors) as u32,
        failed: errors as u32,
        total_offers: raw.total_imported.unwrap_or(0),
    })
}

#[tauri::command]
async fn feed_fetch(state: State<'_, AppState>, url: String) -> Result<Vec<Offer>, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();

    // offer-feed-fetch --url <url> --json
    let output = run_wallet_cmd(
        vec!["offer-feed-fetch".to_string(), "--url".to_string(), url, "--json".to_string()],
        wallet_path, data_dir,
    ).await?;

    // Feed fetch may return a raw list or a wrapped object
    if let Ok(wrapped) = serde_json::from_str::<RawOfferListResponse>(&output) {
        return Ok(wrapped.offers.into_iter().map(Offer::from).collect());
    }
    serde_json::from_str::<Vec<RawOffer>>(&output)
        .map(|v| v.into_iter().map(Offer::from).collect())
        .map_err(|e| format!("Parse error: {} | raw: {}", e, &output[..output.len().min(200)]))
}

#[tauri::command]
async fn feed_prune(state: State<'_, AppState>) -> Result<bool, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    run_wallet_cmd(vec!["offer-feed-prune".to_string()], wallet_path, data_dir).await?;
    Ok(true)
}

// ============================================================
// AGREEMENTS
// ============================================================

#[tauri::command]
async fn agreement_list(state: State<'_, AppState>) -> Result<Vec<Agreement>, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();

    // agreement-local-store-list --json returns stored agreements as raw entries
    let output = run_wallet_cmd(
        vec!["agreement-local-store-list".to_string(), "--json".to_string()],
        wallet_path, data_dir,
    ).await?;

    let response = serde_json::from_str::<AgreementStoreListResponse>(&output)
        .unwrap_or_default();

    let mut agreements: Vec<Agreement> = Vec::new();

    // Pull from stored raw agreements
    for a in response.stored_raw_agreements.unwrap_or_default() {
        agreements.push(Agreement {
            id: a.agreement_id,
            hash: Some(a.agreement_hash),
            template: None,
            buyer: None,
            seller: None,
            amount: 0,
            status: "open".to_string(),
            proof_status: None,
            release_eligible: None,
            created_at: None,
            deadline: None,
            policy: None,
        });
    }

    Ok(agreements)
}

#[tauri::command]
async fn agreement_show(state: State<'_, AppState>, agreement_id: String) -> Result<Agreement, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();

    let output = run_wallet_cmd(
        vec!["agreement-inspect".to_string(), agreement_id.clone(), "--json".to_string()],
        wallet_path, data_dir,
    ).await?;

    let raw: serde_json::Value = serde_json::from_str(&output)
        .map_err(|e| format!("Parse error: {}", e))?;

    Ok(Agreement {
        id: raw["agreement_id"].as_str().unwrap_or(&agreement_id).to_string(),
        hash: raw["agreement_hash"].as_str().map(String::from),
        template: raw["agreement_type"].as_str().map(String::from),
        buyer: raw["parties"]["buyer"]["addr"].as_str().map(String::from),
        seller: raw["parties"]["seller"]["addr"].as_str().map(String::from),
        amount: raw["amount_satoshis"].as_u64().unwrap_or(0),
        status: "open".to_string(),
        proof_status: None,
        release_eligible: None,
        created_at: raw["creation_time"].as_i64(),
        deadline: None,
        policy: None,
    })
}

#[tauri::command]
async fn agreement_remove(state: State<'_, AppState>, agreement_id: String) -> Result<bool, String> {
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let irium_dir = data_dir
        .as_ref()
        .map(|d| PathBuf::from(d))
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join(".irium"));
    let agreements_dir = irium_dir.join("agreements");
    if !agreements_dir.exists() {
        return Err("Agreements directory not found".to_string());
    }
    let entries = std::fs::read_dir(&agreements_dir)
        .map_err(|e| format!("Cannot read agreements directory: {}", e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let contents = std::fs::read_to_string(&path).unwrap_or_default();
        let parsed: serde_json::Value = serde_json::from_str(&contents)
            .unwrap_or(serde_json::Value::Null);
        if parsed["agreement_id"].as_str() == Some(agreement_id.as_str()) {
            std::fs::remove_file(&path)
                .map_err(|e| format!("Failed to delete agreement: {}", e))?;
            return Ok(true);
        }
    }
    Err(format!("Agreement '{}' not found", agreement_id))
}

#[tauri::command]
async fn agreement_create(
    state: State<'_, AppState>,
    params: CreateAgreementParams,
) -> Result<AgreementResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    let height = get_current_height(&rpc_url).await;
    let deadline_blocks = params.deadline_hours.unwrap_or(24) * 6;
    let timeout = height + deadline_blocks;

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let secret_hash = format!("{:0>64x}", ts);
    let doc_hash = format!("{:0>64x}", ts.wrapping_add(1));

    let args = vec![
        "agreement-create-simple-settlement".to_string(),
        "--agreement-id".to_string(), format!("settle-{}", ts),
        "--creation-time".to_string(), ts.to_string(),
        "--party-a".to_string(), format!("addr={}", params.counterparty),
        "--party-b".to_string(), format!("addr={}", params.counterparty),
        "--amount".to_string(), format!("{:.8}", sats_to_irm(params.amount_sats)),
        "--secret-hash".to_string(), secret_hash,
        "--refund-timeout".to_string(), timeout.to_string(),
        "--document-hash".to_string(), doc_hash,
        "--json".to_string(),
    ];

    let output = run_wallet_cmd(args, wallet_path, data_dir).await?;
    let raw: serde_json::Value = serde_json::from_str(&output)
        .map_err(|e| format!("Parse error: {}", e))?;

    Ok(AgreementResult {
        agreement_id: raw["agreement_id"].as_str().unwrap_or("").to_string(),
        hash: raw["agreement_hash"].as_str().map(String::from),
        success: true,
        message: None,
    })
}

#[tauri::command]
async fn agreement_pack(
    state: State<'_, AppState>,
    agreement_id: String,
    out_path: String,
) -> Result<bool, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let staged = next_staged_path("agreement-pack", "bin", &data_dir)?;
    let result = run_wallet_cmd(
        vec!["agreement-pack".to_string(), "--agreement".to_string(), agreement_id, "--out".to_string(), staged.to_string_lossy().to_string()],
        wallet_path, data_dir,
    ).await;
    match result {
        Ok(_) => { finalize_output(&staged, &out_path)?; Ok(true) }
        Err(e) => { let _ = std::fs::remove_file(&staged); Err(e) }
    }
}

#[tauri::command]
async fn agreement_unpack(state: State<'_, AppState>, file_path: String) -> Result<Agreement, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let staged = stage_input(&file_path, "agreement-unpack", &data_dir)?;
    // agreement-unpack --file <path> --json (not agreement-bundle-inspect)
    let output_res = run_wallet_cmd(
        vec!["agreement-unpack".to_string(), "--file".to_string(), staged.to_string_lossy().to_string(), "--json".to_string()],
        wallet_path, data_dir,
    ).await;
    let _ = std::fs::remove_file(&staged);
    let output = output_res?;
    let raw: serde_json::Value = serde_json::from_str(&output)
        .map_err(|e| format!("Parse error: {}", e))?;
    Ok(Agreement {
        id: raw["agreement_id"].as_str().unwrap_or("").to_string(),
        hash: raw["agreement_hash"].as_str().map(String::from),
        template: None,
        buyer: None,
        seller: None,
        amount: 0,
        status: "open".to_string(),
        proof_status: None,
        release_eligible: None,
        created_at: None,
        deadline: None,
        policy: None,
    })
}

#[tauri::command]
async fn agreement_release(
    state: State<'_, AppState>,
    agreement_id: String,
    secret: Option<String>,
    broadcast: Option<bool>,
) -> Result<ReleaseResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    // The binary accepts --secret <hex> for HTLC unlock (required when the
    // wallet did not fund the agreement itself) and --broadcast to actually
    // transmit the spending tx. Without --broadcast it builds but does not
    // send, which previously caused the GUI to claim success on a no-op.
    let mut args = vec!["agreement-release".to_string(), agreement_id, "--json".to_string()];
    if let Some(s) = secret.and_then(|s| { let t = s.trim().to_string(); if t.is_empty() { None } else { Some(t) } }) {
        args.push("--secret".to_string());
        args.push(s);
    }
    if broadcast.unwrap_or(true) {
        args.push("--broadcast".to_string());
    }
    let output = run_wallet_cmd_with_rpc(args, wallet_path, data_dir, rpc_url).await?;
    let raw: serde_json::Value = serde_json::from_str(&output).unwrap_or_default();
    Ok(ReleaseResult {
        txid: raw["txid"].as_str().map(String::from),
        success: true,
        message: None,
    })
}

#[tauri::command]
async fn agreement_refund(
    state: State<'_, AppState>,
    agreement_id: String,
    broadcast: Option<bool>,
) -> Result<ReleaseResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let mut args = vec!["agreement-refund".to_string(), agreement_id, "--json".to_string()];
    if broadcast.unwrap_or(true) {
        args.push("--broadcast".to_string());
    }
    let output = run_wallet_cmd_with_rpc(args, wallet_path, data_dir, rpc_url).await?;
    let raw: serde_json::Value = serde_json::from_str(&output).unwrap_or_default();
    Ok(ReleaseResult {
        txid: raw["txid"].as_str().map(String::from),
        success: true,
        message: None,
    })
}

// ============================================================
// PROOFS
// ============================================================

#[tauri::command]
async fn proof_list(state: State<'_, AppState>, agreement_id: Option<String>) -> Result<Vec<Proof>, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let mut args = vec!["agreement-proof-list".to_string(), "--json".to_string()];
    if let Some(id) = agreement_id {
        args.push("--agreement-hash".to_string());
        args.push(id);
    }
    let output = run_wallet_cmd_with_rpc(args, wallet_path, data_dir, rpc_url).await
        .unwrap_or_else(|_| "[]".to_string());
    serde_json::from_str::<Vec<Proof>>(&output)
        .or_else(|_| Ok(vec![]))
}

#[tauri::command]
async fn proof_sign(
    state: State<'_, AppState>,
    agreement_id: String,
    proof_data: String,
    out_path: String,
) -> Result<bool, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let staged = next_staged_path("proof-sign", "json", &data_dir)?;
    let result = run_wallet_cmd(
        vec![
            "proof-sign".to_string(),
            "--agreement".to_string(), agreement_id,
            "--message".to_string(), proof_data,
            "--out".to_string(), staged.to_string_lossy().to_string(),
        ],
        wallet_path, data_dir,
    ).await;
    match result {
        Ok(_) => { finalize_output(&staged, &out_path)?; Ok(true) }
        Err(e) => { let _ = std::fs::remove_file(&staged); Err(e) }
    }
}

#[tauri::command]
async fn proof_submit(
    state: State<'_, AppState>,
    agreement_id: String,
    proof_file: String,
) -> Result<ProofSubmitResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    // Read the proof file and inject proof_id if missing (binary requires this field)
    let file_content = std::fs::read_to_string(&proof_file)
        .map_err(|e| format!("Cannot read proof file '{}': {}", proof_file, e))?;
    let mut proof_json: serde_json::Value = serde_json::from_str(&file_content)
        .map_err(|e| format!("Proof file is not valid JSON: {}", e))?;

    // Both branches now write to ~/.irium/staging/ so the sidecar can read
    // the file regardless of which TCC-gated directory the user picked it
    // from. The main process already has the file content in memory from the
    // read above, so we just rewrite it (modified or verbatim) into staging.
    let staged = next_staged_path("proof-submit", "json", &data_dir)?;
    if proof_json.get("proof_id").is_none() {
        if let Some(obj) = proof_json.as_object_mut() {
            obj.insert("proof_id".to_string(), serde_json::Value::String(agreement_id.clone()));
        }
        std::fs::write(&staged, serde_json::to_string_pretty(&proof_json).unwrap_or(file_content))
            .map_err(|e| format!("Cannot write staged proof file: {}", e))?;
    } else {
        std::fs::write(&staged, &file_content)
            .map_err(|e| format!("Cannot write staged proof file: {}", e))?;
    }
    let actual_path = staged.to_string_lossy().to_string();

    let output_res = run_wallet_cmd_with_rpc(
        vec![
            "agreement-proof-submit".to_string(),
            "--proof".to_string(), actual_path,
            "--json".to_string(),
        ],
        wallet_path, data_dir, rpc_url,
    ).await;
    let _ = std::fs::remove_file(&staged);
    let output = output_res?;
    serde_json::from_str::<ProofSubmitResult>(&output)
        .map_err(|e| format!("Parse error: {} | raw: {}", e, &output[..output.len().min(200)]))
}

// proof_create_and_submit: end-to-end proof creation flow for users who
// don't have a pre-signed proof file. Runs agreement-proof-create to write
// a signed proof JSON to a temp file, then immediately runs
// agreement-proof-submit against that file, then cleans up. The user never
// sees the JSON. Mirrors the manual two-step CLI sequence documented in
// SETTLEMENT-DEV.md §"Step 5".
#[tauri::command]
async fn proof_create_and_submit(
    state: State<'_, AppState>,
    agreement_hash: String,
    proof_type: String,
    attested_by: String,
    address: String,
    evidence_summary: Option<String>,
    evidence_hash: Option<String>,
) -> Result<ProofSubmitResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    // Temp file lives in OS temp dir; nanos suffix avoids collisions across
    // concurrent invocations. Cleaned up on every exit path below.
    let ts_nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp_path = std::env::temp_dir().join(format!("irium_proof_{}.json", ts_nanos));
    let tmp_str = tmp_path.to_string_lossy().to_string();

    // Step 1 — agreement-proof-create writes the signed JSON to tmp_path.
    let mut create_args = vec![
        "agreement-proof-create".to_string(),
        "--agreement-hash".to_string(), agreement_hash,
        "--proof-type".to_string(), proof_type,
        "--attested-by".to_string(), attested_by,
        "--address".to_string(), address,
        "--out".to_string(), tmp_str.clone(),
        "--json".to_string(),
    ];
    if let Some(s) = evidence_summary.as_ref().filter(|s| !s.trim().is_empty()) {
        create_args.push("--evidence-summary".to_string());
        create_args.push(s.clone());
    }
    if let Some(h) = evidence_hash.as_ref().filter(|h| !h.trim().is_empty()) {
        create_args.push("--evidence-hash".to_string());
        create_args.push(h.clone());
    }
    if let Err(e) = run_wallet_cmd_with_rpc(
        create_args,
        wallet_path.clone(),
        data_dir.clone(),
        rpc_url.clone(),
    ).await {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(format!("proof-create failed: {}", e));
    }

    // Step 2 — agreement-proof-submit reads the file we just wrote and
    // broadcasts the proof. Capture the result before cleanup so we can
    // still return it on success.
    let submit_result = run_wallet_cmd_with_rpc(
        vec![
            "agreement-proof-submit".to_string(),
            "--proof".to_string(), tmp_str,
            "--json".to_string(),
        ],
        wallet_path,
        data_dir,
        rpc_url,
    ).await;

    // Always clean up — success or failure. The proof has already been
    // broadcast on-chain at this point, so the local file has no further use.
    let _ = std::fs::remove_file(&tmp_path);

    let output = submit_result?;
    serde_json::from_str::<ProofSubmitResult>(&output)
        .map_err(|e| format!("Parse error: {} | raw: {}", e, &output[..output.len().min(200)]))
}

// ============================================================
// REPUTATION
// ============================================================

#[tauri::command]
async fn reputation_show(state: State<'_, AppState>, pubkey_or_addr: String) -> Result<Reputation, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let output = run_wallet_cmd(
        vec!["reputation-show".to_string(), pubkey_or_addr.clone(), "--json".to_string()],
        wallet_path, data_dir,
    ).await?;
    serde_json::from_str::<Reputation>(&output)
        .map_err(|e| format!("Parse error: {} | raw: {}", e, &output[..output.len().min(200)]))
}

// ============================================================
// SETTLEMENT TEMPLATES
// ============================================================

// otc-create --buyer <addr> --seller <addr> --amount <irm> --asset <text>
//            --payment-method <text> --timeout <height> [--json]
//
// Real output: {"agreement_hash":"...","agreement_id":"...","saved_path":"..."}
#[tauri::command]
async fn settlement_create_otc(
    state: State<'_, AppState>,
    params: OtcParams,
) -> Result<AgreementResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    let height = get_current_height(&rpc_url).await;
    let deadline_blocks = params.deadline_hours.unwrap_or(24) * 6;
    let timeout = height + deadline_blocks;
    let amount_irm = format!("{:.8}", sats_to_irm(params.amount_sats));
    let asset = params.asset_reference.unwrap_or_else(|| "IRM".to_string());
    let payment_method = params.payment_method.unwrap_or_else(|| "bank-transfer".to_string());

    let mut args = vec![
        "otc-create".to_string(),
        "--seller".to_string(), params.seller,
        "--buyer".to_string(), params.buyer,
        "--amount".to_string(), amount_irm,
        "--asset".to_string(), asset,
        "--payment-method".to_string(), payment_method,
        "--timeout".to_string(), timeout.to_string(),
        "--json".to_string(),
    ];
    if let Some(memo) = params.memo {
        args.push("--notes".to_string());
        args.push(memo);
    }

    let output = run_wallet_cmd(args, wallet_path, data_dir).await?;
    let result = serde_json::from_str::<OtcCreateResult>(&output)
        .map_err(|e| format!("Parse error: {} | raw: {}", e, &output[..output.len().min(400)]))?;

    Ok(AgreementResult {
        agreement_id: result.agreement_id,
        hash: Some(result.agreement_hash),
        success: true,
        message: None,
    })
}

#[tauri::command]
async fn settlement_create_freelance(
    state: State<'_, AppState>,
    params: FreelanceParams,
) -> Result<AgreementResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    let height = get_current_height(&rpc_url).await;
    let deadline_blocks = params.deadline_hours.unwrap_or(48) * 6;
    let timeout = height + deadline_blocks;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default().as_secs();
    let secret_hash = format!("{:0>64x}", ts);
    let doc_hash = format!("{:0>64x}", ts.wrapping_add(2));

    let mut scope_text = params.scope.unwrap_or_else(|| "Freelance work".to_string());
    if scope_text.len() > 100 { scope_text.truncate(100); }

    let args = vec![
        "agreement-create-simple-settlement".to_string(),
        "--agreement-id".to_string(), format!("freelance-{}", ts),
        "--creation-time".to_string(), ts.to_string(),
        "--party-a".to_string(), format!("addr={}", params.client),
        "--party-b".to_string(), format!("addr={}", params.contractor),
        "--amount".to_string(), format!("{:.8}", sats_to_irm(params.amount_sats)),
        "--secret-hash".to_string(), secret_hash,
        "--refund-timeout".to_string(), timeout.to_string(),
        "--document-hash".to_string(), doc_hash,
        "--json".to_string(),
    ];

    let output = run_wallet_cmd(args, wallet_path, data_dir).await?;
    let raw: serde_json::Value = serde_json::from_str(&output)
        .map_err(|e| format!("Parse error: {}", e))?;

    Ok(AgreementResult {
        agreement_id: raw["agreement_id"].as_str().unwrap_or("").to_string(),
        hash: raw["agreement_hash"].as_str().map(String::from),
        success: true,
        message: None,
    })
}

#[tauri::command]
async fn settlement_create_milestone(
    state: State<'_, AppState>,
    params: MilestoneParams,
) -> Result<AgreementResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    let height = get_current_height(&rpc_url).await;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default().as_secs();
    let secret_hash = format!("{:0>64x}", ts);
    let doc_hash = format!("{:0>64x}", ts.wrapping_add(3));
    let timeout = height + (params.milestone_count as u64 * 500);
    let per_milestone = sats_to_irm(params.amount_sats / params.milestone_count as u64);

    let mut args = vec![
        "agreement-create-milestone".to_string(),
        "--agreement-id".to_string(), format!("milestone-{}", ts),
        "--creation-time".to_string(), ts.to_string(),
        "--party-a".to_string(), format!("addr={}", params.payer),
        "--party-b".to_string(), format!("addr={}", params.payee),
        "--secret-hash".to_string(), secret_hash,
        "--refund-timeout".to_string(), timeout.to_string(),
        "--document-hash".to_string(), doc_hash,
        "--json".to_string(),
    ];
    for i in 0..params.milestone_count {
        let m_timeout = height + ((i as u64 + 1) * 500);
        let m_secret = format!("{:0>64x}", ts.wrapping_add(10 + i as u64));
        let m_hash = format!("{:0>64x}", ts.wrapping_add(100 + i as u64));
        args.push("--milestone".to_string());
        args.push(format!(
            "m{}|Milestone {}|{:.8}|{}|{}|{}",
            i + 1, i + 1, per_milestone, m_timeout, m_secret, m_hash
        ));
    }

    let output = run_wallet_cmd(args, wallet_path, data_dir).await?;
    let raw: serde_json::Value = serde_json::from_str(&output)
        .map_err(|e| format!("Parse error: {}", e))?;

    Ok(AgreementResult {
        agreement_id: raw["agreement_id"].as_str().unwrap_or("").to_string(),
        hash: raw["agreement_hash"].as_str().map(String::from),
        success: true,
        message: None,
    })
}

#[tauri::command]
async fn settlement_create_deposit(
    state: State<'_, AppState>,
    params: DepositParams,
) -> Result<AgreementResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    let height = get_current_height(&rpc_url).await;
    let deadline_blocks = params.deadline_hours.unwrap_or(24) * 6;
    let timeout = height + deadline_blocks;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default().as_secs();
    let secret_hash = format!("{:0>64x}", ts);
    let doc_hash = format!("{:0>64x}", ts.wrapping_add(4));

    let args = vec![
        "agreement-create-deposit".to_string(),
        "--agreement-id".to_string(), format!("deposit-{}", ts),
        "--creation-time".to_string(), ts.to_string(),
        "--payer".to_string(), format!("addr={}", params.depositor),
        "--payee".to_string(), format!("addr={}", params.recipient),
        "--amount".to_string(), format!("{:.8}", sats_to_irm(params.amount_sats)),
        "--purpose-reference".to_string(), "Deposit".to_string(),
        "--refund-summary".to_string(), "Deposit refund".to_string(),
        "--secret-hash".to_string(), secret_hash,
        "--refund-timeout".to_string(), timeout.to_string(),
        "--document-hash".to_string(), doc_hash,
        "--json".to_string(),
    ];

    let output = run_wallet_cmd(args, wallet_path, data_dir).await?;
    let raw: serde_json::Value = serde_json::from_str(&output)
        .map_err(|e| format!("Parse error: {}", e))?;

    Ok(AgreementResult {
        agreement_id: raw["agreement_id"].as_str().unwrap_or("").to_string(),
        hash: raw["agreement_hash"].as_str().map(String::from),
        success: true,
        message: None,
    })
}

#[tauri::command]
async fn settlement_create_merchant_delayed(
    state: State<'_, AppState>,
    params: MerchantDelayedParams,
) -> Result<AgreementResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    let height = get_current_height(&rpc_url).await;
    let cooldown_blocks = params.cooldown_hours.unwrap_or(72) * 6;
    let deadline_blocks = params.deadline_hours.unwrap_or(336) * 6;
    let settlement_deadline = height + cooldown_blocks;
    let refund_timeout = height + deadline_blocks;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default().as_secs();
    let secret_hash = format!("{:0>64x}", ts);
    let doc_hash = format!("{:0>64x}", ts.wrapping_add(5));

    let mut args = vec![
        "agreement-create-simple-settlement".to_string(),
        "--agreement-id".to_string(), format!("merchant-{}", ts),
        "--creation-time".to_string(), ts.to_string(),
        "--party-a".to_string(), format!("addr={}", params.buyer),
        "--party-b".to_string(), format!("addr={}", params.merchant),
        "--amount".to_string(), format!("{:.8}", sats_to_irm(params.amount_sats)),
        "--secret-hash".to_string(), secret_hash,
        "--refund-timeout".to_string(), refund_timeout.to_string(),
        "--document-hash".to_string(), doc_hash,
        "--settlement-deadline".to_string(), settlement_deadline.to_string(),
        "--release-summary".to_string(), "Merchant delivery confirmed".to_string(),
        "--refund-summary".to_string(), "Buyer dispute — refund issued".to_string(),
        "--json".to_string(),
    ];
    if let Some(memo) = params.memo {
        args.push("--notes".to_string());
        args.push(memo);
    }

    let output = run_wallet_cmd(args, wallet_path, data_dir).await?;
    let raw: serde_json::Value = serde_json::from_str(&output)
        .map_err(|e| format!("Parse error: {}", e))?;

    Ok(AgreementResult {
        agreement_id: raw["agreement_id"].as_str().unwrap_or("").to_string(),
        hash: raw["agreement_hash"].as_str().map(String::from),
        success: true,
        message: None,
    })
}

#[tauri::command]
async fn settlement_create_contractor(
    state: State<'_, AppState>,
    params: ContractorMilestoneParams,
) -> Result<AgreementResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    let height = get_current_height(&rpc_url).await;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default().as_secs();
    let secret_hash = format!("{:0>64x}", ts);
    let doc_hash = format!("{:0>64x}", ts.wrapping_add(6));
    let timeout = height + (params.milestone_count as u64 * 500);
    let per_milestone = sats_to_irm(params.amount_sats / params.milestone_count as u64);

    let mut args = vec![
        "agreement-create-milestone".to_string(),
        "--agreement-id".to_string(), format!("contractor-{}", ts),
        "--creation-time".to_string(), ts.to_string(),
        "--party-a".to_string(), format!("addr={}", params.client),
        "--party-b".to_string(), format!("addr={}", params.contractor),
        "--secret-hash".to_string(), secret_hash,
        "--refund-timeout".to_string(), timeout.to_string(),
        "--document-hash".to_string(), doc_hash,
        "--json".to_string(),
    ];
    if let Some(scope) = params.scope {
        args.push("--notes".to_string());
        args.push(scope);
    }
    for i in 0..params.milestone_count {
        let m_timeout = height + ((i as u64 + 1) * 500);
        let m_secret = format!("{:0>64x}", ts.wrapping_add(10 + i as u64));
        let m_hash = format!("{:0>64x}", ts.wrapping_add(100 + i as u64));
        args.push("--milestone".to_string());
        args.push(format!(
            "m{}|Milestone {}|{:.8}|{}|{}|{}",
            i + 1, i + 1, per_milestone, m_timeout, m_secret, m_hash
        ));
    }

    let output = run_wallet_cmd(args, wallet_path, data_dir).await?;
    let raw: serde_json::Value = serde_json::from_str(&output)
        .map_err(|e| format!("Parse error: {}", e))?;

    Ok(AgreementResult {
        agreement_id: raw["agreement_id"].as_str().unwrap_or("").to_string(),
        hash: raw["agreement_hash"].as_str().map(String::from),
        success: true,
        message: None,
    })
}

// ============================================================
// MINER
// ============================================================

// Sets the system tray tooltip to reflect mining state. Exposed as a Tauri
// command for frontend flexibility, but the canonical callers are
// start_miner / stop_miner below — the tooltip updates the moment the local
// process is spawned or killed, so the tray stays in sync with reality.
#[tauri::command]
fn update_tray_status(app: tauri::AppHandle, mining: bool) -> Result<(), String> {
    let tooltip = if mining { "Irium Core - Mining Active" } else { "Irium Core" };
    app.tray_handle()
        .set_tooltip(tooltip)
        .map_err(|e| e.to_string())
}

// Bug 1 fix — recognise the miner sidecar's block-found stdout lines so
// the GUI can display real block counts and a Found Blocks list.
//
// CPU miner (irium-miner.rs):
//   text  : `[✅] Block accepted by node at height N`
//   json  : `{"event":"submit_block","height":N,"status":"accepted"}`
// GPU miner (irium-miner-gpu.rs):
//   text  : `[GPU] ✅ Mined block at height N!`
//   json  : `{"event":"mined_block","height":N,"hash":"<hex>",...}`
//
// Returns (height, optional hash). The hash is only available when the
// sidecar is in json-log mode (the text-mode GPU output prints the hash
// on a separate following line, which we skip for simplicity here).
fn parse_block_found(line: &str) -> Option<(u64, Option<String>)> {
    let trimmed = line.trim();
    if trimmed.starts_with('{') {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
            let event = v.get("event").and_then(|e| e.as_str()).unwrap_or("");
            let is_accepted_submit = event == "submit_block"
                && v.get("status").and_then(|s| s.as_str()) == Some("accepted");
            if is_accepted_submit || event == "mined_block" {
                let height = v.get("height").and_then(|h| h.as_u64())?;
                let hash = v.get("hash").and_then(|h| h.as_str()).map(String::from);
                return Some((height, hash));
            }
        }
        return None;
    }
    for marker in &["Block accepted by node at height ", "Mined block at height "] {
        if let Some(idx) = line.find(marker) {
            let tail = &line[idx + marker.len()..];
            let num: String = tail.chars().take_while(|c| c.is_ascii_digit()).collect();
            if let Ok(h) = num.parse::<u64>() {
                return Some((h, None));
            }
        }
    }
    None
}

// Record a block-found event into AppState. Capped at 100 entries (oldest
// drained first) so a long mining session doesn't accumulate unbounded
// memory in the shell. Hash falls back to "" when not yet known.
// Dedup: if a block at the same height was already recorded (e.g. from
// both stdout and stderr of the same miner process), the second call is
// silently ignored.
fn record_found_block(
    blocks_found: &Arc<Mutex<u64>>,
    found_blocks: &Arc<Mutex<Vec<FoundBlock>>>,
    height: u64,
    hash: Option<String>,
) {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let entry = FoundBlock {
        height,
        hash: hash.unwrap_or_default(),
        timestamp: ts,
        reward_sats: 0,
        prev_hash: String::new(),
        merkle_root: String::new(),
        bits: String::new(),
        nonce: 0,
    };
    if let Ok(mut list) = found_blocks.lock() {
        if list.iter().any(|b| b.height == height) {
            return;
        }
        list.push(entry);
        if list.len() > 100 {
            let excess = list.len() - 100;
            list.drain(0..excess);
        }
    }
    if let Ok(mut counter) = blocks_found.lock() {
        *counter += 1;
    }
}

// All block-header detail extracted from a single /rpc/block?height=N call.
// Populated by fetch_block_details and written into the matching FoundBlock
// by update_block_details.
struct BlockDetails {
    reward_sats: u64,
    hash: String,
    prev_hash: String,
    merkle_root: String,
    bits: String,
    nonce: u64,
}

// Fetch block details for a freshly-mined block from iriumd. The endpoint
// /rpc/block?height=N returns a nested structure: top-level fields are
// height, miner_address, tx_hex; hash/prev_hash/merkle_root/time/bits/nonce
// are nested inside a "header" sub-object (same layout as get_recent_blocks).
// Returns None only if the HTTP request itself fails — partial data is always
// returned in Some(BlockDetails) so the caller can update whatever fields
// iriumd did supply.
async fn fetch_block_details(rpc_url: &str, height: u64) -> Option<BlockDetails> {
    let client = reqwest::Client::new();
    let url = format!("{}/rpc/block?height={}", rpc_url.trim_end_matches('/'), height);
    let resp = client
        .get(&url)
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let json: serde_json::Value = resp.json().await.ok()?;

    // iriumd nests hash/prev_hash/merkle_root/bits/nonce inside "header".
    let hdr = &json["header"];
    let hash        = hdr["hash"].as_str().unwrap_or("").to_string();
    let prev_hash   = hdr["prev_hash"].as_str().unwrap_or("").to_string();
    let merkle_root = hdr["merkle_root"].as_str().unwrap_or("").to_string();
    let bits = hdr["bits"].as_str()
        .map(String::from)
        .or_else(|| hdr["bits"].as_u64().map(|n| format!("{:#010x}", n)))
        .unwrap_or_default();
    let nonce = hdr["nonce"].as_u64().unwrap_or(0);

    // Direct reward fields — first match wins.
    let mut reward_sats = 0u64;
    for field in &["reward", "block_reward", "subsidy", "coinbase_reward", "coinbase_value", "miner_reward"] {
        if let Some(v) = json.get(field).and_then(|x| x.as_u64()) {
            reward_sats = v;
            break;
        }
    }
    // Fall back to summing the first tx's outputs (coinbase by convention).
    if reward_sats == 0 {
        if let Some(txs) = json.get("tx").or_else(|| json.get("txs")).or_else(|| json.get("transactions")) {
            if let Some(coinbase) = txs.as_array().and_then(|a| a.first()) {
                if let Some(outputs) = coinbase.get("vout").or_else(|| coinbase.get("outputs")) {
                    if let Some(arr) = outputs.as_array() {
                        reward_sats = arr.iter()
                            .filter_map(|o| {
                                o.get("value_sats")
                                    .or_else(|| o.get("value"))
                                    .or_else(|| o.get("amount"))
                                    .and_then(|v| v.as_u64())
                            })
                            .sum();
                    }
                }
            }
        }
    }

    Some(BlockDetails { reward_sats, hash, prev_hash, merkle_root, bits, nonce })
}

// Patch all detail fields of the most-recent matching entry. We scan from
// newest-to-oldest so simultaneous block-found events at different heights
// don't trample each other. Only overwrites hash if the RPC gave us one
// (text-mode miner output may have already set it from stdout).
fn update_block_details(
    found_blocks: &Arc<Mutex<Vec<FoundBlock>>>,
    height: u64,
    details: BlockDetails,
) {
    if let Ok(mut list) = found_blocks.lock() {
        if let Some(b) = list.iter_mut().rev().find(|b| b.height == height) {
            b.reward_sats = details.reward_sats;
            if !details.hash.is_empty() {
                b.hash = details.hash;
            }
            b.prev_hash   = details.prev_hash;
            b.merkle_root = details.merkle_root;
            b.bits        = details.bits;
            b.nonce       = details.nonce;
        }
    }
}

#[tauri::command]
async fn start_miner(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    address: String,
    threads: Option<u32>,
) -> Result<bool, String> {
    let mut miner_lock = state.miner_process.lock().map_err(lock_err)?;

    if miner_lock.is_some() {
        return Err("Miner is already running".to_string());
    }

    // irium-miner reads address from IRIUM_MINER_ADDRESS env var, not a CLI flag
    let mut args: Vec<String> = Vec::new();
    if let Some(t) = threads {
        args.push("--threads".to_string());
        args.push(t.to_string());
    }

    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let home_dir = dirs::home_dir().unwrap_or_default();
    let irium_dir = home_dir.join(".irium");

    let mut miner_env = HashMap::new();
    miner_env.insert("IRIUM_MINER_ADDRESS".to_string(), address.clone());
    miner_env.insert("IRIUM_RPC_URL".to_string(), rpc_url.clone());
    miner_env.insert("IRIUM_NODE_RPC".to_string(), rpc_url.clone());

    let cmd = Command::new_sidecar("irium-miner")
        .map_err(|e| format!("irium-miner not found: {}", e))?
        .envs(miner_env)
        .args(&args)
        .current_dir(irium_dir);

    let (mut rx, child) = cmd.spawn().map_err(|e| format!("Failed to start miner: {}", e))?;
    let hashrate_ref = Arc::clone(&state.miner_hashrate);
    let sync_ref = Arc::clone(&state.miner_sync_status);
    let blocks_found_ref = Arc::clone(&state.blocks_found);
    let found_blocks_ref = Arc::clone(&state.found_blocks);
    let rpc_url_for_reward = rpc_url.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            let line = match event {
                CommandEvent::Stdout(l) => { tracing::info!("[irium-miner] {}", l); l }
                CommandEvent::Stderr(l) => { tracing::warn!("[irium-miner stderr] {}", l); l }
                _ => break,
            };

            // Bug 1 fix — record block-found events before the other
            // pattern checks. A block-found line never matches the
            // hashrate regex, so the order doesn't shadow either signal.
            if let Some((height, hash)) = parse_block_found(&line) {
                record_found_block(&blocks_found_ref, &found_blocks_ref, height, hash);
                // Fire-and-forget detail fetch — fills reward_sats, hash,
                // prev_hash, merkle_root, bits, and nonce on the entry we
                // just pushed. If the RPC fails all fields stay at their
                // zero-value defaults and the UI shows "—".
                let fb_for_reward = Arc::clone(&found_blocks_ref);
                let rpc_for_reward = rpc_url_for_reward.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(details) = fetch_block_details(&rpc_for_reward, height).await {
                        update_block_details(&fb_for_reward, height, details);
                    }
                });
                continue;
            }

            if let Some(khs) = parse_hashrate_khs(&line) {
                if let Ok(mut h) = hashrate_ref.lock() { *h = khs; }
                // Mining started — drop any stale sync line so the UI
                // transitions cleanly from "Syncing…" to live hashrate.
                if let Ok(mut s) = sync_ref.lock() { *s = None; }
            } else if line.contains("[sync]") || line.contains("Miner downloading blocks") {
                // irium-miner.rs prints these tags while it's catching up
                // to the chain tip before mining starts. We want the UI
                // to surface this so the user understands the 30–60 s
                // startup delay isn't a hung miner.
                if let Ok(mut s) = sync_ref.lock() { *s = Some(line.trim().to_string()); }
            }
        }
    });
    *miner_lock = Some(child);
    *state.miner_start_time.lock().map_err(lock_err)? = Some(std::time::Instant::now());
    *state.miner_address.lock().map_err(lock_err)? = Some(address);
    *state.miner_threads.lock().map_err(lock_err)? = threads.unwrap_or(1);
    // Update tray tooltip so users who minimize-to-tray can see at a glance
    // that mining is still active. Non-fatal if the platform doesn't support
    // tray tooltips.
    let _ = app.tray_handle().set_tooltip("Irium Core - Mining Active");
    Ok(true)
}

#[tauri::command]
async fn stop_miner(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<bool, String> {
    let mut miner_lock = state.miner_process.lock().map_err(lock_err)?;
    if let Some(child) = miner_lock.take() {
        child.kill().map_err(|e| e.to_string())?;
        drop(miner_lock);
        *state.miner_start_time.lock().map_err(lock_err)? = None;
        *state.miner_address.lock().map_err(lock_err)? = None;
        *state.miner_threads.lock().map_err(lock_err)? = 0;
        *state.miner_hashrate.lock().map_err(lock_err)? = 0.0;
        *state.miner_sync_status.lock().map_err(lock_err)? = None;
        let _ = app.tray_handle().set_tooltip("Irium Core");
        return Ok(true);
    }
    Ok(false)
}

#[tauri::command]
async fn get_miner_status(state: State<'_, AppState>) -> Result<MinerStatus, String> {
    let running = state.miner_process.lock().map_err(lock_err)?.is_some();
    let uptime_secs = {
        let t = state.miner_start_time.lock().map_err(lock_err)?;
        t.as_ref().map(|i| i.elapsed().as_secs()).unwrap_or(0)
    };
    let address = state.miner_address.lock().map_err(lock_err)?.clone();
    let threads = *state.miner_threads.lock().map_err(lock_err)?;

    let hashrate_khs = *state.miner_hashrate.lock().map_err(lock_err)?;
    let sync_status = state.miner_sync_status.lock().map_err(lock_err)?.clone();
    let blocks_found = *state.blocks_found.lock().map_err(lock_err)?;

    Ok(MinerStatus {
        running,
        hashrate_khs,
        blocks_found,
        uptime_secs,
        difficulty: 0,
        threads,
        address,
        sync_status,
    })
}

// ============================================================
// GPU MINER
// ============================================================

#[tauri::command]
async fn list_gpu_devices() -> Result<Vec<GpuDevice>, String> {
    // Probe the GPU sidecar with --list-platforms. Output format:
    //   [GPU] OpenCL platforms detected:
    //     Platform 0: NVIDIA CUDA (1 device(s))
    //       Device 0: NVIDIA GeForce RTX 4070 SUPER
    // When no OpenCL ICD is present the binary prints:
    //   [GPU] No OpenCL platforms found.
    let cmd = match Command::new_sidecar("irium-miner-gpu") {
        Ok(c) => c,
        // Sidecar absent (no OpenCL on the build host). Treat as empty list.
        Err(_) => return Ok(Vec::new()),
    };
    let (mut rx, _child) = cmd
        .args(&["--list-platforms"])
        .spawn()
        .map_err(|e| format!("Failed to probe GPUs: {}", e))?;

    let mut output = String::new();
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(l) | CommandEvent::Stderr(l) => {
                output.push_str(&l);
                output.push('\n');
            }
            CommandEvent::Terminated(_) => break,
            _ => {}
        }
    }

    if output.contains("No OpenCL platforms found") {
        return Ok(Vec::new());
    }

    let mut devices = Vec::new();
    let mut current_vendor = String::new();
    let mut flat_index: u32 = 0;
    for line in output.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("Platform ") {
            if let Some(colon) = rest.find(": ") {
                let after = &rest[colon + 2..];
                current_vendor = after.split(" (").next().unwrap_or(after).to_string();
            }
        } else if let Some(rest) = trimmed.strip_prefix("Device ") {
            if let Some(colon) = rest.find(": ") {
                let name = rest[colon + 2..].to_string();
                devices.push(GpuDevice {
                    index: flat_index,
                    name,
                    vendor: current_vendor.clone(),
                    vram_mb: 0,
                });
                flat_index += 1;
            }
        }
    }
    Ok(devices)
}

#[tauri::command]
async fn list_gpu_platforms() -> Result<Vec<GpuPlatform>, String> {
    let cmd = match Command::new_sidecar("irium-miner-gpu") {
        Ok(c) => c,
        Err(_) => return Ok(Vec::new()),
    };
    let (mut rx, _child) = cmd
        .args(&["--list-platforms"])
        .spawn()
        .map_err(|e| format!("Failed to probe GPUs: {}", e))?;

    let mut output = String::new();
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(l) | CommandEvent::Stderr(l) => {
                output.push_str(&l);
                output.push('\n');
            }
            CommandEvent::Terminated(_) => break,
            _ => {}
        }
    }

    if output.contains("No OpenCL platforms found") {
        return Ok(Vec::new());
    }

    let mut platforms: Vec<GpuPlatform> = Vec::new();
    for line in output.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("Platform ") {
            // "Platform 0: NVIDIA CUDA (1 device(s))"
            if let Some(colon) = rest.find(": ") {
                if let Ok(idx) = rest[..colon].parse::<u32>() {
                    let after = &rest[colon + 2..];
                    let name = after.split(" (").next().unwrap_or(after).to_string();
                    let lo = name.to_lowercase();
                    let is_discrete = lo.contains("nvidia") || lo.contains("amd") || lo.contains("advanced micro");
                    platforms.push(GpuPlatform { index: idx, name, devices: Vec::new(), is_discrete });
                }
            }
        } else if let Some(rest) = trimmed.strip_prefix("Device ") {
            // "Device 0: NVIDIA GeForce RTX 4070 SUPER"
            if let Some(colon) = rest.find(": ") {
                if let Ok(dev_idx) = rest[..colon].parse::<u32>() {
                    let dev_name = rest[colon + 2..].to_string();
                    if let Some(platform) = platforms.last_mut() {
                        platform.devices.push(GpuPlatformDevice { index: dev_idx, name: dev_name });
                    }
                }
            }
        }
    }
    Ok(platforms)
}

#[tauri::command]
async fn start_gpu_miner(
    state: State<'_, AppState>,
    address: String,
    platform_sel: Option<String>,
    device_indices: Vec<u32>,
) -> Result<bool, String> {
    let mut miner_lock = state.miner_process.lock().map_err(lock_err)?;
    if miner_lock.is_some() {
        return Err("Miner already running — stop it first".to_string());
    }
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let home_dir = dirs::home_dir().unwrap_or_default();
    let irium_dir = home_dir.join(".irium");

    let mut args: Vec<String> = vec![
        "--wallet".into(), address.clone(),
        "--rpc".into(), rpc_url.clone(),
    ];
    if let Some(sel) = platform_sel {
        args.push("--platform".into());
        args.push(sel);
    }
    match device_indices.len() {
        0 => {}
        1 => {
            args.push("--device".into());
            args.push(device_indices[0].to_string());
        }
        _ => {
            let joined = device_indices.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",");
            args.push("--devices".into());
            args.push(joined);
        }
    }

    let (mut rx, child) = Command::new_sidecar("irium-miner-gpu")
        .map_err(|e| format!("irium-miner-gpu not bundled: {}", e))?
        .args(&args)
        .current_dir(irium_dir)
        .spawn()
        .map_err(|e| format!("Failed to start GPU miner: {}", e))?;

    let hashrate_ref = Arc::clone(&state.miner_hashrate);
    let blocks_found_ref = Arc::clone(&state.blocks_found);
    let found_blocks_ref = Arc::clone(&state.found_blocks);
    let rpc_url_for_reward = rpc_url.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            let line = match event {
                CommandEvent::Stdout(l) => l,
                CommandEvent::Stderr(l) => l,
                _ => break,
            };
            if let Some((height, hash)) = parse_block_found(&line) {
                record_found_block(&blocks_found_ref, &found_blocks_ref, height, hash);
                let fb_for_reward = Arc::clone(&found_blocks_ref);
                let rpc_for_reward = rpc_url_for_reward.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(details) = fetch_block_details(&rpc_for_reward, height).await {
                        update_block_details(&fb_for_reward, height, details);
                    }
                });
                continue;
            }
            if let Some(khs) = parse_hashrate_khs(&line) {
                if let Ok(mut h) = hashrate_ref.lock() { *h = khs; }
            }
        }
    });
    *miner_lock = Some(child);
    *state.miner_start_time.lock().map_err(lock_err)? = Some(std::time::Instant::now());
    *state.miner_address.lock().map_err(lock_err)? = Some(address);
    Ok(true)
}

#[tauri::command]
async fn stop_gpu_miner(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<bool, String> {
    stop_miner(app, state).await
}

#[tauri::command]
async fn get_gpu_miner_status(state: State<'_, AppState>) -> Result<GpuMinerStatus, String> {
    let running = state.miner_process.lock().map_err(lock_err)?.is_some();
    let hashrate_khs = *state.miner_hashrate.lock().map_err(lock_err)?;
    let blocks_found = *state.blocks_found.lock().map_err(lock_err)?;
    Ok(GpuMinerStatus { running, hashrate_khs, blocks_found, device_name: None, temperature_c: None, power_w: None })
}

// Returns the list of blocks the CPU or GPU miner has found during this
// app session. Capped server-side at 100 entries (oldest dropped first).
#[tauri::command]
async fn get_found_blocks(state: State<'_, AppState>) -> Result<Vec<FoundBlock>, String> {
    let list = state.found_blocks.lock().map_err(lock_err)?.clone();
    Ok(list)
}

// ============================================================
// STRATUM POOL MINING
// ============================================================

#[tauri::command]
async fn stratum_connect(
    state: State<'_, AppState>,
    pool_url: String,
    worker: String,
    password: String,
) -> Result<bool, String> {
    let (rpc_url, wallet_path, data_dir_val) = {
        let miner_lock = state.miner_process.lock().map_err(lock_err)?;
        if miner_lock.is_some() {
            return Err("Miner already running — stop it first".to_string());
        }
        let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
        let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
        let data_dir_val = state.data_dir.lock().map_err(lock_err)?.clone();
        (rpc_url, wallet_path, data_dir_val)
    }; // all guards dropped here before the await below

    // Use wallet address as the mining address if worker is not an IRM address
    let mining_addr = get_first_wallet_address(wallet_path, data_dir_val).await
        .unwrap_or_else(|_| worker.clone());

    let home_dir = dirs::home_dir().unwrap_or_default();
    let irium_dir = home_dir.join(".irium");

    let mut env = HashMap::new();
    env.insert("IRIUM_MINER_ADDRESS".to_string(), mining_addr.clone());
    env.insert("IRIUM_RPC_URL".to_string(), rpc_url.clone());
    env.insert("IRIUM_NODE_RPC".to_string(), rpc_url);
    env.insert("IRIUM_STRATUM_URL".to_string(), pool_url.clone());
    env.insert("IRIUM_STRATUM_USER".to_string(), worker.clone());
    env.insert("IRIUM_STRATUM_PASS".to_string(), password);

    let (mut rx, child) = Command::new_sidecar("irium-miner")
        .map_err(|e| format!("irium-miner not found: {}", e))?
        .envs(env)
        .current_dir(irium_dir)
        .spawn()
        .map_err(|e| format!("Failed to start pool miner: {}", e))?;

    let hashrate_ref = Arc::clone(&state.miner_hashrate);
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            let line = match event {
                CommandEvent::Stdout(l) => l,
                CommandEvent::Stderr(l) => l,
                _ => break,
            };
            if let Some(khs) = parse_hashrate_khs(&line) {
                if let Ok(mut h) = hashrate_ref.lock() { *h = khs; }
            }
        }
    });

    let mut miner_lock2 = state.miner_process.lock().map_err(lock_err)?;
    *miner_lock2 = Some(child);
    *state.miner_start_time.lock().map_err(lock_err)? = Some(std::time::Instant::now());
    *state.miner_address.lock().map_err(lock_err)? = Some(mining_addr);
    *state.pool_url.lock().map_err(lock_err)? = Some(pool_url);
    Ok(true)
}

#[tauri::command]
async fn stratum_disconnect(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<bool, String> {
    *state.pool_url.lock().map_err(lock_err)? = None;
    stop_miner(app, state).await
}

#[tauri::command]
async fn get_stratum_status(state: State<'_, AppState>) -> Result<StratumStatus, String> {
    let running = state.miner_process.lock().map_err(lock_err)?.is_some();
    let pool_url = state.pool_url.lock().map_err(lock_err)?.clone();
    let worker = state.miner_address.lock().map_err(lock_err)?.clone();
    let uptime_secs = {
        let t = state.miner_start_time.lock().map_err(lock_err)?;
        t.as_ref().map(|i| i.elapsed().as_secs()).unwrap_or(0)
    };
    Ok(StratumStatus { connected: running && pool_url.is_some(), pool_url, worker, shares_accepted: 0, shares_rejected: 0, uptime_secs })
}

// ============================================================
// RPC DIRECT CALLS
// ============================================================

#[tauri::command]
async fn rpc_get_peers(state: State<'_, AppState>) -> Result<Vec<PeerInfo>, String> {
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/peers", rpc_url))
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    // GET /peers returns {"peers":[...]}
    let response = resp.json::<PeersResponse>().await.map_err(|e| e.to_string())?;
    Ok(response.peers)
}

#[tauri::command]
async fn rpc_get_mempool(state: State<'_, AppState>) -> Result<MempoolInfo, String> {
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let client = reqwest::Client::new();
    // Use /rpc/fee_estimate which includes mempool_size
    let resp = client
        .get(format!("{}/rpc/fee_estimate", rpc_url))
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let fee_est = resp.json::<FeeEstimateResponse>().await.map_err(|e| e.to_string())?;
    Ok(MempoolInfo {
        size: fee_est.mempool_size.unwrap_or(0),
        bytes: 0,
    })
}

#[tauri::command]
async fn rpc_get_block(
    state: State<'_, AppState>,
    height_or_hash: String,
) -> Result<serde_json::Value, String> {
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let client = reqwest::Client::new();
    // Detect hash vs height: hashes are 64 hex chars
    let url = if height_or_hash.len() == 64 && height_or_hash.chars().all(|c| c.is_ascii_hexdigit()) {
        format!("{}/rpc/block_by_hash?hash={}", rpc_url, height_or_hash)
    } else {
        format!("{}/rpc/block?height={}", rpc_url, height_or_hash)
    };
    let resp = client
        .get(&url)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn rpc_get_tx(
    state: State<'_, AppState>,
    txid: String,
) -> Result<serde_json::Value, String> {
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let client = reqwest::Client::new();
    let url = format!("{}/rpc/tx?txid={}", rpc_url, txid);
    let resp = client
        .get(&url)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())
    } else {
        Err(format!("Transaction not found"))
    }
}

#[tauri::command]
async fn rpc_get_address(
    state: State<'_, AppState>,
    address: String,
) -> Result<serde_json::Value, String> {
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let client = reqwest::Client::new();
    let url = format!("{}/rpc/address?addr={}", rpc_url, address);
    let resp = client
        .get(&url)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())
    } else {
        Err(format!("Address not found"))
    }
}

/// Fetches the last `limit` blocks directly from iriumd — no sidecar required.
/// Used by the Explorer page to display the recent block grid.
#[tauri::command]
async fn get_recent_blocks(
    state: State<'_, AppState>,
    limit: Option<u32>,
    end_height: Option<u64>,
) -> Result<Vec<ExplorerBlock>, String> {
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let n = limit.unwrap_or(20).min(100) as u64;

    let info = get_rpc_info(&rpc_url).await
        .map_err(|_| "node offline".to_string())?;
    let tip = info.height.unwrap_or(0);
    if tip == 0 { return Ok(vec![]); }
    let height = end_height.map(|h| h.min(tip)).unwrap_or(tip);

    // Build a single shared client with a tight per-request timeout.
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| format!("client: {}", e))?;

    let start = height.saturating_sub(n - 1);

    // Limit to 5 concurrent requests so the node-status poller can still reach
    // iriumd's RPC while blocks are being fetched (firing 30 requests at once
    // would saturate iriumd's HTTP server and cause the poller to see the node
    // as offline, producing spurious "Node Disconnected" toasts).
    let sem = std::sync::Arc::new(tokio::sync::Semaphore::new(5));

    let handles: Vec<tokio::task::JoinHandle<Option<ExplorerBlock>>> =
        (start..=height).rev().map(|h| {
            let url    = format!("{}/rpc/block?height={}", rpc_url, h);
            let client = client.clone();
            let sem    = sem.clone();
            tokio::spawn(async move {
                let _permit = sem.acquire().await.ok()?;
                let resp = client.get(&url).send().await.ok()?;
                let b    = resp.json::<serde_json::Value>().await.ok()?;
                // iriumd nests hash/time inside a "header" sub-object:
                // { "height": N, "header": { "hash": "...", "time": N, ... },
                //   "tx_hex": [...], "miner_address": "..." }
                let hdr = &b["header"];
                let blk = ExplorerBlock {
                    height:        b["height"].as_u64().unwrap_or(h),
                    hash:          hdr["hash"].as_str().unwrap_or("").to_string(),
                    miner_address: b["miner_address"].as_str()
                        .or_else(|| b["miner"].as_str())
                        .map(String::from),
                    time:          hdr["time"].as_u64().unwrap_or(0),
                    tx_count:      b["tx_hex"].as_array()
                        .map(|a| a.len() as u32)
                        .unwrap_or(0),
                    prev_hash:     hdr["prev_hash"].as_str().map(String::from),
                    merkle_root:   hdr["merkle_root"].as_str().map(String::from),
                    bits:          hdr["bits"].as_str()
                        .map(String::from)
                        .or_else(|| hdr["bits"].as_u64().map(|n| format!("{:#010x}", n)))
                        .or_else(|| hdr["bits"].as_f64().map(|n| format!("{:.0}", n))),
                    nonce:         hdr["nonce"].as_u64(),
                };
                if blk.hash.is_empty() { None } else { Some(blk) }
            })
        }).collect();

    // Await all handles; JoinHandle errors (task panics) are silently dropped.
    let mut blocks = Vec::with_capacity(n as usize);
    for handle in handles {
        if let Ok(Some(blk)) = handle.await {
            blocks.push(blk);
        }
    }
    blocks.sort_by(|a, b| b.height.cmp(&a.height));

    Ok(blocks)
}

#[tauri::command]
async fn get_network_hashrate(state: State<'_, AppState>) -> Result<NetworkHashrateInfo, String> {
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/rpc/network_hashrate", rpc_url))
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let v = resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;
    Ok(NetworkHashrateInfo {
        hashrate:   v["hashrate"].as_f64().or_else(|| v["hash_rate"].as_f64()),
        difficulty: v["difficulty"].as_f64(),
        height:     v["height"].as_u64(),
    })
}

#[tauri::command]
async fn rpc_get_offers_feed(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/offers/feed", rpc_url))
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn rpc_set_url(state: State<'_, AppState>, url: String) -> Result<bool, String> {
    *state.rpc_url.lock().map_err(lock_err)? = url;
    Ok(true)
}

// ============================================================
// EXPLORER SIDECAR COMMANDS (queries irium-explorer on :38310)
// ============================================================

const EXPLORER_BASE_URL: &str = "http://127.0.0.1:38310";

/// Starts the irium-explorer sidecar if it isn't already running.
/// Called lazily by the Explorer page on mount — keeps it isolated from iriumd's lifecycle.
#[tauri::command]
async fn start_explorer_sidecar(state: State<'_, AppState>) -> Result<bool, String> {
    // If already running, do nothing.
    {
        let lock = state.explorer_process.lock().map_err(lock_err)?;
        if lock.is_some() {
            return Ok(true);
        }
    }

    let mut explorer_env = HashMap::new();
    explorer_env.insert("IRIUM_NODE_RPC".to_string(), "http://127.0.0.1:38300".to_string());
    explorer_env.insert("IRIUM_EXPLORER_HOST".to_string(), "127.0.0.1".to_string());
    explorer_env.insert("IRIUM_EXPLORER_PORT".to_string(), "38310".to_string());

    match Command::new_sidecar("irium-explorer") {
        Ok(cmd) => {
            match cmd.envs(explorer_env).spawn() {
                Ok((mut erx, echild)) => {
                    {
                        let mut lock = state.explorer_process.lock().map_err(lock_err)?;
                        *lock = Some(echild);
                    }
                    let explorer_ref = Arc::clone(&state.explorer_process);
                    tauri::async_runtime::spawn(async move {
                        while let Some(event) = erx.recv().await {
                            match event {
                                CommandEvent::Stdout(line) => tracing::info!("[irium-explorer] {}", line),
                                CommandEvent::Stderr(line) => tracing::warn!("[irium-explorer stderr] {}", line),
                                CommandEvent::Terminated(_) => {
                                    // Explorer exited — clear the slot so next call restarts it.
                                    if let Ok(mut lock) = explorer_ref.lock() {
                                        *lock = None;
                                    }
                                    break;
                                }
                                _ => {}
                            }
                        }
                    });
                    Ok(true)
                }
                Err(e) => Err(format!("Failed to start irium-explorer: {}", e)),
            }
        }
        Err(_) => Err("irium-explorer binary not found in binaries/".to_string()),
    }
}

#[tauri::command]
async fn get_explorer_stats() -> Result<ExplorerNetworkStats, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(4))
        .build()
        .map_err(|e| format!("client build failed: {}", e))?;

    let (stats_res, metrics_res) = tokio::join!(
        client.get(format!("{}/api/stats", EXPLORER_BASE_URL)).send(),
        client.get(format!("{}/api/metrics", EXPLORER_BASE_URL)).send(),
    );

    let stats_val: serde_json::Value = stats_res
        .map_err(|_| "explorer offline".to_string())?
        .json().await
        .map_err(|e| format!("stats parse: {}", e))?;

    let metrics_val: serde_json::Value = metrics_res
        .map_err(|_| "explorer offline".to_string())?
        .json().await
        .map_err(|e| format!("metrics parse: {}", e))?;

    Ok(ExplorerNetworkStats {
        height:              stats_val["height"].as_u64().unwrap_or(0),
        total_blocks:        stats_val["total_blocks"].as_u64().unwrap_or(0),
        supply_irm:          stats_val["supply_irm"].as_f64().unwrap_or(0.0),
        peer_count:          stats_val["peer_count"].as_u64().unwrap_or(0) as u32,
        active_miners:       stats_val["active_miners"].as_u64().unwrap_or(0) as u32,
        hashrate:            metrics_val["hashrate"].as_f64().unwrap_or(0.0),
        difficulty:          metrics_val["difficulty"].as_f64().unwrap_or(0.0),
        diff_change_1h_pct:  metrics_val["diff_change_1h_pct"].as_f64().unwrap_or(0.0),
        diff_change_24h_pct: metrics_val["diff_change_24h_pct"].as_f64().unwrap_or(0.0),
        avg_block_time:      metrics_val["avg_block_time"].as_f64().unwrap_or(0.0),
    })
}

#[tauri::command]
async fn get_explorer_peers() -> Result<Vec<ExplorerPeer>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(4))
        .build()
        .map_err(|e| format!("client build failed: {}", e))?;

    let val: serde_json::Value = client
        .get(format!("{}/api/peers", EXPLORER_BASE_URL))
        .send()
        .await
        .map_err(|_| "explorer offline".to_string())?
        .json()
        .await
        .map_err(|e| format!("peers parse: {}", e))?;

    let peers = val["peers"].as_array()
        .or_else(|| val.as_array())
        .cloned()
        .unwrap_or_default();

    Ok(peers.into_iter().map(|p| ExplorerPeer {
        multiaddr: p["multiaddr"].as_str().unwrap_or("").to_string(),
        dialable:  p["dialable"].as_bool().unwrap_or(false),
        height:    p["height"].as_u64(),
        last_seen: p["last_seen"].as_f64(),
        agent:     p["agent"].as_str().map(String::from),
        source:    p["source"].as_str().map(String::from),
    }).collect())
}

#[tauri::command]
async fn get_explorer_blocks() -> Result<Vec<ExplorerBlock>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(4))
        .build()
        .map_err(|e| format!("client build failed: {}", e))?;

    let val: serde_json::Value = client
        .get(format!("{}/api/blocks?limit=10", EXPLORER_BASE_URL))
        .send()
        .await
        .map_err(|_| "explorer offline".to_string())?
        .json()
        .await
        .map_err(|e| format!("blocks parse: {}", e))?;

    let blocks = val["blocks"].as_array()
        .or_else(|| val.as_array())
        .cloned()
        .unwrap_or_default();

    Ok(blocks.into_iter().map(|b| ExplorerBlock {
        height:        b["height"].as_u64().unwrap_or(0),
        hash:          b["hash"].as_str().unwrap_or("").to_string(),
        miner_address: b["miner_address"].as_str().or_else(|| b["miner"].as_str()).map(String::from),
        time:          b["time"].as_u64().or_else(|| b["timestamp"].as_u64()).unwrap_or(0),
        tx_count:      b["tx_count"].as_u64().unwrap_or(0) as u32,
        prev_hash:     b["prev_hash"].as_str().map(String::from),
        merkle_root:   b["merkle_root"].as_str().map(String::from),
        bits:          b["bits"].as_str().map(String::from).or_else(|| b["bits"].as_u64().map(|n| format!("{:#010x}", n))),
        nonce:         b["nonce"].as_u64(),
    }).collect())
}

// ============================================================
// CONFIG / SETTINGS
// ============================================================

#[tauri::command]
async fn set_wallet_config(
    state: State<'_, AppState>,
    wallet_path: Option<String>,
    data_dir: Option<String>,
) -> Result<bool, String> {
    // Reject a stale persisted wallet_path (file moved/deleted between runs)
    // by falling back to None — irium-wallet then defaults to
    // ~/.irium/wallet.json instead of failing on every command.
    let validated_wallet_path = match wallet_path {
        Some(p) if !std::path::Path::new(&p).exists() => {
            tracing::warn!(
                "[set_wallet_config] persisted wallet_path does not exist on disk: {} — falling back to default",
                p
            );
            None
        }
        other => other,
    };
    *state.wallet_path.lock().map_err(lock_err)? = validated_wallet_path;
    *state.data_dir.lock().map_err(lock_err)? = data_dir;
    Ok(true)
}

/// Fetches the machine's public IP from a user-chosen service.
/// Only called when the user explicitly clicks "Detect" in Settings —
/// nothing goes out automatically.
#[tauri::command]
async fn detect_public_ip(service_url: String) -> Result<String, String> {
    let url = service_url.trim().to_string();
    if url.is_empty() {
        return Err("No service URL provided".to_string());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Service returned HTTP {}", resp.status()));
    }
    let body = resp.text().await.map_err(|e| format!("Failed to read response: {}", e))?;
    let ip = body.trim().to_string();
    if ip.is_empty() {
        return Err("Service returned an empty response".to_string());
    }
    Ok(ip)
}

#[tauri::command]
async fn save_settings(app_handle: tauri::AppHandle, settings_json: String) -> Result<bool, String> {
    let config = app_handle.config();
    let data_dir = app_data_dir(&config)
        .ok_or("Could not determine app data directory")?;
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create data dir: {}", e))?;
    let settings_path = data_dir.join("irium-core-settings.json");
    std::fs::write(&settings_path, &settings_json)
        .map_err(|e| format!("Failed to write settings: {}", e))?;
    Ok(true)
}

#[tauri::command]
async fn load_settings(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    let config = app_handle.config();
    let data_dir = app_data_dir(&config)
        .ok_or("Could not determine app data directory")?;
    let settings_path = data_dir.join("irium-core-settings.json");
    if settings_path.exists() {
        let contents = std::fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read settings: {}", e))?;
        Ok(Some(contents))
    } else {
        Ok(None)
    }
}

// ============================================================
// UPDATE CHECK
// ============================================================

const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");
const RELEASES_API: &str = "https://api.github.com/repos/iriumlabs/irium-core/releases/latest";

#[tauri::command]
async fn check_for_updates() -> Result<UpdateCheckResult, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent(format!("irium-core/{}", CURRENT_VERSION))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(RELEASES_API)
        .send()
        .await
        .map_err(|e| format!("Update check failed: {}", e))?;

    if resp.status().is_success() {
        let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        let latest = json["tag_name"]
            .as_str()
            .unwrap_or("")
            .trim_start_matches('v')
            .to_string();
        let notes = json["body"].as_str().map(|s| s.to_string());
        let url = json["html_url"].as_str().map(|s| s.to_string());

        let available = !latest.is_empty() && latest != CURRENT_VERSION;
        Ok(UpdateCheckResult {
            available,
            current_version: CURRENT_VERSION.to_string(),
            latest_version: if latest.is_empty() { CURRENT_VERSION.to_string() } else { latest },
            release_notes: notes,
            release_url: url,
        })
    } else {
        Ok(UpdateCheckResult {
            available: false,
            current_version: CURRENT_VERSION.to_string(),
            latest_version: CURRENT_VERSION.to_string(),
            release_notes: None,
            release_url: None,
        })
    }
}

// ============================================================
// NODE SOURCE UPDATE CHECK
// ============================================================

// Commit hash of the irium-source submodule at the time this binary was built.
// Set by build.rs via cargo:rustc-env; falls back to "unknown" when git was
// unavailable during the build.
const IRIUM_NODE_COMMIT: &str = env!("IRIUM_NODE_COMMIT");

fn short_sha(s: &str) -> String {
    if s.len() >= 7 { s[..7].to_string() } else { s.to_string() }
}

/// Check the iriumlabs/irium GitHub repo for commits newer than what this
/// build was compiled from. Returns comparison info including how many commits
/// behind the running node binaries are.
#[tauri::command]
async fn check_node_update() -> Result<NodeUpdateCheckResult, String> {
    let current = IRIUM_NODE_COMMIT.to_string();
    let current_short = short_sha(&current);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent(format!("irium-core/{}", CURRENT_VERSION))
        .build()
        .map_err(|e| e.to_string())?;

    // Fetch the latest commit on the main branch.
    let resp = client
        .get("https://api.github.com/repos/iriumlabs/irium/commits/main")
        .send()
        .await
        .map_err(|e| format!("Node update check failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API returned {}", resp.status()));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let latest_commit = json["sha"].as_str().unwrap_or("").to_string();
    let latest_short  = short_sha(&latest_commit);
    let latest_message = json["commit"]["message"]
        .as_str().unwrap_or("").lines().next().unwrap_or("").to_string();
    let latest_author = json["commit"]["author"]["name"]
        .as_str().unwrap_or("").to_string();
    let latest_date   = json["commit"]["author"]["date"]
        .as_str().unwrap_or("").to_string();

    // When compiled without git (e.g. CI without submodule), we can still show
    // the latest commit info but cannot determine if an update is available.
    if current == "unknown" || current.is_empty() {
        return Ok(NodeUpdateCheckResult {
            has_update: false,
            current_commit: current,
            current_commit_short: "unknown".to_string(),
            latest_commit,
            latest_commit_short: latest_short,
            latest_message,
            latest_author,
            latest_date,
            commits_behind: 0,
            compare_url: "https://github.com/iriumlabs/irium/commits/main".to_string(),
        });
    }

    let has_update = !latest_commit.is_empty() && latest_commit != current;

    // Ask GitHub how many commits ahead main is relative to our pinned commit.
    let commits_behind: u32 = if has_update {
        let url = format!(
            "https://api.github.com/repos/iriumlabs/irium/compare/{}...main",
            current
        );
        let behind = async {
            let r = client.get(&url).send().await.ok()?;
            if !r.status().is_success() { return None; }
            let j: serde_json::Value = r.json().await.ok()?;
            j["ahead_by"].as_u64()
        }.await;
        behind.unwrap_or(1) as u32
    } else {
        0
    };

    let compare_url = if current.len() >= 7 {
        format!("https://github.com/iriumlabs/irium/compare/{}...main", &current[..7])
    } else {
        "https://github.com/iriumlabs/irium/commits/main".to_string()
    };

    Ok(NodeUpdateCheckResult {
        has_update,
        current_commit: current,
        current_commit_short: current_short,
        latest_commit,
        latest_commit_short: latest_short,
        latest_message,
        latest_author,
        latest_date,
        commits_behind,
        compare_url,
    })
}

/// Pull the irium-source submodule to the latest commit on its remote main
/// branch. This updates the source code; the caller must rebuild binaries
/// (via `npm run build:node -- --force`) and restart the node to apply.
#[tauri::command]
async fn update_node_source() -> Result<NodeUpdatePullResult, String> {
    // CARGO_MANIFEST_DIR is the `src-tauri/` directory baked in at compile time.
    // The project root (where .gitmodules lives) is one level up.
    let src_tauri_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let project_root  = src_tauri_dir
        .parent()
        .ok_or_else(|| "Cannot determine project root from CARGO_MANIFEST_DIR".to_string())?;

    // Verify the submodule directory exists (won't be present in packaged builds).
    let submodule_dir = project_root.join("irium-source");
    if !submodule_dir.exists() {
        return Err(
            "irium-source directory not found — source-based updates are only \
             available in development builds".to_string()
        );
    }

    // Pull the submodule to the latest remote commit.
    let out = std::process::Command::new("git")
        .args(["submodule", "update", "--remote", "--merge", "irium-source"])
        .current_dir(project_root)
        .output()
        .map_err(|e| format!("git not available: {}", e))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("git submodule update failed: {}", stderr.trim()));
    }

    // Read the new HEAD commit.
    let head_out = std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(&submodule_dir)
        .output()
        .map_err(|e| e.to_string())?;

    let new_commit = String::from_utf8_lossy(&head_out.stdout)
        .trim().to_string();
    let new_short = short_sha(&new_commit);

    Ok(NodeUpdatePullResult {
        success: true,
        new_commit: new_commit.clone(),
        new_commit_short: new_short.clone(),
        message: format!(
            "Source updated to {}. Run `npm run build:node -- --force` then restart to apply the new binaries.",
            new_short
        ),
    })
}

// ============================================================
// MULTISIG
// ============================================================

#[tauri::command]
async fn multisig_create(
    state: State<'_, AppState>,
    threshold: u32,
    pubkeys: Vec<String>,
) -> Result<MultisigCreateResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let mut args = vec!["multisig-create".to_string(), "--threshold".to_string(), threshold.to_string(), "--json".to_string()];
    for pk in &pubkeys {
        args.push("--pubkeys".to_string());
        args.push(pk.clone());
    }
    let output = run_wallet_cmd(args, wallet_path, data_dir).await?;
    let raw: serde_json::Value = serde_json::from_str(&output).unwrap_or_default();
    Ok(MultisigCreateResult {
        script_pubkey: raw["script_pubkey"].as_str().unwrap_or("").to_string(),
        address: raw["address"].as_str().unwrap_or("").to_string(),
        threshold,
        pubkeys,
    })
}

#[tauri::command]
async fn multisig_broadcast(
    state: State<'_, AppState>,
    raw_tx: String,
) -> Result<MultisigSpendResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let output = run_wallet_cmd_with_rpc(
        vec!["multisig-broadcast".to_string(), "--raw-tx".to_string(), raw_tx.clone(), "--json".to_string()],
        wallet_path, data_dir, rpc_url,
    ).await?;
    let raw: serde_json::Value = serde_json::from_str(&output).unwrap_or_default();
    Ok(MultisigSpendResult {
        raw_tx: Some(raw_tx),
        txid: raw["txid"].as_str().map(String::from),
        success: true,
        message: None,
    })
}

// ============================================================
// INVOICES
// ============================================================

#[tauri::command]
async fn invoice_generate(
    state: State<'_, AppState>,
    recipient: String,
    amount_irm: f64,
    reference: String,
    expires_blocks: Option<u64>,
    out_path: Option<String>,
) -> Result<Invoice, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let mut args = vec![
        "invoice-generate".to_string(),
        "--recipient".to_string(), recipient.clone(),
        "--amount".to_string(), amount_irm.to_string(),
        "--reference".to_string(), reference.clone(),
        "--json".to_string(),
    ];
    if let Some(eb) = expires_blocks {
        args.push("--expires-blocks".to_string());
        args.push(eb.to_string());
    }
    if let Some(op) = out_path {
        args.push("--out".to_string());
        args.push(op);
    }
    let output = run_wallet_cmd(args, wallet_path, data_dir).await?;
    let raw: serde_json::Value = serde_json::from_str(&output).unwrap_or_default();
    Ok(Invoice {
        id: raw["invoice_id"].as_str().or_else(|| raw["id"].as_str()).unwrap_or("").to_string(),
        recipient: raw["recipient"].as_str().unwrap_or(&recipient).to_string(),
        amount: raw["amount"].as_u64().unwrap_or((amount_irm * 100_000_000.0) as u64),
        reference: raw["reference"].as_str().unwrap_or(&reference).to_string(),
        expires_height: raw["expires_height"].as_u64().or_else(|| raw["expires_at_height"].as_u64()),
        created_at: raw["created_at"].as_i64(),
        status: raw["status"].as_str().map(String::from),
    })
}

#[tauri::command]
async fn invoice_import(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<InvoiceImportResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let path_for_read = file_path.clone();
    let output = run_wallet_cmd(
        vec!["invoice-import".to_string(), "--file".to_string(), file_path, "--json".to_string()],
        wallet_path, data_dir,
    ).await?;
    let raw: serde_json::Value = serde_json::from_str(&output).unwrap_or_default();

    // Also parse the on-disk JSON so the renderer can prefill a new
    // agreement form. Field-name variants mirror invoice_generate's parser
    // above (amount may be sats `amount` or IRM `amount_irm`). Parse failure
    // is silent — the renderer just shows no prefill data.
    let parsed_invoice: Option<Invoice> = std::fs::read_to_string(&path_for_read)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .map(|v| Invoice {
            id: v["invoice_id"]
                .as_str()
                .or_else(|| v["id"].as_str())
                .unwrap_or("")
                .to_string(),
            recipient: v["recipient"].as_str().unwrap_or("").to_string(),
            amount: v["amount"].as_u64().unwrap_or_else(|| {
                v["amount_irm"]
                    .as_f64()
                    .map(|irm| (irm * 100_000_000.0) as u64)
                    .unwrap_or(0)
            }),
            reference: v["reference"].as_str().unwrap_or("").to_string(),
            expires_height: v["expires_height"]
                .as_u64()
                .or_else(|| v["expires_at_height"].as_u64()),
            created_at: v["created_at"].as_i64(),
            status: v["status"].as_str().map(String::from),
        });

    Ok(InvoiceImportResult {
        success: true,
        invoice_id: raw["invoice_id"].as_str().map(String::from),
        invoice: parsed_invoice,
        message: None,
    })
}

// ============================================================
// AGREEMENT ELIGIBILITY & STATUS
// ============================================================

#[tauri::command]
async fn agreement_release_eligibility(
    state: State<'_, AppState>,
    agreement_id: String,
    funding_txid: Option<String>,
) -> Result<SpendEligibilityResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let mut args = vec!["agreement-release-eligibility".to_string(), agreement_id, "--json".to_string()];
    if let Some(txid) = funding_txid {
        args.push(txid);
    }
    let output = run_wallet_cmd_with_rpc(args, wallet_path, data_dir, rpc_url).await?;
    let raw: serde_json::Value = serde_json::from_str(&output).unwrap_or_default();
    Ok(SpendEligibilityResult {
        eligible: raw["eligible"].as_bool().unwrap_or(false),
        reason: raw["reason"].as_str().map(String::from),
        funding_txid: raw["funding_txid"].as_str().map(String::from),
        amount: raw["amount"].as_u64(),
        timelock_remaining: raw["timelock_remaining"].as_u64(),
    })
}

#[tauri::command]
async fn agreement_refund_eligibility(
    state: State<'_, AppState>,
    agreement_id: String,
    funding_txid: Option<String>,
) -> Result<SpendEligibilityResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let mut args = vec!["agreement-refund-eligibility".to_string(), agreement_id, "--json".to_string()];
    if let Some(txid) = funding_txid {
        args.push(txid);
    }
    let output = run_wallet_cmd_with_rpc(args, wallet_path, data_dir, rpc_url).await?;
    let raw: serde_json::Value = serde_json::from_str(&output).unwrap_or_default();
    Ok(SpendEligibilityResult {
        eligible: raw["eligible"].as_bool().unwrap_or(false),
        reason: raw["reason"].as_str().map(String::from),
        funding_txid: raw["funding_txid"].as_str().map(String::from),
        amount: raw["amount"].as_u64(),
        timelock_remaining: raw["timelock_remaining"].as_u64(),
    })
}

#[tauri::command]
async fn agreement_status(
    state: State<'_, AppState>,
    agreement_id: String,
) -> Result<AgreementStatusResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let output = run_wallet_cmd_with_rpc(
        vec!["agreement-status".to_string(), agreement_id.clone(), "--json".to_string()],
        wallet_path, data_dir, rpc_url,
    ).await?;
    let raw: serde_json::Value = serde_json::from_str(&output).unwrap_or_default();
    Ok(AgreementStatusResult {
        agreement_id: raw["agreement_id"].as_str().unwrap_or(&agreement_id).to_string(),
        agreement_hash: raw["agreement_hash"].as_str().map(String::from),
        status: raw["status"].as_str().unwrap_or("unknown").to_string(),
        funded: raw["funded"].as_bool(),
        funding_txid: raw["funding_txid"].as_str().map(String::from),
        release_eligible: raw["release_eligible"].as_bool(),
        refund_eligible: raw["refund_eligible"].as_bool(),
        current_height: raw["current_height"].as_u64(),
        proof_status: raw["proof_status"].as_str().map(String::from),
    })
}

#[tauri::command]
async fn agreement_fund(
    state: State<'_, AppState>,
    agreement_id: String,
    broadcast: Option<bool>,
) -> Result<ReleaseResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let mut args = vec!["agreement-fund".to_string(), agreement_id, "--json".to_string()];
    if broadcast.unwrap_or(true) {
        args.push("--broadcast".to_string());
    }
    let output = run_wallet_cmd_with_rpc(args, wallet_path, data_dir, rpc_url).await?;
    let raw: serde_json::Value = serde_json::from_str(&output).unwrap_or_default();
    Ok(ReleaseResult {
        txid: raw["txid"].as_str().map(String::from),
        success: true,
        message: None,
    })
}

// ============================================================
// POLICIES
// ============================================================

#[tauri::command]
async fn policy_build_otc(
    state: State<'_, AppState>,
    policy_id: String,
    agreement_hash: String,
    attestor: String,
    release_proof_type: String,
    out_path: Option<String>,
) -> Result<ProofPolicy, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let mut args = vec![
        "policy-build-otc".to_string(),
        "--policy-id".to_string(), policy_id.clone(),
        "--agreement-hash".to_string(), agreement_hash.clone(),
        "--attestor".to_string(), attestor.clone(),
        "--release-proof-type".to_string(), release_proof_type.clone(),
        "--json".to_string(),
    ];
    if let Some(op) = out_path {
        args.push("--out".to_string());
        args.push(op);
    }
    let output = run_wallet_cmd_with_rpc(args, wallet_path, data_dir, rpc_url).await?;
    let raw: serde_json::Value = serde_json::from_str(&output).unwrap_or_default();
    Ok(ProofPolicy {
        policy_id: raw["policy_id"].as_str().unwrap_or(&policy_id).to_string(),
        agreement_hash: raw["agreement_hash"].as_str().unwrap_or(&agreement_hash).to_string(),
        kind: "otc".to_string(),
        attestor: Some(attestor),
        proof_type: Some(release_proof_type),
        created_at: raw["created_at"].as_i64(),
        raw: Some(raw),
    })
}

#[tauri::command]
async fn policy_build_contractor(
    state: State<'_, AppState>,
    policy_id: String,
    agreement_hash: String,
    attestor: String,
    milestone: String,
    out_path: Option<String>,
) -> Result<ProofPolicy, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let mut args = vec![
        "policy-build-contractor".to_string(),
        "--policy-id".to_string(), policy_id.clone(),
        "--agreement-hash".to_string(), agreement_hash.clone(),
        "--attestor".to_string(), attestor.clone(),
        "--milestone".to_string(), milestone,
        "--json".to_string(),
    ];
    if let Some(op) = out_path {
        args.push("--out".to_string());
        args.push(op);
    }
    let output = run_wallet_cmd_with_rpc(args, wallet_path, data_dir, rpc_url).await?;
    let raw: serde_json::Value = serde_json::from_str(&output).unwrap_or_default();
    Ok(ProofPolicy {
        policy_id: raw["policy_id"].as_str().unwrap_or(&policy_id).to_string(),
        agreement_hash: raw["agreement_hash"].as_str().unwrap_or(&agreement_hash).to_string(),
        kind: "contractor".to_string(),
        attestor: Some(attestor),
        proof_type: None,
        created_at: raw["created_at"].as_i64(),
        raw: Some(raw),
    })
}

#[tauri::command]
async fn policy_build_preorder(
    state: State<'_, AppState>,
    policy_id: String,
    agreement_hash: String,
    attestor: String,
    delivery_proof_type: String,
    out_path: Option<String>,
) -> Result<ProofPolicy, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let mut args = vec![
        "policy-build-preorder".to_string(),
        "--policy-id".to_string(), policy_id.clone(),
        "--agreement-hash".to_string(), agreement_hash.clone(),
        "--attestor".to_string(), attestor.clone(),
        "--delivery-proof-type".to_string(), delivery_proof_type.clone(),
        "--json".to_string(),
    ];
    if let Some(op) = out_path {
        args.push("--out".to_string());
        args.push(op);
    }
    let output = run_wallet_cmd_with_rpc(args, wallet_path, data_dir, rpc_url).await?;
    let raw: serde_json::Value = serde_json::from_str(&output).unwrap_or_default();
    Ok(ProofPolicy {
        policy_id: raw["policy_id"].as_str().unwrap_or(&policy_id).to_string(),
        agreement_hash: raw["agreement_hash"].as_str().unwrap_or(&agreement_hash).to_string(),
        kind: "preorder".to_string(),
        attestor: Some(attestor),
        proof_type: Some(delivery_proof_type),
        created_at: raw["created_at"].as_i64(),
        raw: Some(raw),
    })
}

#[tauri::command]
async fn agreement_policy_list(
    state: State<'_, AppState>,
    active_only: Option<bool>,
) -> Result<Vec<ProofPolicy>, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let mut args = vec!["agreement-policy-list".to_string(), "--json".to_string()];
    if active_only.unwrap_or(false) {
        args.push("--active-only".to_string());
    }
    let output = run_wallet_cmd_with_rpc(args, wallet_path, data_dir, rpc_url)
        .await.unwrap_or_else(|_| "[]".to_string());
    serde_json::from_str::<Vec<ProofPolicy>>(&output).or_else(|_| {
        let val: serde_json::Value = serde_json::from_str(&output).unwrap_or_default();
        let arr = val.get("policies").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        Ok(arr.iter().map(|v| ProofPolicy {
            policy_id: v["policy_id"].as_str().unwrap_or("").to_string(),
            agreement_hash: v["agreement_hash"].as_str().unwrap_or("").to_string(),
            kind: v["kind"].as_str().or_else(|| v["type"].as_str()).unwrap_or("").to_string(),
            attestor: v["attestor"].as_str().map(String::from),
            proof_type: v["proof_type"].as_str().map(String::from),
            created_at: v["created_at"].as_i64(),
            raw: Some(v.clone()),
        }).collect())
    })
}

#[tauri::command]
async fn agreement_policy_evaluate(
    state: State<'_, AppState>,
    agreement_id: String,
) -> Result<serde_json::Value, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let output = run_wallet_cmd_with_rpc(
        vec!["agreement-policy-evaluate".to_string(), "--agreement".to_string(), agreement_id, "--json".to_string()],
        wallet_path, data_dir, rpc_url,
    ).await?;
    serde_json::from_str::<serde_json::Value>(&output).map_err(|e| format!("Parse error: {}", e))
}

// ============================================================
// REPUTATION ACTIONS
// ============================================================

#[tauri::command]
async fn reputation_record_outcome(
    state: State<'_, AppState>,
    seller: String,
    outcome: String,
    proof_response_secs: Option<u64>,
    self_trade: Option<bool>,
) -> Result<ReputationOutcomeResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let mut args = vec![
        "reputation-record-outcome".to_string(),
        "--seller".to_string(), seller.clone(),
        "--outcome".to_string(), outcome.clone(),
        "--json".to_string(),
    ];
    if let Some(secs) = proof_response_secs {
        args.push("--proof-response-secs".to_string());
        args.push(secs.to_string());
    }
    if self_trade.unwrap_or(false) {
        args.push("--self-trade".to_string());
    }
    run_wallet_cmd(args, wallet_path, data_dir).await?;
    Ok(ReputationOutcomeResult { success: true, seller, outcome, message: None })
}

#[tauri::command]
async fn reputation_export(
    state: State<'_, AppState>,
    seller: String,
    out_path: Option<String>,
) -> Result<serde_json::Value, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let mut args = vec!["reputation-export".to_string(), "--seller".to_string(), seller, "--json".to_string()];
    if let Some(op) = out_path {
        args.push("--out".to_string());
        args.push(op);
    }
    let output = run_wallet_cmd(args, wallet_path, data_dir).await?;
    serde_json::from_str::<serde_json::Value>(&output).map_err(|e| format!("Parse error: {}", e))
}

#[tauri::command]
async fn reputation_import(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<bool, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    run_wallet_cmd(
        vec!["reputation-import".to_string(), "--file".to_string(), file_path],
        wallet_path, data_dir,
    ).await?;
    Ok(true)
}

#[tauri::command]
async fn reputation_self_trade_check(
    state: State<'_, AppState>,
    seller: String,
    buyer: String,
) -> Result<SelfTradeCheckResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let output = run_wallet_cmd(
        vec![
            "reputation-self-trade-check".to_string(),
            "--seller".to_string(), seller.clone(),
            "--buyer".to_string(), buyer.clone(),
            "--json".to_string(),
        ],
        wallet_path, data_dir,
    ).await?;
    let raw: serde_json::Value = serde_json::from_str(&output).unwrap_or_default();
    Ok(SelfTradeCheckResult {
        is_self_trade: raw["is_self_trade"].as_bool().unwrap_or(false),
        seller: raw["seller"].as_str().unwrap_or(&seller).to_string(),
        buyer: raw["buyer"].as_str().unwrap_or(&buyer).to_string(),
        message: raw["message"].as_str().map(String::from),
    })
}

// ============================================================
// SELLER / BUYER STATUS
// ============================================================

#[tauri::command]
async fn seller_status(
    state: State<'_, AppState>,
    address: Option<String>,
) -> Result<SellerStatus, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let mut args = vec!["seller-status".to_string(), "--json".to_string()];
    if let Some(ref addr) = address {
        args.push("--address".to_string());
        args.push(addr.clone());
    }
    let output = run_wallet_cmd_with_rpc(args, wallet_path, data_dir, rpc_url).await?;
    let raw: serde_json::Value = serde_json::from_str(&output).unwrap_or_default();
    Ok(SellerStatus {
        address: raw["address"].as_str().or(address.as_deref()).unwrap_or("").to_string(),
        active_offers: raw["active_offers"].as_u64(),
        completed_agreements: raw["completed_agreements"].as_u64(),
        open_agreements: raw["open_agreements"].as_u64(),
        total_volume: raw["total_volume"].as_u64(),
        reputation_score: raw["reputation_score"].as_f64(),
        can_create_offers: raw["can_create_offers"].as_bool(),
        restrictions: raw["restrictions"].as_array().map(|a| {
            a.iter().filter_map(|v| v.as_str().map(String::from)).collect()
        }),
    })
}

#[tauri::command]
async fn buyer_status(
    state: State<'_, AppState>,
    address: Option<String>,
) -> Result<BuyerStatus, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let mut args = vec!["buyer-status".to_string(), "--json".to_string()];
    if let Some(ref addr) = address {
        args.push("--address".to_string());
        args.push(addr.clone());
    }
    let output = run_wallet_cmd_with_rpc(args, wallet_path, data_dir, rpc_url).await?;
    let raw: serde_json::Value = serde_json::from_str(&output).unwrap_or_default();
    Ok(BuyerStatus {
        address: raw["address"].as_str().or(address.as_deref()).unwrap_or("").to_string(),
        active_agreements: raw["active_agreements"].as_u64(),
        completed_agreements: raw["completed_agreements"].as_u64(),
        total_spent: raw["total_spent"].as_u64(),
        reputation_score: raw["reputation_score"].as_f64(),
        can_take_offers: raw["can_take_offers"].as_bool(),
        restrictions: raw["restrictions"].as_array().map(|a| {
            a.iter().filter_map(|v| v.as_str().map(String::from)).collect()
        }),
    })
}

// ============================================================
// DISPUTES
// ============================================================

#[tauri::command]
async fn agreement_dispute(
    state: State<'_, AppState>,
    agreement_id: String,
    reason: Option<String>,
) -> Result<DisputeOpenResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let mut args = vec!["agreement-dispute".to_string(), agreement_id, "--json".to_string()];
    if let Some(r) = reason {
        args.push("--reason".to_string());
        args.push(r);
    }
    let output = run_wallet_cmd(args, wallet_path, data_dir).await?;
    let raw: serde_json::Value = serde_json::from_str(&output).unwrap_or_default();
    Ok(DisputeOpenResult {
        dispute_id: raw["dispute_id"].as_str().map(String::from),
        success: true,
        message: None,
    })
}

#[tauri::command]
async fn agreement_dispute_list(state: State<'_, AppState>) -> Result<Vec<DisputeEntry>, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let output = run_wallet_cmd(
        vec!["agreement-dispute-list".to_string(), "--json".to_string()],
        wallet_path, data_dir,
    ).await.unwrap_or_else(|_| "[]".to_string());
    serde_json::from_str::<Vec<DisputeEntry>>(&output).or_else(|_| {
        let val: serde_json::Value = serde_json::from_str(&output).unwrap_or_default();
        let arr = val.get("disputes").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        Ok(arr.iter().filter_map(|v| {
            Some(DisputeEntry {
                id: v["id"].as_str().or_else(|| v["dispute_id"].as_str())?.to_string(),
                agreement_id: v["agreement_id"].as_str().unwrap_or("").to_string(),
                reason: v["reason"].as_str().map(String::from),
                status: v["status"].as_str().unwrap_or("open").to_string(),
                opened_at: v["opened_at"].as_i64(),
                resolved_at: v["resolved_at"].as_i64(),
            })
        }).collect())
    })
}

// ============================================================
// NETWORK METRICS
// ============================================================

#[tauri::command]
async fn get_network_metrics(state: State<'_, AppState>) -> Result<NetworkMetrics, String> {
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let last_status = state.last_node_status.lock().map_err(lock_err)?.clone();
    let info = get_rpc_info(&rpc_url).await.unwrap_or_default();
    let client = reqwest::Client::new();
    let fee_est = client
        .get(format!("{}/rpc/fee_estimate", rpc_url))
        .timeout(Duration::from_secs(3))
        .send()
        .await
        .ok();
    let mempool_size = if let Some(resp) = fee_est {
        resp.json::<FeeEstimateResponse>().await
            .ok()
            .and_then(|f| f.mempool_size)
            .unwrap_or(0)
    } else {
        0
    };
    let (synced, height) = if let Some(s) = last_status {
        (s.synced, s.height)
    } else {
        (false, info.height.unwrap_or(0))
    };
    Ok(NetworkMetrics {
        height,
        peers: info.peer_count.unwrap_or(0),
        mempool_size,
        hashrate_khs: None,
        difficulty: None,
        synced,
    })
}

// ============================================================
// EXPLORER
// ============================================================

#[tauri::command]
async fn explorer_agreements(
    state: State<'_, AppState>,
    limit: Option<u64>,
) -> Result<Vec<ExplorerAgreement>, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let _ = limit;
    let output = run_wallet_cmd_with_rpc(
        vec!["agreement-local-store-list".to_string(), "--json".to_string()],
        wallet_path, data_dir, rpc_url,
    ).await.unwrap_or_else(|_| "{}".to_string());
    let val: serde_json::Value = serde_json::from_str(&output).unwrap_or_default();
    let stored = val.get("stored_raw_agreements")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(stored.iter().map(|v| ExplorerAgreement {
        id: v["agreement_id"].as_str().unwrap_or("").to_string(),
        hash: v["agreement_hash"].as_str().map(String::from),
        template: None,
        buyer: None,
        seller: None,
        amount: 0,
        status: "stored".to_string(),
        created_at: None,
    }).collect())
}

#[tauri::command]
async fn explorer_stats(state: State<'_, AppState>) -> Result<ExplorerStats, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let store_output = run_wallet_cmd_with_rpc(
        vec!["agreement-local-store-list".to_string(), "--json".to_string()],
        wallet_path, data_dir, rpc_url,
    ).await.unwrap_or_else(|_| "{}".to_string());
    let store: serde_json::Value = serde_json::from_str(&store_output).unwrap_or_default();
    Ok(ExplorerStats {
        total_agreements: store.get("raw_agreement_count").and_then(|v| v.as_u64()),
        active_agreements: None,
        total_volume: None,
        total_proofs: None,
        registered_attestors: None,
    })
}

// ============================================================
// OFFER FEED OPERATIONS
// ============================================================

#[tauri::command]
async fn offer_feed_discover(state: State<'_, AppState>) -> Result<FeedDiscoverResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let output = run_wallet_cmd(
        vec!["offer-feed-discover".to_string(), "--json".to_string()],
        wallet_path, data_dir,
    ).await.unwrap_or_else(|_| "[]".to_string());
    let discovered: Vec<String> = serde_json::from_str::<Vec<String>>(&output)
        .or_else(|_| {
            let val: serde_json::Value = serde_json::from_str(&output).unwrap_or_default();
            let arr = val.get("feeds").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            Ok::<Vec<String>, serde_json::Error>(arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        })
        .unwrap_or_default();
    let count = discovered.len() as u64;
    Ok(FeedDiscoverResult { discovered, count })
}

#[tauri::command]
async fn feed_bootstrap(state: State<'_, AppState>) -> Result<bool, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    run_wallet_cmd(vec!["feed-bootstrap".to_string()], wallet_path, data_dir).await?;
    Ok(true)
}

// ============================================================
// AGREEMENT STORE / SIGN / VERIFY / DECRYPT
// ============================================================

#[tauri::command]
async fn agreement_local_store_list(state: State<'_, AppState>) -> Result<AgreementStoreListResponse, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let output = run_wallet_cmd_with_rpc(
        vec!["agreement-local-store-list".to_string(), "--json".to_string()],
        wallet_path, data_dir, rpc_url,
    ).await.unwrap_or_else(|_| "{}".to_string());
    serde_json::from_str::<AgreementStoreListResponse>(&output)
        .map_err(|e| format!("Parse error: {}", e))
}

#[tauri::command]
async fn agreement_sign_cmd(
    state: State<'_, AppState>,
    agreement_id: String,
    signer_addr: String,
    role: Option<String>,
    out_path: Option<String>,
) -> Result<AgreementSignResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let mut args = vec![
        "agreement-sign".to_string(),
        "--agreement".to_string(), agreement_id.clone(),
        "--signer".to_string(), signer_addr.clone(),
        "--json".to_string(),
    ];
    if let Some(r) = role {
        args.push("--role".to_string());
        args.push(r);
    }
    if let Some(ref op) = out_path {
        args.push("--out".to_string());
        args.push(op.clone());
    }
    let output = run_wallet_cmd(args, wallet_path, data_dir).await?;
    let raw: serde_json::Value = serde_json::from_str(&output).unwrap_or_default();
    Ok(AgreementSignResult {
        agreement_hash: raw["agreement_hash"].as_str().unwrap_or(&agreement_id).to_string(),
        signer: raw["signer"].as_str().unwrap_or(&signer_addr).to_string(),
        success: true,
        signature_path: out_path,
    })
}

#[tauri::command]
async fn agreement_verify_signature(
    state: State<'_, AppState>,
    signature_path: String,
    agreement_id: Option<String>,
) -> Result<AgreementVerifySignatureResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let mut args = vec![
        "agreement-verify-signature".to_string(),
        "--signature".to_string(), signature_path,
        "--json".to_string(),
    ];
    if let Some(aid) = agreement_id {
        args.push("--agreement".to_string());
        args.push(aid);
    }
    let output = run_wallet_cmd(args, wallet_path, data_dir).await?;
    let raw: serde_json::Value = serde_json::from_str(&output).unwrap_or_default();
    Ok(AgreementVerifySignatureResult {
        valid: raw["valid"].as_bool().unwrap_or(false),
        signer: raw["signer"].as_str().map(String::from),
        agreement_hash: raw["agreement_hash"].as_str().map(String::from),
        message: raw["message"].as_str().map(String::from),
    })
}

#[tauri::command]
async fn agreement_decrypt(
    state: State<'_, AppState>,
    blob_path: String,
) -> Result<AgreementDecryptResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let wp = wallet_path.clone().unwrap_or_else(resolve_wallet_path);
    let output = run_wallet_cmd(
        vec![
            "agreement-decrypt".to_string(),
            blob_path,
            "--wallet".to_string(), wp,
            "--json".to_string(),
        ],
        wallet_path, data_dir,
    ).await?;
    let raw: serde_json::Value = serde_json::from_str(&output).unwrap_or_default();
    Ok(AgreementDecryptResult {
        agreement_id: raw["agreement_id"].as_str().map(String::from),
        agreement_hash: raw["agreement_hash"].as_str().map(String::from),
        decrypted: raw,
        success: true,
    })
}

// ============================================================
// DIAGNOSTICS
// ============================================================

#[tauri::command]
async fn run_diagnostics(state: State<'_, AppState>) -> Result<DiagnosticsResult, String> {
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap_or_default();

    let mut checks: Vec<DiagnosticCheck> = Vec::new();

    // 1. iriumd reachable at configured RPC URL
    let rpc_ok = client.get(format!("{}/status", rpc_url)).send().await.is_ok();
    checks.push(DiagnosticCheck {
        label: format!("iriumd reachable at {}", rpc_url),
        passed: rpc_ok,
        detail: if rpc_ok { None } else { Some("Connection refused".to_string()) },
    });

    // 2. /status returns valid JSON
    let status_ok = if rpc_ok {
        match get_rpc_info(&rpc_url).await {
            Ok(info) => {
                let h = info.height.unwrap_or(0);
                checks.push(DiagnosticCheck {
                    label: "/status returns valid JSON".to_string(),
                    passed: true,
                    detail: Some(format!("height={}", h)),
                });
                true
            }
            Err(e) => {
                checks.push(DiagnosticCheck {
                    label: "/status returns valid JSON".to_string(),
                    passed: false,
                    detail: Some(e),
                });
                false
            }
        }
    } else {
        checks.push(DiagnosticCheck {
            label: "/status returns valid JSON".to_string(),
            passed: false,
            detail: Some("RPC not reachable".to_string()),
        });
        false
    };
    let _ = status_ok;

    // 3. /peers returns peer list
    match client.get(format!("{}/peers", rpc_url)).send().await {
        Ok(resp) => match resp.json::<PeersResponse>().await {
            Ok(p) => checks.push(DiagnosticCheck {
                label: "/peers returns peer list".to_string(),
                passed: true,
                detail: Some(format!("{} peer(s)", p.peers.len())),
            }),
            Err(e) => checks.push(DiagnosticCheck {
                label: "/peers returns peer list".to_string(),
                passed: false,
                detail: Some(e.to_string()),
            }),
        },
        Err(e) => checks.push(DiagnosticCheck {
            label: "/peers returns peer list".to_string(),
            passed: false,
            detail: Some(e.to_string()),
        }),
    }

    // 4. irium-wallet --version / list-addresses runs successfully
    match run_wallet_cmd(vec!["list-addresses".to_string()], wallet_path.clone(), data_dir.clone()).await {
        Ok(out) => {
            let count = out.lines().filter(|l| !l.trim().is_empty()).count();
            checks.push(DiagnosticCheck {
                label: "irium-wallet runs successfully".to_string(),
                passed: true,
                detail: Some(format!("{} address(es)", count)),
            });
        }
        Err(e) => checks.push(DiagnosticCheck {
            label: "irium-wallet runs successfully".to_string(),
            passed: false,
            detail: Some(e),
        }),
    }

    // 5. irium-wallet balance runs (get first address)
    match run_wallet_cmd(vec!["list-addresses".to_string()], wallet_path.clone(), data_dir.clone()).await {
        Ok(out) => {
            let first_addr = out.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim().to_string();
            if first_addr.is_empty() {
                checks.push(DiagnosticCheck {
                    label: "irium-wallet balance query".to_string(),
                    passed: false,
                    detail: Some("No addresses in wallet".to_string()),
                });
            } else {
                let bal_url = format!("{}/rpc/balance?address={}", rpc_url, first_addr);
                match client.get(&bal_url).send().await {
                    Ok(r) => match r.json::<RpcBalance>().await {
                        Ok(b) => checks.push(DiagnosticCheck {
                            label: "irium-wallet balance query".to_string(),
                            passed: true,
                            detail: Some(format!("{} sats", b.balance)),
                        }),
                        Err(e) => checks.push(DiagnosticCheck {
                            label: "irium-wallet balance query".to_string(),
                            passed: false,
                            detail: Some(e.to_string()),
                        }),
                    },
                    Err(e) => checks.push(DiagnosticCheck {
                        label: "irium-wallet balance query".to_string(),
                        passed: false,
                        detail: Some(e.to_string()),
                    }),
                }
            }
        }
        Err(e) => checks.push(DiagnosticCheck {
            label: "irium-wallet balance query".to_string(),
            passed: false,
            detail: Some(e),
        }),
    }

    // 6. Wallet file exists at configured path or default
    let home_dir = dirs::home_dir().unwrap_or_default();
    let default_wallet = home_dir.join(".irium").join("wallet.json");
    let wallet_exists = if let Some(ref p) = wallet_path {
        std::path::Path::new(p).exists()
    } else {
        default_wallet.exists()
    };
    let wallet_display = wallet_path.as_deref().unwrap_or(default_wallet.to_str().unwrap_or("~/.irium/wallet.json"));
    checks.push(DiagnosticCheck {
        label: "Wallet file exists".to_string(),
        passed: wallet_exists,
        detail: Some(wallet_display.to_string()),
    });

    // 7. Node binaries accessible (bundled sidecar OR system PATH)
    // Command::new_sidecar() is the correct runtime check; the src-tauri/binaries/ path
    // only exists at build time, not when the compiled app runs.
    let sidecars = ["iriumd", "irium-wallet", "irium-miner"];
    let mut all_bins_present = true;
    let mut bin_details: Vec<String> = Vec::new();
    for name in &sidecars {
        let has_sidecar = Command::new_sidecar(*name).is_ok();
        // Fallback: check system PATH
        let in_path = if !has_sidecar {
            let check_cmd = if cfg!(target_os = "windows") { "where" } else { "which" };
            std::process::Command::new(check_cmd)
                .arg(name)
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        } else {
            false
        };
        if has_sidecar {
            bin_details.push(format!("{} (bundled)", name));
        } else if in_path {
            bin_details.push(format!("{} (PATH)", name));
        } else {
            all_bins_present = false;
            bin_details.push(format!("{} MISSING", name));
        }
    }
    checks.push(DiagnosticCheck {
        label: "Node binaries accessible".to_string(),
        passed: all_bins_present,
        detail: Some(bin_details.join(", ")),
    });

    let passed = checks.iter().filter(|c| c.passed).count() as u32;
    let total = checks.len() as u32;

    Ok(DiagnosticsResult { checks, passed, total })
}

// ============================================================
// NODE LOGS
// ============================================================

#[tauri::command]
async fn get_node_logs(state: State<'_, AppState>, lines: Option<usize>) -> Result<Vec<String>, String> {
    let n = lines.unwrap_or(200).min(1000);
    let logs = state.node_logs.lock().map_err(lock_err)?;
    let start = if logs.len() > n { logs.len() - n } else { 0 };
    Ok(logs[start..].to_vec())
}

// ============================================================
// WEBSOCKET → TAURI EVENT BRIDGE
// ============================================================
// Subscribes to iriumd's /ws endpoint, listens for agreement.* and offer.*
// events, and re-emits each event to the renderer as a Tauri `irium-event`.
// Reconnects every 5s if iriumd is down or the connection drops, so it works
// correctly even when iriumd starts after the GUI or restarts while the GUI
// stays alive. Connection target is hardcoded to ws://127.0.0.1:38300/ws to
// match the default iriumd HTTP port.

async fn ws_bridge_connect_and_run(app_handle: &tauri::AppHandle) -> Result<(), String> {
    use tokio_tungstenite::{connect_async, tungstenite::Message};
    use futures_util::{StreamExt, SinkExt};

    let url = "ws://127.0.0.1:38300/ws";
    let (ws_stream, _resp) = connect_async(url).await.map_err(|e| e.to_string())?;
    let (mut write, mut read) = ws_stream.split();

    let sub = serde_json::json!({
        "action": "subscribe",
        "events": ["agreement.*", "offer.*"]
    });
    write.send(Message::Text(sub.to_string())).await.map_err(|e| e.to_string())?;

    while let Some(msg) = read.next().await {
        let msg = msg.map_err(|e| e.to_string())?;
        match msg {
            Message::Text(text) => {
                if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&text) {
                    if payload.get("type").and_then(|t| t.as_str()) == Some("subscribed") {
                        continue;
                    }
                    let _ = app_handle.emit_all("irium-event", &payload);
                }
            }
            Message::Close(_) => return Ok(()),
            _ => {}
        }
    }
    Ok(())
}

fn spawn_ws_bridge(app_handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            match ws_bridge_connect_and_run(&app_handle).await {
                Ok(_) => tracing::info!("[ws-bridge] connection closed, reconnecting in 5s"),
                Err(e) => tracing::warn!("[ws-bridge] error: {} — reconnecting in 5s", e),
            }
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        }
    });
}

// ============================================================
// MAIN
// ============================================================

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let tray_menu = SystemTrayMenu::new()
        .add_item(CustomMenuItem::new("show", "Show Irium Core"))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("quit", "Quit"));

    let system_tray = SystemTray::new().with_menu(tray_menu);

    tauri::Builder::default()
        .manage(AppState::new())
        .setup(|app| {
            let app_handle = app.handle();
            tauri::async_runtime::spawn(async move {
                // Silent startup update check — emit event so frontend can show banner
                if let Ok(result) = check_for_updates().await {
                    if result.available {
                        let _ = app_handle.emit_all("update-available", &result);
                    }
                }
            });
            // Phase 5: spawn the WebSocket → Tauri event bridge. Reconnects
            // forever; harmless when iriumd is not running.
            spawn_ws_bridge(app.handle());
            Ok(())
        })
        .system_tray(system_tray)
        .on_system_tray_event(|app, event| {
            use tauri::SystemTrayEvent;
            match event {
                SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
                    "show" => {
                        if let Some(window) = app.get_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => std::process::exit(0),
                    _ => {}
                },
                _ => {}
            }
        })
        .on_window_event(|event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event.event() {
                let _ = event.window().hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            // Node
            start_node,
            stop_node,
            get_node_status,
            get_node_metrics,
            setup_data_dir,
            clear_node_state,
            save_discovered_peers,
            check_binaries,
            try_upnp_port_map,
            get_app_version,
            check_network_reachable,
            get_system_info,
            // Wallet
            wallet_get_balance,
            wallet_new_address,
            wallet_list_addresses,
            wallet_send,
            wallet_transactions,
            wallet_set_path,
            list_wallet_files,
            get_wallet_info,
            delete_wallet_file,
            rename_wallet_file,
            wallet_create,
            wallet_import_mnemonic,
            wallet_import_wif,
            wallet_import_private_key,
            wallet_export_seed,
            wallet_export_mnemonic,
            wallet_backup,
            wallet_restore_backup,
            wallet_export_wif,
            wallet_read_wif,
            // Config / Settings
            set_wallet_config,
            save_settings,
            load_settings,
            detect_public_ip,
            // Offers
            offer_list,
            offer_show,
            offer_create,
            offer_take,
            offer_export,
            offer_import,
            offer_remove,
            // Feeds
            feed_add,
            feed_remove,
            feed_list,
            feed_sync,
            feed_fetch,
            feed_prune,
            // Agreements
            agreement_list,
            agreement_show,
            agreement_remove,
            agreement_create,
            agreement_pack,
            agreement_unpack,
            agreement_release,
            agreement_refund,
            // Proofs
            proof_list,
            proof_sign,
            proof_submit,
            proof_create_and_submit,
            // Reputation
            reputation_show,
            // Settlement templates
            settlement_create_otc,
            settlement_create_freelance,
            settlement_create_milestone,
            settlement_create_deposit,
            settlement_create_merchant_delayed,
            settlement_create_contractor,
            // Miner (CPU)
            start_miner,
            stop_miner,
            get_miner_status,
            update_tray_status,
            // Miner (GPU)
            list_gpu_devices,
            list_gpu_platforms,
            start_gpu_miner,
            stop_gpu_miner,
            get_gpu_miner_status,
            // Miner — block history
            get_found_blocks,
            // Stratum pool
            stratum_connect,
            stratum_disconnect,
            get_stratum_status,
            // RPC
            rpc_get_peers,
            rpc_get_mempool,
            rpc_get_block,
            rpc_get_tx,
            rpc_get_address,
            get_recent_blocks,
            get_network_hashrate,
            rpc_get_offers_feed,
            rpc_set_url,
            // Diagnostics
            run_diagnostics,
            // Update check (GUI app)
            check_for_updates,
            // Node source update check
            check_node_update,
            update_node_source,
            // Multisig
            multisig_create,
            multisig_broadcast,
            // Invoices
            invoice_generate,
            invoice_import,
            // Agreement eligibility & status
            agreement_release_eligibility,
            agreement_refund_eligibility,
            agreement_status,
            agreement_fund,
            // Policies
            policy_build_otc,
            policy_build_contractor,
            policy_build_preorder,
            agreement_policy_list,
            agreement_policy_evaluate,
            // Reputation actions
            reputation_record_outcome,
            reputation_export,
            reputation_import,
            reputation_self_trade_check,
            // Trade status
            seller_status,
            buyer_status,
            // Disputes
            agreement_dispute,
            agreement_dispute_list,
            // Network metrics
            get_network_metrics,
            // Explorer
            explorer_agreements,
            explorer_stats,
            // Explorer sidecar commands
            start_explorer_sidecar,
            get_explorer_stats,
            get_explorer_peers,
            get_explorer_blocks,
            // Feed ops
            offer_feed_discover,
            feed_bootstrap,
            // Agreement store / sign / verify
            agreement_local_store_list,
            agreement_sign_cmd,
            agreement_verify_signature,
            agreement_decrypt,
            // Logs
            get_node_logs,
        ])
        .build(tauri::generate_context!())
        .expect("error while running Irium Core")
        .run(|app_handle, event| {
            // On Windows, kill all node sidecars when the updater has finished
            // downloading the NSIS installer and is about to launch it. The
            // sidecars survive the Tauri process exit on Windows (they are not
            // true children of the GUI process), so NSIS cannot overwrite their
            // binaries without an explicit kill first.
            #[cfg(target_os = "windows")]
            if let tauri::RunEvent::Updater(
                tauri::UpdaterEvent::Downloaded,
            ) = &event
            {
                let state = app_handle.state::<AppState>();
                if let Ok(mut g) = state.node_process.lock() {
                    if let Some(child) = g.take() { let _ = child.kill(); }
                }
                if let Ok(mut g) = state.miner_process.lock() {
                    if let Some(child) = g.take() { let _ = child.kill(); }
                }
                if let Ok(mut g) = state.explorer_process.lock() {
                    if let Some(child) = g.take() { let _ = child.kill(); }
                }
                for name in [
                    "iriumd-x86_64-pc-windows-msvc.exe",
                    "irium-miner-x86_64-pc-windows-msvc.exe",
                    "irium-miner-gpu-x86_64-pc-windows-msvc.exe",
                    "irium-explorer-x86_64-pc-windows-msvc.exe",
                ] {
                    let _ = std::process::Command::new("taskkill")
                        .args(["/F", "/T", "/IM", name])
                        .output();
                }
                std::thread::sleep(std::time::Duration::from_millis(1500));
            }
        });
}
