# Explorer Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real-time Explorer page to Irium Core that queries a local `irium-explorer` sidecar (localhost:38310) and shows chain-wide network stats, recent blocks, and connected peers — with zero central-server dependency.

**Architecture:** Ship `irium-explorer` as a fourth sidecar alongside iriumd/irium-wallet/irium-miner. App starts it after iriumd, kills it with the node. Three new Tauri commands proxy HTTP calls to localhost:38310. A new `/explorer` page polls every 30 seconds.

**Tech Stack:** Rust (Tauri v1 sidecar, reqwest), React 18, TypeScript, Framer Motion, Tailwind, lucide-react

---

## File Map

| File | Action | What changes |
|---|---|---|
| `src-tauri/tauri.conf.json` | Modify | Add irium-explorer to externalBin, shell scope, http allowlist |
| `src-tauri/src/types.rs` | Modify | Add ExplorerNetworkStats, ExplorerPeer, ExplorerBlock structs |
| `src-tauri/src/main.rs` | Modify | AppState.explorer_process, spawn/kill in start_node/stop_node, 3 new commands, register in invoke_handler |
| `src/lib/types.ts` | Modify | Add ExplorerNetworkStats, ExplorerPeer, ExplorerBlock interfaces |
| `src/lib/tauri.ts` | Modify | Add explorer namespace |
| `src/pages/Explorer.tsx` | Create | Full Explorer page component |
| `src/App.tsx` | Modify | Lazy import + route |
| `src/components/layout/Sidebar.tsx` | Modify | Globe nav item |

---

### Task 1: Update tauri.conf.json

**Files:**
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Add irium-explorer to externalBin**

In `tauri.conf.json`, change the `externalBin` array from:
```json
"externalBin": [
  "binaries/iriumd",
  "binaries/irium-wallet",
  "binaries/irium-miner"
]
```
to:
```json
"externalBin": [
  "binaries/iriumd",
  "binaries/irium-wallet",
  "binaries/irium-miner",
  "binaries/irium-explorer"
]
```

- [ ] **Step 2: Add irium-explorer to shell sidecar scope**

In the `shell.scope` array, add after the `irium-miner` entry:
```json
{
  "name": "irium-explorer",
  "sidecar": true
}
```

- [ ] **Step 3: Add localhost:38310 to http allowlist**

In `http.scope`, add:
```json
"http://127.0.0.1:38310/**"
```

The full `http.scope` after the change:
```json
"scope": [
  "http://127.0.0.1:38300/**",
  "https://127.0.0.1:38300/**",
  "http://localhost:38300/**",
  "http://localhost:5173/**",
  "http://127.0.0.1:38310/**"
]
```

- [ ] **Step 4: Verify the file is valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json','utf8')); console.log('OK')"`

Expected: `OK`

---

### Task 2: Add Rust types to types.rs

**Files:**
- Modify: `src-tauri/src/types.rs`

- [ ] **Step 1: Append the three new structs at the end of types.rs**

Add after the last struct in the file:
```rust
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
}
```

