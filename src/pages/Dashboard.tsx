import React, { useEffect, useState } from "react";
import {
  Activity,
  TrendingUp,
  Users,
  Package,
  FileText,
  ShieldCheck,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useStore } from "../lib/store";
import { agreements, wallet, offers } from "../lib/tauri";
import { formatIRM, formatSats, timeAgo, satsToIRM } from "../lib/types";
import type { Agreement, Transaction } from "../lib/types";

export default function Dashboard() {
  const nodeStatus = useStore((s) => s.nodeStatus);
  const balance = useStore((s) => s.balance);
  const [recentTx, setRecentTx] = useState<Transaction[]>([]);
  const [activeAgreements, setActiveAgreements] = useState<Agreement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [txs, agrs] = await Promise.allSettled([
        wallet.transactions(10),
        agreements.list(),
      ]);
      if (txs.status === "fulfilled") setRecentTx(txs.value);
      if (agrs.status === "fulfilled")
        setActiveAgreements(agrs.value.filter((a) => a.status === "active"));
    } catch {}
    setLoading(false);
  };

  // Synthetic sparkline from tx history
  const chartData = recentTx
    .slice()
    .reverse()
    .map((tx, i) => ({
      i,
      val: Math.abs(satsToIRM(tx.amount)),
    }));

  return (
    <div className="p-6 space-y-6 page-enter overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-2xl text-white">Dashboard</h1>
          <p className="text-white/40 text-sm mt-0.5">
            Irium blockchain overview
          </p>
        </div>
        <button onClick={loadData} className="btn-ghost" disabled={loading}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Confirmed Balance"
          value={balance ? formatIRM(balance.confirmed) : "—"}
          sub={balance ? `${balance.unconfirmed > 0 ? `+${formatIRM(balance.unconfirmed)} pending` : "All confirmed"}` : "Wallet not open"}
          icon={<TrendingUp size={18} />}
          color="irium"
        />
        <StatCard
          title="Chain Height"
          value={nodeStatus?.running ? nodeStatus.height.toLocaleString() : "—"}
          sub={nodeStatus?.synced ? "Fully synced" : nodeStatus?.running ? "Syncing..." : "Node offline"}
          icon={<Activity size={18} />}
          color="blue"
        />
        <StatCard
          title="Peers"
          value={nodeStatus?.running ? String(nodeStatus.peers) : "—"}
          sub="Connected nodes"
          icon={<Users size={18} />}
          color="green"
        />
        <StatCard
          title="Active Agreements"
          value={String(activeAgreements.length)}
          sub="Pending settlement"
          icon={<ShieldCheck size={18} />}
          color="amber"
        />
      </div>

      {/* Chart + agreements */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Transaction chart */}
        <div className="lg:col-span-2 card p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold text-white/90">
              Recent Activity
            </h2>
            <span className="badge badge-irium">Last 10 txs</span>
          </div>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#7b2fe2" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="i" hide />
                <YAxis hide />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-surface-2)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "8px",
                    color: "white",
                    fontSize: 12,
                    fontFamily: "JetBrains Mono",
                  }}
                  formatter={(v: number) => [`${v.toFixed(4)} IRM`, "Amount"]}
                />
                <Area
                  type="monotone"
                  dataKey="val"
                  stroke="#7b2fe2"
                  strokeWidth={2}
                  fill="url(#grad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState icon={<Activity />} text="No transaction history yet" />
          )}
        </div>

        {/* Active agreements */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold text-white/90">
              Active Agreements
            </h2>
            <a href="/agreements" className="text-xs text-irium-400 hover:text-irium-300">
              View all →
            </a>
          </div>
          <div className="space-y-2">
            {activeAgreements.length === 0 ? (
              <EmptyState icon={<FileText />} text="No active agreements" />
            ) : (
              activeAgreements.slice(0, 4).map((a) => (
                <AgreementRow key={a.id} agreement={a} />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Recent transactions */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display font-semibold text-white/90">
            Recent Transactions
          </h2>
        </div>
        {recentTx.length === 0 ? (
          <EmptyState icon={<Package />} text="No transactions yet" />
        ) : (
          <div className="space-y-1">
            {recentTx.map((tx) => (
              <TxRow key={tx.txid} tx={tx} />
            ))}
          </div>
        )}
      </div>
    </div>
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
  color: "irium" | "blue" | "green" | "amber";
}) {
  const colors = {
    irium: "text-irium-400 bg-irium-500/10",
    blue: "text-blue-400 bg-blue-500/10",
    green: "text-green-400 bg-green-500/10",
    amber: "text-amber-400 bg-amber-500/10",
  };

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-white/40 text-xs font-display font-semibold uppercase tracking-wider">
          {title}
        </span>
        <span className={`p-1.5 rounded-lg ${colors[color]}`}>{icon}</span>
      </div>
      <div className="font-display font-bold text-xl text-white">{value}</div>
      <div className="text-white/40 text-xs mt-0.5">{sub}</div>
    </div>
  );
}

function AgreementRow({ agreement }: { agreement: Agreement }) {
  return (
    <div className="flex items-center justify-between p-2 rounded-lg hover:bg-white/5 cursor-pointer">
      <div className="flex-1 min-w-0">
        <div className="font-mono text-xs text-white/60 truncate">
          {agreement.id}
        </div>
        <div className="text-xs text-white/40 mt-0.5">
          {formatIRM(agreement.amount)}
        </div>
      </div>
      <span className={`badge badge-info text-xs`}>{agreement.status}</span>
    </div>
  );
}

function TxRow({ tx }: { tx: Transaction }) {
  const isSend = tx.direction === "send";
  return (
    <div className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-white/3 group cursor-pointer">
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
          isSend
            ? "bg-red-500/10 text-red-400"
            : "bg-green-500/10 text-green-400"
        }`}
      >
        {isSend ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-mono text-xs text-white/60 truncate">{tx.txid}</div>
        <div className="text-xs text-white/30 mt-0.5">
          {tx.confirmations} conf
          {tx.timestamp ? ` · ${timeAgo(tx.timestamp)}` : ""}
        </div>
      </div>
      <div
        className={`font-display font-semibold text-sm ${
          isSend ? "text-red-400" : "text-green-400"
        }`}
      >
        {isSend ? "-" : "+"}
        {formatIRM(Math.abs(tx.amount))}
      </div>
    </div>
  );
}

function EmptyState({
  icon,
  text,
}: {
  icon: React.ReactNode;
  text: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-white/20">
      <div className="text-white/15">{icon}</div>
      <span className="text-xs">{text}</span>
    </div>
  );
}
