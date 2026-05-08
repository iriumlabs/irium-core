import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useInView } from 'framer-motion';
import {
  TrendingUp,
  Activity,
  Users,
  ShieldCheck,
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  FileText,
  Package,
  Copy,
  ExternalLink,
  CheckCircle2,
  Circle,
  Loader2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import toast from 'react-hot-toast';
import { useStore } from '../lib/store';
import { wallet, agreements, node } from '../lib/tauri';
import { startAggressivePoll } from '../hooks/useNodePoller';
import { formatIRM, timeAgo, satsToIRM } from '../lib/types';
import type { Agreement, Transaction, AgreementStatus, PeerInfo } from '../lib/types';

// ── Operation banner ──────────────────────────────────────────
type OperationType = 'starting' | 'clearing';

const OPERATION_STEPS: Record<OperationType, { label: string; detail: string; ms: number }[]> = {
  starting: [
    { ms: 0,     label: 'Launching iriumd',     detail: 'Starting the node process' },
    { ms: 3000,  label: 'Loading chain data',    detail: 'Reading blocks from disk' },
    { ms: 7000,  label: 'Waiting for RPC',       detail: 'Binding HTTP port 38300' },
    { ms: 12000, label: 'Connecting to peers',   detail: 'Discovering network nodes' },
  ],
  clearing: [
    { ms: 0,    label: 'Stopping node',         detail: 'Shutting down iriumd gracefully' },
    { ms: 1800, label: 'Clearing chain state',  detail: 'Removing blocks and state data' },
    { ms: 3200, label: 'Refreshing bootstrap',  detail: 'Updating peer seed list' },
    { ms: 4200, label: 'Starting fresh node',   detail: 'Launching iriumd' },
    { ms: 7500, label: 'Connecting to peers',   detail: 'Discovering network nodes' },
  ],
};

function NodeOperationBanner({ type }: { type: OperationType }) {
  const [elapsed, setElapsed] = useState(0);
  const steps = OPERATION_STEPS[type];

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - start), 200);
    return () => clearInterval(id);
  }, []);

  const currentStepIdx = [...steps].reverse().findIndex((s) => elapsed >= s.ms);
  const activeIdx = currentStepIdx === -1 ? 0 : steps.length - 1 - currentStepIdx;
  const activeStep = steps[activeIdx];
  const dots = '.'.repeat(((elapsed / 500) | 0) % 4);
  const color = type === 'clearing' ? 'rgba(251,191,36,1)' : 'rgba(139,92,246,1)';
  const bgColor = type === 'clearing' ? 'rgba(251,191,36,0.07)' : 'rgba(99,102,241,0.07)';
  const borderColor = type === 'clearing' ? 'rgba(251,191,36,0.22)' : 'rgba(99,102,241,0.22)';

  return (
    <div className="rounded-xl p-4" style={{ background: bgColor, border: `1px solid ${borderColor}` }}>
      {/* Step dots */}
      <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1">
        {steps.map((step, i) => {
          const done = i < activeIdx;
          const active = i === activeIdx;
          return (
            <React.Fragment key={i}>
              {i > 0 && (
                <div
                  className="flex-1 h-px min-w-[12px] transition-all duration-500"
                  style={{ background: done ? color : 'rgba(255,255,255,0.10)' }}
                />
              )}
              <div className="flex flex-col items-center gap-1 flex-shrink-0">
                <div className="w-6 h-6 flex items-center justify-center">
                  {done ? (
                    <CheckCircle2 size={16} style={{ color }} />
                  ) : active ? (
                    <Loader2 size={16} className="animate-spin" style={{ color }} />
                  ) : (
                    <Circle size={16} style={{ color: 'rgba(255,255,255,0.15)' }} />
                  )}
                </div>
                <span
                  className="text-[9px] font-display font-semibold uppercase tracking-wide whitespace-nowrap"
                  style={{ color: done || active ? color : 'rgba(255,255,255,0.20)' }}
                >
                  {step.label.split(' ')[0]}
                </span>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* Current step info */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeIdx}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2 }}
          className="flex items-center gap-3"
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm font-display font-semibold" style={{ color }}>
              {activeStep.label}{dots}
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
              {activeStep.detail} · {(elapsed / 1000).toFixed(0)}s
            </p>
          </div>
          {/* Progress bar */}
          <div className="w-28 h-1 rounded-full overflow-hidden flex-shrink-0" style={{ background: 'rgba(255,255,255,0.08)' }}>
            <motion.div
              className="h-full rounded-full"
              style={{ background: color }}
              animate={{ width: `${Math.min(98, 5 + (elapsed / 200))}%` }}
              transition={{ duration: 0.5, ease: 'linear' }}
            />
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function anonymizePeer(p: PeerInfo, i: number) {
  const portMatch = p.multiaddr?.match(/\/tcp\/(\d+)/);
  const port = portMatch?.[1];
  const live = p.source === 'live' || p.dialable === true;
  const heightStr = p.height ? ` · #${p.height.toLocaleString()}` : '';
  return {
    label: `Peer ${i + 1}${port ? ` (port ${port})` : ''}`,
    live,
    heightStr,
    source: p.source ?? 'unknown',
  };
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

function useCountUp(target: number, duration = 1200, active = true): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!active || target === 0) { setCount(target); return; }
    let start = 0;
    const step = target / (duration / 16);
    const timer = setInterval(() => {
      start += step;
      if (start >= target) { setCount(target); clearInterval(timer); }
      else setCount(Math.floor(start));
    }, 16);
    return () => clearInterval(timer);
  }, [target, active]);
  return count;
}

