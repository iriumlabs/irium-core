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
  X,
  ChevronDown,
  Pickaxe,
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
import TxDetailModal from '../components/TxDetailModal';
import { startAggressivePoll } from '../hooks/useNodePoller';
import { formatIRM, timeAgo, satsToIRM, computeConfirmations } from '../lib/types';
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

  // Live node status — drives the transition from CONNECTING to "Connected"
  // and ultimately the banner's own dismissal.
  const nodeStatus = useStore((s) => s.nodeStatus);
  const setNodeStarting = useStore((s) => s.setNodeStarting);
  const setNodeOperation = useStore((s) => s.setNodeOperation);

  // Once peers are connected the operation is functionally done. Show a
  // celebratory "Connected" state, then signal the parent to unmount us
  // after a short delay.
  const completionTrigger = !!(nodeStatus?.running && (nodeStatus?.peers ?? 0) > 0);
  const [completed, setCompleted] = useState(false);
  useEffect(() => {
    if (completionTrigger && !completed) setCompleted(true);
  }, [completionTrigger, completed]);

  // Clock — freezes once we hit the completed state so the elapsed seconds
  // stop ticking on the celebration card.
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      if (!completed) setElapsed(Date.now() - start);
    }, 200);
    return () => clearInterval(id);
  }, [completed]);

  // After 2s of celebration, clear the operation flags. The parent's
  // <AnimatePresence> picks this up and animates the banner out (height
  // 0, opacity 0). We clear both flags so other listeners (TopBar's
  // "Starting…" pill) update in step.
  useEffect(() => {
    if (!completed) return;
    const t = setTimeout(() => {
      setNodeStarting(false);
      setNodeOperation(null);
    }, 2000);
    return () => clearTimeout(t);
  }, [completed, setNodeStarting, setNodeOperation]);

  const currentStepIdx = [...steps].reverse().findIndex((s) => elapsed >= s.ms);
  // When completed, push activeIdx past the last step so every step renders
  // as "done" (checkmarks + filled connector lines).
  const activeIdx = completed
    ? steps.length
    : (currentStepIdx === -1 ? 0 : steps.length - 1 - currentStepIdx);
  const activeStep = steps[Math.min(activeIdx, steps.length - 1)];
  const dots = completed ? '' : '.'.repeat(((elapsed / 500) | 0) % 4);

  // Brand cyan for starting, amber for clearing — higher saturation so the
  // banner reads cleanly against the aurora backdrop instead of fading into it.
  const isStart = type !== 'clearing';
  // Once completed, swap to brand-green so the colour shift reinforces the
  // "we're done" message in addition to the checkmarks.
  const color    = completed ? '#34d399' : isStart ? '#6ec6ff' : '#fbbf24';
  const accentBg = completed
    ? 'rgba(52,211,153,0.10)'
    : isStart ? 'rgba(110,198,255,0.10)' : 'rgba(251,191,36,0.10)';
  const accentBd = completed
    ? 'rgba(52,211,153,0.45)'
    : isStart ? 'rgba(110,198,255,0.40)' : 'rgba(251,191,36,0.40)';
  const glowGrad = `radial-gradient(ellipse 70% 100% at 50% -20%, ${
    completed
      ? 'rgba(52,211,153,0.20)'
      : isStart
        ? 'rgba(110,198,255,0.18)'
        : 'rgba(251,191,36,0.18)'
  } 0%, transparent 60%)`;

  // Slow-connect hint: the user is sitting on the CONNECTING step longer
  // than expected. Surface a subtle note so they know it's normal.
  const onConnectingStep = !completed && activeIdx === steps.length - 1;
  const slowConnect      = onConnectingStep && elapsed > 30_000;
  const peers = nodeStatus?.peers ?? 0;

  return (
    <div
      className="relative rounded-xl p-5 overflow-hidden"
      style={{
        background: 'rgba(8,11,22,0.94)',                 // opaque — hides the aurora behind it
        border: `1px solid ${accentBd}`,
        boxShadow: `0 12px 36px rgba(0,0,0,0.50), 0 0 28px ${accentBg}`,
        transition: 'border-color 0.4s ease, box-shadow 0.4s ease',
      }}
    >
      {/* Subtle accent glow at top */}
      <div className="absolute inset-0 pointer-events-none" style={{ background: glowGrad, transition: 'background 0.4s ease' }} />

      <div className="relative">
        {/* Header */}
        <div className="flex items-center gap-2.5 mb-4">
          {completed
            ? <CheckCircle2 size={14} style={{ color }} />
            : <Loader2 size={14} className="animate-spin" style={{ color }} />}
          <span
            className="text-[10px] font-display font-bold uppercase"
            style={{ color, letterSpacing: '0.16em' }}
          >
            {completed
              ? `Connected${peers > 0 ? ` to ${peers} peer${peers === 1 ? '' : 's'}` : ''}`
              : isStart ? 'Starting node' : 'Clearing & restarting'}
          </span>
        </div>

        {/* Step dots — note: NO overflow-x-auto here. That was clipping the
            active step's glowing box-shadow on the vertical axis and
            producing a "stuck in a box / cut off" appearance on the final
            CONNECTING step where the glow is most pronounced. The row
            shrinks to fit on narrow viewports via `flex-1` connectors and
            `whitespace-nowrap` labels instead. */}
        <div className="flex items-center gap-2 mb-4 px-1 py-2">
          {steps.map((step, i) => {
            const done = i < activeIdx;
            const active = i === activeIdx && !completed;
            const isStepConnected = done; // for connector colour
            return (
              <React.Fragment key={i}>
                {i > 0 && (
                  <div
                    className="flex-1 h-0.5 min-w-[16px] rounded-full transition-all duration-500"
                    style={{ background: isStepConnected ? color : 'rgba(255,255,255,0.14)' }}
                  />
                )}
                <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center transition-all duration-300"
                    style={{
                      background: done || active ? accentBg : 'rgba(0,0,0,0.40)',
                      border: `1px solid ${done || active ? accentBd : 'rgba(255,255,255,0.12)'}`,
                      boxShadow: active ? `0 0 14px ${accentBg.replace('0.10', '0.45')}` : 'none',
                    }}
                  >
                    {done ? (
                      <CheckCircle2 size={14} style={{ color }} />
                    ) : active ? (
                      <Loader2 size={14} className="animate-spin" style={{ color }} />
                    ) : (
                      <Circle size={14} style={{ color: 'rgba(255,255,255,0.30)' }} />
                    )}
                  </div>
                  <span
                    className="text-[9px] font-display font-bold uppercase whitespace-nowrap transition-colors duration-300"
                    style={{
                      color: done || active ? color : 'rgba(255,255,255,0.40)',
                      letterSpacing: '0.10em',
                    }}
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
            key={completed ? 'done' : activeIdx}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="flex items-center gap-3"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-display font-bold" style={{ color }}>
                {completed
                  ? `Connected to ${peers} peer${peers === 1 ? '' : 's'}`
                  : `${activeStep.label}${dots}`}
              </p>
              <p className="text-xs mt-1" style={{ color: 'rgba(238,240,255,0.55)' }}>
                {completed
                  ? 'Node is online and synced with the network.'
                  : <>{activeStep.detail} · <span className="font-mono">{(elapsed / 1000).toFixed(0)}s</span></>}
              </p>
            </div>
            {/* Progress bar — fills to 100% on completion (was capped at 98%
                so the bar never reached the end of the track even after the
                node was up). */}
            <div
              className="w-32 h-1.5 rounded-full overflow-hidden flex-shrink-0"
              style={{ background: 'rgba(0,0,0,0.40)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <motion.div
                className="h-full rounded-full"
                style={{
                  background: completed
                    ? 'linear-gradient(90deg, #10b981 0%, #34d399 100%)'
                    : isStart
                      ? 'linear-gradient(90deg, #3b3bff 0%, #6ec6ff 50%, #a78bfa 100%)'
                      : 'linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%)',
                  boxShadow: `0 0 8px ${color}`,
                }}
                animate={{
                  width: completed ? '100%' : `${Math.min(98, 5 + (elapsed / 200))}%`,
                }}
                transition={{
                  duration: completed ? 0.5 : 0.5,
                  ease: completed ? 'easeOut' : 'linear',
                }}
              />
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Slow-connect hint */}
        <AnimatePresence>
          {slowConnect && (
            <motion.p
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="text-[11px] mt-3 leading-relaxed"
              style={{ color: 'rgba(238,240,255,0.45)' }}
            >
              This may take a moment if no peers are immediately available.
            </motion.p>
          )}
        </AnimatePresence>
      </div>
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

// ── Decentralization banner ───────────────────────────────────
const DECENTRAL_DISMISSED_KEY = 'irium-decentral-dismissed';

// SVG viewBox 0 0 112 78 — 5 healthy network nodes + 1 dimmed "you" node at bottom
const NET_POS = [
  { x: 18, y: 13 },
  { x: 94, y: 13 },
  { x: 56, y: 38 },
  { x: 18, y: 63 },
  { x: 94, y: 63 },
];
const YOU_POS = { x: 56, y: 70 };
const EDGES: [number, number][] = [[0,1],[0,2],[1,2],[2,3],[2,4],[3,4]];

function NetworkGraphic() {
  return (
    <svg viewBox="0 0 112 78" width={112} height={78} className="flex-shrink-0 select-none">
      {/* Animated edges between network nodes */}
      {EDGES.map(([a, b], i) => (
        <motion.line
          key={i}
          x1={NET_POS[a].x} y1={NET_POS[a].y}
          x2={NET_POS[b].x} y2={NET_POS[b].y}
          stroke="rgba(52,211,153,0.28)"
          strokeWidth={0.8}
          strokeDasharray="3 3"
          animate={{ strokeDashoffset: [0, -6] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'linear', delay: i * 0.18 }}
        />
      ))}

      {/* Outbound-only dashed line from YOU → center node (N2) — no return path */}
      <line
        x1={YOU_POS.x} y1={YOU_POS.y - 5}
        x2={NET_POS[2].x} y2={NET_POS[2].y + 5}
        stroke="rgba(255,255,255,0.12)"
        strokeWidth={0.8}
        strokeDasharray="2 3"
      />
      {/* Arrowhead pointing up (outbound from you) */}
      <polygon
        points={`${NET_POS[2].x - 3},${NET_POS[2].y + 8} ${NET_POS[2].x + 3},${NET_POS[2].y + 8} ${NET_POS[2].x},${NET_POS[2].y + 4}`}
        fill="rgba(255,255,255,0.15)"
      />

      {/* Network nodes — pulsing green */}
      {NET_POS.map((n, i) => (
        <g key={i}>
          <motion.circle
            cx={n.x} cy={n.y} r={4}
            fill="none"
            stroke="rgba(52,211,153,0.45)"
            strokeWidth={0.8}
            animate={{ r: [4, 10], opacity: [0.5, 0] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'easeOut', delay: i * 0.42 }}
          />
          <motion.circle
            cx={n.x} cy={n.y} r={3.5}
            fill="rgba(52,211,153,0.85)"
            animate={{ opacity: [0.65, 1, 0.65] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut', delay: i * 0.35 }}
          />
        </g>
      ))}

      {/* Your node — dimmed, dashed border, no pulse */}
      <motion.circle
        cx={YOU_POS.x} cy={YOU_POS.y} r={4}
        fill="rgba(255,255,255,0.06)"
        stroke="rgba(255,255,255,0.22)"
        strokeWidth={0.8}
        strokeDasharray="2 2"
        animate={{ opacity: [0.5, 0.8, 0.5] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      />
      <text x={YOU_POS.x} y={YOU_POS.y + 9} textAnchor="middle" fontSize={4.5} fill="rgba(255,255,255,0.28)" fontFamily="monospace">
        you
      </text>
    </svg>
  );
}

function DecentralizationBanner({ onDismiss }: { onDismiss: () => void }) {
  const navigate = useNavigate();
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
      className="overflow-hidden"
    >
      <div
        className="relative rounded-xl px-5 py-4 flex items-center gap-4 overflow-hidden"
        style={{
          background: 'rgba(8,11,22,0.94)',
          border: '1px solid rgba(110,198,255,0.32)',
          boxShadow: '0 8px 28px rgba(0,0,0,0.45), 0 0 22px rgba(110,198,255,0.10)',
        }}
      >
        <NetworkGraphic />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-display font-bold" style={{ color: '#6ec6ff' }}>
                Your node isn't reachable by the network
              </p>
              <p className="text-xs mt-1 leading-relaxed" style={{ color: 'rgba(238,240,255,0.55)' }}>
                You're connected outbound but other nodes can't dial back to you. For a healthy
                decentralized network every node should be a full two-way peer. Set your public IP
                so the network knows how to reach you.
              </p>
            </div>
            <button
              onClick={onDismiss}
              className="flex-shrink-0 transition-colors mt-0.5"
              style={{ color: 'rgba(255,255,255,0.18)' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.18)')}
            >
              <X size={13} />
            </button>
          </div>
          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={() => navigate('/settings')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-display font-semibold transition-all active:scale-[0.97]"
              style={{
                background: 'rgba(110,198,255,0.16)',
                border: '1px solid rgba(110,198,255,0.55)',
                color: '#fff',
                boxShadow: '0 0 14px rgba(110,198,255,0.18)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background  = 'rgba(110,198,255,0.24)';
                e.currentTarget.style.borderColor = 'rgba(110,198,255,0.75)';
                e.currentTarget.style.boxShadow   = '0 0 22px rgba(110,198,255,0.30)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background  = 'rgba(110,198,255,0.16)';
                e.currentTarget.style.borderColor = 'rgba(110,198,255,0.55)';
                e.currentTarget.style.boxShadow   = '0 0 14px rgba(110,198,255,0.18)';
              }}
            >
              Set External IP
            </button>
            <span className="text-xs" style={{ color: 'rgba(238,240,255,0.45)' }}>
              Sync and wallet work without this
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const nodeStatus = useStore((s) => s.nodeStatus);
  const setNodeStarting = useStore((s) => s.setNodeStarting);
  const nodeStarting = useStore((s) => s.nodeStarting);
  const operation = useStore((s) => s.nodeOperation);
  const setOperation = useStore((s) => s.setNodeOperation);
  const balance = useStore((s) => s.balance);
  const addNotification = useStore((s) => s.addNotification);
  const peerList = useStore((s) => s.peerList);
  const externalIp = useStore((s) => s.settings.external_ip);
  const heightLastChanged = useStore((s) => s.heightLastChanged);
  const [showDecentral, setShowDecentral] = useState(
    () => !localStorage.getItem(DECENTRAL_DISMISSED_KEY)
  );
  const [peersExpanded, setPeersExpanded] = useState(false);
  const [recentTx, setRecentTx] = useState<Transaction[]>([]);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [activeAgreements, setActiveAgreements] = useState<Agreement[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastTip, setLastTip] = useState<string>('');
  const [tickerGlow, setTickerGlow] = useState(false);

  const statsRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(statsRef, { once: true });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [txs, agrs] = await Promise.allSettled([
        wallet.transactions(10),
        agreements.list(),
      ]);
      if (txs.status === 'fulfilled')
        setRecentTx(txs.value.filter((tx) => Math.abs(tx.amount) > 0));
      if (agrs.status === 'fulfilled')
        setActiveAgreements(agrs.value.filter((a) => a.status === 'funded' || a.status === 'open'));
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Safety timeout: clear any stuck operation banner after 90s.
  useEffect(() => {
    if (!operation) return;
    const id = setTimeout(() => setOperation(null), 90_000);
    return () => clearTimeout(id);
  }, [operation, setOperation]);

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
      const result = await node.start(undefined, externalIp);
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
      const result = await node.start(undefined, externalIp);
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
      <div className="px-8 py-6 space-y-6 w-full">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Dashboard</h1>
            <p className="page-subtitle">Irium blockchain overview · live</p>
          </div>
          <button onClick={loadData} className="btn-secondary text-xs gap-2" disabled={loading}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        <AnimatePresence mode="wait">
          {/* ── Operation in progress ─────────────────────────── */}
          {(operation || nodeStarting) ? (
            <motion.div
              key="operation-banner"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden"
            >
              <NodeOperationBanner type={operation ?? 'starting'} />
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
              <div
                className="flex items-center justify-between gap-4 rounded-xl px-5 py-4 relative overflow-hidden"
                style={{
                  background: 'rgba(8,11,22,0.94)',
                  border: '1px solid rgba(245,158,11,0.45)',
                  boxShadow: '0 8px 28px rgba(0,0,0,0.40), 0 0 24px rgba(245,158,11,0.15)',
                }}
              >
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{ background: 'radial-gradient(ellipse 60% 100% at 0% 0%, rgba(245,158,11,0.16) 0%, transparent 70%)' }}
                />
                <div className="relative flex items-center gap-3">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{
                      background: 'rgba(245,158,11,0.14)',
                      border: '1px solid rgba(245,158,11,0.40)',
                    }}
                  >
                    <span className="dot-syncing" />
                  </div>
                  <div>
                    <p className="text-sm font-display font-bold" style={{ color: '#fbbf24' }}>
                      iriumd is not running
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'rgba(251,191,36,0.65)' }}>
                      Start the node to sync with the Irium network.
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleStartNode}
                  className="btn-primary flex-shrink-0 text-sm relative"
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
                className="relative flex items-center gap-3 rounded-xl px-5 py-4 overflow-hidden"
                style={{
                  background: 'rgba(8,11,22,0.94)',
                  border: '1px solid rgba(110,198,255,0.40)',
                  boxShadow: '0 8px 28px rgba(0,0,0,0.45), 0 0 24px rgba(110,198,255,0.14)',
                }}
              >
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{ background: 'radial-gradient(ellipse 60% 100% at 0% 0%, rgba(110,198,255,0.16) 0%, transparent 70%)' }}
                />
                <div className="relative flex items-center gap-3 flex-1">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(110,198,255,0.14)', border: '1px solid rgba(110,198,255,0.40)' }}
                  >
                    <span className="dot-syncing" style={{ animationDuration: '1.2s' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-display font-bold" style={{ color: '#6ec6ff' }}>
                      Searching for peers…
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'rgba(238,240,255,0.55)' }}>
                      Block #{nodeStatus.height.toLocaleString()} · iriumd is discovering the network. If stuck, try Clear &amp; Restart.
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleReconnect}
                  disabled={operation === 'clearing'}
                  className="relative flex-shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-display font-semibold transition-all active:scale-[0.97] disabled:opacity-50"
                  style={{
                    background: 'rgba(110,198,255,0.14)',
                    border: '1px solid rgba(110,198,255,0.55)',
                    color: '#fff',
                    boxShadow: '0 0 16px rgba(110,198,255,0.18)',
                  }}
                  onMouseEnter={(e) => {
                    if (operation === 'clearing') return;
                    e.currentTarget.style.background  = 'rgba(110,198,255,0.22)';
                    e.currentTarget.style.borderColor = 'rgba(110,198,255,0.75)';
                    e.currentTarget.style.boxShadow   = '0 0 22px rgba(110,198,255,0.30)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background  = 'rgba(110,198,255,0.14)';
                    e.currentTarget.style.borderColor = 'rgba(110,198,255,0.55)';
                    e.currentTarget.style.boxShadow   = '0 0 16px rgba(110,198,255,0.18)';
                  }}
                >
                  <RefreshCw size={12} className={operation === 'clearing' ? 'animate-spin' : ''} /> Clear &amp; Restart
                </button>
              </div>
            </motion.div>
          ) : nodeStatus.running && nodeStatus.network_tip > 0 && (nodeStatus.network_tip - nodeStatus.height) > 50 ? (
            /* ── Has peers but stuck behind chain tip ─────────── */
            <motion.div
              key="stuck-banner"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div
                className="relative flex items-center gap-3 rounded-xl px-5 py-4 overflow-hidden"
                style={{
                  background: 'rgba(8,11,22,0.94)',
                  border: '1px solid rgba(245,158,11,0.45)',
                  boxShadow: '0 8px 28px rgba(0,0,0,0.45), 0 0 24px rgba(245,158,11,0.16)',
                }}
              >
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{ background: 'radial-gradient(ellipse 60% 100% at 0% 0%, rgba(245,158,11,0.16) 0%, transparent 70%)' }}
                />
                <div className="relative flex items-center gap-3 flex-1">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(245,158,11,0.14)', border: '1px solid rgba(245,158,11,0.40)' }}
                  >
                    <span className="dot-syncing" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-display font-bold" style={{ color: '#fbbf24' }}>
                      Sync stalled — {(nodeStatus.network_tip - nodeStatus.height).toLocaleString()} blocks behind
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'rgba(238,240,255,0.55)' }}>
                      Block #{nodeStatus.height.toLocaleString()} / #{nodeStatus.network_tip.toLocaleString()} · Chain state may be corrupted. Clear &amp; Restart to resync from scratch.
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleReconnect}
                  disabled={operation === 'clearing'}
                  className="relative flex-shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-display font-semibold transition-all active:scale-[0.97] disabled:opacity-50"
                  style={{
                    background: 'rgba(245,158,11,0.16)',
                    border: '1px solid rgba(245,158,11,0.55)',
                    color: '#fff',
                    boxShadow: '0 0 16px rgba(245,158,11,0.18)',
                  }}
                  onMouseEnter={(e) => {
                    if (operation === 'clearing') return;
                    e.currentTarget.style.background  = 'rgba(245,158,11,0.24)';
                    e.currentTarget.style.borderColor = 'rgba(245,158,11,0.75)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background  = 'rgba(245,158,11,0.16)';
                    e.currentTarget.style.borderColor = 'rgba(245,158,11,0.55)';
                  }}
                >
                  <RefreshCw size={12} className={operation === 'clearing' ? 'animate-spin' : ''} /> Clear &amp; Restart
                </button>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* ── Decentralization nudge — separate AnimatePresence so it coexists with status banners */}
        <AnimatePresence>
          {nodeStatus?.running && !externalIp && showDecentral && (
            <DecentralizationBanner
              key="decentral-banner"
              onDismiss={() => {
                localStorage.setItem(DECENTRAL_DISMISSED_KEY, '1');
                setShowDecentral(false);
              }}
            />
          )}
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
              {/* Confirmed Balance — shows "Syncing…" while the chain is
                  catching up so the user doesn't watch the IRM number
                  change rapidly as old blocks are processed. The actual
                  balance only renders once nodeStatus.synced flips true. */}
              <StatCard
                title="Confirmed Balance"
                value={
                  !nodeStatus?.running
                    ? '—'
                    : !nodeStatus.synced
                      ? 'Syncing…'
                      : formatIRM(balanceCount)
                }
                sub={
                  !nodeStatus?.running
                    ? 'Node offline'
                    : !nodeStatus.synced
                      ? `Catching up · #${(nodeStatus.height ?? 0).toLocaleString()}${
                          nodeStatus.network_tip
                            ? ` / #${nodeStatus.network_tip.toLocaleString()}`
                            : ''
                        }`
                      : balance
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

        {nodeStatus?.running && (
          <div className="card p-4">
            <button
              className="flex items-center justify-between w-full mb-0 text-left"
              onClick={() => peerList.length > 0 && setPeersExpanded((v) => !v)}
              style={{ cursor: peerList.length > 0 ? 'pointer' : 'default' }}
            >
              <h2 className="font-display font-semibold text-white/90">Network Peers</h2>
              <div className="flex items-center gap-2">
                {peerList.length > 0 ? (
                  <>
                    <span className="badge badge-irium">{peerList.length} known</span>
                    <ChevronDown
                      size={14}
                      className="transition-transform duration-200 text-white/40"
                      style={{ transform: peersExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                    />
                  </>
                ) : (
                  <span className="text-xs text-white/30 animate-pulse">Discovering peers…</span>
                )}
              </div>
            </button>
            <AnimatePresence initial={false}>
              {peersExpanded && peerList.length > 0 && (
                <motion.div
                  key="peers-list"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="overflow-hidden"
                >
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-xs border-separate" style={{ borderSpacing: 0 }}>
                      <thead>
                        <tr>
                          <th className="text-left pb-2 pr-4 font-semibold uppercase tracking-wider text-white/25" style={{ fontSize: 9.5 }}>Address</th>
                          <th className="text-left pb-2 pr-4 font-semibold uppercase tracking-wider text-white/25" style={{ fontSize: 9.5 }}>Dialable</th>
                          <th className="text-left pb-2 pr-4 font-semibold uppercase tracking-wider text-white/25" style={{ fontSize: 9.5 }}>Height</th>
                          <th className="text-left pb-2 font-semibold uppercase tracking-wider text-white/25" style={{ fontSize: 9.5 }}>Last Seen</th>
                        </tr>
                      </thead>
                      <tbody>
                        {peerList.map((p, i) => (
                          <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                            <td className="py-1.5 pr-4 font-mono text-white/55 max-w-[220px]" style={{ fontSize: 11 }}>
                              <span className="block truncate" title={p.multiaddr}>{p.multiaddr || '—'}</span>
                            </td>
                            <td className="py-1.5 pr-4">
                              {p.dialable
                                ? <span className="text-green-400 font-semibold">Yes</span>
                                : <span className="text-white/25">No</span>}
                            </td>
                            <td className="py-1.5 pr-4 font-mono text-white/45">
                              {p.height ? `#${p.height.toLocaleString()}` : '—'}
                            </td>
                            <td className="py-1.5 text-white/35">
                              {p.last_seen ? timeAgo(p.last_seen) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 card p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display font-semibold text-white/90">Recent Activity</h2>
              {recentTx.length > 0 && <span className="badge badge-irium">Last 10 txs</span>}
            </div>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                  <defs>
                    <linearGradient id="txGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="rgba(110,198,255,0.4)" stopOpacity={1} />
                      <stop offset="95%" stopColor="rgba(110,198,255,0)" stopOpacity={1} />
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
                    className={`flex items-center justify-between p-2 rounded-lg hover:bg-white/5 cursor-pointer border-l-2 pl-3 overflow-hidden ${agreementBorderColor(a.status)}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-xs text-white/70 truncate" title={a.id}>
                        {a.id}
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
                <TxRow key={tx.txid} tx={tx} onClick={() => setSelectedTx(tx)} />
              ))}
            </motion.div>
          )}
        </div>
      </div>

      {/* ── Tx Detail Modal ───────────────────────────────────── */}
      <AnimatePresence>
        {selectedTx && (
          <TxDetailModal tx={selectedTx} onClose={() => setSelectedTx(null)} />
        )}
      </AnimatePresence>
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
      className="relative overflow-hidden p-4 rounded-[10px]"
      style={{
        background: 'var(--bg-elev-1)',
        border: '1px solid var(--brand-line)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.03)',
      }}
    >
      {/* Subtle accent tint per stat colour — sits in the corner so the
          card stays readable while reading as "this stat is X-coloured". */}
      <div
        className="absolute top-0 right-0 w-24 h-24 pointer-events-none"
        style={{
          background: color === 'irium'
            ? 'radial-gradient(circle at top right, rgba(110,198,255,0.18) 0%, transparent 70%)'
            : color === 'blue'
            ? 'radial-gradient(circle at top right, rgba(167,139,250,0.16) 0%, transparent 70%)'
            : color === 'green'
            ? 'radial-gradient(circle at top right, rgba(52,211,153,0.14) 0%, transparent 70%)'
            : 'radial-gradient(circle at top right, rgba(251,191,36,0.14) 0%, transparent 70%)',
        }}
      />
      <div className="relative flex items-start justify-between mb-3">
        <span className="text-white/40 text-xs font-display font-semibold uppercase tracking-wider">
          {title}
        </span>
        <span className={`p-1.5 rounded-lg flex-shrink-0 ${colors[color]}`}>{icon}</span>
      </div>
      {/* Value uses the same brand text gradient as the TopBar balance so
          every prominent number in the app reads with the same colour signature. */}
      <div
        className="relative font-display font-bold text-2xl tabular-nums leading-tight"
        style={{
          background: 'linear-gradient(90deg, #d4eeff 0%, #6ec6ff 55%, #a78bfa 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          letterSpacing: '0.01em',
        }}
      >
        {value}
      </div>
      <div className="relative text-white/40 text-xs mt-1">{sub}</div>
    </div>
  );
}

function TxRow({ tx, onClick }: { tx: Transaction; onClick: () => void }) {
  const isSend = tx.direction === 'send';
  const isCoinbase = tx.is_coinbase === true;
  // Coinbase wins over send/receive direction — mining rewards are
  // semantically distinct from regular incoming txs. Matches the Wallet
  // page's TxRow triage so confs/labels stay consistent across pages.
  const accentBar = isCoinbase ? 'bg-green-500' : isSend ? 'bg-red-500' : 'bg-green-500';
  const iconBg    = isCoinbase ? 'bg-green-500/10 text-green-400' : isSend ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400';
  const amountColor = isCoinbase ? 'text-green-400' : isSend ? 'text-red-400' : 'text-green-400';
  const TypeIcon = isCoinbase ? Pickaxe : isSend ? ArrowUpRight : ArrowDownLeft;
  const typeLabel = isCoinbase ? 'Mining Reward' : isSend ? 'Sent' : 'Received';

  // Confirmations — shared helper so Dashboard and Wallet show the same
  // value for the same tx. Falls back to tx.confirmations when no height
  // is set (mempool / legacy data without a block reference).
  const currentTip = useStore((s) => s.nodeStatus?.height) ?? 0;
  const confirmations = tx.height
    ? computeConfirmations(tx.height, currentTip)
    : tx.confirmations;

  return (
    <motion.div
      variants={itemVariants}
      onClick={onClick}
      className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-white/5 cursor-pointer group relative overflow-hidden"
    >
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${accentBar}`} />
      <div className={`ml-2 mt-0.5 w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${iconBg}`}>
        <TypeIcon size={14} />
      </div>
      <div className="flex-1 min-w-0">
        {/* Type label — small, dim, sits above the full TXID so the row
            is identifiable at a glance even when the hash wraps. */}
        <div className={`text-[11px] font-display font-semibold ${amountColor}`}>
          {typeLabel}
        </div>
        {/* Full TXID with break-all — no `...` truncation. Wraps to
            multiple lines on narrow screens; full hash is always visible. */}
        <div className="font-mono text-[10px] text-white/55 break-all leading-snug mt-0.5">
          {tx.txid}
        </div>
        <div className="text-[10px] text-white/30 mt-0.5">
          {confirmations} conf
          {tx.timestamp ? ` · ${timeAgo(tx.timestamp)}` : ''}
        </div>
      </div>
      <div className={`font-display font-semibold text-sm flex-shrink-0 ${amountColor}`}>
        {isSend ? '−' : '+'}
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
          onClick={(e) => { e.stopPropagation(); onClick(); }}
          className="p-1.5 rounded hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
          title="View transaction details"
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