- [ ] **Step 2: Check it compiles**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`

Expected: `Finished` with no errors.

---

### Task 3: Update main.rs — AppState, lifecycle, commands

**Files:**
- Modify: `src-tauri/src/main.rs`

This is the largest task. Make all four edits sequentially.

- [ ] **Step 1: Add explorer_process field to AppState struct**

Find the `struct AppState {` block (lines 22-34). Add `explorer_process` after `miner_process`:
```rust
struct AppState {
    node_process: Arc<Mutex<Option<CommandChild>>>,
    miner_process: Arc<Mutex<Option<CommandChild>>>,
    explorer_process: Arc<Mutex<Option<CommandChild>>>,  // ← add this line
    rpc_url: Arc<Mutex<String>>,
    // ... rest unchanged
```

- [ ] **Step 2: Initialize explorer_process in AppState::new()**

Find `AppState {` inside `fn new() -> Self` (around line 37). Add after `miner_process`:
```rust
AppState {
    node_process: Arc::new(Mutex::new(None)),
    miner_process: Arc::new(Mutex::new(None)),
    explorer_process: Arc::new(Mutex::new(None)),  // ← add this line
    rpc_url: Arc::new(Mutex::new("http://127.0.0.1:38300".to_string())),
    // ... rest unchanged
```

- [ ] **Step 3: Spawn irium-explorer in start_node after iriumd starts**

Find the block starting with `Ok(NodeStartResult { success: true, message: "Node started (sidecar)".to_string(), pid: Some(pid), })` inside `start_node`. Replace that return with code that also starts the explorer:

```rust
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

                    // Spawn irium-explorer 2s after iriumd so its RPC port (38300) is ready.
                    let explorer_ref = Arc::clone(&state.explorer_process);
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                        let mut explorer_env = HashMap::new();
                        explorer_env.insert("IRIUM_NODE_RPC".to_string(), "http://127.0.0.1:38300".to_string());
                        explorer_env.insert("IRIUM_EXPLORER_HOST".to_string(), "127.0.0.1".to_string());
                        explorer_env.insert("IRIUM_EXPLORER_PORT".to_string(), "38310".to_string());

                        match Command::new_sidecar("irium-explorer") {
                            Ok(cmd) => {
                                match cmd.envs(explorer_env).spawn() {
                                    Ok((mut erx, echild)) => {
                                        if let Ok(mut lock) = explorer_ref.lock() {
                                            *lock = Some(echild);
                                        }
                                        tauri::async_runtime::spawn(async move {
                                            while let Some(event) = erx.recv().await {
                                                match event {
                                                    CommandEvent::Stdout(line) => tracing::info!("[irium-explorer] {}", line),
                                                    CommandEvent::Stderr(line) => tracing::warn!("[irium-explorer stderr] {}", line),
                                                    _ => break,
                                                }
                                            }
                                        });
                                    }
                                    Err(e) => tracing::warn!("[irium-explorer] spawn failed: {}", e),
                                }
                            }
                            Err(_) => tracing::warn!("[irium-explorer] sidecar binary not found in binaries/"),
                        }
                    });

                    Ok(NodeStartResult {
                        success: true,
                        message: "Node started (sidecar)".to_string(),
                        pid: Some(pid),
                    })
                }
```

- [ ] **Step 4: Kill explorer in stop_node**

In `stop_node`, after the block that kills `node_process`, add:
```rust
    // Kill the explorer sidecar
    {
        let mut proc_lock = state.explorer_process.lock().map_err(lock_err)?;
        if let Some(child) = proc_lock.take() {
            let _ = child.kill();
        }
    }
    // Also force-kill any orphaned explorer process
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/IM", "irium-explorer-x86_64-pc-windows-msvc.exe"])
            .output();
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/IM", "irium-explorer.exe"])
            .output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("pkill")
            .args(["-f", "irium-explorer"])
            .output();
    }
```

- [ ] **Step 5: Add the three new Tauri commands**

Add these three functions anywhere before the `invoke_handler!` macro (e.g., after the `get_network_metrics` command):

```rust
// ============================================================
// EXPLORER COMMANDS (queries irium-explorer sidecar on :38310)
// ============================================================

const EXPLORER_URL: &str = "http://127.0.0.1:38310";

#[tauri::command]
async fn get_explorer_stats() -> Result<ExplorerNetworkStats, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(4))
        .build()
        .map_err(|e| format!("client build failed: {}", e))?;

    let (stats_res, metrics_res) = tokio::join!(
        client.get(format!("{}/api/stats", EXPLORER_URL)).send(),
        client.get(format!("{}/api/metrics", EXPLORER_URL)).send(),
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
        .get(format!("{}/api/peers", EXPLORER_URL))
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
        multiaddr:  p["multiaddr"].as_str().unwrap_or("").to_string(),
        dialable:   p["dialable"].as_bool().unwrap_or(false),
        height:     p["height"].as_u64(),
        last_seen:  p["last_seen"].as_f64(),
        agent:      p["agent"].as_str().map(String::from),
        source:     p["source"].as_str().map(String::from),
    }).collect())
}

#[tauri::command]
async fn get_explorer_blocks() -> Result<Vec<ExplorerBlock>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(4))
        .build()
        .map_err(|e| format!("client build failed: {}", e))?;

    let val: serde_json::Value = client
        .get(format!("{}/api/blocks?limit=10", EXPLORER_URL))
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
    }).collect())
}
```

- [ ] **Step 6: Register the three commands in invoke_handler**

Find the `// Explorer` comment in `invoke_handler!` (line ~3597). Change:
```rust
            // Explorer
            explorer_agreements,
            explorer_stats,
```
to:
```rust
            // Explorer
            explorer_agreements,
            explorer_stats,
            // Explorer sidecar commands
            get_explorer_stats,
            get_explorer_peers,
            get_explorer_blocks,
```

