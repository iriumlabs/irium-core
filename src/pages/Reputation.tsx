import { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Star,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  Hash,
  Clock,
  CheckCircle,
  XCircle,
  User,
  ChevronDown,
  ChevronUp,
  Copy,
} from "lucide-react";
import { reputation } from "../lib/tauri";
import type { Reputation as ReputationData } from "../lib/types";

// ─── useCountUp hook ─────────────────────────────────────────────────────────
function useCountUp(target: number, duration: number, active: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!active) {
      setCount(0);
      return;
    }
    let start: number | null = null;
    const tick = (ts: number) => {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3); // easeOut cubic
      setCount(Math.round(target * ease));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [target, duration, active]);
  return count;
}

// ─── Config ───────────────────────────────────────────────────────────────────
const RISK_CONFIG: Record<
  string,
  { label: string; color: string; icon: typeof ShieldCheck; bg: string }
> = {
  low: {
    label: "Low Risk",
    color: "text-emerald-400",
    icon: ShieldCheck,
    bg: "bg-emerald-500/10 border-emerald-500/30",
  },
  medium: {
    label: "Medium Risk",
    color: "text-amber-400",
    icon: AlertTriangle,
    bg: "bg-amber-500/10 border-amber-500/30",
  },
  high: {
    label: "High Risk",
    color: "text-rose-400",
    icon: ShieldAlert,
    bg: "bg-rose-500/10 border-rose-500/30",
  },
  unknown: {
    label: "Unknown",
    color: "text-white/40",
    icon: User,
    bg: "bg-white/5 border-white/10",
  },
};

// ─── Animation variants ───────────────────────────────────────────────────────
const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.08 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

const rowVariants = {
  hidden: { opacity: 0, x: -12 },
  visible: { opacity: 1, x: 0 },
};

// ─── ScoreRing ────────────────────────────────────────────────────────────────
function ScoreRing({ score, active }: { score: number; active: boolean }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(1, score / 100));
  const offset = circumference * (1 - pct);

  const color =
    score >= 75
      ? "#10b981"
      : score >= 45
      ? "#f59e0b"
      : "#f43f5e";

  const displayScore = useCountUp(score, 1200, active);

  return (
    <div className="relative w-36 h-36 flex items-center justify-center">
      <svg className="w-36 h-36 -rotate-90" viewBox="0 0 128 128">
        {/* Track */}
        <circle
          cx="64"
          cy="64"
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="10"
        />
        {/* Progress — animated via framer-motion */}
        <motion.circle
          cx="64"
          cy="64"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: active ? offset : circumference }}
          transition={{ duration: 1.2, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-3xl font-bold font-display" style={{ color }}>
          {displayScore}
        </span>
        <span className="text-xs text-white/40 font-mono">/ 100</span>
      </div>
    </div>
  );
}

