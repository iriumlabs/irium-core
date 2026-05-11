import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Cpu, Play, Square, RefreshCw, ArrowRight,
  Monitor, Wifi, WifiOff, Activity, Zap,
  ChevronDown, Server, Hash, Clock, Target,
  Thermometer, Fan, Gauge,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import toast from 'react-hot-toast';
import { miner, gpuMiner, stratum } from '../lib/tauri';
import type { MinerStatus, GpuDevice, GpuMinerStatus, StratumStatus } from '../lib/types';
import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';

function formatUptime(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

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

// ── CPU MINER TAB ─────────────────────────────────────────────

function CpuMinerTab() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<MinerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [startLoading, setStartLoading] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [address, setAddress] = useState('');
  const [threads, setThreads] = useState(2);
  const [history, setHistory] = useState<{ t: number; khs: number }[]>([]);
  const maxThreads = navigator.hardwareConcurrency ?? 8;

  useEffect(() => {
    const load = async () => {
      try {
        const s = await miner.status();
        setStatus(s);
        if (s.running) {
          setHistory(prev => [...prev, { t: Date.now(), khs: s.hashrate_khs + Math.random() * 20 - 10 }].slice(-40));
        }
      } catch { /* ignore */ }
      setLoading(false);
    };
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  const handleStart = async () => {
    if (!address.trim()) { toast.error('Mining address required'); return; }
    setStartLoading(true);
    try {
      await miner.start(address.trim(), threads);
      toast.success('CPU miner started');
      setStatus(await miner.status());
    } catch (e) { toast.error(String(e)); }
    finally { setStartLoading(false); }
  };

  const handleStop = async () => {
    setShowStopConfirm(false);
    try {
      await miner.stop();
      toast.success('Miner stopped');
      setStatus(await miner.status());
      setHistory([]);
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
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <span className={loading ? 'dot-offline' : status?.running ? 'dot-live' : 'dot-offline'} />
              <span className="font-display font-semibold text-sm" style={{ color: status?.running ? '#34d399' : 'rgba(238,240,255,0.35)' }}>
                {loading ? 'Loading…' : status?.running ? 'Mining Active' : 'CPU Idle'}
              </span>
              {status?.running && (
                <span className="badge badge-irium">{status.hashrate_khs.toFixed(1)} KH/s</span>
              )}
            </div>
            {status?.address && (
              <span className="text-xs font-mono opacity-40 truncate max-w-[160px]" style={{ fontFamily: '"JetBrains Mono", monospace' }}>
                {status.address.slice(0, 12)}…
              </span>
            )}
          </div>

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
        <StatCard label="Difficulty"   value={(status?.difficulty ?? 0).toLocaleString()} color="#fbbf24" icon={Target} />
      </div>

      {/* Config */}
      <div className="card p-5 space-y-4">
        <h3 className="font-display font-semibold text-sm" style={{ color: 'var(--t1)' }}>Configuration</h3>

        <div>
          <label className="label">Mining Address</label>
          <input value={address} onChange={e => setAddress(e.target.value)} placeholder="P…" className="input" />
          <button onClick={() => navigate('/wallet')} className="mt-1.5 flex items-center gap-1 text-xs transition-colors" style={{ color: '#6ec6ff' }}>
            View wallet <ArrowRight size={11} />
          </button>
        </div>

        <div>
          <label className="label">Threads — {threads} of {maxThreads} cores</label>
          <input
            type="range" min={1} max={maxThreads} value={threads}
            onChange={e => setThreads(parseInt(e.target.value))}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer mt-1"
            style={{ background: `linear-gradient(to right, #3b3bff 0%, #6ec6ff 50%, #a78bfa ${(threads / maxThreads) * 100}%, rgba(255,255,255,0.08) ${(threads / maxThreads) * 100}%, rgba(255,255,255,0.08) 100%)` }}
          />
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
  const [status, setStatus] = useState<GpuMinerStatus | null>(null);
  const [devices, setDevices] = useState<GpuDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [startLoading, setStartLoading] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [address, setAddress] = useState('');
  const [deviceIndex, setDeviceIndex] = useState(0);
  const [intensity, setIntensity] = useState(80);
  const [history, setHistory] = useState<{ t: number; khs: number }[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const [s, devs] = await Promise.all([gpuMiner.status(), gpuMiner.listDevices()]);
        setStatus(s);
        setDevices(devs);
        if (s.running) {
          setHistory(prev => [...prev, { t: Date.now(), khs: s.hashrate_khs + Math.random() * 50 - 25 }].slice(-40));
        }
      } catch { /* ignore */ }
      setLoading(false);
    };
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  const handleStart = async () => {
    if (!address.trim()) { toast.error('Mining address required'); return; }
    setStartLoading(true);
    try {
      await gpuMiner.start(address.trim(), deviceIndex, intensity);
      toast.success('GPU miner started');
      setStatus(await gpuMiner.status());
    } catch (e) { toast.error(String(e)); }
    finally { setStartLoading(false); }
  };

  const handleStop = async () => {
    setShowStopConfirm(false);
    try {
      await gpuMiner.stop();
      toast.success('GPU miner stopped');
      setStatus(await gpuMiner.status());
      setHistory([]);
    } catch (e) { toast.error(String(e)); }
  };

  const selectedDevice = devices[deviceIndex];

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
                <p className="text-sm" style={{ color: 'rgba(238,240,255,0.35)' }}>
                  {devices.length === 0 ? 'No compatible GPU detected' : 'Select a GPU device and start mining'}
                </p>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Hashrate"      value={status?.running ? `${status.hashrate_khs.toFixed(1)} KH/s` : '0 KH/s'} color="#60a5fa" icon={Activity} />
        <StatCard label="Temperature"   value={status?.running && status.temperature_c ? `${status.temperature_c}°C` : '—'} color={status?.running && (status.temperature_c ?? 0) > 80 ? '#f87171' : '#fbbf24'} icon={Thermometer} />
        <StatCard label="Power"         value={status?.running && status.power_w ? `${status.power_w}W` : '—'} color="#a78bfa" icon={Zap} />
        <StatCard label="Blocks Found"  value={String(status?.blocks_found ?? 0)} color="#34d399" icon={Hash} />
      </div>

      {/* Config */}
      <div className="card p-5 space-y-4">
        <h3 className="font-display font-semibold text-sm" style={{ color: 'var(--t1)' }}>Configuration</h3>

        {/* GPU selector */}
        <div>
          <label className="label">GPU Device</label>
          {devices.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', color: 'var(--t3)' }}>
              <Monitor size={14} /> No GPU detected — requires OpenCL / CUDA driver
            </div>
          ) : (
            <div className="relative">
              <select
                value={deviceIndex}
                onChange={e => setDeviceIndex(parseInt(e.target.value))}
                className="input appearance-none pr-8 cursor-pointer"
              >
                {devices.map(d => (
                  <option key={d.index} value={d.index}>{d.name} ({(d.vram_mb / 1024).toFixed(0)} GB VRAM)</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--t3)' }} />
            </div>
          )}
          {selectedDevice && (
            <p className="text-xs mt-1" style={{ fontFamily: '"JetBrains Mono", monospace', color: 'var(--t3)' }}>
              {selectedDevice.vendor} · {(selectedDevice.vram_mb / 1024).toFixed(0)} GB VRAM
            </p>
          )}
        </div>

        {/* Address */}
        <div>
          <label className="label">Mining Address</label>
          <input value={address} onChange={e => setAddress(e.target.value)} placeholder="P…" className="input" />
          <button onClick={() => navigate('/wallet')} className="mt-1.5 flex items-center gap-1 text-xs transition-colors" style={{ color: '#6ec6ff' }}>
            View wallet <ArrowRight size={11} />
          </button>
        </div>

        {/* Intensity */}
        <div>
          <label className="label">Intensity — {intensity}%</label>
          <input
            type="range" min={10} max={100} step={5} value={intensity}
            onChange={e => setIntensity(parseInt(e.target.value))}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer mt-1"
            style={{ background: `linear-gradient(to right, #3B82F6 0%, #06B6D4 ${intensity}%, rgba(255,255,255,0.08) ${intensity}%, rgba(255,255,255,0.08) 100%)` }}
          />
          <p className="text-xs mt-1" style={{ color: 'var(--t3)' }}>Higher intensity = more hashrate, more power usage</p>
        </div>

        <div className="flex items-center gap-3 pt-1">
          {!status?.running ? (
            <button onClick={handleStart} disabled={startLoading || !address.trim() || devices.length === 0} className="btn-primary"
              style={{ background: 'linear-gradient(135deg, #3B82F6 0%, #06B6D4 100%)', boxShadow: '0 4px 16px rgba(59,130,246,0.35)' }}>
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
  const [status, setStatus] = useState<StratumStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectLoading, setConnectLoading] = useState(false);
  const [poolUrl, setPoolUrl] = useState('stratum+tcp://irium.f2pool.com:3333');
  const [worker, setWorker] = useState('');
  const [password, setPassword] = useState('x');
  const [selectedPreset, setSelectedPreset] = useState(0);

  useEffect(() => {
    const load = async () => {
      try { setStatus(await stratum.status()); } catch { /* ignore */ }
      setLoading(false);
    };
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  const handleConnect = async () => {
    if (!poolUrl.trim()) { toast.error('Pool URL required'); return; }
    if (!worker.trim()) { toast.error('Worker name required'); return; }
    setConnectLoading(true);
    try {
      await stratum.connect(poolUrl.trim(), worker.trim(), password || 'x');
      toast.success('Connecting to pool…');
      setTimeout(async () => { setStatus(await stratum.status()); }, 1500);
    } catch (e) { toast.error(String(e)); }
    finally { setConnectLoading(false); }
  };

  const handleDisconnect = async () => {
    try {
      await stratum.disconnect();
      toast.success('Disconnected from pool');
      setStatus(await stratum.status());
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
          <p className="text-xs mt-1" style={{ color: 'var(--t3)' }}>Format: your_wallet_address.worker_id (e.g. Q8Ni6TJ…La.rig1)</p>
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
            <button onClick={handleDisconnect}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-display font-semibold transition-all"
              style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.22)', color: '#f87171' }}>
              <WifiOff size={13} /> Disconnect
            </button>
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
