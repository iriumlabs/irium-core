# Irium Core GUI — Foundation Overhaul Design

**Date:** 2026-05-07  
**Phase:** 1 of 2 — Foundation (Mock layer + CSS + Layout components)  
**Phase 2:** Page redesigns (Dashboard, Wallet, Settlement, Marketplace, Agreements, Miner, Reputation, Settings)

---

## Context

The Irium Core GUI is a Tauri v1 + React 18 desktop wallet. The existing app has real structure (8 pages, Zustand store, Tauri invoke layer) but:

1. All functions throw or return empty when the Rust node is not running — no graceful fallback
2. The visual design is flat and cheap — no animations, no glass morphism, no premium feel
3. No page transitions — routes jump instantly

This phase fixes all three at the foundation level, so the page redesigns (Phase 2) can build on a solid, animated design system.

---

## Scope — Phase 1

Files created or modified:

| File | Action |
|---|---|
| `src/lib/mock.ts` | **Create** — realistic fake data for every data type |
| `src/lib/invoke.ts` | **Create** — safe Tauri invoke wrapper with mock fallback |
| `src/lib/tauri.ts` | **Modify** — replace all raw `invoke()` calls with `safeInvoke()` |
| `src/styles/globals.css` | **Overhaul** — full CSS system redesign |
| `tailwind.config.js` | **Extend** — brand colors, spring easing, glass blur, mesh backgrounds |
| `src/components/layout/Sidebar.tsx` | **Rewrite** — framer-motion, glassmorphism, animated nav pill |
| `src/components/layout/TopBar.tsx` | **Rewrite** — block height flip, pulsing badge, notification slide |
| `src/App.tsx` | **Modify** — AnimatePresence routes, Toaster |
| `package.json` | **Add deps** — framer-motion, react-hot-toast |

---

## Section 1 — Mock + Invoke Layer

### `src/lib/mock.ts`

Exports one realistic fake object per data type. All numbers are believable:

- **NodeStatus**: running, synced, height 148234, tip `"a3f7..."`, peers 7, network "irium", version "1.8.0", rpc_url "http://127.0.0.1:38300"
- **WalletBalance**: confirmed 347000000 sats (3.47 IRM), unconfirmed 0, total 347000000
- **AddressInfo[]**: 5 addresses (P-prefix), balances ranging 0–2 IRM
- **Transaction[]**: 8 entries — mix of sent/received, confirmed/unconfirmed, timestamps spread over last 30 days
- **Offer[]**: 3 offers with realistic amounts, descriptions, payment methods, risk signals
- **Agreement[]**: 2 agreements (one active OTC, one completed freelance), real-looking hashes
- **MinerStatus**: running false, hashrate_khs 0, blocks_found 0, uptime_secs 0, difficulty 12847, threads 0
- **Reputation**: score 78, total_agreements 12, released 10, refunded 2, volume_irm "41.2"
- **AppSettings**: defaults from existing code

### `src/lib/invoke.ts`

```typescript
export async function safeInvoke<T>(
  cmd: string,
  args: Record<string, unknown> = {},
  mockFn: () => T
): Promise<T>
```

Logic:
1. If `window.__TAURI__` is defined → call `invoke<T>(cmd, args)`, catch any error and log it, re-throw as a string for toast consumption
2. If `window.__TAURI__` is absent → `console.warn('[irium mock]', cmd)`, wait `400 + Math.random() * 400` ms, return `mockFn()`
3. Never throws unhandled — all errors are strings

### `src/lib/tauri.ts` changes

Every `invoke<T>(...)` call becomes `safeInvoke<T>(cmd, args, () => mock.something)`. The module structure (node, wallet, offers, etc.) is unchanged. The import of `invoke` from `@tauri-apps/api/tauri` is replaced with `safeInvoke` from `./invoke`.

---

## Section 2 — CSS + Tailwind Design System

### Font imports (Google Fonts)

- **Space Grotesk** — display/headings (replaces Syne)
- **Geist Mono** — monospace data (replaces JetBrains Mono)
- DM Sans kept for body

### New CSS variables

All existing variables kept. New additions:
- `--glass-bg`: `rgba(255, 255, 255, 0.03)`
- `--glass-border`: `rgba(255, 255, 255, 0.08)`
- `--glow-purple`: `0 0 20px rgba(123, 47, 226, 0.4)`
- `--glow-blue`: `0 0 20px rgba(59, 130, 246, 0.4)`
- `--glow-green`: `0 0 20px rgba(34, 197, 94, 0.4)`

### New keyframe animations

**`@keyframes mesh-drift`** (20s infinite alternate ease-in-out):
- Animates `background-position` of two layered radial gradients (irium purple + electric blue) slowly drifting — creates a living gradient mesh effect on `.mesh-bg`

**`@keyframes shimmer`** (1.5s infinite):
- Slides a highlight from left to right across a dark background — used for skeleton loading states

**`@keyframes noise-shift`** (8s infinite):
- Shifts an SVG-based noise texture subtly — adds grain depth to surfaces

### New utility classes

| Class | Purpose |
|---|---|
| `.glass` | `backdrop-filter: blur(12px)`, glass bg + border |
| `.glass-heavy` | `backdrop-filter: blur(24px)` — for modals |
| `.glow-purple` | Purple box-shadow glow |
| `.glow-blue` | Blue box-shadow glow |
| `.glow-green` | Green box-shadow glow |
| `.shimmer` | Skeleton loading animation |
| `.page-transition` | `opacity + translateY` fade-in on mount |
| `.number-flip` | Clip container for digit flip animations |

