import { useState } from "react";
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
} from "lucide-react";
import { useStore } from "../lib/store";
import { rpc } from "../lib/tauri";
import { DEFAULT_SETTINGS } from "../lib/types";

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
        {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

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
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 transition-colors duration-200 focus:outline-none
        ${checked ? "bg-irium-600 border-irium-600" : "bg-slate-700 border-slate-600"}
        ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}
      `}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200 mt-0.5
          ${checked ? "translate-x-5" : "translate-x-0.5"}`}
      />
    </button>
  );
}

export default function Settings() {
  const { settings, updateSettings } = useStore();
  const [local, setLocal] = useState({ ...settings });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingRpc, setTestingRpc] = useState(false);
  const [rpcOk, setRpcOk] = useState<boolean | null>(null);
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const patch = (key: keyof typeof local, value: unknown) => {
    setLocal((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
    setSaved(false);
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
      const status = await fetch(`${local.rpc_url}/status`, { signal: AbortSignal.timeout(4000) });
      if (status.ok) {
        setRpcOk(true);
      } else {
        setRpcError(`HTTP ${status.status}`);
      }
    } catch (e: unknown) {
      setRpcError(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setTestingRpc(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await rpc.setUrl(local.rpc_url);
      updateSettings(local);
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: unknown) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setLocal({ ...DEFAULT_SETTINGS });
    setDirty(true);
    setSaved(false);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold font-display gradient-text">Settings</h1>
        <p className="text-sm text-slate-500 mt-1">
          Configure your Irium Core node connection, wallet paths, and display preferences.
        </p>
      </div>

      {/* Saved banner */}
      {saved && (
        <div className="card border-emerald-500/30 bg-emerald-500/5 p-3 flex items-center gap-2 text-emerald-400 text-sm">
          <CheckCircle size={15} />
          Settings saved successfully.
        </div>
      )}

      {/* Node / RPC */}
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
            <button
              onClick={testRpc}
              disabled={testingRpc || !local.rpc_url}
              className="btn-secondary px-3 py-2 text-xs flex items-center gap-1.5 shrink-0 disabled:opacity-50"
            >
              {testingRpc ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : (
                <Zap size={13} />
              )}
              Test
            </button>
          </div>
          {rpcOk === true && (
            <p className="mt-1.5 text-xs text-emerald-400 flex items-center gap-1">
              <CheckCircle size={12} /> Connected successfully
            </p>
          )}
          {rpcError && (
            <p className="mt-1.5 text-xs text-rose-400 flex items-center gap-1">
              <AlertTriangle size={12} /> {rpcError}
            </p>
          )}
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

      {/* Wallet */}
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

      {/* Display */}
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
                    : "bg-white/5 border-white/10 text-slate-400 hover:text-white hover:border-white/20"
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

      {/* Network info (read-only) */}
      <Section title="Network" icon={Globe}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Network</span>
            <span className="font-mono text-emerald-400">Mainnet</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">P2P port</span>
            <span className="font-mono text-white">38291</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">RPC port</span>
            <span className="font-mono text-white">38300</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Address prefix</span>
            <span className="font-mono text-white">P / Q</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Consensus</span>
            <span className="font-mono text-white">SHA-256d PoW</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Total supply</span>
            <span className="font-mono text-white">100,000,000 IRM</span>
          </div>
        </div>
      </Section>

      {/* Security info */}
      <Section title="Security" icon={Shield}>
        <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-blue-300 text-xs">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>
            Irium Core stores your wallet file locally. Your private keys never leave your machine.
            The wallet file is encrypted. Always back up your seed phrase and keep it offline.
          </span>
        </div>
        <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-amber-400 text-xs">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            If you set <code className="font-mono">IRIUM_RPC_TOKEN</code> on your node, the GUI
            currently uses the default unauthenticated connection. Token-based auth support is
            coming in a future release.
          </span>
        </div>
      </Section>

      {/* About */}
      <Section title="About" icon={Cpu}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Application</span>
            <span className="font-mono text-white">Irium Core GUI</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Version</span>
            <span className="font-mono text-white">1.0.0</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Framework</span>
            <span className="font-mono text-white">Tauri + React</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">License</span>
            <span className="font-mono text-white">MIT</span>
          </div>
        </div>
      </Section>

      {/* Action bar */}
      <div className="flex items-center justify-between pt-1 pb-4">
        <button
          onClick={reset}
          className="btn-secondary flex items-center gap-2 px-4 py-2.5 text-sm text-slate-400"
        >
          <RotateCcw size={14} />
          Reset to defaults
        </button>

        <button
          onClick={save}
          disabled={!dirty || saving}
          className="btn-primary flex items-center gap-2 px-6 py-2.5 text-sm disabled:opacity-50"
        >
          <Save size={15} />
          {saving ? "Saving…" : "Save Settings"}
        </button>
      </div>
    </div>
  );
}
