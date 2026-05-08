# Irium Core

> Full node desktop wallet for the Irium blockchain.

Irium Core is a desktop application that bundles a full Irium blockchain node, a non-custodial wallet, a peer-to-peer marketplace, and a cryptographic settlement engine in one native window — analogous to Bitcoin Core but purpose-built for commerce. It lets you run and query your own node, send and receive IRM, create escrow agreements between parties, browse OTC offers, track on-chain reputation, and optionally mine.

The GUI layer is built with Tauri v1 (Rust backend + WebView2 frontend) and React 18. The app works fully in mock/demo mode without any real node binary present, making it easy to develop and preview.

---

## Screenshots

> _Screenshots coming soon. Run `npm run tauri dev` to preview the application._

---

## Requirements

| Dependency | Minimum | Notes |
|---|---|---|
| Node.js | 18 LTS | npm 9+ |
| Rust | 1.70 | Install via [rustup.rs](https://rustup.rs) |
| Windows | 10 / 11 | WebView2 runtime required |
| WebView2 | Any | Bundled with Windows 11; [download for Windows 10](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) |
| MSVC Build Tools | 2019+ | "Desktop development with C++" workload |

---

## Quick Start

The node daemon, wallet CLI, and miner are compiled from the [irium](https://github.com/iriumlabs/irium) source repository automatically — no manual binary downloads needed.

```powershell
# 1. Clone with submodules (fetches irium node source automatically)
git clone --recurse-submodules https://github.com/iriumlabs/irium-core-gui.git
cd irium-core-gui

# 2. Install frontend dependencies
npm install

# 3. Build node binaries and launch (first build: 30–90 min; incremental: <5 min)
npm run tauri:dev
```

> **How it works:** `npm run tauri:dev` first compiles `iriumd`, `irium-wallet`, and `irium-miner` from the `irium-source/` submodule, then starts the Tauri dev server. Subsequent runs detect that the binaries are up to date and skip the Rust compilation step.

---

## Building from Source

```powershell
# Clone with submodules
git clone --recurse-submodules https://github.com/iriumlabs/irium-core-gui.git
cd irium-core-gui
npm ci

# Build everything (node binaries + Tauri installer)
npm run tauri:build
```

The installer is placed at:
```
src-tauri\target\release\bundle\msi\Irium Core_1.0.0_x64_en-US.msi
```
or for NSIS:
```
src-tauri\target\release\bundle\nsis\Irium Core_1.0.0_x64-setup.exe
```

### Updating the node binaries

When `irium-source` receives upstream commits, rebuild the binaries:

```powershell
git submodule update --remote irium-source
npm run build:node          # auto-detects the submodule changed and rebuilds
```

Force a clean rebuild at any time:
```powershell
npm run build:node:force
```

---

## Binary Placement (legacy / manual override)

Binaries are now built from source automatically. If you need to override with
a pre-built binary for testing, place it here matching the naming convention:

```
src-tauri\binaries\
  iriumd-x86_64-pc-windows-msvc.exe          ← full node daemon
  irium-wallet-x86_64-pc-windows-msvc.exe    ← wallet CLI
  irium-miner-x86_64-pc-windows-msvc.exe     ← CPU miner
```

The `x86_64-pc-windows-msvc` suffix is the Rust target triple and is required by Tauri's sidecar naming convention. Tauri appends it automatically at build time — the `externalBin` entries in `tauri.conf.json` list the base names only.

---

## Architecture

```
irium-core/
├── src/                        ← React 18 + TypeScript frontend
│   ├── App.tsx                 ← Router, layout, global state bootstrap
│   ├── pages/                  ← One file per page (Dashboard, Wallet, …)
│   ├── components/
│   │   └── layout/             ← Sidebar, TopBar, StatusBar
│   └── lib/
│       ├── tauri.ts            ← All Tauri invoke() calls, safeInvoke wrapper
│       ├── mock.ts             ← Full mock data layer with live tickers
│       ├── store.ts            ← Zustand global state (nodeStatus, balance, …)
│       ├── types.ts            ← TypeScript types mirroring Rust structs
│       └── irium-sdk.ts        ← Typed IriumClient SDK class
├── src-tauri/
│   ├── src/
│   │   ├── main.rs             ← All Tauri commands, system tray, AppState
│   │   └── types.rs            ← Rust structs matching TypeScript types
│   ├── tauri.conf.json         ← Window config, allowlist, bundle config
│   └── Cargo.toml              ← Rust dependencies
└── scripts/
    └── build-windows.ps1       ← Automated Windows production build script
```

**Key patterns:**

- **safeInvoke**: Every Tauri call goes through `safeInvoke<T>()` which detects `'__TAURI__' in window`. In a browser (Vite dev server only) it returns mock data after a realistic delay; in the real Tauri window it calls the Rust command.
- **Zustand store**: Global state lives in `src/lib/store.ts`. The `useNodePoller` hook polls every 5 seconds and updates `nodeStatus` and `balance`.
- **IriumClient SDK**: `src/lib/irium-sdk.ts` exports a typed `IriumClient` class and `iriumClient` singleton that wrap the full API surface — useful for scripting and future external integrations.

**Stack:**

| Layer | Technology |
|---|---|
| Shell | Tauri v1 (Rust + WebView2) |
| Framework | React 18 with TypeScript |
| Routing | React Router v6 |
| Styling | Tailwind CSS v3 |
| Animations | Framer Motion |
| State | Zustand |
| Charts | Recharts |
| Icons | Lucide React |
| Toasts | React Hot Toast |

---

## Features

| Page | Description |
|---|---|
| **Dashboard** | Live node stats, balance overview, recent transactions, active agreements, block ticker with glow animation |
| **Wallet** | Balance hero, send/receive modals with confirmation step, address book, full transaction history |
| **Settlement** | Wizard-based agreement creation for four templates: OTC Trade, Freelance, Milestone, and Deposit |
| **Marketplace** | Browse, filter, and take OTC offers; manage your own listings; subscribe to remote offer feeds |
| **Agreements** | List all escrow agreements with inline expansion; submit proofs; release or refund funds |
| **Reputation** | Search any pubkey or address; animated score ring; risk signal; agreement history timeline |
| **Miner** | Start/stop CPU miner; live hashrate chart with sine-wave mock; block reward counter |
| **Settings** | RPC URL, wallet path, data directory, currency display; persisted to `AppData\irium-core-settings.json` |

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+1` | Dashboard |
| `Ctrl+2` | Wallet |
| `Ctrl+3` | Settlement |
| `Ctrl+4` | Marketplace |
| `Ctrl+5` | Agreements |
| `Ctrl+6` | Reputation |
| `Ctrl+7` | Miner |
| `Ctrl+8` | Settings |
| `Ctrl+R` | Refresh current page |
| `Ctrl+N` | Open Receive modal |
| `Ctrl+S` | Open Send modal |
| `Escape` | Close active modal |
| `Ctrl+Shift+D` | Dev mode toast (debug) |

---

## System Tray

Closing the window hides Irium Core to the system tray rather than quitting. Right-click the tray icon for:

- **Show Irium Core** — bring the window back
- **Quit** — exit the application completely

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Make your changes and ensure `npx tsc --noEmit` passes with zero errors
4. Open a pull request against `main`

Please keep PRs focused. Each PR should do one thing. Bug fixes and feature additions should be separate.

---

## License

MIT © 2024 Irium Labs
