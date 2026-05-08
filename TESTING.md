# Irium Core — Local Testing Guide

## 1. Prerequisites

| Tool | Minimum | Check |
|------|---------|-------|
| Node.js | 18 LTS | `node --version` |
| npm | 9 | `npm --version` |
| Rust | 1.70 | `rustc --version` |
| Cargo | (with Rust) | `cargo --version` |
| MSVC Build Tools (Windows) | VS 2019+ | `cargo build` succeeds |
| WebView2 (Windows) | any | present in modern Windows 10/11 |
| libwebkit2gtk-4.0-37 (Linux) | any | `dpkg -l libwebkit2gtk*` |

---

## 2. Setup

### Install frontend dependencies

```bash
# Desktop (repo root)
npm install

# Web wallet
cd irium-web-wallet && npm install && cd ..

# Mobile
cd irium-mobile && npm install && cd ..

# Marketplace
cd irium-marketplace && npm install && cd ..
```

### Place sidecar binaries

The desktop app requires `iriumd`, `irium-wallet`, and `irium-miner` in `src-tauri/binaries/` with exact triple-suffixed names.

**Windows:**
```powershell
.\scripts\place-binaries-windows.ps1
```

**Linux / macOS:**
```bash
bash scripts/setup.sh
```

**Manual:** Download from `https://github.com/iriumlabs/irium/releases` and rename:

| Platform | Filename pattern |
|----------|-----------------|
| Windows x86_64 | `iriumd-x86_64-pc-windows-msvc.exe` |
| Linux x86_64 | `iriumd-x86_64-unknown-linux-gnu` |
| Linux ARM64 | `iriumd-aarch64-unknown-linux-gnu` |
| macOS Intel | `iriumd-x86_64-apple-darwin` |
| macOS Apple Silicon | `iriumd-aarch64-apple-darwin` |

---

## 3. Running in Dev Mode

### Desktop app (Tauri)

```bash
npm run tauri dev
```

- Vite starts React dev server on port 1420
- Rust backend compiles on first run (3–8 minutes)
- App window opens automatically

### Web wallet

```bash
cd irium-web-wallet
npm run dev
# Open http://localhost:5173
```

### Mobile (Capacitor web preview)

```bash
cd irium-mobile
npm run dev
# Open http://localhost:5174
```

### Marketplace

```bash
cd irium-marketplace
npm run dev
# Open http://localhost:5175
```

---

## 4. Manual Test Checklist

Run each item and verify the expected behavior. Mark ✅ when passing or ❌ with a note when failing.

### Dashboard

- [ ] Dashboard loads with block height, hashrate, sync status cards
- [ ] `Start Node` button → node status changes to "Running"
- [ ] `Stop Node` button → node status changes to "Stopped"
- [ ] Hashrate chart updates over time while node is running
- [ ] Network era shows "Early Miner Era"
- [ ] Peer count increments as peers connect
- [ ] Block height increases while syncing

### Wallet

- [ ] Balance displayed in IRM (not satoshis)
- [ ] Address list shows all addresses with labels
- [ ] `New Address` button generates a Q-prefix 34-char address
- [ ] Send form: amount and address fields present
- [ ] Send: entering non-Q-prefix address shows validation error
- [ ] Send: amount exceeding balance shows error
- [ ] Transaction history loads with txids, amounts, timestamps
- [ ] Transaction `hash` is 64-char lowercase hex

### Mining

- [ ] Mining page shows CPU thread count slider
- [ ] `Start Mining` requires a valid mining address
- [ ] Hashrate display updates while mining
- [ ] `Stop Mining` terminates the miner process
- [ ] Miner runtime counter increments while running
- [ ] Mining stats reset after stopping

### Settlement Hub

- [ ] Four templates visible: OTC, Freelance, Milestone, Deposit
- [ ] Each template opens a two-step wizard
- [ ] Wizard step 1: all required fields present and validated
- [ ] Wizard step 2: live preview card shows entered values
- [ ] Submit → success screen shows real `agreement_id`
- [ ] Copy Summary button copies agreement details to clipboard
- [ ] Offline node warning visible when node not running

### Agreements

