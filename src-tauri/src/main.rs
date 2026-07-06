// Irium Core GUI - Tauri Backend
// RPC: 127.0.0.1:38300 | P2P: 38291 | Amounts: satoshis (1 IRM = 100,000,000 sats)
// Addresses: Q/P prefix Base58Check | Node data dir: ~/.irium

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{Manager, SystemTray, SystemTrayMenu, SystemTrayMenuItem, CustomMenuItem, State};
use tauri::api::path::app_data_dir;
use tauri::api::process::{Command, CommandChild, CommandEvent};
use dirs;

mod types;
use types::*;
use std::collections::{HashMap, VecDeque};

// ============================================================
// STATE
// ============================================================

// BUG 1 (tab-correct miner status): start_miner and start_gpu_miner
// both spawn into the same state.miner_process slot (only one miner
// runs at a time by design). Without a discriminator, both
// get_miner_status and get_gpu_miner_status returned running=true
// whenever EITHER kind was active. The CPU tab in the GUI then
// rendered "Mining Active — Syncing blocks" + the warmup banner even
// when only the GPU miner was running. miner_kind tags the active
// slot so each get_*_status command can return a truthful per-kind
// running flag.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MinerKind { Cpu, Gpu }

struct AppState {
    node_process: Arc<Mutex<Option<CommandChild>>>,
    miner_process: Arc<Mutex<Option<CommandChild>>>,
    // BUG 1: which miner currently owns miner_process. Set together
    // with miner_process on spawn success, cleared together in
    // stop_miner and in each spawn loop's Terminated branch.
    miner_kind: Arc<Mutex<Option<MinerKind>>>,
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
    // FIX 1 (UPnP): flips true when the router reports back an
    // external IP that is itself RFC1918 / RFC6598 (CGNAT) / link-local
    // / loopback. The mapping technically "succeeded" but the IP is not
    // reachable from the public internet - the user is double-NAT'd.
    // We surface this distinctly in the UI: "Inactive (double NAT)"
    // instead of the misleading "Active" state.
    upnp_double_nat: Arc<Mutex<bool>>,
    // FIX 1 (UPnP): last-attempt diagnostic snapshot exposed via the
    // new upnp_diagnostics Tauri command so the Help page can show the
    // user exactly which adapter/gateway/external-IP path the SOAP
    // dance took (and what failed). Self-diagnosable.
    upnp_diagnostics: Arc<Mutex<UpnpDiagnostics>>,
    node_logs: Arc<Mutex<Vec<String>>>,
    // Bug 1 fix — cumulative blocks-found counter and the most-recent
    // entries list, populated by the miner spawn loops as they parse
    // block-accept / block-mined lines from the sidecar's stdout. Both
    // accumulate across miner stop/start within a single GUI session;
    // they reset only when the app restarts.
    blocks_found: Arc<Mutex<u64>>,
    found_blocks: Arc<Mutex<Vec<FoundBlock>>>,
    gpu_temperature_c: Arc<Mutex<Option<f64>>>,
    gpu_power_w: Arc<Mutex<Option<f64>>>,
    // C-10 fix: cumulative stratum share counters, populated by the
    // stratum_connect spawn loop as it parses `[stratum] share accepted`
    // (stdout) and `[stratum] share rejected: <reason>` (stderr) lines
    // emitted by irium-miner.rs:stratum_reader (v1.9.13+). Reset to 0 on
    // every stratum_connect so a new pool session starts at zero.
    stratum_shares_accepted: Arc<Mutex<u64>>,
    stratum_shares_rejected: Arc<Mutex<u64>>,
    // FIX 4 (Mining UI): unix seconds of last accepted share, set by
    // the stratum spawn loop when a `[stratum] share accepted` line
    // is parsed. Surfaced through StratumStatus.last_share_time so
    // the Miner page can render "12s ago" with a freshness pulse.
    stratum_last_share_time: Arc<Mutex<Option<u64>>>,
    // Phase 1A: ring buffer of recent stratum events (last 10) for the
    // Stratum-tab "Recent Activity" card. Bounded VecDeque — newest at the
    // front, oldest popped when len >= STRATUM_EVENT_RING_CAP. Reset to
    // empty on every stratum_connect alongside the share counters. No
    // persistence: this is purely an in-session UX surface.
    stratum_recent_events: Arc<Mutex<VecDeque<StratumEvent>>>,
    // 30 s in-memory cache for pool.iriumlabs.org:3337/stats lookups
    // (asic.current_diff + aggregate hashrate). Shared by
    // get_stratum_status, which polls every 5 s — caching keeps the p99
    // poll latency ~0 ms inside the window instead of paying the proxy's
    // 2 s timeout budget. Proxy values don't change on sub-30s timescales
    // so the staleness is invisible. None until the first successful
    // fetch; entries are overwritten in place on cache miss/expiry.
    pool_stats_cache: Arc<Mutex<Option<PoolStatsCacheEntry>>>,
    // TASK 3: distinguishes a user-initiated `stop_miner` call from an
    // unexpected termination (macOS GPU watchdog kill, OOM, segfault, etc).
    // start_miner / start_gpu_miner reset to false on entry; stop_miner
    // flips to true immediately before sending SIGTERM. The Terminated
    // event handler reads this — false → emit a "miner-exited-unexpectedly"
    // Tauri event so the GUI can offer a Restart Miner banner.
    miner_user_initiated_stop: Arc<Mutex<bool>>,
    // FIX #126: in-memory pending-tx cache keyed by txid. Populated by
    // wallet_send immediately after broadcast, before iriumd has
    // mined the tx into a block. Surfaced through
    // wallet_pending_transactions and inline-merged into
    // wallet_transactions so the UI shows the outgoing tx as
    // "Pending - awaiting confirmation" the instant the user clicks
    // Send. Culled lazily inside wallet_transactions when the txid
    // shows up in confirmed /rpc/history results. Lost on app
    // restart - acceptable since the user's broadcasting wallet
    // re-populates by simply repeating the send (or just waits for
    // confirmation if iriumd already accepted it).
    pending_txs: Arc<Mutex<HashMap<String, Transaction>>>,
    // FIX 2 (IRIUM_RPC_TOKEN): user-supplied Bearer token. Hydrated
    // from settings JSON on save/load. When Some, the GUI's reqwest
    // calls use this in `Authorization: Bearer <token>`; when None,
    // they fall back to the auto-minted local token (RPC_TOKEN). The
    // local iriumd / wallet sidecars are spawned with the auto-minted
    // token regardless — this Mutex only affects outbound GUI HTTP
    // (so a user pointing at a remote iriumd in FIX 3 can present the
    // remote node's token without breaking local handshake).
    rpc_token_override: Arc<Mutex<Option<String>>>,
    // FIX 3 (Remote node): "local" → spawn bundled iriumd as before;
    // "remote" → skip sidecar spawn, talk to whatever rpc_url points
    // at. Hydrated from settings JSON on save/load; default "local".
    node_mode: Arc<Mutex<String>>,
    // Solo Stratum bridge — distinct from miner_process so the user can
    // run an ASIC-bridge listener (--solo-stratum) while also running a
    // local CPU/GPU miner. listen address recorded for status display.
    solo_stratum_process: Arc<Mutex<Option<CommandChild>>>,
    solo_stratum_listen: Arc<Mutex<Option<String>>>,
}

#[derive(Clone)]
struct PoolStatsCacheEntry {
    fetched_at_unix: u64,
    pool_diff: Option<u64>,
    pool_hashrate_khs: Option<f64>,
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
            miner_kind: Arc::new(Mutex::new(None)),
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
            upnp_double_nat: Arc::new(Mutex::new(false)),
            upnp_diagnostics: Arc::new(Mutex::new(UpnpDiagnostics::default())),
            node_logs: Arc::new(Mutex::new(Vec::new())),
            blocks_found: Arc::new(Mutex::new(0)),
            found_blocks: Arc::new(Mutex::new(Vec::new())),
            gpu_temperature_c: Arc::new(Mutex::new(None)),
            gpu_power_w: Arc::new(Mutex::new(None)),
            stratum_shares_accepted: Arc::new(Mutex::new(0)),
            stratum_shares_rejected: Arc::new(Mutex::new(0)),
            stratum_last_share_time: Arc::new(Mutex::new(None)),
            stratum_recent_events: Arc::new(Mutex::new(VecDeque::with_capacity(STRATUM_EVENT_RING_CAP))),
            pool_stats_cache: Arc::new(Mutex::new(None)),
            miner_user_initiated_stop: Arc::new(Mutex::new(false)),
            pending_txs: Arc::new(Mutex::new(HashMap::new())),
            rpc_token_override: Arc::new(Mutex::new(None)),
            node_mode: Arc::new(Mutex::new("local".to_string())),
            solo_stratum_process: Arc::new(Mutex::new(None)),
            solo_stratum_listen: Arc::new(Mutex::new(None)),
        }
    }
}

// ============================================================
// LOCAL RPC TOKEN
//
// Generated on first launch and persisted to <app_data_dir>/rpc_token.txt.
// Once iriumd's RPC port is bound to 0.0.0.0 (so peers can reach
// /offers/feed) every privileged endpoint must be guarded by a token
// shared between iriumd and the wallet sidecar — without this, opening
// the bind would expose wallet RPC to anyone on the LAN.
//
// Both iriumd and the wallet binary read IRIUM_RPC_TOKEN from their env
// and use the standard Bearer-token scheme. The GUI's own reqwest calls
// only hit endpoints behind check_rate_with_auth (rate-limited but
// unauthenticated path remains valid), so they continue to work without
// being updated; the auth gate fires only on require_rpc_auth endpoints,
// which the wallet sidecar handles.
// ============================================================

static RPC_TOKEN: OnceLock<String> = OnceLock::new();

// FIX 2 (IRIUM_RPC_TOKEN): builds the Bearer token the GUI presents
// on outbound RPC calls. Precedence:
//   1. user-supplied token from settings (rpc_token_override) — used
//      when GUI talks to a remote iriumd whose token is not on local
//      disk;
//   2. auto-minted local token (RPC_TOKEN) — used by default in local
//      mode so requests against the bundled iriumd work zero-config.
// Returns None only when neither is available (very early startup
// before init_rpc_token has run); call sites tolerate this — the
// request goes out without an Authorization header and iriumd's
// unauthenticated paths still respond.
fn gui_rpc_bearer(state: &AppState) -> Option<String> {
    if let Ok(g) = state.rpc_token_override.lock() {
        if let Some(t) = g.clone() {
            let trimmed = t.trim().to_string();
            if !trimmed.is_empty() {
                return Some(trimmed);
            }
        }
    }
    RPC_TOKEN.get().cloned()
}

// FIX 2 (IRIUM_RPC_TOKEN): drop-in replacement for
// `reqwest::Client::new()` that attaches an `Authorization: Bearer`
// default header so every privileged RPC endpoint (wallet balance,
// send, fee_estimate, etc.) authenticates correctly — both against
// the local sidecar and against a remote iriumd (FIX 3). Built per
// call rather than cached because the token can change at runtime
// when the user edits settings. Falls back to a plain Client if
// header construction fails (the token must be ASCII; auto-minted
// tokens are 32 hex chars, so the fallback is only for malformed
// user-supplied tokens — we still want a working client in that
// case so the GUI surfaces an HTTP error, not a Tauri error).
fn rpc_client_with_token(token: Option<String>) -> reqwest::Client {
    if let Some(t) = token {
        let mut headers = reqwest::header::HeaderMap::new();
        if let Ok(val) = reqwest::header::HeaderValue::from_str(&format!("Bearer {}", t)) {
            headers.insert(reqwest::header::AUTHORIZATION, val);
            if let Ok(client) = reqwest::Client::builder()
                .default_headers(headers)
                .build()
            {
                return client;
            }
        }
    }
    reqwest::Client::new()
}

fn rpc_client(state: &AppState) -> reqwest::Client {
    rpc_client_with_token(gui_rpc_bearer(state))
}

// Same as rpc_client but with a caller-supplied builder so callers
// that need timeouts (start_node's connectivity check, update probes,
// etc.) can keep their tuning while still getting authentication.
fn rpc_client_builder(state: &AppState) -> reqwest::ClientBuilder {
    let mut builder = reqwest::Client::builder();
    if let Some(token) = gui_rpc_bearer(state) {
        let mut headers = reqwest::header::HeaderMap::new();
        if let Ok(val) = reqwest::header::HeaderValue::from_str(&format!("Bearer {}", token)) {
            headers.insert(reqwest::header::AUTHORIZATION, val);
            builder = builder.default_headers(headers);
        }
    }
    builder
}

// Snapshot the current bearer token from a long-lived Arc reference —
// for spawned closures that can't carry `State<AppState>` across
// .await points. The miner spawn loop in start_miner captures this
// Arc so reward-fetching calls can re-resolve the live token on each
// retry (the user could have edited the rpc_token in settings between
// the block-found event and the +13s retry).
fn snapshot_gui_rpc_bearer(
    rpc_token_override: &Arc<Mutex<Option<String>>>,
) -> Option<String> {
    if let Ok(g) = rpc_token_override.lock() {
        if let Some(t) = g.clone() {
            let trimmed = t.trim().to_string();
            if !trimmed.is_empty() {
                return Some(trimmed);
            }
        }
    }
    RPC_TOKEN.get().cloned()
}

// FIX 2 + 3: extract rpc_token / node_mode / rpc_url out of the
// opaque settings JSON the frontend writes, and mirror them into
// AppState. Called from load_settings on launch + save_settings on
// every user save so AppState always reflects the current settings.
fn hydrate_settings_into_state(state: &AppState, settings_json: &str) {
    let parsed: serde_json::Value = match serde_json::from_str(settings_json) {
        Ok(v) => v,
        Err(_) => return,
    };
    if let Some(t) = parsed.get("rpc_token").and_then(|v| v.as_str()) {
        let trimmed = t.trim();
        if let Ok(mut g) = state.rpc_token_override.lock() {
            *g = if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            };
        }
    } else if let Ok(mut g) = state.rpc_token_override.lock() {
        *g = None;
    }
    if let Some(m) = parsed.get("node_mode").and_then(|v| v.as_str()) {
        if m == "remote" || m == "local" {
            if let Ok(mut g) = state.node_mode.lock() {
                *g = m.to_string();
            }
        }
    }
    // FIX 3: in remote mode the rpc_url from settings overrides the
    // default 127.0.0.1:38300. In local mode start_node writes its
    // own rpc_url so we leave whatever's there.
    let mode = state
        .node_mode
        .lock()
        .ok()
        .map(|g| g.clone())
        .unwrap_or_else(|| "local".to_string());
    if mode == "remote" {
        if let Some(u) = parsed.get("rpc_url").and_then(|v| v.as_str()) {
            let trimmed = u.trim();
            if !trimmed.is_empty() {
                if let Ok(mut g) = state.rpc_url.lock() {
                    *g = trimmed.to_string();
                }
            }
        }
    }
}

fn init_rpc_token(app_data_dir: &Path) -> String {
    let token_path = app_data_dir.join("rpc_token.txt");
    if let Ok(t) = std::fs::read_to_string(&token_path) {
        let trimmed = t.trim().to_string();
        if !trimmed.is_empty() { return trimmed; }
    }
    // 16 random bytes -> 32 hex chars. getrandom uses the OS entropy
    // source (BCryptGenRandom on Windows, /dev/urandom on Linux/Mac).
    // If the OS RNG truly fails, fall back to time+pid; this token only
    // gates LAN-side access, not crypto, so the fallback is acceptable
    // for the rare failure case.
    let mut buf = [0u8; 16];
    if getrandom::getrandom(&mut buf).is_err() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let pid = std::process::id() as u128;
        let mixed = now ^ (pid << 64);
        buf.copy_from_slice(&mixed.to_le_bytes());
    }
    let token: String = buf.iter().map(|b| format!("{:02x}", b)).collect();
    let _ = std::fs::create_dir_all(app_data_dir);
    let _ = std::fs::write(&token_path, &token);
    token
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

// Phase 1A: max entries kept in the AppState.stratum_recent_events ring
// buffer surfaced to the Stratum-tab "Recent Activity" card. Bounded so
// the buffer stays cheap to clone on each 5 s get_stratum_status poll.
const STRATUM_EVENT_RING_CAP: usize = 10;

/// Push a stratum event to the front of the ring buffer, dropping the
/// oldest when the buffer reaches STRATUM_EVENT_RING_CAP. Lock-poison
/// silent — events are best-effort UX, not safety-critical.
fn push_stratum_event(
    ring: &Arc<Mutex<VecDeque<StratumEvent>>>,
    kind: StratumEventKind,
    detail: Option<String>,
) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if let Ok(mut g) = ring.lock() {
        if g.len() >= STRATUM_EVENT_RING_CAP {
            g.pop_back();
        }
        g.push_front(StratumEvent { ts: now, kind, detail });
    }
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

fn parse_gpu_thermal(line: &str) -> Option<(f64, f64)> {
    if !line.contains("[GPU] temp=") { return None; }
    let temp = line.split("temp=").nth(1)?
        .split('C').next()?
        .trim().parse::<f64>().ok()?;
    let power = line.split("power=").nth(1)?
        .split('W').next()?
        .trim().parse::<f64>().ok()?;
    Some((temp, power))
}

fn lock_err(e: impl std::fmt::Display) -> String {
    format!("Lock error: {}", e)
}

// Build a std::process::Command that never allocates a console on
// Windows. The GUI is linked as /SUBSYSTEM:WINDOWS so it has no
// attached console; spawning a console-subsystem child (taskkill,
// git, where, …) via the bare std::process::Command makes Windows
// allocate a new console for the child, which flashes a black CMD
// window for ~100ms even when the child exits immediately. Stop
// Node used to flash four such windows in a row.
//
// Setting CREATE_NO_WINDOW (0x08000000) on creation_flags tells the
// kernel "do not allocate a console for this child" — output still
// streams through inherited handles if any, but no visible window
// is ever created. Tauri's Command::new_sidecar() applies the same
// flag internally, which is why iriumd / irium-wallet / irium-miner
// start silently while the manual taskkill / git / where spawns
// below previously did not.
//
// On non-Windows targets this is identical to std::process::Command::new.
fn silent_command(program: &str) -> std::process::Command {
    let cmd = std::process::Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut cmd = cmd;
        cmd.creation_flags(CREATE_NO_WINDOW);
        return cmd;
    }
    #[cfg(not(target_os = "windows"))]
    cmd
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

async fn get_rpc_info(state: &AppState, rpc_url: &str) -> Result<RpcInfo, String> {
    let client = rpc_client(state);
    let resp = client
        .get(format!("{}/status", rpc_url))
        .timeout(Duration::from_secs(3))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.json::<RpcInfo>().await.map_err(|e| e.to_string())
}

