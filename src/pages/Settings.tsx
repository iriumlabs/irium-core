import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import toast from "react-hot-toast";
import {
  Server,
  FolderOpen,
  Zap,
  Monitor,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Save,
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
} from "lucide-react";
import { fetch as tauriFetch, ResponseType } from "@tauri-apps/api/http";
import { open as openExternal } from "@tauri-apps/api/shell";
import { useStore } from "../lib/store";
import { rpc, diagnostics, update, nodeUpdate, node, config } from "../lib/tauri";
import { DEFAULT_SETTINGS, type DiagnosticsResult, type NodeUpdateCheckResult, type Theme, timeAgo } from "../lib/types";
import { ONBOARDING_KEY, FORCE_ONBOARDING_KEY } from "./Onboarding";

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
  const { settings, updateSettings, setUpdateInfo, errorLog, clearErrorLog } = useStore();
  // Banner-ready update info — populated by the silent startup check in
  // App.tsx and refreshed when this Settings page mounts (covers users who
  // leave the app running for days without a restart).
  const updateInfo = useStore((s) => s.updateInfo);
  const [local, setLocal] = useState({ ...settings });
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [testingRpc, setTestingRpc] = useState(false);
  const [rpcOk, setRpcOk] = useState<boolean | null>(null);
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const confirmResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const [showDetectPanel, setShowDetectPanel] = useState(false);
  const [detectServiceUrl, setDetectServiceUrl] = useState('https://api.ipify.org');
  const [fetchingIp, setFetchingIp] = useState(false);
  const [retryingUpnp, setRetryingUpnp] = useState(false);
  const nodeStatus = useStore((s) => s.nodeStatus);
  const nodeMetrics = useStore((s) => s.nodeMetrics);
  const appVersion = useStore((s) => s.appVersion);

  // Track when the node first started running (this session). Drives the
  // "Detecting..." → "Inactive" timeout on the UPnP card so we don't show
  // "Inactive — outbound only" the instant the node starts (PEX takes a
  // minute to propagate our dialable address to other peers). Resets when
  // running flips false → null, so a restart re-enters the detecting window.
  const nodeRunningSinceRef = useRef<number | null>(null);
  const [nowTick, setNowTick] = useState(0); // re-render every second to update elapsed time
  useEffect(() => {
    if (nodeStatus?.running) {
      if (nodeRunningSinceRef.current === null) {
        nodeRunningSinceRef.current = Date.now();
      }
    } else {
      nodeRunningSinceRef.current = null;
    }
  }, [nodeStatus?.running]);
  // Tick once per second while node is running and we're still inside the
  // 60s detecting window. Stops once we transition out so it doesn't burn
  // cycles forever.
  useEffect(() => {
    if (!nodeStatus?.running) return;
    const started = nodeRunningSinceRef.current;
    if (started === null) return;
    if (Date.now() - started > 60_000) return; // already past the window
    const id = setInterval(() => setNowTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [nodeStatus?.running, nowTick]);

  useEffect(() => {
    return () => {
      if (confirmResetTimerRef.current) clearTimeout(confirmResetTimerRef.current);
      if (confirmClearTimerRef.current) clearTimeout(confirmClearTimerRef.current);
    };
  }, []);

  // Refresh the update-availability check when the Settings page opens. The
  // App-level silent check runs only at boot; this catches users who keep
  // the app running for long periods. Failures are tolerated silently — the
  // banner just won't appear.
  useEffect(() => {
    update.check().then((info) => {
      if (info) setUpdateInfo(info);
    }).catch(() => {});
  }, [setUpdateInfo]);

  const patch = <K extends keyof typeof local>(key: K, value: (typeof local)[K]) => {
    setLocal((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
    if (saveState === "saved") setSaveState("idle");
    if (key === "rpc_url") {
      setRpcOk(null);
      setRpcError(null);
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
      if (resp.ok) {
        setRpcOk(true);
        const height = resp.data?.height;
        if (typeof height === "number") {
          toast.success(`Connected to node at height ${height.toLocaleString()}`);
        } else {
          toast.success('Connected to node successfully');
        }
      } else {
        setRpcError(`HTTP ${resp.status}`);
      }
    } catch (e: unknown) {
      setRpcError(e instanceof Error ? e.message : "Connection failed");
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
      toast.error(e instanceof Error ? e.message : 'Diagnostics failed');
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
    toast.success('Report copied to clipboard');
  };

  const save = async () => {
    setSaveState("saving");
    try {
      await rpc.setUrl(local.rpc_url);
      updateSettings(local);
      setDirty(false);
      setSaveState("saved");
      toast.success("Settings saved");
      setTimeout(() => setSaveState("idle"), 2500);
    } catch (e: unknown) {
      console.error(e);
      setSaveState("idle");
      toast.error('Failed to save settings');
    }
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

    toast.success('Reset to defaults — reloading…');
    setTimeout(() => window.location.reload(), 600);
  };

  const checkForUpdates = async () => {
    setCheckingUpdate(true);
    try {
      const info = await update.check();
      if (info?.available) {
        setUpdateInfo(info);
        toast.success(`Update available: v${info.latest_version}`);
      } else {
        toast.success('You are on the latest version');
      }
    } catch {
      toast.error('Update check failed');
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
          toast.success(`Node update available — ${info.commits_behind} commit${info.commits_behind !== 1 ? 's' : ''} behind`);
        } else {
          toast.success('Node source is up to date');
        }
      }
    } catch {
      toast.error('Node update check failed');
    } finally {
      setCheckingNodeUpdate(false);
    }
  };

  const pullNodeUpdate = async () => {
    setPullingNodeUpdate(true);
    try {
      const result = await nodeUpdate.pull();
      if (result?.success) {
        toast.success(`Pulled ${result.new_commit_short} — rebuild binaries to apply`);
        setNodeUpdateInfo((prev) => prev ? { ...prev, has_update: false, current_commit: result.new_commit, current_commit_short: result.new_commit_short } : prev);
      } else {
        toast.error('Failed to pull update');
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Pull failed');
    } finally {
      setPullingNodeUpdate(false);
    }
  };

  const handleResetClick = () => {
    if (confirmReset) {
      reset();
      setConfirmReset(false);
    } else {
      setConfirmReset(true);
      confirmResetTimerRef.current = setTimeout(() => setConfirmReset(false), 3000);
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
      await node.clearState();
      toast.success('Chain state cleared — restarting node from scratch…');
      await new Promise((r) => setTimeout(r, 800));
      const result = await node.start(undefined, local.external_ip);
      if (result.success) {
        toast.success('Node restarting…');
      } else {
        toast.error(result.message);
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Clear state failed');
    } finally {
      setClearingState(false);
    }
  };

  const handleDetectIp = async () => {
    setFetchingIp(true);
    try {
      const ip = await node.detectPublicIp(detectServiceUrl);
      patch('external_ip', ip);
      setShowDetectPanel(false);
      toast.success(`Detected IP: ${ip} — save settings to apply`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Detection failed');
    } finally {
      setFetchingIp(false);
    }
  };

  const handleRetryUpnp = async () => {
    setRetryingUpnp(true);
    try {
      const ip = await node.tryUpnpPortMap();
      if (ip) {
        toast.success(`UPnP mapped TCP 38291 — external IP: ${ip}`);
      } else {
        toast.error('UPnP failed — router may not support it or port is already mapped');
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'UPnP failed');
    } finally {
      setRetryingUpnp(false);
    }
  };

  return (
    <div className="w-full h-full overflow-y-auto px-8 py-6">
      <div className="reading-col space-y-5" style={{ maxWidth: 1100 }}>
      {/* Header */}
      <div>
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">
          Configure your node connection, wallet paths, and display preferences.
        </p>
      </div>

      {/* Update-available banner — sits at the top of Settings whenever the
          GitHub releases API reports a tag_name newer than CURRENT_VERSION.
          Same updateInfo Zustand slice the top-of-app UpdateBanner reads; this
          one is page-local and always visible (no dismiss state) so users who
          dismissed the global banner still see it here. */}
      {updateInfo?.available && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="card p-4 flex items-center justify-between gap-4"
          style={{
            background: 'linear-gradient(135deg, rgba(110,198,255,0.10) 0%, rgba(167,139,250,0.08) 100%)',
            border: '1px solid var(--brand-line-hi)',
          }}
        >
          <div className="flex items-start gap-3 min-w-0">
            <Download size={18} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--brand)' }} />
            <div className="min-w-0">
              <p className="text-sm font-semibold" style={{ color: 'var(--t1)' }}>
                A new version of Irium Core is available: v{updateInfo.latest_version}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--t3)' }}>
                You're on v{updateInfo.current_version}. Download at github.com/iriumlabs/irium-core/releases
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              const url = updateInfo.release_url
                ?? 'https://github.com/iriumlabs/irium-core/releases/latest';
              openExternal(url).catch(() => {
                // Tauri shell.open failed — leave a toast hint
                toast.error('Could not open browser');
              });
            }}
            className="btn-primary px-4 py-2 text-xs flex items-center gap-1.5 flex-shrink-0"
          >
            <Download size={13} />
            Download
          </button>
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
          <Section title="Node Connection" icon={Server}>
            <FieldRow
              label="RPC URL"
              description="URL for your local iriumd instance"
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
                    ? "Testing…"
                    : rpcOk === true
                    ? "Connected"
                    : rpcError
                    ? "Failed"
                    : "Test"}
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
                    <CheckCircle size={12} /> Connected successfully
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
              label="Auto-start node"
              description="Launch iriumd automatically when Irium Core opens"
            >
              <Toggle
                checked={local.auto_start_node}
                onChange={(v) => patch("auto_start_node", v)}
              />
            </FieldRow>
          </Section>
        </motion.div>

        {/* Wallet */}
        <motion.div variants={sectionVariants}>
          <Section title="Wallet" icon={FolderOpen}>
            <FieldRow
              label="Wallet file path"
              description="Custom path to your wallet file (leave blank for default)"
            >
              <input
                type="text"
                value={local.wallet_path ?? ""}
                onChange={(e) => patch("wallet_path", e.target.value || undefined)}
                placeholder="~/.irium/wallet.json (default)"
                className="input w-full font-mono text-sm"
              />
            </FieldRow>

            <FieldRow
              label="Data directory"
              description="Custom iriumd data directory (leave blank for default)"
            >
              <input
                type="text"
                value={local.data_dir ?? ""}
                onChange={(e) => patch("data_dir", e.target.value || undefined)}
                placeholder="~/.irium (default)"
                className="input w-full font-mono text-sm"
              />
            </FieldRow>
          </Section>
        </motion.div>

        {/* Display */}
        <motion.div variants={sectionVariants}>
          <Section title="Display" icon={Monitor}>
            <FieldRow
              label="Theme"
              description="App color palette — applies instantly"
            >
              <div className="flex gap-3 flex-wrap">
                {THEMES.map((t) => {
                  const isActive = local.theme === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => {
                        // Apply immediately (live preview + persist via store).
                        // Mirror in local so the swatch UI reflects selection
                        // without waiting for the Save button.
                        setLocal((prev) => ({ ...prev, theme: t.id }));
                        updateSettings({ theme: t.id });
                      }}
                      title={t.label}
                      className="rounded-xl p-2.5 flex flex-col items-center gap-2 transition-all"
                      style={{
                        background: isActive ? 'rgba(110,198,255,0.10)' : 'rgba(255,255,255,0.04)',
                        border: `2px solid ${isActive ? 'var(--brand-line-hi)' : 'rgba(255,255,255,0.08)'}`,
                        boxShadow: isActive ? '0 0 0 1px var(--brand-glow), 0 4px 16px rgba(0,0,0,0.25)' : 'none',
                      }}
                    >
                      <div
                        className="w-12 h-12 rounded-lg"
                        style={{ background: t.preview, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.10)' }}
                      />
                      <span
                        className="text-[10px] font-mono"
                        style={{ color: isActive ? 'var(--brand)' : 'rgba(238,240,255,0.45)' }}
                      >
                        {t.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </FieldRow>

            <FieldRow
              label="Currency display"
              description="How to show Irium amounts throughout the app"
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
              label="Minimize to tray"
              description="Keep node running when the window is closed"
            >
              <Toggle
                checked={local.minimize_to_tray}
                onChange={(v) => patch("minimize_to_tray", v)}
              />
            </FieldRow>
          </Section>
        </motion.div>

        {/* Network info */}
        <motion.div variants={sectionVariants}>
          <Section title="Network" icon={Globe}>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-white/40">Network</span>
                <span className="font-mono text-emerald-400">Mainnet</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">P2P port</span>
                <span className="font-mono text-white">38291</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">RPC port</span>
                <span className="font-mono text-white">38300</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Address prefix</span>
                <span className="font-mono text-white">P / Q</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Consensus</span>
                <span className="font-mono text-white">SHA-256d PoW</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Total supply</span>
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
                statusKind === 'active-upnp'   ? <span className="text-emerald-400">Active (UPnP) — TCP 38291 open</span>
              : statusKind === 'active-manual' ? <span className="text-emerald-400">Active (manual) — {inboundCount} inbound peer{inboundCount === 1 ? '' : 's'}</span>
              : statusKind === 'detecting'     ? <span className="text-amber-400">Detecting… ({Math.max(0, 60 - elapsedSec)}s)</span>
              : statusKind === 'inactive'      ? <span className="text-amber-400">Inactive — outbound only</span>
              : <span className="text-white/30">Node offline</span>;

              return (
                <div className="mt-1 rounded-lg border border-white/10 bg-white/5 px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block w-2 h-2 rounded-full"
                        style={{ background: dotColor }}
                      />
                      <span className="text-sm text-white/70">Port Reachability</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono">{statusEl}</span>
                      <button
                        onClick={handleRetryUpnp}
                        disabled={retryingUpnp || !running}
                        title="Retry UPnP port mapping"
                        className="btn-secondary px-2.5 py-1 text-xs flex items-center gap-1 disabled:opacity-40"
                      >
                        {retryingUpnp ? (
                          <RefreshCw size={11} className="animate-spin" />
                        ) : (
                          <RefreshCw size={11} />
                        )}
                        Retry
                      </button>
                    </div>
                  </div>
                  {nodeStatus?.upnp_external_ip && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white/40">External IP</span>
                      <span className="font-mono text-white/70">{nodeStatus.upnp_external_ip}</span>
                    </div>
                  )}
                  {statusKind === 'detecting' && (
                    <p className="text-xs text-white/30 leading-relaxed">
                      Waiting up to 60s for an inbound peer to confirm reachability. PEX needs a
                      moment to propagate your address to other nodes after start.
                    </p>
                  )}
                  {statusKind === 'inactive' && (
                    <p className="text-xs text-white/30 leading-relaxed">
                      UPnP failed and no inbound peers have arrived. Configure manual port
                      forwarding on your router (TCP 38291) or enable UPnP, then click Retry.
                      Outbound connections still work in this state.
                    </p>
                  )}
                </div>
              );
            })()}
          </Section>
        </motion.div>

        {/* Security info */}
        <motion.div variants={sectionVariants}>
          <Section title="Security" icon={Shield}>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-blue-300 text-xs">
              <Info size={14} className="mt-0.5 shrink-0" />
              <span>
                Irium Core stores your wallet file locally. Your private keys never leave your
                machine. The wallet file is encrypted. Always back up your seed phrase and keep it
                offline.
              </span>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-amber-400 text-xs">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                If you set <code className="font-mono">IRIUM_RPC_TOKEN</code> on your node, the
                GUI currently uses the default unauthenticated connection. Token-based auth support
                is coming in a future release.
              </span>
            </div>
          </Section>
        </motion.div>

        {/* Connection Diagnostics */}
        <motion.div variants={sectionVariants}>
          <Section title="Connection Diagnostics" icon={Activity}>
            <div className="flex items-center justify-between">
              <p className="text-xs text-white/40">
                Runs 7 checks against your node, wallet, and binary setup.
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
                {runningDiag ? 'Running…' : 'Run Diagnostics'}
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
                      {' '}checks passed
                    </span>
                    <button
                      onClick={copyDiagReport}
                      className="flex items-center gap-1 text-xs text-white/50 hover:text-white transition-colors"
                    >
                      <Copy size={11} />
                      Copy Report
                    </button>
                  </div>

                  {/* Individual checks */}
                  <div className="space-y-1">
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
                            <p className="text-white/40 mt-0.5 font-mono truncate">{check.detail}</p>
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
          <Section title="Recent Errors" icon={AlertTriangle}>
            <div className="flex items-center justify-between">
              <p className="text-xs text-white/40">
                {errorLog.length === 0 ? 'No errors recorded.' : `${errorLog.length} error${errorLog.length !== 1 ? 's' : ''} recorded.`}
              </p>
              {errorLog.length > 0 && (
                <button
                  onClick={clearErrorLog}
                  className="btn-secondary px-3 py-1.5 text-xs flex items-center gap-1.5"
                >
                  <XCircle size={12} />
                  Clear
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
          <Section title="About" icon={Cpu}>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-white/40">Application</span>
                <span className="font-mono text-white">Irium Core GUI</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Version</span>
                <span className="font-mono text-white">{appVersion}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Framework</span>
                <span className="font-mono text-white">Tauri + React</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">License</span>
                <span className="font-mono text-white">MIT</span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <p className="text-xs text-white/40">Check GitHub releases for a newer GUI version.</p>
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
                {checkingUpdate ? 'Checking…' : 'Check for Updates'}
              </button>
            </div>
          </Section>
        </motion.div>

        {/* Node Source / irium repo */}
        <motion.div variants={sectionVariants}>
          <Section title="Node Source" icon={GitBranch}>
            <p className="text-xs text-white/40">
              The node binaries (iriumd, irium-wallet, irium-miner) are compiled directly
              from the{' '}
              <a
                href="https://github.com/iriumlabs/irium"
                target="_blank"
                rel="noopener noreferrer"
                className="text-irium-400 hover:text-irium-300 inline-flex items-center gap-0.5"
              >
                iriumlabs/irium <ExternalLink size={10} />
              </a>{' '}
              repository, which is embedded as a git submodule. No features are ever
              missed — every capability added to the irium repo is automatically
              available to this app.
            </p>

            {/* Current build commit */}
            <div className="rounded-lg bg-white/5 border border-white/10 px-4 py-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-white/40">Built from commit</span>
                <span className="font-mono text-white">
                  {nodeUpdateInfo?.current_commit_short ?? 'loading…'}
                </span>
              </div>
              {nodeUpdateInfo && (
                <>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white/40">Latest on main</span>
                    <span className="font-mono text-white">{nodeUpdateInfo.latest_commit_short}</span>
                  </div>
                  {nodeUpdateInfo.has_update && (
                    <div className="flex items-start gap-2 pt-1 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                      <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-400" />
                      <div className="text-xs">
                        <p className="text-amber-300 font-medium">
                          {nodeUpdateInfo.commits_behind} commit{nodeUpdateInfo.commits_behind !== 1 ? 's' : ''} behind
                        </p>
                        <p className="text-white/40 mt-0.5 font-mono truncate">{nodeUpdateInfo.latest_message}</p>
                        <p className="text-white/30 mt-0.5">by {nodeUpdateInfo.latest_author}</p>
                      </div>
                    </div>
                  )}
                  {!nodeUpdateInfo.has_update && nodeUpdateInfo.current_commit !== 'unknown' && (
                    <div className="flex items-center gap-2 pt-1 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                      <CheckCircle size={13} className="shrink-0 text-emerald-400" />
                      <p className="text-xs text-emerald-300">Node source is up to date</p>
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
                {checkingNodeUpdate ? 'Checking…' : 'Check for Node Update'}
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
                  {pullingNodeUpdate ? 'Pulling…' : 'Pull Update'}
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
                  View Changes
                </a>
              )}
            </div>

            {/* After pull: rebuild instruction */}
            <AnimatePresence>
              {!nodeUpdateInfo?.has_update && nodeUpdateInfo && nodeUpdateInfo.current_commit !== 'unknown' && pullingNodeUpdate === false && (
                <motion.div
                  key="rebuild-note"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-blue-300 text-xs"
                >
                  <Info size={13} className="mt-0.5 shrink-0" />
                  <span>
                    After pulling an update, rebuild the node binaries by running{' '}
                    <code className="font-mono bg-white/5 px-1 rounded">npm run build:node -- --force</code>{' '}
                    then restart Irium Core to apply the new version.
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </Section>
        </motion.div>

        {/* Node Data */}
        <motion.div variants={sectionVariants}>
          <Section title="Node Data" icon={Trash2}>
            <FieldRow
              label="External IP"
              description="Your public IP address announced to the network so peers can dial back to your node. Nothing is sent automatically — you control when detection happens."
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
                    Detect
                  </button>
                </div>
                {showDetectPanel && (
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2">
                    <p className="text-xs text-white/50">
                      Enter a URL that returns your public IP as plain text. The request will only be sent when you click Fetch.
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
                        {fetchingIp ? 'Fetching…' : 'Fetch'}
                      </button>
                      <button
                        onClick={() => setShowDetectPanel(false)}
                        className="btn-secondary px-3 py-1.5 text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </FieldRow>
            <FieldRow
              label="Clear chain state"
              description="Wipe block data and resync from scratch. Wallet and agreements are preserved."
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
                  {clearingState ? 'Clearing…' : confirmClear ? 'Confirm — this will resync!' : 'Clear & Resync'}
                </button>
                {confirmClear && (
                  <p className="text-xs text-red-400/70">Click again to confirm. Blocks will be re-downloaded.</p>
                )}
              </div>
            </FieldRow>
          </Section>
        </motion.div>

        {/* Developer */}
        <motion.div variants={sectionVariants}>
          <Section title="Developer" icon={Cpu}>
            <FieldRow
              label="Reset onboarding"
              description="Show the first-run setup wizard again on next launch"
            >
              <button
                onClick={() => {
                  // Clear the "completed" flag AND set the force-onboarding
                  // sentinel so the heal-fallback in handleSplashDone (which
                  // recovers from AppData wipes) doesn't immediately put the
                  // user back into the app on the next launch.
                  localStorage.removeItem(ONBOARDING_KEY);
                  localStorage.setItem(FORCE_ONBOARDING_KEY, '1');
                  toast.success('Onboarding reset — restart the app to see the wizard');
                }}
                className="btn-secondary px-4 py-2 text-sm"
              >
                Reset onboarding
              </button>
            </FieldRow>
          </Section>
        </motion.div>
      </motion.div>

      {/* Action bar */}
      <div className="flex items-center justify-between pt-1 pb-4">
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
                <span className="text-amber-400">Are you sure?</span>
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
                Reset to defaults
              </motion.span>
            )}
          </AnimatePresence>
        </button>

        {/* Save button — spinner → checkmark → normal with green glow flash */}
        <button
          onClick={save}
          disabled={!dirty || saveState !== "idle"}
          className={`btn-primary flex items-center gap-2 px-6 py-2.5 text-sm disabled:opacity-50 transition-shadow ${
            saveState === "saved" ? "glow-green" : ""
          }`}
        >
          <AnimatePresence mode="wait" initial={false}>
            {saveState === "saving" ? (
              <motion.span
                key="saving"
                initial={{ opacity: 0, rotate: -90 }}
                animate={{ opacity: 1, rotate: 0 }}
                exit={{ opacity: 0 }}
              >
                <RefreshCw size={15} className="animate-spin" />
              </motion.span>
            ) : saveState === "saved" ? (
              <motion.span
                key="saved"
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0 }}
                transition={{ type: "spring", stiffness: 400, damping: 20 }}
              >
                <CheckCircle size={15} className="text-emerald-300" />
              </motion.span>
            ) : (
              <motion.span
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <Save size={15} />
              </motion.span>
            )}
          </AnimatePresence>
          {saveState === "saving"
            ? "Saving…"
            : saveState === "saved"
            ? "Saved!"
            : "Save Settings"}
        </button>
      </div>

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
                  <p className="text-sm font-semibold text-white">Update Node Source</p>
                  <p className="mt-1.5 text-xs text-white/50 leading-relaxed">
                    This will pull the latest iriumd source code and rebuild the node binary. If the
                    new code is unstable it may break your running node and require a restart. Only
                    proceed if you know what you are doing.
                  </p>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setShowNodeUpdateConfirm(false)}
                  className="flex-1 px-4 py-2 text-xs rounded-lg border border-white/10 text-white/60 hover:text-white/80 hover:border-white/20 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { setShowNodeUpdateConfirm(false); pullNodeUpdate(); }}
                  className="flex-1 px-4 py-2 text-xs rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 transition-colors font-medium"
                >
                  I understand, update anyway
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
