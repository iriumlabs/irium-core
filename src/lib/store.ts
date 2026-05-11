import { create } from "zustand";
import type { NodeStatus, WalletBalance, AppSettings, UpdateCheckResult, AddressInfo } from "./types";
import { DEFAULT_SETTINGS } from "./types";

interface AppStore {
  // Node
  nodeStatus: NodeStatus | null;
  setNodeStatus: (s: NodeStatus | null) => void;

  // Tracks the window between clicking "Start" and the RPC becoming reachable
  nodeStarting: boolean;
  setNodeStarting: (v: boolean) => void;

  // Tracks multi-step operations (starting node, clearing state) across pages
  nodeOperation: 'starting' | 'clearing' | null;
  setNodeOperation: (op: 'starting' | 'clearing' | null) => void;

  // Wallet
  balance: WalletBalance | null;
  setBalance: (b: WalletBalance | null) => void;

  // Wallet addresses + active selection — shared so TopBar can mirror the
  // address selected on the Wallet page. Populated by useNodePoller and the
  // Wallet page's own loadData(). The hero balance and the TopBar balance
  // both read from addresses[activeAddrIdx]?.balance.
  // setAddresses accepts either a new array OR a functional updater (matches
  // useState's signature so existing setAddresses(prev => ...) call sites in
  // Wallet.tsx keep working unchanged).
  addresses: AddressInfo[];
  setAddresses: (a: AddressInfo[] | ((prev: AddressInfo[]) => AddressInfo[])) => void;
  activeAddrIdx: number;
  setActiveAddrIdx: (i: number) => void;

  // Addresses the user has chosen to hide from the UI. Persisted to
  // localStorage so removals survive app restarts; honored by the poller so
  // the wallet binary's listing doesn't keep resurfacing them every 15s.
  // Stored as a Set in memory, serialised as an Array for JSON.
  hiddenAddresses: Set<string>;
  hideAddress: (addr: string) => void;
  unhideAddress: (addr: string) => void;

  // Custom labels per address ("Mining", "Savings", etc). Persisted to
  // localStorage as { address: label } and read everywhere a badge is
  // shown (hero, AddressCard, ManageWalletsPanel, TopBar).
  addressLabels: Record<string, string>;
  setAddressLabel: (address: string, label: string) => void;

  // Settings
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;

  // UI
  activeAgreementId: string | null;
  setActiveAgreement: (id: string | null) => void;

  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  // Update
  updateInfo: UpdateCheckResult | null;
  updateBannerDismissed: boolean;
  setUpdateInfo: (info: UpdateCheckResult | null) => void;
  dismissUpdateBanner: () => void;

  // Notifications
  notifications: Notification[];
  addNotification: (n: Omit<Notification, "id" | "ts">) => void;
  dismissNotification: (id: string) => void;
  clearAllNotifications: () => void;

  // Error log
  errorLog: ErrorEntry[];
  logError: (message: string, context?: string) => void;
  clearErrorLog: () => void;

  // Peer list
  peerList: import('./types').PeerInfo[];
  setPeerList: (peers: import('./types').PeerInfo[]) => void;

  // Height change tracking
  heightLastChanged: number | null;
  setHeightLastChanged: (t: number) => void;

  // App version — populated at startup from Cargo.toml via get_app_version command
  appVersion: string;
  setAppVersion: (v: string) => void;
}

interface ErrorEntry {
  id: string;
  ts: number;
  message: string;
  context?: string;
}

interface Notification {
  id: string;
  ts: number;
  type: "success" | "error" | "info" | "warning";
  title: string;
  message?: string;
}