- [ ] **Step 7: Check compilation**

Run: `cd src-tauri && cargo check 2>&1 | tail -10`

Expected: `Finished` with no errors.

---

### Task 4: Add TypeScript interfaces to types.ts

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add the three interfaces**

Find the `// EXPLORER` section that already exists in types.ts (line ~576). After the existing `ExplorerStats` interface, add:

```typescript
export interface ExplorerNetworkStats {
  height: number
  total_blocks: number
  supply_irm: number
  peer_count: number
  active_miners: number
  hashrate: number        // H/s
  difficulty: number
  diff_change_1h_pct: number
  diff_change_24h_pct: number
  avg_block_time: number  // seconds
}

export interface ExplorerPeer {
  multiaddr: string
  dialable: boolean
  height?: number
  last_seen?: number
  agent?: string
  source?: string
}

export interface ExplorerBlock {
  height: number
  hash: string
  miner_address?: string
  time: number
  tx_count: number
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: No errors related to the new types.

---

### Task 5: Add explorer namespace to tauri.ts

**Files:**
- Modify: `src/lib/tauri.ts`

- [ ] **Step 1: Add ExplorerNetworkStats, ExplorerPeer, ExplorerBlock to the import list**

Find the type import block at the top of tauri.ts. Add the three new types to the import:
```typescript
import type {
  // ... existing imports ...
  ExplorerNetworkStats, ExplorerPeer, ExplorerBlock,
} from './types';
```

- [ ] **Step 2: Add the explorer namespace**

After the last export in the file (e.g., after `export const network = {...}`), add:

```typescript
// ── EXPLORER (irium-explorer sidecar on :38310) ───────────────
export const explorer = {
  stats:  () => safeInvoke<ExplorerNetworkStats>('get_explorer_stats'),
  peers:  () => safeInvoke<ExplorerPeer[]>('get_explorer_peers'),
  blocks: () => safeInvoke<ExplorerBlock[]>('get_explorer_blocks'),
};
```

---

### Task 6: Create Explorer.tsx

**Files:**
- Create: `src/pages/Explorer.tsx`

- [ ] **Step 1: Create the file with the full implementation**

```tsx
import { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Globe, RefreshCw, AlertTriangle, Copy, CheckCircle2,
  Cpu, Users, Activity, Layers, Clock, Zap, TrendingUp,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useStore } from '../lib/store';
import { explorer } from '../lib/tauri';
import { timeAgo, truncateHash, truncateAddr } from '../lib/types';
import type { ExplorerNetworkStats, ExplorerPeer, ExplorerBlock } from '../lib/types';

// ── Helpers ──────────────────────────────────────────────────

function formatHashrate(hs: number): string {
  if (hs >= 1e9)  return `${(hs / 1e9).toFixed(2)} GH/s`;
  if (hs >= 1e6)  return `${(hs / 1e6).toFixed(2)} MH/s`;
  if (hs >= 1e3)  return `${(hs / 1e3).toFixed(2)} KH/s`;
  return `${hs.toFixed(0)} H/s`;
}

function useCountUp(target: number, duration = 1000): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (target === 0) { setCount(0); return; }
    let start = 0;
    const step = target / (duration / 16);
    const timer = setInterval(() => {
      start += step;
      if (start >= target) { setCount(target); clearInterval(timer); }
      else setCount(Math.floor(start));
    }, 16);
    return () => clearInterval(timer);
  }, [target, duration]);
  return count;
}

// ── Skeleton ─────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div
      className="rounded-xl p-4 animate-pulse"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div className="h-3 w-20 rounded mb-3" style={{ background: 'rgba(255,255,255,0.08)' }} />
      <div className="h-7 w-32 rounded" style={{ background: 'rgba(255,255,255,0.08)' }} />
    </div>
  );
}

function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-10 rounded-lg animate-pulse"
          style={{ background: 'rgba(255,255,255,0.03)' }}
        />
      ))}
    </div>
  );
}

// ── Stat card ────────────────────────────────────────────────

interface StatCardProps {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  subColor?: string;
}