// ─── StatCard ─────────────────────────────────────────────────────────────────
function StatCard({
  label,
  value,
  rawValue,
  sub,
  icon: Icon,
  active,
}: {
  label: string;
  value?: string;
  rawValue?: number;
  sub?: string;
  icon: typeof Activity;
  active: boolean;
}) {
  const counted = useCountUp(rawValue ?? 0, 1000, active && rawValue !== undefined);
  const display = rawValue !== undefined ? counted : value ?? "0";

  return (
    <div className="card p-4 flex items-center gap-4">
      <div className="w-10 h-10 rounded-lg bg-irium-600/20 flex items-center justify-center shrink-0">
        <Icon size={18} className="text-irium-400" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-white/40 uppercase tracking-wider">{label}</p>
        <p className="text-lg font-semibold font-mono text-white truncate">{display}</p>
        {sub && <p className="text-xs text-white/40 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─── AgreementRow ─────────────────────────────────────────────────────────────
function AgreementRow({
  ag,
}: {
  ag: { id: string; role: string; status: string; amount: number; timestamp: number };
}) {
  const success = ag.status === "released";
  const failed = ag.status === "refunded";

  return (
    <motion.div
      variants={rowVariants}
      className="flex items-center gap-3 py-2.5 border-b border-white/5 last:border-0"
    >
      {success ? (
        <CheckCircle size={15} className="text-emerald-400 shrink-0" />
      ) : failed ? (
        <XCircle size={15} className="text-rose-400 shrink-0" />
      ) : (
        <Clock size={15} className="text-amber-400 shrink-0" />
      )}
      <span className="font-mono text-xs text-white/40 truncate flex-1">{ag.id}</span>
      <span
        className={`text-xs capitalize px-2 py-0.5 rounded-full border ${
          success
            ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
            : failed
            ? "text-rose-400 bg-rose-500/10 border-rose-500/20"
            : "text-amber-400 bg-amber-500/10 border-amber-500/20"
        }`}
      >
        {ag.role}
      </span>
      <span className="text-xs font-mono text-white">
        {(ag.amount / 1e8).toFixed(4)} IRM
      </span>
    </motion.div>
  );
}

// ─── ScoreHistoryBars ─────────────────────────────────────────────────────────
function ScoreHistoryBars({
  history,
  active,
}: {
  history: number[];
  active: boolean;
}) {
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);

  return (
    <div className="card p-4">
      <p className="text-xs text-white/40 uppercase tracking-wider mb-3">
        Score History
      </p>
      <div className="flex items-end gap-1 h-16 relative">
        {history.slice(-24).map((s: number, i: number) => {
          const h = Math.max(4, (s / 100) * 64);
          const color = s >= 75 ? "#10b981" : s >= 45 ? "#f59e0b" : "#f43f5e";
          return (
            <div
              key={i}
              className="flex-1 relative flex flex-col justify-end"
              style={{ height: "64px" }}
              onMouseEnter={() => setHoveredBar(i)}
              onMouseLeave={() => setHoveredBar(null)}
            >
              {/* Hover tooltip */}
              <AnimatePresence>
                {hoveredBar === i && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: 0.15 }}
                    className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 z-10 pointer-events-none"
                  >
                    <div className="glass px-1.5 py-0.5 rounded text-[10px] font-mono text-white whitespace-nowrap">
                      {s}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Bar */}
              <motion.div
                className="rounded-t-sm w-full"
                style={{ backgroundColor: color }}
                initial={{ height: 0, opacity: 0 }}
                animate={
                  active
                    ? { height: `${h}px`, opacity: 0.7 }
                    : { height: 0, opacity: 0 }
                }
                transition={{ duration: 0.4, delay: i * 0.03, ease: "easeOut" }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function Reputation() {
  const location = useLocation();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [shimmer, setShimmer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReputationData | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [resultVisible, setResultVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const incoming = (location.state as { prefillAddress?: string } | null)?.prefillAddress;
    if (incoming) {
      setQuery(incoming);
      setTimeout(() => lookup(incoming), 50);
    }
  }, []); // only on mount

  const lookup = async (overrideQuery?: string) => {
    const q = (overrideQuery ?? query).trim();
    if (!q) return;

    // Reset previous results
    setResultVisible(false);
    setData(null);
    setError(null);

    // Lock input and show shimmer
    setLoading(true);
    setShimmer(true);

    // Wait 600 ms shimmer, then actually call
    await new Promise((r) => setTimeout(r, 600));
    setShimmer(false);

    try {
      const result = await reputation.show(q);
      setData(result);
      setResultVisible(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") lookup();
  };

  const copyAddr = () => {
    if (data?.address) navigator.clipboard.writeText(data.address);
  };

  const risk = data
    ? RISK_CONFIG[data.risk_level ?? "unknown"] ?? RISK_CONFIG.unknown
    : null;

  const trend =
    data && data.score_history && data.score_history.length >= 2
      ? data.score_history[data.score_history.length - 1] -
        data.score_history[data.score_history.length - 2]
      : 0;

  const volumeDisplay = data?.volume_sats
    ? (data.volume_sats / 1e8).toFixed(2)
    : "0.00";

  return (
    <div className="max-w-3xl mx-auto space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold font-display gradient-text">Reputation Lookup</h1>
        <p className="text-sm text-white/40 mt-1">
          Query the on-chain reputation score for any Irium address or public key.
        </p>
      </div>

      {/* Search bar */}
      <div className="card p-4 flex gap-3">
        <div className="flex-1 relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none"
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Q-prefix address or 64-hex public key…"
            disabled={loading}
            className={`input pl-9 w-full font-mono text-sm disabled:opacity-60 disabled:cursor-not-allowed transition-opacity ${
              shimmer ? "shimmer" : ""
            }`}
          />
        </div>
        <button
          onClick={() => lookup()}
          disabled={!query.trim() || loading}
          className="btn-primary px-5 py-2 text-sm disabled:opacity-50 shrink-0"
        >
          {loading ? "Looking up…" : "Look Up"}
        </button>
      </div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.25 }}
            className="card border-rose-500/30 bg-rose-500/5 p-4 text-rose-400 text-sm"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Empty state */}
      <AnimatePresence>
        {!data && !loading && !error && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="card p-12 flex flex-col items-center gap-4 text-center"
          >
            <div className="w-16 h-16 rounded-full bg-irium-600/10 flex items-center justify-center">
              <Star size={28} className="text-irium-500" />
            </div>
            <div>
              <p className="text-white font-semibold">No address queried yet</p>
              <p className="text-sm text-white/40 mt-1">
                Enter a Q-prefix address or public key above to look up their on-chain
                reputation score and agreement history.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Result — slides in below search bar after shimmer */}
      <AnimatePresence>
        {resultVisible && data && risk && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="space-y-4"
          >
            {/* Profile card */}
            <div className="card p-6">
              <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
                {/* Score ring */}
                <div className="flex flex-col items-center gap-2">
                  <ScoreRing score={data.score} active={resultVisible} />

                  {/* Risk badge — pulsing if high risk */}
                  {data.risk_signal === "high" ? (
                    <motion.div
                      animate={{ opacity: [1, 0.6, 1] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium ${risk.bg} ${risk.color}`}
                    >
                      <risk.icon size={13} />
                      {risk.label}
                    </motion.div>
                  ) : (
                    <div
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium ${risk.bg} ${risk.color}`}
                    >
                      <risk.icon size={13} />
                      {risk.label}
                    </div>
                  )}
                </div>

                {/* Address + stats */}
                <div className="flex-1 min-w-0 space-y-3">
                  <div>
                    <p className="text-xs text-white/40 uppercase tracking-wider mb-1">
                      Address
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-white break-all">{data.address}</span>
                      <button onClick={copyAddr} className="text-white/40 hover:text-white shrink-0">
                        <Copy size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Trend */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-white/40">Score trend:</span>
                    {trend > 0 ? (
                      <span className="flex items-center gap-1 text-emerald-400 text-xs">
                        <TrendingUp size={13} /> +{trend.toFixed(1)} pts
                      </span>
                    ) : trend < 0 ? (
                      <span className="flex items-center gap-1 text-rose-400 text-xs">
                        <TrendingDown size={13} /> {trend.toFixed(1)} pts
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-white/40 text-xs">
                        <Minus size={13} /> Stable
                      </span>
                    )}
                  </div>

                  {/* Flags */}
                  {data.flags && data.flags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {data.flags.map((f: string) => (
                        <span key={f} className="badge-warning text-xs px-2 py-0.5">
                          {f}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Stats grid — staggered cards */}
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="grid grid-cols-2 sm:grid-cols-4 gap-3"
            >
              <motion.div variants={itemVariants}>
                <StatCard
                  label="Total Agreements"
                  rawValue={data.total_agreements ?? 0}
                  icon={Hash}
                  active={resultVisible}
                />
              </motion.div>
              <motion.div variants={itemVariants}>
                <StatCard
                  label="Released"
                  rawValue={data.released ?? 0}
                  sub="Successful trades"
                  icon={CheckCircle}
                  active={resultVisible}
                />
              </motion.div>
              <motion.div variants={itemVariants}>
                <StatCard
                  label="Refunded"
                  rawValue={data.refunded ?? 0}
                  sub="Disputes lost"
                  icon={XCircle}
                  active={resultVisible}
                />
              </motion.div>
              <motion.div variants={itemVariants}>
                <StatCard
                  label="Volume (IRM)"
                  value={volumeDisplay}
                  sub="Total settled"
                  icon={Activity}
                  active={resultVisible}
                />
              </motion.div>
            </motion.div>

            {/* Score history bars */}
            {data.score_history && data.score_history.length > 0 && (
              <ScoreHistoryBars
                history={data.score_history}
                active={resultVisible}
              />
            )}

            {/* Agreement history — collapsible with AnimatePresence */}
            {data.agreements && data.agreements.length > 0 && (
              <div className="card p-4">
                <button
                  className="flex items-center justify-between w-full text-left"
                  onClick={() => setShowHistory(!showHistory)}
                >
                  <p className="text-xs text-white/40 uppercase tracking-wider">
                    Agreement History ({data.agreements.length})
                  </p>
                  {showHistory ? (
                    <ChevronUp size={15} className="text-white/40" />
                  ) : (
                    <ChevronDown size={15} className="text-white/40" />
                  )}
                </button>

                <AnimatePresence initial={false}>
                  {showHistory && (
                    <motion.div
                      key="agreement-list"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.28, ease: "easeOut" }}
                      className="overflow-hidden"
                    >
                      <motion.div
                        variants={{
                          hidden: {},
                          visible: { transition: { staggerChildren: 0.06 } },
                        }}
                        initial="hidden"
                        animate="visible"
                        className="mt-3 space-y-0"
                      >
                        {data.agreements.map(
                          (ag: {
                            id: string;
                            role: string;
                            status: string;
                            amount: number;
                            timestamp: number;
                          }) => (
                            <AgreementRow key={ag.id} ag={ag} />
                          )
                        )}
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
