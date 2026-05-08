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
} from "lucide-react";
import { useStore } from "../lib/store";
import { rpc, diagnostics, update } from "../lib/tauri";
import { DEFAULT_SETTINGS, type DiagnosticsResult, timeAgo } from "../lib/types";
import { ONBOARDING_KEY } from "./Onboarding";

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

  useEffect(() => {
    return () => {
      if (confirmResetTimerRef.current) clearTimeout(confirmResetTimerRef.current);
    };
  }, []);

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
      const resp = await fetch(`${local.rpc_url}/status`, {
        signal: AbortSignal.timeout(4000),
      });
      if (resp.ok) {
        setRpcOk(true);
        try {
          const data = await resp.json() as { height?: number };
          if (data.height !== undefined) {
            toast.success(`Connected to node at height ${data.height.toLocaleString()}`);
          } else {
            toast.success('Connected to node successfully');
          }
        } catch {
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

  const reset = () => {
    setLocal({ ...DEFAULT_SETTINGS });
    setDirty(true);
    if (saveState === "saved") setSaveState("idle");
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

  const handleResetClick = () => {
    if (confirmReset) {
      reset();
      setConfirmReset(false);
    } else {
      setConfirmReset(true);
      confirmResetTimerRef.current = setTimeout(() => setConfirmReset(false), 3000);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold font-display gradient-text">Settings</h1>
        <p className="text-sm text-white/40 mt-1">
          Configure your Irium Core node connection, wallet paths, and display preferences.
        </p>
      </div>

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

        {/* Network info (read-only) */}
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
                <span className="font-mono text-white">1.0.0</span>
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
              <p className="text-xs text-white/40">Check GitHub releases for a newer version.</p>
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

        {/* Developer */}
        <motion.div variants={sectionVariants}>
          <Section title="Developer" icon={Cpu}>
            <FieldRow
              label="Reset onboarding"
              description="Show the first-run setup wizard again on next launch"
            >
              <button
                onClick={() => {
                  localStorage.removeItem(ONBOARDING_KEY);
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
    </div>
  );
}
