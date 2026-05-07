import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, Play, Square, RefreshCw } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import toast from 'react-hot-toast';
import { miner } from '../lib/tauri';
import type { MinerStatus } from '../lib/types';

// ── Helpers ────────────────────────────────────────────────────

function formatUptime(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

// ── Stat card ─────────────────────────────────────────────────

interface StatMeta {
  label: string;
  value: string;
  color: 'irium' | 'green' | 'blue' | 'amber';
}

function StatCard({ label, value, color }: StatMeta) {
  const colorMap: Record<StatMeta['color'], string> = {
    irium: 'text-irium-400',
    green: 'text-green-400',
    blue: 'text-blue-400',
    amber: 'text-amber-400',
  };

  return (
    <motion.div
      className="card p-4 flex flex-col gap-1"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      whileHover={{ scale: 1.02 }}
    >
      <span className="label mb-0">{label}</span>
      <span className={`font-mono font-semibold text-lg ${colorMap[color]}`}>
        {value}
      </span>
    </motion.div>
  );
}

// ── Custom tooltip ─────────────────────────────────────────────

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: '#0d0d1a',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 8,
        color: 'white',
        fontSize: 11,
        padding: '4px 8px',
      }}
    >
      {payload[0].value.toFixed(1)} KH/s
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────

export default function Miner() {
  const [minerStatus, setMinerStatus] = useState<MinerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [startLoading, setStartLoading] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [address, setAddress] = useState('');
  const [threads, setThreads] = useState(2);
  const maxThreads = 8;

  const [hashrateHistory, setHashrateHistory] = useState<
    { t: number; khs: number }[]
  >([]);

  // ── Polling ──────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const s = await miner.status();
        setMinerStatus(s);
        if (s.running) {
          setHashrateHistory(prev => {
            const next = [
              ...prev,
              {
                t: Date.now(),
                khs: s.hashrate_khs + Math.random() * 50 - 25,
              },
            ];
            return next.slice(-30);
          });
        }
      } catch {
        // silently ignore poll errors
      }
      setLoading(false);
    };
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, []);

  // ── Handlers ─────────────────────────────────────────────────
  const handleStart = async () => {
    if (!address.trim()) {
      toast.error('Mining address required');
      return;
    }
    setStartLoading(true);
    try {
      await miner.start(address.trim(), threads);
      toast.success('Miner started');
      const s = await miner.status();
      setMinerStatus(s);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setStartLoading(false);
    }
  };

  const handleStop = async () => {
    setShowStopConfirm(false);
    try {
      await miner.stop();
      toast.success('Miner stopped');
      const s = await miner.status();
      setMinerStatus(s);
      setHashrateHistory([]);
    } catch (e) {
      toast.error(String(e));
    }
  };

  // ── Stats data ───────────────────────────────────────────────
  const stats: StatMeta[] = [
    {
      label: 'Hashrate',
      value: minerStatus?.running
        ? `${minerStatus.hashrate_khs.toFixed(1)} KH/s`
        : '0 KH/s',
      color: 'irium',
    },
    {
      label: 'Blocks Found',
      value: String(minerStatus?.blocks_found ?? 0),
      color: 'green',
    },
    {
      label: 'Uptime',
      value: minerStatus?.uptime_secs
        ? formatUptime(minerStatus.uptime_secs)
        : '0s',
      color: 'blue',
    },
    {
      label: 'Difficulty',
      value: (minerStatus?.difficulty ?? 0).toLocaleString(),
      color: 'amber',
    },
  ];

  // ── Render ───────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="h-full overflow-y-auto p-6 space-y-5"
    >
      {/* Page title */}
      <div>
        <h1 className="font-display font-bold text-2xl gradient-text">
          Miner
        </h1>
        <p className="text-sm text-white/40 mt-1">
          SHA-256d CPU miner — earn block rewards while securing the Irium
          network.
        </p>
      </div>

      {/* Status Hero Card */}
      <div
        className={`card p-6 relative overflow-hidden transition-all duration-500 ${
          minerStatus?.running ? 'glow-purple' : ''
        }`}
      >
        {/* Ambient pulse when running */}
        {minerStatus?.running && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'radial-gradient(ellipse 60% 40% at 50% 50%, rgba(123,47,226,0.08) 0%, transparent 70%)',
              animation: 'pulse 3s ease-in-out infinite',
            }}
          />
        )}

        <div className="relative z-10">
          {/* Status indicator row */}
          <div className="flex items-center gap-2 mb-4">
            <span
              className={
                minerStatus?.running ? 'dot-live' : 'dot-offline'
              }
            />
            <span
              className={`font-display font-semibold ${
                minerStatus?.running ? 'text-green-400' : 'text-white/40'
              }`}
            >
              {loading
                ? 'Loading…'
                : minerStatus?.running
                ? 'Mining Active'
                : 'Miner Stopped'}
            </span>
            {minerStatus?.running && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="badge badge-success ml-2"
              >
                {minerStatus.hashrate_khs.toFixed(1)} KH/s
              </motion.span>
            )}
          </div>

          {/* Hashrate chart — only when running AND data available */}
          <AnimatePresence>
            {minerStatus?.running && hashrateHistory.length > 1 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 160 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.4 }}
              >
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart
                    data={hashrateHistory}
                    margin={{ top: 4, right: 4, left: -24, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient
                        id="lineGrad"
                        x1="0"
                        y1="0"
                        x2="1"
                        y2="0"
                      >
                        <stop offset="0%" stopColor="#7b2fe2" />
                        <stop offset="100%" stopColor="#2563eb" />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="t" hide />
                    <YAxis hide />
                    <Tooltip content={<CustomTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="khs"
                      stroke="url(#lineGrad)"
                      strokeWidth={2.5}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Idle state CTA */}
          {!minerStatus?.running && (
            <div className="flex flex-col items-center py-8 gap-4">
              <div className="w-16 h-16 rounded-2xl bg-irium-500/10 flex items-center justify-center">
                <Cpu size={32} className="text-irium-400" />
              </div>
              <div className="text-white/50 text-sm">
                Configure your address below and start mining
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Live stats — 4 cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stats.map(s => (
          <StatCard key={s.label} {...s} />
        ))}
      </div>

      {/* Configuration card */}
      <div className="card p-5 space-y-4">
        <h3 className="font-display font-semibold text-white/80">
          Configuration
        </h3>

        {/* Address input */}
        <div>
          <label className="label">Mining Address</label>
          <input
            value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder="P…"
            className="input font-mono text-sm"
          />
        </div>

        {/* Thread slider */}
        <div>
          <label className="label">Threads</label>
          <div className="relative pt-2">
            <input
              type="range"
              min={1}
              max={maxThreads}
              value={threads}
              onChange={e => setThreads(parseInt(e.target.value))}
              className="w-full h-2 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, #7b2fe2 0%, #2563eb ${
                  (threads / maxThreads) * 100
                }%, rgba(255,255,255,0.1) ${
                  (threads / maxThreads) * 100
                }%, rgba(255,255,255,0.1) 100%)`,
              }}
            />
          </div>
          <div className="text-xs text-white/40 mt-1.5">
            {threads} of {maxThreads} cores
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 pt-1">
          {!minerStatus?.running ? (
            /* Start button */
            <button
              onClick={handleStart}
              disabled={startLoading || !address.trim()}
              className="btn-primary gap-2"
            >
              <AnimatePresence mode="wait" initial={false}>
                {startLoading ? (
                  <motion.span
                    key="loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <RefreshCw size={14} className="animate-spin" />
                  </motion.span>
                ) : (
                  <motion.span
                    key="idle"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <Play size={14} fill="currentColor" />
                  </motion.span>
                )}
              </AnimatePresence>
              {startLoading ? 'Starting…' : 'Start Mining'}
            </button>
          ) : (
            /* Stop button with inline confirmation */
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowStopConfirm(true)}
                disabled={showStopConfirm}
                className="btn-secondary text-red-400 border-red-500/20 hover:bg-red-500/10"
              >
                <Square size={14} fill="currentColor" /> Stop Mining
              </button>

              <AnimatePresence>
                {showStopConfirm && (
                  <motion.div
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    className="flex items-center gap-2"
                  >
                    <span className="text-sm text-white/60">
                      Stop mining?
                    </span>
                    <button
                      onClick={handleStop}
                      className="btn-ghost text-red-400 text-xs py-1 px-2"
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setShowStopConfirm(false)}
                      className="btn-ghost text-xs py-1 px-2"
                    >
                      No
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