function agreementBorderColor(status: AgreementStatus): string {
  if (status === 'funded') return 'border-irium-500';
  if (status === 'released') return 'border-green-500';
  if (status === 'refunded') return 'border-amber-500';
  return 'border-white/20';
}

export default function Dashboard() {
  const navigate = useNavigate();
  const nodeStatus = useStore((s) => s.nodeStatus);
  const setNodeStarting = useStore((s) => s.setNodeStarting);
  const balance = useStore((s) => s.balance);
  const addNotification = useStore((s) => s.addNotification);
  const peerList = useStore((s) => s.peerList);
  const heightLastChanged = useStore((s) => s.heightLastChanged);
  const [recentTx, setRecentTx] = useState<Transaction[]>([]);
  const [activeAgreements, setActiveAgreements] = useState<Agreement[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastTip, setLastTip] = useState<string>('');
  const [tickerGlow, setTickerGlow] = useState(false);
  const [operation, setOperation] = useState<OperationType | null>(null);

  const statsRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(statsRef, { once: true });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [txs, agrs] = await Promise.allSettled([
        wallet.transactions(10),
        agreements.list(),
      ]);
      if (txs.status === 'fulfilled') setRecentTx(txs.value);
      if (agrs.status === 'fulfilled')
        setActiveAgreements(agrs.value.filter((a) => a.status === 'funded' || a.status === 'open'));
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Safety valve: for 'starting', clear when node comes online; both types clear after 90s.
  // 'clearing' does NOT auto-clear on running because the node may still show running
  // from the previous poll while the kill is in-flight.
  useEffect(() => {
    if (!operation) return;
    if (operation === 'starting' && nodeStatus?.running) { setOperation(null); return; }
    const id = setTimeout(() => setOperation(null), 90_000);
    return () => clearTimeout(id);
  }, [operation, nodeStatus?.running]);

  useEffect(() => {
    const tip = nodeStatus?.tip ?? '';
    if (tip && tip !== lastTip && lastTip !== '') {
      setTickerGlow(true);
      const t = setTimeout(() => setTickerGlow(false), 1500);
      return () => clearTimeout(t);
    }
    if (tip) setLastTip(tip);
  }, [nodeStatus?.tip, lastTip]);

  const handleReconnect = async () => {
    setOperation('clearing');
    try {
      await node.clearState();
      addNotification({ type: 'info', title: 'State cleared', message: 'Restarting node from scratch…' });
      await new Promise((r) => setTimeout(r, 500));
      const result = await node.start();
      if (result.success) {
        setNodeStarting(true);
        setOperation('starting');
        addNotification({ type: 'info', title: 'Node restarting…', message: result.message });
        startAggressivePoll(15_000);
      } else {
        toast.error(result.message);
        setOperation(null);
      }
    } catch (e) {
      toast.error(String(e));
      setOperation(null);
    }
  };

  const handleStartNode = async () => {
    setOperation('starting');
    try {
      const result = await node.start();
      if (!result.success) {
        toast.error(result.message);
        addNotification({ type: 'error', title: 'Failed to start node', message: result.message });
        setOperation(null);
      } else {
        setNodeStarting(true);
        addNotification({ type: 'info', title: 'Node starting…', message: result.message });
        startAggressivePoll(15_000);
      }
    } catch (e) {
      const msg = String(e);
      toast.error(msg);
      addNotification({ type: 'error', title: 'Node start error', message: msg });
      setOperation(null);
    }
  };

  const chartData = recentTx.slice().reverse().map((tx, i) => ({
    i,
    label: tx.timestamp ? timeAgo(tx.timestamp) : String(i),
    val: Math.abs(satsToIRM(tx.amount)),
  }));

  const height = nodeStatus?.height ?? 0;
  const peers = nodeStatus?.peers ?? 0;
  const confirmedBalance = balance?.confirmed ?? 0;

  const balanceCount = useCountUp(confirmedBalance, 1200, isInView);
  const heightCount = useCountUp(height, 1200, isInView);
  const peersCount = useCountUp(peers, 1200, isInView);
  const agreementsCount = useCountUp(activeAgreements.length, 1200, isInView);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="h-full overflow-y-auto"
    >
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display font-bold text-2xl text-white">Dashboard</h1>
            <p className="text-white/40 text-sm mt-0.5">Irium blockchain overview</p>
          </div>
          <button onClick={loadData} className="btn-ghost" disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        <AnimatePresence mode="wait">
          {/* ── Operation in progress ─────────────────────────── */}
          {operation ? (
            <motion.div
              key="operation-banner"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden"
            >
              <NodeOperationBanner type={operation} />
            </motion.div>
          ) : !nodeStatus?.running ? (
            /* ── Node offline ─────────────────────────────────── */
            <motion.div
              key="offline-banner"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden"
            >
              <div className="flex items-center justify-between gap-4 rounded-xl border border-amber-500/20 bg-amber-500/08 px-5 py-4">
                <div>
                  <p className="text-sm font-display font-semibold text-amber-300">
                    iriumd is not running
                  </p>
                  <p className="text-xs text-amber-300/50 mt-0.5">
                    Start the node to sync with the Irium network.
                  </p>
                </div>
                <button
                  onClick={handleStartNode}
                  className="btn-primary flex-shrink-0 text-xs py-1.5 px-4"
                >
                  Start Node
                </button>
              </div>
            </motion.div>
          ) : nodeStatus.peers === 0 ? (
            /* ── Running but no peers ─────────────────────────── */
            <motion.div
              key="connecting-banner"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div
                className="flex items-center gap-3 rounded-xl px-4 py-3"
                style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.18)' }}
              >
                <span className="dot-syncing flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-xs font-semibold" style={{ color: '#a5b4fc' }}>
                    Searching for peers…
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'rgba(165,180,252,0.50)' }}>
                    Block #{nodeStatus.height.toLocaleString()} · iriumd is discovering the network. If stuck, try Clear & Restart.
                  </p>
                </div>
                <button
                  onClick={handleReconnect}
                  className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={{ background: 'rgba(99,102,241,0.18)', border: '1px solid rgba(99,102,241,0.30)', color: '#a5b4fc' }}
                >
                  <RefreshCw size={11} /> Clear &amp; Restart
                </button>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <AnimatePresence>
          <motion.div
            key="ticker"
            className={`rounded-xl px-5 py-3 flex items-center gap-3 bg-surface-800 border transition-all duration-300 ${
              tickerGlow ? 'border-irium-500/40 glow-purple' : 'border-white/[0.06]'
            }`}
          >
            {/* Status dot */}
            {!nodeStatus?.running
              ? <span className="w-2 h-2 rounded-full bg-white/20 flex-shrink-0" />
              : nodeStatus.peers === 0
              ? <span className="dot-syncing flex-shrink-0" />
              : nodeStatus.synced
              ? <span className="dot-live flex-shrink-0" />
              : <span className="dot-syncing flex-shrink-0" />
            }
            <span className="font-mono text-sm">
              <span className="text-white/40 text-xs mr-1">Block</span>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={nodeStatus?.height ?? 'none'}
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -10, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="font-bold text-white inline-block"
                >
                  #{nodeStatus?.height?.toLocaleString() ?? '—'}
                </motion.span>
              </AnimatePresence>
              {/* Show network tip when syncing behind */}
              {nodeStatus?.running && nodeStatus.network_tip > 0 && nodeStatus.height < nodeStatus.network_tip && (
                <span className="text-white/30 text-xs ml-1">
                  / {nodeStatus.network_tip.toLocaleString()}
                </span>
              )}
            </span>
            <span className="text-white/20">·</span>
            {/* Show sync/connect state instead of tip hash when not live */}
            {!nodeStatus?.running ? (
              <span className="text-white/30 text-xs">Node offline</span>
            ) : nodeStatus.peers === 0 ? (
              <span className="text-indigo-400/70 text-xs animate-pulse">Connecting to peers…</span>
            ) : !nodeStatus.synced ? (
              <span className="text-amber-400/70 text-xs">
                Syncing {nodeStatus.height.toLocaleString()} / {nodeStatus.network_tip.toLocaleString()}
              </span>
            ) : (
              <span className="font-mono text-xs text-white/35 truncate min-w-0">
                {nodeStatus.tip ? `${nodeStatus.tip.slice(0, 20)}…` : '—'}
              </span>
            )}
            <span className="text-white/20 hidden sm:block">·</span>
            <span className="text-white/35 text-xs hidden sm:block">{nodeStatus?.network ?? 'mainnet'}</span>
          </motion.div>
        </AnimatePresence>

        <div ref={statsRef} className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {loading ? (
            <>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="card p-4">
                  <div className="shimmer h-3 w-24 rounded mb-3" />
                  <div className="shimmer h-7 w-32 rounded mb-1" />
                  <div className="shimmer h-2 w-20 rounded" />
                </div>
              ))}
            </>
          ) : (
            <>
              <StatCard
                title="Confirmed Balance"
                value={formatIRM(balanceCount)}
                sub={
                  balance
                    ? balance.unconfirmed > 0
                      ? `+${formatIRM(balance.unconfirmed)} pending`
                      : 'All confirmed'
                    : 'Wallet not open'
                }
                icon={<TrendingUp size={18} />}
                color="irium"
              />
              <StatCard
                title="Block Height"
                value={heightCount.toLocaleString()}
                sub={
                  !nodeStatus?.running
                    ? 'Node offline'
                    : !nodeStatus.synced
                    ? `Syncing — ${nodeStatus.height.toLocaleString()} / ${nodeStatus.network_tip > 0 ? nodeStatus.network_tip.toLocaleString() : '?'}`
                    : heightLastChanged && (Date.now() - heightLastChanged) > 5 * 60 * 1000
                    ? `At tip · no new blocks (${Math.floor((Date.now() - heightLastChanged) / 60000)}m)`
                    : 'At chain tip'
                }
                icon={<Activity size={18} />}
                color="blue"
              />
              <StatCard
                title="Peers"
                value={String(peerList.length > 0 ? peerList.length : peersCount)}
                sub={
                  peerList.length > 0
                    ? `${peerList.filter(p => p.source === 'live' || p.dialable).length} active · ${peerList.length} known`
                    : 'Connected nodes'
                }
                icon={<Users size={18} />}
                color="green"
              />
              <StatCard
                title="Active Agreements"
                value={String(agreementsCount)}
                sub="Pending settlement"
                icon={<ShieldCheck size={18} />}
                color="amber"
              />
            </>
          )}
        </div>

        {peerList.length > 0 && (
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display font-semibold text-white/90">Network Peers</h2>
              <span className="badge badge-irium">{peerList.length} known</span>
            </div>
            <div className="space-y-1.5">
              {peerList.map((p, i) => {
                const a = anonymizePeer(p, i);
                return (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-700/50">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${a.live ? 'bg-green-400' : 'bg-white/20'}`} />
                    <span className="text-sm text-white/70 font-mono flex-1">{a.label}</span>
                    {p.height && (
                      <span className="text-xs text-white/35 font-mono">#{p.height.toLocaleString()}</span>
                    )}
                    <span className={`badge text-[10px] ${a.live ? 'badge-success' : 'badge-info'}`}>
                      {a.source}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 card p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display font-semibold text-white/90">Recent Activity</h2>
              <span className="badge badge-irium">Last 10 txs</span>
            </div>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                  <defs>
                    <linearGradient id="txGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="rgba(123,47,226,0.4)" stopOpacity={1} />
                      <stop offset="95%" stopColor="rgba(123,47,226,0)" stopOpacity={1} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="label"
                    tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{
                      background: '#0d0d1a',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8,
                      color: 'white',
                      fontSize: 12,
                    }}
                    formatter={(v: number) => [`${v.toFixed(4)} IRM`, 'Amount']}
                  />
                  <Area
                    type="monotone"
                    dataKey="val"
                    stroke="#7b2fe2"
                    strokeWidth={2}
                    fill="url(#txGrad)"
                    isAnimationActive={true}
                    animationDuration={1200}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState icon={<Activity />} text="No transaction history yet" />
            )}
          </div>

          <div className="card p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display font-semibold text-white/90">Active Agreements</h2>
              <button onClick={() => navigate('/agreements')} className="text-xs text-irium-400 hover:text-irium-300 transition-colors">View all →</button>
            </div>
            {activeAgreements.length === 0 ? (
              <EmptyState icon={<FileText />} text="No active agreements" />
            ) : (
              <motion.div
                className="space-y-2"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
              >
                {activeAgreements.slice(0, 4).map((a) => (
                  <motion.div
                    key={a.id}
                    variants={itemVariants}
                    onClick={() => navigate('/agreements', { state: { expandId: a.id } })}
                    className={`flex items-center justify-between p-2 rounded-lg hover:bg-white/5 cursor-pointer border-l-2 pl-3 ${agreementBorderColor(a.status)}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-xs text-white/70 truncate">
                        {a.id.slice(0, 12)}
                      </div>
                      <div className="text-xs text-white/40 mt-0.5">
                        {formatIRM(a.amount)}
                        {a.created_at ? ` · ${timeAgo(a.created_at)}` : ''}
                      </div>
                    </div>
                    <span className="badge badge-info text-xs ml-2">{a.status}</span>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold text-white/90">Recent Transactions</h2>
          </div>
          {recentTx.length === 0 ? (
            <EmptyState icon={<Package />} text="No transactions yet" />
          ) : (
            <motion.div
              className="space-y-1"
              variants={containerVariants}
              initial="hidden"
              animate="visible"
            >
              {recentTx.map((tx) => (
                <TxRow key={tx.txid} tx={tx} />
              ))}
            </motion.div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function StatCard({
  title,
  value,
  sub,
  icon,
  color,
}: {
  title: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
  color: 'irium' | 'blue' | 'green' | 'amber';
}) {
  const colors: Record<string, string> = {
    irium: 'text-irium-400 bg-irium-500/10',
    blue: 'text-blue-400 bg-blue-500/10',
    green: 'text-green-400 bg-green-500/10',
    amber: 'text-amber-400 bg-amber-500/10',
  };

  return (
    <div
      className="card p-4 relative overflow-hidden"
      style={{
        background: 'rgba(13,13,26,0.7)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.07)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
      }}
    >
      {/* Subtle gradient tint in top-right corner */}
      <div
        className="absolute top-0 right-0 w-20 h-20 pointer-events-none"
        style={{
          background: color === 'irium'
            ? 'radial-gradient(circle at top right, rgba(123,47,226,0.12) 0%, transparent 70%)'
            : color === 'blue'
            ? 'radial-gradient(circle at top right, rgba(37,99,235,0.12) 0%, transparent 70%)'
            : color === 'green'
            ? 'radial-gradient(circle at top right, rgba(34,197,94,0.1) 0%, transparent 70%)'
            : 'radial-gradient(circle at top right, rgba(245,158,11,0.1) 0%, transparent 70%)',
        }}
      />
      <div className="flex items-start justify-between mb-3">
        <span className="text-white/40 text-xs font-display font-semibold uppercase tracking-wider">
          {title}
        </span>
        <span className={`p-1.5 rounded-lg flex-shrink-0 ${colors[color]}`}>{icon}</span>
      </div>
      <div
        className="font-display font-bold text-2xl"
        style={{
          background: 'linear-gradient(90deg, #a855f7 0%, #60a5fa 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}
      >
        {value}
      </div>
      <div className="text-white/40 text-xs mt-1">{sub}</div>
    </div>
  );
}

function TxRow({ tx }: { tx: Transaction }) {
  const isSend = tx.direction === 'send';

  const handleCopy = () => {
    navigator.clipboard.writeText(tx.txid).then(() => {
      toast.success('TX ID copied');
    });
  };

  return (
    <motion.div
      variants={itemVariants}
      onClick={handleCopy}
      className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-white/5 cursor-pointer group relative overflow-hidden"
    >
      <div
        className={`absolute left-0 top-0 bottom-0 w-1 ${isSend ? 'bg-red-500' : 'bg-green-500'}`}
      />
      <div
        className={`ml-2 w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
          isSend ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'
        }`}
      >
        {isSend ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-mono text-xs text-white/60 truncate">
          {tx.txid.slice(0, 16)}...
        </div>
        <div className="text-xs text-white/30 mt-0.5">
          {tx.confirmations} conf
          {tx.timestamp ? ` · ${timeAgo(tx.timestamp)}` : ''}
        </div>
      </div>
      <div
        className={`font-display font-semibold text-sm flex-shrink-0 ${
          isSend ? 'text-red-400' : 'text-green-400'
        }`}
      >
        {isSend ? '-' : '+'}
        {formatIRM(Math.abs(tx.amount))}
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(tx.txid).then(() => toast.success('TX ID copied'));
          }}
          className="p-1.5 rounded hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
          title="Copy TX ID"
        >
          <Copy size={12} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            toast('Block explorer coming soon', { icon: '🔗' });
          }}
          className="p-1.5 rounded hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
          title="View on block explorer"
        >
          <ExternalLink size={12} />
        </button>
      </div>
    </motion.div>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-white/20">
      <div className="text-white/15">{icon}</div>
      <span className="text-xs">{text}</span>
    </div>
  );
}

