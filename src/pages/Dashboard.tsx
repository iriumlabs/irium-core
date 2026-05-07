import React, { useEffect, useRef, useState } from 'react';
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
import { wallet, agreements } from '../lib/tauri';
import { formatIRM, timeAgo, satsToIRM } from '../lib/types';
import type { Agreement, Transaction, AgreementStatus } from '../lib/types';

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
  if (status === 'active') return 'border-irium-500';
  if (status === 'released') return 'border-green-500';
  if (status === 'expired' || status === 'timeout') return 'border-red-500';
  return 'border-amber-500';
}

export default function Dashboard() {
  const navigate = useNavigate();
  const nodeStatus = useStore((s) => s.nodeStatus);
  const balance = useStore((s) => s.balance);
  const [recentTx, setRecentTx] = useState<Transaction[]>([]);
  const [activeAgreements, setActiveAgreements] = useState<Agreement[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastTip, setLastTip] = useState<string>('');
  const [tickerGlow, setTickerGlow] = useState(false);

  const statsRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(statsRef, { once: true });

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const tip = nodeStatus?.tip ?? '';
    if (tip && tip !== lastTip && lastTip !== '') {
      setTickerGlow(true);
      const t = setTimeout(() => setTickerGlow(false), 1500);
      return () => clearTimeout(t);
    }
    if (tip) setLastTip(tip);
  }, [nodeStatus?.tip]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [txs, agrs] = await Promise.allSettled([
        wallet.transactions(10),
        agreements.list(),
      ]);
      if (txs.status === 'fulfilled') setRecentTx(txs.value);
      if (agrs.status === 'fulfilled')
        setActiveAgreements(agrs.value.filter((a) => a.status === 'active'));
    } catch {}
    setLoading(false);
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
      <div className="p-6 space-y-6">
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

        <AnimatePresence>
          <motion.div
            key="ticker"
            className={`rounded-lg px-4 py-2 flex items-center gap-2 bg-surface-800 border border-white/5 transition-all duration-300 ${tickerGlow ? 'glow-purple' : ''}`}
          >
            <Activity size={12} className="text-irium-400 flex-shrink-0" />
            <span className="font-mono text-xs text-white/50">
              Block #{nodeStatus?.height ?? '—'}{' '}
              <span className="text-white/30">·</span>{' '}
              {nodeStatus?.tip ? `${nodeStatus.tip.slice(0, 16)}...` : '—'}{' '}
              <span className="text-white/30">·</span>{' '}
              {nodeStatus?.network ?? '—'}
            </span>
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
                  nodeStatus?.synced
                    ? 'Fully synced'
                    : nodeStatus?.running
                    ? 'Syncing...'
                    : 'Node offline'
                }
                icon={<Activity size={18} />}
                color="blue"
              />
              <StatCard
                title="Peers"
                value={String(peersCount)}
                sub="Connected nodes"
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
              <a href="/agreements" className="text-xs text-irium-400 hover:text-irium-300">
                View all →
              </a>
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
    <div className="glass card-interactive p-4 relative">
      <div className="flex items-start justify-between mb-3">
        <span className="text-white/40 text-xs font-display font-semibold uppercase tracking-wider">
          {title}
        </span>
        <span className={`p-1.5 rounded-full flex-shrink-0 ${colors[color]}`}>{icon}</span>
      </div>
      <div className="font-display font-bold text-xl text-white">{value}</div>
      <div className="text-white/40 text-xs mt-0.5">{sub}</div>
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