async fn get_current_height(state: &AppState, rpc_url: &str) -> u64 {
    get_rpc_info(state, rpc_url).await
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
    // Forward the local RPC token to the wallet sidecar so it can
    // authenticate to iriumd. The wallet binary reads IRIUM_RPC_TOKEN from
    // env and wraps every privileged RPC call with Authorization: Bearer …
    // (verified in irium-source/src/bin/irium-wallet.rs:2607-2713). If the
    // token isn't initialised yet (vanishingly rare; setup() runs first),
    // unwrap_or_default leaves the env var unset which preserves the
    // pre-change behaviour.
    if let Some(token) = RPC_TOKEN.get() {
        if !token.is_empty() {
            env_vars.insert("IRIUM_RPC_TOKEN".to_string(), token.clone());
        }
    }

    // Retry on the specific ENOENT race ("os error 2"). The wallet binary
    // walks ~/.irium for the wallet file plus a couple of adjacent state
    // files (peers.json etc) and during a Clear & Restart there's a brief
    // window where state/ is being recreated by iriumd. Concurrent
    // list-addresses calls (page switches, polling) can hit transient
    // ENOENT even though the wallet itself is fine — the next call a few
    // seconds later succeeds. 3 retries × 2 s gives the init window
    // enough time to settle without making a genuine "wallet missing"
    // failure too slow for the user. Only the literal "os error 2"
    // substring triggers retry; all other failures (bad args, RPC down,
    // corrupted wallet) propagate immediately so the real error surfaces.
    const MAX_ATTEMPTS: u32 = 4;
    const RETRY_DELAY_MS: u64 = 2000;
    let mut last_stderr = String::new();
    for attempt in 1..=MAX_ATTEMPTS {
        let cmd = Command::new_sidecar("irium-wallet")
            .map_err(|e| format!("irium-wallet sidecar not found: {}. Place binary in src-tauri/binaries/", e))?
            .envs(env_vars.clone())
            .args(&args);

        let output = cmd.output().map_err(|e| format!("Failed to run wallet command: {}", e))?;

        if output.status.success() {
            return Ok(output.stdout);
        }

        last_stderr = output.stderr.trim().to_string();
        if attempt < MAX_ATTEMPTS && last_stderr.contains("os error 2") {
            tokio::time::sleep(std::time::Duration::from_millis(RETRY_DELAY_MS)).await;
            continue;
        }
        break;
    }

    Err(format!("Wallet command failed: {}", last_stderr))
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
//
// FIX 1 (this release): the legacy upnp_local_ipv4() used the
// "connect to 8.8.8.8 then read local_addr" trick to find the
// default-route adapter. On Windows hosts with Hyper-V, WSL2, Docker
// Desktop, or a VPN client active, that trick frequently picks the
// virtual switch / tunnel adapter instead of the actual LAN. The
// router accepts the SOAP AddPortMapping but registers the wrong
// internal client - the mapping appears live in the router UI yet
// no packets arrive at the real iriumd. The GUI reads
// "UPnP succeeded? yes" but the inbound port stays closed.
//
// This release replaces single-adapter discovery with a two-step
// approach:
//   1. SSDP discovers the gateway (whichever adapter the M-SEARCH
//      response arrives on).
//   2. Parse the gateway IP out of the SSDP LOCATION URL, then pick
//      the LOCAL adapter in the gateway's subnet as NewInternalClient.
//
// Diagnostics are captured into AppState.upnp_diagnostics and
// exposed via the new upnp_diagnostics Tauri command so the user
// can self-diagnose from the Help page.
// ============================================================

/// FIX 1: enumerate every local IPv4 adapter, skipping the ones that
/// can never be the right NewInternalClient for the router-side
/// AddPortMapping call: loopback, link-local, anything in the 172.16-31
/// range (almost always Hyper-V switch / Docker / WSL2 on consumer
/// machines; if your real LAN actually uses 172.16-31 we still try the
/// gateway-subnet fallback in upnp_local_ipv4_for_gateway).
fn enumerate_local_ipv4_candidates() -> Vec<std::net::Ipv4Addr> {
    use if_addrs::IfAddr;
    let mut out = Vec::new();
    if let Ok(ifaces) = if_addrs::get_if_addrs() {
        for iface in ifaces {
            if iface.is_loopback() {
                continue;
            }
            if let IfAddr::V4(v4) = iface.addr {
                let oct = v4.ip.octets();
                // Link-local 169.254/16
                if oct[0] == 169 && oct[1] == 254 {
                    continue;
                }
                // 172.16-31/12 - almost always a virtual switch on consumer
                // Windows machines. Real LANs in this range are rare; we
                // fall back via gateway-subnet match if the user has one.
                if oct[0] == 172 && (16..=31).contains(&oct[1]) {
                    continue;
                }
                out.push(v4.ip);
            }
        }
    }
    out
}

/// FIX 1: parse an SSDP LOCATION URL like "http://192.168.1.1:5000/desc.xml"
/// and return the host as an Ipv4Addr. Returns None for hostnames or IPv6
/// LOCATION values - those go through the legacy heuristic path.
fn extract_ipv4_from_location(location: &str) -> Option<std::net::Ipv4Addr> {
    let after_scheme = location.split("://").nth(1)?;
    let host_only = after_scheme.split(['/', ':']).next()?;
    host_only.parse().ok()
}

/// FIX 1: given the router's IPv4 (extracted from the SSDP LOCATION URL),
/// pick the local adapter in the same subnet. Tries /24 first (most home
/// LANs); falls back to /16. Returns None if no adapter matches; callers
/// then fall back to the legacy default-route trick. Choosing the right
/// adapter here is the single most important UPnP bug fix in this
/// release - it stops the router from registering AddPortMapping against
/// the Hyper-V virtual switch.
fn upnp_local_ipv4_for_gateway(gateway: std::net::Ipv4Addr) -> Option<std::net::Ipv4Addr> {
    let candidates = enumerate_local_ipv4_candidates();
    let gw = gateway.octets();
    // /24 exact match
    for ip in &candidates {
        let oct = ip.octets();
        if oct[0] == gw[0] && oct[1] == gw[1] && oct[2] == gw[2] {
            return Some(*ip);
        }
    }
    // /16 fallback
    for ip in &candidates {
        let oct = ip.octets();
        if oct[0] == gw[0] && oct[1] == gw[1] {
            return Some(*ip);
        }
    }
    None
}

/// FIX 1: legacy default-route heuristic, kept as a last-resort fallback
/// when neither SSDP gateway extraction nor adapter enumeration yields
/// a candidate (rare; happens on no-network sandboxes).
fn upnp_local_ipv4_default_route() -> Option<std::net::Ipv4Addr> {
    use std::net::{IpAddr, UdpSocket};
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("8.8.8.8:80").ok()?;
    match sock.local_addr().ok()?.ip() {
        IpAddr::V4(ip) => Some(ip),
        _ => None,
    }
}

/// FIX 1: classify an IPv4 address as publicly routable. Returns false
/// for RFC1918 (10/8, 172.16/12, 192.168/16), RFC6598 CGNAT (100.64/10),
/// loopback (127/8), link-local (169.254/16), and the
/// 0.0.0.0 / 255.255.255.255 sentinels. Used to detect double-NAT:
/// UPnP "succeeded" but the external IP is itself behind another NAT,
/// so the mapping is useless for inbound connections.
fn is_routable_ipv4(s: &str) -> bool {
    let Ok(ip) = s.parse::<std::net::Ipv4Addr>() else {
        return false;
    };
    let oct = ip.octets();
    // Bogus sentinels
    if oct == [0, 0, 0, 0] || oct == [255, 255, 255, 255] {
        return false;
    }
    // 127/8 loopback
    if oct[0] == 127 {
        return false;
    }
    // 10/8
    if oct[0] == 10 {
        return false;
    }
    // 172.16/12
    if oct[0] == 172 && (16..=31).contains(&oct[1]) {
        return false;
    }
    // 192.168/16
    if oct[0] == 192 && oct[1] == 168 {
        return false;
    }
    // 100.64/10 - RFC6598 CGNAT
    if oct[0] == 100 && (64..=127).contains(&oct[1]) {
        return false;
    }
    // 169.254/16 link-local
    if oct[0] == 169 && oct[1] == 254 {
        return false;
    }
    true
}

/// FIX 1: full diagnostic snapshot of the last UPnP attempt, exposed via
/// the upnp_diagnostics Tauri command. Lets the Help page show the user
/// exactly which step the SOAP dance reached and what failed.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
struct UpnpDiagnostics {
    last_attempt_at_unix: Option<u64>,
    local_ipv4_candidates: Vec<String>,
    local_ipv4_chosen: Option<String>,
    gateway_ipv4: Option<String>,
    ssdp_location: Option<String>,
    control_url: Option<String>,
    external_ip: Option<String>,
    external_ip_routable: Option<bool>,
    add_port_mapping_attempts: u8,
    last_fault: Option<String>,
    succeeded: bool,
    double_nat_detected: bool,
}

/// FIX 1: result of one full try_upnp invocation. The legacy signature
/// was Option<String>; that lost the diagnostic detail and couldn't
/// distinguish "real failure" from "mapping succeeded but external IP
/// is itself private (double NAT)". Callers update three pieces of
/// AppState from this struct: upnp_external_ip, upnp_double_nat,
/// upnp_diagnostics.
struct UpnpAttempt {
    external_ip: Option<String>,
    double_nat: bool,
    diagnostics: UpnpDiagnostics,
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

/// Helper: build the AddPortMapping SOAP envelope. `empty_remote_host_explicit`
/// toggles the `<NewRemoteHost></NewRemoteHost>` (full-open) form vs the
/// `<NewRemoteHost/>` (self-closing) form - some routers reject one but
/// accept the other. `lease_duration` of 0 means a permanent lease (some
/// routers only support that).
fn build_add_port_mapping_soap(
    svc_type: &str,
    port: u16,
    local_ip: &str,
    lease_duration: u32,
    empty_remote_host_explicit: bool,
) -> String {
    let remote_host_tag = if empty_remote_host_explicit {
        "<NewRemoteHost></NewRemoteHost>"
    } else {
        "<NewRemoteHost/>"
    };
    format!(
        r#"<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:AddPortMapping xmlns:u="{svc}">{rh}<NewExternalPort>{p}</NewExternalPort><NewProtocol>TCP</NewProtocol><NewInternalPort>{p}</NewInternalPort><NewInternalClient>{ip}</NewInternalClient><NewEnabled>1</NewEnabled><NewPortMappingDescription>Irium Core P2P</NewPortMappingDescription><NewLeaseDuration>{lease}</NewLeaseDuration></u:AddPortMapping></s:Body></s:Envelope>"#,
        svc = svc_type, rh = remote_host_tag, p = port, ip = local_ip, lease = lease_duration,
    )
}

/// FIX 1: full try_upnp rewrite. Captures every step into UpnpAttempt so
/// the caller can show diagnostics in the UI. Order:
///  1. enumerate local IPv4 candidates (excluding loopback / link-local /
///     172.16-31 virtual switch range).
///  2. SSDP discover the router (default-route adapter).
///  3. extract the router's IPv4 from the LOCATION URL.
///  4. pick the local adapter in the router's subnet as NewInternalClient.
///     This is the single change that fixes the Hyper-V / WSL / VPN
///     adapter mis-selection bug.
///  5. GetExternalIPAddress, then classify as routable vs RFC1918/CGNAT.
///  6. DeletePortMapping (clear stale lease).
///  7. AddPortMapping with retry chain:
///       - first try: lease=3600s, <NewRemoteHost/> self-closing.
///       - on fault 725 (OnlyPermanentLeasesSupported): retry lease=0.
///       - on fault 718 / 726 / Wildcard: retry with explicit empty body.
///       - on persistent fault: capture in last_fault for diagnostics.
///  8. Even on success, if the external IP is itself private we flag
///     double_nat: the mapping is alive on the router but the IP we
///     would announce is unrouteable; the GUI shows
///     "Inactive (double NAT)" rather than the misleading "Active".
async fn try_upnp(port: u16) -> UpnpAttempt {
    let mut attempt = UpnpAttempt {
        external_ip: None,
        double_nat: false,
        diagnostics: UpnpDiagnostics::default(),
    };
    attempt.diagnostics.last_attempt_at_unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs());

    // Step 1: enumerate local adapter candidates (for diagnostics).
    let candidates = enumerate_local_ipv4_candidates();
    attempt.diagnostics.local_ipv4_candidates =
        candidates.iter().map(|ip| ip.to_string()).collect();
    tracing::info!(
        "[upnp] step 1/6: enumerated {} local IPv4 candidate(s): {:?}",
        candidates.len(),
        attempt.diagnostics.local_ipv4_candidates
    );

    // Step 2: SSDP discovery.
    let location = match upnp_discover_location().await {
        Some(l) => l,
        None => {
            attempt.diagnostics.last_fault = Some("SSDP discovery timed out (no router response)".to_string());
            tracing::warn!("[upnp] step 2/6 FAILED: SSDP M-SEARCH timed out — router does not advertise WANIPConnection on 239.255.255.250:1900");
            return attempt;
        }
    };
    attempt.diagnostics.ssdp_location = Some(location.clone());
    tracing::info!("[upnp] step 2/6: SSDP LOCATION = {}", location);

    // Step 3: extract gateway IP from the LOCATION URL (for adapter match).
    let gateway = extract_ipv4_from_location(&location);
    attempt.diagnostics.gateway_ipv4 = gateway.map(|g| g.to_string());
    tracing::info!(
        "[upnp] step 3/6: gateway IPv4 from LOCATION = {:?}",
        attempt.diagnostics.gateway_ipv4
    );

    // Step 4: pick the local adapter in the gateway's subnet. Fall back
    // to the legacy default-route heuristic if no adapter matches.
    let local_ip = gateway
        .and_then(upnp_local_ipv4_for_gateway)
        .or_else(upnp_local_ipv4_default_route);
    let local_ip = match local_ip {
        Some(ip) => ip.to_string(),
        None => {
            attempt.diagnostics.last_fault =
                Some("Could not determine a local IPv4 for NewInternalClient".to_string());
            tracing::warn!(
                "[upnp] step 4/6 FAILED: no local IPv4 adapter matched gateway {:?} and default-route fallback returned nothing — multi-adapter selection has no candidate to use as NewInternalClient",
                attempt.diagnostics.gateway_ipv4
            );
            return attempt;
        }
    };
    attempt.diagnostics.local_ipv4_chosen = Some(local_ip.clone());
    tracing::info!("[upnp] step 4/6: chose local IPv4 {} as NewInternalClient", local_ip);

    // Fetch device description (used to resolve the WAN service control URL).
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
    {
        Ok(c) => c,
        Err(_) => {
            attempt.diagnostics.last_fault = Some("Could not build HTTP client".to_string());
            tracing::warn!("[upnp] step 5/6 FAILED: could not build reqwest client for device description");
            return attempt;
        }
    };
    let xml = match client.get(&location).send().await {
        Ok(r) => match r.text().await {
            Ok(t) => t,
            Err(_) => {
                attempt.diagnostics.last_fault =
                    Some("Device description fetch returned no body".to_string());
                tracing::warn!("[upnp] step 5/6 FAILED: device description body empty at {}", location);
                return attempt;
            }
        },
        Err(e) => {
            attempt.diagnostics.last_fault =
                Some("Device description fetch failed (router unreachable)".to_string());
            tracing::warn!("[upnp] step 5/6 FAILED: GET {} -> {}", location, e);
            return attempt;
        }
    };

    let (ctrl_url, svc_type) = match upnp_resolve_control_url(&xml, &location) {
        Some(v) => v,
        None => {
            attempt.diagnostics.last_fault =
                Some("Device description missing WANIPConnection / WANPPPConnection service".to_string());
            tracing::warn!("[upnp] step 5/6 FAILED: device description had no WANIPConnection / WANPPPConnection service block");
            return attempt;
        }
    };
    attempt.diagnostics.control_url = Some(ctrl_url.clone());
    tracing::info!("[upnp] step 5/6: control URL = {} (svc: {})", ctrl_url, svc_type);

    // Step 5: GetExternalIPAddress + routability classification.
    let ext_ip_soap = format!(
        r#"<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:GetExternalIPAddress xmlns:u="{svc}"/></s:Body></s:Envelope>"#,
        svc = svc_type
    );
    let action = format!("\"{}#GetExternalIPAddress\"", svc_type);
    let resp_xml = match upnp_soap(&ctrl_url, &action, ext_ip_soap).await {
        Some(t) => t,
        None => {
            attempt.diagnostics.last_fault =
                Some("GetExternalIPAddress SOAP call failed".to_string());
            tracing::warn!("[upnp] step 6/6 FAILED: GetExternalIPAddress SOAP call timed out or returned no body");
            return attempt;
        }
    };
    let ext_ip = {
        const TAG: &str = "NewExternalIPAddress>";
        match resp_xml.find(TAG) {
            Some(i) => {
                let s = i + TAG.len();
                match resp_xml[s..].find('<') {
                    Some(j) => resp_xml[s..s + j].trim().to_string(),
                    None => String::new(),
                }
            }
            None => String::new(),
        }
    };
    if ext_ip.is_empty() {
        attempt.diagnostics.last_fault =
            Some("GetExternalIPAddress returned empty body".to_string());
        tracing::warn!("[upnp] step 6/6 FAILED: GetExternalIPAddress response had no NewExternalIPAddress tag");
        return attempt;
    }
    attempt.diagnostics.external_ip = Some(ext_ip.clone());
    let routable = is_routable_ipv4(&ext_ip);
    attempt.diagnostics.external_ip_routable = Some(routable);
    tracing::info!(
        "[upnp] step 6/6: GetExternalIPAddress returned {} (routable={})",
        ext_ip,
        routable
    );

    // Step 6: clear stale lease (best-effort; failure is fine).
    let del_soap = format!(
        r#"<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:DeletePortMapping xmlns:u="{svc}"><NewRemoteHost/><NewExternalPort>{p}</NewExternalPort><NewProtocol>TCP</NewProtocol></u:DeletePortMapping></s:Body></s:Envelope>"#,
        svc = svc_type, p = port
    );
    let _ = upnp_soap(&ctrl_url, &format!("\"{}#DeletePortMapping\"", svc_type), del_soap).await;

    // Step 7: AddPortMapping with fault-driven retries.
    //   Variant A: lease=3600, <NewRemoteHost/> self-closing  (most routers)
    //   Variant B: lease=0,    <NewRemoteHost/> self-closing  (permanent-only)
    //   Variant C: lease=3600, <NewRemoteHost></NewRemoteHost> (wildcard quirk)
    //   Variant D: lease=0,    <NewRemoteHost></NewRemoteHost> (last resort)
    let variants: [(u32, bool); 4] = [(3600, false), (0, false), (3600, true), (0, true)];
    let mut last_fault: Option<String> = None;
    let mut success = false;
    for (lease, explicit_empty) in variants {
        attempt.diagnostics.add_port_mapping_attempts =
            attempt.diagnostics.add_port_mapping_attempts.saturating_add(1);
        let add_soap = build_add_port_mapping_soap(&svc_type, port, &local_ip, lease, explicit_empty);
        let add_action = format!("\"{}#AddPortMapping\"", svc_type);
        let add_resp = match upnp_soap(&ctrl_url, &add_action, add_soap).await {
            Some(r) => r,
            None => {
                last_fault = Some("AddPortMapping SOAP call timed out".to_string());
                continue;
            }
        };
        if add_resp.contains("Fault") || add_resp.contains("fault") {
            // Extract the errorCode for diagnostics + retry routing.
            let code = {
                const TAG: &str = "errorCode>";
                add_resp.find(TAG).and_then(|i| {
                    let s = i + TAG.len();
                    add_resp[s..].find('<').map(|j| add_resp[s..s + j].trim().to_string())
                })
            };
            last_fault = Some(format!(
                "AddPortMapping fault (lease={}, empty_remote_host_explicit={}): code={} body={}",
                lease,
                explicit_empty,
                code.as_deref().unwrap_or("?"),
                &add_resp[..add_resp.len().min(200)]
            ));
            tracing::warn!("[upnp] {}", last_fault.as_deref().unwrap_or(""));
            // Specific routing — break out early for permanent errors.
            if let Some(c) = code.as_deref() {
                // 402 InvalidArgs, 401 Invalid Action - retrying won't help.
                if c == "401" || c == "402" {
                    break;
                }
            }
            continue;
        }
        success = true;
        break;
    }

    if !success {
        attempt.diagnostics.last_fault = last_fault.clone();
        tracing::warn!(
            "[upnp] AddPortMapping FAILED after {} variant(s); last fault: {}",
            attempt.diagnostics.add_port_mapping_attempts,
            last_fault.as_deref().unwrap_or("(none)")
        );
        return attempt;
    }
    tracing::info!(
        "[upnp] AddPortMapping SUCCESS on attempt {} — external IP {} -> internal {}:{}",
        attempt.diagnostics.add_port_mapping_attempts,
        ext_ip,
        local_ip,
        port
    );

    // Step 8: classify success vs double-NAT. Even though the router
    // accepted AddPortMapping, if the external IP is itself private the
    // mapping is useless for inbound connections from the public internet.
    if !routable {
        attempt.double_nat = true;
        attempt.diagnostics.double_nat_detected = true;
        // Intentionally leave attempt.external_ip = None so iriumd does
        // not announce a private/CGNAT address as its public endpoint.
        attempt.diagnostics.last_fault = Some(format!(
            "Router accepted the mapping, but the WAN IP {} is itself private/CGNAT (double NAT). Inbound from the public internet will not work via UPnP.",
            ext_ip
        ));
        tracing::warn!("[upnp] double NAT detected: external IP {} is not publicly routable", ext_ip);
        return attempt;
    }

    attempt.external_ip = Some(ext_ip.clone());
    attempt.diagnostics.succeeded = true;
    tracing::info!("[upnp] TCP {} mapped via local {} -> {}:{}", port, local_ip, ext_ip, port);
    attempt
}

// UPnP mapping refresh cadence. Most consumer routers expire UPnP port
// mappings between 30 minutes and 2 hours. Re-mapping every 30 minutes
// keeps the port reachable for the lifetime of the app process without
// hammering the router. Kept just under the smallest common expiry so
// even the most aggressive routers stay current.
const UPNP_REFRESH_INTERVAL_SECS: u64 = 30 * 60;
// Tracks whether the background refresh task is already running for this
// app process. AtomicBool so the check is free without grabbing a lock,
// and so multiple try_upnp_port_map invocations don't spawn duplicates.
static UPNP_REFRESH_RUNNING: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

#[tauri::command]
async fn try_upnp_port_map(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let attempt = try_upnp(38291).await;
    let ip = attempt.external_ip.clone();
    *state.upnp_external_ip.lock().map_err(lock_err)? = ip.clone();
    *state.upnp_double_nat.lock().map_err(lock_err)? = attempt.double_nat;
    *state.upnp_diagnostics.lock().map_err(lock_err)? = attempt.diagnostics;

    // FIX 6: keep the UPnP mapping alive while the app is running. Routers
    // commonly expire mappings after 1 hour; refreshing every 30 minutes is
    // well inside that envelope. Only spawn the refresher once per process
    // (the AtomicBool gate); subsequent UPnP retries from the UI just
    // update the cached IP, they don't spawn additional timers.
    if ip.is_some()
        && !UPNP_REFRESH_RUNNING.swap(true, std::sync::atomic::Ordering::SeqCst)
    {
        let upnp_external_ip_ref = Arc::clone(&state.upnp_external_ip);
        let upnp_double_nat_ref = Arc::clone(&state.upnp_double_nat);
        let upnp_diag_ref = Arc::clone(&state.upnp_diagnostics);
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(
                    UPNP_REFRESH_INTERVAL_SECS,
                ))
                .await;
                let fresh = try_upnp(38291).await;
                if let Ok(mut g) = upnp_external_ip_ref.lock() {
                    *g = fresh.external_ip.clone();
                }
                if let Ok(mut g) = upnp_double_nat_ref.lock() {
                    *g = fresh.double_nat;
                }
                if let Ok(mut g) = upnp_diag_ref.lock() {
                    *g = fresh.diagnostics;
                }
                // No event emission on refresh — silent maintenance. A
                // failed refresh shows up to the UI on the next get_node_status
                // poll via upnp_active flipping false, which is enough signal.
            }
        });
    }

    Ok(ip)
}

/// FIX 1: Tauri command returning the last UPnP attempt's full
/// diagnostic snapshot. The Help page renders this so the user can
/// self-diagnose: which local adapters were detected, which one was
/// chosen as NewInternalClient, the gateway IP we matched against, the
/// SSDP LOCATION URL, the control URL, the external IP returned by
/// GetExternalIPAddress, whether that IP is publicly routable, the
/// fault text from the last failed AddPortMapping attempt, etc.
#[tauri::command]
async fn upnp_diagnostics(state: State<'_, AppState>) -> Result<UpnpDiagnostics, String> {
    Ok(state.upnp_diagnostics.lock().map_err(lock_err)?.clone())
}

// check_port_open: port-forwarding self-test for the Help page's Test
// Connection button. Two signals are combined:
//   1. Live UPnP probe via try_upnp(38291) — if the router accepts the
//      mapping, port 38291 is open at least via UPnP and an external IP
//      can be reported.
//   2. iriumd's irium_inbound_accepted_total counter — non-zero means an
//      external peer has actually completed a TCP connection to us, which
//      is the strongest possible proof that forwarding works regardless
//      of how it was configured (UPnP, manual DMZ, manual rule).
// Either signal flips `open` to true. When both are false we tell the
// user their port appears closed and to try manual port forwarding.
//
// Note: this is a node-side probe — no third-party port-check service is
// contacted. Both signals are read from the local iriumd RPC, so the
// command works regardless of network policy on the user's side.
#[tauri::command]
async fn check_port_open(state: State<'_, AppState>) -> Result<PortCheckResult, String> {
    // Fresh UPnP attempt. FIX 1: try_upnp now returns an UpnpAttempt
    // carrying the external IP plus a double_nat flag (set when the
    // router's WAN IP is itself RFC1918 / CGNAT) plus a diagnostic
    // snapshot. Cache all three so a subsequent get_node_status reflects
    // them without waiting for the next manual retry.
    let attempt = try_upnp(38291).await;
    let upnp_external_ip = attempt.external_ip.clone();
    let double_nat = attempt.double_nat;
    if let Ok(mut guard) = state.upnp_external_ip.lock() {
        *guard = upnp_external_ip.clone();
    }
    if let Ok(mut guard) = state.upnp_double_nat.lock() {
        *guard = double_nat;
    }
    if let Ok(mut guard) = state.upnp_diagnostics.lock() {
        *guard = attempt.diagnostics;
    }

    // Scrape iriumd /metrics for irium_inbound_accepted_total. Failures
    // here are non-fatal — we fall back to 0 and let the UPnP signal
    // decide, which mirrors how get_node_metrics handles offline nodes.
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let client = rpc_client(&state);
    let mut inbound_count: u64 = 0;
    if let Ok(resp) = client
        .get(format!("{}/metrics", rpc_url))
        .timeout(Duration::from_secs(3))
        .send()
        .await
    {
        if let Ok(text) = resp.text().await {
            for line in text.lines() {
                let line = line.trim();
                if line.starts_with('#') || line.is_empty() { continue; }
                if let Some(rest) = line.strip_prefix("irium_inbound_accepted_total ") {
                    if let Ok(v) = rest.trim().parse::<u64>() {
                        inbound_count = v;
                    }
                    break;
                }
            }
        }
    }

    let open = upnp_external_ip.is_some() || inbound_count > 0;
    let reason = match (upnp_external_ip.as_deref(), inbound_count, double_nat) {
        (Some(ip), 0, _) => format!("Port 38291 is open — UPnP mapped successfully (external IP {})", ip),
        (Some(ip), n, _) => format!("Port 38291 is open — UPnP active ({}) and {} inbound peer(s) accepted", ip, n),
        (None, n, _) if n > 0 => format!("Port 38291 is open — {} inbound peer(s) accepted (manual forwarding)", n),
        (None, _, true) => "UPnP mapping accepted by the router, but the router's WAN IP is itself private (double NAT / CGNAT). Inbound from the public internet will not work via UPnP — see Help for diagnostics, or ask your ISP for a public IPv4.".to_string(),
        (None, _, false) => "Port 38291 appears closed — try manual port forwarding above".to_string(),
    };
    Ok(PortCheckResult { open, reason, upnp_external_ip, inbound_count, double_nat })
}

