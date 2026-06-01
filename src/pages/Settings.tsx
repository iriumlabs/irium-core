import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES, type LanguageCode } from "../i18n";
import {
  Server,
  FolderOpen,
  Zap,
  Monitor,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  RotateCcw,
  Shield,
  Globe,
  Cpu,
  Info,
  Activity,
  Copy,
  XCircle,
  GitBranch,
  Download,
  ExternalLink,
  Trash2,
  Languages,
  Eye,
  EyeOff,
} from "lucide-react";
import { fetch as tauriFetch, ResponseType } from "@tauri-apps/api/http";
import { open as openExternal } from "@tauri-apps/api/shell";
import { checkUpdate, installUpdate, onUpdaterEvent } from "@tauri-apps/api/updater";
import { relaunch } from "@tauri-apps/api/process";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "../lib/store";
import { rpc, diagnostics, update, nodeUpdate, node, config } from "../lib/tauri";
import { DEFAULT_SETTINGS, type DiagnosticsResult, type NodeUpdateCheckResult, type Theme, type UpnpDiagnostics, timeAgo, type PeerInfo } from "../lib/types";
import { ONBOARDING_KEY, FORCE_ONBOARDING_KEY } from "./Onboarding";
import { startAggressivePoll } from '../hooks/useNodePoller';

// ─── Theme catalog ───────────────────────────────────────────────────────────
// Preview gradient = same stops the theme uses for --grad-brand in globals.css.
// Keeping it inline here means changes to the gradient there need a 1-line
// update here too, but it's not worth pulling the gradient through CSS vars
// just to dedupe four short strings.
const THEMES: { id: Theme; label: string; preview: string }[] = [
  { id: "midnight", label: "Midnight", preview: "linear-gradient(135deg, #3B3BFF 0%, #6EC6FF 50%, #A78BFA 100%)" },
  { id: "obsidian", label: "Obsidian", preview: "linear-gradient(135deg, #6B7280 0%, #C8D0DB 50%, #FFFFFF 100%)" },
  { id: "aurora",   label: "Aurora",   preview: "linear-gradient(135deg, #047857 0%, #10B981 50%, #5EEAD4 100%)" },
  { id: "nebula",   label: "Nebula",   preview: "linear-gradient(135deg, #7E22CE 0%, #C084FC 50%, #F0ABFC 100%)" },
  { id: "solar",    label: "Solar",    preview: "linear-gradient(135deg, #B45309 0%, #FB923C 50%, #FBBF24 100%)" },
  { id: "ocean",    label: "Ocean",    preview: "linear-gradient(135deg, #0E7490 0%, #22D3EE 50%, #67E8F9 100%)" },
  { id: "rose",     label: "Rose",     preview: "linear-gradient(135deg, #BE185D 0%, #F472B6 50%, #C084FC 100%)" },
];

// ─── Stagger variants ────────────────────────────────────────────────────────
const sectionsVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07 } },
};

const sectionVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" as const } },
};

// ─── Section ─────────────────────────────────────────────────────────────────
function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Server;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2 pb-1 border-b border-white/5">
        <Icon size={16} className="text-irium-400" />
        <h2 className="text-sm font-semibold text-white">{title}</h2>
      </div>
      {children}
    </div>
  );
}

// ─── FieldRow ─────────────────────────────────────────────────────────────────
function FieldRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
      <div className="sm:w-52 shrink-0">
        <p className="text-sm text-white">{label}</p>
        {description && (
          <p className="text-xs text-white/40 mt-0.5">{description}</p>
        )}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

