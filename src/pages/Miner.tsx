import { useState, useEffect, useRef } from "react";
import {
  Cpu,
  Play,
  Square,
  RefreshCw,
  Hash,
  Zap,
  TrendingUp,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Settings2,
  Server,
} from "lucide-react";
import { miner, wallet } from "../lib/tauri";
import type { MinerStatus, AddressInfo } from "../lib/types";

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  accent = false,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: typeof Cpu;
  accent?: boolean;
}) {
  return (
    <div className={`card p-4 ${accent ? "border-irium-500/40" : ""}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider">{label}</p>
          <p className={`text-2xl font-bold font-mono mt-1 ${accent ? "gradient-text" : "text-white"}`}>
            {value}
          </p>
          {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
        </div>
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center ${
            accent ? "bg-irium-600/20" : "bg-white/5"
          }`}
        >
          <Icon size={18} className={accent ? "text-irium-400" : "text-slate-400"} />
        </div>
      </div>
    </div>
  );
}

const LOG_LIMIT = 200;

export default function Miner() {
  const [status, setStatus] = useState<MinerStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [miningAddr, setMiningAddr] = useState("");
  const [threads, setThreads] = useState(2);
  const [addresses, setAddresses] = useState<AddressInfo[]>([]);
  const [showAddrPicker, setShowAddrPicker] = useState(false);

  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const logsRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const appendLog = (msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setLogs((prev) => [`[${ts}] ${msg}`, ...prev].slice(0, LOG_LIMIT));
  };

  const loadAddresses = async () => {
    try {
      const addrs = await wallet.listAddresses();
      setAddresses(addrs);
      if (addrs.length > 0 && !miningAddr) setMiningAddr(addrs[0].address);
    } catch {}
  };

  const pollStatus = async () => {
    try {
      const s = await miner.status();
      setStatus(s);
    } catch {}
  };

  useEffect(() => {
    loadAddresses();
    pollStatus();
    pollRef.current = setInterval(pollStatus, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleStart = async () => {
    if (!miningAddr.trim()) {
      setError("Please enter or select a mining address.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await miner.start(miningAddr.trim(), threads);
      appendLog(`Mining started → ${miningAddr.trim()} (${threads} threads)`);
      await pollStatus();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      appendLog(`Error: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      await miner.stop();
      appendLog("Mining stopped.");
      await pollStatus();
    } catch (e: unknown) {
      appendLog(`Stop error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const running = status?.running ?? false;
  const hashrate = status?.hashrate_khs ?? 0;
  const blocksFound = status?.blocks_found ?? 0;
  const uptimeSecs = status?.uptime_secs ?? 0;
  const difficulty = status?.difficulty ?? 0;
  const activeThreads = status?.threads ?? 0;

  const formatUptime = (s: number) => {
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display gradient-text">Miner</h1>
          <p className="text-sm text-slate-500 mt-1">
            SHA-256d CPU miner — contributes to Irium network security and earns block rewards.
          </p>
        </div>

        {/* Status pill */}
        <div
          className={`flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-medium ${
            running
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
              : "border-slate-600/40 bg-slate-700/20 text-slate-400"
          }`}
        >
          <span className={`dot-${running ? "live" : "offline"}`} />
          {running ? "Mining" : "Stopped"}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="card border-rose-500/30 bg-rose-500/5 p-4 flex items-start gap-3 text-rose-400 text-sm">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Hashrate"
          value={
            hashrate >= 1000
              ? `${(hashrate / 1000).toFixed(2)} MH/s`
              : `${hashrate.toFixed(1)} KH/s`
          }
          icon={Zap}
          accent={running}
        />
        <StatCard
          label="Blocks Found"
          value={String(blocksFound)}
          sub={`Lifetime total`}
          icon={Hash}
        />
        <StatCard
          label="Difficulty"
          value={difficulty > 0 ? difficulty.toExponential(2) : "—"}
          icon={TrendingUp}
        />
        <StatCard
          label="Uptime"
          value={running ? formatUptime(uptimeSecs) : "—"}
          sub={running ? `${activeThreads} threads` : ""}
          icon={Cpu}
        />
      </div>

      {/* Config card */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <Settings2 size={16} className="text-irium-400" />
          Mining Configuration
        </div>

        {/* Address input */}
        <div>
          <label className="block text-xs text-slate-500 mb-1.5">
            Mining reward address
          </label>
          <div className="relative">
            <input
              type="text"
              value={miningAddr}
              onChange={(e) => setMiningAddr(e.target.value)}
              placeholder="Q-prefix address to receive block rewards…"
              className="input w-full font-mono text-sm pr-10"
              disabled={running}
            />
            {addresses.length > 0 && !running && (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                onClick={() => setShowAddrPicker(!showAddrPicker)}
              >
                {showAddrPicker ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </button>
            )}
          </div>

          {/* Address picker dropdown */}
          {showAddrPicker && addresses.length > 0 && (
            <div className="mt-1 card p-1 space-y-0.5 max-h-40 overflow-y-auto">
              {addresses.map((a) => (
                <button
                  key={a.address}
                  className="w-full text-left px-3 py-2 rounded text-xs font-mono text-slate-300 hover:bg-white/5 hover:text-white"
                  onClick={() => {
                    setMiningAddr(a.address);
                    setShowAddrPicker(false);
                  }}
                >
                  {a.address}
                  {a.balance !== undefined && (
                    <span className="ml-2 text-slate-500">
                      {(a.balance / 1e8).toFixed(4)} IRM
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Thread slider */}
        <div>
          <label className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span>CPU Threads</span>
            <span className="font-mono text-white">{threads}</span>
          </label>
          <input
            type="range"
            min={1}
            max={Math.max(8, navigator.hardwareConcurrency ?? 8)}
            value={threads}
            onChange={(e) => setThreads(Number(e.target.value))}
            disabled={running}
            className="w-full accent-irium-500"
          />
          <div className="flex justify-between text-xs text-slate-600 mt-1">
            <span>1</span>
            <span>{Math.max(8, navigator.hardwareConcurrency ?? 8)}</span>
          </div>
          <p className="text-xs text-slate-500 mt-1.5">
            {navigator.hardwareConcurrency ?? "?"} logical cores detected.
            Using all cores reduces CPU headroom for other tasks.
          </p>
        </div>

        {/* Warning */}
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-amber-400 text-xs">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Mining is computationally intensive and will increase CPU temperature.
            Ensure adequate cooling before running with high thread counts.
          </span>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3">
          {!running ? (
            <button
              onClick={handleStart}
              disabled={loading || !miningAddr.trim()}
              className="btn-primary flex items-center gap-2 px-6 py-2.5 text-sm disabled:opacity-50"
            >
              <Play size={16} />
              {loading ? "Starting…" : "Start Mining"}
            </button>
          ) : (
            <button
              onClick={handleStop}
              disabled={loading}
              className="flex items-center gap-2 px-6 py-2.5 text-sm rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition disabled:opacity-50"
            >
              <Square size={16} />
              {loading ? "Stopping…" : "Stop Mining"}
            </button>
          )}
          <button
            onClick={pollStatus}
            className="btn-secondary flex items-center gap-2 px-4 py-2.5 text-sm"
          >
            <RefreshCw size={15} />
            Refresh
          </button>
        </div>
      </div>

      {/* Info card */}
      <div className="card p-5 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <Server size={16} className="text-irium-400" />
          Network Mining Info
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div className="flex justify-between text-slate-500 col-span-2 sm:col-span-1">
            <span>Algorithm</span>
            <span className="font-mono text-white">SHA-256d</span>
          </div>
          <div className="flex justify-between text-slate-500 col-span-2 sm:col-span-1">
            <span>Block reward</span>
            <span className="font-mono text-white">Era-based (halving)</span>
          </div>
          <div className="flex justify-between text-slate-500 col-span-2 sm:col-span-1">
            <span>P2P port</span>
            <span className="font-mono text-white">38291</span>
          </div>
          <div className="flex justify-between text-slate-500 col-span-2 sm:col-span-1">
            <span>AuxPoW merge mining</span>
            <span className="font-mono text-emerald-400">Activating @ 26,347</span>
          </div>
        </div>
      </div>

      {/* Log panel */}
      <div className="card overflow-hidden">
        <button
          className="w-full flex items-center justify-between p-4 text-left hover:bg-white/3 transition"
          onClick={() => setShowLogs(!showLogs)}
        >
          <span className="text-sm font-semibold text-white flex items-center gap-2">
            <span className="font-mono text-xs px-1.5 py-0.5 bg-slate-700 rounded text-slate-400">
              {logs.length}
            </span>
            Miner Log
          </span>
          {showLogs ? (
            <ChevronUp size={15} className="text-slate-500" />
          ) : (
            <ChevronDown size={15} className="text-slate-500" />
          )}
        </button>

        {showLogs && (
          <div
            ref={logsRef}
            className="border-t border-white/5 bg-black/30 p-3 max-h-56 overflow-y-auto font-mono text-xs space-y-0.5"
          >
            {logs.length === 0 ? (
              <p className="text-slate-600">No log entries yet.</p>
            ) : (
              logs.map((l, i) => (
                <p key={i} className="text-slate-400 leading-relaxed">
                  {l}
                </p>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
