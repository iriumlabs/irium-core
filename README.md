# Irium Core (Full-Node Desktop App)

<p align="center">
  <img src="public/Irium-Logo.png" alt="Irium Core" width="160" />
</p>

[![Tauri](https://img.shields.io/badge/Tauri-Desktop-orange?logo=tauri)](https://tauri.app/)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-blue)](https://github.com/iriumlabs/irium-core/releases/latest)
[![Algorithm](https://img.shields.io/badge/Algorithm-SHA256d-blue)](https://github.com/iriumlabs/irium)
[![Mining](https://img.shields.io/badge/Mining-CPU%20%7C%20GPU%20%7C%20ASIC-yellowgreen)](https://github.com/iriumlabs/irium-core)
[![License](https://img.shields.io/badge/License-MIT-lightgrey)](LICENSE)
[![Latest Release](https://img.shields.io/github/v/release/iriumlabs/irium-core)](https://github.com/iriumlabs/irium-core/releases/latest)

## Irium Core

Irium Core is the **official full-node desktop wallet and miner** for the [Irium blockchain](https://github.com/iriumlabs/irium).

It bundles:

- An embedded full Irium node (`iriumd`)
- A non-custodial BIP39 HD wallet
- CPU, GPU (OpenCL), and ASIC/Stratum mining
- An in-app block explorer
- Settlement and marketplace UI
- A first-run onboarding wizard

Your keys never leave your machine. All node operations go through a locally-spawned `iriumd` on loopback RPC — no third-party servers, no custodial relays.

---

### Features

- Full Irium node embedded as a sidecar (`iriumd`)
- HD wallet with 24-word BIP39 recovery phrase
- Multi-address management with custom labels
- Send / receive IRM with on-chain fee estimation
- Live block-info strip: current height, previous hash, block time, network difficulty
- CPU mining (solo and Stratum pool)
- GPU mining via OpenCL (NVIDIA / AMD / Intel)
- ASIC mining via the embedded Stratum proxy on `127.0.0.1:4444`
- In-app block explorer fed from the local node
- Settlement UI: OTC, freelance, milestone, deposit agreements
- Peer-to-peer marketplace for trustless offers
- Four selectable themes (Midnight, Obsidian, Aurora, Nebula)
- Runs on Windows, Linux, and macOS — built with Rust and Tauri

---

### Download

Get the installer for your platform from the [Releases](https://github.com/iriumlabs/irium-core/releases/latest) page.

| Platform | Installer |
|----------|-----------|
| Windows  | `.exe` (NSIS) or `.msi` |
| macOS    | `.dmg` (Intel and Apple Silicon) |
| Linux    | `.deb` or `.AppImage` |

Each installer bundles `iriumd`, `irium-wallet`, `irium-miner`, and `irium-explorer`. No external dependencies required.

---

### Screenshots

_Coming soon._

---

# Quick Links

Website https://iriumlabs.org

Explorer https://www.iriumlabs.org/explorer

Mining Pool stratum+tcp://pool.iriumlabs.org:3333

Bitcointalk ANN https://bitcointalk.org/index.php?topic=5572239.0

Telegram https://t.me/iriumlabs

GitHub Organization https://github.com/iriumlabs


---

# Build from Source

### 1. Prerequisites

| | Windows | Linux | macOS |
|-|---------|-------|-------|
| Node.js | 20+ | 20+ | 20+ |
| Rust    | 1.75+ (MSVC toolchain) | 1.75+ | 1.75+ |
| System  | MSVC Build Tools, WebView2 SDK | `libwebkit2gtk-4.0-dev`, `libgtk-3-dev`, `libssl-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev` | Xcode Command Line Tools |

### 2. Clone with submodules

```bash
git clone --recurse-submodules https://github.com/iriumlabs/irium-core.git
cd irium-core
```

### 3. Install npm dependencies

```bash
npm install
```

### 4. Build the node sidecars

This compiles `iriumd`, `irium-wallet`, `irium-miner`, and `irium-explorer` from the pinned `irium-source` submodule. First build is 30–90 minutes; subsequent runs use cargo's incremental cache.

```bash
npm run build:node
```

### 5. Build the desktop app

```bash
npm run tauri build
```

Installers land under `src-tauri/target/release/bundle/`.

### Bumping the bundled node version

```bash
git submodule update --remote irium-source
npm run build:node -- --force
```

---

# Run

Launch Irium Core from your applications menu. On first run the onboarding wizard walks you through:

1. Picking a data directory (default: `~/.irium`)
2. Creating a wallet (a fresh BIP39 24-word phrase) or importing an existing seed
3. Starting the embedded node — it syncs the chain to the latest mainnet tip

After setup, the Dashboard shows balance, recent transactions, peer count, and chain height in real time. Send and receive from the Wallet tab. Mine from the Miner tab. Browse blocks from the Explorer tab. Settings exposes the data directory, RPC URL, currency display, theme picker, and a factory-reset button.

---

# Repository Layout

```
irium-core/
├── src/                  React 18 + TypeScript frontend (Vite, Tailwind)
├── src-tauri/            Rust backend (Tauri commands, sidecar lifecycle)
├── irium-source/         Submodule pinning iriumlabs/irium commit
├── scripts/              Build automation (cargo + sidecar copy)
└── public/               Static assets
```

The desktop app spawns `iriumd`, `irium-wallet`, `irium-miner`, and `irium-explorer` as Tauri sidecars. All node operations go through `iriumd`'s loopback RPC on port `38300`. The frontend talks to the Rust backend via Tauri's `invoke()` IPC; the backend translates those calls into sidecar process spawns and RPC requests.

---

# Related Repositories

| Repo | Purpose |
|------|---------|
| [iriumlabs/irium](https://github.com/iriumlabs/irium) | Upstream Rust node, miner, wallet, SPV utilities |
| [iriumlabs/irium-core](https://github.com/iriumlabs/irium-core) | This repo — desktop GUI |

---

# Troubleshooting

Node won't sync  
→ check the Settings page for peer count and RPC reachability; restart the node from the Settings panel

Wallet shows zero after restart  
→ confirm the data directory in Settings matches your previous install (default `~/.irium`)

GPU miner unavailable  
→ install your GPU vendor's OpenCL runtime (NVIDIA / AMD driver, or Intel OpenCL SDK) and relaunch

"Failed to fetch" on the RPC connection  
→ Settings page test routes through Tauri's HTTP API, not the browser fetch. If you still see this, ensure `iriumd` is running on `127.0.0.1:38300`

---

# Need Help?

Telegram  
https://t.me/iriumlabs

Bitcointalk  
https://bitcointalk.org/index.php?topic=5572239.0

When asking for help, please include:

• Operating system  
• Irium Core version (Settings → About)  
• Relevant log output (Logs tab)

# Contributing

Irium Core is open-source. Pull requests welcome for the desktop app, build automation, and frontend. Node-level changes belong in the upstream [iriumlabs/irium](https://github.com/iriumlabs/irium) repo — `irium-core` pins it as a submodule.

---

# License

MIT License
