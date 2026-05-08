# Irium Core GUI — Release Notes

## Phase 7 — Web Wallet, Settlement Polish, Auto-Update & Performance

### New: Irium Web Wallet (`irium-web-wallet/`)

A standalone browser-based wallet that connects directly to a local iriumd node via HTTP — no Tauri required.

- **Dashboard** — live node status, block height, peer count, recent transactions
- **Wallet** — address management, balance display, transaction history, send form
- **Settlement Hub** — OTC / Freelance / Milestone / Deposit wizard with live preview card, fee estimate, inline validation, copy-summary on success
- **Agreements** — list and detail view for all agreements
- **Marketplace** — offer feed with filtering
- **Reputation** — lookup by pubkey or address

The web wallet uses a Vite dev-proxy (`/api/*` → `http://127.0.0.1:38300`) and the `VITE_API_BASE` env var for production deployment.

---

### Settlement Hub — Deep Polish (desktop)

- **Live preview card** — sticky right-column card updates in real time as you fill the form, with a pulsing irium-colored border when form content is present
- **Inline validation with shake** — each invalid field shakes using the Web Animations API when you attempt to proceed; errors shown inline with an `AlertCircle` icon
- **Fee estimate** — fee rate fetched from `GET /rpc/fee_estimate` and displayed in the preview card
- **Copy Summary** — button on the success screen copies a multi-line text summary to clipboard

---

### Auto-Update Infrastructure

- `check_for_updates` Tauri command — hits the GitHub Releases API to compare current version against the latest tag
- **Silent startup check** — runs automatically when the app window opens; emits a `update-available` Tauri event if a newer version exists
- **TopBar update banner** — animated slide-in banner with version info and a "Download →" link; dismissible with ×
- **Settings "Check for Updates" button** — manual re-check in the About section with a toast result

---

### Performance

- All 8 page components are now **code-split via `React.lazy`** — each page is a separate JS chunk (11–24 kB each), loaded on first navigation
- `Sidebar`, `TopBar`, `StatusBar` wrapped in **`React.memo`** — prevents re-renders on unrelated store changes
- `TopBar.handleToggleNode` wrapped in `useCallback`
- `NodeStatusBadge` and `NotifDot` wrapped in `React.memo`

**Desktop bundle breakdown:**
| Chunk | Size (gzip) |
|---|---|
| Main framework (React + Framer Motion + Tauri) | 118.6 kB |
| Recharts | 101.1 kB |
| Dashboard | 8.3 kB |
| Settlement | 5.9 kB |
| Miner | 6.9 kB |
| Settings | 5.2 kB |
| Other pages | 3.6–4.8 kB each |

---

### Error Handling

- `src/lib/errors.ts` — `getUserMessage(error)` maps raw errors to user-friendly strings (network errors, timeouts, wallet errors, node errors)
- Error log in Zustand store — up to 50 recent errors stored with timestamp and context
- **Recent Errors section** in Settings diagnostics tab — shows all logged errors with timestamps, context tags, and a "Clear" button
- `useNodePoller` now logs connection errors to the store instead of silently dropping them

---

### CORS Configuration

`tauri.conf.json` HTTP allowlist scope now includes `http://localhost:5173/**` to allow the desktop app to reach the web wallet dev server when running both simultaneously.

---

### Bug Fixes

- Tailwind CSS downgraded to v3 in `irium-web-wallet` (was incorrectly installed as v4) — ensures identical design token support with the desktop app
- Removed unused `SATS_PER_IRM` import in web wallet `Settlement.tsx` that caused a build error

---

*Both apps pass `tsc --noEmit` and `npm run build` with zero errors.*
