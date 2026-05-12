# Irium Core

**Full-node desktop wallet and miner for the Irium (IRM) blockchain.**

[![License: MIT](https://img.shields.io/badge/License-MIT-lightgrey)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-blue)](https://github.com/iriumlabs/irium-core/releases/latest)
[![Latest Release](https://img.shields.io/github/v/release/iriumlabs/irium-core)](https://github.com/iriumlabs/irium-core/releases/latest)

---

## What is Irium Core

Irium Core is the official desktop application for the [Irium blockchain](https://github.com/iriumlabs/irium). It bundles a full Irium node, a non-custodial HD wallet, a CPU and GPU miner, and an in-app block explorer in one native window. Built with Rust and Tauri for performance and a small footprint; runs on Windows, Linux, and macOS.

Your keys never leave your machine. The app spawns a local `iriumd` and talks to it over loopback RPC — no third-party servers, no custodial relays.

---

## Features

| Feature | Status |
|---------|--------|
| Full Irium node (embedded `iriumd`) | Live |
| HD wallet (BIP39 24-word recovery phrase) | Live |
| Multi-address management with labels | Live |
| Send / receive IRM with fee estimation | Live |
| CPU mining (solo and Stratum pool) | Live |
| GPU mining (OpenCL) | Requires OpenCL SDK on the build host |
| In-app block explorer | Live |
| Settlement and agreements UI | Live |
| Marketplace and reputation UI | Live |
| First-run onboarding wizard | Live |

---

## Install

Download the installer for your platform from the [Releases](https://github.com/iriumlabs/irium-core/releases) page:

| Platform | Installer |
|----------|-----------|
| Windows  | `Irium Core_1.0.0_x64_en-US.msi` or `Irium Core_1.0.0_x64-setup.exe` |
| Linux    | `irium-core_1.0.0_amd64.AppImage` / `.deb` (coming soon) |
| macOS    | `Irium Core_1.0.0_x64.dmg` (coming soon) |

The Windows installer bundles `iriumd`, `irium-wallet`, and `irium-miner` — no external dependencies required.

---

## Run

Launch Irium Core from your applications menu. On first run the onboarding wizard walks you through:

1. Picking a data directory (default: `~/.irium`)
2. Creating a wallet (a fresh BIP39 24-word phrase) or importing an existing seed
3. Starting the embedded node — it syncs the chain to the latest mainnet tip

After setup, the Dashboard shows balance, recent transactions, peer count, and chain height in real time. Send and receive from the Wallet tab. Mine from the Miner tab. Browse blocks from the Explorer tab. Settings exposes the data directory, RPC URL, currency display, and a factory-reset button.

---

## Build from Source

### Prerequisites

| | Windows | Linux | macOS |
|-|---------|-------|-------|
| Node.js | 18+ | 18+ | 18+ |
| Rust    | 1.75+ (MSVC toolchain) | 1.75+ | 1.75+ |
| System  | MSVC Build Tools, WebView2 SDK | `libwebkit2gtk-4.0-dev`, `libgtk-3-dev`, `libssl-dev` | Xcode Command Line Tools |

### Build

```bash
git clone --recurse-submodules https://github.com/iriumlabs/irium-core.git
cd irium-core
npm install
npm run build:node       # compiles iriumd, irium-wallet, irium-miner
npm run tauri build      # produces the platform installer
```

Installers land under `src-tauri/target/release/bundle/`.

The `irium-source/` submodule pins a specific `iriumlabs/irium` commit. To bump it to the latest upstream:

```bash
git submodule update --remote irium-source
npm run build:node -- --force
```

---

## Architecture

```
irium-core/
├── src/                  React 18 + TypeScript frontend (Vite, Tailwind)
├── src-tauri/            Rust backend (Tauri commands, sidecar lifecycle)
├── irium-source/         Submodule pinning the iriumlabs/irium node version
├── scripts/              Build automation (cargo + sidecar copy)
└── public/               Static assets
```

The desktop app spawns `iriumd`, `irium-wallet`, and `irium-miner` as Tauri sidecars. All node operations go through `iriumd`'s loopback RPC on port 38300. The frontend talks to the Rust backend via Tauri's `invoke()` IPC; the backend translates those calls into sidecar process spawns and RPC requests.

---

## Documentation

| Document | What it covers |
|----------|----------------|
| [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) | How to contribute |
| [docs/DESKTOP.md](docs/DESKTOP.md) | Desktop app architecture |
| [docs/IRIUM-JS-SDK.md](docs/IRIUM-JS-SDK.md) | JavaScript SDK reference |
| [docs/WEB-WALLET.md](docs/WEB-WALLET.md) | Browser-based wallet variant |
| [docs/MOBILE.md](docs/MOBILE.md) | Mobile wallet (Capacitor) |
| [docs/MARKETPLACE.md](docs/MARKETPLACE.md) | OTC marketplace |
| [TESTING.md](TESTING.md) | Testing guide |
| [CHANGELOG.md](CHANGELOG.md) | Release history |
| [RELEASE-NOTES.md](RELEASE-NOTES.md) | Per-version release notes |

For the underlying blockchain — protocol specification, node CLI, REST API — see the [Irium repo](https://github.com/iriumlabs/irium).

---

## Community

| | |
|-|--|
| Website | [iriumlabs.org](https://iriumlabs.org) |
| Telegram | [t.me/iriumlabs](https://t.me/iriumlabs) |
| Bitcointalk | [ANN thread](https://bitcointalk.org/index.php?topic=5572239.0) |
| Irium repo | [github.com/iriumlabs/irium](https://github.com/iriumlabs/irium) |
| GitHub Issues | [github.com/iriumlabs/irium-core/issues](https://github.com/iriumlabs/irium-core/issues) |

---

## License

MIT