export const useStore = create<AppStore>((set) => ({
  nodeStatus: null,
  setNodeStatus: (nodeStatus) => set({ nodeStatus }),

  nodeStarting: false,
  setNodeStarting: (nodeStarting) => set({ nodeStarting }),

  nodeOperation: null,
  setNodeOperation: (nodeOperation) => set({ nodeOperation }),

  balance: null,
  setBalance: (balance) => set({ balance }),

  addresses: [],
  hiddenAddresses: loadHiddenAddresses(),
  hideAddress: (addr) => set((state) => {
    const next = new Set(state.hiddenAddresses);
    next.add(addr);
    saveHiddenAddresses(next);
    // If the now-hidden address is currently selected, fall back to primary.
    const visible = state.addresses.filter((a) => !next.has(a.address));
    const currentSelected = state.addresses[state.activeAddrIdx]?.address;
    const stillVisible = currentSelected && visible.some((a) => a.address === currentSelected);
    return {
      hiddenAddresses: next,
      addresses: visible,
      activeAddrIdx: stillVisible
        ? visible.findIndex((a) => a.address === currentSelected)
        : 0,
    };
  }),
  unhideAddress: (addr) => set((state) => {
    const next = new Set(state.hiddenAddresses);
    next.delete(addr);
    saveHiddenAddresses(next);
    return { hiddenAddresses: next };
    // Note: the address itself will reappear in the list on the next poll
    // tick (every 15s) since the poller re-fetches from the binary and the
    // filter no longer excludes this entry. This avoids the store needing
    // its own copy of the binary's full listing.
  }),

  addressLabels: loadAddressLabels(),
  setAddressLabel: (address, label) => set((state) => {
    const next = { ...state.addressLabels };
    const trimmed = label.trim();
    if (trimmed) {
      next[address] = trimmed;
    } else {
      // Empty label → clear the entry entirely so the default "Addr N"
      // fallback applies again. No need to keep "" around in storage.
      delete next[address];
    }
    saveAddressLabels(next);
    return { addressLabels: next };
  }),
  setAddresses: (a) => set((state) => {
    const inputAddresses = typeof a === 'function' ? a(state.addresses) : a;

    // Centralised hidden-address filter. Every call site that pushes into
    // the addresses array funnels through this setter, so applying the
    // filter HERE guarantees no path can bypass it (loadData, the poller,
    // Set-as-Primary reorders, file switches — all enter through this).
    const filtered = state.hiddenAddresses.size > 0
      ? inputAddresses.filter((addr) => !state.hiddenAddresses.has(addr.address))
      : inputAddresses;

    // Order preservation — the critical bit.
    //
    // FUNCTIONAL updates (`setAddresses(prev => ...)`) are intentional
    // user reorders (e.g. Set-as-Primary moving an address to index 0).
    // Use their result as-is.
    //
    // ARRAY updates (poller refresh, loadData, file switch) are *refreshes*
    // that bring fresh balance/label values from the wallet binary in the
    // binary's natural derivation order. If we used that order as-is, the
    // user's prior reorder would be wiped out on every refresh — that's
    // exactly the bug where the PRIMARY badge appeared to "move" when a
    // card was clicked: clicking changed activeAddress → loadData re-fired
    // → setAddresses(binaryList) overwrote the user's local primary.
    //
    // So for array inputs, we merge:
    //   - keep each existing entry's position; refresh its fields from the
    //     fresh list (balance, label, etc)
    //   - drop entries removed from the binary
    //   - append entries newly added in the binary
    let merged: AddressInfo[];
    if (typeof a === 'function') {
      merged = filtered;
    } else {
      const freshByAddr = new Map(filtered.map((x) => [x.address, x]));
      const currentAddrSet = new Set(state.addresses.map((x) => x.address));
      merged = state.addresses
        .filter((c) => freshByAddr.has(c.address))
        .map((c) => {
          const fresh = freshByAddr.get(c.address)!;
          // Preserve the previously-known balance when the fresh fetch
          // returned undefined (per-address RPC timeout in the backend's
          // fetch_address_balance_sats has a short 3s deadline). Without
          // this, a single sluggish RPC call would erase the address's
          // balance from every UI surface (Wallet hero, TopBar, address
          // cards, Manage drawer) and the user would see 0 for a few
          // seconds until the next successful poll. The backend
          // distinguishes Some(0) from None, so an actual zero balance
          // still correctly clears through this guard.
          return {
            ...c,
            ...fresh,
            balance: fresh.balance !== undefined ? fresh.balance : c.balance,
          };
        });
      for (const fresh of filtered) {
        if (!currentAddrSet.has(fresh.address)) {
          merged.push(fresh);
        }
      }
    }

    // Preserve the selection by ADDRESS STRING, not by raw index. If the
    // array changes order (poll refresh, wallet file switch, user reorder),
    // find where the previously-selected address landed in the new array
    // and update activeAddrIdx to point at it. Falls back to index 0 only
    // if the selected address is no longer in the list (e.g. removed) or
    // if there was no prior selection.
    const previouslySelectedAddr = state.addresses[state.activeAddrIdx]?.address;
    let nextIdx = 0;
    if (previouslySelectedAddr) {
      const found = merged.findIndex((a) => a.address === previouslySelectedAddr);
      nextIdx = found >= 0 ? found : 0;
    }
    if (nextIdx >= merged.length) nextIdx = 0;

    return { addresses: merged, activeAddrIdx: nextIdx };
  }),
  activeAddrIdx: 0,
  setActiveAddrIdx: (activeAddrIdx) => set({ activeAddrIdx }),

  settings: loadSettings(),
  updateSettings: (patch) =>
    set((state) => {
      const updated = { ...state.settings, ...patch };
      saveSettings(updated);
      return { settings: updated };
    }),

  activeAgreementId: null,
  setActiveAgreement: (id) => set({ activeAgreementId: id }),

  sidebarCollapsed: false,
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  updateInfo: null,
  updateBannerDismissed: false,
  setUpdateInfo: (updateInfo) => set({ updateInfo }),
  dismissUpdateBanner: () => set({ updateBannerDismissed: true }),

  notifications: [],
  addNotification: (n) =>
    set((state) => ({
      notifications: [
        ...state.notifications.slice(-9),
        { ...n, id: Math.random().toString(36).slice(2), ts: Date.now() },
      ],
    })),
  dismissNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),
  clearAllNotifications: () => set({ notifications: [] }),

  errorLog: [],
  logError: (message, context) =>
    set((state) => ({
      errorLog: [
        ...state.errorLog.slice(-49),
        { id: Math.random().toString(36).slice(2), ts: Date.now(), message, context },
      ],
    })),
  clearErrorLog: () => set({ errorLog: [] }),

  peerList: [],
  setPeerList: (peerList) => set({ peerList }),

  heightLastChanged: null,
  setHeightLastChanged: (heightLastChanged) => set({ heightLastChanged }),

  appVersion: '1.0.0',
  setAppVersion: (appVersion) => set({ appVersion }),
}));

const SETTINGS_KEY = "irium_core_settings";

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_SETTINGS;
}

function saveSettings(s: AppSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {}
}

const HIDDEN_ADDR_KEY = 'irium-hidden-addresses';

function loadHiddenAddresses(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_ADDR_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr.filter((x) => typeof x === 'string'));
    }
  } catch {}
  return new Set();
}

function saveHiddenAddresses(s: Set<string>) {
  try {
    localStorage.setItem(HIDDEN_ADDR_KEY, JSON.stringify([...s]));
  } catch {}
}

const ADDR_LABEL_KEY = 'irium-address-labels';

function loadAddressLabels(): Record<string, string> {
  try {
    const raw = localStorage.getItem(ADDR_LABEL_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(obj)) {
          if (typeof k === 'string' && typeof v === 'string') out[k] = v;
        }
        return out;
      }
    }
  } catch {}
  return {};
}

function saveAddressLabels(labels: Record<string, string>) {
  try {
    localStorage.setItem(ADDR_LABEL_KEY, JSON.stringify(labels));
  } catch {}
}
