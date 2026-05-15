import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Cpu, Play, Square, RefreshCw, ArrowRight,
  Monitor, Wifi, WifiOff, Activity, Zap,
  ChevronDown, Server, Hash, Clock, Target,
  Thermometer, Fan, Gauge, Copy, ExternalLink,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import toast from 'react-hot-toast';
import { fetch as tauriFetch, ResponseType } from '@tauri-apps/api/http';
import { miner, gpuMiner, stratum } from '../lib/tauri';
import { useStore } from '../lib/store';
import type { LucideIcon } from 'lucide-react';
import type { FoundBlock, GpuPlatform } from '../lib/types';
import NodeOfflineBanner from '../components/NodeOfflineBanner';
import clsx from 'clsx';

function formatUptime(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

function truncateHash(h: string): string {
  return h.length > 16 ? `${h.slice(0, 8)}...${h.slice(-8)}` : h;
}

function formatBlockAge(secs: number): string {
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s ago`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m ago`;
}

// Shape of iriumd's /network-status response. Verified against upstream
// iriumlabs/irium main: height + tip_hash + difficulty + age in one call.
// Older nodes (e.g. some seed VPS builds) lack this route — fetch errors are
// swallowed by the poller so the rest of the page stays functional.
type NetInfo = {
  height: number;
  tip_hash: string;
  difficulty: number;
  seconds_since_last_block: number | null;
};

function StatCard({ label, value, color, icon: Icon }: {
  label: string;
  value: string;
  color: string;
  icon?: LucideIcon;
}) {
  return (
    <motion.div
      className="card p-4 flex flex-col gap-1.5"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="flex items-center gap-1.5">
        {Icon && <Icon size={11} className="opacity-50" color={color} />}
        <span className="label mb-0 text-[10px]">{label}</span>
      </div>
      <span className="font-mono font-semibold text-base" style={{ color, fontFamily: '"JetBrains Mono", monospace' }}>
        {value}
      </span>
    </motion.div>
  );
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ value: number }> }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'rgba(10,13,28,0.95)',
      border: '1px solid rgba(110,198,255,0.25)',
      borderRadius: 8,
      fontSize: 11,
      padding: '4px 10px',
      color: '#A78BFA',
      fontFamily: '"JetBrains Mono", monospace',
    }}>
      {payload[0].value.toFixed(1)} KH/s
    </div>
  );
}