#[tauri::command]
async fn start_node(
    state: State<'_, AppState>,
    data_dir: Option<String>,
    external_ip: Option<String>,
) -> Result<NodeStartResult, String> {
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    // FIX 3 (Remote node): when settings.node_mode == "remote" the
    // user is pointing the GUI at an iriumd they manage themselves
    // (VPS, dedicated rig, neighbour's node). Spawning the bundled
    // sidecar would compete for the data directory and create a
    // duplicate node; instead we just confirm the remote is reachable
    // and report success. UPnP is also skipped because port mapping
    // for the *remote* node is the remote operator's problem. The
    // bundled CPU/GPU miners stay available — they connect via
    // rpc_url like any other client.
    let node_mode = state
        .node_mode
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|_| "local".to_string());
    if node_mode == "remote" {
        if get_rpc_info(&state, &rpc_url).await.is_ok() {
            return Ok(NodeStartResult {
                success: true,
                message: format!("Connected to remote node at {}", rpc_url),
                pid: None,
            });
        }
        return Ok(NodeStartResult {
            success: false,
            message: format!(
                "Remote node at {} is unreachable. Confirm the URL and RPC token in Settings.",
                rpc_url
            ),
            pid: None,
        });
    }

    // If RPC is already reachable the node is running — don't spawn a second instance.
    if get_rpc_info(&state, &rpc_url).await.is_ok() {
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
    // Bind the RPC port publicly too so peers that discover our marketplace
    // feed URL via the P2P handshake can actually fetch /offers/feed.
    // iriumd defaults to 127.0.0.1:38300 (iriumd.rs:9175); without this
    // override, every desktop seller's advertised feed URL is unreachable.
    node_env.insert("IRIUM_NODE_HOST".to_string(), "0.0.0.0".to_string());
    // Pair the public bind with a token. iriumd's require_rpc_auth() returns
    // Ok unconditionally when no token is set, so without this every
    // privileged endpoint (create_agreement, fund_agreement, build_*_template,
    // claim_htlc, etc.) would be exposed to anyone on the LAN. The wallet
    // sidecar reads the same env var and sends Authorization: Bearer …, so
    // local settlement commands keep working transparently. RPC_TOKEN is
    // initialised in setup(); unwrap_or_default keeps iriumd in the legacy
    // no-auth mode if init somehow didn't run (e.g., during early-boot races).
    node_env.insert(
        "IRIUM_RPC_TOKEN".to_string(),
        RPC_TOKEN.get().cloned().unwrap_or_default(),
    );

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
    // FIX 2: hardcoded iriumlabs-operated bootstrap nodes. These are
    // pinned alongside whatever lives in the signed BOOTSTRAP_SEEDLIST_TXT
    // so a fresh install reaches one of them on the first dial attempt
    // and starts pulling headers within seconds instead of cycling
    // through gossip-discovered (often stale) candidates. They flow
    // through the same dedup + own-IP filter below, so a duplicate of
    // either IP already in the signed list is silently dropped, and a
    // user running irium-core on the VPS itself never tries to dial
    // itself. No port suffix needed — iriumd's seed-dial loop defaults
    // to TCP 38291 when only an IP is given.
    const IRIUMLABS_BOOTSTRAP_NODES: &[&str] = &[
        "207.244.247.86",   // irium-vps
        "157.173.116.134",  // irium-eu
    ];
    let mut builtin_seeds: Vec<String> = BOOTSTRAP_SEEDLIST_TXT
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .map(|l| l.to_string())
        .collect();
    for ip in IRIUMLABS_BOOTSTRAP_NODES {
        builtin_seeds.push((*ip).to_string());
    }

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
    let upnp_attempt = try_upnp(38291).await;
    let upnp_ip = upnp_attempt.external_ip.clone();
    if let Some(ref ip) = upnp_ip {
        tracing::info!("[start_node] UPnP active — TCP 38291 mapped via router, external IP: {} (double_nat={})", ip, upnp_attempt.double_nat);
        *state.upnp_external_ip.lock().map_err(lock_err)? = Some(ip.clone());
    } else {
        tracing::info!("[start_node] UPnP not available — relying on manual port forwarding or inbound-only mode");
        *state.upnp_external_ip.lock().map_err(lock_err)? = None;
    }
    *state.upnp_double_nat.lock().map_err(lock_err)? = upnp_attempt.double_nat;
    *state.upnp_diagnostics.lock().map_err(lock_err)? = upnp_attempt.diagnostics;

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

    // Self-advertised external endpoint for peers' PeerDirectory. Without
    // this, peers gossip our TCP source IP, which is wrong under CGNAT (the
    // carrier-NAT address rather than our actual external IP) and under any
    // proxying NAT. iriumd's HandshakePayload.external_endpoint field carries
    // this advertisement and falls back to TCP-source-IP behaviour when
    // unset.
    //
    // Priority: ipify echo first (authoritative — comes from an internet-
    // facing service). UPnP IGD's external IP is used only as fallback and
    // ONLY when ipify failed: under CGNAT, UPnP's IP is the modem's WAN
    // address (still 100.64/10 carrier-NAT), not the public internet. ipify
    // sees the real public IP because it observes our packets after they
    // cross the CGNAT.
    //
    // detected_ip above already holds the ipify result (it was used for own-
    // IP self-filtering in the seed list). We re-use it here.
    let ipify_validated = detected_ip
        .as_deref()
        .and_then(validate_routable_ipv4);
    let upnp_validated = upnp_ip
        .as_deref()
        .and_then(validate_routable_ipv4);
    let external_endpoint_ip = ipify_validated.clone().or_else(|| upnp_validated.clone());
    match (&ipify_validated, &upnp_validated) {
        (Some(a), Some(b)) if a == b => tracing::info!(
            "[start_node] external endpoint confirmed: {} (ipify + UPnP agree)",
            a
        ),
        (Some(a), Some(b)) => tracing::info!(
            "[start_node] external endpoint: {} (ipify-validated; UPnP reported different IP {} — likely CGNAT WAN, trusting ipify)",
            a, b
        ),
        (Some(a), None) => tracing::info!(
            "[start_node] external endpoint: {} (ipify-validated)",
            a
        ),
        (None, Some(b)) => tracing::info!(
            "[start_node] external endpoint: {} (UPnP fallback — ipify unavailable)",
            b
        ),
        (None, None) => tracing::info!(
            "[start_node] external endpoint: not advertising (no routable public IPv4 detected — peers will fall back to TCP source IP)"
        ),
    }
    if let Some(ref ip) = external_endpoint_ip {
        node_env.insert(
            "IRIUM_EXTERNAL_ENDPOINT".to_string(),
            format!("{}:38291", ip),
        );
        // Advertise this node's marketplace feed URL to every peer we
        // handshake with. iriumd places IRIUM_MARKETPLACE_FEED_URL into
        // HandshakePayload.marketplace_feed; receiving peers persist it via
        // record_discovered_feed → ~/.irium/discovered_feeds.json, which
        // offer-feed-sync then merges into the fetch loop alongside any
        // manually-added feeds.
        //
        // We only advertise when we have a validated public IPv4 (the same
        // condition that gates IRIUM_EXTERNAL_ENDPOINT above). Users
        // behind CGNAT or in outbound-only mode cannot serve their feed,
        // so silence is correct — advertising an unreachable URL would
        // just poison peers' discovered_feeds.json with dead entries.
        //
        // Port 38300 is the standard RPC/explorer port, same one /offers/feed
        // lives on. If the operator runs iriumd with a custom IRIUM_RPC_PORT
        // they'd need to forward that port too; the GUI's bundled iriumd
        // always uses 38300 so this is fine for the desktop case.
        let feed_url = format!("http://{}:38300/offers/feed", ip);
        node_env.insert(
            "IRIUM_MARKETPLACE_FEED_URL".to_string(),
            feed_url.clone(),
        );
        tracing::info!(
            "[start_node] advertising marketplace feed: {} (peers will auto-discover via P2P handshake)",
            feed_url
        );
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
            // silent_command applies CREATE_NO_WINDOW on Windows so no console
            // flashes for the iriumd child even on the fallback path.
            let mut sys_cmd = silent_command("iriumd");
            for (k, v) in &node_env {
                sys_cmd.env(k, v);
            }
            for arg in &args {
                sys_cmd.arg(arg);
            }
            sys_cmd.current_dir(&irium_dir);

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

/// Returns true if iriumd's RPC port is currently accepting connections.
/// Used as the alive-check for the graceful-shutdown polling loop. 200 ms
/// connect timeout so a fully-shut-down iriumd is detected within ~one
/// poll interval instead of blocking on the OS connect-refused TCP retry.
fn iriumd_rpc_alive() -> bool {
    use std::net::TcpStream;
    use std::time::Duration;
    match "127.0.0.1:38300".parse() {
        Ok(addr) => TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok(),
        Err(_) => false,
    }
}

/// POSTs http://127.0.0.1:38300/rpc/stop with the local Bearer token to
/// request a graceful drain-and-exit from iriumd. Returns true on any
/// 2xx response, false on connect/timeout/auth/non-2xx errors. The
/// underlying endpoint flushes peers, drains the persist queue with
/// the IRIUM_PERSIST_DRAIN_SECS envelope (default 15 s, clamped to 20 s),
/// then calls std::process::exit(0); see iriumd.rs:stop_handler.
///
/// 2 s timeout because a hung iriumd should not stall the helper — the
/// OS-level fallback path can still try SIGTERM after this returns false.
fn post_iriumd_stop_rpc() -> bool {
    let token = RPC_TOKEN.get().cloned().unwrap_or_default();
    let client = match reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    match client
        .post("http://127.0.0.1:38300/rpc/stop")
        .bearer_auth(&token)
        .send()
    {
        Ok(r) => r.status().is_success(),
        Err(_) => false,
    }
}

/// Tries iriumd's /rpc/stop endpoint first, then falls back to an OS-
/// level soft signal (SIGTERM on Unix, taskkill no-/F on Windows) only
/// if the RPC request failed. Polls `iriumd_rpc_alive` up to `timeout_ms`
/// for the RPC port to go quiet. Returns true if iriumd has exited
/// within the budget, false otherwise.
///
/// Why two channels:
///   1. /rpc/stop is the only graceful path that actually fires in the
///      Tauri-sidecar case. iriumd is spawned with CREATE_NO_WINDOW so
///      it has no console, which means tokio::signal::ctrl_c() never
///      receives anything on the iriumd side. The HTTP path bypasses
///      the console subsystem entirely. iriumd's stop_handler runs the
///      same flush+drain logic as the SIGTERM handler (see
///      irium-source/src/bin/iriumd.rs:stop_handler) then exits via
///      std::process::exit(0), so the poll below sees the RPC port go
///      quiet and returns true with no force-kill needed.
///   2. The OS-level soft signal stays as a backup for two scenarios:
///      (a) iriumd's RPC has hung but the persist task is still healthy
///          — the SIGTERM handler can still drain even if HTTP cannot
///          respond; and
///      (b) on Linux/macOS pkill -TERM is the familiar fallback for
///          users used to managing daemons.
///
/// On Windows the OS-level fallback is mostly a no-op (taskkill without
/// /F sends WM_CLOSE which a console-less app does not consume) — kept
/// for cheap-and-harmless symmetry when /rpc/stop already succeeded.
fn try_iriumd_graceful_shutdown(timeout_ms: u64) -> bool {
    let rpc_ok = post_iriumd_stop_rpc();

    if !rpc_ok {
        #[cfg(target_os = "windows")]
        {
            for name in [
                "iriumd-x86_64-pc-windows-msvc.exe",
                "iriumd.exe",
            ] {
                let _ = silent_command("taskkill")
                    .args(["/IM", name])
                    .output();
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = silent_command("pkill")
                .args(["-TERM", "-f", "iriumd"])
                .output();
        }
    }

    let start = std::time::Instant::now();
    let deadline = std::time::Duration::from_millis(timeout_ms);
    let poll_interval = std::time::Duration::from_millis(250);
    while start.elapsed() < deadline {
        if !iriumd_rpc_alive() {
            return true;
        }
        std::thread::sleep(poll_interval);
    }
    false
}

/// Soft-shutdown iriumd, escalating to force-kill on timeout. Takes the
/// AppState's `node_process` Arc directly so it can be invoked from both
/// async Tauri command bodies and the synchronous .run() event closure.
fn shutdown_iriumd_soft_then_force(
    node_process: &Arc<Mutex<Option<CommandChild>>>,
    timeout_ms: u64,
) {
    let exited = try_iriumd_graceful_shutdown(timeout_ms);

    // Clear the GUI-spawned child handle. If iriumd exited cleanly the
    // kill() below is a no-op (process already gone); if it didn't, this
    // is the TerminateProcess escalation for the GUI-tracked child.
    if let Ok(mut g) = node_process.lock() {
        if let Some(child) = g.take() {
            if !exited {
                let _ = child.kill();
            }
        }
    }

    // Force-kill any externally-started iriumd that is still alive. Skipped
    // when the graceful path already worked since taskkill /F against a
    // missing process is harmless but spends ~100 ms on CMD spawn overhead.
    if !exited {
        #[cfg(target_os = "windows")]
        {
            let _ = silent_command("taskkill")
                .args(["/F", "/T", "/IM", "iriumd-x86_64-pc-windows-msvc.exe"])
                .output();
            let _ = silent_command("taskkill")
                .args(["/F", "/T", "/IM", "iriumd.exe"])
                .output();
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = silent_command("pkill").args(["-9", "-f", "iriumd"]).output();
        }
    }
}

#[tauri::command]
async fn stop_node(state: State<'_, AppState>) -> Result<bool, String> {
    // Graceful iriumd shutdown first (5 s timeout) — on Unix this triggers
    // the persist-queue drain handler; on Windows the timeout lapses and
    // we still force-kill until iriumd ships a ctrl-c handler upstream.
    shutdown_iriumd_soft_then_force(&state.node_process, 5000);

    // Explorer sidecar has no persistent state; force-kill is fine.
    {
        let mut proc_lock = state.explorer_process.lock().map_err(lock_err)?;
        if let Some(child) = proc_lock.take() {
            let _ = child.kill();
        }
    }
    // Also kill any externally-started explorer (handles processes started
    // outside the GUI). silent_command applies CREATE_NO_WINDOW on Windows
    // so taskkill does not flash a CMD window per invocation.
    #[cfg(target_os = "windows")]
    {
        let _ = silent_command("taskkill")
            .args(["/F", "/T", "/IM", "irium-explorer-x86_64-pc-windows-msvc.exe"])
            .output();
        let _ = silent_command("taskkill")
            .args(["/F", "/T", "/IM", "irium-explorer.exe"])
            .output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = silent_command("pkill")
            .args(["-9", "-f", "irium-explorer"])
            .output();
    }
    Ok(true)
}

// clear_node_state: wipes ~/.irium/state/ and ~/.irium/blocks/ so iriumd resyncs
// from scratch on next start. Wallet files and bootstrap config are preserved.
#[tauri::command]
async fn clear_node_state(state: State<'_, AppState>) -> Result<bool, String> {
    // Graceful iriumd shutdown first (5 s timeout) so its persist queue
    // gets drained on Unix and its file handles are released cleanly on
    // Windows before the destructive remove_dir_all below.
    shutdown_iriumd_soft_then_force(&state.node_process, 5000);

    // Even after a graceful exit, give the OS a beat to release file
    // handles before we touch the data dir. The wipe is destructive so a
    // residual handle here would surface as a permission-denied error
    // the user has to retry past.
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

// Result struct for reset_node_state_keep_blocks. Reported back to the
// frontend so the Settings UI can show the user the path to the backup
// (and the state_existed flag lets the modal display "no state to back
// up" gracefully for fresh installs).
#[derive(serde::Serialize)]
struct ResetNodeStateResult {
    success: bool,
    backup_path: String,
    state_existed: bool,
}

// reset_node_state_keep_blocks: lighter alternative to clear_node_state.
// Kills the local iriumd sidecar, renames ~/.irium/state/ to
// ~/.irium/state.bak-<unix_ms>/, and re-creates a fresh state dir via
// setup_data_dir_inner. PRESERVES ~/.irium/blocks/ so iriumd rebuilds
// the in-memory UTXO set from local block files on next start (~5-15
// min) instead of resyncing from the network (~hours).
//
// Use this when a user reports transaction-verification failures or
// other UTXO-state corruption symptoms. clear_node_state remains the
// nuclear option for full-resync scenarios (suspected block corruption).
//
// rename() is atomic on a single filesystem - which ~/.irium/state and
// ~/.irium/state.bak-* always are (same parent dir). No cross-device
// fallback needed.
#[tauri::command]
async fn reset_node_state_keep_blocks(state: State<'_, AppState>) -> Result<ResetNodeStateResult, String> {
    // Graceful iriumd shutdown first (5 s timeout). Same rationale as
    // clear_node_state — let the persist queue drain and the OS release
    // file handles before we rename ~/.irium/state out from under iriumd.
    shutdown_iriumd_soft_then_force(&state.node_process, 5000);

    // OS handle-release cushion before the rename.
    std::thread::sleep(std::time::Duration::from_millis(1500));

    let home_dir = dirs::home_dir()
        .ok_or_else(|| "Cannot determine home directory".to_string())?;
    let irium_dir = home_dir.join(".irium");
    let state_dir = irium_dir.join("state");

    // Millisecond-precision suffix avoids collision on rapid double-click.
    let unix_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("Cannot read system time: {}", e))?
        .as_millis();
    let backup_path = irium_dir.join(format!("state.bak-{}", unix_ms));

    let state_existed = state_dir.exists();
    if state_existed {
        std::fs::rename(&state_dir, &backup_path)
            .map_err(|e| format!("Failed to rename state dir to {}: {}", backup_path.display(), e))?;
    }

    // Recreate fresh state/ with seed files so iriumd has its bootstrap
    // peers and trust anchors ready on next start.
    let _ = setup_data_dir_inner().await;

    Ok(ResetNodeStateResult {
        success: true,
        backup_path: backup_path.display().to_string(),
        state_existed,
    })
}

// ─── Quarantined-blocks recovery ──────────────────────────────────────────────
// iriumd quarantines block files it cannot validate by renaming them into
// `<blocks>/orphaned_<unix_ts>/` (see iriumd::quarantine_single_block_file at
// src/bin/iriumd.rs:2033). Over time those directories accumulate; the node
// will re-fetch the affected heights from peers if they are simply deleted.
// These two commands let the Help page surface a "scan + clear" UX without
// asking the user to drop to a terminal.

#[derive(serde::Serialize)]
struct QuarantineScan {
    /// Total .json block files inside any orphaned_* subdir of the blocks dir.
    files: u64,
    /// Count of orphaned_* directories found.
    dirs: u64,
}

#[derive(serde::Serialize)]
struct QuarantineClearResult {
    deleted_files: u64,
    deleted_dirs: u64,
    errors: Vec<String>,
}

// Resolve the canonical blocks/ directory. Honors the app's configured
// data_dir override (Settings → Data directory) and falls back to ~/.irium/
// when no override is set.
fn blocks_dir(state: &State<'_, AppState>) -> Result<PathBuf, String> {
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let base = match data_dir {
        Some(d) if !d.trim().is_empty() => PathBuf::from(d),
        _ => dirs::home_dir()
            .ok_or_else(|| "Cannot determine home directory".to_string())?
            .join(".irium"),
    };
    Ok(base.join("blocks"))
}

// scan_quarantined_blocks: walks <blocks>/ for entries named `orphaned_*`
// and counts the regular files inside each. Returns zero counts (not an
// error) when the blocks directory does not exist — that just means the
// node has never written blocks here.
#[tauri::command]
async fn scan_quarantined_blocks(state: State<'_, AppState>) -> Result<QuarantineScan, String> {
    let dir = blocks_dir(&state)?;
    if !dir.exists() {
        return Ok(QuarantineScan { files: 0, dirs: 0 });
    }
    let mut files = 0u64;
    let mut dirs = 0u64;
    let entries = std::fs::read_dir(&dir)
        .map_err(|e| format!("read {}: {}", dir.display(), e))?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name_str) = name.to_str() else { continue };
        if !name_str.starts_with("orphaned_") {
            continue;
        }
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        dirs = dirs.saturating_add(1);
        if let Ok(inner) = std::fs::read_dir(&p) {
            for f in inner.flatten() {
                if f.path().is_file() {
                    files = files.saturating_add(1);
                }
            }
        }
    }
    Ok(QuarantineScan { files, dirs })
}

// clear_quarantined_blocks: deletes every orphaned_* directory under the
// blocks dir. Refuses to run while the node is alive — the node may still
// be writing to those paths during a reorg.
//
// Safety: only touches paths that (a) live directly under the canonical
// blocks dir and (b) have a file name starting with "orphaned_". Symlinks
// are not followed (remove_dir_all on a symlink fails on most platforms).
#[tauri::command]
async fn clear_quarantined_blocks(state: State<'_, AppState>) -> Result<QuarantineClearResult, String> {
    {
        let proc_lock = state.node_process.lock().map_err(lock_err)?;
        if proc_lock.is_some() {
            return Err("Stop the node from the Dashboard before clearing quarantined blocks.".to_string());
        }
    }
    let dir = blocks_dir(&state)?;
    if !dir.exists() {
        return Ok(QuarantineClearResult { deleted_files: 0, deleted_dirs: 0, errors: vec![] });
    }
    let mut deleted_files = 0u64;
    let mut deleted_dirs = 0u64;
    let mut errors: Vec<String> = Vec::new();
    let entries = std::fs::read_dir(&dir)
        .map_err(|e| format!("read {}: {}", dir.display(), e))?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name_str) = name.to_str() else { continue };
        if !name_str.starts_with("orphaned_") {
            continue;
        }
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        // Belt-and-braces: ensure the resolved path is still inside the
        // blocks dir before we remove_dir_all on it. read_dir entries are
        // already relative to the blocks dir, but symlinks could escape.
        if !p.starts_with(&dir) {
            errors.push(format!("skipped (outside blocks dir): {}", p.display()));
            continue;
        }
        // Count files we are about to delete (best-effort — failures here
        // just leave deleted_files lower than the actual count).
        let file_count = std::fs::read_dir(&p)
            .map(|it| it.flatten().filter(|f| f.path().is_file()).count() as u64)
            .unwrap_or(0);
        match std::fs::remove_dir_all(&p) {
            Ok(()) => {
                deleted_dirs = deleted_dirs.saturating_add(1);
                deleted_files = deleted_files.saturating_add(file_count);
            }
            Err(e) => {
                errors.push(format!("{}: {}", p.display(), e));
            }
        }
    }
    Ok(QuarantineClearResult { deleted_files, deleted_dirs, errors })
}

// ─── Quarantine-dismissal persistence ─────────────────────────────────────────
// The recovery banner used a store-only `dismissed` flag that reset on every
// cold launch — so the warning re-appeared every time the user opened the app,
// even after they had explicitly hidden it. We now fingerprint the dismissed
// state by orphan-dir count and persist it to `<data_dir>/.quarantine_dismissed`.
// If a later scan reports MORE orphan dirs than the stored fingerprint, the
// banner re-surfaces — preserving the signal for genuine new corruption.
// Passing 0 to set_quarantine_dismissed deletes the marker (clean slate after
// a successful clear).

fn quarantine_dismissed_path(state: &State<'_, AppState>) -> Result<PathBuf, String> {
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let base = match data_dir {
        Some(d) if !d.trim().is_empty() => PathBuf::from(d),
        _ => dirs::home_dir()
            .ok_or_else(|| "Cannot determine home directory".to_string())?
            .join(".irium"),
    };
    Ok(base.join(".quarantine_dismissed"))
}

#[tauri::command]
async fn get_quarantine_dismissed(state: State<'_, AppState>) -> Result<Option<u64>, String> {
    let path = quarantine_dismissed_path(&state)?;
    if !path.exists() {
        return Ok(None);
    }
    match std::fs::read_to_string(&path) {
        Ok(contents) => Ok(contents.trim().parse::<u64>().ok()),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
async fn set_quarantine_dismissed(state: State<'_, AppState>, dirs: u64) -> Result<(), String> {
    let path = quarantine_dismissed_path(&state)?;
    if dirs == 0 {
        if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|e| format!("remove {}: {}", path.display(), e))?;
        }
        return Ok(());
    }
    let parent = path.parent()
        .ok_or_else(|| "quarantine dismissed path has no parent".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("create_dir_all {}: {}", parent.display(), e))?;
    let tmp = parent.join(".quarantine_dismissed.tmp");
    std::fs::write(&tmp, dirs.to_string())
        .map_err(|e| format!("write {}: {}", tmp.display(), e))?;
    std::fs::rename(&tmp, &path)
        .map_err(|e| format!("rename {} -> {}: {}", tmp.display(), path.display(), e))?;
    Ok(())
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
    let client = rpc_client(&state);
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

    match get_rpc_info(&state, &rpc_url).await {
        Ok(info) => {
            let tip = info.best_header_tip.as_ref()
                .map(|t| t.hash.clone())
                .unwrap_or_default();
            let local_height = info.height.unwrap_or(0);
            let peers = info.peer_count.unwrap_or(0);

            // Query /peers to get heights reported by each connected peer.
            // This gives the true network tip, not just what iriumd has locally committed.
            let peer_max_height: u64 = {
                let client = rpc_client(&state);
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

            // FIX 1 interim mitigation — see NodeStatus docstring. After a
            // local iriumd restart the in-memory tip can be ahead of the
            // persisted state by `gap_healer_pending_count` blocks while
            // the gap healer replays them. Any /rpc/utxos response during
            // that window can return stale UTXOs that produce a wallet-side
            // signing failure surfaced as "Transaction signature verification
            // failed". Send button is gated on `fully_synced` so the user
            // can't broadcast until persistence has caught up.
            let persisted_height = info.persisted_height.unwrap_or(0);
            let gap_healer_pending_count = info.gap_healer_pending_count.unwrap_or(0);
            let fully_synced = synced
                && persisted_height == local_height
                && gap_healer_pending_count == 0;

            let upnp_ip = state.upnp_external_ip.lock().map_err(lock_err)?.clone();
            let upnp_double_nat = *state.upnp_double_nat.lock().map_err(lock_err)?;
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
                upnp_double_nat,
                persisted_height,
                gap_healer_pending_count,
                fully_synced,
            };
            *state.last_node_status.lock().map_err(lock_err)? = Some(status.clone());
            Ok(status)
        }
        Err(_) => {
            // RPC not reachable — node is offline
            *state.last_node_status.lock().map_err(lock_err)? = None;
            let upnp_ip = state.upnp_external_ip.lock().map_err(lock_err)?.clone();
            let upnp_double_nat = *state.upnp_double_nat.lock().map_err(lock_err)?;
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
                upnp_double_nat,
                persisted_height: 0,
                gap_healer_pending_count: 0,
                fully_synced: false,
            })
        }
    }
}

// ============================================================
// WALLET COMMANDS
// ============================================================

// wallet_get_balance: queries iriumd's /wallet/addresses (encryption-aware
// in-memory wallet) then sums per-address balances via /rpc/balance. Previously
// shelled out to irium-wallet's `list-addresses` which returns an empty list
// for encrypted wallets because irium-wallet's WalletFile struct has no
// `crypto` field — producing a misleading zero balance.
#[tauri::command]
async fn wallet_get_balance(state: State<'_, AppState>) -> Result<WalletBalance, String> {
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    let resp: WalletAddressesRpcResponse =
        iriumd_rpc(state.clone(), "GET", "/wallet/addresses", None, None)
            .await
            .map_err(|e| format!("Failed to list addresses for balance: {}", e))?;

    if resp.addresses.is_empty() {
        return Ok(WalletBalance { confirmed: 0, unconfirmed: 0, total: 0 });
    }

    let client = rpc_client(&state);
    let mut total: u64 = 0;
    for addr in &resp.addresses {
        let url = format!("{}/rpc/balance?address={}", rpc_url, addr);
        if let Ok(resp) = client.get(&url).timeout(Duration::from_secs(5)).send().await {
            if let Ok(b) = resp.json::<RpcBalance>().await {
                total = total.saturating_add(b.balance);
            }
        }
    }

    Ok(WalletBalance { confirmed: total, unconfirmed: 0, total })
}

// wallet_new_address: derives a new address via iriumd's POST /wallet/new_address,
// which mutates the in-memory unlocked wallet and persists the updated keys
// back to the (encrypted) file. CLI's `new-address` reads/writes the plaintext
// `seed_hex` field directly and fails on encrypted wallets.
#[tauri::command]
async fn wallet_new_address(state: State<'_, AppState>) -> Result<String, String> {
    let resp: WalletReceiveRpcResponse =
        iriumd_rpc(state, "POST", "/wallet/new_address", None, Some(serde_json::json!({}))).await?;
    if resp.address.is_empty() {
        return Err("wallet/new_address returned empty address".to_string());
    }
    Ok(resp.address)
}

// wallet_list_addresses: queries iriumd's /wallet/addresses (encryption-aware)
// instead of shelling out to irium-wallet's `list-addresses` which iterates
// `wallet.keys[]` and returns empty on encrypted wallets.
#[tauri::command]
async fn wallet_list_addresses(state: State<'_, AppState>) -> Result<Vec<AddressInfo>, String> {
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let resp: WalletAddressesRpcResponse =
        iriumd_rpc(state.clone(), "GET", "/wallet/addresses", None, None).await?;

    let client = rpc_client(&state);
    let mut results = Vec::with_capacity(resp.addresses.len());
    for (idx, address) in resp.addresses.into_iter().enumerate() {
        let balance = fetch_address_balance_sats(&client, &rpc_url, &address).await;
        results.push(AddressInfo { address, label: None, balance, index: Some(idx as u32) });
    }

    Ok(results)
}