Scrollbars: `scrollbar-width: none` (Firefox), `::-webkit-scrollbar { display: none }` (Webkit) — invisible but `overflow: auto` still scrolls.

Focus rings: `:focus-visible { outline: 2px solid var(--irium); outline-offset: 2px; box-shadow: var(--glow-purple); }`

### Tailwind config extensions

```js
theme: {
  extend: {
    colors: {
      irium: { 50: '#f0eaff', ..., 950: '#1a0040' }
    },
    transitionTimingFunction: {
      spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    },
    blur: {
      glass: '12px',
      'glass-heavy': '24px',
    },
    backgroundImage: {
      'mesh-gradient': [
        'radial-gradient(ellipse 80% 60% at 20% 30%, rgba(123,47,226,0.15) 0%, transparent 60%)',
        'radial-gradient(ellipse 60% 80% at 80% 70%, rgba(59,130,246,0.1) 0%, transparent 60%)',
      ].join(', '),
      // Inline SVG noise pattern — no external file needed
      'noise': "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E\")",
    },
    boxShadow: {
      'glow-purple': '0 0 20px rgba(123, 47, 226, 0.4)',
      'glow-blue': '0 0 20px rgba(59, 130, 246, 0.4)',
      'glow-green': '0 0 20px rgba(34, 197, 94, 0.4)',
    }
  }
}
```

---

## Section 3 — Layout Components

### `src/components/layout/Sidebar.tsx`

**Structure:**
- Outer `motion.div` animates `width` between 64px (collapsed) and 240px (expanded) with spring physics
- Logo section: image + `AnimatePresence` for the "IRIUM CORE" wordmark (fades out when collapsed)
- Nav items: each item is a `motion.div`. When `isActive`, a `<motion.div layoutId="nav-pill">` renders as the background pill — it slides to the new active item automatically via `layoutId`
- Label text: each label uses `AnimatePresence` with `exit={{ opacity: 0, x: -8 }}` — staggered 30ms per item on collapse
- Hover state: `whileHover={{ backgroundColor: 'rgba(123,47,226,0.1)' }}` with 150ms transition
- Bottom section: mini status dot (green pulse = live, amber = syncing, red = offline) + label
- Entire sidebar: `.glass` class — `backdrop-filter: blur(12px)`

### `src/components/layout/TopBar.tsx`

**Block height flip:**
- `<AnimatePresence mode="popLayout">` wrapping `<motion.span key={height} initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -12, opacity: 0 }}>`
- When `height` changes, old number exits up, new number enters from below

**Node status badge:**
- When `status === 'syncing'`: CSS `animate-ping` ring around the badge dot

**Balance glow:**
- `const [balanceGlowing, setBalanceGlowing] = useState(false)` — `useEffect` watches balance. When it increases, call `setBalanceGlowing(true)` then `setTimeout(() => setBalanceGlowing(false), 2000)`. Apply `.glow-green` class via `clsx(balanceGlowing && 'glow-green')`

**Notifications dropdown:**
- `<AnimatePresence>` + `<motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>`

### `src/App.tsx`

**Route transitions:**
```tsx
<AnimatePresence mode="wait">
  <Routes location={location} key={location.pathname}>
    {/* all routes */}
  </Routes>
</AnimatePresence>
```

Each page component wraps its root element in:
```tsx
<motion.div
  initial={{ opacity: 0, y: 12 }}
  animate={{ opacity: 1, y: 0 }}
  exit={{ opacity: 0, y: -8 }}
  transition={{ duration: 0.2, ease: 'easeOut' }}
>
```

**Toaster configuration:**
```tsx
<Toaster
  position="bottom-right"
  toastOptions={{
    style: {
      background: '#0d0d1a',
      border: '1px solid #7b2fe2',
      color: '#e2d9f3',
      fontFamily: 'DM Sans, sans-serif',
    },
    success: { iconTheme: { primary: '#22c55e', secondary: '#0d0d1a' } },
    error: { iconTheme: { primary: '#ef4444', secondary: '#0d0d1a' } },
  }}
/>
```

---

## Dependencies to Install

```
npm install framer-motion react-hot-toast
```

`@tauri-apps/api` is already at v1.6.0 — no upgrade needed.  
`clsx` and `date-fns` are already in `package.json`.

---

## TypeScript Constraints

- Detect Tauri with `typeof window !== 'undefined' && '__TAURI__' in window` — this is the guard used inside `safeInvoke`. Do not use `window.__TAURI__` directly (it can be `undefined` even when the key exists on older Tauri builds)
- `safeInvoke` is fully generic — no `any`
- All mock data objects must satisfy their existing types from `src/lib/types.ts` — no type widening

---

## Verification

After Phase 1 is implemented:
1. `npx tsc --noEmit` — zero errors
2. `npm run dev` (Vite only, no Tauri) — app loads, all nav links work, mock data populates every section
3. Route changes show fade + slide transition
4. Sidebar collapse animates smoothly, nav pill slides to new active item
5. Toasts fire on node start/stop actions
6. No console errors in browser — only `[irium mock]` warnings

---

## Out of Scope for Phase 1

- Page-level redesigns (Dashboard stats counters, Wallet send modal, Settlement wizard, etc.) — Phase 2
- SVG stroke animations (checkmark draw) — Phase 2
- Hashrate live graph — Phase 2
- Reputation score ring animation — Phase 2
