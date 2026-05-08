// Irium Core GUI - Tauri Backend
// RPC: 127.0.0.1:38300 | P2P: 38291 | Amounts: satoshis (1 IRM = 100,000,000 sats)
// Addresses: Q/P prefix Base58Check | Node data dir: ~/.irium

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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
    rpc_url: Arc<Mutex<String>>,
    wallet_path: Arc<Mutex<Option<String>>>,
    data_dir: Arc<Mutex<Option<String>>>,
    miner_start_time: Arc<Mutex<Option<std::time::Instant>>>,
    miner_address: Arc<Mutex<Option<String>>>,
    miner_threads: Arc<Mutex<u32>>,
    miner_hashrate: Arc<Mutex<f64>>,
    last_node_status: Arc<Mutex<Option<NodeStatus>>>,
    pool_url: Arc<Mutex<Option<String>>>,
}

impl AppState {
    fn new() -> Self {
        AppState {
            node_process: Arc::new(Mutex::new(None)),
            miner_process: Arc::new(Mutex::new(None)),
            rpc_url: Arc::new(Mutex::new("http://127.0.0.1:38300".to_string())),
            wallet_path: Arc::new(Mutex::new(None)),
            data_dir: Arc::new(Mutex::new(None)),
            miner_start_time: Arc::new(Mutex::new(None)),
            miner_address: Arc::new(Mutex::new(None)),
            miner_threads: Arc::new(Mutex::new(0)),
            miner_hashrate: Arc::new(Mutex::new(0.0)),
            last_node_status: Arc::new(Mutex::new(None)),
            pool_url: Arc::new(Mutex::new(None)),
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
            u.starts_with("kh/s") || u.starts_with("khs") ||
            u.starts_with("h/s") || u.starts_with("hs")
        });
    if let Some((val_str, unit)) = re_pat {
        if let Ok(val) = val_str.trim_end_matches(',').parse::<f64>() {
            let u = unit.to_lowercase();
            if u.starts_with("kh") {
                return Some(val);
            } else {
                return Some(val / 1000.0);
            }
        }
    }
    // Fallback: find any number adjacent to kH/s in the line
    let lower = line.to_lowercase();
    if let Some(pos) = lower.find("kh/s") {
        let before = &line[..pos].trim_end();
        if let Some(num_str) = before.split_whitespace().last() {
            if let Ok(v) = num_str.trim_end_matches(',').parse::<f64>() {
                return Some(v);
            }
        }
    }
    None
}

fn get_binary_name(name: &str) -> String {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    match (os, arch) {
        ("windows", "x86_64") => format!("{}-x86_64-pc-windows-msvc.exe", name),
        ("linux",   "x86_64") => format!("{}-x86_64-unknown-linux-gnu", name),
        ("linux",   "aarch64") => format!("{}-aarch64-unknown-linux-gnu", name),
        ("macos",   "x86_64") => format!("{}-x86_64-apple-darwin", name),
        ("macos",   "aarch64") => format!("{}-aarch64-apple-darwin", name),
        _ => format!("{}-x86_64-unknown-linux-gnu", name),
    }
}