// wallet_send: routes through iriumd's POST /wallet/send so it operates on
// the in-memory unlocked wallet (which knows about encryption). The historical
// CLI sidecar path is encryption-blind — irium-wallet's WalletFile struct has
// no `crypto` field, so on an encrypted wallet it parses `keys: []` and every
// send fails with "From address not found in wallet". iriumd's handler
// validates the from_address against the decrypted in-memory keymap and signs
// locally.
//
// coin_select: forwarded as `coin_select` to the RPC. Accepts "smallest"
//   (default — drains dust first, larger tx, more fee) or "largest" (picks
//   bigger UTXOs first — fewer inputs, smaller tx, lower fee, but leaves
//   small UTXOs unconsolidated). Any other value is rejected here so we
//   don't propagate garbage to iriumd. We default to "smallest" so behaviour
//   matches the prior CLI default exactly.
//
// fee_sats: legacy absolute-satoshi fee from the CLI era. iriumd's
//   /wallet/send only exposes `fee_per_byte` (rate). We approximate by
//   dividing fee_sats by an estimated tx size of 225 bytes (1 P2PKH input +
//   2 P2PKH outputs — the canonical send shape). Multi-input sends may
//   diverge by ±50 sats from the user's exact request. When fee_sats is
//   None we omit fee_per_byte and let iriumd auto-estimate from its live
//   mempool floor.
#[derive(Debug, serde::Deserialize)]
struct WalletSendRpcResponse {
    txid: String,
    #[serde(default)]
    #[allow(dead_code)]
    accepted: bool,
    #[serde(default)]
    #[allow(dead_code)]
    fee: u64,
    #[serde(default)]
    #[allow(dead_code)]
    total_input: u64,
    #[serde(default)]
    #[allow(dead_code)]
    change: u64,
}

// Shared response types for the read-path RPCs the desktop wallet now
// consults instead of the encryption-blind irium-wallet CLI.
#[derive(Debug, serde::Deserialize)]
struct WalletAddressesRpcResponse {
    addresses: Vec<String>,
}

#[derive(Debug, serde::Deserialize)]
struct WalletReceiveRpcResponse {
    address: String,
}

#[derive(Debug, serde::Deserialize)]
struct WalletExportWifRpcResponse {
    #[serde(default)]
    #[allow(dead_code)]
    address: String,
    wif: String,
}

#[derive(Debug, serde::Deserialize)]
struct WalletExportSeedRpcResponse {
    seed_hex: String,
}

#[derive(Debug, serde::Deserialize)]
struct WalletMnemonicRpcResponse {
    mnemonic: String,
}

#[derive(Debug, serde::Deserialize)]
struct WalletImportWifRpcResponse {
    #[serde(default)]
    #[allow(dead_code)]
    address: String,
}

// Minimal projection of iriumd's /wallet/info response — the desktop wallet
// only needs to know whether the active wallet is currently unlocked before
// it issues /wallet/send. Other fields of /wallet/info (mode, path,
// plaintext_backups) are read elsewhere via raw rpc_proxy.
#[derive(Debug, serde::Deserialize)]
struct WalletInfoRpcResponseLite {
    #[serde(default)]
    is_unlocked: bool,
    #[serde(default)]
    #[allow(dead_code)]
    exists: bool,
}

// Helper: call iriumd's HTTP API via the existing rpc_proxy and deserialize
// the JSON response into a typed struct. All the read-path commands below use
// this so the failure mode is uniform — RPC HTTP errors (locked wallet,
// iriumd not yet running, network) propagate verbatim instead of being
// silently swallowed.
async fn iriumd_rpc<T: serde::de::DeserializeOwned>(
    state: State<'_, AppState>,
    method: &str,
    path: &str,
    query: Option<HashMap<String, String>>,
    body: Option<serde_json::Value>,
) -> Result<T, String> {
    let v = rpc_proxy(state, method.to_string(), path.to_string(), query, body).await?;
    serde_json::from_value(v).map_err(|e| format!("rpc {} {} parse failed: {}", method, path, e))
}

/// Settlement-side shared wallet-unlock pre-check. Mirrors the inline check
/// wallet_send already does inline (search "Pre-check the unlock state via
/// /wallet/info" above), but extracted into a callable helper so every
/// settlement handler can refuse early with a structured, user-actionable
/// error instead of bubbling up a cryptic wallet-CLI stderr like
/// "Wallet command failed: <encrypted file: missing password>".
///
/// The "WALLET_LOCKED:" prefix is a machine-readable tag the frontend can
/// pattern-match to trigger an unlock-prompt UI without parsing English.
async fn ensure_wallet_unlocked(state: State<'_, AppState>) -> Result<(), String> {
    let info: WalletInfoRpcResponseLite =
        iriumd_rpc(state, "GET", "/wallet/info", None, None)
            .await
            .map_err(|e| format!("Could not check wallet state: {}", e))?;
    if !info.is_unlocked {
        return Err(
            "WALLET_LOCKED: Your wallet is locked. Please enter your password to unlock it."
                .to_string(),
        );
    }
    Ok(())
}

#[tauri::command]
async fn wallet_send(
    state: State<'_, AppState>,
    from_address: String,
    to: String,
    amount_sats: u64,
    fee_sats: Option<u64>,
    coin_select: Option<String>,
) -> Result<SendResult, String> {
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    let mode = coin_select.as_deref().unwrap_or("smallest");
    if mode != "smallest" && mode != "largest" {
        return Err(format!(
            "invalid coin_select value: {} (expected 'smallest' or 'largest')",
            mode
        ));
    }

    // Pre-check the unlock state via /wallet/info so we can surface a clear
    // "wallet is locked" message instead of the opaque HTTP 400 the user
    // would otherwise see. iriumd's wallet_send returns 400 for the
    // wallet-locked case and older builds (≤ v1.9.44) emit an empty body,
    // making the locked state indistinguishable from any other 400 reason
    // from the GUI's perspective.
    let info: WalletInfoRpcResponseLite =
        iriumd_rpc(state.clone(), "GET", "/wallet/info", None, None)
            .await
            .map_err(|e| format!("Could not check wallet state: {}", e))?;
    if !info.is_unlocked {
        return Err(
            "Your wallet is locked. Please enter your password to unlock it before sending."
                .to_string(),
        );
    }

    let amount_irm = format!("{:.8}", sats_to_irm(amount_sats));
    let mut body = serde_json::json!({
        "to_address": to.clone(),
        "amount": amount_irm,
        "from_address": from_address,
        "coin_select": mode,
    });
    if let Some(fee_abs) = fee_sats {
        if fee_abs > 0 {
            const APPROX_TX_BYTES: u64 = 225;
            let rate = fee_abs.saturating_add(APPROX_TX_BYTES - 1) / APPROX_TX_BYTES;
            body["fee_per_byte"] = serde_json::Value::from(rate);
        }
    }

    let url = format!("{}/wallet/send", rpc_url.trim_end_matches('/'));
    let client = rpc_client(&state);
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("/wallet/send request failed: {}", e))?;

    let status = resp.status();
    let raw = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        // iriumd v1.9.45+ returns {"error":"reason"} for known failure modes
        // (wallet_locked, insufficient_funds, invalid_address, invalid_amount,
        // no_utxos, from_address_not_in_wallet, change_address_not_in_wallet,
        // fee_calc_failed). Decode and surface a friendly message; pass
        // through verbatim for older iriumd builds that return empty bodies.
        if let Ok(err_obj) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(reason) = err_obj.get("error").and_then(|v| v.as_str()) {
                let friendly = match reason {
                    "wallet_locked" =>
                        "Your wallet is locked. Please enter your password to unlock it before sending.".to_string(),
                    "insufficient_funds" =>
                        "Insufficient funds. The selected address does not have enough IRM to cover the amount plus fee.".to_string(),
                    "no_utxos" =>
                        "No spendable funds at the selected From address.".to_string(),
                    "invalid_address" =>
                        "One of the addresses is invalid. Please check the From and To addresses.".to_string(),
                    "invalid_amount" =>
                        "The amount is invalid. Please enter a positive value.".to_string(),
                    "from_address_not_in_wallet" =>
                        "The selected From address is not owned by this wallet.".to_string(),
                    "change_address_not_in_wallet" =>
                        "The change address is not owned by this wallet.".to_string(),
                    other => format!("Send failed: {}", other),
                };
                return Err(friendly);
            }
        }
        return Err(format!("/wallet/send returned HTTP {}: {}", status, raw));
    }

    let parsed: WalletSendRpcResponse = serde_json::from_str(&raw)
        .map_err(|e| format!("/wallet/send response parse failed: {} (body: {})", e, raw))?;
    let txid = parsed.txid;
    if txid.len() != 64 || !txid.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!("wallet returned invalid txid: {}", txid));
    }
    // FIX #126: capture this outgoing tx in the pending-tx cache so the
    // GUI can render it as Pending immediately, before iriumd mines it.
    // wallet_transactions will cull this entry on the next poll once
    // the txid appears in confirmed /rpc/history. amount is negated
    // (outgoing convention used by /rpc/history) and fee carried through.
    {
        let mut cache = state.pending_txs.lock().map_err(lock_err)?;
        cache.insert(
            txid.clone(),
            Transaction {
                txid: txid.clone(),
                amount: -(amount_sats as i64),
                fee: fee_sats,
                confirmations: 0,
                height: None,
                timestamp: Some(
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or(0),
                ),
                direction: "sent".to_string(),
                address: Some(to.clone()),
                is_coinbase: Some(false),
                pending: Some(true),
            },
        );
    }
    Ok(SendResult { txid, amount: amount_sats, fee: fee_sats.unwrap_or(0) })
}

/// FIX #126: return all pending entries this wallet has broadcast in
/// the current session. The cache is in-memory only - app restart
/// clears it (in which case the GUI just won't show the Pending badge
/// until the tx confirms via /rpc/history). Sorted newest-first.
#[tauri::command]
async fn wallet_pending_transactions(
    state: State<'_, AppState>,
    address: Option<String>,
) -> Result<Vec<Transaction>, String> {
    let cache = state.pending_txs.lock().map_err(lock_err)?;
    let mut out: Vec<Transaction> = cache
        .values()
        .filter(|tx| match address.as_deref() {
            Some(addr) => tx.address.as_deref() == Some(addr),
            None => true,
        })
        .cloned()
        .collect();
    out.sort_by(|a, b| b.timestamp.unwrap_or(0).cmp(&a.timestamp.unwrap_or(0)));
    Ok(out)
}

// wallet_transactions: queries /rpc/history for each wallet address
#[tauri::command]
async fn wallet_transactions(
    state: State<'_, AppState>,
    limit: Option<u32>,
    address: Option<String>,
) -> Result<Vec<Transaction>, String> {
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    // If the caller passes an explicit `address`, query only that one —
    // mirrors the RPC's `?address=` filter. Otherwise fall back to listing
    // every wallet address (via iriumd's /wallet/addresses RPC so encrypted
    // wallets work) and concatenating their histories (legacy "all
    // transactions" behaviour used by the Dashboard's recent-activity feed).
    let addresses: Vec<String> = if let Some(addr) = address {
        let trimmed = addr.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }
        vec![trimmed.to_string()]
    } else {
        // H-2 fix: previously `.unwrap_or_default()` returned an empty list on
        // wallet binary failure, indistinguishable from a wallet that has no
        // transactions. Propagate the error so the UI can surface it.
        let resp: WalletAddressesRpcResponse =
            iriumd_rpc(state.clone(), "GET", "/wallet/addresses", None, None)
                .await
                .map_err(|e| format!("Failed to list addresses for transaction history: {}", e))?;
        resp.addresses
    };

    let client = rpc_client(&state);
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
                        pending: None,
                    });
                }
            }
        }
    }

    // FIX #126: cull pending-tx cache entries that now appear as confirmed
    // history entries, then merge any remaining pending entries onto the
    // front of the list. The cull happens here (not in wallet_send) so
    // the cache stays clean even if the GUI never explicitly polls
    // wallet_pending_transactions.
    let pending_to_prepend: Vec<Transaction> = {
        let mut cache = state.pending_txs.lock().map_err(lock_err)?;
        let confirmed_txids: std::collections::HashSet<&str> =
            all_txs.iter().map(|t| t.txid.as_str()).collect();
        // Cull confirmed entries from the cache.
        cache.retain(|txid, _| !confirmed_txids.contains(txid.as_str()));
        // Snapshot remaining pending entries (filtered by --address when set).
        cache
            .values()
            .filter(|tx| match address_filter_for_pending(&addresses) {
                Some(addr) => tx.address.as_deref() == Some(addr),
                None => true,
            })
            .cloned()
            .collect()
    };

    // L-6 fix: sort by descending block height (then unconfirmed last) BEFORE
    // truncating to `limit`. Previously `truncate(n)` returned the first N
    // entries by collection order — for a wallet with 3 addresses × 100 txs
    // each and limit=10, the result was the first 10 of address[0] rather
    // than the 10 most recent across all addresses.
    all_txs.sort_by(|a, b| {
        let bh = b.height.unwrap_or(u64::MAX);
        let ah = a.height.unwrap_or(u64::MAX);
        bh.cmp(&ah)
    });

    // FIX #126: prepend pending entries so they show at the top of the
    // list. They have height=None so the height sort above would push
    // them last; prepending here gives them the correct visual priority.
    let mut merged: Vec<Transaction> = pending_to_prepend;
    merged.extend(all_txs);
    if let Some(n) = limit {
        merged.truncate(n as usize);
    }

    Ok(merged)
}

/// FIX #126 helper: when wallet_transactions was called with an explicit
/// address argument, restrict the prepended pending entries to ones
/// matching that address. When called without (the all-addresses
/// branch), return None so every pending entry passes the filter.
fn address_filter_for_pending(addresses: &[String]) -> Option<&str> {
    if addresses.len() == 1 {
        Some(addresses[0].as_str())
    } else {
        None
    }
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
    // `crypto` is the encrypted-wallet envelope written by iriumd's
    // migrate_to_encrypted / recover_from_seed paths. Some iriumd builds
    // strip the plaintext `keys` placeholder on encryption, so without this
    // marker an encrypted wallet's file could fail the content sniff and the
    // OnboardingGate would re-show the wizard. Defence in depth — the
    // OnboardingGate also consults /wallet/info before falling through here.
    obj.contains_key("crypto")
        || obj.contains_key("bip32_seed")
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

    // Inspecting a wallet file's addresses without activating it. Two paths:
    //   (a) If the requested file IS the currently active wallet, ask iriumd
    //       via GET /wallet/addresses — works for encrypted wallets because
    //       iriumd holds the decrypted keymap in memory.
    //   (b) Otherwise we cannot get addresses for an encrypted non-active
    //       wallet (iriumd only tracks one wallet, and the CLI is
    //       encryption-blind). Parse the file directly and read whatever
    //       `keys[]` entries are present in plaintext (empty array on
    //       encrypted files); the UI's delete-confirmation modal will show
    //       "encrypted wallet (locked)" semantics when address_count is 0.
    let rpc_url  = state.rpc_url.lock().map_err(lock_err)?.clone();
    let active_path = state.wallet_path.lock().map_err(lock_err)?.clone()
        .unwrap_or_else(resolve_wallet_path);
    let inspect_path_str = canonical.to_string_lossy().to_string();
    let is_active = std::path::PathBuf::from(&active_path)
        .canonicalize()
        .ok()
        .as_deref()
        == Some(canonical.as_path());

    let raw_addrs: Vec<String> = if is_active {
        match iriumd_rpc::<WalletAddressesRpcResponse>(state.clone(), "GET", "/wallet/addresses", None, None).await {
            Ok(resp) => resp.addresses,
            Err(_) => Vec::new(),
        }
    } else {
        // Direct file parse — non-active wallet file. For encrypted wallets
        // this is empty by design (keys are encrypted inside `crypto`).
        let _ = inspect_path_str;
        let contents = std::fs::read_to_string(&canonical).unwrap_or_default();
        match serde_json::from_str::<serde_json::Value>(&contents) {
            Ok(v) => v
                .get("keys")
                .and_then(|k| k.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|k| k.get("address").and_then(|a| a.as_str()).map(String::from))
                        .collect()
                })
                .unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    };

    let client = rpc_client(&state);
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

    // Compare against the explicitly-active wallet path. As of v1.0.55
    // state.wallet_path is always Some(_) — AppState::new seeds it with
    // resolve_wallet_path() and set_wallet_config falls back to the same
    // default when a persisted path is missing. The `if let Some` arm is
    // kept defensively; when the active path doesn't exist on disk
    // canonicalize().ok() returns None, so the equality check naturally
    // fails and the deletion proceeds.
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

// ── Tauri shell wrappers for the unified-wallet RPCs ──────────────────────
// These three commands proxy to iriumd's GET /wallet/info,
// POST /wallet/migrate_to_encrypted, and POST /wallet/recover_from_seed.
// The frontend's rpcCall.* helpers also reach the same endpoints via the
// generic rpc_proxy, so these dedicated wrappers are sugar for callers
// that want strongly-typed invocations and the per-command Tauri
// permission/logging story that comes with a dedicated #[tauri::command].
#[tauri::command]
async fn wallet_node_info(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    rpc_proxy(state, "GET".to_string(), "/wallet/info".to_string(), None, None).await
}

#[tauri::command]
async fn wallet_migrate_to_encrypted(
    state: State<'_, AppState>,
    passphrase: String,
) -> Result<serde_json::Value, String> {
    if passphrase.is_empty() {
        return Err("password_required".to_string());
    }
    let body = serde_json::json!({ "passphrase": passphrase });
    rpc_proxy(
        state,
        "POST".to_string(),
        "/wallet/migrate_to_encrypted".to_string(),
        None,
        Some(body),
    )
    .await
}

#[tauri::command]
async fn wallet_recover_from_seed(
    state: State<'_, AppState>,
    seed_hex: String,
    passphrase: String,
    allow_overwrite: Option<bool>,
) -> Result<serde_json::Value, String> {
    if passphrase.is_empty() {
        return Err("password_required".to_string());
    }
    if seed_hex.is_empty() {
        return Err("seed_required".to_string());
    }
    let body = serde_json::json!({
        "seed_hex": seed_hex,
        "passphrase": passphrase,
        "allow_overwrite": allow_overwrite.unwrap_or(false),
    });
    rpc_proxy(
        state,
        "POST".to_string(),
        "/wallet/recover_from_seed".to_string(),
        None,
        Some(body),
    )
    .await
}

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
// Imports a WIF private key into the active wallet via iriumd's
// POST /wallet/import_wif. iriumd appends the derived key into the
// in-memory keymap and re-persists the (encrypted) wallet file. CLI's
// `import-wif` writes a plaintext keys[] entry and fails on encrypted
// wallets.
#[tauri::command]
async fn wallet_import_wif(
    state: State<'_, AppState>,
    wif: String,
) -> Result<String, String> {
    let wallet_file = {
        let active = state.wallet_path.lock().map_err(lock_err)?.clone();
        match active {
            Some(ref p) if !p.is_empty() => p.clone(),
            _ => resolve_wallet_path(),
        }
    };
    let body = serde_json::json!({ "wif": wif });
    let _: WalletImportWifRpcResponse =
        iriumd_rpc(state.clone(), "POST", "/wallet/import_wif", None, Some(body)).await?;
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

// Reads the wallet's seed_hex via iriumd's GET /wallet/export_seed which
// operates on the in-memory unlocked wallet (works for both plaintext and
// encrypted). The historical CLI temp-file dance read `wallet.seed_hex`
// directly and failed on encrypted wallets where that field is absent.
#[tauri::command]
async fn wallet_export_seed(state: State<'_, AppState>) -> Result<String, String> {
    let resp: WalletExportSeedRpcResponse =
        iriumd_rpc(state, "GET", "/wallet/export_seed", None, None).await?;
    Ok(resp.seed_hex)
}

#[tauri::command]
async fn wallet_export_mnemonic(state: State<'_, AppState>) -> Result<String, String> {
    let resp: WalletMnemonicRpcResponse =
        iriumd_rpc(state, "GET", "/wallet/export_mnemonic", None, None).await?;
    Ok(resp.mnemonic)
}

// Backup is a direct file copy of the active wallet file. For encrypted
// wallets the on-disk file IS the encrypted backup blob; copying it
// verbatim preserves the same passphrase-locked envelope and is the only
// shape that round-trips through restore. The historical CLI `backup`
// re-emitted a decrypted-keys JSON dump which is (a) useless on encrypted
// wallets (the CLI sees keys=[]) and (b) less secure (writes plaintext to
// disk even when the user's intent was an encrypted-only export).
#[tauri::command]
async fn wallet_backup(state: State<'_, AppState>, out_path: String) -> Result<String, String> {
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let active_wallet = state.wallet_path.lock().map_err(lock_err)?.clone()
        .unwrap_or_else(resolve_wallet_path);
    let src = std::path::PathBuf::from(&active_wallet);
    if !src.exists() {
        return Err(format!("Active wallet file does not exist: {}", active_wallet));
    }
    let staged = next_staged_path("backup", "bak", &data_dir)?;
    std::fs::copy(&src, &staged)
        .map_err(|e| format!("Could not stage backup: {}", e))?;
    match finalize_output(&staged, &out_path) {
        Ok(()) => Ok(out_path),
        Err(e) => {
            let _ = std::fs::remove_file(&staged);
            Err(e)
        }
    }
}

// Restore replaces the active wallet file with the user-supplied backup
// file (which is itself a wallet.json — encrypted or plaintext). After the
// copy lands on disk the iriumd-side wallet state needs to be re-read; the
// caller (frontend) typically follows up with /wallet/unlock so the user
// can supply the passphrase.
#[tauri::command]
async fn wallet_restore_backup(state: State<'_, AppState>, file_path: String) -> Result<String, String> {
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let active_wallet = state.wallet_path.lock().map_err(lock_err)?.clone()
        .unwrap_or_else(resolve_wallet_path);
    let staged = stage_input(&file_path, "restore", &data_dir)?;
    // Validate that the staged file looks like a wallet (encrypted or
    // plaintext) before clobbering the active wallet — guards against an
    // accidentally-selected unrelated JSON file.
    if !is_wallet_json_file(&staged) {
        let _ = std::fs::remove_file(&staged);
        return Err("Selected file is not a valid Irium wallet backup".to_string());
    }
    let dest = std::path::PathBuf::from(&active_wallet);
    if let Some(parent) = dest.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let copy_res = std::fs::copy(&staged, &dest)
        .map_err(|e| format!("Could not write wallet file: {}", e));
    let _ = std::fs::remove_file(&staged);
    copy_res?;
    Ok("Wallet restored successfully".to_string())
}

// Exports the WIF private key for a given wallet address via iriumd's
// GET /wallet/export_wif?address=…, then writes it to the user-chosen
// output path. iriumd operates on the in-memory decrypted keymap so this
// works on encrypted wallets (after unlock). CLI's `export-wif` reads
// `wallet.keys[i].privkey` directly and fails on encrypted wallets where
// the keys array is empty.
#[tauri::command]
async fn wallet_export_wif(
    state: State<'_, AppState>,
    address: String,
    out_path: String,
) -> Result<String, String> {
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let mut query = HashMap::new();
    query.insert("address".to_string(), address.clone());
    let resp: WalletExportWifRpcResponse =
        iriumd_rpc(state, "GET", "/wallet/export_wif", Some(query), None).await?;
    let staged = next_staged_path("wif", "txt", &data_dir)?;
    std::fs::write(&staged, &resp.wif)
        .map_err(|e| format!("Could not stage WIF: {}", e))?;
    match finalize_output(&staged, &out_path) {
        Ok(()) => Ok(out_path),
        Err(e) => {
            let _ = std::fs::remove_file(&staged);
            Err(e)
        }
    }
}

// wallet_read_wif: returns the WIF for an address inline (no file output).
// Used by the UI to display the key in a copyable field. Routes through
// iriumd's GET /wallet/export_wif so encrypted wallets work after unlock.
//
// The legacy `wallet_path` parameter is kept in the Tauri signature for JS
// backwards-compatibility but is no longer consulted — iriumd's export_wif
// operates on the active in-memory wallet. If callers passed a path
// different from the active wallet, the previous CLI behaviour read the
// other file via IRIUM_WALLET_FILE; that flow was only useful during
// wallet_create's pre-registration window (handleCreate), which no longer
// applies because wallet_create itself returns the address and the
// subsequent wallet_set_path activates the new wallet before any WIF read.
#[tauri::command]
async fn wallet_read_wif(
    state: State<'_, AppState>,
    address: String,
    wallet_path: Option<String>,
) -> Result<String, String> {
    let _ = wallet_path; // legacy param — see header comment
    let mut query = HashMap::new();
    query.insert("address".to_string(), address);
    let resp: WalletExportWifRpcResponse =
        iriumd_rpc(state, "GET", "/wallet/export_wif", Some(query), None).await?;
    Ok(resp.wif)
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
    let height = get_current_height(&state, &rpc_url).await;
    let timeout = height + params.timeout_blocks.unwrap_or(1000);

    // offer-create --seller <addr> --amount <irm> --payment-method <text> --timeout <height>
    //              [--template-type <otc|freelance|milestone|deposit>]
    //              [--milestone-count <N>]
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
    // FIX 3: forward template type + milestone count to the wallet
    // sidecar so the offer JSON persists them and offer-take dispatches
    // to the correct builder.
    if let Some(tmpl) = params.template_type.as_ref().filter(|s| !s.trim().is_empty()) {
        args.push("--template-type".to_string());
        args.push(tmpl.trim().to_lowercase());
    }
    if let Some(n) = params.milestone_count {
        if n > 0 {
            args.push("--milestone-count".to_string());
            args.push(n.to_string());
        }
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
        agreement_id: raw["agreement_id"].as_str()
            .ok_or("Wallet binary returned no agreement_id field — operation may have failed silently")?
            .to_string(),
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
        // BUG 2 fix: previously surfaced as a developer-flavoured
        // "Offers directory not found" — confusing for users who tried to
        // delete a remote offer (one fetched from another seller's feed,
        // which never creates a local file). The Marketplace UI now hides
        // the Delete button for remote offers, but the backend message
        // here is the safety-net when that gate is bypassed.
        return Err(
            "This offer was received from the network and cannot be deleted locally. \
             Only offers you created can be deleted.".to_string()
        );
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
            // Defense-in-depth: refuse to delete an offer the UI shouldn't
            // even have offered a delete button for. The Marketplace page
            // gates this at the UI level, but a dev-tools or RPC-bypass
            // path could still call offer_remove on a taken offer.
            if parsed["status"].as_str() == Some("taken")
                || parsed["status"].as_str() == Some("completed")
            {
                return Err(
                    "Cannot delete a taken or completed offer. The agreement must be resolved first."
                        .to_string()
                );
            }
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

    // H-6 fix: propagate parse errors instead of silently treating any non-
    // JSON output as `{processed:0, errors:0, imported:0}` — false success.
    let raw = serde_json::from_str::<FeedSyncRawResponse>(&output)
        .map_err(|e| format!("Failed to parse offer-feed-sync output: {} | raw: {}", e, &output[..output.len().min(200)]))?;
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

    // C-3 / M-8 fix: previously buyer/seller/amount were always None/0.
    // The saved agreement file at `path` is an AgreementObject; the on-disk
    // field names are `payer` / `payee` / `total_amount` (NOT the audit's
    // assumed buyer/seller/amount). We load each file and parse those.
    // `status: "open"` was a misleading hardcode — we now use "unknown"
    // because chain status requires a per-entry `agreement-status` RPC
    // call which is too expensive to fan out across the list (the
    // Agreements UI fetches per-entry status on card expand).
    for a in response.stored_raw_agreements.unwrap_or_default() {
        let (buyer, seller, amount, template, created_at, deadline) = a.path.as_ref()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .map(|v| (
                v["payer"].as_str().map(String::from),
                v["payee"].as_str().map(String::from),
                v["total_amount"].as_u64().unwrap_or(0),
                v["template_type"].as_str().map(String::from),
                v["creation_time"].as_i64(),
                // deadlines.refund_deadline is a block height on the on-disk
                // AgreementObject. Frontend formatDeadline auto-detects
                // block-height vs unix-timestamp shape and renders the
                // right thing (Agreements.tsx P1 safety net from v1.0.100).
                v["deadlines"]["refund_deadline"].as_u64().map(|h| h as i64),
            ))
            .unwrap_or((None, None, 0, None, None, None));
        agreements.push(Agreement {
            id: a.agreement_id,
            hash: Some(a.agreement_hash),
            template,
            buyer,
            seller,
            amount,
            status: "unknown".to_string(),
            proof_status: None,
            release_eligible: None,
            created_at,
            // P1: populated from the on-disk refund_timeout (block height)
            // above. Status still hardcoded — per the existing comment, a
            // per-row chain status fetch is too expensive here; frontend
            // filter uses statusByAgreement live data instead.
            deadline,
            policy: None,
        });
    }

    Ok(agreements)
}

#[tauri::command]
async fn agreement_show(state: State<'_, AppState>, agreement_id: String) -> Result<Agreement, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    let output = run_wallet_cmd(
        vec!["agreement-inspect".to_string(), agreement_id.clone(), "--json".to_string()],
        wallet_path.clone(), data_dir.clone(),
    ).await?;

    let raw: serde_json::Value = serde_json::from_str(&output)
        .map_err(|e| format!("Parse error: {}", e))?;

    // C-2 fix: agreement-inspect emits `{agreement_hash, agreement: {...}}`
    // where the inner object holds payer / payee / total_amount / template_type.
    // The old code read from `raw["parties"]["buyer"]["addr"]` and
    // `raw["amount_satoshis"]` — neither field exists on this binary's output,
    // so buyer/seller/amount silently came back as None/0.
    let ag = &raw["agreement"];

    // C-2 fix: real status. Previously hardcoded to "open" regardless of
    // chain state. Now calls `agreement-status` (the same wallet subcommand
    // the agreement_status Tauri command uses) and falls back to "unknown"
    // if the RPC is unreachable so the rest of the agreement still renders.
    let status = match run_wallet_cmd_with_rpc(
        vec!["agreement-status".to_string(), agreement_id.clone(), "--json".to_string()],
        wallet_path, data_dir, rpc_url,
    ).await {
        Ok(out) => serde_json::from_str::<serde_json::Value>(&out)
            .ok()
            .and_then(|v| v["status"].as_str().map(String::from))
            .unwrap_or_else(|| "unknown".to_string()),
        Err(_) => "unknown".to_string(),
    };

    Ok(Agreement {
        id: ag["agreement_id"].as_str()
            .or_else(|| raw["agreement_id"].as_str())
            .unwrap_or(&agreement_id)
            .to_string(),
        hash: raw["agreement_hash"].as_str().map(String::from),
        template: ag["template_type"].as_str().map(String::from),
        buyer: ag["payer"].as_str().map(String::from),
        seller: ag["payee"].as_str().map(String::from),
        amount: ag["total_amount"].as_u64().unwrap_or(0),
        status,
        proof_status: None,
        release_eligible: None,
        // creation_time lives inside the nested agreement object, same as
        // payer/payee/total_amount — was previously read from the wrong path.
        created_at: ag["creation_time"].as_i64(),
        deadline: None,
        policy: None,
    })
}

// FIX (audit-422): iriumd's /rpc/agreementaudit expects the full
// AgreementObject (Deserialize-bound to a 30-field settlement::AgreementObject
// struct), not just the agreement hash. Sending {agreement_hash: "..."}
// failed body-extraction with HTTP 422. On top of that the endpoint runs
// require_rpc_auth, so a fixed body would still 401 without the FIX 2
// bearer token. Both are solved by routing the call through this Tauri
// command:
//   1. agreement-inspect <id> --json reconstitutes the canonical
//      AgreementObject from the wallet's on-disk record;
//   2. We POST it under the {agreement: ...} envelope iriumd expects,
//      via rpc_client which carries the GUI bearer (FIX 2 helper);
//   3. The unmodified audit JSON comes back as serde_json::Value so
//      the AuditModal's defensive field extraction keeps working.
#[tauri::command]
async fn agreement_audit(
    state: State<'_, AppState>,
    agreement_id: String,
) -> Result<serde_json::Value, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    let inspect_out = run_wallet_cmd(
        vec!["agreement-inspect".to_string(), agreement_id.clone(), "--json".to_string()],
        wallet_path,
        data_dir,
    )
    .await?;
    let raw: serde_json::Value = serde_json::from_str(&inspect_out)
        .map_err(|e| format!("Parse error on agreement-inspect output: {}", e))?;
    // agreement-inspect emits {agreement_hash, agreement: {...}} — the
    // inner `agreement` IS the AgreementObject iriumd needs.
    let inner = raw.get("agreement").cloned().ok_or_else(|| {
        "agreement-inspect output missing `agreement` object — wallet record may be corrupt"
            .to_string()
    })?;

    let body = serde_json::json!({ "agreement": inner });
    let client = rpc_client(&state);
    let resp = client
        .post(format!("{}/rpc/agreementaudit", rpc_url.trim_end_matches('/')))
        .timeout(Duration::from_secs(10))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Audit RPC request failed: {}", e))?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!(
            "Audit RPC returned HTTP {} — {}",
            status.as_u16(),
            text.chars().take(300).collect::<String>()
        ));
    }
    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Audit RPC returned malformed JSON: {}", e))
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
    ensure_wallet_unlocked(state.clone()).await?;
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    let height = get_current_height(&state, &rpc_url).await;
    let deadline_blocks = params.deadline_hours.unwrap_or(24) * BLOCKS_PER_HOUR;
    let timeout = height + deadline_blocks;

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let agreement_id = format!("settle-{}", ts);
    // FIX 1: real cryptographic preimage + SHA-256 commitment. Persist the
    // preimage BEFORE calling the wallet binary so a wallet-side failure
    // leaves at most an orphan secret file (no on-chain reference exists).
    let (secret_preimage, secret_hash) = mint_settlement_secret();
    persist_settlement_secret(&data_dir, &agreement_id, &secret_preimage)?;
    let doc_hash = format!("{:0>64x}", ts.wrapping_add(1));

    let args = vec![
        "agreement-create-simple-settlement".to_string(),
        "--agreement-id".to_string(), agreement_id.clone(),
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
        agreement_id: raw["agreement_id"].as_str()
            .ok_or("Wallet binary returned no agreement_id field — operation may have failed silently")?
            .to_string(),
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
        id: raw["agreement_id"].as_str()
            .ok_or("Wallet binary returned no agreement_id field — operation may have failed silently")?
            .to_string(),
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
    ensure_wallet_unlocked(state.clone()).await?;
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
    let raw: serde_json::Value = serde_json::from_str(&output)
        .map_err(|e| format!("agreement-release parse error: {}. Output: {}", e, &output[..output.len().min(200)]))?;
    if let Some(err) = raw.get("error").and_then(|v| v.as_str()) {
        return Err(err.to_string());
    }
    let txid = raw["txid"].as_str().map(String::from);
    Ok(ReleaseResult {
        success: txid.is_some(),
        txid,
        message: None,
    })
}

