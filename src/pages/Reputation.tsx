import { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Star,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Activity,
  Hash,
  CheckCircle,
  XCircle,
  User,
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

// ─── ScoreRing ────────────────────────────────────────────────────────────────
// `score` is the success-rate percentage (0–100). When `hasData` is false the
// seller has no trade history on this node — show a neutral grey ring with
// "—" instead of a misleading 0/red score.
function ScoreRing({ score, active, hasData = true }: { score: number; active: boolean; hasData?: boolean }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(1, score / 100));
  const offset = circumference * (1 - pct);

  const color = !hasData
    ? "rgba(255,255,255,0.20)"
    : score >= 75
    ? "#10b981"
    : score >= 45
    ? "#f59e0b"
    : "#f43f5e";

  const displayScore = useCountUp(score, 1200, active && hasData);

  return (
    <div className="relative w-36 h-36 flex items-center justify-center">
      <svg className="w-36 h-36 -rotate-90" viewBox="0 0 128 128">
        <circle
          cx="64"
          cy="64"
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="10"
        />
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
          animate={{ strokeDashoffset: active && hasData ? offset : circumference }}
          transition={{ duration: 1.2, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-3xl font-bold font-display" style={{ color }}>
          {hasData ? displayScore : "—"}
        </span>
        <span className="text-xs text-white/40 font-mono">
          {hasData ? "% success" : "no data"}
        </span>
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

// ─── Main component ───────────────────────────────────────────────────────────
export default function Reputation() {
  const location = useLocation();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [shimmer, setShimmer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReputationData | null>(null);
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
    if (data?.seller) navigator.clipboard.writeText(data.seller);
  };

  const risk = data
    ? RISK_CONFIG[data.risk] ?? RISK_CONFIG.unknown
    : null;

  // Lifetime success rate, parsed from the binary's string format ("83.3").
  // 0 when no history exists; pair with hasData on ScoreRing for the empty
  // state so we don't show a misleading red "0/100".
  const hasData = !!data && data.total_agreements > 0;
  const successPct = data?.success_rate ? parseFloat(data.success_rate) : 0;

  // Recent-window risk lookup (separate from lifetime risk).
  const recentRiskConfig = data
    ? RISK_CONFIG[data.recent.risk] ?? RISK_CONFIG.unknown
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="h-full overflow-y-auto"
    >
    <div className="w-full space-y-6 px-8 py-6">
      {/* Header */}
      <div>
        <h1 className="page-title">Reputation</h1>
        <p className="page-subtitle">
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
                  <ScoreRing score={successPct} active={resultVisible} hasData={hasData} />

                  {/* Risk badge — pulsing if high risk */}
                  {data.risk === "high" ? (
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

                {/* Address + summary + derived flags */}
                <div className="flex-1 min-w-0 space-y-3">
                  <div>
                    <p className="text-xs text-white/40 uppercase tracking-wider mb-1">
                      Address
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-white break-all">{data.seller}</span>
                      <button onClick={copyAddr} className="text-white/40 hover:text-white shrink-0">
                        <Copy size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Summary text directly from the binary — covers the "no
                      history on this node" case and the explanatory blurb
                      for sellers that do have a record. */}
                  <p className="text-sm text-white/55">{data.summary}</p>

                  {/* Derived flags — computed client-side from the structured
                      fields the binary returns (no `flags` array exists). */}
                  <div className="flex flex-wrap gap-1.5">
                    {data.sybil_suppressed && (
                      <span className="badge badge-warning text-xs px-2 py-0.5 inline-flex items-center gap-1">
                        <AlertTriangle size={11} /> Sybil-suppressed
                      </span>
                    )}
                    {data.self_trade_count > 0 && (
                      <span className="badge badge-warning text-xs px-2 py-0.5">
                        Self-trades: {data.self_trade_count}
                      </span>
                    )}
                    {data.dispute_rate && parseFloat(data.dispute_rate) >= 10 && (
                      <span className="badge badge-warning text-xs px-2 py-0.5">
                        High disputes: {data.dispute_rate}%
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Stats grid — staggered cards. Labels and sources updated to
                match the actual binary response shape. */}
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="grid grid-cols-2 sm:grid-cols-4 gap-3"
            >
              <motion.div variants={itemVariants}>
                <StatCard
                  label="Total Agreements"
                  rawValue={data.total_agreements}
                  icon={Hash}
                  active={resultVisible}
                />
              </motion.div>
              <motion.div variants={itemVariants}>
                <StatCard
                  label="Satisfied Trades"
                  rawValue={data.satisfied ?? 0}
                  sub="Released successfully"
                  icon={CheckCircle}
                  active={resultVisible}
                />
              </motion.div>
              <motion.div variants={itemVariants}>
                <StatCard
                  label="Defaults"
                  rawValue={data.defaults ?? 0}
                  sub="Failed obligations"
                  icon={XCircle}
                  active={resultVisible}
                />
              </motion.div>
              <motion.div variants={itemVariants}>
                <StatCard
                  label="Success Rate"
                  value={data.success_rate ? `${data.success_rate}%` : "—"}
                  sub="Lifetime"
                  icon={Activity}
                  active={resultVisible}
                />
              </motion.div>
            </motion.div>

            {/* Recent window — short rolling summary from data.recent.
                Only shown when the binary has something to display, otherwise
                a tiny "no recent activity" placeholder. */}
            {recentRiskConfig && (
              <div className="card p-4">
                <p className="text-xs text-white/40 uppercase tracking-wider mb-3">
                  Recent Window
                  {data.recent.window != null && (
                    <span className="ml-1 text-white/30 normal-case tracking-normal">
                      · last {data.recent.window.toLocaleString()} blocks
                    </span>
                  )}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <div className="text-white/40 uppercase tracking-wider mb-1">Satisfied</div>
                    <div className="font-mono text-white">{data.recent.satisfied ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-white/40 uppercase tracking-wider mb-1">Defaults</div>
                    <div className="font-mono text-white">{data.recent.defaults ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-white/40 uppercase tracking-wider mb-1">Success Rate</div>
                    <div className="font-mono text-white">
                      {data.recent.success_rate ? `${data.recent.success_rate}%` : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-white/40 uppercase tracking-wider mb-1">Risk</div>
                    <div className={`inline-flex items-center gap-1 ${recentRiskConfig.color}`}>
                      <recentRiskConfig.icon size={11} />
                      {recentRiskConfig.label}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </motion.div>
  );
}