fn lock_err(e: impl std::fmt::Display) -> String {
    format!("Lock error: {}", e)
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

async fn run_wallet_cmd(
    args: Vec<String>,
    _wallet_path: Option<String>,
    _data_dir: Option<String>,
) -> Result<String, String> {
    let full_args = args;

    let cmd = Command::new_sidecar("irium-wallet")
        .map_err(|e| format!("irium-wallet sidecar not found: {}. Place binary in src-tauri/binaries/", e))?
        .args(&full_args);

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

// ============================================================
// NODE MANAGEMENT
// ============================================================

#[tauri::command]
async fn start_node(
    state: State<'_, AppState>,
    data_dir: Option<String>,
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

    // Refresh bootstrap / seed files before starting.
    let _ = setup_data_dir().await;

    let mut args = vec!["--http-rpc".to_string()];
    if let Some(dir) = &data_dir {
        args.push("--data-dir".to_string());
        args.push(dir.clone());
    }

    let home_dir = dirs::home_dir().unwrap_or_default();
    let irium_dir = home_dir.join(".irium");

    // Pass configuration via env vars (verified against real iriumd source code).
    let mut node_env = HashMap::new();
    node_env.insert("IRIUM_DATA_DIR".to_string(), irium_dir.to_string_lossy().to_string());
    // Allow unsigned seedlist in case our extra seeds break the original signature.
    node_env.insert("IRIUM_SEEDLIST_ALLOW_UNSIGNED".to_string(), "1".to_string());
    // Promote peers to the runtime seedlist after 1 day seen (default is 2 days, too slow for new nodes).
    node_env.insert("IRIUM_RUNTIME_SEED_DAYS".to_string(), "1".to_string());
    // Keep at least 8 peers in the runtime seedlist.
    node_env.insert("IRIUM_RUNTIME_SEED_MIN_COUNT".to_string(), "8".to_string());
    // Treat peers as stale only after 30 days without contact (keeps known nodes around longer).
    node_env.insert("IRIUM_PEER_STALE_DIALABLE_HOURS".to_string(), "720".to_string());

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
                    let mut proc_lock = state.node_process.lock().map_err(lock_err)?;
                    *proc_lock = Some(child);
                    tauri::async_runtime::spawn(async move {
                        while let Some(event) = rx.recv().await {
                            match event {
                                CommandEvent::Stdout(line) => tracing::info!("[iriumd] {}", line),
                                CommandEvent::Stderr(line) => tracing::warn!("[iriumd stderr] {}", line),
                                _ => break,
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
    // Also kill any externally-started iriumd process (handles nodes started outside the GUI)
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/IM", "iriumd-x86_64-pc-windows-msvc.exe"])
            .output();
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/IM", "iriumd.exe"])
            .output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("pkill")
            .args(["-f", "iriumd"])
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
            .args(["/F", "/IM", "iriumd-x86_64-pc-windows-msvc.exe"])
            .output();
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/IM", "iriumd.exe"])
            .output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("pkill").args(["-f", "iriumd"]).output();
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

    // Repair: remove seedlist.txt written with old broken multiaddr/IP:PORT format.
    let seedlist_path = bootstrap_dir.join("seedlist.txt");
    if seedlist_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&seedlist_path) {
            if content.contains("\\ip4\\") || content.contains("\\tcp\\")
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

// get_node_status: fully decentralized — reads only from the local node's RPC.
// The network tip comes from best_header_tip, which iriumd learns from its peers
// via P2P gossip. No external HTTP calls to hardcoded IPs.
#[tauri::command]
async fn get_node_status(state: State<'_, AppState>) -> Result<NodeStatus, String> {
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    match get_rpc_info(&rpc_url).await {
        Ok(info) => {
            let tip = info.best_header_tip.as_ref()
                .map(|t| t.hash.clone())
                .unwrap_or_default();
            // network_tip is what the node's peers told it via P2P — no external calls.
            let network_tip = info.best_header_tip.as_ref()
                .map(|t| t.height)
                .unwrap_or(0);
            let local_height = info.height.unwrap_or(0);
            let peers = info.peer_count.unwrap_or(0);

            // Synced only when: anchor loaded, at least one peer, peers have told us
            // the network tip (network_tip > 0), and we're within 10 blocks of it.
            // This prevents false "At chain tip" when the node has no peers yet.
            let synced = info.anchor_loaded.unwrap_or(false)
                && peers > 0
                && network_tip > 0
                && local_height >= network_tip.saturating_sub(10);

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
            };
            *state.last_node_status.lock().map_err(lock_err)? = Some(status.clone());
            Ok(status)
        }
        Err(_) => {
            // RPC not reachable — node is offline
            *state.last_node_status.lock().map_err(lock_err)? = None;
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

// wallet_list_addresses: list-addresses outputs one address per line (no JSON flag)
#[tauri::command]
async fn wallet_list_addresses(state: State<'_, AppState>) -> Result<Vec<AddressInfo>, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let output = run_wallet_cmd(vec!["list-addresses".to_string()], wallet_path, data_dir).await?;

    let addresses = output
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .map(|address| AddressInfo { address, label: None, balance: None, index: None })
        .collect();

    Ok(addresses)
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
) -> Result<Vec<Transaction>, String> {
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

    let client = reqwest::Client::new();
    let mut all_txs: Vec<Transaction> = Vec::new();

    for addr in &addresses {
        let url = format!("{}/rpc/history?address={}", rpc_url, addr);
        if let Ok(resp) = client.get(&url).timeout(Duration::from_secs(10)).send().await {
            if let Ok(history) = resp.json::<RpcHistoryResponse>().await {
                let current_height = history.height;
                for tx in history.txs {
                    let confirmations = match tx.height {
                        Some(h) if h >= 0 => current_height.saturating_sub(h as u64),
                        _ => 0,
                    };
                    let direction = if tx.is_coinbase.unwrap_or(false) {
                        "receive"
                    } else {
                        "receive"
                    };
                    all_txs.push(Transaction {
                        txid: tx.txid,
                        amount: tx.output_value.unwrap_or(0) as i64,
                        fee: None,
                        confirmations,
                        timestamp: None,
                        direction: direction.to_string(),
                        address: Some(addr.clone()),
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

// wallet_create: runs `irium-wallet create-wallet --bip32` and parses output
//
// Verified stdout format:
//   BIP32 wallet created
//   mnemonic: advice knee story boss tent velvet voyage twelve grid rural reward inch ...
//   derivation path: m/44'/1'/0'/0/0
//   IMPORTANT: write down your mnemonic -- it cannot be recovered
//   address: Q9WtU4CsQ6vkfMsjiz3reN4AneHmf14HtF
//   wallet /home/user/.irium/wallet.json
#[tauri::command]
async fn wallet_create(state: State<'_, AppState>) -> Result<WalletCreateResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();

    let output = run_wallet_cmd(
        vec!["create-wallet".to_string(), "--bip32".to_string()],
        wallet_path,
        data_dir,
    ).await?;

    let mut mnemonic = String::new();
    let mut address = String::new();

    for line in output.lines() {
        if let Some(rest) = line.strip_prefix("mnemonic: ") {
            mnemonic = rest.trim().to_string();
        } else if let Some(rest) = line.strip_prefix("address: ") {
            address = rest.trim().to_string();
        }
    }

    if mnemonic.is_empty() || address.is_empty() {
        return Err(format!(
            "Failed to parse wallet creation output: {}",
            &output[..output.len().min(400)]
        ));
    }

    Ok(WalletCreateResult { mnemonic, address })
}

// wallet_import_mnemonic: runs `irium-wallet import-mnemonic "<24 words>"`
#[tauri::command]
async fn wallet_import_mnemonic(
    state: State<'_, AppState>,
    words: String,
) -> Result<bool, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();

    run_wallet_cmd(
        vec!["import-mnemonic".to_string(), words],
        wallet_path,
        data_dir,
    ).await?;

    Ok(true)
}

// wallet_import_wif: runs `irium-wallet import-wif "<WIF key>"`
#[tauri::command]
async fn wallet_import_wif(
    state: State<'_, AppState>,
    wif: String,
) -> Result<bool, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();

    run_wallet_cmd(
        vec!["import-wif".to_string(), wif],
        wallet_path,
        data_dir,
    ).await?;

    Ok(true)
}

// wallet_import_private_key: runs `irium-wallet import-private-key "<hex key>"`
#[tauri::command]
async fn wallet_import_private_key(
    state: State<'_, AppState>,
    hex_key: String,
) -> Result<bool, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();

    run_wallet_cmd(
        vec!["import-private-key".to_string(), hex_key],
        wallet_path,
        data_dir,
    ).await?;

    Ok(true)
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

    // Need seller address and timeout height
    let seller = get_first_wallet_address(wallet_path.clone(), data_dir.clone()).await?;
    let height = get_current_height(&rpc_url).await;
    let timeout = height + 1000;

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
) -> Result<OfferTakeResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    let buyer = get_first_wallet_address(wallet_path.clone(), data_dir.clone()).await?;

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
    run_wallet_cmd(
        vec!["offer-export".to_string(), "--offer".to_string(), offer_id, "--out".to_string(), out_path],
        wallet_path, data_dir,
    ).await?;
    Ok(true)
}

#[tauri::command]
async fn offer_import(state: State<'_, AppState>, file_path: String) -> Result<bool, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    run_wallet_cmd(
        vec!["offer-import".to_string(), "--file".to_string(), file_path],
        wallet_path, data_dir,
    ).await?;
    Ok(true)
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
    run_wallet_cmd(
        vec!["agreement-pack".to_string(), "--agreement".to_string(), agreement_id, "--out".to_string(), out_path],
        wallet_path, data_dir,
    ).await?;
    Ok(true)
}

#[tauri::command]
async fn agreement_unpack(state: State<'_, AppState>, file_path: String) -> Result<Agreement, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    // agreement-unpack --file <path> --json (not agreement-bundle-inspect)
    let output = run_wallet_cmd(
        vec!["agreement-unpack".to_string(), "--file".to_string(), file_path, "--json".to_string()],
        wallet_path, data_dir,
    ).await?;
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
) -> Result<ReleaseResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let output = run_wallet_cmd_with_rpc(
        vec!["agreement-release".to_string(), agreement_id, "--json".to_string()],
        wallet_path, data_dir, rpc_url,
    ).await?;
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
) -> Result<ReleaseResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let output = run_wallet_cmd_with_rpc(
        vec!["agreement-refund".to_string(), agreement_id, "--json".to_string()],
        wallet_path, data_dir, rpc_url,
    ).await?;
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
    run_wallet_cmd(
        vec![
            "proof-sign".to_string(),
            "--agreement".to_string(), agreement_id,
            "--message".to_string(), proof_data,
            "--out".to_string(), out_path,
        ],
        wallet_path, data_dir,
    ).await?;
    Ok(true)
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

    let actual_path = if proof_json.get("proof_id").is_none() {
        if let Some(obj) = proof_json.as_object_mut() {
            obj.insert("proof_id".to_string(), serde_json::Value::String(agreement_id.clone()));
        }
        let id_slug: String = agreement_id.chars().take(16).filter(|c| c.is_alphanumeric() || *c == '-').collect();
        let tmp_path = std::env::temp_dir().join(format!("irium_proof_{}.json", id_slug));
        std::fs::write(&tmp_path, serde_json::to_string_pretty(&proof_json).unwrap_or(file_content))
            .map_err(|e| format!("Cannot write temp proof file: {}", e))?;
        tmp_path.to_string_lossy().to_string()
    } else {
        proof_file
    };

    let output = run_wallet_cmd_with_rpc(
        vec![
            "agreement-proof-submit".to_string(),
            "--proof".to_string(), actual_path,
            "--json".to_string(),
        ],
        wallet_path, data_dir, rpc_url,
    ).await?;
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

// ============================================================
// MINER
// ============================================================

#[tauri::command]
async fn start_miner(
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
    miner_env.insert("IRIUM_NODE_RPC".to_string(), rpc_url);

    let cmd = Command::new_sidecar("irium-miner")
        .map_err(|e| format!("irium-miner not found: {}", e))?
        .envs(miner_env)
        .args(&args)
        .current_dir(irium_dir);

    let (mut rx, child) = cmd.spawn().map_err(|e| format!("Failed to start miner: {}", e))?;
    let hashrate_ref = Arc::clone(&state.miner_hashrate);
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            let line = match event {
                CommandEvent::Stdout(l) => { tracing::info!("[irium-miner] {}", l); l }
                CommandEvent::Stderr(l) => { tracing::warn!("[irium-miner stderr] {}", l); l }
                _ => break,
            };
            if let Some(khs) = parse_hashrate_khs(&line) {
                if let Ok(mut h) = hashrate_ref.lock() { *h = khs; }
            }
        }
    });
    *miner_lock = Some(child);
    *state.miner_start_time.lock().map_err(lock_err)? = Some(std::time::Instant::now());
    *state.miner_address.lock().map_err(lock_err)? = Some(address);
    *state.miner_threads.lock().map_err(lock_err)? = threads.unwrap_or(1);
    Ok(true)
}

#[tauri::command]
async fn stop_miner(state: State<'_, AppState>) -> Result<bool, String> {
    let mut miner_lock = state.miner_process.lock().map_err(lock_err)?;
    if let Some(child) = miner_lock.take() {
        child.kill().map_err(|e| e.to_string())?;
        drop(miner_lock);
        *state.miner_start_time.lock().map_err(lock_err)? = None;
        *state.miner_address.lock().map_err(lock_err)? = None;
        *state.miner_threads.lock().map_err(lock_err)? = 0;
        *state.miner_hashrate.lock().map_err(lock_err)? = 0.0;
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

    Ok(MinerStatus {
        running,
        hashrate_khs,
        blocks_found: 0,
        uptime_secs,
        difficulty: 0,
        threads,
        address,
    })
}

// ============================================================
// GPU MINER
// ============================================================

#[tauri::command]
async fn list_gpu_devices() -> Result<Vec<GpuDevice>, String> {
    // irium-miner GPU enumeration is not exposed via CLI; return empty list
    Ok(vec![])
}

#[tauri::command]
async fn start_gpu_miner(
    state: State<'_, AppState>,
    address: String,
    device_index: u32,
    intensity: u32,
) -> Result<bool, String> {
    let mut miner_lock = state.miner_process.lock().map_err(lock_err)?;
    if miner_lock.is_some() {
        return Err("Miner already running — stop it first".to_string());
    }
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let home_dir = dirs::home_dir().unwrap_or_default();
    let irium_dir = home_dir.join(".irium");

    let mut env = HashMap::new();
    env.insert("IRIUM_MINER_ADDRESS".to_string(), address.clone());
    env.insert("IRIUM_RPC_URL".to_string(), rpc_url.clone());
    env.insert("IRIUM_NODE_RPC".to_string(), rpc_url);
    env.insert("IRIUM_GPU_DEVICE".to_string(), device_index.to_string());
    env.insert("IRIUM_GPU_INTENSITY".to_string(), intensity.to_string());
    env.insert("IRIUM_MINER_GPU".to_string(), "1".to_string());

    let (mut rx, child) = Command::new_sidecar("irium-miner")
        .map_err(|e| format!("irium-miner not found: {}", e))?
        .envs(env)
        .args(&["--gpu"])
        .current_dir(irium_dir)
        .spawn()
        .map_err(|e| format!("Failed to start GPU miner: {}", e))?;

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
    *miner_lock = Some(child);
    *state.miner_start_time.lock().map_err(lock_err)? = Some(std::time::Instant::now());
    *state.miner_address.lock().map_err(lock_err)? = Some(address);
    Ok(true)
}

#[tauri::command]
async fn stop_gpu_miner(state: State<'_, AppState>) -> Result<bool, String> {
    stop_miner(state).await
}

#[tauri::command]
async fn get_gpu_miner_status(state: State<'_, AppState>) -> Result<GpuMinerStatus, String> {
    let running = state.miner_process.lock().map_err(lock_err)?.is_some();
    let hashrate_khs = *state.miner_hashrate.lock().map_err(lock_err)?;
    Ok(GpuMinerStatus { running, hashrate_khs, blocks_found: 0, device_name: None, temperature_c: None, power_w: None })
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
    env.insert("IRIUM_POOL_URL".to_string(), pool_url.clone());
    env.insert("IRIUM_POOL_WORKER".to_string(), worker.clone());
    env.insert("IRIUM_POOL_PASS".to_string(), password);
    env.insert("IRIUM_STRATUM_URL".to_string(), pool_url.clone());
    env.insert("IRIUM_WORKER".to_string(), worker.clone());

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
async fn stratum_disconnect(state: State<'_, AppState>) -> Result<bool, String> {
    *state.pool_url.lock().map_err(lock_err)? = None;
    stop_miner(state).await
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
// CONFIG / SETTINGS
// ============================================================

#[tauri::command]
async fn set_wallet_config(
    state: State<'_, AppState>,
    wallet_path: Option<String>,
    data_dir: Option<String>,
) -> Result<bool, String> {
    *state.wallet_path.lock().map_err(lock_err)? = wallet_path;
    *state.data_dir.lock().map_err(lock_err)? = data_dir;
    Ok(true)
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
const RELEASES_API: &str = "https://api.github.com/repos/iriumlabs/irium-core-gui/releases/latest";

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
            Ok(())
        })
        .system_tray(system_tray)
        .on_system_tray_event(|app, event| {
            use tauri::SystemTrayEvent;
            match event {
                SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
                    "show" => {
                        if let Some(window) = app.get_window("main") {
                            window.show().unwrap();
                            window.set_focus().unwrap();
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
                event.window().hide().unwrap();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            // Node
            start_node,
            stop_node,
            get_node_status,
            setup_data_dir,
            clear_node_state,
            save_discovered_peers,
            check_binaries,
            // Wallet
            wallet_get_balance,
            wallet_new_address,
            wallet_list_addresses,
            wallet_send,
            wallet_transactions,
            wallet_set_path,
            wallet_create,
            wallet_import_mnemonic,
            wallet_import_wif,
            wallet_import_private_key,
            // Config / Settings
            set_wallet_config,
            save_settings,
            load_settings,
            // Offers
            offer_list,
            offer_show,
            offer_create,
            offer_take,
            offer_export,
            offer_import,
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
            agreement_create,
            agreement_pack,
            agreement_unpack,
            agreement_release,
            agreement_refund,
            // Proofs
            proof_list,
            proof_sign,
            proof_submit,
            // Reputation
            reputation_show,
            // Settlement templates
            settlement_create_otc,
            settlement_create_freelance,
            settlement_create_milestone,
            settlement_create_deposit,
            // Miner (CPU)
            start_miner,
            stop_miner,
            get_miner_status,
            // Miner (GPU)
            list_gpu_devices,
            start_gpu_miner,
            stop_gpu_miner,
            get_gpu_miner_status,
            // Stratum pool
            stratum_connect,
            stratum_disconnect,
            get_stratum_status,
            // RPC
            rpc_get_peers,
            rpc_get_mempool,
            rpc_get_block,
            rpc_get_offers_feed,
            rpc_set_url,
            // Diagnostics
            run_diagnostics,
            // Update check
            check_for_updates,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Irium Core");
}
