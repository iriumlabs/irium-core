import { create } from "zustand";
import type { NodeStatus, WalletBalance, AppSettings, UpdateCheckResult } from "./types";
import { DEFAULT_SETTINGS } from "./types";

interface AppStore {
  // Node
  nodeStatus: NodeStatus | null;
  setNodeStatus: (s: NodeStatus | null) => void;

  // Tracks the window between clicking "Start" and the RPC becoming reachable
  nodeStarting: boolean;
  setNodeStarting: (v: boolean) => void;

  // Wallet
  balance: WalletBalance | null;
  setBalance: (b: WalletBalance | null) => void;

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

  balance: null,
  setBalance: (balance) => set({ balance }),

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