function StatCard({ icon: Icon, label, value, sub, subColor }: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl p-4 flex flex-col gap-1"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon size={13} style={{ color: 'rgba(167,139,250,0.8)' }} />
        <span className="text-xs font-medium" style={{ color: 'rgba(238,240,255,0.45)' }}>{label}</span>
      </div>
      <span className="text-xl font-bold font-display" style={{ color: '#eef0ff' }}>{value}</span>
      {sub && (
        <span className="text-xs mt-0.5" style={{ color: subColor ?? 'rgba(238,240,255,0.35)' }}>{sub}</span>
      )}
    </motion.div>
  );
}

// ── Copy button ──────────────────────────────────────────────

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handle = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button onClick={handle} className="ml-1 opacity-40 hover:opacity-80 transition-opacity">
      {copied
        ? <CheckCircle2 size={12} style={{ color: '#34d399' }} />
        : <Copy size={12} />}
    </button>
  );
}

// ── Main page ────────────────────────────────────────────────

export default function Explorer() {
  const nodeStatus = useStore((s) => s.nodeStatus);

  const [stats,   setStats]   = useState<ExplorerNetworkStats | null>(null);
  const [peers,   setPeers]   = useState<ExplorerPeer[] | null>(null);
  const [blocks,  setBlocks]  = useState<ExplorerBlock[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);

    const [s, p, b] = await Promise.all([
      explorer.stats(),
      explorer.peers(),
      explorer.blocks(),
    ]);

    const explorerDown = s == null || (typeof s === 'string' && (s as string).includes('offline'));

    if (explorerDown) {
      setOffline(true);
    } else {
      setOffline(false);
      if (s) setStats(s as ExplorerNetworkStats);
      if (p) setPeers((p as ExplorerPeer[]).sort((a, b_) =>
        (b_.dialable ? 1 : 0) - (a.dialable ? 1 : 0) ||
        (b_.last_seen ?? 0) - (a.last_seen ?? 0)
      ));
      if (b) setBlocks(b as ExplorerBlock[]);
    }

    setLoading(false);
    if (isManual) setRefreshing(false);
  }, []);

  useEffect(() => {
    fetchAll();
    timerRef.current = setInterval(() => fetchAll(), 30_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchAll]);

  // Count-up animated values
  const heightCount   = useCountUp(stats?.height      ?? 0);
  const blocksCount   = useCountUp(stats?.total_blocks ?? 0);
  const peersCount    = useCountUp(stats?.peer_count   ?? 0);
  const minersCount   = useCountUp(stats?.active_miners ?? 0);

  const diffDelta1h  = stats?.diff_change_1h_pct  ?? 0;
  const diffDelta24h = stats?.diff_change_24h_pct ?? 0;

  const nodeOffline = !nodeStatus?.running;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4 flex-shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="flex items-center gap-3">
          <Globe size={18} style={{ color: '#A78BFA' }} />
          <span className="font-display font-bold text-base" style={{ color: '#eef0ff' }}>
            Network Explorer
          </span>
        </div>
        <button
          onClick={() => fetchAll(true)}
          disabled={refreshing}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: 'rgba(238,240,255,0.6)',
          }}
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

        {/* Offline banners */}
        <AnimatePresence>
          {nodeOffline && (
            <motion.div
              key="node-offline"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div
                className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm"
                style={{
                  background: 'rgba(239,68,68,0.07)',
                  border: '1px solid rgba(239,68,68,0.18)',
                  color: 'rgba(252,165,165,0.9)',
                }}
              >
                <AlertTriangle size={14} />
                Node is offline — start the node to use Explorer.
              </div>
            </motion.div>
          )}

          {!nodeOffline && offline && !loading && (
            <motion.div
              key="explorer-offline"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div
                className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm"
                style={{
                  background: 'rgba(245,158,11,0.07)',
                  border: '1px solid rgba(245,158,11,0.18)',
                  color: 'rgba(253,211,77,0.9)',
                }}
              >
                <AlertTriangle size={14} />
                Explorer service starting… it launches automatically with the node. Retrying every 30 s.
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Section 1: Network Stats */}
        <section>
          <h2
            className="text-xs font-semibold uppercase tracking-widest mb-3"
            style={{ color: 'rgba(238,240,255,0.35)' }}
          >
            Network Stats
          </h2>
          {loading ? (
            <div className="grid grid-cols-3 gap-3">
              {Array.from({ length: 9 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : stats ? (
            <div className="grid grid-cols-3 gap-3">
              <StatCard icon={Layers}    label="Height"        value={heightCount.toLocaleString()} />
              <StatCard icon={Layers}    label="Total Blocks"  value={blocksCount.toLocaleString()} />
              <StatCard
                icon={Activity}
                label="Supply"
                value={`${stats.supply_irm.toLocaleString('en-US', { maximumFractionDigits: 2 })} IRM`}
              />
              <StatCard
                icon={Zap}
                label="Net Hashrate"
                value={formatHashrate(stats.hashrate)}
              />
              <StatCard
                icon={TrendingUp}
                label="Difficulty"
                value={stats.difficulty.toLocaleString('en-US', { maximumFractionDigits: 2 })}
              />
              <StatCard
                icon={TrendingUp}
                label="Diff Δ (1h / 24h)"
                value={`${diffDelta1h >= 0 ? '+' : ''}${diffDelta1h.toFixed(2)}%`}
                sub={`24h: ${diffDelta24h >= 0 ? '+' : ''}${diffDelta24h.toFixed(2)}%`}
                subColor={diffDelta1h > 0 ? 'rgba(248,113,113,0.8)' : 'rgba(52,211,153,0.8)'}
              />
              <StatCard icon={Users}     label="Active Peers"   value={peersCount.toLocaleString()} />
              <StatCard icon={Cpu}       label="Active Miners"  value={minersCount.toLocaleString()} />
              <StatCard
                icon={Clock}
                label="Avg Block Time"
                value={`${stats.avg_block_time.toFixed(1)} s`}
              />
            </div>
          ) : null}
        </section>

        {/* Section 2: Recent Blocks */}
        <section>
          <h2
            className="text-xs font-semibold uppercase tracking-widest mb-3"
            style={{ color: 'rgba(238,240,255,0.35)' }}
          >
            Recent Blocks
          </h2>
          {loading ? (
            <SkeletonTable rows={5} />
          ) : blocks && blocks.length > 0 ? (
            <div
              className="rounded-xl overflow-hidden"
              style={{ border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>
                    {['Height', 'Hash', 'Miner', 'Time', 'Txs'].map((h) => (
                      <th
                        key={h}
                        className="text-left px-4 py-2.5 text-xs font-semibold"
                        style={{ color: 'rgba(238,240,255,0.35)' }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {blocks.map((block, i) => (
                    <tr
                      key={block.hash || i}
                      style={{
                        borderBottom: i < blocks.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                        background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                      }}
                    >
                      <td className="px-4 py-2.5" style={{ color: '#A78BFA', fontFamily: '"JetBrains Mono", monospace', fontSize: 12 }}>
                        #{block.height.toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5" style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: 'rgba(238,240,255,0.7)' }}>
                        {truncateHash(block.hash, 8)}
                        <CopyBtn text={block.hash} />
                      </td>
                      <td className="px-4 py-2.5" style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: 'rgba(238,240,255,0.55)' }}>
                        {block.miner_address ? truncateAddr(block.miner_address, 6, 6) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-xs" style={{ color: 'rgba(238,240,255,0.45)' }}>
                        {block.time ? timeAgo(block.time) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-xs" style={{ color: 'rgba(238,240,255,0.55)' }}>
                        {block.tx_count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : !offline ? (
            <div className="text-sm py-4 text-center" style={{ color: 'rgba(238,240,255,0.3)' }}>
              No blocks data available.
            </div>
          ) : null}
        </section>

        {/* Section 3: Connected Peers */}
        <section className="pb-6">
          <h2
            className="text-xs font-semibold uppercase tracking-widest mb-3"
            style={{ color: 'rgba(238,240,255,0.35)' }}
          >
            Connected Peers
          </h2>
          {loading ? (
            <SkeletonTable rows={5} />
          ) : peers && peers.length > 0 ? (
            <div
              className="rounded-xl overflow-hidden"
              style={{ border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>
                    {['Address', 'Dialable', 'Height', 'Last Seen', 'Source'].map((h) => (
                      <th
                        key={h}
                        className="text-left px-4 py-2.5 text-xs font-semibold"
                        style={{ color: 'rgba(238,240,255,0.35)' }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {peers.map((peer, i) => (
                    <tr
                      key={peer.multiaddr + i}
                      style={{
                        borderBottom: i < peers.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                        background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                      }}
                    >
                      <td className="px-4 py-2.5" style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: 'rgba(238,240,255,0.7)', maxWidth: 240 }}>
                        <span className="truncate block">{peer.multiaddr}</span>
                      </td>
                      <td className="px-4 py-2.5 text-center text-base">
                        {peer.dialable ? '✅' : '❌'}
                      </td>
                      <td className="px-4 py-2.5 text-xs" style={{ color: 'rgba(238,240,255,0.55)', fontFamily: '"JetBrains Mono", monospace' }}>
                        {peer.height != null ? `#${peer.height.toLocaleString()}` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-xs" style={{ color: 'rgba(238,240,255,0.45)' }}>
                        {peer.last_seen ? timeAgo(peer.last_seen) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-xs" style={{ color: 'rgba(238,240,255,0.35)' }}>
                        {peer.source ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : !offline ? (
            <div className="text-sm py-4 text-center" style={{ color: 'rgba(238,240,255,0.3)' }}>
              No peers visible yet.
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
```

---

### Task 7: Add route to App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the lazy import**

After the line `const Settings = lazy(() => import('./pages/Settings'));`, add:
```typescript
const Explorer = lazy(() => import('./pages/Explorer'));
```

- [ ] **Step 2: Add the route**

In the `<Routes>` block, after `<Route path="/dashboard" element={<Dashboard />} />`, add:
```tsx
<Route path="/explorer"    element={<Explorer />}    />
```

---

### Task 8: Add Explorer nav item to Sidebar.tsx

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Add Globe to the lucide-react import**

Change:
```typescript
import {
  LayoutDashboard, Wallet, ShieldCheck, ShoppingBag,
  FileText, Star, Cpu, Settings,
} from 'lucide-react';
```
to:
```typescript
import {
  LayoutDashboard, Wallet, ShieldCheck, ShoppingBag,
  FileText, Star, Cpu, Settings, Globe,
} from 'lucide-react';
```

- [ ] **Step 2: Add Explorer entry to the NAV array**

Change:
```typescript
const NAV = [
  { to: '/dashboard',   icon: LayoutDashboard, label: 'Dashboard'   },
  { to: '/wallet',      icon: Wallet,          label: 'Wallet'      },
```
to:
```typescript
const NAV = [
  { to: '/dashboard',   icon: LayoutDashboard, label: 'Dashboard'   },
  { to: '/explorer',    icon: Globe,           label: 'Explorer'    },
  { to: '/wallet',      icon: Wallet,          label: 'Wallet'      },
```

- [ ] **Step 3: Verify the app builds**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: No errors.

---

## Self-Review

### Spec coverage check

| Spec requirement | Task |
|---|---|
| irium-explorer as sidecar in tauri.conf.json | Task 1 |
| explorer_process in AppState | Task 3, Step 1-2 |
| Spawn after iriumd with 2s delay + env vars | Task 3, Step 3 |
| Kill on stop_node | Task 3, Step 4 |
| `get_explorer_stats` merging /api/stats + /api/metrics | Task 3, Step 5 |
| `get_explorer_peers` | Task 3, Step 5 |
| `get_explorer_blocks?limit=10` | Task 3, Step 5 |
| TypeScript interfaces (3) | Task 4 |
| `explorer.stats/peers/blocks` in tauri.ts | Task 5 |
| Explorer page with stat cards + 2 tables | Task 6 |
| Loading skeleton, offline banner, data states | Task 6 |
| 30s auto-refresh + manual refresh button | Task 6 |
| Globe icon in sidebar | Task 8 |
| `/explorer` route | Task 7 |

All requirements covered. ✅

### Notes for the implementer

- The http allowlist in tauri.conf.json only controls which URLs the **frontend** can call. The Tauri commands in main.rs use `reqwest` (backend), which bypasses the allowlist — so no changes needed for the commands themselves.
- `irium-explorer` binary must be at `src-tauri/binaries/irium-explorer-x86_64-pc-windows-msvc.exe` for the sidecar to launch. If absent, the node starts normally and the Explorer page shows the offline banner permanently.
- The `ExplorerStats` type that already exists in types.ts (line 591) is for the old wallet-based explorer endpoints — leave it untouched. The new types have distinct names.
- The `explorer_stats` and `explorer_agreements` commands already registered in invoke_handler refer to existing commands for the Irium agreement explorer (different feature). Do not remove or rename them.