- [ ] Agreement list loads (mock or real data)
- [ ] Each item shows: ID, template, status badge, amount in IRM
- [ ] Status badges: `open`, `funded`, `released`, `refunded`
- [ ] Clicking an agreement shows details

### Marketplace

- [ ] Offer list loads
- [ ] Offer status shows `open`
- [ ] Filter by payment method works
- [ ] Sort by amount works
- [ ] Offer detail page shows CLI command to take the offer

### Block Explorer

- [ ] Search by block height returns block data
- [ ] Search by txid returns transaction
- [ ] Block hash is 64-char lowercase hex
- [ ] Timestamps are human-readable dates

### Settings

- [ ] RPC URL field pre-filled with `http://127.0.0.1:38300`
- [ ] Save settings persists across app restart
- [ ] Diagnostics panel shows all checks
- [ ] `Check for Updates` button present
- [ ] Recent Errors panel visible (empty or with entries)

### Notification Bell

- [ ] Bell icon visible in TopBar
- [ ] Badge shows count of unread notifications
- [ ] Dropdown opens on click
- [ ] Individual notifications dismissable
- [ ] `Clear All` removes all notifications

### System Tray (Desktop only)

- [ ] App minimizes to tray on window close
- [ ] Tray icon visible
- [ ] `Show Irium Core` tray item restores window
- [ ] `Quit` tray item exits the app

### Auto-Update Banner (Desktop only)

- [ ] Banner absent when on latest version
- [ ] Banner slides in when update available

---

## 5. Cross-Platform Tests

Run the following on each target platform before release:

### Windows

```powershell
# Type-check
cd C:\path\to\irium-core
npx tsc --noEmit

# Rust check
cd src-tauri
cargo check --all-targets

# Full build
cd ..
npm run tauri build
# Verify: src-tauri/target/release/bundle/msi/*.msi exists
```

### Linux

```bash
npx tsc --noEmit
cd src-tauri && cargo check --all-targets && cd ..
npm run tauri build
# Verify: src-tauri/target/release/bundle/deb/*.deb and appimage/*.AppImage
```

### macOS

```bash
npx tsc --noEmit
cd src-tauri && cargo check --all-targets && cd ..
npm run tauri build
# Verify: src-tauri/target/release/bundle/dmg/*.dmg
```

---

## 6. Pre-Merge Checklist

Before merging any branch, verify all of the following pass:

- [ ] `npx tsc --noEmit` — zero errors in irium-core
- [ ] `npx tsc --noEmit` — zero errors in irium-web-wallet
- [ ] `npx tsc --noEmit` — zero errors in irium-mobile
- [ ] `npx tsc --noEmit` — zero errors in irium-marketplace
- [ ] `cargo check --all-targets` inside `src-tauri/` — zero errors
- [ ] `npm run build` succeeds in irium-core (Vite build)
- [ ] `npm run build` succeeds in irium-web-wallet
- [ ] `npm run build` succeeds in irium-mobile
- [ ] `npm run build` succeeds in irium-marketplace
- [ ] Manual test checklist above passes on at least one platform
- [ ] `CHANGELOG.md` updated if shipping a new version
- [ ] `MANIFEST.json` updated with new build hashes if shipping

---

## 7. Common Issues

| Symptom | Fix |
|---------|-----|
| `link.exe not found` on Windows | Install VS Build Tools with "Desktop development with C++" |
| `WebView2 not found` | Download WebView2 runtime from Microsoft |
| `iriumd sidecar not found` | Run `scripts\place-binaries-windows.ps1` (Windows) or `bash scripts/setup.sh` |
| Port 1420 already in use | Kill: `netstat -ano \| findstr 1420` then `taskkill /PID <pid> /F` |
| `libwebkit2gtk` missing on Linux | `sudo apt-get install libwebkit2gtk-4.0-37 libgtk-3-0` |
| macOS: binary not trusted | `xattr -d com.apple.quarantine src-tauri/binaries/iriumd-*` |
| `cargo check` slow on first run | Normal — Rust compiles all deps; cached on subsequent runs |
| Hot reload not working | Ensure Vite dev server is running on port 1420 before `tauri dev` |
