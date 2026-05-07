import { useState } from "react";
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
    color: "text-slate-400",
    icon: User,
    bg: "bg-slate-500/10 border-slate-500/30",
  },
};

function ScoreRing({ score }: { score: number }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(1, score / 100));
  const offset = circumference * (1 - pct);

  const color =
    score >= 75
      ? "#10b981"
      : score >= 45
      ? "#f59e0b"
      : score >= 0
      ? "#f43f5e"
      : "#64748b";

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
        {/* Progress */}
        <circle
          cx="64"
          cy="64"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.8s ease" }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-3xl font-bold font-display" style={{ color }}>
          {score}
        </span>
        <span className="text-xs text-slate-500 font-mono">/ 100</span>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: typeof Activity;
}) {
  return (
    <div className="card p-4 flex items-center gap-4">
      <div className="w-10 h-10 rounded-lg bg-irium-600/20 flex items-center justify-center shrink-0">
        <Icon size={18} className="text-irium-400" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 uppercase tracking-wider">{label}</p>
        <p className="text-lg font-semibold font-mono text-white truncate">{value}</p>
        {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function AgreementRow({
  ag,
}: {
  ag: { id: string; role: string; status: string; amount: number; timestamp: number };
}) {
  const success = ag.status === "released";
  const failed = ag.status === "refunded";

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-white/5 last:border-0">
      {success ? (
        <CheckCircle size={15} className="text-emerald-400 shrink-0" />
      ) : failed ? (
        <XCircle size={15} className="text-rose-400 shrink-0" />
      ) : (
        <Clock size={15} className="text-amber-400 shrink-0" />
      )}
      <span className="font-mono text-xs text-slate-400 truncate flex-1">{ag.id}</span>
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
    </div>
  );
}

export default function Reputation() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReputationData | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const lookup = async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const result = await reputation.show(q);
      setData(result);
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

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold font-display gradient-text">Reputation Lookup</h1>
        <p className="text-sm text-slate-500 mt-1">
          Query the on-chain reputation score for any Irium address or public key.
        </p>
      </div>

      {/* Search bar */}
      <div className="card p-4 flex gap-3">
        <div className="flex-1 relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Q-prefix address or 64-hex public key…"
            className="input pl-9 w-full font-mono text-sm"
          />
        </div>
        <button
          onClick={lookup}
          disabled={!query.trim() || loading}
          className="btn-primary px-5 py-2 text-sm disabled:opacity-50 shrink-0"
        >
          {loading ? "Looking up…" : "Look Up"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="card border-rose-500/30 bg-rose-500/5 p-4 text-rose-400 text-sm">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!data && !loading && !error && (
        <div className="card p-12 flex flex-col items-center gap-4 text-center">
          <div className="w-16 h-16 rounded-full bg-irium-600/10 flex items-center justify-center">
            <Star size={28} className="text-irium-500" />
          </div>
          <div>
            <p className="text-white font-semibold">No address queried yet</p>
            <p className="text-sm text-slate-500 mt-1">
              Enter a Q-prefix address or public key above to look up their on-chain
              reputation score and agreement history.
            </p>
          </div>
        </div>
      )}

      {/* Result */}
      {data && risk && (
        <div className="space-y-4">
          {/* Profile card */}
          <div className="card p-6">
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
              {/* Score ring */}
              <div className="flex flex-col items-center gap-2">
                <ScoreRing score={data.score} />
                <div
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium ${risk.bg} ${risk.color}`}
                >
                  <risk.icon size={13} />
                  {risk.label}
                </div>
              </div>

              {/* Address + stats */}
              <div className="flex-1 min-w-0 space-y-3">
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">
                    Address
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-white break-all">{data.address}</span>
                    <button onClick={copyAddr} className="text-slate-500 hover:text-white shrink-0">
                      <Copy size={14} />
                    </button>
                  </div>
                </div>

                {/* Trend */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Score trend:</span>
                  {trend > 0 ? (
                    <span className="flex items-center gap-1 text-emerald-400 text-xs">
                      <TrendingUp size={13} /> +{trend.toFixed(1)} pts
                    </span>
                  ) : trend < 0 ? (
                    <span className="flex items-center gap-1 text-rose-400 text-xs">
                      <TrendingDown size={13} /> {trend.toFixed(1)} pts
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-slate-400 text-xs">
                      <Minus size={13} /> Stable
                    </span>
                  )}
                </div>

                {/* Badges */}
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

          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              label="Total Agreements"
              value={data.total_agreements ?? 0}
              icon={Hash}
            />
            <StatCard
              label="Released"
              value={data.released ?? 0}
              sub="Successful trades"
              icon={CheckCircle}
            />
            <StatCard
              label="Refunded"
              value={data.refunded ?? 0}
              sub="Disputes lost"
              icon={XCircle}
            />
            <StatCard
              label="Volume (IRM)"
              value={data.volume_sats ? (data.volume_sats / 1e8).toFixed(2) : "0.00"}
              sub="Total settled"
              icon={Activity}
            />
          </div>

          {/* Score history sparkline (simple bars) */}
          {data.score_history && data.score_history.length > 0 && (
            <div className="card p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-3">
                Score History
              </p>
              <div className="flex items-end gap-1 h-16">
                {data.score_history.slice(-24).map((s: number, i: number) => {
                  const h = Math.max(4, (s / 100) * 64);
                  const color = s >= 75 ? "#10b981" : s >= 45 ? "#f59e0b" : "#f43f5e";
                  return (
                    <div
                      key={i}
                      className="flex-1 rounded-t-sm"
                      style={{ height: `${h}px`, backgroundColor: color, opacity: 0.7 }}
                      title={`${s}`}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Agreement history */}
          {data.agreements && data.agreements.length > 0 && (
            <div className="card p-4">
              <button
                className="flex items-center justify-between w-full text-left"
                onClick={() => setShowHistory(!showHistory)}
              >
                <p className="text-xs text-slate-500 uppercase tracking-wider">
                  Agreement History ({data.agreements.length})
                </p>
                {showHistory ? (
                  <ChevronUp size={15} className="text-slate-500" />
                ) : (
                  <ChevronDown size={15} className="text-slate-500" />
                )}
              </button>
              {showHistory && (
                <div className="mt-3 space-y-0">
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
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
