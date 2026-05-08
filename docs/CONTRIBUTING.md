# Contributing to Irium

This repository contains four products:

| Directory | Product | Stack |
|-----------|---------|-------|
| `irium-core/` | Desktop wallet | Tauri 1.x + React 18 |
| `irium-web-wallet/` | Browser wallet | React 18 + Vite |
| `irium-mobile/` | Mobile wallet | Capacitor + React 18 |
| `irium-marketplace/` | OTC marketplace | React 18 + Vite |

---

## Development Setup

Each project is independent. Install and run them separately:

```bash
# Desktop
cd irium-core && npm install && npm run tauri dev

# Web wallet
cd irium-web-wallet && npm install && npm run dev

# Mobile
cd irium-mobile && npm install && npm run dev

# Marketplace
cd irium-marketplace && npm install && npm run dev
```

All frontend projects require Node.js 18+. The desktop app additionally requires Rust 1.70+ and MSVC Build Tools on Windows.

---

## Code Style

### TypeScript
- Strict mode enabled in all projects (`"strict": true`)
- No `any` — use `unknown` at boundaries, then narrow with type guards
- Prefer `type` over `interface` for pure data shapes; `interface` for extensible APIs

### React
- Functional components only
- `memo()` for pure layout components that receive no frequently-changing props
- `useCallback` for handlers passed as props or used in `useEffect` deps
- `React.lazy()` + `Suspense` for page-level code splitting

### State
- Zustand stores in `src/lib/store.ts` — one store per project
- Selectors at point of use: `useStore(s => s.nodeStatus)` not `useStore()`
- Never mutate state directly — always use the setter functions

### Styling
- Tailwind CSS v3 across all projects
- Custom classes defined in `src/styles/globals.css` as `@layer components`
- Common tokens: `card`, `btn-primary`, `btn-secondary`, `btn-ghost`, `input`, `label`, `section-title`
- Dark theme: `bg-gray-950`, `text-white/60`, `border-white/[0.06]`
- Light theme (marketplace only): `bg-white`, `text-gray-900`, `card-light`

### Animation
- Framer Motion for page transitions, presence animations, micro-interactions
- Desktop/web: `y` axis transitions (vertical slide)
- Mobile: `x` axis transitions (horizontal slide)
- Avoid `layout` animations on lists with dynamic keys — use `AnimatePresence` instead

---

## Testing

There are currently no automated tests. When adding tests:
- Unit tests belong in `src/__tests__/` alongside the code they test
- Integration tests that hit a real `iriumd` instance go in `tests/integration/`
- Do not mock the iriumd HTTP API in integration tests — use a real node

---

## Commits

Follow conventional commits format:

```
feat: add QR download button to wallet receive screen
fix: prevent double-submit on agreement wizard
refactor: extract PreviewCard into separate component
docs: add MOBILE.md deep link setup instructions
```

One commit per logical change. Don't bundle unrelated changes.

---

## Adding a New Page (Desktop / Web Wallet)

1. Create `src/pages/NewPage.tsx` with a named export matching the filename
2. Add a lazy import in `App.tsx`
3. Add a `<Route>` in the Routes block
4. Add a nav entry in `Sidebar.tsx` if it should appear in the nav

---

## Adding a New Settlement Template

1. Add the template config to the `templates` array in `Settlement.tsx`
2. Define the fields array for the new template in the `FIELDS` map
3. Add the typed params interface to `src/lib/types.ts`
4. Add the API method to `src/lib/api.ts`
5. Add the `case` to the `submit` switch in `Settlement.tsx`

---

## Release Checklist

- [ ] `npx tsc --noEmit` passes in all 4 projects
- [ ] `npm run build` passes in all 4 projects
- [ ] `CHANGELOG.md` updated with new version and summary
- [ ] `MANIFEST.json` updated with build hashes
- [ ] Desktop: `npm run tauri build` produces installer
- [ ] Mobile: `npx cap sync` run after any web changes

---

## Project Conventions

- **No comments explaining what code does** — well-named identifiers suffice
- **Comments only for non-obvious WHY** — hidden constraints, workarounds, invariants
- **No feature flags** — just change the code
- **No backwards-compatibility shims** — this is internal, not a public API
- **YAGNI** — don't add abstractions until there are three concrete use cases
