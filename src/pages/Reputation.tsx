import { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import NodeOfflineBanner from "../components/NodeOfflineBanner";
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
  HelpCircle,
} from "lucide-react";
import { reputation, reputationActions } from "../lib/tauri";
import type { Reputation as ReputationData, ReputationOutcome } from "../lib/types";
import toast from "react-hot-toast";

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

// Approximate block-window → wall-clock conversion. Irium block time is
// nominally 600s (10 minutes). Adjust if the block target changes.
const APPROX_MINUTES_PER_BLOCK = 10;
function blocksToReadable(blocks: number): string {
  const minutes = blocks * APPROX_MINUTES_PER_BLOCK;
  if (minutes < 120) return `~${Math.round(minutes)} minutes`;
  const hours = minutes / 60;
  if (hours < 48) return `~${Math.round(hours)} hours`;
  const days = hours / 24;
  return `~${Math.round(days)} days`;
}

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

// ─── SellerProfileBlock ───────────────────────────────────────────────────────
// Extracted profile card + stats grid so the same rendering can be used
// for both the single-lookup view and the side-by-side compare mode.
// Single-mode-only elements (Record Outcome CTA, Recent Window) stay in
// the parent component since they don't make sense when comparing two
// sellers head-to-head.
function SellerProfileBlock({ data, resultVisible }: { data: ReputationData; resultVisible: boolean }) {
  const risk = RISK_CONFIG[data.risk] ?? RISK_CONFIG.unknown;
  const hasData = data.total_agreements > 0;
  const successPct = data.success_rate ? parseFloat(data.success_rate) : 0;
  const copyAddr = () => { navigator.clipboard.writeText(data.seller); };

  return (
    <div className="space-y-4">
      {/* Profile card */}
      <div className="card p-6">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
          <div className="flex flex-col items-center gap-2">
            <ScoreRing score={successPct} active={resultVisible} hasData={hasData} />
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
              <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium ${risk.bg} ${risk.color}`}>
                <risk.icon size={13} />
                {risk.label}
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0 space-y-3">
            <div>
              <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Address</p>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-white break-all">{data.seller}</span>
                <button onClick={copyAddr} className="text-white/40 hover:text-white shrink-0">
                  <Copy size={14} />
                </button>
              </div>
            </div>
            <p className="text-sm text-white/55">{data.summary}</p>
            <div className="flex flex-wrap gap-1.5">
              {data.sybil_suppressed && (
                <span
                  className="badge badge-warning text-xs px-2 py-0.5 inline-flex items-center gap-1"
                  title="Seller has fewer than 3 completed agreements — their score is provisional and they could be a new identity created to inflate reputation."
                >
                  <AlertTriangle size={11} /> Sybil-suppressed
                </span>
              )}
              {data.self_trade_count > 0 && (
                <span
                  className="badge badge-warning text-xs px-2 py-0.5"
                  title="Detected agreements where buyer and seller appear to share a key derivation root. Inflated counts here may indicate fake reputation building."
                >
                  Self-trades: {data.self_trade_count}
                </span>
              )}
              {data.dispute_rate && parseFloat(data.dispute_rate) >= 10 && (
                <span
                  className="badge badge-warning text-xs px-2 py-0.5"
                  title="More than 10% of this seller's agreements ended in dispute. Inspect their dispute history before trading."
                >
                  High disputes: {data.dispute_rate}%
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-2 sm:grid-cols-4 gap-3"
      >
        <motion.div variants={itemVariants}>
          <StatCard label="Total Agreements" rawValue={data.total_agreements} icon={Hash} active={resultVisible} />
        </motion.div>
        <motion.div variants={itemVariants}>
          <StatCard label="Satisfied Trades" rawValue={data.satisfied ?? 0} sub="Released successfully" icon={CheckCircle} active={resultVisible} />
        </motion.div>
        <motion.div variants={itemVariants}>
          <StatCard label="Defaults" rawValue={data.defaults ?? 0} sub="Failed obligations" icon={XCircle} active={resultVisible} />
        </motion.div>
        <motion.div variants={itemVariants}>
          <StatCard label="Success Rate" value={data.success_rate ? `${data.success_rate}%` : "—"} sub="Lifetime" icon={Activity} active={resultVisible} />
        </motion.div>
      </motion.div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function Reputation() {
  const location = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [shimmer, setShimmer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReputationData | null>(null);
  const [resultVisible, setResultVisible] = useState(false);
  const [showOutcomeModal, setShowOutcomeModal] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Recent lookups — last 5 queried addresses, persisted to localStorage so
  // they survive page reloads. Surfaced as clickable chips below the
  // search bar(s) for quick re-query.
  const [recentLookups, setRecentLookups] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('irium_reputation_recent_lookups');
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr.filter((x) => typeof x === 'string').slice(0, 5);
      }
    } catch {}
    return [];
  });
  // Compare-mode state — second seller's lookup runs in parallel to the
  // first. Each slot mirrors the single-mode state so the existing
  // single-lookup logic stays unchanged.
  const [compareMode, setCompareMode] = useState(false);
  const [secondQuery, setSecondQuery] = useState("");
  const [secondData, setSecondData] = useState<ReputationData | null>(null);
  const [secondLoading, setSecondLoading] = useState(false);
  const [secondShimmer, setSecondShimmer] = useState(false);
  const [secondError, setSecondError] = useState<string | null>(null);
  const [secondResultVisible, setSecondResultVisible] = useState(false);

  const pushRecentLookup = (addr: string) => {
    setRecentLookups((prev) => {
      const next = [addr, ...prev.filter((x) => x !== addr)].slice(0, 5);
      try { localStorage.setItem('irium_reputation_recent_lookups', JSON.stringify(next)); } catch {}
      return next;
    });
  };

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
      pushRecentLookup(q);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // Second-slot lookup for compare mode. Mirrors the shape of `lookup`
  // exactly — same shimmer cadence, same error/result state transitions —
  // just writing into the second-slot state slots.
  const lookupSecond = async (overrideQuery?: string) => {
    const q = (overrideQuery ?? secondQuery).trim();
    if (!q) return;
    setSecondResultVisible(false);
    setSecondData(null);
    setSecondError(null);
    setSecondLoading(true);
    setSecondShimmer(true);
    await new Promise((r) => setTimeout(r, 600));
    setSecondShimmer(false);
    try {
      const result = await reputation.show(q);
      setSecondData(result);
      setSecondResultVisible(true);
      pushRecentLookup(q);
    } catch (e: unknown) {
      setSecondError(e instanceof Error ? e.message : String(e));
    } finally {
      setSecondLoading(false);
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
      <NodeOfflineBanner />
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Reputation</h1>
          <p className="page-subtitle">
            Query the on-chain reputation score for any Irium address or public key.
          </p>
        </div>
        <button
          onClick={() => navigate('/help#reputation')}
          className="btn-ghost p-2 text-white/40 hover:text-white/80 flex-shrink-0 mt-1"
          title="Reputation help"
        >
          <HelpCircle size={18} />
        </button>
      </div>

      {/* Search bar (first seller) */}
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
        <button
          onClick={() => setCompareMode((v) => !v)}
          title="Compare two sellers side by side"
          className={`btn-secondary px-4 py-2 text-sm shrink-0 ${compareMode ? 'bg-irium-500/30 border-irium-500/40 text-irium-200' : ''}`}
        >
          Compare
        </button>
      </div>

      {/* Second search bar — only in compare mode */}
      {compareMode && (
        <div className="card p-4 flex gap-3">
          <div className="flex-1 relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none"
            />
            <input
              type="text"
              value={secondQuery}
              onChange={(e) => setSecondQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') lookupSecond(); }}
              placeholder="Second seller's Q-prefix address or 64-hex pubkey…"
              disabled={secondLoading}
              className={`input pl-9 w-full font-mono text-sm disabled:opacity-60 disabled:cursor-not-allowed transition-opacity ${
                secondShimmer ? "shimmer" : ""
              }`}
            />
          </div>
          <button
            onClick={() => lookupSecond()}
            disabled={!secondQuery.trim() || secondLoading}
            className="btn-primary px-5 py-2 text-sm disabled:opacity-50 shrink-0"
          >
            {secondLoading ? "Looking up…" : "Look Up"}
          </button>
        </div>
      )}

      {/* Recent lookups — clickable chips, click pre-fills and submits. */}
      {recentLookups.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-white/40 uppercase tracking-wider">Recent lookups</span>
          {recentLookups.map((addr) => (
            <button
              key={addr}
              onClick={() => {
                if (compareMode && data) {
                  setSecondQuery(addr);
                  lookupSecond(addr);
                } else {
                  setQuery(addr);
                  lookup(addr);
                }
              }}
              className="px-2 py-1 rounded-full bg-surface-600 hover:bg-irium-500/20 font-mono text-white/60 hover:text-white"
              title={addr}
            >
              {addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-4)}` : addr}
            </button>
          ))}
        </div>
      )}

      {/* Compare-mode result area — 2-column grid, each slot showing its
          own loading / error / result / empty state independently. Uses the
          extracted SellerProfileBlock so we don't duplicate ~120 lines of
          JSX. Single mode (below) keeps its existing AnimatePresence
          rendering unchanged. */}
      {compareMode ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-4">
            {loading ? (
              <div className="card p-6 text-center text-white/30 text-sm">Loading…</div>
            ) : error ? (
              <div className="card border-rose-500/30 bg-rose-500/5 p-4 text-rose-400 text-sm">{error}</div>
            ) : resultVisible && data ? (
              <SellerProfileBlock data={data} resultVisible={resultVisible} />
            ) : (
              <div className="card p-6 text-center text-white/30 text-sm">Search for a seller above</div>
            )}
          </div>
          <div className="space-y-4">
            {secondLoading ? (
              <div className="card p-6 text-center text-white/30 text-sm">Loading…</div>
            ) : secondError ? (
              <div className="card border-rose-500/30 bg-rose-500/5 p-4 text-rose-400 text-sm">{secondError}</div>
            ) : secondResultVisible && secondData ? (
              <SellerProfileBlock data={secondData} resultVisible={secondResultVisible} />
            ) : (
              <div className="card p-6 text-center text-white/30 text-sm">Search for a second seller to compare</div>
            )}
          </div>
        </div>
      ) : (
        <>
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
                Enter a seller's Q-prefix address or public key to check their trade history, completion rate, and risk level before you trade with them.
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
                      <span
                        className="badge badge-warning text-xs px-2 py-0.5 inline-flex items-center gap-1"
                        title="Seller has fewer than 3 completed agreements — their score is provisional and they could be a new identity created to inflate reputation."
                      >
                        <AlertTriangle size={11} /> Sybil-suppressed
                      </span>
                    )}
                    {data.self_trade_count > 0 && (
                      <span
                        className="badge badge-warning text-xs px-2 py-0.5"
                        title="Detected agreements where buyer and seller appear to share a key derivation root. Inflated counts here may indicate fake reputation building."
                      >
                        Self-trades: {data.self_trade_count}
                      </span>
                    )}
                    {data.dispute_rate && parseFloat(data.dispute_rate) >= 10 && (
                      <span
                        className="badge badge-warning text-xs px-2 py-0.5"
                        title="More than 10% of this seller's agreements ended in dispute. Inspect their dispute history before trading."
                      >
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

            {/* Record outcome CTA — visible whenever a seller has been
                looked up. Opens the OutcomeModal which writes to the local
                reputation DB via reputation_record_outcome. */}
            <div className="card p-4 flex items-center justify-between gap-3">
              <div className="text-xs">
                <p className="text-white font-semibold">Just traded with this seller?</p>
                <p className="text-white/40 mt-0.5">
                  Record the outcome to your local reputation database. Future lookups will reflect it.
                </p>
              </div>
              <button
                onClick={() => setShowOutcomeModal(true)}
                className="btn-secondary text-xs py-1.5 px-3 flex-shrink-0"
              >
                Record Outcome
              </button>
            </div>

            {/* Recent window — short rolling summary from data.recent.
                Only shown when the binary has something to display, otherwise
                a tiny "no recent activity" placeholder. */}
            {recentRiskConfig && (
              <div className="card p-4">
                <p className="text-xs text-white/40 uppercase tracking-wider mb-3">
                  Recent Window
                  {data.recent.window != null && (
                    <span className="ml-1 text-white/30 normal-case tracking-normal">
                      · last {data.recent.window.toLocaleString()} blocks ({blocksToReadable(data.recent.window)})
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
        </>
      )}

      {/* Outcome recording modal */}
      <AnimatePresence>
        {showOutcomeModal && data && (
          <OutcomeModal
            seller={data.seller}
            onClose={() => setShowOutcomeModal(false)}
            onSuccess={() => {
              setShowOutcomeModal(false);
              // Re-lookup so the new outcome reflects in the displayed stats.
              lookup(data.seller);
            }}
          />
        )}
      </AnimatePresence>
    </div>
    </motion.div>
  );
}

// ─── Outcome recording modal ─────────────────────────────────────────────────
// Writes a trade outcome to the local reputation database via
// reputation_record_outcome. Local-only — sellers cannot see what individual
// buyers record about them (per WHITEPAPER §10 L645-660: "no central
// reputation server, no shared reputation ledger").

const OUTCOMES: { value: ReputationOutcome; label: string; color: string; sub: string }[] = [
  { value: 'satisfied', label: 'Satisfied', color: '#10b981', sub: 'Trade completed successfully' },
  { value: 'failed',    label: 'Failed',    color: '#f43f5e', sub: 'Counterparty did not perform'    },
  { value: 'disputed',  label: 'Disputed',  color: '#f59e0b', sub: 'Required a resolver attestation'  },
  { value: 'timeout',   label: 'Timeout',   color: '#a78bfa', sub: 'Deadline passed without resolution' },
];

function OutcomeModal({
  seller,
  onClose,
  onSuccess,
}: {
  seller: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [choice, setChoice] = useState<ReputationOutcome | null>(null);
  const [proofResponseSecs, setProofResponseSecs] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    if (!choice) return;
    setSubmitting(true);
    try {
      const secs = proofResponseSecs.trim() ? parseInt(proofResponseSecs, 10) : undefined;
      const result = await reputationActions.recordOutcome(
        seller,
        choice,
        Number.isFinite(secs) ? secs : undefined,
      );
      if (result.success) {
        toast.success(`Recorded "${choice}" for this seller`);
        onSuccess();
      } else {
        toast.error(result.message ?? 'Failed to record outcome');
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const truncated = seller.length > 16 ? `${seller.slice(0, 8)}…${seller.slice(-6)}` : seller;

  return (
    <motion.div
      key="outcome-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 16 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 8 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="card w-full max-w-md p-6 rounded-2xl"
      >
        <div className="mb-2">
          <h2 className="font-display font-bold text-lg text-white">Record Outcome</h2>
          <p className="text-xs text-white/40 mt-0.5">
            with <span className="font-mono text-white/60">{truncated}</span>
          </p>
        </div>

        <p className="text-xs text-white/50 mb-4">
          This adds to your <strong className="text-white/70">local</strong> reputation database. Only you see it. Sellers can request a signed export later if both parties agree.
        </p>

        <div className="space-y-2 mb-4">
          {OUTCOMES.map((o) => {
            const selected = choice === o.value;
            return (
              <button
                key={o.value}
                onClick={() => setChoice(o.value)}
                className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors flex items-center gap-3 ${
                  selected
                    ? 'bg-white/5'
                    : 'border-white/5 hover:bg-white/[0.03]'
                }`}
                style={{
                  borderColor: selected ? o.color : undefined,
                  background: selected ? `${o.color}14` : undefined,
                }}
              >
                <span
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ background: selected ? o.color : `${o.color}55` }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-display font-semibold" style={{ color: selected ? o.color : 'rgba(238,240,255,0.8)' }}>
                    {o.label}
                  </div>
                  <div className="text-[11px] text-white/40">{o.sub}</div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mb-5">
          <label className="label">Proof response time (optional, seconds)</label>
          <input
            type="number"
            min="0"
            value={proofResponseSecs}
            onChange={(e) => setProofResponseSecs(e.target.value)}
            placeholder="e.g. 3600 for 1 hour"
            className="input text-xs"
          />
          <p className="text-[11px] text-white/30 mt-1">
            How long from funding to proof submission. Used for the avg_proof_response_secs reputation signal.
          </p>
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1 justify-center">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!choice || submitting}
            className="btn-primary flex-1 justify-center disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? 'Recording…' : 'Record Outcome'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