// ─── Spring Toggle ────────────────────────────────────────────────────────────
function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors duration-200 focus:outline-none
        ${checked ? "bg-irium-600 border-2 border-irium-600" : "border-2 border-white/15"}
        ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}
      `}
      style={!checked ? { background: 'var(--bg-3)' } : undefined}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className={`inline-block h-4 w-4 rounded-full bg-white shadow mt-0.5 ${
          checked ? "ml-[23px]" : "ml-0.5"
        }`}
      />
    </button>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Settings() {
  const { settings, updateSettings, setUpdateInfo, dismissUpdateBanner, errorLog, clearErrorLog } = useStore();
  // i18n: t() reads from the active locale; changing the language via
  // i18nInstance.changeLanguage() persists to localStorage 'irium_language'
  // (via i18next-browser-languagedetector) and triggers a re-render of
  // every component using useTranslation().
  const { t, i18n: i18nInstance } = useTranslation();
  const currentLang = (i18nInstance.language || 'en').split('-')[0] as LanguageCode;
  // Banner-ready update info — populated by the silent startup check in
  // App.tsx and refreshed when this Settings page mounts (covers users who
  // leave the app running for days without a restart).
  const updateInfo = useStore((s) => s.updateInfo);
  // In-app updater state — separate from the GitHub-API check above. The
  // GitHub check populates the banner; this drives the install button's
  // progress UI once the user opts in.
  const [installState, setInstallState] = useState<
    'idle' | 'downloading' | 'installed' | 'error'
  >('idle');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [installError, setInstallError] = useState<string | null>(null);
  const [local, setLocal] = useState({ ...settings });
  const [testingRpc, setTestingRpc] = useState(false);
  const [rpcOk, setRpcOk] = useState<boolean | null>(null);
  const [rpcError, setRpcError] = useState<string | null>(null);
  // FIX 2 / FIX 3: masked RPC token + remote-connection test state.
  const [showRpcToken, setShowRpcToken] = useState(false);
  const [testingRemote, setTestingRemote] = useState(false);
  const [remoteOk, setRemoteOk] = useState<boolean | null>(null);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetInput, setResetInput] = useState('');
  const confirmResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [runningDiag, setRunningDiag] = useState(false);
  const [diagResult, setDiagResult] = useState<DiagnosticsResult | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [checkingNodeUpdate, setCheckingNodeUpdate] = useState(false);
  const [pullingNodeUpdate, setPullingNodeUpdate] = useState(false);
  const [nodeUpdateInfo, setNodeUpdateInfo] = useState<NodeUpdateCheckResult | null>(null);
  const [showNodeUpdateConfirm, setShowNodeUpdateConfirm] = useState(false);
  const [clearingState, setClearingState] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const confirmClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Reset Node State (Keep Blocks) — safer alternative to Clear & Resync.
  // Uses a modal confirmation pattern (not the inline double-click) because
  // the success path takes 5-15 min and users benefit from up-front context
  // on what's about to happen.
  const [resettingState, setResettingState] = useState(false);
  const [showResetStateConfirm, setShowResetStateConfirm] = useState(false);
  const [showDetectPanel, setShowDetectPanel] = useState(false);
  // M14: persist user's chosen IP-detection URL so it survives unmount/restart.
  const DETECT_SERVICE_URL_KEY = 'irium-detect-service-url';
  const [detectServiceUrl, setDetectServiceUrl] = useState(() => {
    try {
      const stored = localStorage.getItem(DETECT_SERVICE_URL_KEY);
      return stored && stored.trim() ? stored : 'https://api.ipify.org';
    } catch { return 'https://api.ipify.org'; }
  });
  useEffect(() => {
    try { localStorage.setItem(DETECT_SERVICE_URL_KEY, detectServiceUrl); } catch { /* ignore */ }
  }, [detectServiceUrl]);
  const [fetchingIp, setFetchingIp] = useState(false);
  const [retryingUpnp, setRetryingUpnp] = useState(false);
  const nodeStatus = useStore((s) => s.nodeStatus);
  const nodeMetrics = useStore((s) => s.nodeMetrics);
  const appVersion = useStore((s) => s.appVersion);
  const peerList = useStore((s) => s.peerList);

  // Privacy-friendly peer-address visibility. Default OFF — earlier the peer
  // list was removed entirely after users objected to seeing IPs in the UI.
  // It's back behind an explicit opt-in toggle that we persist in
  // localStorage so the user only has to flip it once.
  const SHOW_PEER_ADDRESSES_KEY = 'irium-show-peer-addresses';
  const [showPeerAddresses, setShowPeerAddresses] = useState<boolean>(() => {
    try { return localStorage.getItem(SHOW_PEER_ADDRESSES_KEY) === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(SHOW_PEER_ADDRESSES_KEY, showPeerAddresses ? '1' : '0'); } catch { /* ignore */ }
  }, [showPeerAddresses]);

  // Settlement legacy UI toggle. The new SettlementHub (with SafeTradeFlow,
  // PayForWorkFlow, DepositFlow) is the default for /settlement. Power users
  // who prefer the template-grid Settlement.tsx page can flip this on to
  // swap the route. The flag is read fresh on each /settlement navigation
  // by SettlementRouteSwitch in App.tsx, so the change takes effect the
  // next time the user enters /settlement.
  const SETTLEMENT_LEGACY_UI_KEY = 'settlement_legacy_ui';
  const [showLegacySettlement, setShowLegacySettlement] = useState<boolean>(() => {
    try { return localStorage.getItem(SETTLEMENT_LEGACY_UI_KEY) === 'true'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(SETTLEMENT_LEGACY_UI_KEY, showLegacySettlement ? 'true' : 'false'); } catch { /* ignore */ }
  }, [showLegacySettlement]);

  // Track when the node first started running (this session). Drives the
  // "Detecting..." → "Inactive" timeout on the UPnP card so we don't show
  // "Inactive — outbound only" the instant the node starts (PEX takes a
  // minute to propagate our dialable address to other peers).
  //
  // One-way latch: once set, the ref is NEVER cleared by this effect — not
  // even when nodeStatus.running flips back to false. A previous version
  // null'd the ref on any running=false event, which caused two real-world
  // bugs:
  //   1. Any brief poll glitch (RPC timeout, network hiccup) wiped the
  //      timestamp, then the next running=true tick re-armed a fresh 60s
  //      window — users got stuck on "Detecting…" forever in flaky
  //      conditions.
  //   2. Multiple back-to-back hiccups produced the "loops, never resolves"
  //      pattern reported by users.
  // The ref is cleared only when the component unmounts (natural lifecycle
  // via useRef going out of scope), so an app restart still re-arms it.
  const nodeRunningSinceRef = useRef<number | null>(null);
  const [nowTick, setNowTick] = useState(0); // re-render every second to update elapsed time

  // FIX C: pull the live UPnP diagnostic trace so the Settings card can
  // show the user *which step failed* without them having to navigate
  // to Help → Test Connection. Polls every 5s while the node is
  // running; cleared when node stops. Backend updates the trace
  // every time try_upnp runs (startup + 30-minute refresh loop +
  // explicit Retry button).
  const [upnpDiag, setUpnpDiag] = useState<UpnpDiagnostics | null>(null);
  useEffect(() => {
    if (!nodeStatus?.running) {
      setUpnpDiag(null);
      return;
    }
    let cancelled = false;
    const fetchDiag = async () => {
      try {
        const d = await node.upnpDiagnostics();
        if (!cancelled) setUpnpDiag(d ?? null);
      } catch {
        if (!cancelled) setUpnpDiag(null);
      }
    };
    fetchDiag();
    const id = setInterval(fetchDiag, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [nodeStatus?.running]);
  useEffect(() => {
    if (nodeStatus?.running && nodeRunningSinceRef.current === null) {
      nodeRunningSinceRef.current = Date.now();
    }
  }, [nodeStatus?.running]);
  // Tick once per second while node is running and we're still inside the
  // 60s detecting window. Stops once we transition out so it doesn't burn
  // cycles forever.
  //
  // FIX C: when the interval cleanup runs at the 60s boundary, fire one
  // FINAL setNowTick from a setTimeout scheduled just past the boundary.
  // Without this, the IIFE that picks statusKind keeps reading
  // `inDetectingWindow = true` from its last render and the UI sticks on
  // "Detecting…" forever instead of transitioning to "Inactive". The
  // followup tick forces one more re-render after the window has
  // expired so the statusKind branch flips to 'inactive'.
  useEffect(() => {
    if (!nodeStatus?.running) return;
    const started = nodeRunningSinceRef.current;
    if (started === null) return;
    const elapsed = Date.now() - started;
    if (elapsed > 60_000) return; // already past the window
    const id = setInterval(() => setNowTick((t) => t + 1), 1000);
    // Schedule one boundary-crossing tick so the statusKind IIFE re-runs
    // and renders 'inactive' the moment we leave the detecting window.
    const finalTick = setTimeout(
      () => setNowTick((t) => t + 1),
      Math.max(0, 60_500 - elapsed),
    );
    return () => {
      clearInterval(id);
      clearTimeout(finalTick);
    };
  }, [nodeStatus?.running, nowTick]);

  useEffect(() => {
    return () => {
      if (confirmResetTimerRef.current) clearTimeout(confirmResetTimerRef.current);
      if (confirmClearTimerRef.current) clearTimeout(confirmClearTimerRef.current);
      if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    };
  }, []);

  // Refresh the update-availability check when the Settings page opens. The
  // App-level silent check runs only at boot; this catches users who keep
  // the app running for long periods. Failures are tolerated silently — the
  // banner just won't appear.
  useEffect(() => {
    update.check().then((info) => {
      if (info) setUpdateInfo(info);
    }).catch((e) => {
      console.warn('Update check failed:', e);
      toast(t('settings.toasts.update_check_internet'));
    });
  }, [setUpdateInfo, t]);

  const TEXT_SETTING_KEYS: ReadonlyArray<string> = ['rpc_url', 'wallet_path', 'data_dir', 'external_ip', 'rpc_token'];

  const patch = <K extends keyof typeof local>(key: K, value: (typeof local)[K]) => {
    setLocal((prev) => ({ ...prev, [key]: value }));
    if (key === "rpc_url") {
      setRpcOk(null);
      setRpcError(null);
    }
    if (TEXT_SETTING_KEYS.includes(key as string)) {
      if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
      saveDebounceRef.current = setTimeout(() => {
        updateSettings({ [key]: value } as Partial<typeof local>);
        if (key === 'rpc_url') rpc.setUrl(value as string).catch(() => {});
        toast.success(t('common.settings_saved'), { duration: 2000 });
      }, 500);
    } else {
      updateSettings({ [key]: value } as Partial<typeof local>);
      toast.success('Settings saved', { duration: 2000 });
    }
  };

  const testRpc = async () => {
    setTestingRpc(true);
    setRpcOk(null);
    setRpcError(null);
    try {
      await rpc.setUrl(local.rpc_url);
      // Route through Tauri's HTTP API (allowlist.http) instead of the
      // WebView's native fetch — the renderer CSP has no connect-src for
      // 127.0.0.1:38300, and iriumd does not send CORS headers by default.
      const resp = await tauriFetch<{ height?: number }>(`${local.rpc_url}/status`, {
        method: "GET",
        timeout: 4,
        responseType: ResponseType.JSON,
      });
      if (!resp.ok) {
        setRpcError(`HTTP ${resp.status}`);
        return;
      }
      // M15: also probe a second endpoint so a half-broken node (status replies
      // but RPC subsystem dead) doesn't silently pass the test. /metrics is the
      // cheapest deeper endpoint and is already used elsewhere in the app.
      // /metrics serves Prometheus plain text, NOT JSON — ResponseType.Text so
      // the Tauri HTTP layer doesn't throw SyntaxError on the body. We only
      // need the HTTP status to confirm the endpoint is alive; the body itself
      // is not parsed here.
      try {
        const metricsResp = await tauriFetch<string>(`${local.rpc_url}/metrics`, {
          method: "GET",
          timeout: 4,
          responseType: ResponseType.Text,
        });
        if (!metricsResp.ok) {
          setRpcOk(true);
          toast(`Status OK, but /metrics returned HTTP ${metricsResp.status}`);
          return;
        }
      } catch (e) {
        setRpcOk(true);
        toast(`Status OK, but /metrics unreachable: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      setRpcOk(true);
      const height = resp.data?.height;
      if (typeof height === "number") {
        toast.success(t('settings.toasts.connected_at_height', { height: height.toLocaleString('en-US') }));
      } else {
        toast.success(t('settings.toasts.connected_no_height'));
      }
    } catch (e: unknown) {
      setRpcError(e instanceof Error ? e.message : t('settings.toasts.connection_failed'));
    } finally {
      setTestingRpc(false);
    }
  };

  const runDiagnostics = async () => {
    setRunningDiag(true);
    setDiagResult(null);
    try {
      const result = await diagnostics.run();
      setDiagResult(result);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t('settings.toasts.diagnostics_failed'));
    } finally {
      setRunningDiag(false);
    }
  };

  const copyDiagReport = () => {
    if (!diagResult) return;
    const lines = [
      `Irium Core Diagnostics — ${new Date().toISOString()}`,
      `Passed: ${diagResult.passed}/${diagResult.total}`,
      '',
      ...diagResult.checks.map(
        (c) => `[${c.passed ? 'PASS' : 'FAIL'}] ${c.label}${c.detail ? ` — ${c.detail}` : ''}`
      ),
    ];
    navigator.clipboard.writeText(lines.join('\n'));
    toast.success(t('settings.toasts.report_copied'));
  };

  const reset = async () => {
    // Factory reset: clears every irium-* localStorage key, resets settings
    // both in-memory and Tauri-side, forces the onboarding wizard on next
    // launch, and reloads the window. The reload is what lets the splash gate
    // re-evaluate from a clean slate.
    updateSettings({ ...DEFAULT_SETTINGS });
    try {
      await config.saveSettings(JSON.stringify(DEFAULT_SETTINGS));
    } catch { /* Tauri IPC unavailable in browser preview — non-fatal */ }

    Object.keys(localStorage)
      .filter((k) => k.startsWith('irium'))
      .forEach((k) => localStorage.removeItem(k));

    localStorage.setItem(FORCE_ONBOARDING_KEY, '1');

    toast.success(t('settings.toasts.reset_reloading'));
    setTimeout(() => window.location.reload(), 600);
  };

  // ── In-app updater install flow ────────────────────────────────────────────
  // checkUpdate() hits the `endpoints` array in tauri.conf.json (which serves
  // latest.json from GitHub Releases). installUpdate() then downloads the
  // platform-appropriate signed installer, verifies its signature against the
  // pubkey baked into the binary, and applies it. relaunch() restarts the
  // app on the new version. Pre-v1.0.2 builds DO NOT have the updater client
  // compiled in, so this code path only runs in v1.0.2+ releases.
  const handleInstallUpdate = async () => {
    setInstallState('downloading');
    setInstallError(null);
    setDownloadProgress(0);

    // Listen to status events (PENDING / DOWNLOADED / DONE / ERROR / UPTODATE).
    const unlistenStatus = await onUpdaterEvent(({ status, error }) => {
      if (status === 'ERROR') {
        setInstallError(error ?? t('settings.toasts.update_failed'));
        setInstallState('error');
      } else if (status === 'DONE') {
        setInstallState('installed');
        dismissUpdateBanner();
      }
    });
    // Listen to byte-level download progress so we can show a real %.
    let bytesDownloaded = 0;
    let bytesTotal = 0;
    const unlistenProgress = await listen<{ chunkLength: number; contentLength: number | null }>(
      'tauri://update-download-progress',
      ({ payload }) => {
        if (payload.contentLength) bytesTotal = payload.contentLength;
        bytesDownloaded += payload.chunkLength;
        if (bytesTotal > 0) {
          setDownloadProgress(Math.min(100, Math.round((bytesDownloaded / bytesTotal) * 100)));
        }
      },
    );

    try {
      const result = await checkUpdate();
      if (!result.shouldUpdate) {
        toast.success(t('settings.toasts.latest_version'));
        setInstallState('idle');
        unlistenStatus();
        unlistenProgress();
        return;
      }
      await installUpdate();
      // installUpdate resolves once the installer has been downloaded and
      // staged. The DONE status event flips us to 'installed'.
    } catch (e) {
      setInstallError(e instanceof Error ? e.message : String(e));
      setInstallState('error');
    } finally {
      unlistenStatus();
      unlistenProgress();
    }
  };

  const handleRestart = async () => {
    try {
      await relaunch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('settings.toasts.could_not_restart'));
    }
  };

  const checkForUpdates = async () => {
    setCheckingUpdate(true);
    try {
      const info = await update.check();
      if (info?.available) {
        setUpdateInfo(info);
        toast.success(t('settings.toasts.update_available', { version: info.latest_version }));
      } else {
        toast.success(t('settings.toasts.latest_version'));
      }
    } catch {
      toast.error(t('settings.toasts.update_check_failed'));
    } finally {
      setCheckingUpdate(false);
    }
  };

  const checkNodeForUpdates = async () => {
    setCheckingNodeUpdate(true);
    try {
      const info = await nodeUpdate.check();
      if (info) {
        setNodeUpdateInfo(info);
        if (info.has_update) {
          toast.success(t('settings.toasts.node_update_available', { count: info.commits_behind }));
        } else {
          toast.success(t('settings.toasts.node_up_to_date'));
        }
      }
    } catch {
      toast.error(t('settings.toasts.node_update_check_failed'));
    } finally {
      setCheckingNodeUpdate(false);
    }
  };

  const pullNodeUpdate = async () => {
    setPullingNodeUpdate(true);
    try {
      const result = await nodeUpdate.pull();
      if (result?.success) {
        toast.success(t('settings.toasts.pulled_rebuild', { commit: result.new_commit_short }));
        setNodeUpdateInfo((prev) => prev ? { ...prev, has_update: false, current_commit: result.new_commit, current_commit_short: result.new_commit_short } : prev);
      } else {
        toast.error(t('settings.toasts.pull_failed'));
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t('settings.toasts.pull_failed'));
    } finally {
      setPullingNodeUpdate(false);
    }
  };

  const handleResetClick = () => {
    const hasCustomWallet = !!local.wallet_path;
    if (confirmReset) {
      // Trim whitespace so a pasted "RESET " (trailing space) still passes.
      // toUpperCase() runs on the input's onChange but doesn't trim — without
      // this the user types RESET, clicks confirm, and nothing happens because
      // ` RESET` / `RESET ` silently fails the strict equality check.
      if (hasCustomWallet && resetInput.trim() !== 'RESET') {
        toast.error(t('settings.toasts.type_reset_to_confirm'));
        return;
      }
      reset();
      setConfirmReset(false);
      setResetInput('');
    } else {
      setConfirmReset(true);
      setResetInput('');
      if (confirmResetTimerRef.current) clearTimeout(confirmResetTimerRef.current);
      // 30s — old 10s window expired before users finished reading the warning
      // and typing RESET, which silently reverted confirmReset to false and
      // hid the input. Long enough for a deliberate confirmation, short enough
      // that an accidentally-clicked button doesn't leave the page in a
      // confirm-armed state indefinitely.
      confirmResetTimerRef.current = setTimeout(() => { setConfirmReset(false); setResetInput(''); }, 30000);
    }
  };

  const handleClearStateClick = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      confirmClearTimerRef.current = setTimeout(() => setConfirmClear(false), 4000);
      return;
    }
    setConfirmClear(false);
    setClearingState(true);
    try {
      const cleared = await node.clearState();
      if (!cleared) {
        toast.error(t('settings.toasts.clear_state_failed'));
        setClearingState(false);
        return;
      }
      toast.success(t('settings.toasts.chain_state_cleared'));
      await new Promise((r) => setTimeout(r, 800));
      const result = await node.start(undefined, local.external_ip);
      if (result.success) {
        toast.success(t('settings.toasts.node_restarting'));
        startAggressivePoll(15_000);
      } else {
        toast.error(result.message);
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t('settings.toasts.clear_state_failed'));
    } finally {
      setClearingState(false);
    }
  };

  const handleResetNodeState = async () => {
    setShowResetStateConfirm(false);
    setResettingState(true);
    try {
      const result = await node.resetStateKeepBlocks();
      if (!result.success) {
        toast.error(t('settings.node_data_info.reset_state_failed', { reason: 'backend returned success=false' }));
        return;
      }
      if (result.state_existed && result.backup_path) {
        toast.success(t('settings.node_data_info.reset_state_success', { path: result.backup_path }));
      } else {
        toast.success(t('settings.node_data_info.reset_state_no_backup'));
      }
      // Auto-restart iriumd — same pattern as handleClearStateClick.
      await new Promise((r) => setTimeout(r, 800));
      const startResult = await node.start(undefined, local.external_ip);
      if (startResult.success) {
        toast.success(t('settings.node_data_info.reset_state_rebuilding'));
        startAggressivePoll(15_000);
      } else {
        toast.error(startResult.message);
      }
    } catch (e: unknown) {
      toast.error(t('settings.node_data_info.reset_state_failed', {
        reason: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setResettingState(false);
    }
  };

  const handleDetectIp = async () => {
    setFetchingIp(true);
    try {
      const ip = await node.detectPublicIp(detectServiceUrl);
      patch('external_ip', ip);
      setShowDetectPanel(false);
      toast.success(t('settings.toasts.detected_ip', { ip }));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t('settings.toasts.detection_failed'));
    } finally {
      setFetchingIp(false);
    }
  };

  const handleRetryUpnp = async () => {
    setRetryingUpnp(true);
    try {
      const ip = await node.tryUpnpPortMap();
      if (ip) {
        toast.success(t('settings.toasts.upnp_mapped', { ip }));
      } else {
        toast.error(t('settings.toasts.upnp_failed_router'));
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t('settings.toasts.upnp_failed'));
    } finally {
      setRetryingUpnp(false);
    }
  };

  return (
    <div className="w-full h-full overflow-y-auto px-8 py-6">
      <div className="reading-col space-y-5" style={{ maxWidth: 1100 }}>
      {/* Header */}
      <div>
        <h1 className="page-title">{t('settings.page_title')}</h1>
        <p className="page-subtitle">{t('settings.page_subtitle')}</p>
      </div>

      {/* Update-available banner. Same updateInfo Zustand slice the top-of-app
          UpdateBanner reads; this one is page-local, always visible (no dismiss
          state), and drives the IN-APP install flow rather than opening a
          browser. The four states are reflected in installState:
            idle        - "Install Update" button shown
            downloading - progress bar with %
            installed   - "Restart now" button to relaunch on the new version
            error       - error text + retry button + browser-fallback link  */}
      {updateInfo?.available && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="card p-4 space-y-3"
          style={{
            background: 'linear-gradient(135deg, rgba(110,198,255,0.10) 0%, rgba(167,139,250,0.08) 100%)',
            border: '1px solid var(--brand-line-hi)',
          }}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <Download size={18} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--brand)' }} />
              <div className="min-w-0">
                <p className="text-sm font-semibold" style={{ color: 'var(--t1)' }}>
                  {installState === 'installed'
                    ? t('settings.update_banner.title_installed', { version: updateInfo.latest_version })
                    : t('settings.update_banner.title_available', { version: updateInfo.latest_version })}
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--t3)' }}>
                  {installState === 'installed'
                    ? t('settings.update_banner.sub_installed')
                    : installState === 'downloading'
                    ? t('settings.update_banner.sub_downloading', { percent: downloadProgress })
                    : t('settings.update_banner.sub_current', { version: updateInfo.current_version })}
                </p>
              </div>
            </div>

            {installState === 'idle' && (
              <button
                onClick={handleInstallUpdate}
                className="btn-primary px-4 py-2 text-xs flex items-center gap-1.5 flex-shrink-0"
              >
                <Download size={13} />
                {t('settings.update_banner.install')}
              </button>
            )}
            {installState === 'downloading' && (
              <button
                disabled
                className="btn-primary px-4 py-2 text-xs flex items-center gap-1.5 flex-shrink-0 opacity-70"
              >
                <RefreshCw size={13} className="animate-spin" />
                {t('settings.update_banner.downloading')}
              </button>
            )}
            {installState === 'installed' && (
              <button
                onClick={handleRestart}
                className="btn-primary px-4 py-2 text-xs flex items-center gap-1.5 flex-shrink-0"
              >
                <RefreshCw size={13} />
                {t('settings.update_banner.restart_now')}
              </button>
            )}
            {installState === 'error' && (
              <button
                onClick={handleInstallUpdate}
                className="btn-secondary px-4 py-2 text-xs flex items-center gap-1.5 flex-shrink-0"
              >
                <RefreshCw size={13} />
                {t('settings.update_banner.retry')}
              </button>
            )}
          </div>

          {/* Progress bar — only while downloading */}
          {installState === 'downloading' && (
            <div
              className="rounded-full overflow-hidden"
              style={{ height: 6, background: 'rgba(0,0,0,0.40)' }}
            >
              <motion.div
                animate={{ width: `${downloadProgress}%` }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                style={{
                  height: '100%',
                  background: 'linear-gradient(90deg, #3b3bff 0%, #6ec6ff 50%, #a78bfa 100%)',
                  boxShadow: '0 0 10px rgba(110,198,255,0.55)',
                }}
              />
            </div>
          )}

          {/* Error block + browser fallback */}
          {installState === 'error' && installError && (
            <div className="flex items-start gap-2 text-xs" style={{ color: '#fbbf24' }}>
              <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
              <div>
                <p>{installError}</p>
                <button
                  onClick={() => {
                    const url = updateInfo.release_url
                      ?? 'https://github.com/iriumlabs/irium-core/releases/latest';
                    openExternal(url).catch(() => toast.error(t('settings.toasts.could_not_open_browser')));
                  }}
                  className="mt-1 underline text-[11px]"
                  style={{ color: 'rgba(238,240,255,0.55)' }}
                >
                  {t('settings.update_banner.open_releases')}
                </button>
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* Staggered sections */}
      <motion.div
        variants={sectionsVariants}
        initial="hidden"
        animate="visible"
        className="space-y-5"
      >
        {/* Node / RPC */}
        <motion.div variants={sectionVariants}>
          <Section title={t('settings.sections.node_connection')} icon={Server}>
            <FieldRow
              label={t('settings.fields.rpc_url')}
              description={t('settings.fields.rpc_url_description')}
            >
              <div className="flex gap-2">
                <input
                  type="text"
                  value={local.rpc_url}
                  onChange={(e) => patch("rpc_url", e.target.value)}
                  placeholder="http://127.0.0.1:38300"
                  className="input flex-1 font-mono text-sm"
                />

                {/* Test RPC button — three animated states */}
                <button
                  onClick={testRpc}
                  disabled={testingRpc || !local.rpc_url}
                  className="btn-secondary px-3 py-2 text-xs flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                >
                  <AnimatePresence mode="wait" initial={false}>
                    {testingRpc ? (
                      <motion.span
                        key="testing"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                      >
                        <RefreshCw size={13} className="animate-spin" />
                      </motion.span>
                    ) : rpcOk === true ? (
                      <motion.span
                        key="ok"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                      >
                        <CheckCircle size={13} className="text-emerald-400" />
                      </motion.span>
                    ) : rpcError ? (
                      <motion.span
                        key="error"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                      >
                        <AlertTriangle size={13} className="text-rose-400" />
                      </motion.span>
                    ) : (
                      <motion.span
                        key="idle"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                      >
                        <Zap size={13} />
                      </motion.span>
                    )}
                  </AnimatePresence>
                  {testingRpc
                    ? t('settings.test_states.testing')
                    : rpcOk === true
                    ? t('settings.test_states.connected')
                    : rpcError
                    ? t('settings.test_states.failed')
                    : t('settings.test_states.test')}
                </button>
              </div>

              {/* Animated status messages */}
              <AnimatePresence>
                {rpcOk === true && (
                  <motion.p
                    key="rpc-ok"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="mt-1.5 text-xs text-emerald-400 flex items-center gap-1"
                  >
                    <CheckCircle size={12} /> {t('settings.test_states.connected_successfully')}
                  </motion.p>
                )}
                {rpcError && (
                  <motion.p
                    key="rpc-error"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="mt-1.5 text-xs text-rose-400 flex items-center gap-1"
                  >
                    <AlertTriangle size={12} /> {rpcError}
                  </motion.p>
                )}
              </AnimatePresence>
            </FieldRow>

            <FieldRow
              label={t('settings.fields.auto_start_node')}
              description={t('settings.fields.auto_start_description')}
            >
              <Toggle
                checked={local.auto_start_node}
                onChange={(v) => patch("auto_start_node", v)}
              />
            </FieldRow>

            {/* FIX 3 (Remote node): Local vs Remote mode toggle. In
                Remote mode the bundled iriumd sidecar is not spawned;
                the GUI talks directly to whatever rpc_url points at.
                The bundled CPU/GPU miners stay enabled in Remote
                mode — they connect to the configured rpc_url too. */}
            <FieldRow
              label={t('settings.fields.node_mode')}
              description={t('settings.fields.node_mode_description')}
            >
              {/* FIX A: native <select> popup uses OS-default styling
                  for <option> rows — on Windows/WebView2 the popup paints a
                  white background and the .input class's light `color`
                  bled through making the text invisible. Explicit inline
                  styles on both the <select> closed-state and each <option>
                  give the popup a theme-matching dark bg + light text;
                  Chromium respects inline option styling so the popup is
                  now legible without changing the .input class globally. */}
              <select
                value={local.node_mode ?? "local"}
                onChange={(e) => patch("node_mode", e.target.value as "local" | "remote")}
                className="input w-full text-sm"
                style={{ color: '#e8ecff', background: 'rgba(0,0,0,0.40)' }}
              >
                <option value="local" style={{ color: '#e8ecff', background: '#10131f' }}>
                  {t('settings.fields.node_mode_local')}
                </option>
                <option value="remote" style={{ color: '#e8ecff', background: '#10131f' }}>
                  {t('settings.fields.node_mode_remote')}
                </option>
              </select>
            </FieldRow>

            {/* FIX 2 (IRIUM_RPC_TOKEN): masked Bearer token for the
                GUI's outbound RPC calls. Optional in Local mode (auto-
                minted token works), required in Remote mode pointing
                at an authenticated node. */}
            <FieldRow
              label={t('settings.fields.rpc_token')}
              description={
                local.node_mode === "remote"
                  ? t('settings.fields.rpc_token_description_remote')
                  : t('settings.fields.rpc_token_description_local')
              }
            >
              <div className="flex gap-2">
                <input
                  type={showRpcToken ? "text" : "password"}
                  value={local.rpc_token ?? ""}
                  onChange={(e) => patch("rpc_token", e.target.value || undefined)}
                  placeholder={t('settings.fields.rpc_token_placeholder')}
                  className="input flex-1 font-mono text-sm"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setShowRpcToken((v) => !v)}
                  className="btn-secondary px-3 py-2 text-xs flex items-center gap-1.5 shrink-0"
                  aria-label={showRpcToken ? "Hide token" : "Show token"}
                >
                  {showRpcToken ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
                {/* FIX 3: explicit remote-connection probe so the user
                    can confirm rpc_url + rpc_token are correct before
                    flipping node_mode to "remote" and losing the
                    bundled iriumd. 5-second timeout server-side. */}
                {local.node_mode === "remote" && (
                  <button
                    type="button"
                    onClick={async () => {
                      setTestingRemote(true);
                      setRemoteOk(null);
                      setRemoteError(null);
                      try {
                        await rpc.testRemoteConnection(local.rpc_url, local.rpc_token);
                        setRemoteOk(true);
                      } catch (e) {
                        setRemoteOk(false);
                        setRemoteError(String(e));
                      } finally {
                        setTestingRemote(false);
                      }
                    }}
                    disabled={testingRemote || !local.rpc_url}
                    className="btn-secondary px-3 py-2 text-xs flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                  >
                    {testingRemote ? (
                      <RefreshCw size={13} className="animate-spin" />
                    ) : remoteOk === true ? (
                      <CheckCircle size={13} className="text-emerald-400" />
                    ) : remoteError ? (
                      <AlertTriangle size={13} className="text-rose-400" />
                    ) : (
                      <Zap size={13} />
                    )}
                    {testingRemote
                      ? t('settings.test_states.testing')
                      : t('settings.fields.rpc_token_test_remote')}
                  </button>
                )}
              </div>
              <AnimatePresence>
                {remoteOk === true && (
                  <motion.p
                    key="remote-ok"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="mt-1.5 text-xs text-emerald-400 flex items-center gap-1"
                  >
                    <CheckCircle size={12} /> {t('settings.fields.rpc_token_test_remote_ok')}
                  </motion.p>
                )}
                {remoteError && (
                  <motion.p
                    key="remote-error"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="mt-1.5 text-xs text-rose-400 flex items-center gap-1"
                  >
                    <AlertTriangle size={12} /> {remoteError}
                  </motion.p>
                )}
              </AnimatePresence>
            </FieldRow>
          </Section>
        </motion.div>

        {/* Wallet */}
        <motion.div variants={sectionVariants}>
          <Section title={t('settings.sections.wallet')} icon={FolderOpen}>
            <FieldRow
              label={t('settings.fields.wallet_file_path')}
              description={t('settings.fields.wallet_path_description')}
            >
              <input
                type="text"
                value={local.wallet_path ?? ""}
                onChange={(e) => patch("wallet_path", e.target.value || undefined)}
                placeholder={t('settings.fields.wallet_path_placeholder')}
                className="input w-full font-mono text-sm"
              />
            </FieldRow>

            <FieldRow
              label={t('settings.fields.data_directory')}
              description={t('settings.fields.data_dir_description')}
            >
              <input
                type="text"
                value={local.data_dir ?? ""}
                onChange={(e) => patch("data_dir", e.target.value || undefined)}
                placeholder={t('settings.fields.data_dir_placeholder')}
                className="input w-full font-mono text-sm"
              />
            </FieldRow>
          </Section>
        </motion.div>

        {/* Display */}
        <motion.div variants={sectionVariants}>
          <Section title={t('settings.sections.display')} icon={Monitor}>
            <FieldRow
              label={t('settings.fields.theme')}
              description={t('settings.fields.theme_description')}
            >
              <div className="flex gap-3 flex-wrap">
                {THEMES.map((theme) => {
                  const isActive = local.theme === theme.id;
                  return (
                    <button
                      key={theme.id}
                      onClick={() => {
                        setLocal((prev) => ({ ...prev, theme: theme.id }));
                        updateSettings({ theme: theme.id });
                        toast.success(t('common.settings_saved'), { duration: 2000 });
                      }}
                      title={t(`settings.themes.${theme.id}`)}
                      className="rounded-xl p-2.5 flex flex-col items-center gap-2 transition-all"
                      style={{
                        background: isActive ? 'rgba(110,198,255,0.10)' : 'rgba(255,255,255,0.04)',
                        border: `2px solid ${isActive ? 'var(--brand-line-hi)' : 'rgba(255,255,255,0.08)'}`,
                        boxShadow: isActive ? '0 0 0 1px var(--brand-glow), 0 4px 16px rgba(0,0,0,0.25)' : 'none',
                      }}
                    >
                      <div
                        className="w-12 h-12 rounded-lg"
                        style={{ background: theme.preview, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.10)' }}
                      />
                      <span
                        className="text-[10px] font-mono"
                        style={{ color: isActive ? 'var(--brand)' : 'rgba(238,240,255,0.45)' }}
                      >
                        {t(`settings.themes.${theme.id}`)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </FieldRow>

            <FieldRow
              label={t('settings.fields.currency_display')}
              description={t('settings.fields.currency_description')}
            >
              <div className="flex gap-2">
                {(["IRM", "sats"] as const).map((opt) => (
                  <button
                    key={opt}
                    onClick={() => patch("currency_display", opt)}
                    className={`px-4 py-2 rounded-lg text-sm font-mono transition border ${
                      local.currency_display === opt
                        ? "bg-irium-600 border-irium-500 text-white"
                        : "bg-white/5 border-white/10 text-white/50 hover:text-white hover:border-white/20"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </FieldRow>

            <FieldRow
              label={t('settings.fields.minimize_to_tray')}
              description={t('settings.fields.minimize_description')}
            >
              <Toggle
                checked={local.minimize_to_tray}
                onChange={(v) => patch("minimize_to_tray", v)}
              />
            </FieldRow>
          </Section>
        </motion.div>

        {/* Language selector — Phase 1 of i18n. The selector itself is
            always rendered in the native script of each language so a
            user who can't read the current UI can still find their own
            language. */}
        <motion.div variants={sectionVariants}>
          <Section title={t('settings.sections.language')} icon={Languages}>
            <FieldRow
              label={t('settings.language_selector.label')}
              description={t('settings.language_selector.description')}
            >
              <select
                className="input text-sm"
                style={{ minWidth: 220 }}
                value={currentLang}
                onChange={(e) => {
                  const next = e.target.value as LanguageCode;
                  i18nInstance.changeLanguage(next).then(() => {
                    toast.success(t('common.settings_saved'), { duration: 2000 });
                  });
                }}
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code} style={{ background: '#0f0f23', color: '#eef0ff' }}>
                    {lang.nativeName} — {lang.englishName}
                  </option>
                ))}
              </select>
            </FieldRow>
          </Section>
        </motion.div>

        {/* Network info */}
        <motion.div variants={sectionVariants}>
          <Section title={t('settings.sections.network')} icon={Globe}>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-white/40">{t('settings.network_info.network')}</span>
                <span className="font-mono text-emerald-400">Mainnet</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">{t('settings.network_info.p2p_port')}</span>
                <span className="font-mono text-white">38291</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">{t('settings.network_info.rpc_port')}</span>
                <span className="font-mono text-white">38300</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">{t('settings.network_info.address_prefix')}</span>
                <span className="font-mono text-white">P / Q</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">{t('settings.network_info.consensus')}</span>
                <span className="font-mono text-white">SHA-256d PoW</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">{t('settings.network_info.total_supply')}</span>
                <span className="font-mono text-white">100,000,000 IRM</span>
              </div>
            </div>

            {/* Port-mapping status — four states:
                  - active-upnp : UPnP succeeded (green)
                  - active-manual: UPnP failed but inbound peers have arrived,
                    confirming manual port forwarding is reachable (green)
                  - detecting   : node has been running < 60s and no inbound
                    peers yet — PEX hasn't had time to propagate our address
                    so we don't yet know whether forwarding works (amber)
                  - inactive    : node running > 60s, no UPnP, no inbound —
                    nothing got through (amber)
                Inbound detection comes from iriumd's /metrics endpoint
                (`irium_inbound_accepted_total`), polled every node tick. */}
            {(() => {
              const inboundCount = nodeMetrics?.inbound_accepted_total ?? 0;
              const upnpActive = nodeStatus?.upnp_active === true;
              const running = nodeStatus?.running === true;
              const startedAt = nodeRunningSinceRef.current;
              const elapsedSec = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;
              // Reference nowTick so the IIFE re-runs once per second while
              // we're inside the detecting window (effect ticks setNowTick).
              void nowTick;
              const inDetectingWindow = running && startedAt !== null && elapsedSec < 60;

              const statusKind: 'active-upnp' | 'active-manual' | 'detecting' | 'inactive' | 'offline' =
                !running        ? 'offline'
                : upnpActive    ? 'active-upnp'
                : inboundCount > 0 ? 'active-manual'
                : inDetectingWindow ? 'detecting'
                : 'inactive';

              const dotColor =
                statusKind === 'active-upnp' || statusKind === 'active-manual' ? '#34d399'
                : statusKind === 'detecting' || statusKind === 'inactive'      ? '#fbbf24'
                : 'rgba(255,255,255,0.2)';

              const statusEl =
                statusKind === 'active-upnp'   ? <span className="text-emerald-400">{t('settings.port_reachability.active_upnp')}</span>
              : statusKind === 'active-manual' ? <span className="text-emerald-400">{t('settings.port_reachability.active_manual', { count: inboundCount })}</span>
              : statusKind === 'detecting'     ? <span className="text-amber-400">{t('settings.port_reachability.detecting', { seconds: Math.max(0, 60 - elapsedSec) })}</span>
              : statusKind === 'inactive'      ? <span className="text-amber-400">{t('settings.port_reachability.inactive')}</span>
              : <span className="text-white/30">{t('settings.port_reachability.node_offline')}</span>;

              return (
                <div className="mt-1 rounded-lg border border-white/10 bg-white/5 px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block w-2 h-2 rounded-full"
                        style={{ background: dotColor }}
                      />
                      <span className="text-sm text-white/70">{t('settings.port_reachability.title')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono">{statusEl}</span>
                      <button
                        onClick={handleRetryUpnp}
                        disabled={retryingUpnp || !running}
                        title={t('settings.buttons.retry_upnp')}
                        className="btn-secondary px-2.5 py-1 text-xs flex items-center gap-1 disabled:opacity-40"
                      >
                        {retryingUpnp ? (
                          <RefreshCw size={11} className="animate-spin" />
                        ) : (
                          <RefreshCw size={11} />
                        )}
                        {t('settings.port_reachability.retry')}
                      </button>
                    </div>
                  </div>
                  {nodeStatus?.upnp_external_ip && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white/40">{t('settings.port_reachability.external_ip_label')}</span>
                      <span className="font-mono text-white/70">{nodeStatus.upnp_external_ip}</span>
                    </div>
                  )}
                  {statusKind === 'detecting' && (
                    <p className="text-xs text-white/30 leading-relaxed">
                      {t('settings.port_reachability.detecting_paragraph')}
                    </p>
                  )}
                  {statusKind === 'inactive' && (
                    <p className="text-xs text-white/30 leading-relaxed">
                      {t('settings.port_reachability.inactive_paragraph')}
                    </p>
                  )}
                  {/* FIX C: inline UPnP diagnostic trace. Renders when
                      the status is non-green so the user can see which
                      step of the SOAP dance failed (SSDP, adapter
                      selection, control URL resolve, GetExternalIPAddress,
                      AddPortMapping) without leaving Settings. Mirrors
                      a subset of the Help page drawer. */}
                  {upnpDiag && (statusKind === 'detecting' || statusKind === 'inactive') && (
                    <div className="mt-2 rounded-md border border-white/8 bg-white/[0.02] px-3 py-2 space-y-1 text-[11px] font-mono">
                      <div className="flex justify-between gap-3">
                        <span className="text-white/40">Chosen LAN IP</span>
                        <span className="text-white/75">{upnpDiag.local_ipv4_chosen ?? '—'}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-white/40">Router IP</span>
                        <span className="text-white/75">{upnpDiag.gateway_ipv4 ?? '—'}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-white/40">Control URL</span>
                        <span className="text-white/70 truncate max-w-[60%]" title={upnpDiag.control_url ?? ''}>
                          {upnpDiag.control_url ? upnpDiag.control_url.replace(/^https?:\/\//, '') : '—'}
                        </span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-white/40">External IP</span>
                        <span className="text-white/75">
                          {upnpDiag.external_ip ?? '—'}
                          {upnpDiag.external_ip && upnpDiag.external_ip_routable === false && (
                            <span className="text-amber-300/80 ml-1.5">(private — double NAT)</span>
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-white/40">AddPortMapping tries</span>
                        <span className="text-white/70">{upnpDiag.add_port_mapping_attempts}</span>
                      </div>
                      {upnpDiag.last_fault && (
                        <div className="pt-1 mt-1 border-t border-white/8">
                          <div className="text-white/40 mb-0.5">Last fault</div>
                          <div className="text-rose-300/85 break-all leading-snug">{upnpDiag.last_fault}</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Connected Peers — privacy-friendly peer list. Default OFF.
                When the toggle is OFF only the count is shown; flipping it ON
                reveals the full multiaddr/height/last-seen/dialable detail.
                Preference is persisted to localStorage (SHOW_PEER_ADDRESSES_KEY). */}
            <div className="mt-1 rounded-lg border border-white/10 bg-white/5 px-4 py-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white/70">{t('settings.connected_peers.title')}</span>
                  <span className="text-xs font-mono text-white/40">
                    {t('settings.connected_peers.count', { count: peerList.length })}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-white/50">
                  {showPeerAddresses ? <EyeOff size={12} /> : <Eye size={12} />}
                  <span
                    className="cursor-pointer hover:text-white transition-colors"
                    onClick={() => setShowPeerAddresses((v) => !v)}
                  >
                    {showPeerAddresses
                      ? t('settings.connected_peers.hide_addresses')
                      : t('settings.connected_peers.show_addresses')}
                  </span>
                  <Toggle checked={showPeerAddresses} onChange={setShowPeerAddresses} />
                </div>
              </div>

              {showPeerAddresses && (
                <>
                  {peerList.length === 0 ? (
                    <p className="text-xs text-white/30 leading-relaxed">
                      {t('settings.connected_peers.empty')}
                    </p>
                  ) : (
                    <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                      {peerList.map((peer: PeerInfo, i) => (
                        <div
                          key={`${peer.multiaddr}-${i}`}
                          className="flex flex-col gap-0.5 px-3 py-2 rounded-md bg-black/20 border border-white/5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs text-white/80 break-all">
                              {peer.multiaddr}
                            </span>
                            <span
                              className={`text-[10px] font-mono shrink-0 px-1.5 py-0.5 rounded ${
                                peer.dialable
                                  ? 'bg-emerald-500/10 text-emerald-400'
                                  : 'bg-white/5 text-white/40'
                              }`}
                            >
                              {peer.dialable
                                ? t('settings.connected_peers.dialable_yes')
                                : t('settings.connected_peers.dialable_no')}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-[10px] font-mono text-white/40">
                            {typeof peer.height === 'number' && (
                              <span>
                                {t('settings.connected_peers.height_label')}{' '}
                                <span className="text-white/60">#{peer.height.toLocaleString()}</span>
                              </span>
                            )}
                            {typeof peer.last_seen === 'number' && (
                              <span>
                                {t('settings.connected_peers.last_seen_label')}{' '}
                                <span className="text-white/60">{timeAgo(peer.last_seen)}</span>
                              </span>
                            )}
                            {peer.agent && (
                              <span className="truncate">
                                {t('settings.connected_peers.agent_label')}{' '}
                                <span className="text-white/60">{peer.agent}</span>
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-[10px] text-white/30 leading-relaxed">
                    {t('settings.connected_peers.privacy_note')}
                  </p>
                </>
              )}
            </div>
          </Section>
        </motion.div>

        {/* Security info */}
        <motion.div variants={sectionVariants}>
          <Section title={t('settings.sections.security')} icon={Shield}>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-blue-300 text-xs">
              <Info size={14} className="mt-0.5 shrink-0" />
              <span>{t('settings.security_info.wallet_local')}</span>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-amber-400 text-xs">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{t('settings.security_info.rpc_token_warning')}</span>
            </div>
          </Section>
        </motion.div>

        {/* Connection Diagnostics */}
        <motion.div variants={sectionVariants}>
          <Section title={t('settings.sections.connection_diagnostics')} icon={Activity}>
            <div className="flex items-center justify-between">
              <p className="text-xs text-white/40">
                {t('settings.diagnostics.description')}
              </p>
              <button
                onClick={runDiagnostics}
                disabled={runningDiag}
                className="btn-secondary px-4 py-2 text-xs flex items-center gap-1.5 shrink-0 disabled:opacity-50"
              >
                {runningDiag ? (
                  <RefreshCw size={13} className="animate-spin" />
                ) : (
                  <Activity size={13} />
                )}
                {runningDiag ? t('settings.diagnostics.running') : t('settings.diagnostics.run')}
              </button>
            </div>

            <AnimatePresence>
              {diagResult && (
                <motion.div
                  key="diag-results"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  className="space-y-2"
                >
                  {/* Summary bar */}
                  <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/5 border border-white/10">
                    <span className="text-xs text-white/50">
                      <span className={diagResult.passed === diagResult.total ? 'text-emerald-400' : 'text-amber-400'}>
                        {diagResult.passed}/{diagResult.total}
                      </span>
                      {' '}{t('settings.diagnostics.checks_passed_suffix')}
                    </span>
                    <button
                      onClick={copyDiagReport}
                      className="flex items-center gap-1 text-xs text-white/50 hover:text-white transition-colors"
                    >
                      <Copy size={11} />
                      {t('settings.diagnostics.copy_report')}
                    </button>
                  </div>

                  {/* Individual checks — cap the list height so a long-detail
                      check doesn't push the rest of Settings off-screen. */}
                  <div className="space-y-1 max-h-96 overflow-y-auto pr-1">
                    {diagResult.checks.map((check, i) => (
                      <div
                        key={i}
                        className={`flex items-start gap-2.5 px-3 py-2 rounded-lg text-xs border ${
                          check.passed
                            ? 'bg-emerald-500/5 border-emerald-500/20'
                            : 'bg-rose-500/5 border-rose-500/20'
                        }`}
                      >
                        {check.passed ? (
                          <CheckCircle size={13} className="mt-0.5 shrink-0 text-emerald-400" />
                        ) : (
                          <XCircle size={13} className="mt-0.5 shrink-0 text-rose-400" />
                        )}
                        <div className="min-w-0">
                          <span className={check.passed ? 'text-emerald-300' : 'text-rose-300'}>
                            {check.label}
                          </span>
                          {check.detail && (
                            <p className="text-white/40 mt-0.5 font-mono break-all whitespace-pre-wrap">{check.detail}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </Section>
        </motion.div>

        {/* Recent Errors */}
        <motion.div variants={sectionVariants}>
          <Section title={t('settings.sections.recent_errors')} icon={AlertTriangle}>
            <div className="flex items-center justify-between">
              <p className="text-xs text-white/40">
                {errorLog.length === 0 ? t('settings.errors_section.none') : t('settings.errors_section.count', { count: errorLog.length })}
              </p>
              {errorLog.length > 0 && (
                <button
                  onClick={clearErrorLog}
                  className="btn-secondary px-3 py-1.5 text-xs flex items-center gap-1.5"
                >
                  <XCircle size={12} />
                  {t('settings.errors_section.clear')}
                </button>
              )}
            </div>

            {errorLog.length > 0 && (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {[...errorLog].reverse().map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-start gap-2.5 px-3 py-2 rounded-lg text-xs bg-rose-500/5 border border-rose-500/15"
                  >
                    <AlertTriangle size={12} className="mt-0.5 shrink-0 text-rose-400" />
                    <div className="min-w-0 flex-1">
                      <p className="text-rose-300 truncate">{entry.message}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {entry.context && (
                          <span className="text-white/40 font-mono">{entry.context}</span>
                        )}
                        <span className="text-white/25">{timeAgo(entry.ts)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </motion.div>

        {/* About */}
        <motion.div variants={sectionVariants}>
          <Section title={t('settings.sections.about')} icon={Cpu}>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-white/40">{t('settings.about_info.application')}</span>
                <span className="font-mono text-white">Irium Core GUI</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">{t('settings.about_info.version')}</span>
                <span className="font-mono text-white">{appVersion}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">{t('settings.about_info.framework')}</span>
                <span className="font-mono text-white">Tauri + React</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">{t('settings.about_info.license')}</span>
                <span className="font-mono text-white">MIT</span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <p className="text-xs text-white/40">{t('settings.about_info.check_github_releases')}</p>
              <button
                onClick={checkForUpdates}
                disabled={checkingUpdate}
                className="btn-secondary px-4 py-2 text-xs flex items-center gap-1.5 shrink-0 disabled:opacity-50"
              >
                {checkingUpdate ? (
                  <RefreshCw size={13} className="animate-spin" />
                ) : (
                  <RefreshCw size={13} />
                )}
                {checkingUpdate ? t('settings.about_info.checking') : t('settings.about_info.check_updates')}
              </button>
            </div>
          </Section>
        </motion.div>

        {/* Node Source / irium repo */}
        <motion.div variants={sectionVariants}>
          <Section title={t('settings.sections.node_source')} icon={GitBranch}>
            <p className="text-xs text-white/40">
              {t('settings.node_source_info.description_before_link')}{' '}
              <a
                href="https://github.com/iriumlabs/irium"
                target="_blank"
                rel="noopener noreferrer"
                className="text-irium-400 hover:text-irium-300 inline-flex items-center gap-0.5"
              >
                iriumlabs/irium <ExternalLink size={10} />
              </a>{' '}
              {t('settings.node_source_info.description_after_link')}
            </p>

            {/* Current build commit */}
            <div className="rounded-lg bg-white/5 border border-white/10 px-4 py-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-white/40">{t('settings.node_source_info.built_from_commit')}</span>
                <span className="font-mono text-white">
                  {nodeUpdateInfo?.current_commit_short ?? t('settings.node_source_info.loading')}
                </span>
              </div>
              {nodeUpdateInfo && (
                <>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white/40">{t('settings.node_source_info.latest_on_main')}</span>
                    <span className="font-mono text-white">{nodeUpdateInfo.latest_commit_short}</span>
                  </div>
                  {nodeUpdateInfo.has_update && (
                    <div className="flex items-start gap-2 pt-1 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                      <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-400" />
                      <div className="text-xs">
                        <p className="text-amber-300 font-medium">
                          {t('settings.node_source_info.commits_behind', { count: nodeUpdateInfo.commits_behind })}
                        </p>
                        <p className="text-white/40 mt-0.5 font-mono truncate">{nodeUpdateInfo.latest_message}</p>
                        <p className="text-white/30 mt-0.5">{t('settings.node_source_info.by_author', { author: nodeUpdateInfo.latest_author })}</p>
                      </div>
                    </div>
                  )}
                  {!nodeUpdateInfo.has_update && nodeUpdateInfo.current_commit !== 'unknown' && (
                    <div className="flex items-center gap-2 pt-1 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                      <CheckCircle size={13} className="shrink-0 text-emerald-400" />
                      <p className="text-xs text-emerald-300">{t('settings.toasts.node_up_to_date')}</p>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={checkNodeForUpdates}
                disabled={checkingNodeUpdate || pullingNodeUpdate}
                className="btn-secondary px-4 py-2 text-xs flex items-center gap-1.5 disabled:opacity-50"
              >
                {checkingNodeUpdate ? (
                  <RefreshCw size={13} className="animate-spin" />
                ) : (
                  <RefreshCw size={13} />
                )}
                {checkingNodeUpdate ? t('settings.node_source_info.checking') : t('settings.node_source_info.check_node_update')}
              </button>

              {nodeUpdateInfo?.has_update && (
                <button
                  onClick={() => setShowNodeUpdateConfirm(true)}
                  disabled={pullingNodeUpdate || checkingNodeUpdate}
                  className="btn-primary px-4 py-2 text-xs flex items-center gap-1.5 disabled:opacity-50"
                >
                  {pullingNodeUpdate ? (
                    <RefreshCw size={13} className="animate-spin" />
                  ) : (
                    <Download size={13} />
                  )}
                  {pullingNodeUpdate ? t('settings.node_source_info.pulling') : t('settings.node_source_info.pull_update')}
                </button>
              )}

              {nodeUpdateInfo?.compare_url && (
                <a
                  href={nodeUpdateInfo.compare_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary px-4 py-2 text-xs flex items-center gap-1.5"
                >
                  <ExternalLink size={13} />
                  {t('settings.node_source_info.view_changes')}
                </a>
              )}
            </div>

          </Section>
        </motion.div>

        {/* Node Data */}
        <motion.div variants={sectionVariants}>
          <Section title={t('settings.sections.node_data')} icon={Trash2}>
            <FieldRow
              label={t('settings.fields.external_ip')}
              description={t('settings.node_data_info.external_ip_description')}
            >
              <div className="flex flex-col gap-2 w-72">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={local.external_ip ?? ''}
                    onChange={(e) => patch('external_ip', e.target.value || undefined)}
                    placeholder="e.g. 203.0.113.42"
                    className="input flex-1 text-xs"
                  />
                  <button
                    onClick={() => setShowDetectPanel((v) => !v)}
                    className="btn-secondary px-3 py-2 text-xs flex items-center gap-1.5 shrink-0"
                  >
                    <Globe size={12} />
                    {t('settings.node_data_info.detect')}
                  </button>
                </div>
                {showDetectPanel && (
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2">
                    <p className="text-xs text-white/50">
                      {t('settings.node_data_info.detect_panel_paragraph')}
                    </p>
                    <input
                      type="text"
                      value={detectServiceUrl}
                      onChange={(e) => setDetectServiceUrl(e.target.value)}
                      className="input w-full text-xs"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleDetectIp}
                        disabled={fetchingIp || !detectServiceUrl.trim()}
                        className="btn-primary px-3 py-1.5 text-xs flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {fetchingIp ? <RefreshCw size={12} className="animate-spin" /> : <Globe size={12} />}
                        {fetchingIp ? t('settings.node_data_info.fetching') : t('settings.node_data_info.fetch')}
                      </button>
                      <button
                        onClick={() => setShowDetectPanel(false)}
                        className="btn-secondary px-3 py-1.5 text-xs"
                      >
                        {t('settings.node_data_info.cancel')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </FieldRow>
            <FieldRow
              label={t('settings.buttons.clear_chain_state')}
              description={t('settings.node_data_info.clear_state_description')}
            >
              <div className="flex items-center gap-2">
                <button
                  onClick={handleClearStateClick}
                  disabled={clearingState}
                  className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-50 ${
                    confirmClear
                      ? 'bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30'
                      : 'btn-secondary'
                  }`}
                >
                  {clearingState ? (
                    <RefreshCw size={13} className="animate-spin" />
                  ) : confirmClear ? (
                    <AlertTriangle size={13} />
                  ) : (
                    <Trash2 size={13} />
                  )}
                  {clearingState ? t('settings.node_data_info.clearing') : confirmClear ? t('settings.node_data_info.confirm_resync') : t('settings.node_data_info.clear_resync')}
                </button>
                {confirmClear && (
                  <p className="text-xs text-red-400/70">{t('settings.node_data_info.confirm_hint')}</p>
                )}
              </div>
            </FieldRow>
            <FieldRow
              label={t('settings.node_data_info.reset_state_button')}
              description={t('settings.node_data_info.reset_state_description')}
            >
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowResetStateConfirm(true)}
                  disabled={resettingState}
                  className="btn-secondary px-4 py-2 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                >
                  {resettingState ? (
                    <RefreshCw size={13} className="animate-spin" />
                  ) : (
                    <RotateCcw size={13} />
                  )}
                  {resettingState
                    ? t('settings.node_data_info.reset_state_resetting')
                    : t('settings.node_data_info.reset_state_button')}
                </button>
              </div>
            </FieldRow>
          </Section>
        </motion.div>

        {/* Developer */}
        <motion.div variants={sectionVariants}>
          <Section title={t('settings.sections.developer')} icon={Cpu}>
            <FieldRow
              label={t('settings.developer_info.reset_onboarding')}
              description={t('settings.developer_info.reset_onboarding_description')}
            >
              <button
                onClick={() => {
                  // Clear the "completed" flag AND set the force-onboarding
                  // sentinel so the heal-fallback in handleSplashDone (which
                  // recovers from AppData wipes) doesn't immediately put the
                  // user back into the app on the next launch.
                  localStorage.removeItem(ONBOARDING_KEY);
                  localStorage.setItem(FORCE_ONBOARDING_KEY, '1');
                  toast.success(t('settings.toasts.onboarding_reset'));
                }}
                className="btn-secondary px-4 py-2 text-sm"
              >
                {t('settings.developer_info.reset_onboarding')}
              </button>
            </FieldRow>
            <FieldRow
              label="Show legacy settlement UI"
              description="Use the original template-grid Settlement page instead of the new SafeTrade / PayForWork / Deposit flows. Takes effect on next /settlement navigation."
            >
              <Toggle checked={showLegacySettlement} onChange={setShowLegacySettlement} />
            </FieldRow>
          </Section>
        </motion.div>
      </motion.div>

      {/* Action bar */}
      <div className="flex items-center pt-1 pb-4">
        {/* Reset to defaults — inline confirm */}
        <button
          onClick={handleResetClick}
          className="btn-secondary flex items-center gap-2 px-4 py-2.5 text-sm text-white/50"
        >
          <AnimatePresence mode="wait" initial={false}>
            {confirmReset ? (
              <motion.span
                key="confirm"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="flex items-center gap-2"
              >
                <AlertTriangle size={14} className="text-amber-400" />
                <span className="text-amber-400">{t('settings.action_bar.are_you_sure')}</span>
              </motion.span>
            ) : (
              <motion.span
                key="normal"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="flex items-center gap-2"
              >
                <RotateCcw size={14} />
                {t('settings.action_bar.reset_to_defaults')}
              </motion.span>
            )}
          </AnimatePresence>
        </button>
        <AnimatePresence>
          {confirmReset && local.wallet_path && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden mt-3 w-full"
            >
              <div className="rounded-lg p-3 border border-amber-500/40 bg-amber-500/10 space-y-2">
                <p className="text-xs text-amber-300 flex items-start gap-2">
                  <AlertTriangle size={13} className="flex-shrink-0 mt-0.5 text-amber-400" />
                  <span>
                    {t('settings.action_bar.wallet_custom_warning_before')} <span className="font-mono text-amber-200 break-all">{local.wallet_path}</span>{t('settings.action_bar.wallet_custom_warning_after')}
                  </span>
                </p>
                <input
                  className="input text-xs py-1.5"
                  placeholder={t('settings.action_bar.reset_placeholder')}
                  value={resetInput}
                  onChange={(e) => setResetInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    // Enter submits when the confirmation has been typed
                    // correctly. Without this the user has to type RESET
                    // and then physically click the button again, which is
                    // unintuitive — typing RESET feels like the action.
                    if (e.key === 'Enter' && resetInput.trim() === 'RESET') {
                      e.preventDefault();
                      handleResetClick();
                    }
                  }}
                  autoFocus
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Reset Node State confirmation modal ───────────────── */}
      <AnimatePresence>
        {showResetStateConfirm && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setShowResetStateConfirm(false)}
            />
            <motion.div
              className="relative z-10 w-full max-w-md mx-4 rounded-xl border border-white/10 p-5 space-y-4"
              style={{ background: 'rgba(16,18,32,0.97)' }}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <div className="flex items-start gap-3">
                <RotateCcw size={18} className="mt-0.5 shrink-0 text-irium-400" />
                <div>
                  <p className="text-sm font-semibold text-white">{t('settings.node_data_info.reset_state_confirm_title')}</p>
                  <p className="mt-1.5 text-xs text-white/55 leading-relaxed">
                    {t('settings.node_data_info.reset_state_confirm_body')}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setShowResetStateConfirm(false)}
                  className="flex-1 px-4 py-2 text-xs rounded-lg border border-white/10 text-white/60 hover:text-white/80 hover:border-white/20 transition-colors"
                >
                  {t('settings.node_data_info.cancel')}
                </button>
                <button
                  onClick={handleResetNodeState}
                  className="flex-1 px-4 py-2 text-xs rounded-lg bg-irium-500/20 border border-irium-500/40 text-irium-300 hover:bg-irium-500/30 transition-colors font-medium"
                >
                  {t('settings.node_data_info.reset_state_proceed')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Update Node Source confirmation modal ─────────────── */}
      <AnimatePresence>
        {showNodeUpdateConfirm && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setShowNodeUpdateConfirm(false)}
            />
            <motion.div
              className="relative z-10 w-full max-w-sm mx-4 rounded-xl border border-white/10 p-5 space-y-4"
              style={{ background: 'rgba(16,18,32,0.97)' }}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <div className="flex items-start gap-3">
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-400" />
                <div>
                  <p className="text-sm font-semibold text-white">{t('settings.node_update_modal.title')}</p>
                  <p className="mt-1.5 text-xs text-white/50 leading-relaxed">
                    {t('settings.node_update_modal.body')}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setShowNodeUpdateConfirm(false)}
                  className="flex-1 px-4 py-2 text-xs rounded-lg border border-white/10 text-white/60 hover:text-white/80 hover:border-white/20 transition-colors"
                >
                  {t('settings.node_update_modal.cancel')}
                </button>
                <button
                  onClick={() => { setShowNodeUpdateConfirm(false); pullNodeUpdate(); }}
                  className="flex-1 px-4 py-2 text-xs rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 transition-colors font-medium"
                >
                  {t('settings.node_update_modal.proceed')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </div>
  );
}
