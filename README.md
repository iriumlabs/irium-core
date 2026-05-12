# Irium Core

<p align="center">
  <img src="./public/Irium-Logo.png" alt="Irium Core" width="160" />
</p>

<p align="center">
  <a href="https://github.com/iriumlabs/irium-core/releases"><img alt="Version" src="https://img.shields.io/badge/version-1.0.0-6ec6ff?style=flat-square" /></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-3b3bff?style=flat-square" />
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-a78bfa?style=flat-square" /></a>
  <img alt="Rust" src="https://img.shields.io/badge/Rust-1.75+-orange?style=flat-square&logo=rust" />
  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-1.x-24c8db?style=flat-square&logo=tauri" />
</p>

> **Irium Core** is the official full-node desktop wallet and miner for the Irium (IRM) blockchain — a proof-of-work, settlement-first blockchain for trustless commerce.

---

## Features

- 🟢 **Full Node** — runs a complete Irium node locally; no third-party trust.
- 🔐 **HD Wallet** — BIP39 24-word recovery phrase with multi-address support.
- ⛏️ **CPU Mining** — solo mining built in, with adjustable thread count and live hashrate.
- 🔎 **Block Explorer** — browse blocks, transactions, and addresses in-app.
- 💸 **Send & Receive** — full P2PKH transaction management with fee estimation.
- 🔒 **Privacy First** — your keys never leave your machine.

## Download

Grab the latest installer from the [Releases](https://github.com/iriumlabs/irium-core/releases) page:

| Platform | Installer |
|---|---|
| **Windows** | `Irium-Core_1.0.0_x64.msi` |
| **Linux**   | `irium-core_1.0.0_amd64.AppImage` / `.deb` |
| **macOS**   | `Irium-Core_1.0.0_x64.dmg` |

## Screenshots

_Coming soon._

## System Requirements

| | Windows | Linux | macOS |
|---|---|---|---|
| **OS**      | Windows 10 / 11 (64-bit) | x86_64 with glibc 2.31+ | macOS 10.15 or later |
| **RAM**     | 4 GB | 4 GB | 4 GB |
| **Disk**    | 10 GB free | 10 GB free | 10 GB free |
| **Runtime** | WebView2 (bundled) | WebKitGTK 4.0 | WebKit (built-in) |

## Building from Source

### Prerequisites

| | Windows | Linux | macOS |
|---|---|---|---|
| **Node.js**   | 18+ | 18+ | 18+ |
| **Rust**      | 1.75+ (MSVC) | 1.75+ | 1.75+ |
| **Toolchain** | MSVC + WebView2 SDK | `libwebkit2gtk-4.0-dev`, `libgtk-3-dev`, `libssl-dev` | Xcode CLT |

### Build

```bash
git clone --recurse-submodules https://github.com/iriumlabs/irium-core.git
cd irium-core
npm install
npm run build:node
npm run tauri build
```

Installers land under `src-tauri/target/release/bundle/`.

## Network

- **Website:** [iriumlabs.org](https://iriumlabs.org)
- **Block Explorer:** _Coming soon_
- **Mining Pool:** _Coming soon_
- **Telegram:** _Coming soon_
- **Bitcointalk:** _Coming soon_
- **GitHub:** [github.com/iriumlabs](https://github.com/iriumlabs)

## License

Released under the [MIT License](./LICENSE).