// ── Found Blocks list (Bug 1) ─────────────────────────────────
// Polls the Rust shell every 10s for the list of blocks this app
// session's CPU/GPU miner has had accepted. Newest first. Empty until
// the parser in main.rs records a [✅] Block accepted... line.
// Rows are clickable: a row click navigates to /explorer with
// location.state.openBlockHeight, which opens BlockDetailModal on the
// Explorer page (see Explorer.tsx Option C deep-link useEffect).
function FoundBlocksList() {
  const navigate = useNavigate();
  const [blocks, setBlocks] = useState<FoundBlock[]>([]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const r = await miner.getFoundBlocks();
        if (mounted) setBlocks(r.slice().reverse());
      } catch { /* tolerate offline backend — keep last view */ }
    };
    load();
    const id = setInterval(load, 10_000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  return (
    <div className="card p-5">
      <h3 className="font-display font-semibold text-sm mb-3" style={{ color: 'var(--t1)' }}>
        Found Blocks
      </h3>
      {blocks.length === 0 ? (
        <p className="text-xs py-2" style={{ color: 'rgba(238,240,255,0.40)' }}>
          No blocks found yet in this session.
        </p>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
          {blocks.map((b, i) => {
            const ageSecs = Math.max(0, Math.floor(Date.now() / 1000) - b.timestamp);
            const reward = b.reward_sats > 0 ? `${(b.reward_sats / 100_000_000).toFixed(4)} IRM` : '—';
            return (
              <div
                key={`${b.height}-${i}`}
                onClick={() => navigate('/explorer', {
                  state: {
                    openBlockHeight: b.height,
                    openBlockData: {
                      height:       b.height,
                      hash:         b.hash,
                      prev_hash:    b.prev_hash,
                      merkle_root:  b.merkle_root,
                      time:         b.timestamp,
                      tx_count:     0,
                      bits:         b.bits || undefined,
                      nonce:        b.nonce || undefined,
                      miner_address: undefined,
                    },
                  },
                })}
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-xs cursor-pointer hover:bg-white/5 transition-colors"
                style={{ background: 'rgba(110,198,255,0.04)', border: '1px solid rgba(110,198,255,0.10)' }}
                title="Open this block in the Explorer"
              >
                <span
                  className="font-mono font-semibold flex-shrink-0"
                  style={{ color: '#34d399', fontFamily: '"JetBrains Mono", monospace' }}
                  title={`Block height ${b.height}`}
                >
                  #{b.height.toLocaleString()}
                </span>
                <span
                  className="font-mono truncate flex-1"
                  style={{ color: 'rgba(238,240,255,0.55)', fontFamily: '"JetBrains Mono", monospace' }}
                  title={b.hash || 'hash unavailable from this miner build'}
                >
                  {b.hash ? truncateHash(b.hash) : '—'}
                </span>
                <span
                  className="font-mono flex-shrink-0"
                  style={{ color: 'rgba(238,240,255,0.40)', fontFamily: '"JetBrains Mono", monospace' }}
                >
                  {formatBlockAge(ageSecs)}
                </span>
                <span
                  className="font-mono flex-shrink-0"
                  style={{ color: 'rgba(238,240,255,0.55)', fontFamily: '"JetBrains Mono", monospace' }}
                  title={b.reward_sats > 0 ? undefined : 'Reward unknown — miner stdout does not report it'}
                >
                  {reward}
                </span>
                <ExternalLink
                  size={11}
                  className="flex-shrink-0"
                  style={{ color: 'rgba(110,198,255,0.45)' }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── CPU MINER TAB ─────────────────────────────────────────────

function CpuMinerTab() {
  const navigate = useNavigate();
  // Status, history, and core count come from the global store so navigating
  // away and back doesn't reset the hashrate chart or status badges. The
  // 3-second poll lives in useNodePoller and runs regardless of which page
  // is mounted.
  const status = useStore((s) => s.minerStatus);
  const history = useStore((s) => s.minerHistory);
  const cpuCores = useStore((s) => s.cpuCores);
  const resetMinerHistory = useStore((s) => s.resetMinerHistory);
  const rpcUrl = useStore((s) => s.settings.rpc_url);

  // Network snapshot used by the block-info strip and the Difficulty stat.
  // Cleared when mining stops so a stopped-then-restarted session never
  // shows stale numbers from the previous run.
  const [netInfo, setNetInfo] = useState<NetInfo | null>(null);

  const [startLoading, setStartLoading] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [address, setAddress] = useState('');
  // Default threads to half of detected cores (rounded down, min 1) the first
  // time we learn the core count. After that the user owns the slider value.
  const maxThreads = cpuCores ?? navigator.hardwareConcurrency ?? 8;
  const [threads, setThreads] = useState(() => Math.max(1, Math.floor(maxThreads / 2)));
  const [threadsTouched, setThreadsTouched] = useState(false);
  useEffect(() => {
    if (!threadsTouched && cpuCores && !status?.running) {
      setThreads(Math.max(1, Math.floor(cpuCores / 2)));
    }
  }, [cpuCores, threadsTouched, status?.running]);

  // When running, show the thread count the miner binary actually reported.
  // This survives tab switches that would otherwise reset local `threads` state.
  const displayThreads = (status?.running && status.threads) ? status.threads : threads;

  // Poll iriumd /network-status every 3s while mining is active. Uses Tauri's
  // HTTP API (allowlist.http scope) so the request bypasses the renderer CSP
  // and iriumd's CORS-off default. Stops cleanly when mining stops or the
  // component unmounts.
  useEffect(() => {
    if (!status?.running) { setNetInfo(null); return; }
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await tauriFetch<NetInfo>(`${rpcUrl}/network-status`, {
          method: 'GET',
          timeout: 3,
          responseType: ResponseType.JSON,
        });
        if (!cancelled && r.ok) setNetInfo(r.data);
      } catch { /* tolerate transient RPC misses — keep last good value */ }
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [status?.running, rpcUrl]);

  // Loading is only true on the very first poll (status === null). Once a
  // value lands in the store, subsequent visits get instant render.
  const loading = status === null;

  const handleStart = async () => {
    if (!address.trim()) { toast.error('Mining address required'); return; }
    setStartLoading(true);
    try {
      await miner.start(address.trim(), threads);
      toast.success('CPU miner started');
    } catch (e) { toast.error(String(e)); }
    finally { setStartLoading(false); }
  };

  const handleStop = async () => {
    setShowStopConfirm(false);
    try {
      await miner.stop();
      toast.success('Miner stopped');
      resetMinerHistory();
    } catch (e) { toast.error(String(e)); }
  };

  return (
    <div className="space-y-4">
      {/* Hero status card */}
      <div className="card p-5 relative overflow-hidden" style={status?.running ? { boxShadow: '0 0 40px rgba(110,198,255,0.12), 0 4px 24px rgba(0,0,0,0.45)' } : {}}>
        {status?.running && (
          <div className="absolute inset-0 pointer-events-none" style={{
            background: 'radial-gradient(ellipse 70% 60% at 30% 50%, rgba(110,198,255,0.07) 0%, transparent 70%)',
          }} />
        )}
        <div className="relative z-10">
          {/* When the miner is running but hashrate is still 0, the sidecar
              is in its blockchain-sync phase. Show a distinct "Syncing
              blocks…" state so the user understands the 30–60 s delay
              between Start and first rate update. The store's
              minerStatus.sync_status carries the last [sync] line from
              irium-miner's stdout (e.g. "[sync] Miner downloading blocks
              1..21269 from node"); we surface that verbatim below. */}
          {(() => {
            const isSyncing = !!status?.running && status.hashrate_khs === 0;
            return (
              <>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <span className={loading ? 'dot-offline' : status?.running ? 'dot-live' : 'dot-offline'} />
                    <span className="font-display font-semibold text-sm" style={{ color: status?.running ? '#34d399' : 'rgba(238,240,255,0.35)' }}>
                      {loading
                        ? 'Loading…'
                        : status?.running
                          ? (isSyncing ? 'Mining Active — Syncing blocks…' : 'Mining Active')
                          : 'CPU Idle'}
                    </span>
                    {status?.running && !isSyncing && (
                      <span className="badge badge-irium">{status.hashrate_khs.toFixed(1)} KH/s</span>
                    )}
                    {isSyncing && (
                      <span className="badge badge-warning text-[10px]">Syncing</span>
                    )}
                  </div>
                </div>

                {status?.address && (
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-mono text-white/60 break-all" style={{ fontFamily: '"JetBrains Mono", monospace' }}>
                      {status.address}
                    </span>
                    <button
                      onClick={() => {
                        if (status?.address) {
                          navigator.clipboard.writeText(status.address);
                          toast.success('Address copied');
                        }
                      }}
                      className="text-white/40 hover:text-white/85 transition-colors flex-shrink-0"
                      title="Copy address"
                    >
                      <Copy size={12} />
                    </button>
                  </div>
                )}

                {/* Sync detail strip — appears between the status header
                    and the chart placeholder while the miner is still
                    catching up. Disappears the moment the first rate
                    update lands (sync_status is cleared by the backend). */}
                {isSyncing && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex items-start gap-2 px-3 py-2 mb-4 rounded-lg"
                    style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.18)' }}
                  >
                    <RefreshCw size={12} className="animate-spin flex-shrink-0 mt-0.5" style={{ color: '#fbbf24' }} />
                    <div className="text-xs leading-relaxed">
                      <p className="font-mono" style={{ color: 'rgba(238,240,255,0.65)' }}>
                        {status?.sync_status ?? 'Initializing miner…'}
                      </p>
                      <p className="mt-0.5" style={{ color: 'rgba(238,240,255,0.35)' }}>
                        Downloading blockchain data for the first time. This takes a few minutes on first run only — subsequent starts will be instant as blocks are cached locally.
                      </p>
                    </div>
                  </motion.div>
                )}
              </>
            );
          })()}

          {/* Block-info strip — visible whenever mining is active and a
              /network-status snapshot has landed. Independent of
              `history.length` so it appears the moment the miner starts,
              before the hashrate chart has any points.
              Structure: prominent "Mining block #N" statement on top with a
              hairline divider, then a 3-column grid of supporting stats. */}
          {status?.running && netInfo && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 rounded-xl px-4 py-3"
              style={{ background: 'rgba(110,198,255,0.04)', border: '1px solid rgba(110,198,255,0.12)' }}
            >
              {/* Top — single prominent statement */}
              <div className="flex items-center gap-2 pb-3 mb-3 border-b border-white/5">
                <Hash size={15} style={{ color: '#6ec6ff' }} className="opacity-80" />
                <span
                  className="font-mono font-bold text-base tracking-tight"
                  style={{ color: '#6ec6ff', fontFamily: '"JetBrains Mono", monospace' }}
                >
                  Mining block #{(netInfo.height + 1).toLocaleString()}
                </span>
              </div>

              {/* Bottom — 3-col supporting stats */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {/* Previous block — hash + copy + subtitle */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5">
                    <Hash size={11} color="#A78BFA" className="opacity-50" />
                    <span className="label mb-0 text-[10px]">Previous block</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-semibold text-sm" style={{ color: '#A78BFA', fontFamily: '"JetBrains Mono", monospace' }}>
                      {truncateHash(netInfo.tip_hash)}
                    </span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(netInfo.tip_hash);
                        toast.success('Tip hash copied');
                      }}
                      className="text-white/40 hover:text-white/85 transition-colors flex-shrink-0"
                      title="Copy full hash"
                    >
                      <Copy size={11} />
                    </button>
                  </div>
                  <span className="text-[10px] text-white/30">last confirmed block</span>
                </div>

                {/* Block time */}
                {netInfo.seconds_since_last_block != null && (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1.5">
                      <Clock size={11} color="#34d399" className="opacity-50" />
                      <span className="label mb-0 text-[10px]">Block time</span>
                    </div>
                    <span className="font-mono font-semibold text-base" style={{ color: '#34d399', fontFamily: '"JetBrains Mono", monospace' }}>
                      {formatBlockAge(netInfo.seconds_since_last_block)}
                    </span>
                  </div>
                )}

                {/* Network difficulty */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5">
                    <Target size={11} color="#fbbf24" className="opacity-50" />
                    <span className="label mb-0 text-[10px]">Network difficulty</span>
                  </div>
                  <span className="font-mono font-semibold text-base" style={{ color: '#fbbf24', fontFamily: '"JetBrains Mono", monospace' }}>
                    {netInfo.difficulty.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </motion.div>
          )}

          <AnimatePresence>
            {status?.running && history.length > 1 ? (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 120 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.35 }}
              >
                <ResponsiveContainer width="100%" height={120}>
                  <AreaChart data={history} margin={{ top: 4, right: 0, left: -30, bottom: 0 }}>
                    <defs>
                      <linearGradient id="cpuGrad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#6ec6ff" />
                        <stop offset="100%" stopColor="#3B82F6" />
                      </linearGradient>
                      <linearGradient id="cpuFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6ec6ff" stopOpacity={0.20} />
                        <stop offset="100%" stopColor="#6ec6ff" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="t" hide />
                    <YAxis hide />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="khs" stroke="url(#cpuGrad)" strokeWidth={2} fill="url(#cpuFill)" dot={false} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </motion.div>
            ) : !status?.running ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center py-6 gap-3"
              >
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(110,198,255,0.10)', border: '1px solid rgba(110,198,255,0.20)' }}>
                  <Cpu size={28} style={{ color: '#6ec6ff' }} />
                </div>
                <p className="text-sm" style={{ color: 'rgba(238,240,255,0.35)' }}>Configure your address below and start mining</p>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Hashrate"     value={status?.running ? `${status.hashrate_khs.toFixed(1)} KH/s` : '0 KH/s'} color="#A78BFA" icon={Activity} />
        <StatCard label="Blocks Found" value={String(status?.blocks_found ?? 0)} color="#34d399" icon={Hash} />
        <StatCard label="Uptime"       value={status?.uptime_secs ? formatUptime(status.uptime_secs) : '—'} color="#60a5fa" icon={Clock} />
        <StatCard label="Difficulty"   value={netInfo?.difficulty != null ? netInfo.difficulty.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'} color="#fbbf24" icon={Target} />
      </div>

      {/* Found Blocks list (Bug 1) */}
      <FoundBlocksList />

      {/* Config */}
      <div className="card p-5 space-y-4">
        <h3 className="font-display font-semibold text-sm" style={{ color: 'var(--t1)' }}>Configuration</h3>

        <div>
          <label className="label">Mining Address</label>
          <input
            value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder="Paste your Irium mining address (Q... or P...)"
            className="input"
          />
          <button onClick={() => navigate('/wallet')} className="mt-1.5 flex items-center gap-1 text-xs transition-colors" style={{ color: '#6ec6ff' }}>
            View wallet <ArrowRight size={11} />
          </button>
        </div>

        <div>
          <label className="label">Threads — {displayThreads} of {maxThreads} cores{status?.running ? ' (running)' : ''}</label>
          <input
            type="range" min={1} max={maxThreads} value={displayThreads}
            onChange={e => { setThreads(parseInt(e.target.value)); setThreadsTouched(true); }}
            disabled={!!status?.running}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer mt-1 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: `linear-gradient(to right, #3b3bff 0%, #6ec6ff 50%, #a78bfa ${(displayThreads / maxThreads) * 100}%, rgba(255,255,255,0.08) ${(displayThreads / maxThreads) * 100}%, rgba(255,255,255,0.08) 100%)` }}
          />
          {/* Per-core dot indicator: first `displayThreads` cores filled green to
              show active/running thread count; remaining cores stay dim. */}
          <div className="flex flex-wrap gap-1 mt-2.5">
            {Array.from({ length: maxThreads }).map((_, i) => {
              const active = i < displayThreads;
              return (
                <span
                  key={i}
                  className="w-2 h-2 rounded-full transition-colors duration-200"
                  style={{
                    background: active ? '#34d399' : 'rgba(238,240,255,0.08)',
                    boxShadow: active ? '0 0 6px rgba(52,211,153,0.55)' : 'none',
                  }}
                  title={active ? `Core ${i + 1} (active)` : `Core ${i + 1} (idle)`}
                />
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1">
          {!status?.running ? (
            <button onClick={handleStart} disabled={startLoading || !address.trim()} className="btn-primary">
              {startLoading ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} fill="currentColor" />}
              {startLoading ? 'Starting…' : 'Start Mining'}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowStopConfirm(true)}
                disabled={showStopConfirm}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-display font-semibold transition-all duration-200"
                style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.22)', color: '#f87171' }}
              >
                <Square size={13} fill="currentColor" /> Stop Mining
              </button>
              <AnimatePresence>
                {showStopConfirm && (
                  <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} className="flex items-center gap-1.5">
                    <span className="text-xs" style={{ color: 'var(--t3)' }}>Confirm stop?</span>
                    <button onClick={handleStop} className="btn-ghost text-xs py-1 px-2" style={{ color: '#f87171' }}>Yes</button>
                    <button onClick={() => setShowStopConfirm(false)} className="btn-ghost text-xs py-1 px-2">No</button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── GPU MINER TAB ─────────────────────────────────────────────

function GpuMinerTab() {
  const navigate = useNavigate();
  const status              = useStore((s) => s.gpuMinerStatus);
  const history             = useStore((s) => s.gpuMinerHistory);
  const resetGpuMinerHistory = useStore((s) => s.resetGpuMinerHistory);
  const gpuPlatforms        = useStore((s) => s.gpuPlatforms);
  const setGpuPlatforms     = useStore((s) => s.setGpuPlatforms);

  const [detecting, setDetecting]           = useState(false);
  const [showModal, setShowModal]           = useState(false);
  const [startLoading, setStartLoading]     = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [address, setAddress]               = useState('');
  const [selectedPlatformIdx, setSelectedPlatformIdx] = useState(0);
  const [selectedDeviceIdxs, setSelectedDeviceIdxs]   = useState<number[]>([]);
  const [intensity, setIntensity]           = useState(80);

  const loading = status === null;

  const handleDetect = async (openModal: boolean) => {
    setDetecting(true);
    try {
      const platforms = await gpuMiner.listPlatforms();
      setGpuPlatforms(platforms ?? []);
      if (openModal) setShowModal(true);
    } catch {
      setGpuPlatforms([]);
      if (openModal) toast.error('Failed to detect GPUs');
    } finally {
      setDetecting(false);
    }
  };

  // Scan once on mount if never detected.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (gpuPlatforms === null) handleDetect(false); }, []);

  // When platforms first load, auto-select the first discrete GPU platform.
  useEffect(() => {
    if (!gpuPlatforms || gpuPlatforms.length === 0) return;
    const discrete = gpuPlatforms.find((p) => p.is_discrete && p.devices.length > 0);
    const first    = gpuPlatforms.find((p) => p.devices.length > 0);
    const auto     = (discrete ?? first)?.index ?? 0;
    setSelectedPlatformIdx(auto);
  }, [gpuPlatforms]);

  // When platform changes, default all devices on that platform to selected.
  useEffect(() => {
    if (!gpuPlatforms) return;
    const plat = gpuPlatforms.find((p) => p.index === selectedPlatformIdx);
    setSelectedDeviceIdxs(plat ? plat.devices.map((d) => d.index) : []);
  }, [selectedPlatformIdx, gpuPlatforms]);

  const handleStart = async () => {
    if (!address.trim()) { toast.error('Mining address required'); return; }
    setStartLoading(true);
    try {
      const platformSel = (gpuPlatforms && gpuPlatforms.length > 0)
        ? String(selectedPlatformIdx)
        : undefined;
      await gpuMiner.start(address.trim(), platformSel, selectedDeviceIdxs);
      toast.success('GPU miner started');
    } catch (e) { toast.error(String(e)); }
    finally { setStartLoading(false); }
  };

  const handleStop = async () => {
    setShowStopConfirm(false);
    try {
      await gpuMiner.stop();
      toast.success('GPU miner stopped');
      resetGpuMinerHistory();
    } catch (e) { toast.error(String(e)); }
  };

  const toggleDevice = (idx: number) =>
    setSelectedDeviceIdxs((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
    );

  const selectedPlatform = gpuPlatforms?.find((p) => p.index === selectedPlatformIdx);
  const noGpuFound       = gpuPlatforms !== null && gpuPlatforms.length === 0;
  const hasPlatforms     = gpuPlatforms !== null && gpuPlatforms.length > 0;

  // Idle hero message: mirrors old behaviour — uses platform info when available.
  const idleMessage = gpuPlatforms === null
    ? 'Scanning for OpenCL devices…'
    : noGpuFound
    ? 'No compatible GPU detected — see Configuration below'
    : 'Select a platform and start mining';

  return (
    <div className="space-y-4">
      {/* Hero */}
      <div className="card p-5 relative overflow-hidden" style={status?.running ? { boxShadow: '0 0 40px rgba(59,130,246,0.12), 0 4px 24px rgba(0,0,0,0.45)' } : {}}>
        {status?.running && (
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 70% 60% at 70% 50%, rgba(59,130,246,0.07) 0%, transparent 70%)' }} />
        )}
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <span className={loading ? 'dot-offline' : status?.running ? 'dot-live' : 'dot-offline'} />
              <span className="font-display font-semibold text-sm" style={{ color: status?.running ? '#60a5fa' : 'rgba(238,240,255,0.35)' }}>
                {loading ? 'Loading…' : status?.running ? 'GPU Active' : 'GPU Idle'}
              </span>
              {status?.running && (
                <span className="badge badge-info">{status.hashrate_khs.toFixed(1)} KH/s</span>
              )}
            </div>
            {status?.running && status.device_name && (
              <span className="text-xs opacity-40 truncate max-w-[180px]" style={{ fontFamily: '"JetBrains Mono", monospace' }}>
                {status.device_name}
              </span>
            )}
          </div>

          <AnimatePresence>
            {status?.running && history.length > 1 ? (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 120 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.35 }}>
                <ResponsiveContainer width="100%" height={120}>
                  <AreaChart data={history} margin={{ top: 4, right: 0, left: -30, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gpuGrad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#3B82F6" />
                        <stop offset="100%" stopColor="#06B6D4" />
                      </linearGradient>
                      <linearGradient id="gpuFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.20} />
                        <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="t" hide />
                    <YAxis hide />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="khs" stroke="url(#gpuGrad)" strokeWidth={2} fill="url(#gpuFill)" dot={false} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </motion.div>
            ) : !status?.running ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center py-6 gap-3">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(59,130,246,0.10)', border: '1px solid rgba(59,130,246,0.20)' }}>
                  <Monitor size={28} style={{ color: '#60a5fa' }} />
                </div>
                <p className="text-sm" style={{ color: 'rgba(238,240,255,0.35)' }}>{idleMessage}</p>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Hashrate"     value={status?.running ? `${status.hashrate_khs.toFixed(1)} KH/s` : '0 KH/s'} color="#60a5fa" icon={Activity} />
        <StatCard label="Temperature"  value={status?.running && status.temperature_c ? `${status.temperature_c}°C` : '—'} color={status?.running && (status.temperature_c ?? 0) > 80 ? '#f87171' : '#fbbf24'} icon={Thermometer} />
        <StatCard label="Power"        value={status?.running && status.power_w ? `${status.power_w}W` : '—'} color="#a78bfa" icon={Zap} />
        <StatCard label="Blocks Found" value={String(status?.blocks_found ?? 0)} color="#34d399" icon={Hash} />
      </div>

      {/* Found Blocks list */}
      <FoundBlocksList />

      {/* Config */}
      <div className="card p-5 space-y-4">
        {/* Header row with Detect button */}
        <div className="flex items-center justify-between">
          <h3 className="font-display font-semibold text-sm" style={{ color: 'var(--t1)' }}>Configuration</h3>
          <button
            onClick={() => handleDetect(true)}
            disabled={detecting}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all disabled:opacity-50"
            style={{ background: 'rgba(59,130,246,0.10)', border: '1px solid rgba(59,130,246,0.25)', color: '#60a5fa' }}
          >
            {detecting
              ? <><RefreshCw size={12} className="animate-spin" /> Scanning…</>
              : <><Monitor size={12} /> Detect GPUs</>}
          </button>
        </div>

        {/* Platform / device section */}
        {gpuPlatforms === null ? (
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--t3)' }}>
            <RefreshCw size={11} className="animate-spin" /> Scanning for OpenCL devices…
          </div>
        ) : noGpuFound ? (
          /* ── Empty state ── */
          <div className="rounded-xl p-4 space-y-2.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)' }}>
            <div className="flex items-center gap-2">
              <Monitor size={16} style={{ color: 'var(--t3)' }} />
              <span className="text-sm font-display font-semibold" style={{ color: 'var(--t2)' }}>No compatible GPU detected</span>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--t3)' }}>
              GPU mining requires an OpenCL runtime. Install your GPU vendor's drivers
              (NVIDIA, AMD, or Intel OpenCL SDK) and click <strong>Detect GPUs</strong>.
            </p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--t3)' }}>
              Once enabled, the GPU miner supports both pool (Stratum) and solo (direct node RPC) mining.
            </p>
            <a
              href="https://github.com/iriumlabs/irium/blob/main/GPU-MINER.md"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs hover:underline"
              style={{ color: '#6ec6ff' }}
            >
              Read the GPU Miner docs <ExternalLink size={11} />
            </a>
          </div>
        ) : (
          <>
            {/* ── Platform dropdown ── */}
            <div>
              <label className="label">OpenCL Platform</label>
              <div className="relative">
                <select
                  value={selectedPlatformIdx}
                  onChange={(e) => setSelectedPlatformIdx(parseInt(e.target.value))}
                  className="input appearance-none pr-8 cursor-pointer"
                >
                  {gpuPlatforms.map((p) => (
                    <option key={p.index} value={p.index}>
                      {p.index}: {p.name}{p.is_discrete ? ' ★' : ''} ({p.devices.length} device{p.devices.length !== 1 ? 's' : ''})
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--t3)' }} />
              </div>
              {selectedPlatform?.is_discrete && (
                <p className="text-xs mt-1" style={{ color: '#34d399' }}>
                  ★ Discrete GPU — auto-selected
                </p>
              )}
            </div>

            {/* ── Device selection ── */}
            {selectedPlatform && selectedPlatform.devices.length > 1 ? (
              /* Multi-GPU: checkboxes */
              <div>
                <label className="label">Devices (multi-GPU)</label>
                <div className="space-y-2">
                  {selectedPlatform.devices.map((d) => {
                    const checked = selectedDeviceIdxs.includes(d.index);
                    return (
                      <label
                        key={d.index}
                        className="flex items-center gap-2.5 cursor-pointer rounded-lg px-3 py-2 transition-colors"
                        style={{
                          background: checked ? 'rgba(59,130,246,0.08)' : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${checked ? 'rgba(59,130,246,0.30)' : 'rgba(255,255,255,0.07)'}`,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleDevice(d.index)}
                          className="w-4 h-4 flex-shrink-0"
                          style={{ accentColor: '#3B82F6' }}
                        />
                        <span className="font-mono text-xs flex-shrink-0" style={{ color: 'var(--t3)' }}>#{d.index}</span>
                        <span className="text-sm" style={{ color: 'var(--t2)' }}>{d.name}</span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-xs mt-1.5" style={{ color: 'var(--t3)' }}>
                  {selectedDeviceIdxs.length === 0
                    ? 'No devices selected — miner will auto-select'
                    : `${selectedDeviceIdxs.length} of ${selectedPlatform.devices.length} device${selectedDeviceIdxs.length > 1 ? 's' : ''} selected`}
                </p>
              </div>
            ) : selectedPlatform?.devices.length === 1 ? (
              /* Single device: just show the name */
              <div>
                <label className="label">Device</label>
                <div
                  className="flex items-center gap-2 rounded-lg px-3 py-2"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  <span className="font-mono text-xs" style={{ color: 'var(--t3)' }}>#0</span>
                  <span className="text-sm" style={{ color: 'var(--t2)' }}>{selectedPlatform.devices[0].name}</span>
                </div>
              </div>
            ) : null}
          </>
        )}

        {/* Mining address */}
        <div>
          <label className="label">Mining Address</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="P…" className="input" />
          <button onClick={() => navigate('/wallet')} className="mt-1.5 flex items-center gap-1 text-xs transition-colors" style={{ color: '#6ec6ff' }}>
            View wallet <ArrowRight size={11} />
          </button>
        </div>

        {/* Intensity */}
        <div>
          <label className="label">Intensity — {intensity}%</label>
          <input
            type="range" min={10} max={100} step={5} value={intensity}
            onChange={(e) => setIntensity(parseInt(e.target.value))}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer mt-1"
            style={{ background: `linear-gradient(to right, #3B82F6 0%, #06B6D4 ${intensity}%, rgba(255,255,255,0.08) ${intensity}%, rgba(255,255,255,0.08) 100%)` }}
          />
          <p className="text-xs mt-1" style={{ color: 'var(--t3)' }}>Higher intensity = more hashrate, more power usage</p>
        </div>

        {/* Start / Stop */}
        <div className="flex items-center gap-3 pt-1">
          {!status?.running ? (
            <button
              onClick={handleStart}
              disabled={startLoading || !address.trim() || noGpuFound || gpuPlatforms === null}
              className="btn-primary"
              style={{ background: 'linear-gradient(135deg, #3B82F6 0%, #06B6D4 100%)', boxShadow: '0 4px 16px rgba(59,130,246,0.35)' }}
            >
              {startLoading ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} fill="currentColor" />}
              {startLoading ? 'Starting…' : 'Start GPU Mining'}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowStopConfirm(true)}
                disabled={showStopConfirm}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-display font-semibold transition-all"
                style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.22)', color: '#f87171' }}
              >
                <Square size={13} fill="currentColor" /> Stop GPU
              </button>
              <AnimatePresence>
                {showStopConfirm && (
                  <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} className="flex items-center gap-1.5">
                    <span className="text-xs" style={{ color: 'var(--t3)' }}>Confirm stop?</span>
                    <button onClick={handleStop} className="btn-ghost text-xs py-1 px-2" style={{ color: '#f87171' }}>Yes</button>
                    <button onClick={() => setShowStopConfirm(false)} className="btn-ghost text-xs py-1 px-2">No</button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* Detect GPUs modal */}
      <AnimatePresence>
        {showModal && gpuPlatforms && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(2,5,14,0.82)' }}
            onClick={() => setShowModal(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <motion.div
              className="card p-6 w-full max-w-md"
              onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.95, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display font-bold text-base" style={{ color: 'var(--t1)' }}>
                  OpenCL Hardware Detected
                </h3>
                <button
                  onClick={() => setShowModal(false)}
                  className="btn-ghost text-xs py-1 px-2"
                  style={{ color: 'var(--t3)' }}
                >
                  ✕ Close
                </button>
              </div>

              {gpuPlatforms.length === 0 ? (
                <div className="text-sm space-y-2" style={{ color: 'var(--t3)' }}>
                  <p>No OpenCL platforms found.</p>
                  <p className="text-xs">Install your GPU driver and the ICD loader, then click <strong>Detect GPUs</strong> again.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {gpuPlatforms.map((p) => (
                    <div
                      key={p.index}
                      className="rounded-xl p-3 space-y-2"
                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.07)', color: 'var(--t3)' }}>
                          Platform {p.index}
                        </span>
                        <span className="font-display font-semibold text-sm" style={{ color: 'var(--t1)' }}>{p.name}</span>
                        {p.is_discrete && (
                          <span className="text-xs px-1.5 py-0.5 rounded font-semibold" style={{ background: 'rgba(52,211,153,0.14)', color: '#34d399', border: '1px solid rgba(52,211,153,0.28)' }}>
                            discrete GPU
                          </span>
                        )}
                      </div>
                      <div className="pl-2 space-y-1 border-l" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                        {p.devices.map((d) => (
                          <div key={d.index} className="flex items-center gap-2 text-xs">
                            <span className="font-mono" style={{ color: 'var(--t3)' }}>Device {d.index}</span>
                            <span style={{ color: 'var(--t2)' }}>{d.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button
                className="btn-primary mt-5 w-full"
                onClick={() => setShowModal(false)}
              >
                Done
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── STRATUM POOL TAB ──────────────────────────────────────────

const PRESET_POOLS = [
  { name: 'F2Pool',   url: 'stratum+tcp://irium.f2pool.com:3333'   },
  { name: 'ViaBTC',  url: 'stratum+tcp://irium.viabtc.com:3333'   },
  { name: 'AntPool', url: 'stratum+tcp://irium.antpool.com:3333'  },
  { name: 'Custom',  url: ''                                        },
];

function StratumTab() {
  // Status comes from the global poll, so connection state survives nav.
  const status = useStore((s) => s.stratumStatus);

  const [connectLoading, setConnectLoading] = useState(false);
  const [poolUrl, setPoolUrl] = useState('stratum+tcp://irium.f2pool.com:3333');
  const [worker, setWorker] = useState('');
  const [password, setPassword] = useState('x');
  const [selectedPreset, setSelectedPreset] = useState(0);
  // Confirm flyout for Disconnect — mirrors the Stop Mining pattern on
  // the CPU/GPU tabs so dropping in-progress shares isn't a single click.
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  const loading = status === null;

  const handleConnect = async () => {
    if (!poolUrl.trim()) { toast.error('Pool URL required'); return; }
    if (!worker.trim()) { toast.error('Worker name required'); return; }
    setConnectLoading(true);
    try {
      await stratum.connect(poolUrl.trim(), worker.trim(), password || 'x');
      toast.success('Connecting to pool…');
    } catch (e) { toast.error(String(e)); }
    finally { setConnectLoading(false); }
  };

  const handleDisconnect = async () => {
    setShowDisconnectConfirm(false);
    try {
      await stratum.disconnect();
      toast.success('Disconnected from pool');
    } catch (e) { toast.error(String(e)); }
  };

  const shareRatio = status && (status.shares_accepted + status.shares_rejected) > 0
    ? ((status.shares_accepted / (status.shares_accepted + status.shares_rejected)) * 100).toFixed(1)
    : '—';

  return (
    <div className="space-y-4">
      {/* Hero */}
      <div className="card p-5 relative overflow-hidden" style={status?.connected ? { boxShadow: '0 0 40px rgba(16,185,129,0.10), 0 4px 24px rgba(0,0,0,0.45)' } : {}}>
        {status?.connected && (
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 70% 60% at 20% 50%, rgba(16,185,129,0.06) 0%, transparent 70%)' }} />
        )}
        <div className="relative z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {status?.connected
                ? <Wifi size={16} style={{ color: '#34d399' }} />
                : <WifiOff size={16} style={{ color: 'rgba(238,240,255,0.30)' }} />
              }
              <span className="font-display font-semibold text-sm" style={{ color: status?.connected ? '#34d399' : 'rgba(238,240,255,0.35)' }}>
                {loading ? 'Loading…' : status?.connected ? 'Pool Connected' : 'Pool Disconnected'}
              </span>
              {status?.connected && (
                <span className="badge badge-success">Live</span>
              )}
            </div>
            {status?.connected && status.pool_url && (
              <span className="text-xs opacity-40 truncate max-w-[200px]" style={{ fontFamily: '"JetBrains Mono", monospace' }}>
                {status.pool_url.replace('stratum+tcp://', '')}
              </span>
            )}
          </div>

          {status?.connected && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid grid-cols-4 gap-3 mt-5"
            >
              {[
                { label: 'Accepted', value: String(status.shares_accepted), color: '#34d399' },
                { label: 'Rejected', value: String(status.shares_rejected), color: '#f87171' },
                { label: 'Ratio',    value: `${shareRatio}%`,               color: '#A78BFA' },
                { label: 'Uptime',   value: status.uptime_secs ? formatUptime(status.uptime_secs) : '—', color: '#60a5fa' },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--t3)', fontFamily: '"JetBrains Mono", monospace' }}>{label}</span>
                  <span className="font-mono font-semibold text-base" style={{ color, fontFamily: '"JetBrains Mono", monospace' }}>{value}</span>
                </div>
              ))}
            </motion.div>
          )}

          {!status?.connected && (
            <div className="flex flex-col items-center py-6 gap-3">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.18)' }}>
                <Server size={28} style={{ color: '#34d399' }} />
              </div>
              <p className="text-sm" style={{ color: 'rgba(238,240,255,0.35)' }}>Connect your ASIC or GPU to a mining pool via Stratum</p>
            </div>
          )}
        </div>
      </div>

      {/* Pool diff & hashrate when connected */}
      {status?.connected && (
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Pool Difficulty" value={status.pool_diff ? status.pool_diff.toLocaleString() : '—'} color="#fbbf24" icon={Target} />
          <StatCard label="Pool Hashrate"   value={status.pool_hashrate_khs ? `${(status.pool_hashrate_khs / 1000).toFixed(1)} MH/s` : '—'} color="#A78BFA" icon={Gauge} />
        </div>
      )}

      {/* Config */}
      <div className="card p-5 space-y-4">
        <h3 className="font-display font-semibold text-sm" style={{ color: 'var(--t1)' }}>Pool Configuration</h3>

        {/* Preset buttons */}
        <div>
          <label className="label">Pool Preset</label>
          <div className="flex gap-2 flex-wrap">
            {PRESET_POOLS.map((p, i) => (
              <button
                key={p.name}
                onClick={() => {
                  setSelectedPreset(i);
                  if (p.url) setPoolUrl(p.url);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-display font-semibold transition-all duration-150"
                style={{
                  background: selectedPreset === i ? 'rgba(110,198,255,0.18)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${selectedPreset === i ? 'rgba(110,198,255,0.40)' : 'rgba(255,255,255,0.10)'}`,
                  color: selectedPreset === i ? '#A78BFA' : 'var(--t2)',
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        {/* Pool URL */}
        <div>
          <label className="label">Pool URL</label>
          <input value={poolUrl} onChange={e => { setPoolUrl(e.target.value); setSelectedPreset(3); }} placeholder="stratum+tcp://pool.example.com:3333" className="input" />
        </div>

        {/* Worker */}
        <div>
          <label className="label">Worker Name</label>
          <input value={worker} onChange={e => setWorker(e.target.value)} placeholder="walletAddress.workerName" className="input" />
          <p className="text-xs mt-1" style={{ color: 'var(--t3)' }}>Format: your_wallet_address.worker_id (e.g. Pxxx…xxxx.rig1)</p>
        </div>

        {/* Password */}
        <div>
          <label className="label">Worker Password</label>
          <input value={password} onChange={e => setPassword(e.target.value)} placeholder="x" className="input" />
          <p className="text-xs mt-1" style={{ color: 'var(--t3)' }}>Usually "x" for most pools</p>
        </div>

        <div className="flex items-center gap-3 pt-1">
          {!status?.connected ? (
            <button onClick={handleConnect} disabled={connectLoading || !poolUrl.trim() || !worker.trim()} className="btn-primary"
              style={{ background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)', boxShadow: '0 4px 16px rgba(16,185,129,0.30)' }}>
              {connectLoading ? <RefreshCw size={13} className="animate-spin" /> : <Wifi size={13} />}
              {connectLoading ? 'Connecting…' : 'Connect to Pool'}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowDisconnectConfirm(true)}
                disabled={showDisconnectConfirm}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-display font-semibold transition-all"
                style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.22)', color: '#f87171' }}
              >
                <WifiOff size={13} /> Disconnect
              </button>
              <AnimatePresence>
                {showDisconnectConfirm && (
                  <motion.div
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    className="flex items-center gap-1.5"
                  >
                    <span className="text-xs" style={{ color: 'var(--t3)' }}>Confirm disconnect?</span>
                    <button onClick={handleDisconnect} className="btn-ghost text-xs py-1 px-2" style={{ color: '#f87171' }}>Yes</button>
                    <button onClick={() => setShowDisconnectConfirm(false)} className="btn-ghost text-xs py-1 px-2">No</button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* Info banner */}
      <div className="card p-4 flex gap-3" style={{ borderColor: 'rgba(110,198,255,0.30)' }}>
        <Server size={16} style={{ color: '#6ec6ff', flexShrink: 0, marginTop: 1 }} />
        <div className="text-xs space-y-1" style={{ color: 'var(--t2)' }}>
          <p className="font-semibold font-display" style={{ color: '#6ec6ff' }}>ASIC &amp; External Miner Support</p>
          <p style={{ color: 'var(--t3)' }}>Point your ASIC miner or mining software to the Stratum proxy at <span className="font-mono" style={{ color: 'var(--t2)', fontFamily: '"JetBrains Mono", monospace' }}>127.0.0.1:4444</span> once connected to a pool.</p>
        </div>
      </div>
    </div>
  );
}

// ── PAGE ──────────────────────────────────────────────────────

const TABS = [
  { key: 'cpu',     label: 'CPU Miner',   icon: Cpu     },
  { key: 'gpu',     label: 'GPU Miner',   icon: Monitor },
  { key: 'stratum', label: 'ASIC / Pool', icon: Server  },
] as const;

type TabKey = typeof TABS[number]['key'];

export default function Miner() {
  const [activeTab, setActiveTab] = useState<TabKey>('cpu');

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="h-full overflow-y-auto"
    >
      <div className="w-full space-y-5 px-8 py-6">
      <NodeOfflineBanner />
      {/* Header */}
      <div>
        <h1 className="page-title">Miner</h1>
        <p className="page-subtitle">SHA-256d · CPU · GPU · ASIC pool support</p>
      </div>

      {/* Tabs */}
      <div
        className="flex gap-1 p-1 rounded-xl"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', width: 'fit-content' }}
      >
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-display font-semibold transition-all duration-200"
            style={activeTab === key ? {
              background: 'linear-gradient(135deg, rgba(110,198,255,0.25) 0%, rgba(59,130,246,0.15) 100%)',
              border: '1px solid rgba(110,198,255,0.35)',
              color: '#A78BFA',
              boxShadow: '0 2px 8px rgba(110,198,255,0.15)',
            } : {
              color: 'rgba(238,240,255,0.40)',
              border: '1px solid transparent',
            }}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
        >
          {activeTab === 'cpu'     && <CpuMinerTab />}
          {activeTab === 'gpu'     && <GpuMinerTab />}
          {activeTab === 'stratum' && <StratumTab />}
        </motion.div>
      </AnimatePresence>
      </div>
    </motion.div>
  );
}
