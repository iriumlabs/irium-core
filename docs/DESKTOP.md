# Irium Desktop Wallet

A Tauri 1.x desktop application for managing an Irium node and wallet on Windows, macOS, and Linux.

---

## Architecture

```
irium-core/
├── src/                    # React 18 frontend
│   ├── App.tsx             # Root — lazy routes, UpdateBanner, AnimatePresence
│   ├── pages/              # Dashboard, Wallet, Settlement, Mining, Agreements,
│   │                       #   Marketplace, Reputation, Blocks, Settings
│   ├── components/
│   │   └── layout/         # Sidebar, TopBar, StatusBar, UpdateBanner
│   ├── lib/
│   │   ├── store.ts        # Zustand store — node state, balance, notifications, errors
│   │   ├── tauri.ts        # Tauri command wrappers (node, wallet, update)
│   │   ├── types.ts        # Shared types + formatIRM, timeAgo
│   │   └── errors.ts       # getUserMessage() — human-readable error strings
│   └── hooks/
│       └── useNodePoller.ts  # 10s polling for node status + balance
└── src-tauri/
    ├── src/main.rs         # Tauri app entry, command handlers
    ├── tauri.conf.json     # App config, sidecar declarations
    └── binaries/           # iriumd, irium-wallet, irium-miner (required)
```

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 18+ | `node --version` |
| Rust / Cargo | 1.70+ | `rustup update stable` |
| MSVC Build Tools | Latest | Windows only — "Desktop development with C++" |
| WebView2 Runtime | Any | Pre-installed on Windows 11 |

---

## First-Time Setup

```bash
# 1. Install npm dependencies
npm install

# 2. Place sidecar binaries (Windows x86-64)
mkdir src-tauri/binaries
# Copy iriumd.exe, irium-wallet.exe, irium-miner.exe and rename:
#   iriumd-x86_64-pc-windows-msvc.exe
#   irium-wallet-x86_64-pc-windows-msvc.exe
#   irium-miner-x86_64-pc-windows-msvc.exe

# 3. Launch dev mode (first run compiles Rust — 3–8 minutes)
npm run tauri dev
```

---

## npm Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Vite dev server only (no Tauri) |
| `npm run tauri dev` | Full Tauri dev mode |
| `npm run tauri build` | Production build + installer |
| `npx tsc --noEmit` | Type-check without compiling |

---

## Key Pages

### Dashboard
Real-time node status, block height flip animation, peer count, sync progress. Charts for hashrate and block times (Recharts).

### Wallet
Balance with gradient glow-on-receive animation. Transaction history. Send form with fee estimation and confirmation dialog.

### Settlement Hub
Four agreement templates (OTC, Freelance, Milestone, Deposit). Two-step wizard with live preview card. Calls `POST /settlement/{type}` on the node.

### Mining
CPU miner management via `irium-miner` sidecar. Start/stop, live hashrate display, blocks mined counter.

### Settings
Node path configuration, update checker (calls `update.check()` via Tauri updater plugin), Recent Errors log cleared from Zustand store.

---

## State Management

```ts
// store.ts — key slices
interface AppStore {
  nodeStatus:    NodeStatus | null;
  balance:       WalletBalance | null;
  notifications: Notification[];          // persistent bell dropdown
  errorLog:      ErrorEntry[];            // shown in Settings > Recent Errors
  updateInfo:    UpdateCheckResult | null;
}
```

The `useNodePoller` hook polls `/status` and `/rpc/balance` every 10 seconds, writing results directly into the store.

---

## Tauri Commands

Commands are defined in `src-tauri/src/main.rs` and called via `invoke()` in `src/lib/tauri.ts`:

| Command | Description |
|---------|-------------|
| `node_start` | Spawns the `iriumd` sidecar |
| `node_stop` | Kills the running iriumd process |
| `node_status` | Returns PID and running state |
| `wallet_send` | Calls `irium-wallet send` with args |
| `miner_start` | Spawns the `irium-miner` sidecar |
| `miner_stop` | Kills the running miner process |

---

## Update Flow

On startup, `App.tsx` calls `update.check()` from `@tauri-apps/api/updater`. If an update is available, `setUpdateInfo()` is called, causing `UpdateBanner` to slide in. The banner also listens for `update-available` Tauri events for mid-session updates.

---

## Error Handling

`src/lib/errors.ts` exports `getUserMessage(error)` which maps low-level errors (network, timeout, HTLC, etc.) to readable strings. All poll errors are logged via `logError()` in the store and displayed in Settings > Recent Errors.
