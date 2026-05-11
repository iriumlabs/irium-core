# Changelog

All notable changes across all Irium products are documented here.

---

## [0.8.0] — 2026-05-07

### irium-core (Desktop Wallet)

**New Features**
- **Auto-update banner** — `UpdateBanner` slides in when a new version is available, triggered by startup `update.check()` and Tauri `update-available` events
- **Notification bell** — persistent dropdown in TopBar backed by Zustand; any page can call `addNotification()`; badge shows unread count
- **Recent Errors** — Settings page shows up to 50 logged errors with timestamp and context tag; backed by `errorLog` in store
- **Check for Updates** button in Settings > About section
- **Error handling** — `src/lib/errors.ts` with `getUserMessage()` maps low-level errors to human-readable strings; poll errors auto-logged

**Performance**
- All 8 pages converted to `React.lazy()` + `Suspense` for code splitting
- `Sidebar`, `TopBar`, `StatusBar` wrapped in `React.memo()`
- Node toggle handler in TopBar wrapped in `useCallback`

---

### irium-web-wallet (Browser Wallet)

**New**
- Full web wallet shipped: Dashboard, Wallet, Settlement Hub, Agreements, Marketplace, Reputation
- **Settlement Hub** — 4 agreement templates (OTC, Freelance, Milestone, Deposit), two-step wizard with live preview card, offline-mode warning, success screen with real `agreement_id` and copy summary button
- **Notification bell** in TopBar — same UX as desktop, powered by Zustand store
- **QR code receive** — Wallet page shows QR code for entered address, Copy Address, and Download QR (SVG) buttons
- `react-hot-toast` integrated with dark theme toasts

---

### irium-mobile (Mobile Wallet)

**New — complete new product**
- 7 screens: Splash, Home, Send, Receive, Marketplace, Agreements, Settings
- Bottom tab bar with haptic feedback (`@capacitor/haptics`)
- Horizontal slide transitions with framer-motion
- `NotificationBanner` — slides down from top, auto-dismisses after 3 seconds
- **QR code** on Receive screen (no external library)
- **Share Address** via `@capacitor/share` native share sheet
- **Deep link support** — `irium://` URL scheme, 5 routes parsed by `useDeepLink` hook
- RPC URL configurable in Settings, stored in localStorage

---

### irium-marketplace (OTC Marketplace)

**New — complete new product**
- 5 pages: Landing, Browse, OfferDetail, SubmitFeed, About
- Aggregates offer feeds from multiple `iriumd` nodes in parallel
- Graceful degradation — failed feeds show "Feed unavailable" banners, others load normally
- Offer filters: payment method, amount range, sort order
- OfferDetail shows full offer info + CLI command to take the offer
- Dark header, light content theme

---

### Shared

**QR Code Generator** (`src/lib/qr.ts`)
- Full ISO/IEC 18004 implementation — no external dependencies
- GF(256) arithmetic, Reed-Solomon error correction
- Versions 1–10, Error Correction Level M
- All 8 mask patterns evaluated with penalty scoring
- Exported as: `generateQR()` (boolean matrix), `QRCode` (React SVG component), `downloadQR()` (SVG file download)

**Documentation** (`docs/`)
- `DESKTOP.md` — setup, architecture, Tauri commands, update flow
- `WEB-WALLET.md` — running, API client, QR, notifications
- `MOBILE.md` — screens, deep links, Capacitor plugins
- `MARKETPLACE.md` — feed format, HTLC security, deployment
- `IRIUM-JS-SDK.md` — full API reference with TypeScript types
- `CONTRIBUTING.md` — code style, conventions, release checklist

---

## [0.7.0] — 2026-05-07

### irium-core (Desktop Wallet)

- Initial Tauri 1.x desktop app with full node management
- Dashboard with real-time block height, hashrate charts
- Wallet with balance, send, transaction history
- Mining page with CPU miner control
- Settlement Hub v1 (wizard framework)
- Agreements and Marketplace pages
- Reputation scoring display
- Block explorer
- Settings with node configuration

"NEW RULE — applies to every fix from now on, not just the wallet:
Before making ANY code change:

Read the ENTIRE file you are about to modify end to end
Identify every function, condition, and state variable that could be affected by the change
List what you are changing AND what you are NOT changing — confirm nothing else breaks
Make the fix
After the fix, re-read the modified file and verify no other logic was broken by the change
Run npx tsc --noEmit and npm run build

If I report a bug, do NOT immediately start coding. First show me:

What the current code does (the exact lines)
Why it is wrong
What you will change
What else in the file could be affected and why it will NOT break

Only write code after I confirm the plan. No more fix-one-break-another."