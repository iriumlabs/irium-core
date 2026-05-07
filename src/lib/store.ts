import { create } from "zustand";
import type { NodeStatus, WalletBalance, AppSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";

interface AppStore {
  // Node
  nodeStatus: NodeStatus | null;
  setNodeStatus: (s: NodeStatus | null) => void;

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

  // Notifications
  notifications: Notification[];
  addNotification: (n: Omit<Notification, "id" | "ts">) => void;
  dismissNotification: (id: string) => void;
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
