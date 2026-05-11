# Explorer Page Design

## Goal

Add a real-time network Explorer page to Irium Core that shows authoritative chain-wide data — height, supply, hashrate, difficulty, active miners, peers, recent blocks — sourced from the local `irium-explorer` sidecar. No central server. No external dependency. Every user running Irium Core sees the same chain data from their own node.

---

## Background

The Irium repo already contains `irium-explorer` — a fully-featured Rust HTTP service (5000+ lines) that reads from a local iriumd RPC and exposes rich explorer endpoints:

| Endpoint | Data |
|---|---|
| `GET /api/stats` | height, total_blocks, supply, peer_count, active_miners |
| `GET /api/metrics` | hashrate, difficulty, diff_change_1h_pct, diff_change_24h_pct, series |
| `GET /api/peers` | full peer list with dialable status, height, last_seen |
| `GET /api/blocks` | recent blocks with miner address, hash, timestamp |
| `GET /api/mining` | mining window stats |

It is fully configurable via env vars (`IRIUM_NODE_RPC`, `IRIUM_EXPLORER_HOST`, `IRIUM_EXPLORER_PORT`) and has zero hardcoded server dependency. The data it returns (height, supply, difficulty, hashrate, miners, agreements) is derived entirely from the local chain — identical on every fully-synced node.

---

## Architecture

```
User's machine
├── iriumd              sidecar — P2P port 38291, RPC port 38300
├── irium-wallet        sidecar — CLI tool
└── irium-explorer      sidecar (NEW) — reads localhost:38300, serves localhost:38310

Irium Core app
├── Dashboard           queries localhost:38300 (unchanged)
├── Explorer (NEW)      queries localhost:38310 via Tauri commands
└── Settings            unchanged
```

`irium-explorer` starts when the node starts, stops when the node stops. The Explorer page queries it via three new Tauri commands. If the sidecar is not yet running (startup race) or the binary is absent, the page shows a graceful "explorer offline" state rather than erroring.

---

## Components

### 1. Sidecar binary

**File:** `src-tauri/binaries/irium-explorer-x86_64-pc-windows-msvc.exe`

Built from `~/irium/src/bin/irium-explorer.rs` cross-compiled for Windows. Declared in `tauri.conf.json` under `tauri.bundle.externalBin`.

**Env vars passed at launch:**
```
IRIUM_NODE_RPC=http://127.0.0.1:38300
IRIUM_EXPLORER_HOST=127.0.0.1
IRIUM_EXPLORER_PORT=38310
```

### 2. Sidecar lifecycle (`src-tauri/src/main.rs`)

- `AppState` gains `explorer_process: Mutex<Option<CommandChild>>`
- `start_node` spawns `irium-explorer` sidecar after iriumd starts, with a 2-second delay to let iriumd bind its RPC port. Falls back to PATH if sidecar binary absent.
- `stop_node` kills both iriumd and irium-explorer processes.
- `clear_node_state` unchanged — only touches chain data, not the explorer process.

### 3. Three new Tauri commands

**`get_explorer_stats`**
- Calls `localhost:38310/api/stats` and `localhost:38310/api/metrics` concurrently
- Merges into `ExplorerNetworkStats`: height, total_blocks, supply_irm, peer_count, active_miners, hashrate, difficulty, diff_change_1h_pct, diff_change_24h_pct, avg_block_time
- Timeout: 4s each. Returns error string if explorer is offline.

**`get_explorer_peers`**
- Calls `localhost:38310/api/peers`
- Returns `Vec<ExplorerPeer>`: multiaddr, dialable, height, last_seen, agent, source
- Timeout: 4s.

**`get_explorer_blocks`**
- Calls `localhost:38310/api/blocks?limit=10`
- Returns `Vec<ExplorerBlock>`: height, hash, miner_address, time, tx_count
- Timeout: 4s.

### 4. TypeScript types (`src/lib/types.ts`)

```typescript
export interface ExplorerNetworkStats {
  height: number
  total_blocks: number
  supply_irm: number
  peer_count: number
  active_miners: number
  hashrate: number           // H/s
  difficulty: number
  diff_change_1h_pct: number
  diff_change_24h_pct: number
  avg_block_time: number     // seconds
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

### 5. Tauri wrappers (`src/lib/tauri.ts`)

```typescript
export const explorer = {
  stats: () => safeInvoke<ExplorerNetworkStats>('get_explorer_stats'),
  peers: () => safeInvoke<ExplorerPeer[]>('get_explorer_peers'),
  blocks: () => safeInvoke<ExplorerBlock[]>('get_explorer_blocks'),
}
```

### 6. Explorer page (`src/pages/Explorer.tsx`)

**Route:** `/explorer`

**Layout — three sections:**

**Section 1 — Network Stats (stat cards, top row)**
Height · Total Blocks · Supply · Net Hashrate · Difficulty · Diff Δ (1h) · Active Peers · Active Miners · Avg Block Time

Each card uses the same animated count-up used on the Dashboard. Hashrate formatted as H/s → KH/s → MH/s → GH/s. Diff Δ shown green (negative = easier) or red (positive = harder) with % sign.

**Section 2 — Recent Blocks (table)**
Columns: Height · Hash (truncated, copyable) · Miner (truncated) · Time (relative, e.g. "3 min ago") · Txs
10 most recent blocks. Clicking a row is a no-op for now (block detail page is out of scope).

**Section 3 — Connected Peers (table)**
Columns: Address · Dialable (✅/❌) · Height · Last Seen (relative) · Source
Sorted: dialable peers first, then by last_seen descending.

**States:**
- Loading: skeleton cards
- Explorer offline (`irium-explorer` not reachable): amber banner "Explorer service starting…" with a note that it starts alongside the node
- Node offline: same offline state as Dashboard
- Data loaded: full layout

**Auto-refresh:** every 30 seconds via `setInterval`. Manual refresh button in page header.

### 7. Sidebar + routing

- New nav item "Explorer" with `Globe` icon between Dashboard and Wallet
- Route `/explorer` added to `App.tsx`

---

## Data Flow

```
Explorer.tsx
  → invoke('get_explorer_stats')
      → GET localhost:38310/api/stats   (4s timeout)
      → GET localhost:38310/api/metrics (4s timeout, concurrent)
      → merge → ExplorerNetworkStats

  → invoke('get_explorer_peers')
      → GET localhost:38310/api/peers
      → Vec<ExplorerPeer>

  → invoke('get_explorer_blocks')
      → GET localhost:38310/api/blocks?limit=10
      → Vec<ExplorerBlock>
```

---

## Error Handling

- `irium-explorer` not running → Tauri commands return `Err("explorer offline")` → page shows amber banner, retries on next 30s tick
- iriumd not running → `irium-explorer` also won't start → same amber banner
- Partial failure (stats ok, peers error) → show available sections, show inline error for failed sections
- Sidecar binary missing from `binaries/` → `start_node` logs a warning, skips explorer start, page shows offline banner permanently until binary is added

---

## Out of Scope

- Block detail page (`/explorer/block/:height`)
- Transaction lookup
- Address balance lookup
- Agreement explorer (separate feature)
- Public API exposure (user can open port 38310 manually if they want)
- Cross-compilation of Windows binary (handled separately outside this plan)