#[tauri::command]
async fn agreement_refund(
    state: State<'_, AppState>,
    agreement_id: String,
    broadcast: Option<bool>,
) -> Result<ReleaseResult, String> {
    ensure_wallet_unlocked(state.clone()).await?;
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let mut args = vec!["agreement-refund".to_string(), agreement_id, "--json".to_string()];
    if broadcast.unwrap_or(true) {
        args.push("--broadcast".to_string());
    }
    let output = run_wallet_cmd_with_rpc(args, wallet_path, data_dir, rpc_url).await?;
    let raw: serde_json::Value = serde_json::from_str(&output)
        .map_err(|e| format!("agreement-refund parse error: {}. Output: {}", e, &output[..output.len().min(200)]))?;
    if let Some(err) = raw.get("error").and_then(|v| v.as_str()) {
        return Err(err.to_string());
    }
    let txid = raw["txid"].as_str().map(String::from);
    Ok(ReleaseResult {
        success: txid.is_some(),
        txid,
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
    // H-5 fix: propagate real errors. Empty list ≠ "fetch failed".
    let output = run_wallet_cmd_with_rpc(args, wallet_path, data_dir, rpc_url).await
        .map_err(|e| format!("Failed to list proofs: {}", e))?;
    serde_json::from_str::<Vec<Proof>>(&output)
        .map_err(|e| format!("Failed to parse proof list: {} | raw: {}", e, &output[..output.len().min(200)]))
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
    ensure_wallet_unlocked(state.clone()).await?;
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
    let result = serde_json::from_str::<ProofSubmitResult>(&output)
        .map_err(|e| format!("Parse error: {} | raw: {}", e, &output[..output.len().min(200)]))?;
    if !result.success {
        return Err(result.message.unwrap_or_else(|| format!("Proof rejected by node: status={}", result.status)));
    }
    Ok(result)
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
    ensure_wallet_unlocked(state.clone()).await?;
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

/// Number of blocks per hour used by all settlement deadline / cooldown
/// conversions. Set to 60 (≈1 min/block) because the live chain runs
/// faster than the protocol's 10-min target (BLOCK_TARGET_INTERVAL=600s)
/// and we want timeouts to be meaningful in real time rather than 10×
/// longer than the user expects. Previously the codebase used `* 6`
/// (=10 min/block); raise this constant whenever the empirical block
/// rate changes materially.
const BLOCKS_PER_HOUR: u64 = 60;

// ─── FIX 1: Settlement secret generation ───────────────────────────────────
// The Settlement Hub previously generated `secret_hash` as a zero-padded
// hex unix timestamp (`format!("{:0>64x}", ts)`) — not a hash at all, and
// no preimage was ever stored. That made every Hub-created agreement
// permanently unreleasable because there was no way to satisfy the HTLC.
//
// `mint_settlement_secret()` returns a fresh 32-byte OS-random preimage
// and its SHA-256 commitment. `persist_settlement_secret()` writes the
// preimage hex to <data_dir>/.irium/agreement_secrets/<key>.hex (mode 0600
// on Unix); `load_settlement_secret()` reads it back on Release. The key
// is the agreement_id for top-level secrets and "<agreement_id>_milestone_<n>"
// for milestone-specific secrets.

fn settlement_secrets_dir(data_dir: &Option<String>) -> Result<PathBuf, String> {
    let base = data_dir
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join(".irium"));
    let dir = base.join("agreement_secrets");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("create secrets dir {}: {e}", dir.display()))?;
    Ok(dir)
}

fn mint_settlement_secret() -> (String /* preimage_hex */, String /* sha256(preimage)_hex */) {
    use sha2::{Digest, Sha256};
    let mut secret = [0u8; 32];
    getrandom::getrandom(&mut secret).expect("OS RNG must work");
    let hash = Sha256::digest(secret);
    (hex::encode(secret), hex::encode(hash))
}

fn persist_settlement_secret(
    data_dir: &Option<String>,
    key: &str,
    preimage_hex: &str,
) -> Result<(), String> {
    let dir = settlement_secrets_dir(data_dir)?;
    let path = dir.join(format!("{key}.hex"));
    std::fs::write(&path, preimage_hex)
        .map_err(|e| format!("write secret file {}: {e}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn load_settlement_secret(data_dir: &Option<String>, key: &str) -> Result<String, String> {
    let dir = settlement_secrets_dir(data_dir)?;
    let path = dir.join(format!("{key}.hex"));
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("read secret file {}: {e}", path.display()))?;
    Ok(raw.trim().to_string())
}

/// FIX 4: Build and store the proof policy for a freshly-created Hub
/// agreement so the proof + attestation flow works without the user
/// having to find and invoke `policy-build-*` themselves.
///
/// Best-effort: a policy-build failure is logged to stderr but the
/// settlement_create_* handler still returns success — the agreement is
/// already on-chain at this point and a missing policy can be re-built
/// later with the standalone `policy_build_*` Tauri commands.
///
/// Per-template mapping:
///   otc / merchant_delayed -> policy-build-otc        (attestor: seller / merchant)
///   freelance              -> policy-build-contractor (attestor: contractor, milestone slot used for the work-completed proof)
///   milestone / contractor -> policy-build-contractor x N (one per milestone)
///   deposit                -> no policy (depositor releases unilaterally)
#[allow(clippy::too_many_arguments)]
async fn auto_build_policy(
    template: &str,
    agreement_id: &str,
    agreement_hash: &str,
    attestor_addr: &str,
    milestone_count: u32,
    wallet_path: Option<String>,
    data_dir: Option<String>,
    rpc_url: String,
) {
    // Skip silently when the wallet binary returned no agreement_hash —
    // the policy command requires it and would just fail anyway.
    if agreement_hash.is_empty() {
        eprintln!(
            "[FIX 4] auto_build_policy: empty agreement_hash for {agreement_id} (template {template}) — skipping policy build"
        );
        return;
    }
    match template {
        "otc" | "merchant_delayed" => {
            let policy_id = format!("{agreement_id}_policy_otc");
            let args = vec![
                "policy-build-otc".to_string(),
                "--policy-id".to_string(), policy_id.clone(),
                "--agreement-hash".to_string(), agreement_hash.to_string(),
                "--attestor".to_string(), attestor_addr.to_string(),
                "--release-proof-type".to_string(), "payment_received".to_string(),
                "--json".to_string(),
            ];
            if let Err(e) = run_wallet_cmd_with_rpc(args, wallet_path, data_dir, rpc_url).await {
                eprintln!("[FIX 4] policy-build-otc failed for {agreement_id}: {e}");
            }
        }
        "freelance" => {
            let policy_id = format!("{agreement_id}_policy_freelance");
            let args = vec![
                "policy-build-contractor".to_string(),
                "--policy-id".to_string(), policy_id.clone(),
                "--agreement-hash".to_string(), agreement_hash.to_string(),
                "--attestor".to_string(), attestor_addr.to_string(),
                "--milestone".to_string(), "work_completed".to_string(),
                "--json".to_string(),
            ];
            if let Err(e) = run_wallet_cmd_with_rpc(args, wallet_path, data_dir, rpc_url).await {
                eprintln!("[FIX 4] policy-build-contractor (freelance) failed for {agreement_id}: {e}");
            }
        }
        "milestone" | "contractor" => {
            for i in 0..milestone_count {
                let policy_id = format!("{agreement_id}_policy_m{}", i + 1);
                let milestone_id = format!("m{}", i + 1);
                let args = vec![
                    "policy-build-contractor".to_string(),
                    "--policy-id".to_string(), policy_id,
                    "--agreement-hash".to_string(), agreement_hash.to_string(),
                    "--attestor".to_string(), attestor_addr.to_string(),
                    "--milestone".to_string(), milestone_id.clone(),
                    "--json".to_string(),
                ];
                if let Err(e) = run_wallet_cmd_with_rpc(
                    args,
                    wallet_path.clone(),
                    data_dir.clone(),
                    rpc_url.clone(),
                ).await {
                    eprintln!(
                        "[FIX 4] policy-build-contractor (milestone {}) failed for {agreement_id}: {e}",
                        milestone_id
                    );
                }
            }
        }
        "deposit" => {
            // Per spec: depositor releases unilaterally, no policy needed.
        }
        other => {
            eprintln!("[FIX 4] unknown template '{other}' — no policy built for {agreement_id}");
        }
    }
}

/// GUI-facing: returns the stored preimage for a Hub-created agreement so
/// the user can click Release without manually tracking the secret. Errors
/// when the file is absent (e.g. agreement created by a peer, or before
/// FIX 1 shipped).
#[tauri::command]
async fn get_agreement_secret(
    state: State<'_, AppState>,
    agreement_id: String,
) -> Result<String, String> {
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    load_settlement_secret(&data_dir, &agreement_id)
}

/// GUI-facing: returns the stored per-milestone preimage. Milestones are
/// indexed from 0 to (milestone_count - 1) by the settlement_create_*
/// handlers; the GUI must use the same index when calling Release for a
/// specific milestone.
#[tauri::command]
async fn get_milestone_secret(
    state: State<'_, AppState>,
    agreement_id: String,
    index: u32,
) -> Result<String, String> {
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    load_settlement_secret(&data_dir, &format!("{agreement_id}_milestone_{index}"))
}

// otc-create --buyer <addr> --seller <addr> --amount <irm> --asset <text>
//            --payment-method <text> --timeout <height> [--json]
//
// Real output: {"agreement_hash":"...","agreement_id":"...","saved_path":"..."}
#[tauri::command]
async fn settlement_create_otc(
    state: State<'_, AppState>,
    params: OtcParams,
) -> Result<AgreementResult, String> {
    ensure_wallet_unlocked(state.clone()).await?;
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    let height = get_current_height(&state, &rpc_url).await;
    let deadline_blocks = params.deadline_hours.unwrap_or(24) * BLOCKS_PER_HOUR;
    let timeout = height + deadline_blocks;
    let amount_irm = format!("{:.8}", sats_to_irm(params.amount_sats));
    let asset = params.asset_reference.unwrap_or_else(|| "IRM".to_string());
    let payment_method = params.payment_method.unwrap_or_else(|| "bank-transfer".to_string());
    // FIX 4: capture attestor + clones for the post-create auto-policy call.
    let attestor_addr = params.seller.clone();
    let policy_wallet_path = wallet_path.clone();
    let policy_data_dir = data_dir.clone();
    let policy_rpc_url = rpc_url.clone();

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

    auto_build_policy(
        "otc",
        &result.agreement_id,
        &result.agreement_hash,
        &attestor_addr,
        0,
        policy_wallet_path,
        policy_data_dir,
        policy_rpc_url,
    ).await;

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
    ensure_wallet_unlocked(state.clone()).await?;
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    let height = get_current_height(&state, &rpc_url).await;
    let deadline_blocks = params.deadline_hours.unwrap_or(48) * BLOCKS_PER_HOUR;
    let timeout = height + deadline_blocks;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default().as_secs();
    let agreement_id = format!("freelance-{}", ts);
    let (secret_preimage, secret_hash) = mint_settlement_secret();
    persist_settlement_secret(&data_dir, &agreement_id, &secret_preimage)?;
    let doc_hash = format!("{:0>64x}", ts.wrapping_add(2));

    let mut scope_text = params.scope.unwrap_or_else(|| "Freelance work".to_string());
    if scope_text.len() > 100 { scope_text.truncate(100); }

    // FIX 4: capture attestor (contractor) + clones for the post-create policy call.
    let attestor_addr = params.contractor.clone();
    let policy_wallet_path = wallet_path.clone();
    let policy_data_dir = data_dir.clone();
    let policy_rpc_url = rpc_url.clone();

    let args = vec![
        "agreement-create-simple-settlement".to_string(),
        "--agreement-id".to_string(), agreement_id.clone(),
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

    let result_agreement_id = raw["agreement_id"].as_str()
        .ok_or("Wallet binary returned no agreement_id field — operation may have failed silently")?
        .to_string();
    let result_agreement_hash = raw["agreement_hash"].as_str().unwrap_or("").to_string();

    auto_build_policy(
        "freelance",
        &result_agreement_id,
        &result_agreement_hash,
        &attestor_addr,
        0,
        policy_wallet_path,
        policy_data_dir,
        policy_rpc_url,
    ).await;

    Ok(AgreementResult {
        agreement_id: result_agreement_id,
        hash: if result_agreement_hash.is_empty() { None } else { Some(result_agreement_hash) },
        success: true,
        message: None,
    })
}

#[tauri::command]
async fn settlement_create_milestone(
    state: State<'_, AppState>,
    params: MilestoneParams,
) -> Result<AgreementResult, String> {
    ensure_wallet_unlocked(state.clone()).await?;
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    let height = get_current_height(&state, &rpc_url).await;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default().as_secs();
    let agreement_id = format!("milestone-{}", ts);
    let (secret_preimage, secret_hash) = mint_settlement_secret();
    persist_settlement_secret(&data_dir, &agreement_id, &secret_preimage)?;
    let doc_hash = format!("{:0>64x}", ts.wrapping_add(3));
    let timeout = height + (params.milestone_count as u64 * 500);
    let per_milestone = sats_to_irm(params.amount_sats / params.milestone_count as u64);

    // FIX 4: capture attestor (payee) + clones for the post-create N-policy call.
    let attestor_addr = params.payee.clone();
    let policy_wallet_path = wallet_path.clone();
    let policy_data_dir = data_dir.clone();
    let policy_rpc_url = rpc_url.clone();
    let policy_milestone_count = params.milestone_count;

    let mut args = vec![
        "agreement-create-milestone".to_string(),
        "--agreement-id".to_string(), agreement_id.clone(),
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
        // FIX 1: independent preimage per milestone so the Release flow can
        // unlock milestones individually. Persist before passing the hash
        // down to the wallet binary, same orphan-tolerant ordering as the
        // top-level secret above.
        let (m_secret_preimage, m_secret_hash) = mint_settlement_secret();
        persist_settlement_secret(
            &data_dir,
            &format!("{agreement_id}_milestone_{}", i),
            &m_secret_preimage,
        )?;
        let m_doc_hash = format!("{:0>64x}", ts.wrapping_add(100 + i as u64));
        args.push("--milestone".to_string());
        args.push(format!(
            "m{}|Milestone {}|{:.8}|{}|{}|{}",
            i + 1, i + 1, per_milestone, m_timeout, m_secret_hash, m_doc_hash
        ));
    }

    let output = run_wallet_cmd(args, wallet_path, data_dir).await?;
    let raw: serde_json::Value = serde_json::from_str(&output)
        .map_err(|e| format!("Parse error: {}", e))?;

    let result_agreement_id = raw["agreement_id"].as_str()
        .ok_or("Wallet binary returned no agreement_id field — operation may have failed silently")?
        .to_string();
    let result_agreement_hash = raw["agreement_hash"].as_str().unwrap_or("").to_string();

    auto_build_policy(
        "milestone",
        &result_agreement_id,
        &result_agreement_hash,
        &attestor_addr,
        policy_milestone_count,
        policy_wallet_path,
        policy_data_dir,
        policy_rpc_url,
    ).await;

    Ok(AgreementResult {
        agreement_id: result_agreement_id,
        hash: if result_agreement_hash.is_empty() { None } else { Some(result_agreement_hash) },
        success: true,
        message: None,
    })
}

#[tauri::command]
async fn settlement_create_deposit(
    state: State<'_, AppState>,
    params: DepositParams,
) -> Result<AgreementResult, String> {
    ensure_wallet_unlocked(state.clone()).await?;
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    let height = get_current_height(&state, &rpc_url).await;
    let deadline_blocks = params.deadline_hours.unwrap_or(24) * BLOCKS_PER_HOUR;
    let timeout = height + deadline_blocks;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default().as_secs();
    let agreement_id = format!("deposit-{}", ts);
    let (secret_preimage, secret_hash) = mint_settlement_secret();
    persist_settlement_secret(&data_dir, &agreement_id, &secret_preimage)?;
    let doc_hash = format!("{:0>64x}", ts.wrapping_add(4));

    let args = vec![
        "agreement-create-deposit".to_string(),
        "--agreement-id".to_string(), agreement_id.clone(),
        "--creation-time".to_string(), ts.to_string(),
        "--payer".to_string(), format!("addr={}", params.depositor),
        "--payee".to_string(), format!("addr={}", params.recipient),
        "--amount".to_string(), format!("{:.8}", sats_to_irm(params.amount_sats)),
        "--purpose-reference".to_string(),
        params.purpose.clone()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Deposit".to_string()),
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
        agreement_id: raw["agreement_id"].as_str()
            .ok_or("Wallet binary returned no agreement_id field — operation may have failed silently")?
            .to_string(),
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
    ensure_wallet_unlocked(state.clone()).await?;
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    let height = get_current_height(&state, &rpc_url).await;
    let cooldown_blocks = params.cooldown_hours.unwrap_or(72) * BLOCKS_PER_HOUR;
    let deadline_blocks = params.deadline_hours.unwrap_or(336) * BLOCKS_PER_HOUR;
    let settlement_deadline = height + cooldown_blocks;
    let refund_timeout = height + deadline_blocks;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default().as_secs();
    let agreement_id = format!("merchant-{}", ts);
    let (secret_preimage, secret_hash) = mint_settlement_secret();
    persist_settlement_secret(&data_dir, &agreement_id, &secret_preimage)?;
    let doc_hash = format!("{:0>64x}", ts.wrapping_add(5));

    // FIX 4: capture merchant (attestor) + clones for the post-create policy call.
    let attestor_addr = params.merchant.clone();
    let policy_wallet_path = wallet_path.clone();
    let policy_data_dir = data_dir.clone();
    let policy_rpc_url = rpc_url.clone();

    let mut args = vec![
        "agreement-create-simple-settlement".to_string(),
        "--agreement-id".to_string(), agreement_id.clone(),
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

    let result_agreement_id = raw["agreement_id"].as_str()
        .ok_or("Wallet binary returned no agreement_id field — operation may have failed silently")?
        .to_string();
    let result_agreement_hash = raw["agreement_hash"].as_str().unwrap_or("").to_string();

    auto_build_policy(
        "merchant_delayed",
        &result_agreement_id,
        &result_agreement_hash,
        &attestor_addr,
        0,
        policy_wallet_path,
        policy_data_dir,
        policy_rpc_url,
    ).await;

    Ok(AgreementResult {
        agreement_id: result_agreement_id,
        hash: if result_agreement_hash.is_empty() { None } else { Some(result_agreement_hash) },
        success: true,
        message: None,
    })
}

#[tauri::command]
async fn settlement_create_contractor(
    state: State<'_, AppState>,
    params: ContractorMilestoneParams,
) -> Result<AgreementResult, String> {
    ensure_wallet_unlocked(state.clone()).await?;
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    let height = get_current_height(&state, &rpc_url).await;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default().as_secs();
    let agreement_id = format!("contractor-{}", ts);
    let (secret_preimage, secret_hash) = mint_settlement_secret();
    persist_settlement_secret(&data_dir, &agreement_id, &secret_preimage)?;
    let doc_hash = format!("{:0>64x}", ts.wrapping_add(6));
    let timeout = height + (params.milestone_count as u64 * 500);
    let per_milestone = sats_to_irm(params.amount_sats / params.milestone_count as u64);

    // FIX 4: capture contractor (attestor) + clones for the post-create N-policy call.
    let attestor_addr = params.contractor.clone();
    let policy_wallet_path = wallet_path.clone();
    let policy_data_dir = data_dir.clone();
    let policy_rpc_url = rpc_url.clone();
    let policy_milestone_count = params.milestone_count;

    let mut args = vec![
        "agreement-create-milestone".to_string(),
        "--agreement-id".to_string(), agreement_id.clone(),
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
        // FIX 1: per-milestone independent preimage, persisted before use.
        let (m_secret_preimage, m_secret_hash) = mint_settlement_secret();
        persist_settlement_secret(
            &data_dir,
            &format!("{agreement_id}_milestone_{}", i),
            &m_secret_preimage,
        )?;
        let m_doc_hash = format!("{:0>64x}", ts.wrapping_add(100 + i as u64));
        args.push("--milestone".to_string());
        args.push(format!(
            "m{}|Milestone {}|{:.8}|{}|{}|{}",
            i + 1, i + 1, per_milestone, m_timeout, m_secret_hash, m_doc_hash
        ));
    }

    let output = run_wallet_cmd(args, wallet_path, data_dir).await?;
    let raw: serde_json::Value = serde_json::from_str(&output)
        .map_err(|e| format!("Parse error: {}", e))?;

    let result_agreement_id = raw["agreement_id"].as_str()
        .ok_or("Wallet binary returned no agreement_id field — operation may have failed silently")?
        .to_string();
    let result_agreement_hash = raw["agreement_hash"].as_str().unwrap_or("").to_string();

    auto_build_policy(
        "contractor",
        &result_agreement_id,
        &result_agreement_hash,
        &attestor_addr,
        policy_milestone_count,
        policy_wallet_path,
        policy_data_dir,
        policy_rpc_url,
    ).await;

    Ok(AgreementResult {
        agreement_id: result_agreement_id,
        hash: if result_agreement_hash.is_empty() { None } else { Some(result_agreement_hash) },
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
// Bug fix (Mac orphan reports): only match POST-SUBMIT confirmed-accept
// signals. The previous "Mined block at height N" / `event:"mined_block"`
// matches fired *before* the miner submitted the block to iriumd, so any
// candidate that subsequently lost the race to another miner still ended
// up in the Found Blocks list. Keeping only the accepted-by-node signal
// guarantees the entry corresponds to a block iriumd ingested.
fn parse_block_found(line: &str) -> Option<(u64, Option<String>)> {
    let trimmed = line.trim();
    if trimmed.starts_with('{') {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
            let event = v.get("event").and_then(|e| e.as_str()).unwrap_or("");
            let is_accepted_submit = event == "submit_block"
                && v.get("status").and_then(|s| s.as_str()) == Some("accepted");
            if is_accepted_submit {
                let height = v.get("height").and_then(|h| h.as_u64())?;
                let hash = v.get("hash").and_then(|h| h.as_str()).map(String::from);
                return Some((height, hash));
            }
        }
        return None;
    }
    // Only the confirmed-acceptance text marker. The pre-submit
    // "Mined block at height N" GPU/CPU optimism line is intentionally
    // not matched — wait for the iriumd-confirmed `Block accepted` line.
    let marker = "Block accepted by node at height ";
    if let Some(idx) = line.find(marker) {
        let tail = &line[idx + marker.len()..];
        let num: String = tail.chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(h) = num.parse::<u64>() {
            return Some((h, None));
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
        miner_address: None,
        // Will be flipped to true by update_block_details if the chain RPC
        // reports a different miner_address (i.e. our candidate lost).
        orphaned: false,
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
    miner_address: Option<String>,
}

// Fetch block details for a freshly-mined block from iriumd. The endpoint
// /rpc/block?height=N returns a nested structure: top-level fields are
// height, miner_address, tx_hex; hash/prev_hash/merkle_root/time/bits/nonce
// are nested inside a "header" sub-object (same layout as get_recent_blocks).
// Returns None only if the HTTP request itself fails — partial data is always
// returned in Some(BlockDetails) so the caller can update whatever fields
// iriumd did supply.
async fn fetch_block_details(rpc_url: &str, token: Option<String>, height: u64) -> Option<BlockDetails> {
    let client = rpc_client_with_token(token);
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

    // miner_address — top-level on the block JSON, several aliases observed
    // across iriumd versions; first non-empty wins.
    let miner_address = json["miner_address"].as_str()
        .or_else(|| json["miner"].as_str())
        .or_else(|| json["coinbase_address"].as_str())
        .filter(|s| !s.is_empty())
        .map(String::from);

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

    Some(BlockDetails { reward_sats, hash, prev_hash, merkle_root, bits, nonce, miner_address })
}

// Patch all detail fields of the most-recent matching entry. We scan from
// newest-to-oldest so simultaneous block-found events at different heights
// don't trample each other. Only overwrites hash if the RPC gave us one
// (text-mode miner output may have already set it from stdout).
//
// `our_miner_address` is the address the user is mining to (Some when the
// wallet has registered an address, None during pool/stratum sessions where
// the worker label is not a Q-address). When the chain RPC returns a
// miner_address that doesn't match, the entry is flagged `orphaned = true`
// — the candidate we recorded was beaten by another miner to the same
// height. UI hides orphaned rows behind a "Show orphaned blocks" toggle.
fn update_block_details(
    found_blocks: &Arc<Mutex<Vec<FoundBlock>>>,
    height: u64,
    details: BlockDetails,
    our_miner_address: Option<&str>,
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
            // Only overwrite miner_address when the RPC actually returned one
            // — otherwise a later empty fetch would clobber a good value.
            if details.miner_address.is_some() {
                // Compare against our wallet's mining address. If the chain
                // accepted a block at this height from a different miner,
                // flag the entry orphaned so the UI can hide / grey it out.
                if let Some(ours) = our_miner_address {
                    if details.miner_address.as_deref() != Some(ours) {
                        b.orphaned = true;
                    } else {
                        // Explicit reset: a retry that confirms ownership
                        // should clear any stale orphaned flag.
                        b.orphaned = false;
                    }
                }
                b.miner_address = details.miner_address;
            }
        }
    }
}

#[tauri::command]
async fn start_miner(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    address: String,
    threads: Option<u32>,
    poawx: Option<bool>,
) -> Result<bool, String> {
    let mut miner_lock = state.miner_process.lock().map_err(lock_err)?;

    if miner_lock.is_some() {
        return Err("Miner is already running".to_string());
    }
    // TASK 3: reset the user-initiated-stop flag so the event loop below
    // can correctly classify the next Terminated event as unexpected
    // unless stop_miner sets it to true beforehand.
    *state.miner_user_initiated_stop.lock().map_err(lock_err)? = false;

    // irium-miner reads address from IRIUM_MINER_ADDRESS env var, not a CLI flag
    let mut args: Vec<String> = Vec::new();
    if let Some(t) = threads {
        args.push("--threads".to_string());
        args.push(t.to_string());
    }
    // PoAW-X solo proposer mining: run_poawx_solo does auto-registration + VRF
    // eligibility + role-work and builds/submits as the user's own proposer.
    // Off by default => args are byte-identical to plain-PoW mining.
    if poawx == Some(true) {
        args.push("--poawx".to_string());
    }

    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let home_dir = dirs::home_dir().unwrap_or_default();
    let irium_dir = home_dir.join(".irium");

    let mut miner_env = HashMap::new();
    miner_env.insert("IRIUM_MINER_ADDRESS".to_string(), address.clone());
    miner_env.insert("IRIUM_RPC_URL".to_string(), rpc_url.clone());
    miner_env.insert("IRIUM_NODE_RPC".to_string(), rpc_url.clone());
    // FIX 2 (IRIUM_RPC_TOKEN): the miner sidecar's fetch_template path
    // hits iriumd's auth-gated /miner/template endpoint. Without this
    // env var iriumd returns 401 and the miner retries forever at 0
    // KH/s. snapshot_gui_rpc_bearer respects FIX 3 remote-node mode
    // (user-supplied remote token) and falls back to the auto-minted
    // local RPC_TOKEN in default local mode.
    miner_env.insert(
        "IRIUM_RPC_TOKEN".to_string(),
        snapshot_gui_rpc_bearer(&state.rpc_token_override).unwrap_or_default(),
    );

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
    let miner_addr_ref   = Arc::clone(&state.miner_address);
    let rpc_url_for_reward = rpc_url.clone();
    // FIX 2 (IRIUM_RPC_TOKEN): capture the override Arc so the
    // block-reward fetch can resolve the live bearer token on each
    // retry — important if the user edits the rpc_token between the
    // block-found event and the +13s retry, or in FIX 3 remote mode
    // where the local auto-token would 401 against the remote node.
    let rpc_token_ref_for_reward = Arc::clone(&state.rpc_token_override);
    // TASK 3 captures for the unexpected-exit notification.
    let app_for_event = app.clone();
    let user_initiated_ref = Arc::clone(&state.miner_user_initiated_stop);
    let miner_process_for_cleanup = Arc::clone(&state.miner_process);
    // BUG 1: clear miner_kind alongside miner_process when the sidecar
    // terminates (user-initiated OR crash). Without this, get_miner_status
    // would keep returning running=true after a crash because the kind
    // discriminator never reset.
    let miner_kind_for_cleanup = Arc::clone(&state.miner_kind);
    let hashrate_for_clear = Arc::clone(&state.miner_hashrate);
    let sync_for_clear = Arc::clone(&state.miner_sync_status);
    tauri::async_runtime::spawn(async move {
        // Buffer of recent stderr lines included in the unexpected-exit
        // payload so the GUI banner can show a snippet of what the miner
        // last said before dying. Capped at 10 lines (rolling).
        let mut stderr_tail: Vec<String> = Vec::new();
        while let Some(event) = rx.recv().await {
            let line = match event {
                CommandEvent::Stdout(l) => { tracing::info!("[irium-miner] {}", l); l }
                CommandEvent::Stderr(l) => {
                    tracing::warn!("[irium-miner stderr] {}", l);
                    stderr_tail.push(l.trim().to_string());
                    if stderr_tail.len() > 10 { stderr_tail.remove(0); }
                    l
                }
                CommandEvent::Terminated(payload) => {
                    // TASK 3: clean up and decide whether to notify the GUI.
                    let user_initiated = user_initiated_ref.lock()
                        .map(|g| *g)
                        .unwrap_or(false);
                    if let Ok(mut g) = miner_process_for_cleanup.lock() { *g = None; }
                    if let Ok(mut k) = miner_kind_for_cleanup.lock() { *k = None; }
                    if let Ok(mut h) = hashrate_for_clear.lock() { *h = 0.0; }
                    if let Ok(mut s) = sync_for_clear.lock() { *s = None; }
                    if !user_initiated {
                        let _ = app_for_event.emit_all(
                            "miner-exited-unexpectedly",
                            serde_json::json!({
                                "kind": "cpu",
                                "os": std::env::consts::OS,
                                "exit_code": payload.code,
                                "last_stderr_tail": stderr_tail,
                            }),
                        );
                    }
                    break;
                }
                _ => break,
            };

            // Record block-found events before the other pattern checks.
            // After the fix, parse_block_found only matches POST-SUBMIT
            // confirmed-accept signals, so an entry here corresponds to a
            // block iriumd has ingested. We still verify ownership below
            // by comparing the canonical miner_address against our wallet.
            if let Some((height, hash)) = parse_block_found(&line) {
                record_found_block(&blocks_found_ref, &found_blocks_ref, height, hash.clone());
                // FIX 4 (Mining UI): emit a Tauri event so the Miner page
                // can render a celebratory banner immediately, before the
                // 10s found-blocks poll catches up. Auto-dismisses on the
                // frontend after 10s.
                let _ = app_for_event.emit_all(
                    "miner-found-block",
                    serde_json::json!({
                        "kind": "cpu",
                        "height": height,
                        "hash": hash,
                    }),
                );
                // Fire-and-forget detail fetch with three attempts. The
                // accepted-marker fires AFTER submit_block returns, so the
                // first fetch usually succeeds; retries at +3s and +13s
                // belt-and-brace against transient RPC errors.
                let fb_for_reward     = Arc::clone(&found_blocks_ref);
                let addr_for_reward   = Arc::clone(&miner_addr_ref);
                let rpc_for_reward    = rpc_url_for_reward.clone();
                let tok_for_reward    = Arc::clone(&rpc_token_ref_for_reward);
                tauri::async_runtime::spawn(async move {
                    let our = addr_for_reward.lock().ok().and_then(|g| g.clone());
                    let tok = snapshot_gui_rpc_bearer(&tok_for_reward);
                    if let Some(details) = fetch_block_details(&rpc_for_reward, tok.clone(), height).await {
                        update_block_details(&fb_for_reward, height, details, our.as_deref());
                        return;
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                    let tok = snapshot_gui_rpc_bearer(&tok_for_reward);
                    if let Some(details) = fetch_block_details(&rpc_for_reward, tok.clone(), height).await {
                        update_block_details(&fb_for_reward, height, details, our.as_deref());
                        return;
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(10)).await;
                    let tok = snapshot_gui_rpc_bearer(&tok_for_reward);
                    if let Some(details) = fetch_block_details(&rpc_for_reward, tok, height).await {
                        update_block_details(&fb_for_reward, height, details, our.as_deref());
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
    // BUG 1: tag the active miner slot as CPU so get_miner_status reads
    // running=true and get_gpu_miner_status reads running=false while
    // this sidecar is alive.
    *state.miner_kind.lock().map_err(lock_err)? = Some(MinerKind::Cpu);
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
    // TASK 3: mark this as a user-initiated stop BEFORE sending the kill
    // signal so the event-loop's Terminated handler classifies the exit
    // correctly and does NOT emit the unexpected-exit banner event.
    *state.miner_user_initiated_stop.lock().map_err(lock_err)? = true;
    let mut miner_lock = state.miner_process.lock().map_err(lock_err)?;
    if let Some(child) = miner_lock.take() {
        child.kill().map_err(|e| e.to_string())?;
        drop(miner_lock);
        // BUG 1: clear miner_kind in lockstep with miner_process so the
        // very next get_miner_status / get_gpu_miner_status poll returns
        // running=false on both tabs. The spawn loop's Terminated branch
        // also clears these as a belt-and-braces (when an external kill
        // or crash beats us to it), but we clear them eagerly here so the
        // GUI doesn't briefly show a stale "Active" state in the gap
        // between SIGKILL delivery and the spawn loop draining its rx.
        *state.miner_kind.lock().map_err(lock_err)? = None;
        *state.miner_start_time.lock().map_err(lock_err)? = None;
        *state.miner_address.lock().map_err(lock_err)? = None;
        *state.miner_threads.lock().map_err(lock_err)? = 0;
        *state.miner_hashrate.lock().map_err(lock_err)? = 0.0;
        *state.miner_sync_status.lock().map_err(lock_err)? = None;
        *state.gpu_temperature_c.lock().map_err(lock_err)? = None;
        *state.gpu_power_w.lock().map_err(lock_err)? = None;
        let _ = app.tray_handle().set_tooltip("Irium Core");
        return Ok(true);
    }
    Ok(false)
}

#[tauri::command]
async fn get_miner_status(state: State<'_, AppState>) -> Result<MinerStatus, String> {
    // BUG 1: report running=true only when a CPU sidecar owns the
    // process slot. Previously this read miner_process.is_some() which
    // was also true while the GPU miner was active, causing the CPU tab
    // to render "Mining Active" with warmup banner while the user was
    // actually GPU-mining. The associated counters (hashrate, threads,
    // uptime, sync_status) all describe the active sidecar — those are
    // only meaningful on the CPU tab when the active miner IS CPU, so we
    // zero them on the inactive tab to keep the UI tab-local.
    let kind = *state.miner_kind.lock().map_err(lock_err)?;
    let running = kind == Some(MinerKind::Cpu);
    let uptime_secs = if running {
        let t = state.miner_start_time.lock().map_err(lock_err)?;
        t.as_ref().map(|i| i.elapsed().as_secs()).unwrap_or(0)
    } else { 0 };
    let address = if running { state.miner_address.lock().map_err(lock_err)?.clone() } else { None };
    let threads = if running { *state.miner_threads.lock().map_err(lock_err)? } else { 0 };

    let hashrate_khs = if running { *state.miner_hashrate.lock().map_err(lock_err)? } else { 0.0 };
    let sync_status = if running { state.miner_sync_status.lock().map_err(lock_err)?.clone() } else { None };
    let blocks_found = *state.blocks_found.lock().map_err(lock_err)?;

    // Pool stats merge — fetch the proxy's /stats with a tight budget so
    // the local Miner page stays snappy when the official pool is
    // unreachable (private/alternative-pool users, or just transient net
    // hiccups). Silent fallback to None when anything fails; the GUI
    // already short-circuits to "—" on undefined.
    let (pool_diff, pool_hashrate_khs) = fetch_pool_stats_for_miner_status().await;

    Ok(MinerStatus {
        running,
        hashrate_khs,
        blocks_found,
        uptime_secs,
        difficulty: 0,
        threads,
        address,
        sync_status,
        pool_diff,
        pool_hashrate_khs,
    })
}

/// Pool-side enrichment for get_miner_status. Returns (current_diff,
/// pool_hashrate_khs) on success; (None, None) on any failure. 2 s
/// budget keeps the Miner-page refresh tight even when the pool VPS
/// is degraded - the frontend renders "—" rather than blocking on us.
async fn fetch_pool_stats_for_miner_status() -> (Option<u64>, Option<f64>) {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    {
        Ok(c) => c,
        Err(_) => return (None, None),
    };
    let resp = match client.get(POOL_STATS_URL).send().await {
        Ok(r) => r,
        Err(_) => return (None, None),
    };
    if !resp.status().is_success() {
        return (None, None);
    }
    let v: serde_json::Value = match resp.json().await {
        Ok(v) => v,
        Err(_) => return (None, None),
    };
    // Sum ASIC + CPU/GPU hashrate (H/s) and convert to kH/s for the
    // frontend's existing unit. Difficulty: pick ASIC's current_diff
    // as the headline number; ASIC is the workhorse profile and the
    // baseline is what most miners see.
    let asic = v.get("asic");
    let cpu_gpu = v.get("cpu_gpu");
    let pool_diff = asic
        .and_then(|x| x.get("current_diff"))
        .and_then(|x| x.as_u64());
    let asic_hps = asic
        .and_then(|x| x.get("hashrate_estimate_hps"))
        .and_then(|x| x.as_f64())
        .unwrap_or(0.0);
    let cpu_hps = cpu_gpu
        .and_then(|x| x.get("hashrate_estimate_hps"))
        .and_then(|x| x.as_f64())
        .unwrap_or(0.0);
    let total_hps = asic_hps + cpu_hps;
    let pool_hashrate_khs = if total_hps > 0.0 {
        Some(total_hps / 1000.0)
    } else {
        None
    };
    (pool_diff, pool_hashrate_khs)
}

/// 30-s cache wrapper around fetch_pool_stats_for_miner_status. Returns
/// the cached (pool_diff, pool_hashrate_khs) pair if the last fetch was
/// less than 30 s ago; otherwise refetches and updates the cache. Used by
/// get_stratum_status (5 s poll) so only one in six polls pays the proxy
/// round-trip. Cache miss on lock-poisoning is silent — the underlying
/// fetcher still runs and returns fresh values, just without the side
/// effect of writing them back.
const POOL_STATS_CACHE_TTL_SECS: u64 = 30;

async fn fetch_pool_stats_with_cache(state: &AppState) -> (Option<u64>, Option<f64>) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    if let Ok(g) = state.pool_stats_cache.lock() {
        if let Some(entry) = g.as_ref() {
            if now.saturating_sub(entry.fetched_at_unix) < POOL_STATS_CACHE_TTL_SECS {
                return (entry.pool_diff, entry.pool_hashrate_khs);
            }
        }
    }

    let (pool_diff, pool_hashrate_khs) = fetch_pool_stats_for_miner_status().await;

    if let Ok(mut g) = state.pool_stats_cache.lock() {
        *g = Some(PoolStatsCacheEntry {
            fetched_at_unix: now,
            pool_diff,
            pool_hashrate_khs,
        });
    }
    (pool_diff, pool_hashrate_khs)
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
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    address: String,
    platform_sel: Option<String>,
    device_indices: Vec<u32>,
    intensity: u32,
) -> Result<bool, String> {
    let mut miner_lock = state.miner_process.lock().map_err(lock_err)?;
    if miner_lock.is_some() {
        return Err("Miner already running — stop it first".to_string());
    }
    // TASK 3: reset the user-initiated-stop flag (see start_miner).
    *state.miner_user_initiated_stop.lock().map_err(lock_err)? = false;
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
    const DEFAULT_BATCH_SIZE: u32 = 4_194_304;
    let batch = ((intensity.clamp(10, 100) as f64 / 100.0) * DEFAULT_BATCH_SIZE as f64).round() as u32;
    args.push("--batch".into());
    args.push(batch.to_string());

    // FIX 2 (IRIUM_RPC_TOKEN): same Bearer-auth requirement as the CPU
    // miner — irium-miner-gpu's fetch_template path 401s without this
    // env var, which manifests in the GUI as "GPU Active, 0.0 KH/s"
    // because the sidecar never receives a job from iriumd.
    let mut gpu_env = HashMap::new();
    gpu_env.insert(
        "IRIUM_RPC_TOKEN".to_string(),
        snapshot_gui_rpc_bearer(&state.rpc_token_override).unwrap_or_default(),
    );

    let (mut rx, child) = Command::new_sidecar("irium-miner-gpu")
        .map_err(|e| format!("irium-miner-gpu not bundled: {}", e))?
        .envs(gpu_env)
        .args(&args)
        .current_dir(irium_dir)
        .spawn()
        .map_err(|e| format!("Failed to start GPU miner: {}", e))?;

    let hashrate_ref = Arc::clone(&state.miner_hashrate);
    let blocks_found_ref = Arc::clone(&state.blocks_found);
    let found_blocks_ref = Arc::clone(&state.found_blocks);
    let miner_addr_ref   = Arc::clone(&state.miner_address);
    let temp_ref = Arc::clone(&state.gpu_temperature_c);
    let power_ref = Arc::clone(&state.gpu_power_w);
    let rpc_url_for_reward = rpc_url.clone();
    // FIX 2: snapshot Arc for bearer-token resolution inside the spawn loop.
    let rpc_token_ref_for_reward = Arc::clone(&state.rpc_token_override);
    // TASK 3 captures for the unexpected-exit notification path.
    let app_for_event = app.clone();
    let user_initiated_ref = Arc::clone(&state.miner_user_initiated_stop);
    let miner_process_for_cleanup = Arc::clone(&state.miner_process);
    // BUG 1: mirror the CPU-side fix — clear miner_kind alongside
    // miner_process on Terminated so the GPU tab transitions back to
    // idle and the CPU tab stays idle when the GPU sidecar dies.
    let miner_kind_for_cleanup = Arc::clone(&state.miner_kind);
    let hashrate_for_clear = Arc::clone(&state.miner_hashrate);
    let temp_for_clear = Arc::clone(&state.gpu_temperature_c);
    let power_for_clear = Arc::clone(&state.gpu_power_w);
    tauri::async_runtime::spawn(async move {
        // Rolling 10-line stderr buffer included in the unexpected-exit
        // payload so the GUI can show what the GPU miner last said.
        let mut stderr_tail: Vec<String> = Vec::new();
        while let Some(event) = rx.recv().await {
            let line = match event {
                CommandEvent::Stdout(l) => l,
                CommandEvent::Stderr(l) => {
                    stderr_tail.push(l.trim().to_string());
                    if stderr_tail.len() > 10 { stderr_tail.remove(0); }
                    l
                }
                CommandEvent::Terminated(payload) => {
                    // TASK 3: clean up and notify the GUI if this wasn't
                    // a user-initiated stop. The macOS GPU watchdog is the
                    // primary case this path catches.
                    let user_initiated = user_initiated_ref.lock()
                        .map(|g| *g)
                        .unwrap_or(false);
                    if let Ok(mut g) = miner_process_for_cleanup.lock() { *g = None; }
                    if let Ok(mut k) = miner_kind_for_cleanup.lock() { *k = None; }
                    if let Ok(mut h) = hashrate_for_clear.lock() { *h = 0.0; }
                    if let Ok(mut t) = temp_for_clear.lock() { *t = None; }
                    if let Ok(mut p) = power_for_clear.lock() { *p = None; }
                    if !user_initiated {
                        let _ = app_for_event.emit_all(
                            "miner-exited-unexpectedly",
                            serde_json::json!({
                                "kind": "gpu",
                                "os": std::env::consts::OS,
                                "exit_code": payload.code,
                                "last_stderr_tail": stderr_tail,
                            }),
                        );
                    }
                    break;
                }
                _ => break,
            };
            if let Some((height, hash)) = parse_block_found(&line) {
                record_found_block(&blocks_found_ref, &found_blocks_ref, height, hash.clone());
                // FIX 4 (Mining UI): celebratory banner trigger.
                let _ = app_for_event.emit_all(
                    "miner-found-block",
                    serde_json::json!({
                        "kind": "gpu",
                        "height": height,
                        "hash": hash,
                    }),
                );
                // parse_block_found now only matches POST-SUBMIT accepted
                // signals, so the first fetch normally succeeds; retries at
                // +3s and +13s defend against transient RPC errors.
                let fb_for_reward   = Arc::clone(&found_blocks_ref);
                let addr_for_reward = Arc::clone(&miner_addr_ref);
                let rpc_for_reward  = rpc_url_for_reward.clone();
                let tok_for_reward  = Arc::clone(&rpc_token_ref_for_reward);
                tauri::async_runtime::spawn(async move {
                    let our = addr_for_reward.lock().ok().and_then(|g| g.clone());
                    let tok = snapshot_gui_rpc_bearer(&tok_for_reward);
                    if let Some(details) = fetch_block_details(&rpc_for_reward, tok.clone(), height).await {
                        update_block_details(&fb_for_reward, height, details, our.as_deref());
                        return;
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                    let tok = snapshot_gui_rpc_bearer(&tok_for_reward);
                    if let Some(details) = fetch_block_details(&rpc_for_reward, tok.clone(), height).await {
                        update_block_details(&fb_for_reward, height, details, our.as_deref());
                        return;
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(10)).await;
                    let tok = snapshot_gui_rpc_bearer(&tok_for_reward);
                    if let Some(details) = fetch_block_details(&rpc_for_reward, tok, height).await {
                        update_block_details(&fb_for_reward, height, details, our.as_deref());
                    }
                });
                continue;
            }
            if let Some(khs) = parse_hashrate_khs(&line) {
                if let Ok(mut h) = hashrate_ref.lock() { *h = khs; }
            }
            if let Some((tc, pw)) = parse_gpu_thermal(&line) {
                if let Ok(mut t) = temp_ref.lock() { *t = Some(tc); }
                if let Ok(mut p) = power_ref.lock() { *p = Some(pw); }
            }
        }
    });
    *miner_lock = Some(child);
    // BUG 1: tag the active miner slot as GPU so get_gpu_miner_status
    // reads running=true while this sidecar is alive, and the CPU tab's
    // get_miner_status correctly reads running=false.
    *state.miner_kind.lock().map_err(lock_err)? = Some(MinerKind::Gpu);
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
    // BUG 1: report running=true only when the GPU sidecar owns the
    // process slot. hashrate / temp / power describe the active
    // sidecar's GPU; on the CPU-active or idle case they are
    // meaningless and must be zeroed so the GPU tab does not show
    // stale numbers from a previous GPU session.
    let kind = *state.miner_kind.lock().map_err(lock_err)?;
    let running = kind == Some(MinerKind::Gpu);
    let raw_hashrate = *state.miner_hashrate.lock().map_err(lock_err)?;
    let hashrate_khs = if running { raw_hashrate } else { 0.0 };
    let blocks_found = *state.blocks_found.lock().map_err(lock_err)?;
    let temperature_c = if running { *state.gpu_temperature_c.lock().map_err(lock_err)? } else { None };
    let power_w = if running { *state.gpu_power_w.lock().map_err(lock_err)? } else { None };
    Ok(GpuMinerStatus { running, hashrate_khs, blocks_found, device_name: None, temperature_c, power_w })
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

// Detect lines from the irium-miner sidecar that indicate a connection-level
// failure the user needs to see. Share-rejected lines explicitly excluded so
// a routine stratum rejection doesn't fire a stratum_error event — those go
// through the existing counter path. Case-insensitive on "error"/"dns"/
// "invalid" because the upstream messages come from many TCP/DNS layers.
fn is_stratum_error_line(line: &str) -> bool {
    if line.contains("[stratum] share rejected") {
        return false;
    }
    let lower = line.to_lowercase();
    line.contains("Connection refused")
        || lower.contains("dns")
        || line.contains("failed to connect")
        || lower.contains("invalid")
        || lower.contains("error")
}

#[tauri::command]
async fn stratum_connect(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    pool_url: String,
    worker: String,
    password: String,
    // v1.0.63: optional GPU selection. When `device_indices` is Some
    // and non-empty, spawn the bundled `irium-miner-gpu` sidecar with
    // `--pool --wallet --platform --devices` so the user's GPU mines
    // through the stratum bridge. When None or empty, fall back to the
    // original `irium-miner` (CPU) spawn path — preserves behaviour
    // for users without OpenCL or without a GPU detected.
    platform_sel: Option<String>,
    device_indices: Option<Vec<u32>>,
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

    // FIX 2 (IRIUM_RPC_TOKEN): the irium-miner sidecar talks to iriumd
    // for the solo-fallback template fetch and reward lookups even in
    // pool mode. Capture an Arc clone of the override Mutex so the
    // closure (called both for the initial spawn AND the reconnect
    // path inside the spawn-monitor task) can re-resolve the live
    // bearer token on every call — honoring a settings edit between
    // initial connect and reconnect.
    let rpc_token_arc = Arc::clone(&state.rpc_token_override);
    let build_env = move |pool: &str, user: &str, pass: &str, addr: &str, rpc: &str| {
        let mut env = HashMap::new();
        env.insert("IRIUM_MINER_ADDRESS".to_string(), addr.to_string());
        env.insert("IRIUM_RPC_URL".to_string(), rpc.to_string());
        env.insert("IRIUM_NODE_RPC".to_string(), rpc.to_string());
        env.insert("IRIUM_STRATUM_URL".to_string(), pool.to_string());
        env.insert("IRIUM_STRATUM_USER".to_string(), user.to_string());
        env.insert("IRIUM_STRATUM_PASS".to_string(), pass.to_string());
        env.insert(
            "IRIUM_RPC_TOKEN".to_string(),
            snapshot_gui_rpc_bearer(&rpc_token_arc).unwrap_or_default(),
        );
        env
    };

    // v1.0.63: choose sidecar binary based on whether the caller passed
    // a non-empty device list. The GPU branch builds the CLI args
    // (--pool/--wallet/--platform/--devices) that irium-miner-gpu's
    // pool-mode supports (GPU-MINER.md lines 17-20). Stratum env vars
    // (IRIUM_STRATUM_URL/USER/PASS) are still set so the same bridge
    // negotiation works on either binary.
    let use_gpu = device_indices.as_ref().map_or(false, |v| !v.is_empty());
    let gpu_args: Vec<String> = if use_gpu {
        let dev_csv = device_indices
            .as_ref()
            .unwrap()
            .iter()
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join(",");
        let mut args = vec![
            "--pool".to_string(), pool_url.clone(),
            "--wallet".to_string(), mining_addr.clone(),
            "--devices".to_string(), dev_csv,
        ];
        if let Some(p) = platform_sel.as_ref().filter(|s| !s.is_empty()) {
            args.push("--platform".to_string());
            args.push(p.clone());
        }
        args
    } else {
        Vec::new()
    };

    let env = build_env(&pool_url, &worker, &password, &mining_addr, &rpc_url);
    let (rx, child) = if use_gpu {
        Command::new_sidecar("irium-miner-gpu")
            .map_err(|e| format!("irium-miner-gpu not found: {}", e))?
            .args(gpu_args.clone())
            .envs(env)
            .current_dir(irium_dir.clone())
            .spawn()
            .map_err(|e| format!("Failed to start pool GPU miner: {}", e))?
    } else {
        Command::new_sidecar("irium-miner")
            .map_err(|e| format!("irium-miner not found: {}", e))?
            .envs(env)
            .current_dir(irium_dir.clone())
            .spawn()
            .map_err(|e| format!("Failed to start pool miner: {}", e))?
    };

    // C-10 fix: reset share counters for the new pool session so a fresh
    // connect doesn't accumulate against a previous pool's stats.
    if let Ok(mut a) = state.stratum_shares_accepted.lock() { *a = 0; }
    if let Ok(mut r) = state.stratum_shares_rejected.lock() { *r = 0; }
    // FIX 4: clear last-share timestamp so the Miner page shows "—"
    // until the new session lands its first accepted share.
    if let Ok(mut t) = state.stratum_last_share_time.lock() { *t = None; }
    // Phase 1A: clear stale per-miner hashrate (shared with the CPU tab,
    // populated by parse_hashrate_khs) so the new Stratum session starts
    // from "—" rather than displaying whatever the CPU miner tab last set.
    // The CPU tab's own monitor will overwrite this within ~30 s if a CPU
    // miner is running simultaneously (rare — only one miner_process slot).
    if let Ok(mut h) = state.miner_hashrate.lock() { *h = 0.0; }
    // Phase 1A: clear the activity ring buffer for the new session so the
    // user sees only events from this connection.
    if let Ok(mut e) = state.stratum_recent_events.lock() { e.clear(); }

    // Clone every Arc the monitor task needs. We can't move the State<'_>
    // wrapper into the task — its lifetime is bound to this command call.
    let app_clone = app.clone();
    let miner_process_ref = Arc::clone(&state.miner_process);
    let miner_start_time_ref = Arc::clone(&state.miner_start_time);
    let miner_address_ref = Arc::clone(&state.miner_address);
    let pool_url_state_ref = Arc::clone(&state.pool_url);
    let shares_accepted_ref = Arc::clone(&state.stratum_shares_accepted);
    let shares_rejected_ref = Arc::clone(&state.stratum_shares_rejected);
    let last_share_time_ref = Arc::clone(&state.stratum_last_share_time);
    let hashrate_ref = Arc::clone(&state.miner_hashrate);
    let events_ref = Arc::clone(&state.stratum_recent_events);
    let pool_url_owned = pool_url.clone();
    let worker_owned = worker.clone();
    let password_owned = password.clone();
    let mining_addr_owned = mining_addr.clone();
    let rpc_url_owned = rpc_url.clone();
    // v1.0.63: carry the GPU branch decision + CLI args into the
    // reconnect closure so a transient pool drop respawns the same
    // sidecar binary the user originally connected with. Without this
    // a GPU-mode pool drop would silently fall back to the CPU
    // sidecar on retry — wrong hardware, surprising behaviour.
    let use_gpu_owned = use_gpu;
    let gpu_args_owned = gpu_args.clone();

    tauri::async_runtime::spawn(async move {
        // attempts: 1 = original connection, 2 = post-disconnect retry. The
        // user-spec is one auto-reconnect, so a 2-iteration loop is enough.
        let mut current_rx = rx;
        let mut attempt: u32 = 1;
        const MAX_ATTEMPTS: u32 = 2;

        loop {
            // Drain stdout/stderr from the active sidecar.
            while let Some(event) = current_rx.recv().await {
                let line = match event {
                    CommandEvent::Stdout(l) => l,
                    CommandEvent::Stderr(l) => l,
                    _ => break,
                };
                // C-10 fix: parse share-result lines emitted by irium-miner's
                // stratum_reader (v1.9.13+). substring match on the prefix —
                // accepted is on stdout, rejected is on stderr but both funnel
                // through `line` here. Substring (not starts_with) tolerates
                // optional log prefixes a future build might prepend.
                if line.contains("[stratum] share accepted") {
                    if let Ok(mut a) = shares_accepted_ref.lock() { *a = a.saturating_add(1); }
                    // FIX 4: capture wall-clock for the freshness pulse.
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    if let Ok(mut t) = last_share_time_ref.lock() { *t = Some(now); }
                    // Phase 1A: append to the activity ring buffer.
                    push_stratum_event(&events_ref, StratumEventKind::Accepted, None);
                } else if line.contains("[stratum] share rejected") {
                    if let Ok(mut r) = shares_rejected_ref.lock() { *r = r.saturating_add(1); }
                    // Phase 1A: extract the reject reason ("share rejected: <reason>"),
                    // trim, drop empties. None for "share rejected" with no colon.
                    let detail = line
                        .splitn(2, "share rejected:")
                        .nth(1)
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty());
                    push_stratum_event(&events_ref, StratumEventKind::Rejected, detail);
                }
                if let Some(khs) = parse_hashrate_khs(&line) {
                    if let Ok(mut h) = hashrate_ref.lock() { *h = khs; }
                }
                // FIX 4: surface error-like lines to the frontend. Previously
                // these were silently swallowed — a wrong pool URL produced
                // no user-visible feedback.
                if is_stratum_error_line(&line) {
                    let _ = app_clone.emit_all("stratum_error", line.clone());
                    // Phase 1A: also capture in the activity log so the user
                    // can scroll back to errors they dismissed from the toast.
                    push_stratum_event(
                        &events_ref,
                        StratumEventKind::Error,
                        Some(line.clone()),
                    );
                }
            }

            // Sidecar exited — clear the GUI-side miner_process handle.
            if let Ok(mut g) = miner_process_ref.lock() { *g = None; }

            // Distinguish a user-initiated disconnect (stratum_disconnect
            // clears pool_url before killing the sidecar) from a crash /
            // pool-side drop. Only auto-reconnect for the latter.
            let user_disconnected = pool_url_state_ref
                .lock()
                .map(|g| g.is_none())
                .unwrap_or(true);
            if user_disconnected {
                break;
            }

            if attempt >= MAX_ATTEMPTS {
                let _ = app_clone.emit_all(
                    "stratum_failed",
                    "Pool connection lost. Please reconnect.".to_string(),
                );
                // Reset pool_url so the GUI flips back to disconnected state.
                if let Ok(mut g) = pool_url_state_ref.lock() { *g = None; }
                break;
            }

            // FIX 5: one-shot reconnect. Tell the UI we're retrying, wait
            // 5 seconds, then attempt to respawn the sidecar with the same
            // params. If the spawn itself fails we still surface a
            // stratum_failed event so the UI never gets stuck "reconnecting".
            let _ = app_clone.emit_all(
                "stratum_disconnected",
                "Pool disconnected — reconnecting in 5s".to_string(),
            );
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            attempt += 1;

            let env = build_env(
                &pool_url_owned, &worker_owned, &password_owned,
                &mining_addr_owned, &rpc_url_owned,
            );
            // Mirror the original spawn-branch: GPU sidecar with CLI
            // args if the user picked one, otherwise the CPU sidecar
            // with bare env vars. See the comment on use_gpu_owned
            // above for the rationale.
            let respawn = if use_gpu_owned {
                Command::new_sidecar("irium-miner-gpu")
                    .ok()
                    .and_then(|cmd| {
                        cmd.args(gpu_args_owned.clone())
                            .envs(env)
                            .current_dir(irium_dir.clone())
                            .spawn()
                            .ok()
                    })
            } else {
                Command::new_sidecar("irium-miner")
                    .ok()
                    .and_then(|cmd| cmd.envs(env).current_dir(irium_dir.clone()).spawn().ok())
            };
            match respawn
            {
                Some((new_rx, new_child)) => {
                    if let Ok(mut g) = miner_process_ref.lock() { *g = Some(new_child); }
                    if let Ok(mut t) = miner_start_time_ref.lock() {
                        *t = Some(std::time::Instant::now());
                    }
                    if let Ok(mut a) = miner_address_ref.lock() {
                        *a = Some(mining_addr_owned.clone());
                    }
                    current_rx = new_rx;
                    // Loop body falls through to the inner `while let` to
                    // drain the new receiver.
                }
                None => {
                    let _ = app_clone.emit_all(
                        "stratum_failed",
                        "Pool reconnect failed — sidecar would not start.".to_string(),
                    );
                    if let Ok(mut g) = pool_url_state_ref.lock() { *g = None; }
                    break;
                }
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
    // C-10 fix: real counters from AppState, populated by the stratum_connect
    // spawn loop above. Was previously hardcoded to 0 on both sides.
    let shares_accepted = *state.stratum_shares_accepted.lock().map_err(lock_err)?;
    let shares_rejected = *state.stratum_shares_rejected.lock().map_err(lock_err)?;
    let last_share_time = *state.stratum_last_share_time.lock().map_err(lock_err)?;
    // Phase 1A: per-miner local hashrate (kH/s). The miner_hashrate field
    // is populated by the monitor loop's parse_hashrate_khs call. Treat
    // 0.0 as "no data yet" → None so the UI renders "—" instead of "0 KH/s".
    let your_hashrate_khs = {
        let h = *state.miner_hashrate.lock().map_err(lock_err)?;
        if h > 0.0 { Some(h) } else { None }
    };
    // Phase 1A: snapshot the activity ring buffer. Cloning the VecDeque
    // into a Vec here is cheap (≤10 small structs) and lets us drop the
    // lock immediately, before the async fetch_pool_stats_with_cache call.
    let recent_events: Vec<StratumEvent> = state
        .stratum_recent_events
        .lock()
        .map_err(lock_err)?
        .iter()
        .cloned()
        .collect();
    // Pool-wide difficulty (asic.current_diff from /stats) and aggregate
    // hashrate, via the 30 s cache. Silent fallback to (None, None) when
    // the proxy is unreachable — the frontend renders "—" rather than a
    // stale value. get_miner_status (CPU miner tab) keeps calling
    // fetch_pool_stats_for_miner_status directly to preserve its own
    // existing behavior; the cache exists specifically to make the 5 s
    // Stratum-tab poll cheap.
    let (pool_diff, pool_hashrate_khs) = fetch_pool_stats_with_cache(&state).await;
    Ok(StratumStatus {
        connected: running && pool_url.is_some(),
        pool_url,
        worker,
        shares_accepted,
        shares_rejected,
        uptime_secs,
        last_share_time,
        pool_diff,
        pool_hashrate_khs,
        your_hashrate_khs,
        recent_events,
    })
}

// ============================================================
// RPC DIRECT CALLS
// ============================================================

#[tauri::command]
async fn rpc_get_peers(state: State<'_, AppState>) -> Result<Vec<PeerInfo>, String> {
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let client = rpc_client(&state);
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
    let client = rpc_client(&state);
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
    })
}

#[tauri::command]
async fn rpc_get_block(
    state: State<'_, AppState>,
    height_or_hash: String,
) -> Result<serde_json::Value, String> {
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let client = rpc_client(&state);
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
    // Fix: previously called .json() unconditionally, which produces "EOF while
    // parsing a value at line 1 column 0" when iriumd returns 404 +
    // content-length: 0 (the standard response for an unknown height/hash).
    // Now status-check first, same pattern as rpc_get_tx, so the frontend
    // can render a friendly "Block not yet available" message instead of
    // showing the cryptic EOF parse error.
    let status = resp.status();
    if status.is_success() {
        resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())
    } else if status == reqwest::StatusCode::NOT_FOUND {
        Err(format!("Block not found: {}", height_or_hash))
    } else {
        let body = resp.text().await.unwrap_or_default();
        Err(format!(
            "RPC error {}: {}",
            status.as_u16(),
            body.chars().take(200).collect::<String>()
        ))
    }
}

#[tauri::command]
async fn rpc_get_tx(
    state: State<'_, AppState>,
    txid: String,
) -> Result<serde_json::Value, String> {
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let client = rpc_client(&state);
    let url = format!("{}/rpc/tx?txid={}", rpc_url, txid);
    let resp = client
        .get(&url)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    if status.is_success() {
        resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())
    } else {
        // L-10 fix: distinguish 404 (real "not found") from 400 (bad txid format)
        // and other 4xx/5xx errors. Previously every non-2xx returned the same
        // "Transaction not found" message, hiding malformed-txid bugs.
        let body = resp.text().await.unwrap_or_default();
        let body_snippet = if body.is_empty() { String::new() } else { format!(" — {}", body.chars().take(120).collect::<String>()) };
        let code = status.as_u16();
        match code {
            404 => Err(format!("Transaction not found (txid {})", txid)),
            400 => Err(format!("Invalid txid format: {}{}", txid, body_snippet)),
            _ => Err(format!("RPC error {} for txid {}{}", code, txid, body_snippet)),
        }
    }
}

#[tauri::command]
async fn rpc_get_address(
    state: State<'_, AppState>,
    address: String,
) -> Result<serde_json::Value, String> {
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let client = rpc_client(&state);
    // iriumd exposes the address lookup at /rpc/balance?address=… (see
    // get_balance in src/bin/iriumd.rs). The legacy /rpc/address?addr=…
    // path that this command used to call has never been registered; the
    // previous URL returned 404 for every query, which the GUI then
    // surfaced as "Address not found" regardless of whether the address
    // had a balance.
    let url = format!("{}/rpc/balance?address={}", rpc_url, address);
    let resp = client
        .get(&url)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    if status.is_success() {
        resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())
    } else if status == reqwest::StatusCode::NOT_FOUND {
        Err("Address not found".to_string())
    } else {
        Err(format!("RPC error {}", status))
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

    let info = get_rpc_info(&state, &rpc_url).await
        .map_err(|_| "node offline".to_string())?;
    let tip = info.height.unwrap_or(0);
    if tip == 0 { return Ok(vec![]); }
    let height = end_height.map(|h| h.min(tip)).unwrap_or(tip);

    // Build a single shared client with a tight per-request timeout
    // and the GUI bearer token attached (FIX 2).
    let client = rpc_client_builder(&state)
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
    let client = rpc_client(&state);
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

// Public pool stats proxy — sanitised read-only summary fetched from the
// stats-proxy running on the same VPS as the pool itself. The proxy lives
// at http://pool.iriumlabs.org:3337/stats and is a Python helper that
// scrapes the loopback /metrics endpoints exposed by both irium-stratum
// profiles (ASIC + CPU/GPU) and combines them. Hardcoded URL because this
// is the canonical Irium-operated pool; users with private/alternative
// pools will not have their stats surfaced here (intentional — the
// Explorer's Pool Stats section is specifically for the official pool).
const POOL_STATS_URL: &str = "http://pool.iriumlabs.org:3337/stats";

#[tauri::command]
async fn get_pool_stats() -> Result<PoolStats, String> {
    // External pool host, not iriumd — no bearer token needed.
    let client = reqwest::Client::builder().build().unwrap_or_default();
    let resp = client
        .get(POOL_STATS_URL)
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("pool stats unreachable: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("pool stats returned {}", resp.status()));
    }
    resp.json::<PoolStats>()
        .await
        .map_err(|e| format!("pool stats parse error: {}", e))
}

// get_richlist: thin passthrough to iriumd's /rpc/richlist?limit=N.
// Default 100, clamped to [1, 500] on the iriumd side. The frontend uses
// this for the Explorer's Rich List tab; a 10-second timeout is generous
// for the worst-case full UTXO scan iriumd does on its end.
#[tauri::command]
async fn get_richlist(state: State<'_, AppState>, limit: Option<u32>) -> Result<RichListResponse, String> {
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let n = limit.unwrap_or(100).clamp(1, 500);
    let client = rpc_client(&state);
    let resp = client
        .get(format!("{}/rpc/richlist?limit={}", rpc_url, n))
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("iriumd /rpc/richlist returned {}", resp.status()));
    }
    resp.json::<RichListResponse>().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn rpc_get_offers_feed(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let client = rpc_client(&state);
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
    // Ensure state.wallet_path is always Some(_) with an absolute,
    // OS-correct path the wallet sidecar can read via IRIUM_WALLET_FILE.
    // Three cases:
    //   1. Some(p) where p exists on disk → use p
    //   2. Some(p) where p does not exist (stale persisted path) → default
    //   3. None (settings.json has no wallet_path field, e.g. fresh install
    //      or a pre-v1.0.55 install whose settings.json never included it)
    //      → default
    //
    // v1.0.55 fixed case 2 but left case 3 untouched, so a fresh install on
    // Windows still hit the sidecar's HOME-unset fallback ("/.irium/wallet.json"
    // resolves to drive root) and every wallet command failed with
    // "read wallet: ... os error 2" until the user explicitly picked a wallet.
    let validated_wallet_path = match wallet_path {
        Some(p) if std::path::Path::new(&p).exists() => Some(p),
        Some(p) => {
            tracing::warn!(
                "[set_wallet_config] persisted wallet_path does not exist on disk: {} — falling back to default",
                p
            );
            Some(resolve_wallet_path())
        }
        None => Some(resolve_wallet_path()),
    };
    *state.wallet_path.lock().map_err(lock_err)? = validated_wallet_path;
    *state.data_dir.lock().map_err(lock_err)? = data_dir;
    Ok(true)
}

// Validate that a string is a globally routable IPv4 address suitable for
// advertising as our P2P external endpoint. Mirrors the validator used
// inside iriumd (p2p.rs::dialable_multiaddr_from_advertised) so the GUI
// avoids spending env-var space on addresses iriumd would reject anyway.
//
// Returns the canonical dotted-quad form on success. Rejected: loopback,
// RFC1918 private, RFC6598 CGNAT (100.64.0.0/10), link-local, unspecified,
// broadcast, multicast, documentation, and any IPv6 input.
fn validate_routable_ipv4(raw: &str) -> Option<String> {
    use std::net::Ipv4Addr;
    let v4: Ipv4Addr = raw.trim().parse().ok()?;
    if v4.is_loopback()
        || v4.is_private()
        || v4.is_link_local()
        || v4.is_unspecified()
        || v4.is_broadcast()
        || v4.is_multicast()
        || v4.is_documentation()
    {
        return None;
    }
    let oct = v4.octets();
    if oct[0] == 100 && (64..=127).contains(&oct[1]) {
        return None;
    }
    Some(v4.to_string())
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

// FIX 3 (Remote node): probe a candidate remote iriumd to confirm
// rpc_url + rpc_token are correct before the user commits to remote
// mode. Tight 5-second timeout so a hung remote can't freeze the
// Settings page. Returns Ok(true) on 2xx; on 401 returns an
// auth-specific error so the UI can guide the user to check the
// token. Other failures (timeout, connect refused) bubble up
// verbatim so the user sees the reqwest reason.
#[tauri::command]
async fn test_remote_connection(
    rpc_url: String,
    rpc_token: Option<String>,
) -> Result<bool, String> {
    let url = rpc_url.trim().trim_end_matches('/').to_string();
    if url.is_empty() {
        return Err("RPC URL is empty".to_string());
    }
    let mut builder = reqwest::Client::builder().timeout(Duration::from_secs(5));
    if let Some(tok) = rpc_token.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        let mut headers = reqwest::header::HeaderMap::new();
        if let Ok(val) = reqwest::header::HeaderValue::from_str(&format!("Bearer {}", tok)) {
            headers.insert(reqwest::header::AUTHORIZATION, val);
            builder = builder.default_headers(headers);
        }
    }
    let client = builder.build().map_err(|e| format!("client: {}", e))?;
    let resp = client
        .get(format!("{}/status", url))
        .send()
        .await
        .map_err(|e| format!("connect failed: {}", e))?;
    let status = resp.status();
    if status.is_success() {
        Ok(true)
    } else if status == reqwest::StatusCode::UNAUTHORIZED {
        Err("Authentication failed — check the RPC token".to_string())
    } else {
        Err(format!("Remote node responded {}", status))
    }
}

#[tauri::command]
async fn save_settings(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    settings_json: String,
) -> Result<bool, String> {
    let config = app_handle.config();
    let data_dir = app_data_dir(&config)
        .ok_or("Could not determine app data directory")?;
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create data dir: {}", e))?;
    let settings_path = data_dir.join("irium-core-settings.json");
    std::fs::write(&settings_path, &settings_json)
        .map_err(|e| format!("Failed to write settings: {}", e))?;
    // FIX 2 + 3: mirror rpc_token / node_mode / rpc_url into AppState
    // so the very next GUI RPC call already uses the new bearer token
    // and (in remote mode) the new rpc_url. No app restart required.
    hydrate_settings_into_state(&state, &settings_json);
    Ok(true)
}

#[tauri::command]
async fn load_settings(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let config = app_handle.config();
    let data_dir = app_data_dir(&config)
        .ok_or("Could not determine app data directory")?;
    let settings_path = data_dir.join("irium-core-settings.json");
    if settings_path.exists() {
        let contents = std::fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read settings: {}", e))?;
        // FIX 2 + 3: hydrate on launch so the first auto-poll from the
        // dashboard already uses the persisted bearer token / rpc_url.
        hydrate_settings_into_state(&state, &contents);
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

        // L-3 fix: previously a naive string compare. Now strip pre-release
        // suffixes (1.0.10-beta, 1.0.10-rc.1, etc.) on both sides so we
        // don't falsely report "update available" between content-equivalent
        // tags.
        let strip_suffix = |s: &str| s.split('-').next().unwrap_or(s).to_string();
        let latest_base = strip_suffix(&latest);
        let current_base = strip_suffix(CURRENT_VERSION);
        let available = !latest.is_empty() && latest_base != current_base;
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

    // Pull the submodule to the latest remote commit. silent_command keeps
    // git's stdout/stderr piped through inherited handles but suppresses the
    // Windows console allocation that would otherwise flash a CMD window.
    let out = silent_command("git")
        .args(["submodule", "update", "--remote", "--merge", "irium-source"])
        .current_dir(project_root)
        .output()
        .map_err(|e| format!("git not available: {}", e))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("git submodule update failed: {}", stderr.trim()));
    }

    // Read the new HEAD commit.
    let head_out = silent_command("git")
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
    let raw: serde_json::Value = serde_json::from_str(&output)
        .map_err(|e| format!("multisig-create parse error: {}. Output: {}", e, &output[..output.len().min(200)]))?;
    if let Some(err) = raw.get("error").and_then(|v| v.as_str()) {
        return Err(err.to_string());
    }
    let address = raw["address"].as_str().unwrap_or("").to_string();
    if address.is_empty() {
        return Err(format!("multisig-create returned no address. Output: {}", output.trim()));
    }
    Ok(MultisigCreateResult {
        script_pubkey: raw["script_pubkey"].as_str().unwrap_or("").to_string(),
        address,
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
    let raw: serde_json::Value = serde_json::from_str(&output)
        .map_err(|e| format!("multisig-broadcast parse error: {}. Output: {}", e, &output[..output.len().min(200)]))?;
    if let Some(err) = raw.get("error").and_then(|v| v.as_str()) {
        return Err(err.to_string());
    }
    let txid = raw["txid"].as_str().map(String::from);
    Ok(MultisigSpendResult {
        raw_tx: Some(raw_tx),
        success: txid.is_some(),
        txid,
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
    // H-8 fix: parse errors now propagate. Previously `.unwrap_or_default()`
    // returned an invoice with empty `id`, indistinguishable from a real
    // invoice — except it couldn't be looked up or paid.
    let raw: serde_json::Value = serde_json::from_str(&output)
        .map_err(|e| format!("Failed to parse invoice-generate output: {} | raw: {}", e, &output[..output.len().min(200)]))?;
    let id = raw["invoice_id"].as_str()
        .or_else(|| raw["id"].as_str())
        .ok_or("Wallet binary returned no invoice_id — invoice generation failed silently")?
        .to_string();
    Ok(Invoice {
        id,
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
    ensure_wallet_unlocked(state.clone()).await?;
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let mut args = vec!["agreement-fund".to_string(), agreement_id, "--json".to_string()];
    if broadcast.unwrap_or(true) {
        args.push("--broadcast".to_string());
    }
    let output = run_wallet_cmd_with_rpc(args, wallet_path, data_dir, rpc_url).await?;
    // C-1 fix: real parse + propagate accepted=false from FundAgreementResponse
    // (binary emits `{txid, agreement_hash, accepted, fee, outputs:[...]}`).
    let raw: serde_json::Value = serde_json::from_str(&output)
        .map_err(|e| format!("Failed to parse agreement-fund output: {} | raw: {}", e, &output[..output.len().min(200)]))?;
    let txid = raw["txid"].as_str().map(String::from);
    let accepted = raw["accepted"].as_bool().unwrap_or(false);
    if !accepted {
        let detail = txid.as_deref()
            .map(|t| format!(" (txid: {})", t))
            .unwrap_or_default();
        return Err(format!("Agreement funding rejected by node{}", detail));
    }
    Ok(ReleaseResult {
        txid,
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
    // H-5 fix: propagate real errors instead of silent "[]".
    let output = run_wallet_cmd_with_rpc(args, wallet_path, data_dir, rpc_url)
        .await.map_err(|e| format!("Failed to list policies: {}", e))?;
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
    ensure_wallet_unlocked(state.clone()).await?;
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let mut args = vec!["agreement-dispute".to_string(), agreement_id, "--json".to_string()];
    if let Some(r) = reason {
        args.push("--reason".to_string());
        args.push(r);
    }
    let output = run_wallet_cmd(args, wallet_path, data_dir).await?;
    // Previously: serde_json::from_str(&output).unwrap_or_default() followed
    // by success: true unconditionally — meaning a CLI run that exited 0 but
    // emitted a structured error body (e.g. {"error": "agreement not found"}
    // or {"success": false, "message": "..."}) was silently reported to the
    // UI as a successful dispute. Latent bug masked real failures.
    let raw: serde_json::Value = serde_json::from_str(&output).map_err(|e| {
        let preview: String = output.chars().take(200).collect();
        format!(
            "agreement-dispute returned non-JSON output ({}): {}",
            e, preview
        )
    })?;
    if let Some(err_msg) = raw.get("error").and_then(|v| v.as_str()) {
        return Err(format!("agreement-dispute failed: {}", err_msg));
    }
    if raw.get("success").and_then(|v| v.as_bool()) == Some(false) {
        let msg = raw
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("agreement-dispute failed without a message");
        return Err(format!("agreement-dispute failed: {}", msg));
    }
    let dispute_id = raw
        .get("dispute_id")
        .and_then(|v| v.as_str())
        .map(String::from);
    if dispute_id.is_none() {
        let preview: String = output.chars().take(200).collect();
        return Err(format!(
            "agreement-dispute returned no dispute_id in: {}",
            preview
        ));
    }
    Ok(DisputeOpenResult {
        dispute_id,
        success: true,
        message: None,
    })
}

#[tauri::command]
async fn agreement_dispute_list(state: State<'_, AppState>) -> Result<Vec<DisputeEntry>, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    // H-5 fix: propagate real errors instead of silent "[]".
    let output = run_wallet_cmd(
        vec!["agreement-dispute-list".to_string(), "--json".to_string()],
        wallet_path, data_dir,
    ).await.map_err(|e| format!("Failed to list disputes: {}", e))?;
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
    let info = get_rpc_info(&state, &rpc_url).await.unwrap_or_default();
    let client = rpc_client(&state);
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
    // H-7 fix: propagate real errors. Previously `.unwrap_or_else(|_| "{}")`
    // silently produced an empty list indistinguishable from a real empty
    // store.
    let output = run_wallet_cmd_with_rpc(
        vec!["agreement-local-store-list".to_string(), "--json".to_string()],
        wallet_path, data_dir, rpc_url,
    ).await.map_err(|e| format!("Failed to list local agreement store: {}", e))?;
    let val: serde_json::Value = serde_json::from_str(&output)
        .map_err(|e| format!("Failed to parse agreement-local-store-list output: {} | raw: {}", e, &output[..output.len().min(200)]))?;
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
    // H-7 fix: propagate real errors. Previously `.unwrap_or_else(|_| "{}")`
    // showed all-zero stats indistinguishable from a fresh install.
    let store_output = run_wallet_cmd_with_rpc(
        vec!["agreement-local-store-list".to_string(), "--json".to_string()],
        wallet_path, data_dir, rpc_url,
    ).await.map_err(|e| format!("Failed to fetch explorer stats: {}", e))?;
    let store: serde_json::Value = serde_json::from_str(&store_output)
        .map_err(|e| format!("Failed to parse explorer stats output: {} | raw: {}", e, &store_output[..store_output.len().min(200)]))?;
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
    let client = rpc_client_builder(&state)
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
        match get_rpc_info(&state, &rpc_url).await {
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
    // L-1 fix: cache the list-addresses output for reuse in check 5 below.
    // Previously the binary was invoked twice back-to-back, doubling
    // diagnostic latency for no functional gain.
    let list_addr_result = run_wallet_cmd(vec!["list-addresses".to_string()], wallet_path.clone(), data_dir.clone()).await;
    match &list_addr_result {
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
            detail: Some(e.clone()),
        }),
    }

    // 5. irium-wallet balance runs (get first address) — reuses cached
    // list-addresses output from check 4. When the wallet is locked or
    // the CLI returns an empty address set (e.g. fresh install before
    // first wallet creation), the balance query is skipped entirely
    // instead of being reported as a failed check. The earlier check 4
    // (irium-wallet list-addresses) already surfaces the underlying
    // state, so duplicating it here as a hard "No addresses in wallet"
    // failure was misleading on locked wallets and inflated the failure
    // count in the Settings diagnostic card.
    if let Ok(out) = &list_addr_result {
        let first_addr = out
            .lines()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("")
            .trim()
            .to_string();
        if !first_addr.is_empty() {
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
            silent_command(check_cmd)
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
    // L-5 fix: snapshot the slice under the lock, drop the guard, then return.
    // Previously the .to_vec() ran while still holding the lock, briefly
    // blocking the iriumd stdout reader that appends to the same mutex.
    let snapshot = {
        let logs = state.node_logs.lock().map_err(lock_err)?;
        let start = if logs.len() > n { logs.len() - n } else { 0 };
        logs[start..].to_vec()
    };
    Ok(snapshot)
}

// ============================================================
// SOLO STRATUM BRIDGE
// ============================================================
//
// Spawns / supervises `irium-miner --solo-stratum --solo-stratum-listen
// <addr>` as a separate sidecar from the regular CPU/GPU miner. Lets the
// user run an ASIC-pointing Stratum endpoint backed by their own iriumd
// without giving up the local-miner slot. Process handle lives in
// state.solo_stratum_process; the listen string in state.solo_stratum_listen
// drives the GUI's connection-string display.

const DEFAULT_SOLO_STRATUM_LISTEN: &str = "0.0.0.0:3333";

#[tauri::command]
async fn start_solo_stratum(
    state: State<'_, AppState>,
    listen: Option<String>,
) -> Result<String, String> {
    let listen_addr = listen
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_SOLO_STRATUM_LISTEN.to_string());

    {
        let guard = state.solo_stratum_process.lock().map_err(lock_err)?;
        if guard.is_some() {
            return Err("Solo Stratum is already running".to_string());
        }
    }

    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let home_dir = dirs::home_dir().unwrap_or_default();
    let irium_dir = home_dir.join(".irium");

    let mut env_vars: HashMap<String, String> = HashMap::new();
    env_vars.insert("IRIUM_NODE_RPC".to_string(), rpc_url.clone());
    env_vars.insert("IRIUM_RPC_URL".to_string(), rpc_url);
    env_vars.insert(
        "IRIUM_RPC_TOKEN".to_string(),
        snapshot_gui_rpc_bearer(&state.rpc_token_override).unwrap_or_default(),
    );
    let wallet_path_snapshot = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir_snapshot = state.data_dir.lock().map_err(lock_err)?.clone();
    if let Ok(addr) = get_first_wallet_address(wallet_path_snapshot, data_dir_snapshot).await {
        env_vars.insert("IRIUM_MINER_ADDRESS".to_string(), addr);
    }

    let args: Vec<String> = vec![
        "--solo-stratum".to_string(),
        "--solo-stratum-listen".to_string(),
        listen_addr.clone(),
    ];

    let cmd = Command::new_sidecar("irium-miner")
        .map_err(|e| format!("irium-miner not found: {}", e))?
        .envs(env_vars)
        .args(&args)
        .current_dir(irium_dir);

    let (mut rx, child) = cmd
        .spawn()
        .map_err(|e| format!("Failed to start solo stratum: {}", e))?;

    let process_for_cleanup = Arc::clone(&state.solo_stratum_process);
    let listen_for_cleanup = Arc::clone(&state.solo_stratum_listen);

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(l) => tracing::info!("[solo-stratum] {}", l),
                CommandEvent::Stderr(l) => tracing::warn!("[solo-stratum stderr] {}", l),
                CommandEvent::Terminated(_) => {
                    if let Ok(mut g) = process_for_cleanup.lock() { *g = None; }
                    if let Ok(mut g) = listen_for_cleanup.lock() { *g = None; }
                    break;
                }
                _ => break,
            }
        }
    });

    *state.solo_stratum_process.lock().map_err(lock_err)? = Some(child);
    *state.solo_stratum_listen.lock().map_err(lock_err)? = Some(listen_addr.clone());

    Ok(listen_addr)
}

#[tauri::command]
async fn stop_solo_stratum(state: State<'_, AppState>) -> Result<bool, String> {
    let mut guard = state.solo_stratum_process.lock().map_err(lock_err)?;
    if let Some(child) = guard.take() {
        child.kill().map_err(|e| e.to_string())?;
        drop(guard);
        *state.solo_stratum_listen.lock().map_err(lock_err)? = None;
        return Ok(true);
    }
    Ok(false)
}

#[tauri::command]
async fn solo_stratum_status(state: State<'_, AppState>) -> Result<SoloStratumStatus, String> {
    let running = state.solo_stratum_process.lock().map_err(lock_err)?.is_some();
    let listen_addr = state.solo_stratum_listen.lock().map_err(lock_err)?.clone();
    Ok(SoloStratumStatus { running, listen_addr })
}

// ============================================================
// GENERIC WALLET CLI + RPC PROXIES
// ============================================================
//
// `wallet_cli_run` shells out to `irium-wallet <subcommand> [args...]`
// and returns the parsed JSON (or the raw stdout wrapped as a JSON
// string). `rpc_proxy` issues an HTTP request to iriumd at the active
// rpc_url with the active bearer token, returning parsed JSON (or raw
// text). Together they back every documented wallet-CLI subcommand and
// iriumd RPC endpoint from the corresponding tauri.ts namespaces —
// extras can be added later without touching the backend.

#[tauri::command]
async fn wallet_cli_run(
    state: State<'_, AppState>,
    subcommand: String,
    args: Option<Vec<String>>,
    include_rpc: Option<bool>,
) -> Result<serde_json::Value, String> {
    let wallet_path = state.wallet_path.lock().map_err(lock_err)?.clone();
    let data_dir = state.data_dir.lock().map_err(lock_err)?.clone();
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();

    let mut full_args = vec![subcommand];
    if let Some(a) = args {
        full_args.extend(a);
    }

    let stdout = if include_rpc.unwrap_or(false) {
        run_wallet_cmd_with_rpc(full_args, wallet_path, data_dir, rpc_url).await?
    } else {
        run_wallet_cmd(full_args, wallet_path, data_dir).await?
    };

    match serde_json::from_str::<serde_json::Value>(stdout.trim()) {
        Ok(v) => Ok(v),
        Err(_) => Ok(serde_json::Value::String(stdout)),
    }
}

#[tauri::command]
async fn rpc_proxy(
    state: State<'_, AppState>,
    method: String,
    path: String,
    query: Option<HashMap<String, String>>,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let rpc_url = state.rpc_url.lock().map_err(lock_err)?.clone();
    let bearer = snapshot_gui_rpc_bearer(&state.rpc_token_override);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!(
        "{}{}",
        rpc_url.trim_end_matches('/'),
        if path.starts_with('/') { path.clone() } else { format!("/{}", path) }
    );

    let reqwest_method = reqwest::Method::from_bytes(method.to_uppercase().as_bytes())
        .map_err(|e| format!("invalid method {}: {}", method, e))?;

    let mut req = client.request(reqwest_method, &url);
    if let Some(q) = &query {
        req = req.query(q);
    }
    if let Some(b) = body {
        req = req.json(&b);
    }
    if let Some(t) = bearer {
        if !t.is_empty() {
            req = req.bearer_auth(t);
        }
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("{} {}: {}", status.as_u16(), status.canonical_reason().unwrap_or(""), text));
    }
    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(v) => Ok(v),
        Err(_) => Ok(serde_json::Value::String(text)),
    }
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
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    use tokio_tungstenite::tungstenite::http::HeaderValue;
    use futures_util::{StreamExt, SinkExt};

    let url = "ws://127.0.0.1:38300/ws";
    // FIX 2 (IRIUM_RPC_TOKEN): iriumd's /ws endpoint is gated by
    // require_rpc_auth — without an Authorization header the upgrade
    // returns 401 and the loop in spawn_ws_bridge logs a 401 every 5s.
    // The URL is hardcoded localhost, so we always use the local
    // auto-minted token (RPC_TOKEN), not the override — the override
    // is the *remote* node's token in FIX 3 remote mode and would not
    // authenticate against the local iriumd. If RPC_TOKEN isn't set
    // yet (very early startup) or HeaderValue rejects the formatted
    // value, the request goes out unauthenticated and reverts to the
    // current 401-loop behavior — no regression.
    let mut request = url.into_client_request().map_err(|e| e.to_string())?;
    if let Some(token) = RPC_TOKEN.get() {
        if let Ok(val) = HeaderValue::from_str(&format!("Bearer {}", token)) {
            request.headers_mut().insert("Authorization", val);
        }
    }
    let (ws_stream, _resp) = connect_async(request).await.map_err(|e| e.to_string())?;
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
            // Initialize the RPC token first thing in setup so it's
            // available when start_node and any wallet sidecar call fire.
            // get_or_init makes this idempotent if setup ever runs twice.
            let token_dir = app.path_resolver()
                .app_data_dir()
                .unwrap_or_else(|| std::env::temp_dir().join("irium-core"));
            RPC_TOKEN.get_or_init(|| init_rpc_token(&token_dir));

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

            // FIX 1 (UPnP): kick off a UPnP discovery on startup so the
            // first get_node_status / Help page render already has the
            // chosen-adapter / external-IP / double-NAT verdict cached.
            // Without this the very first poll always shows
            // upnp_active=false even when the router would have happily
            // accepted the mapping, because try_upnp_port_map only ran on
            // explicit user click. Spawned async so the splash doesn't
            // block on the SSDP 2s timeout.
            let upnp_app_handle = app.handle();
            tauri::async_runtime::spawn(async move {
                let state = upnp_app_handle.state::<AppState>();
                let attempt = try_upnp(38291).await;
                if let Ok(mut g) = state.upnp_external_ip.lock() {
                    *g = attempt.external_ip.clone();
                }
                if let Ok(mut g) = state.upnp_double_nat.lock() {
                    *g = attempt.double_nat;
                }
                if let Ok(mut g) = state.upnp_diagnostics.lock() {
                    *g = attempt.diagnostics;
                }
                if attempt.external_ip.is_some()
                    && !UPNP_REFRESH_RUNNING.swap(true, std::sync::atomic::Ordering::SeqCst)
                {
                    let upnp_external_ip_ref = Arc::clone(&state.upnp_external_ip);
                    let upnp_double_nat_ref = Arc::clone(&state.upnp_double_nat);
                    let upnp_diag_ref = Arc::clone(&state.upnp_diagnostics);
                    tauri::async_runtime::spawn(async move {
                        loop {
                            tokio::time::sleep(std::time::Duration::from_secs(
                                UPNP_REFRESH_INTERVAL_SECS,
                            ))
                            .await;
                            let fresh = try_upnp(38291).await;
                            if let Ok(mut g) = upnp_external_ip_ref.lock() {
                                *g = fresh.external_ip.clone();
                            }
                            if let Ok(mut g) = upnp_double_nat_ref.lock() {
                                *g = fresh.double_nat;
                            }
                            if let Ok(mut g) = upnp_diag_ref.lock() {
                                *g = fresh.diagnostics;
                            }
                        }
                    });
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
            reset_node_state_keep_blocks,
            scan_quarantined_blocks,
            clear_quarantined_blocks,
            get_quarantine_dismissed,
            set_quarantine_dismissed,
            save_discovered_peers,
            check_binaries,
            try_upnp_port_map,
            check_port_open,
            // FIX 1 (UPnP multi-adapter): exposes the full UPnP discovery
            // trace (chosen LAN adapter, gateway, control URL, retry chain,
            // double-NAT verdict) so the Help page can show *why* UPnP
            // failed even when the router's own UI says the mapping is
            // active.
            upnp_diagnostics,
            get_app_version,
            check_network_reachable,
            get_system_info,
            // Wallet
            wallet_get_balance,
            wallet_new_address,
            wallet_list_addresses,
            wallet_send,
            wallet_transactions,
            wallet_pending_transactions,
            wallet_set_path,
            list_wallet_files,
            get_wallet_info,
            delete_wallet_file,
            rename_wallet_file,
            wallet_create,
            wallet_node_info,
            wallet_migrate_to_encrypted,
            wallet_recover_from_seed,
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
            // FIX 3 (Remote node): pre-flight probe used by Settings.
            test_remote_connection,
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
            agreement_audit,
            agreement_remove,
            agreement_create,
            agreement_pack,
            agreement_unpack,
            agreement_release,
            agreement_refund,
            // FIX 1: Settlement secret retrieval — the GUI calls these on
            // the Release button to look up the random preimage that the
            // Hub stored at agreement-create time.
            get_agreement_secret,
            get_milestone_secret,
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
            get_richlist,
            get_pool_stats,
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
            // Solo Stratum bridge
            start_solo_stratum,
            stop_solo_stratum,
            solo_stratum_status,
            // Generic wallet CLI + RPC proxies (back every documented
            // irium-wallet subcommand and iriumd RPC endpoint exposed by
            // the tauri.ts walletCli and rpcCall namespaces).
            wallet_cli_run,
            rpc_proxy,
        ])
        .build(tauri::generate_context!())
        .expect("error while running Irium Core")
        .run(|_app_handle, _event| {
            // On Windows, kill all node sidecars when the updater has finished
            // downloading the NSIS installer and is about to launch it. The
            // sidecars survive the Tauri process exit on Windows (they are not
            // true children of the GUI process), so NSIS cannot overwrite their
            // binaries without an explicit kill first.
            //
            // FIX (state-corruption-on-update): iriumd takes the graceful soft-
            // kill path with a 5 s timeout so its persist queue drains cleanly
            // on Unix. On Windows the timeout lapses and we fall back to the
            // existing force-kill until iriumd ships a ctrl-c handler upstream.
            // miner and explorer sidecars write no persistent state, so they
            // keep the original force-kill flow.
            #[cfg(target_os = "windows")]
            if let tauri::RunEvent::Updater(
                tauri::UpdaterEvent::Downloaded,
            ) = &_event
            {
                let state = _app_handle.state::<AppState>();
                shutdown_iriumd_soft_then_force(&state.node_process, 5000);
                if let Ok(mut g) = state.miner_process.lock() {
                    if let Some(child) = g.take() { let _ = child.kill(); }
                }
                if let Ok(mut g) = state.explorer_process.lock() {
                    if let Some(child) = g.take() { let _ = child.kill(); }
                }
                if let Ok(mut g) = state.solo_stratum_process.lock() {
                    if let Some(child) = g.take() { let _ = child.kill(); }
                }
                for name in [
                    "irium-miner-x86_64-pc-windows-msvc.exe",
                    "irium-miner-gpu-x86_64-pc-windows-msvc.exe",
                    "irium-explorer-x86_64-pc-windows-msvc.exe",
                ] {
                    let _ = silent_command("taskkill")
                        .args(["/F", "/T", "/IM", name])
                        .output();
                }
                std::thread::sleep(std::time::Duration::from_millis(1500));
            }
        });
}
