import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Copy, CheckCircle2, RefreshCw, Search,
  Cpu, Users, Layers, Clock, Activity, Zap, TrendingUp, Coins,
  Wallet, ArrowRightLeft, Trophy, Medal, Award, Server, UserCircle2, Lock,
} from 'lucide-react';
import { useStore } from '../lib/store';
import { rpc, wallet } from '../lib/tauri';
import { timeAgo, formatIRM, SATS_PER_IRM } from '../lib/types';
import type { ExplorerBlock, NetworkHashrateInfo, RichListEntry, PoolStats } from '../lib/types';

type SearchTab = 'block' | 'tx' | 'address';
type PageTab = 'overview' | 'rich_list' | 'pool_stats';

// ── Helpers ───────────────────────────────────────────────────

const HALVING_INTERVAL = 50_000;

// Founder-vesting CLTV unlock height. Decoded from the genesis transaction's
// output script: `03 f067 02 b1 75 76 a9 14 …` → height 0x0267f0 = 158704,
// followed by OP_CHECKLOCKTIMEVERIFY OP_DROP and a standard P2PKH script.
// Surfaced in the Rich List as a transparency signal so the community can see
// where the missing supply lives and when it becomes spendable.
const FOUNDER_VESTING_UNLOCK_HEIGHT = 158_704;

// Founder-vesting recipient address — derived from the genesis transaction's
// output PKH (0ae5debfc6279fdb002c0da105be6d0645aac398) under Irium's P2PKH
// version byte 0x39. Verified against /rpc/address: returns balance=0 because
// the UTXO is CLTV-locked and not yet spendable (the gap appears as
// totalSupply - circulating in the Rich List's Locked/Vested panel).
const FOUNDER_VESTING_ADDRESS = 'PxG1FmGiSnvfXJUcryLna2L5MB4iGG1KD7';

function blockReward(height: number): string {
  const halvings = Math.floor(height / HALVING_INTERVAL);
  const reward = 50 * Math.pow(0.5, halvings);
  return `${reward.toFixed(reward < 1 ? 4 : 0)} IRM`;
}

function computeCirculatingSupply(height: number): string {
  let supply = 0;
  let h = height;
  let reward = 50;
  while (h > 0 && reward >= 1e-8) {
    const era = Math.min(h, HALVING_INTERVAL);
    supply += era * reward;
    h -= era;
    reward /= 2;
  }
  if (supply >= 1_000_000) return `${(supply / 1_000_000).toFixed(2)}M IRM`;
  if (supply >= 1_000)     return `${(supply / 1_000).toFixed(1)}K IRM`;
  return `${supply.toFixed(0)} IRM`;
}

function nextHalvingBlock(height: number): number {
  const halvings = Math.floor(height / HALVING_INTERVAL);
  return (halvings + 1) * HALVING_INTERVAL;
}

function formatHashrate(hps: number): string {
  if (!hps || hps <= 0) return '—';
  if (hps >= 1e12) return `${(hps / 1e12).toFixed(2)} TH/s`;
  if (hps >= 1e9)  return `${(hps / 1e9).toFixed(2)} GH/s`;
  if (hps >= 1e6)  return `${(hps / 1e6).toFixed(2)} MH/s`;
  if (hps >= 1e3)  return `${(hps / 1e3).toFixed(2)} KH/s`;
  return `${hps.toFixed(1)} H/s`;
}

function formatDifficulty(diff: number): string {
  if (!diff || diff <= 0) return '—';
  if (diff >= 1e12) return `${(diff / 1e12).toFixed(3)}T`;
  if (diff >= 1e9)  return `${(diff / 1e9).toFixed(3)}G`;
  if (diff >= 1e6)  return `${(diff / 1e6).toFixed(3)}M`;
  if (diff >= 1e3)  return `${(diff / 1e3).toFixed(1)}K`;
  return diff.toFixed(2);
}

function uniqueMiners(blocks: ExplorerBlock[]): number {
  return new Set(blocks.map((b) => b.miner_address).filter(Boolean)).size;
}

// Merge two block arrays by height (dedup), sorted newest-first
function mergeBlocks(existing: ExplorerBlock[], incoming: ExplorerBlock[]): ExplorerBlock[] {
  const map = new Map(existing.map((b) => [b.height, b]));
  for (const b of incoming) map.set(b.height, b);
  return Array.from(map.values()).sort((a, b) => b.height - a.height);
}

// ── Copy button ───────────────────────────────────────────────

function CopyBtn({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        });
      }}
      className="opacity-0 group-hover:opacity-40 hover:!opacity-80 transition-opacity ml-1 flex-shrink-0"
      title={t('common.copy')}
    >
      {copied
        ? <CheckCircle2 size={11} style={{ color: '#34d399' }} />
        : <Copy size={11} />}
    </button>
  );
}

// ── Stat card ─────────────────────────────────────────────────

function StatCard({
  icon: Icon, label, value, sub, accent = '#6ec6ff',
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div
      className="flex flex-col gap-1.5 px-4 py-3"
      style={{
        background: 'var(--bg-elev-1)',
        border: '1px solid rgba(110,198,255,0.10)',
        borderRadius: 8,
      }}
    >
      <div className="flex items-center gap-1.5">
        <Icon size={10} style={{ color: accent, opacity: 0.75 }} />
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.30)', fontFamily: '"Space Grotesk", sans-serif' }}>
          {label}
        </span>
      </div>
      <span style={{ fontSize: 17, fontWeight: 800, color: '#eef0ff', fontVariantNumeric: 'tabular-nums', fontFamily: '"Space Grotesk", sans-serif', lineHeight: 1.2 }}>
        {value}
      </span>
      {sub && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.28)' }}>{sub}</span>}
    </div>
  );
}

function StatCardSkeleton() {
  return (
    <div className="px-4 py-3 animate-pulse" style={{ background: 'var(--bg-elev-1)', border: '1px solid rgba(110,198,255,0.06)', borderRadius: 8, minHeight: 76 }}>
      <div className="h-2 w-12 rounded mb-2" style={{ background: 'rgba(255,255,255,0.05)' }} />
      <div className="h-5 w-20 rounded" style={{ background: 'rgba(255,255,255,0.05)' }} />
    </div>
  );
}

// ── Block detail modal ────────────────────────────────────────

function BlockDetailModal({ block, onClose }: { block: ExplorerBlock; onClose: () => void }) {
  const { t } = useTranslation();
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const rows = [
    { label: t('explorer.block_modal.label_height'),       value: `#${block.height.toLocaleString('en-US')}`,                                   mono: true,  copy: false },
    { label: t('explorer.block_modal.label_hash'),         value: block.hash || '—',                                                            mono: true,  copy: !!block.hash },
    { label: t('explorer.block_modal.label_prev_hash'),    value: block.prev_hash || '—',                                                       mono: true,  copy: !!block.prev_hash },
    { label: t('explorer.block_modal.label_merkle'),       value: block.merkle_root || '—',                                                     mono: true,  copy: !!block.merkle_root },
    { label: t('explorer.block_modal.label_time'),         value: block.time ? new Date(block.time * 1000).toLocaleString('en-US') : '—',       mono: false, copy: false },
    // H-13/L-12: Reward is computed client-side from a hardcoded halving formula
    // (HALVING_INTERVAL = 50_000, initial = 50 IRM). iriumd doesn't currently
    // expose a parsed reward per block, so this is an estimate based on the
    // launch consensus parameters. The "(estimated)" label makes that explicit.
    { label: t('explorer.block_modal.label_reward'),       value: t('explorer.block_modal.label_reward_with_estimated', { reward: blockReward(block.height) }), mono: true,  copy: false, color: '#34d399' },
    { label: t('explorer.block_modal.label_transactions'), value: String(block.tx_count),                                                       mono: true,  copy: false },
    { label: t('explorer.block_modal.label_bits'),         value: block.bits || '—',                                                            mono: true,  copy: false },
    { label: t('explorer.block_modal.label_nonce'),        value: block.nonce != null ? String(block.nonce) : '—',                              mono: true,  copy: false },
    { label: t('explorer.block_modal.label_miner'),        value: block.miner_address || '—',                                                   mono: true,  copy: !!block.miner_address },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, y: 12 }} transition={{ duration: 0.16 }}
        className="w-full max-w-2xl"
        style={{ background: 'rgba(5,8,20,0.99)', border: '1px solid rgba(110,198,255,0.22)', borderRadius: 10, padding: 24, boxShadow: '0 32px 80px rgba(0,0,0,0.9)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <Layers size={14} style={{ color: '#6ec6ff' }} />
            <span style={{ fontFamily: '"Space Grotesk", sans-serif', fontSize: 16, fontWeight: 800, color: '#6ec6ff' }}>
              {t('explorer.block_modal.title_prefix')} #{block.height.toLocaleString('en-US')}
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.35)' }}
          >
            ×
          </button>
        </div>
        <div className="space-y-2.5">
          {rows.map(({ label, value, mono, copy, color }) => (
            <div key={label} className="flex items-start gap-3">
              <span className="flex-shrink-0 w-28 text-right" style={{ fontSize: 10, color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase', letterSpacing: '0.1em', paddingTop: 2, fontFamily: '"Space Grotesk", sans-serif' }}>
                {label}
              </span>
              <div className="group flex items-center min-w-0 flex-1">
                <span className="break-all" style={{ fontSize: 12, color: color ?? 'rgba(255,255,255,0.80)', fontFamily: mono ? '"JetBrains Mono", monospace' : 'inherit' }}>
                  {value}
                </span>
                {copy && value !== '—' && <CopyBtn text={value} />}
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Search result viewer ──────────────────────────────────────

function SearchResultCard({ result, title }: { result: Record<string, unknown>; title?: string }) {
  const fields = Object.entries(result).filter(([, v]) => v !== null && v !== undefined && v !== '');
  return (
    <div style={{ background: 'rgba(110,198,255,0.04)', border: '1px solid rgba(110,198,255,0.18)', borderRadius: 8, padding: '14px 16px', marginTop: 10 }}>
      {title && (
        <div className="mb-2.5" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#6ec6ff', opacity: 0.7 }}>
          {title}
        </div>
      )}
      <div className="space-y-2">
        {fields.map(([key, val]) => (
          <div key={key} className="flex items-start gap-3">
            <span className="flex-shrink-0 w-28 text-right" style={{ fontSize: 10, color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase', letterSpacing: '0.08em', paddingTop: 1, fontFamily: '"Space Grotesk", sans-serif' }}>
              {key.replace(/_/g, ' ')}
            </span>
            <div className="group flex items-center min-w-0 flex-1">
              <span className="break-all" style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.75)', fontFamily: '"JetBrains Mono", monospace' }}>
                {String(val)}
              </span>
              {typeof val === 'string' && val.length > 16 && <CopyBtn text={val} />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Section label ─────────────────────────────────────────────

function SectionLabel({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(110,198,255,0.55)', fontFamily: '"Space Grotesk", sans-serif', whiteSpace: 'nowrap' }}>
        {title}
      </span>
      <div className="flex-1 h-px" style={{ background: 'rgba(110,198,255,0.08)' }} />
      {right}
    </div>
  );
}

// ── Tab button ────────────────────────────────────────────────

function TabBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: React.ElementType; label: string }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold transition-all"
      style={{
        borderRadius: 6,
        background: active ? 'rgba(110,198,255,0.12)' : 'transparent',
        color: active ? '#6ec6ff' : 'rgba(255,255,255,0.35)',
        border: active ? '1px solid rgba(110,198,255,0.30)' : '1px solid transparent',
        fontFamily: '"Space Grotesk", sans-serif',
        letterSpacing: '0.04em',
      }}
    >
      <Icon size={11} />
      {label}
    </button>
  );
}

const TH_STYLE: React.CSSProperties = {
  fontSize: 9.5, fontWeight: 700, letterSpacing: '0.13em',
  textTransform: 'uppercase', color: 'rgba(110,198,255,0.40)',
  fontFamily: '"Space Grotesk", sans-serif',
};

// ── Block table row ───────────────────────────────────────────

function BlockRow({ block, onClick }: { block: ExplorerBlock; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <motion.tr
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.14 }}
      className="group cursor-pointer"
      style={{ borderBottom: '1px solid rgba(255,255,255,0.035)', transition: 'background 0.1s' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(110,198,255,0.04)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      onClick={onClick}
    >
      {/* Height */}
      <td className="pl-4 pr-2 py-2.5 whitespace-nowrap">
        <span style={{ fontFamily: '"Space Grotesk", sans-serif', fontSize: 13, fontWeight: 800, color: '#6ec6ff' }}>
          #{block.height.toLocaleString('en-US')}
        </span>
      </td>
      {/* Hash — full 64-char hash with break-all so it wraps to fill
          available width rather than truncating with an ellipsis. The
          containing td drops whitespace-nowrap; items-start aligns the
          copy button with the first line of the wrapped hash. */}
      <td className="px-2 py-2.5">
        <div className="group flex items-start gap-1">
          <span className="break-all" style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
            {block.hash}
          </span>
          <CopyBtn text={block.hash} />
        </div>
      </td>
      {/* Age */}
      <td className="px-2 py-2.5 whitespace-nowrap">
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.30)' }}>
          {block.time ? timeAgo(block.time) : '—'}
        </span>
      </td>
      {/* Txs */}
      <td className="px-2 py-2.5 text-center whitespace-nowrap">
        <span style={{ fontSize: 11, color: 'rgba(110,198,255,0.65)', fontVariantNumeric: 'tabular-nums', fontFamily: '"JetBrains Mono", monospace' }}>
          {block.tx_count}
        </span>
      </td>
      {/* Miner — whitespace-nowrap keeps full address on one line; browser sizes column naturally */}
      <td className="px-2 py-2.5 whitespace-nowrap">
        <div className="group flex items-center">
          <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>
            {block.miner_address || '—'}
          </span>
          {block.miner_address && <CopyBtn text={block.miner_address} />}
        </div>
      </td>
      {/* Reward */}
      <td className="pl-2 pr-4 py-2.5 text-right whitespace-nowrap">
        <span
          style={{ fontSize: 11, color: '#34d399', fontVariantNumeric: 'tabular-nums', fontFamily: '"JetBrains Mono", monospace' }}
          title={t('explorer.blocks_table.estimated_tooltip')}
        >
          {blockReward(block.height)}
          <span style={{ color: 'rgba(255,255,255,0.30)', marginLeft: 4 }}>~</span>
        </span>
      </td>
    </motion.tr>
  );
}

// ── Page tab button — visually heavier than the search tabs so it reads
//    as a top-level mode switch (Overview / Rich List) rather than a
//    nested filter inside a panel. Uses the same brand gradient accents
//    used for the Miner tab strip and Settlement Hub.
function PageTabBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: React.ElementType; label: string }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-all"
      style={{
        borderRadius: 8,
        background: active
          ? 'linear-gradient(135deg, rgba(110,198,255,0.20) 0%, rgba(167,139,250,0.14) 100%)'
          : 'transparent',
        color: active ? '#d4eeff' : 'rgba(255,255,255,0.35)',
        border: active ? '1px solid rgba(110,198,255,0.40)' : '1px solid rgba(255,255,255,0.06)',
        fontFamily: '"Space Grotesk", sans-serif',
        letterSpacing: '0.04em',
      }}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

// ── Rich List section ────────────────────────────────────────
//
// Renders /rpc/richlist passthrough results as a ranked table with rank
// 1-3 medals, a "You" badge for any address belonging to the local
// wallet, and a single "Load top 500" expansion. Fetches on mount and
// whenever the user clicks Refresh — never polls (the rich list is
// expensive enough server-side that constant polling would be wasteful
// and the data only changes meaningfully across many blocks anyway).

function rankAccent(rank: number): { color: string; Icon: React.ElementType | null } {
  if (rank === 1) return { color: '#fbbf24', Icon: Trophy };  // gold
  if (rank === 2) return { color: '#cbd5e1', Icon: Medal  };  // silver
  if (rank === 3) return { color: '#fb923c', Icon: Award  };  // bronze
  return { color: 'rgba(255,255,255,0.30)', Icon: null };
}

function shortAddr(a: string): string {
  return a.length > 18 ? `${a.slice(0, 10)}…${a.slice(-6)}` : a;
}

// ── Pool Stats section ───────────────────────────────────────
//
// Renders the official-pool snapshot fetched via get_pool_stats. The
// data source is a Python proxy on irium-vps:3337 that scrapes the
// loopback /metrics endpoints of both irium-stratum profiles and
// combines them. We never poll automatically — the section fetches once
// on mount and on each Refresh click. Stats change slowly enough that
// background polling would be wasteful and risk hammering the proxy.

function PoolStatsTile({
  label, value, sub, accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: string;
}) {
  return (
    <div
      className="flex flex-col gap-1.5 px-4 py-3"
      style={{
        background: 'var(--bg-elev-1)',
        border: '1px solid rgba(110,198,255,0.10)',
        borderRadius: 8,
      }}
    >
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.30)', fontFamily: '"Space Grotesk", sans-serif' }}>
        {label}
      </span>
      <span style={{ fontSize: 22, fontWeight: 800, color: accent, fontVariantNumeric: 'tabular-nums', fontFamily: '"Space Grotesk", sans-serif', lineHeight: 1.1 }}>
        {value}
      </span>
      {sub && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.40)' }}>{sub}</span>}
    </div>
  );
}

function PoolStatsSection() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>('');
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const result = await rpc.poolStats();
      if (!result) throw new Error('empty response');
      setStats(result);
      setLastUpdated(Math.floor(Date.now() / 1000));
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const integrityLabel = (raw: string) =>
    raw === 'healthy' ? t('explorer.pool_stats.integrity_healthy')
    : t('explorer.pool_stats.integrity_unknown');

  const integrityColor = (raw: string) =>
    raw === 'healthy' ? '#34d399' : 'rgba(255,255,255,0.40)';

  // Format a hashrate in H/s into a compact unit (KH/s, MH/s, GH/s, TH/s).
  // The pool proxy's estimate is best-effort: it uses the configured default
  // share difficulty, so under vardiff drift the displayed number lags the
  // true hashrate by up to ~2-4x. Confidence is signalled separately by the
  // proxy and rendered as a small subscript.
  const formatHashrate = (hps: number) => {
    if (hps >= 1e12) return `${(hps / 1e12).toFixed(2)} TH/s`;
    if (hps >= 1e9)  return `${(hps / 1e9).toFixed(2)} GH/s`;
    if (hps >= 1e6)  return `${(hps / 1e6).toFixed(2)} MH/s`;
    if (hps >= 1e3)  return `${(hps / 1e3).toFixed(2)} KH/s`;
    return `${Math.round(hps)} H/s`;
  };
  const confidenceLabel = (c: string) =>
    c === 'high'   ? t('explorer.pool_stats.confidence_high')
    : c === 'medium' ? t('explorer.pool_stats.confidence_medium')
    : t('explorer.pool_stats.confidence_low');
  const confidenceColor = (c: string) =>
    c === 'high' ? '#34d399' : c === 'medium' ? '#fbbf24' : 'rgba(255,255,255,0.45)';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: '#d4eeff', fontFamily: '"Space Grotesk", sans-serif', letterSpacing: '0.02em' }}>
            {t('explorer.pool_stats.title')}
          </h2>
          <p className="mt-1" style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)' }}>
            {t('explorer.pool_stats.subtitle')}
          </p>
          {lastUpdated && (
            <p className="mt-1" style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: 'rgba(110,198,255,0.55)' }}>
              {t('explorer.pool_stats.last_updated', { ago: timeAgo(lastUpdated) })}
            </p>
          )}
        </div>
        <button
          onClick={fetchStats}
          disabled={loading}
          className="btn-secondary text-xs gap-2 flex-shrink-0"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          {loading ? t('explorer.pool_stats.refreshing') : t('explorer.pool_stats.refresh')}
        </button>
      </div>

      {/* Error / loading / content */}
      {err ? (
        <div className="py-10 text-center text-sm" style={{ background: 'rgba(244,63,94,0.06)', border: '1px solid rgba(244,63,94,0.20)', borderRadius: 8, color: '#fda4af' }}>
          {t('explorer.pool_stats.load_error')}
        </div>
      ) : loading && !stats ? (
        <div className="py-10 text-center text-sm" style={{ background: 'var(--bg-elev-1)', border: '1px solid rgba(110,198,255,0.08)', borderRadius: 8, color: 'rgba(255,255,255,0.30)' }}>
          {t('explorer.pool_stats.loading')}
        </div>
      ) : !stats ? (
        <div className="py-10 text-center text-sm" style={{ background: 'var(--bg-elev-1)', border: '1px solid rgba(110,198,255,0.07)', borderRadius: 8, color: 'rgba(255,255,255,0.30)' }}>
          {t('explorer.pool_stats.empty')}
        </div>
      ) : (
        <>
          {(() => {
            // Effective miner count per profile: only count a profile as
            // having "active miners" once at least one share has been
            // accepted. Otherwise the displayed number is 0, regardless of
            // how many raw TCP sessions are open — those are dominated by
            // port scanners and abandoned connections in practice. The raw
            // socket count is still surfaced below as "TCP connections".
            const asicEffective = stats.asic.accepted_shares > 0 ? stats.asic.active_miners : 0;
            const cpuEffective = stats.cpu_gpu.accepted_shares > 0 ? stats.cpu_gpu.active_miners : 0;
            const totalEffective = asicEffective + cpuEffective;
            return (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <PoolStatsTile
                    label={t('explorer.pool_stats.total_miners')}
                    value={totalEffective.toLocaleString('en-US')}
                    accent="#6ec6ff"
                  />
                  <PoolStatsTile
                    label={t('explorer.pool_stats.asic_miners')}
                    value={asicEffective.toLocaleString('en-US')}
                    sub={t('explorer.pool_stats.asic_port', { port: stats.asic_port })}
                    accent="#a78bfa"
                  />
                  <PoolStatsTile
                    label={t('explorer.pool_stats.cpu_gpu_miners')}
                    value={cpuEffective.toLocaleString('en-US')}
                    sub={t('explorer.pool_stats.cpu_gpu_port', { port: stats.cpu_gpu_port })}
                    accent="#a78bfa"
                  />
                  <PoolStatsTile
                    label={t('explorer.pool_stats.total_blocks_found')}
                    value={stats.total_blocks_found.toLocaleString('en-US')}
                    accent="#34d399"
                  />
                </div>
                <p className="mt-2" style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', fontStyle: 'italic' }}>
                  {t('explorer.pool_stats.scanner_note')}
                </p>
              </>
            );
          })()}

          {/* Per-profile detail panel */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {([
              { key: 'asic',    label: t('explorer.pool_stats.asic_miners'),    port: stats.asic_port,    data: stats.asic },
              { key: 'cpu_gpu', label: t('explorer.pool_stats.cpu_gpu_miners'), port: stats.cpu_gpu_port, data: stats.cpu_gpu },
            ] as const).map(({ key, label, port, data }) => (
              <div
                key={key}
                className="p-4"
                style={{ background: 'var(--bg-elev-1)', border: '1px solid rgba(110,198,255,0.13)', borderRadius: 8 }}
              >
                <div className="flex items-center justify-between mb-3">
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#d4eeff', fontFamily: '"Space Grotesk", sans-serif' }}>
                    {label}
                  </span>
                  <span className="font-mono" style={{ fontSize: 11, color: 'rgba(110,198,255,0.55)' }}>:{port}</span>
                </div>
                {/* Rolling-window hashrate estimate from the proxy. */}
                <div
                  className="mb-3 px-3 py-2 flex items-baseline justify-between gap-3"
                  style={{
                    background: 'rgba(110,198,255,0.05)',
                    border: '1px solid rgba(110,198,255,0.10)',
                    borderRadius: 6,
                  }}
                >
                  <div className="flex flex-col">
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.30)', fontFamily: '"Space Grotesk", sans-serif' }}>
                      {t('explorer.pool_stats.hashrate')}
                    </span>
                    {data.hashrate_estimate_hps == null ? (
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.55)', fontFamily: '"Space Grotesk", sans-serif' }}>
                        {t('explorer.pool_stats.hashrate_collecting')}
                      </span>
                    ) : (
                      <span style={{ fontSize: 17, fontWeight: 800, color: '#d4eeff', fontVariantNumeric: 'tabular-nums', fontFamily: '"Space Grotesk", sans-serif', lineHeight: 1.15 }}>
                        ~{formatHashrate(data.hashrate_estimate_hps)}
                      </span>
                    )}
                  </div>
                  {data.hashrate_estimate_hps != null && (
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="font-mono" style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)' }}>
                        {t('explorer.pool_stats.hashrate_avg_window', {
                          minutes: Math.max(1, Math.round(data.hashrate_window_seconds / 60)),
                        })}
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: confidenceColor(data.hashrate_confidence), fontFamily: '"Space Grotesk", sans-serif' }}>
                        {confidenceLabel(data.hashrate_confidence)}
                      </span>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-xs">
                  <span style={{ color: 'rgba(255,255,255,0.40)' }}>{t('explorer.pool_stats.tcp_connections')}</span>
                  <span className="font-mono text-right" style={{ color: 'rgba(255,255,255,0.65)' }}>
                    {(data.tcp_sessions || data.active_miners).toLocaleString('en-US')}
                  </span>
                  <span style={{ color: 'rgba(255,255,255,0.40)' }}>{t('explorer.pool_stats.accepted_shares')}</span>
                  <span className="font-mono text-right" style={{ color: '#34d399' }}>
                    {data.accepted_shares.toLocaleString('en-US')}
                  </span>
                  <span style={{ color: 'rgba(255,255,255,0.40)' }}>{t('explorer.pool_stats.rejected_shares')}</span>
                  <span className="font-mono text-right" style={{ color: '#fda4af' }}>
                    {data.rejected_shares.toLocaleString('en-US')}
                  </span>
                  <span style={{ color: 'rgba(255,255,255,0.40)' }}>{t('explorer.pool_stats.total_blocks_found')}</span>
                  <span className="font-mono text-right" style={{ color: '#fbbf24' }}>
                    {data.blocks_found.toLocaleString('en-US')}
                  </span>
                  <span style={{ color: 'rgba(255,255,255,0.40)' }}>{t('explorer.pool_stats.integrity')}</span>
                  <span className="font-mono text-right" style={{ color: integrityColor(data.integrity) }}>
                    {integrityLabel(data.integrity)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RichListSection({ running }: { running: boolean }) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<RichListEntry[] | null>(null);
  const [totalSupply, setTotalSupply] = useState<number>(0);
  const [genHeight, setGenHeight] = useState<number>(0);
  const [limit, setLimit] = useState<number>(100);
  const [loading, setLoading] = useState(false);
  const [loadMoreLoading, setLoadMoreLoading] = useState(false);
  const [err, setErr] = useState<string>('');
  // Local wallet addresses — used to flag the "You" badge so the user can
  // see at a glance whether they appear in the top-N. Fetched once on
  // mount; wallet additions during the same session are rare enough that
  // a single fetch is fine.
  const [myAddrs, setMyAddrs] = useState<Set<string>>(new Set());
  // "Updated Xs ago" indicator. lastFetched is set on every successful
  // fetch (including silent background refresh); nowTick ticks once per
  // second to drive the elapsed display. The tick effect cleans up when
  // the section unmounts or running goes false.
  const [lastFetched, setLastFetched] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());

  const fetchList = useCallback(async (n: number, secondary: boolean, silent: boolean = false) => {
    // Silent path is used by the 60s auto-refresh poller so the spinner
    // doesn't flicker every minute. Errors are still recorded so a
    // persistent failure is surfaced eventually.
    if (silent) {
      // no spinner
    } else if (secondary) {
      setLoadMoreLoading(true);
    } else {
      setLoading(true);
    }
    setErr('');
    try {
      const result = await rpc.richlist(n);
      if (!result) throw new Error('empty response');
      setEntries(result.entries);
      setTotalSupply(result.total_supply_sats);
      setGenHeight(result.generated_at_height);
      setLimit(n);
      setLastFetched(Date.now());
    } catch (e) {
      if (!silent) setErr(String(e));
    } finally {
      if (!silent && secondary) setLoadMoreLoading(false);
      else if (!silent) setLoading(false);
    }
  }, []);

  // Initial load + wallet-addresses fetch run once when this tab mounts.
  useEffect(() => {
    if (!running) return;
    fetchList(100, false);
    wallet.listAddresses().then((list) => {
      if (list) setMyAddrs(new Set(list.map((a) => a.address)));
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  // Silent auto-refresh every 60 s while the node is running. Uses the
  // current `limit` (refs the latest user choice — top 100 or top 500)
  // via state instead of closing over it, so a Load-more-then-wait flow
  // doesn't snap back to top 100. Cleaned up on unmount or running off.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      fetchList(limit, false, true);
    }, 60_000);
    return () => clearInterval(id);
  }, [running, limit, fetchList]);

  // 1 Hz tick for the "Updated Xs ago" label. Skipped when entries are
  // not loaded yet (nothing to show); when entries appear, this fires
  // until the section unmounts.
  useEffect(() => {
    if (!entries) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [entries]);

  // Rich-list-specific balance formatter. Unlike the wallet-wide formatIRM()
  // (which obeys the user's currency preference and trims fractional
  // zeroes), the rich list switches unit based on the exact value: whole
  // IRM amounts (every coinbase reward and the founder vest are exact
  // Rich-list balances always render as IRM with up to 4 fractional
  // digits — never raw sats. Fractional sats are rounded for display
  // (which is what users expect from a "rich list"); the precise sat
  // value is still available via the per-row UTXO inspector and RPC.
  const formatRichListIRM = (balanceSats: number): string => {
    const irm = balanceSats / 100_000_000;
    return irm.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 4,
    }) + ' IRM';
  };

  if (!running) {
    return (
      <div className="py-10 text-center text-sm" style={{ background: 'var(--bg-elev-1)', border: '1px solid rgba(110,198,255,0.07)', borderRadius: 8, color: 'rgba(255,255,255,0.30)' }}>
        {t('explorer.richlist.node_offline_hint')}
      </div>
    );
  }

  const totalIrm = totalSupply / SATS_PER_IRM;
  // Derived breakdown for the supply panel. The richlist endpoint only
  // returns P2PKH spendable balances; anything in non-P2PKH outputs
  // (genesis CLTV vest, multisig P2SH settlement outputs) shows up as
  // the gap between total_supply_sats and the sum of entries. We label
  // the gap "Locked / Vested" — at the time this code lives the bulk is
  // the founder's 3.5M IRM CLTV-locked genesis allocation.
  const circulatingSats: number = entries ? entries.reduce((acc, e) => acc + e.balance_sats, 0) : 0;
  const lockedSats: number = Math.max(0, totalSupply - circulatingSats);
  const lockedPct: number = totalSupply > 0 ? (lockedSats / totalSupply) * 100 : 0;
  const updatedAgoSec: number | null = lastFetched ? Math.max(0, Math.floor((nowTick - lastFetched) / 1000)) : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: '#d4eeff', fontFamily: '"Space Grotesk", sans-serif', letterSpacing: '0.02em' }}>
            {t('explorer.richlist.title')}
          </h2>
          <p className="mt-1" style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)' }}>
            {t('explorer.richlist.subtitle')}
          </p>
          {totalSupply > 0 && (
            <div className="mt-1 space-y-0.5" style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11 }}>
              <p style={{ color: 'rgba(110,198,255,0.55)' }}>
                {t('explorer.richlist.circulating_supply')}: <span style={{ color: '#34d399' }}>{formatRichListIRM(circulatingSats)}</span>
                {updatedAgoSec !== null && (
                  <span className="ml-2" style={{ color: 'rgba(255,255,255,0.30)', fontSize: 10 }}>
                    · {t('explorer.richlist.updated_ago', { seconds: updatedAgoSec })}
                  </span>
                )}
              </p>
              <p style={{ color: 'rgba(110,198,255,0.55)' }}>
                {t('explorer.richlist.total_supply_with_vested')}: <span style={{ color: '#d4eeff' }}>{formatRichListIRM(totalSupply)}</span>{' '}
                <span style={{ color: 'rgba(255,255,255,0.30)' }}>{t('explorer.richlist.at_height', { height: genHeight.toLocaleString('en-US') })}</span>
              </p>
            </div>
          )}
        </div>
        <button
          onClick={() => fetchList(limit, false)}
          disabled={loading}
          className="btn-secondary text-xs gap-2 flex-shrink-0"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          {t('explorer.richlist.refresh')}
        </button>
      </div>

      {/* Error / loading / table */}
      {err ? (
        <div className="py-10 text-center text-sm" style={{ background: 'rgba(244,63,94,0.06)', border: '1px solid rgba(244,63,94,0.20)', borderRadius: 8, color: '#fda4af' }}>
          {t('explorer.richlist.load_error', { reason: err })}
        </div>
      ) : loading && !entries ? (
        <div style={{ background: 'var(--bg-elev-1)', border: '1px solid rgba(110,198,255,0.08)', borderRadius: 8, overflow: 'hidden' }}>
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3 animate-pulse" style={{ borderBottom: '1px solid rgba(255,255,255,0.025)' }}>
              <div className="h-3 w-6  rounded" style={{ background: 'rgba(255,255,255,0.05)' }} />
              <div className="h-3 w-48 rounded" style={{ background: 'rgba(255,255,255,0.04)' }} />
              <div className="h-3 w-24 rounded ml-auto" style={{ background: 'rgba(255,255,255,0.03)' }} />
              <div className="h-3 w-16 rounded" style={{ background: 'rgba(255,255,255,0.03)' }} />
              <div className="h-3 w-12 rounded" style={{ background: 'rgba(255,255,255,0.03)' }} />
            </div>
          ))}
        </div>
      ) : !entries || entries.length === 0 ? (
        <div className="py-10 text-center text-sm" style={{ background: 'var(--bg-elev-1)', border: '1px solid rgba(110,198,255,0.07)', borderRadius: 8, color: 'rgba(255,255,255,0.30)' }}>
          {t('explorer.richlist.empty')}
        </div>
      ) : (
        <>
          <div style={{ background: 'var(--bg-elev-1)', border: '1px solid rgba(110,198,255,0.13)', borderRadius: 8, overflow: 'hidden' }}>
            <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(110,198,255,0.08)', background: 'rgba(0,0,0,0.55)' }}>
                  <th className="pl-4 pr-2 py-2 text-left" style={TH_STYLE}>{t('explorer.richlist.col_rank')}</th>
                  <th className="px-2 py-2 text-left" style={TH_STYLE}>{t('explorer.richlist.col_address')}</th>
                  <th className="px-2 py-2 text-right" style={TH_STYLE}>{t('explorer.richlist.col_balance_irm')}</th>
                  <th className="px-2 py-2 text-right" style={TH_STYLE}>{t('explorer.richlist.col_percentage')}</th>
                  <th className="pl-2 pr-4 py-2 text-right" style={TH_STYLE}>{t('explorer.richlist.col_utxos')}</th>
                </tr>
              </thead>
              <tbody>
                {/* Synthetic Founder Vesting row — sits above rank #1 when the
                    rich list does not account for all minted supply. The
                    delta (totalSupply - sum(entries)) is in non-P2PKH
                    outputs; the bulk is the 3.5M IRM CLTV-locked genesis
                    allocation unlocking at height 158,704 (decoded from the
                    genesis transaction's output script: <H> OP_CLTV OP_DROP
                    <standard P2PKH>). Any extra over 3.5M is multisig
                    settlement-agreement outputs. */}
                {lockedSats > 0 && (
                  <tr
                    style={{
                      borderBottom: '2px solid rgba(245,158,11,0.40)',
                      background: 'rgba(245,158,11,0.08)',
                    }}
                    title={t('explorer.richlist.founder_vesting_tooltip')}
                  >
                    <td className="pl-4 pr-2 py-2.5 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5" style={{ fontFamily: '"Space Grotesk", sans-serif', fontSize: 13, fontWeight: 800, color: '#fbbf24' }}>
                        <Lock size={14} />
                      </span>
                    </td>
                    <td className="px-2 py-2.5 group" style={{ minWidth: 280 }}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span style={{ fontFamily: '"Space Grotesk", sans-serif', fontSize: 12.5, fontWeight: 700, color: '#fde68a' }}>
                          {t('explorer.richlist.founder_vesting_label')}
                        </span>
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-[10.5px] font-bold rounded"
                          style={{ background: 'rgba(245,158,11,0.25)', border: '1px solid rgba(245,158,11,0.70)', color: '#fde68a', letterSpacing: '0.10em', boxShadow: '0 0 10px rgba(245,158,11,0.30)' }}
                        >
                          {t('explorer.richlist.locked_badge')}
                        </span>
                        <span style={{ fontSize: 10.5, color: 'rgba(253,230,138,0.65)', fontFamily: '"JetBrains Mono", monospace' }}>
                          {t('explorer.richlist.unlocks_at_height', { height: FOUNDER_VESTING_UNLOCK_HEIGHT.toLocaleString('en-US') })}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-1">
                        <span style={{ fontSize: 11, color: 'rgba(253,230,138,0.85)', fontFamily: '"JetBrains Mono", monospace' }}>
                          {FOUNDER_VESTING_ADDRESS}
                        </span>
                        <CopyBtn text={FOUNDER_VESTING_ADDRESS} />
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-right whitespace-nowrap">
                      <span style={{ fontSize: 12, color: '#fbbf24', fontFamily: '"JetBrains Mono", monospace', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                        {formatRichListIRM(lockedSats)}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-right whitespace-nowrap">
                      <span style={{ fontSize: 11, color: 'rgba(253,230,138,0.85)', fontFamily: '"JetBrains Mono", monospace', fontVariantNumeric: 'tabular-nums' }}>
                        {lockedPct.toFixed(2)}%
                      </span>
                    </td>
                    <td className="pl-2 pr-4 py-2.5 text-right whitespace-nowrap">
                      <span style={{ fontSize: 11, color: 'rgba(253,230,138,0.50)', fontFamily: '"JetBrains Mono", monospace' }}>—</span>
                    </td>
                  </tr>
                )}
                {entries.map((e) => {
                  const { color: rankColor, Icon: RankIcon } = rankAccent(e.rank);
                  const isMine = myAddrs.has(e.address);
                  return (
                    <tr
                      key={e.address}
                      className="group"
                      style={{ borderBottom: '1px solid rgba(255,255,255,0.035)', transition: 'background 0.1s' }}
                      onMouseEnter={(ev) => { ev.currentTarget.style.background = 'rgba(110,198,255,0.04)'; }}
                      onMouseLeave={(ev) => { ev.currentTarget.style.background = 'transparent'; }}
                    >
                      {/* Rank */}
                      <td className="pl-4 pr-2 py-2.5 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1" style={{ fontFamily: '"Space Grotesk", sans-serif', fontSize: 13, fontWeight: 800, color: rankColor }}>
                          {RankIcon && <RankIcon size={12} />}
                          #{e.rank}
                        </span>
                      </td>
                      {/* Address — full 34-char display, click-to-copy, prominent You badge */}
                      <td className="px-2 py-2.5" style={{ minWidth: 280 }}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(e.address);
                              toast.success(t('common.copy'));
                            }}
                            title={t('explorer.richlist.click_to_copy')}
                            className="font-mono text-left hover:underline"
                            style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11, letterSpacing: '0.01em', color: isMine ? '#a78bfa' : 'rgba(255,255,255,0.78)', wordBreak: 'break-all' }}
                          >
                            {e.address}
                          </button>
                          {isMine && (
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 text-[10.5px] font-bold rounded"
                              style={{ background: 'rgba(167,139,250,0.30)', border: '1px solid rgba(167,139,250,0.75)', color: '#ede9fe', letterSpacing: '0.10em', boxShadow: '0 0 10px rgba(167,139,250,0.30)' }}
                            >
                              <UserCircle2 size={11} />
                              {t('explorer.richlist.you_badge')}
                            </span>
                          )}
                        </div>
                      </td>
                      {/* Balance (IRM) — exact, derived from balance_sats to avoid f64 loss */}
                      <td className="px-2 py-2.5 text-right whitespace-nowrap">
                        <span style={{ fontSize: 12, color: '#34d399', fontFamily: '"JetBrains Mono", monospace', fontVariantNumeric: 'tabular-nums' }}>
                          {formatRichListIRM(e.balance_sats)}
                        </span>
                      </td>
                      {/* % of supply */}
                      <td className="px-2 py-2.5 text-right whitespace-nowrap">
                        <span style={{ fontSize: 11, color: 'rgba(110,198,255,0.75)', fontFamily: '"JetBrains Mono", monospace', fontVariantNumeric: 'tabular-nums' }}>
                          {e.percentage.toFixed(2)}%
                        </span>
                      </td>
                      {/* UTXO count */}
                      <td className="pl-2 pr-4 py-2.5 text-right whitespace-nowrap">
                        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', fontFamily: '"JetBrains Mono", monospace', fontVariantNumeric: 'tabular-nums' }}>
                          {e.utxo_count.toLocaleString('en-US')}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>

          {/* Locked / Vested Funds — the delta between total_supply_sats and
              the sum of P2PKH entry balances. This is intentionally a
              prominent panel because community visibility into the founder
              vest is a stated trust property of the chain. The bulk of this
              gap is the 3.5M IRM CLTV-locked genesis allocation; any extra
              over 3.5M is multisig P2SH outputs (settlement agreements). */}
          {totalSupply > 0 && lockedSats > 0 && (
            <div
              className="flex items-start gap-3 px-4 py-3"
              style={{
                background: 'rgba(245,158,11,0.08)',
                border: '1px solid rgba(245,158,11,0.30)',
                borderRadius: 8,
              }}
            >
              <Lock size={16} style={{ color: '#fbbf24', marginTop: 2, flexShrink: 0 }} />
              <div className="flex-1 min-w-0">
                <p style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24', fontFamily: '"Space Grotesk", sans-serif', letterSpacing: '0.02em' }}>
                  {t('explorer.richlist.locked_title')}
                </p>
                <p className="mt-1" style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 13, color: '#fde68a' }}>
                  {formatRichListIRM(lockedSats)} <span style={{ color: 'rgba(253,230,138,0.60)', fontSize: 11 }}>({lockedPct.toFixed(2)}% {t('explorer.richlist.of_total_supply')})</span>
                </p>
                <p className="mt-1.5" style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5 }}>
                  {t('explorer.richlist.locked_note')}
                </p>
              </div>
            </div>
          )}

          {/* Multi-address explanation + sum — shown only when at least one
              rich-list entry matches one of the wallet's addresses. The rich
              list is keyed by single addresses; we surface both the running
              total of the user's mine matches AND the multi-address caveat. */}
          {entries.some((e) => myAddrs.has(e.address)) && (
            <div
              className="flex items-start gap-2.5 px-4 py-3"
              style={{
                background: 'rgba(167,139,250,0.08)',
                border: '1px solid rgba(167,139,250,0.25)',
                borderRadius: 8,
              }}
            >
              <UserCircle2 size={14} style={{ color: '#a78bfa', marginTop: 1, flexShrink: 0 }} />
              <div className="flex-1 min-w-0">
                <p style={{ fontSize: 12, fontWeight: 700, color: '#c4b5fd', fontFamily: '"JetBrains Mono", monospace' }}>
                  {t('explorer.richlist.your_addresses_total', {
                    total: formatRichListIRM(entries.filter((e) => myAddrs.has(e.address)).reduce((acc, e) => acc + e.balance_sats, 0)),
                  })}
                </p>
                <p className="mt-1" style={{ fontSize: 11.5, color: 'rgba(237,233,254,0.75)', lineHeight: 1.5 }}>
                  {t('explorer.richlist.you_note')}
                </p>
              </div>
            </div>
          )}

          {/* Address prefix legend. Both "P…" and "Q…" leading characters
              appear in the rich list — common assumption is that they
              indicate different formats, but they don't. Both come from the
              SAME P2PKH version byte (0x39); base58check encoding maps
              certain underlying pubkey-hashes to addresses starting with P
              and others to Q, purely as a numeric property of the encoding.
              A separate multisig version byte (0x28) exists for 2-of-N
              wallets, but the rich list excludes those — every visible row
              here is a single-sig P2PKH. */}
          <div
            className="flex items-start gap-2.5 px-4 py-3"
            style={{
              background: 'rgba(110,198,255,0.04)',
              border: '1px solid rgba(110,198,255,0.12)',
              borderRadius: 8,
            }}
          >
            <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 16, color: 'rgba(110,198,255,0.65)', marginTop: -2, flexShrink: 0 }}>P/Q</span>
            <p style={{ fontSize: 11.5, color: 'rgba(238,240,255,0.70)', lineHeight: 1.5 }}>
              {t('explorer.richlist.prefix_note')}
            </p>
          </div>

          {/* Load more — only offered when the current view is the top-100 page */}
          <div className="flex flex-col items-center gap-1.5">
            <p style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: 'rgba(110,198,255,0.35)' }}>
              {t('explorer.richlist.showing_top', { count: entries.length })}
            </p>
            {limit < 500 && (
              <button
                onClick={() => fetchList(500, true)}
                disabled={loadMoreLoading}
                className="flex items-center gap-2 px-5 py-2 text-xs font-semibold w-full justify-center transition-opacity disabled:opacity-40"
                style={{
                  background: 'rgba(110,198,255,0.06)',
                  border: '1px solid rgba(110,198,255,0.18)',
                  borderRadius: 7,
                  color: 'rgba(110,198,255,0.70)',
                  fontFamily: '"Space Grotesk", sans-serif',
                }}
              >
                {loadMoreLoading
                  ? <><RefreshCw size={11} className="animate-spin" /> {t('explorer.richlist.load_more_loading')}</>
                  : t('explorer.richlist.load_more')}
              </button>
            )}
            {totalIrm > 0 && (
              <span className="sr-only">{`${totalIrm} IRM total supply context for screen readers`}</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────

export default function Explorer() {
  const { t } = useTranslation();
  const nodeStatus  = useStore((s) => s.nodeStatus);
  const location    = useLocation();

  // Page-level tab: 'overview' renders the existing stats + search + blocks
  // table; 'rich_list' swaps the body for the Top Holders table. Tab choice
  // is local to this page — no deep-link state needed since the body is
  // cheap to mount/unmount.
  const [pageTab, setPageTab] = useState<PageTab>('overview');

  // Block list state — grows as user loads older blocks
  const [blocks,        setBlocks]        = useState<ExplorerBlock[]>([]);
  const [initialLoaded, setInitialLoaded] = useState(false);
  // null = not yet known, number = oldest loaded height minus 1, 0 = reached genesis
  const [blockCursor,   setBlockCursor]   = useState<number | null>(null);
  const [loadingMore,   setLoadingMore]   = useState(false);

  // Deep-link retry state — when iriumd returns 404 (or any "not found"
  // shaped error) for a block the user clicked from the Miner page, we
  // show a banner offering a 5-second-delayed retry instead of dumping
  // the raw "EOF / Block not found" error into a toast. The 5s delay
  // gives a freshly-mined block time to be indexed by iriumd.
  const [pendingBlock, setPendingBlock] = useState<{ height: number; retrying: boolean } | null>(null);

  const [hashrateInfo,  setHashrateInfo]  = useState<NetworkHashrateInfo | null>(null);
  const [refreshing,    setRefreshing]    = useState(false);
  const [selectedBlock, setSelectedBlock] = useState<ExplorerBlock | null>(null);

  // Search state — pre-filled from navigation state (e.g. from Wallet tx modal)
  const navState = location.state as {
    searchTab?: SearchTab;
    searchQ?: string;
    // openBlockHeight: deep-link from the Miner page's Found Blocks list.
    // When present, mount-effect below opens BlockDetailModal directly.
    openBlockHeight?: number;
    // openBlockData: partial block object forwarded by the Miner page. Only
    // height/time/reward_sats are guaranteed; header fields (hash, prev_hash,
    // etc) may be absent if record_found_block's async fetch hadn't completed
    // yet at click time. If hash is missing the mount-effect refetches via
    // rpc.block before opening the modal so the user never sees stale "—"s.
    openBlockData?: Partial<ExplorerBlock>;
  } | null;
  const [searchTab,    setSearchTab]    = useState<SearchTab>(navState?.searchTab ?? 'block');
  const [searchQ,      setSearchQ]      = useState(navState?.searchQ ?? '');
  const [searching,    setSearching]    = useState(false);
  const [searchResult, setSearchResult] = useState<Record<string, unknown> | null>(null);
  const [searchErr,    setSearchErr]    = useState('');

  // Safety: if initialLoaded is still false after 10 s (e.g. node offline or slow),
  // escape the skeleton so the empty/offline state can render.
  useEffect(() => {
    if (initialLoaded) return;
    const t = setTimeout(() => setInitialLoaded(true), 10_000);
    return () => clearTimeout(t);
  }, [initialLoaded]);

  // Option C deep-link — when arriving via navigate('/explorer', { state:
  // { openBlockHeight: N, openBlockData: {...} } }) from Miner.tsx's Found
  // Blocks list. If openBlockData carries a non-empty hash we trust it and
  // open the modal directly. Otherwise (the common case from the Miner page
  // since Fix 4 — only height/time/reward_sats are forwarded) we always
  // fetch fresh data via rpc.block so the modal can render hash, prev_hash,
  // merkle_root, bits, nonce, and miner_address. The reward_sats forwarded
  // by Miner is merged onto the fetched block so the modal can fall back to
  // it if iriumd doesn't surface a reward field directly.
  // The consumed ref guards against StrictMode's double-invoke and stale
  // location.state. window.history.replaceState clears state so back/forward
  // navigation doesn't re-open the modal.
  // Shared fetch helper — also used by the retry banner below.
  const fetchBlockDeepLink = useCallback(async (h: number, passedBlock?: Partial<ExplorerBlock>) => {
    try {
      const raw = (await rpc.block(String(h))) as Record<string, unknown>;
      if (!raw || Object.keys(raw).length === 0) {
        setPendingBlock({ height: h, retrying: false });
        return;
      }
      const str = (v: unknown): string => (typeof v === 'string' ? v : '');
      const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);
      const txArr = Array.isArray(raw.tx) ? (raw.tx as unknown[]) : null;
      const hdr = (typeof raw.header === 'object' && raw.header !== null)
        ? (raw.header as Record<string, unknown>)
        : {};
      const block: ExplorerBlock = {
        height:       num(raw.height) || h,
        hash:         str(hdr.hash) || str(raw.hash),
        prev_hash:    str(hdr.prev_hash) || str(raw.prev_hash) || str(raw.previousblockhash) || str(raw.previous_block_hash),
        merkle_root:  str(hdr.merkle_root) || str(raw.merkle_root) || str(raw.merkleroot),
        time:         num(hdr.time) || num(raw.time) || (passedBlock?.time ?? 0),
        tx_count:     num(raw.tx_count) || num(raw.n_tx) || (txArr ? txArr.length : 0),
        bits:         str(hdr.bits) || str(raw.bits),
        nonce:        typeof hdr.nonce === 'number' ? hdr.nonce : (typeof raw.nonce === 'number' ? raw.nonce : undefined),
        miner_address: str(raw.miner_address) || str(raw.miner) || passedBlock?.miner_address,
        reward_sats:  passedBlock?.reward_sats,
      };
      setSelectedBlock(block);
      setPendingBlock(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Backend now returns "Block not found: {h}" for 404 (was "EOF while
      // parsing…"). Treat that as "not yet indexed" and show retry banner
      // instead of a destructive-feeling toast.
      if (msg.includes('Block not found') || msg.includes('not found')) {
        setPendingBlock({ height: h, retrying: false });
      } else {
        // Other failures (node offline, network) still get a toast.
        toast.error(t('explorer.toasts.block_load_error', { height: h.toLocaleString('en-US'), reason: msg }));
      }
    }
  }, []);

  const handlePendingRetry = useCallback(() => {
    if (!pendingBlock) return;
    setPendingBlock({ ...pendingBlock, retrying: true });
    // 5s delay gives iriumd time to finish indexing a freshly-mined block.
    setTimeout(() => fetchBlockDeepLink(pendingBlock.height), 5000);
  }, [pendingBlock, fetchBlockDeepLink]);

  const deepLinkConsumedRef = useRef(false);
  useEffect(() => {
    if (deepLinkConsumedRef.current) return;
    const h = navState?.openBlockHeight;
    if (h == null) return;
    deepLinkConsumedRef.current = true;
    window.history.replaceState({}, '');

    const passedBlock = navState?.openBlockData;
    if (passedBlock && passedBlock.hash) {
      setSelectedBlock(passedBlock as ExplorerBlock);
      return;
    }

    fetchBlockDeepLink(h, passedBlock);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const running   = nodeStatus?.running  ?? false;
  const height    = nodeStatus?.height   ?? 0;
  const tip       = nodeStatus?.network_tip ?? 0;
  const peerCount = nodeStatus?.peers    ?? 0;
  const synced    = nodeStatus?.synced   ?? false;

  // Fetch latest 30 blocks and merge into the existing list.
  // Only initialises blockCursor on the very first successful fetch.
  const fetchLatest = useCallback(async () => {
    const result = await rpc.recentBlocks(30, undefined).catch(() => null);
    if (result != null) {
      const incoming = result as ExplorerBlock[];
      setBlocks((prev) => mergeBlocks(prev, incoming));
      setInitialLoaded(true);
      if (incoming.length > 0) {
        const minH = Math.min(...incoming.map((b) => b.height));
        setBlockCursor((prev) => prev === null ? (minH > 0 ? minH - 1 : 0) : prev);
      }
    }
  }, []);

  // Append 50 older blocks starting from blockCursor downward
  const fetchOlder = useCallback(async () => {
    if (blockCursor === null || blockCursor <= 0 || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await rpc.recentBlocks(50, blockCursor);
      if (result && (result as ExplorerBlock[]).length > 0) {
        const incoming = result as ExplorerBlock[];
        setBlocks((prev) => mergeBlocks(prev, incoming));
        const minH = Math.min(...incoming.map((b) => b.height));
        setBlockCursor(minH > 0 ? minH - 1 : 0);
      } else {
        setBlockCursor(0); // reached genesis
      }
    } finally {
      setLoadingMore(false);
    }
  }, [blockCursor, loadingMore]);

  // Synchronous re-entrancy guard. The disabled={refreshing} prop on the
  // button blocks RE-RENDERED clicks, but React batches state updates so
  // a fast double-click within the same event-loop tick can land both
  // calls before the disabled DOM attribute flips. This ref closes that
  // race deterministically: the ms-1 click sets the flag, the ms-2 click
  // reads it as true and bails. Without this, two concurrent handleRefresh
  // invocations each fire 30 /rpc/block requests → 60+ overlapping calls
  // saturate iriumd's RPC and time out the node-status poll, producing
  // spurious "Node Disconnected" toasts.
  const refreshingRef = useRef(false);

  const handleRefresh = async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      await Promise.all([
        fetchLatest(),
        fetchHashrate(),
        new Promise((r) => setTimeout(r, 600)),
      ]);
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  };

  // Initial load + auto-refresh every 30s (only merges; never clears existing blocks)
  useEffect(() => {
    fetchLatest();
    const id = setInterval(fetchLatest, 30_000);
    return () => clearInterval(id);
  }, [fetchLatest]);

  // Retry when node comes online for the first time
  useEffect(() => {
    if (running && !initialLoaded) fetchLatest();
  }, [running, initialLoaded, fetchLatest]);

  // Trigger refresh whenever the chain tip advances (nodeStatus polls every 3s)
  const prevFetchHeightRef = useRef<number | null>(null);
  useEffect(() => {
    const h = nodeStatus?.height ?? null;
    if (h === null) return;
    if (prevFetchHeightRef.current !== null && h > prevFetchHeightRef.current) {
      fetchLatest();
    }
    prevFetchHeightRef.current = h;
  }, [nodeStatus?.height, fetchLatest]);

  // Chain-reset detection: if clear_node_state was called, iriumd restarts at height 0
  // while our accumulated block list still holds the old chain. Wipe it so the UI
  // starts fresh instead of merging new blocks into the stale high-height list.
  const prevHeightRef = useRef(height);
  useEffect(() => {
    const prev = prevHeightRef.current;
    prevHeightRef.current = height;
    const topLoaded = blocks[0]?.height ?? 0;
    // Height fell from something meaningful to near-zero AND we have stale blocks loaded.
    // Guard height > 0: when iriumd is temporarily unresponsive the poller reports
    // height=0 (offline placeholder). Treating that as a chain reset would wipe the
    // block list on every brief RPC hiccup. Only reset when the node is genuinely
    // running at a low height (real reorg/reset scenario).
    if (prev > 200 && height > 0 && height < 50 && topLoaded > 200) {
      setBlocks([]);
      setInitialLoaded(false);
      setBlockCursor(null);
    }
  }, [height, blocks]);

  const fetchHashrate = useCallback(async () => {
    const info = await rpc.networkHashrate().catch(() => null);
    if (info) setHashrateInfo(info);
  }, []);

  // Fetch network hashrate — separate from block polling
  useEffect(() => {
    if (!running) return;
    fetchHashrate();
    const id = setInterval(fetchHashrate, 60_000);
    return () => clearInterval(id);
  }, [running, fetchHashrate]);

  // Derived
  const newestLoaded  = blocks.length > 0 ? blocks[0].height : undefined;
  const oldestLoaded  = blocks.length > 0 ? blocks[blocks.length - 1].height : undefined;
  const canLoadMore   = blockCursor !== null && blockCursor > 0;
  const reachedGenesis = blockCursor === 0;
  const activeMiners  = uniqueMiners(blocks);
  const live          = running && blocks.length > 0;

  // ── Search ────────────────────────────────────────────────

  const clearSearch = () => { setSearchResult(null); setSearchErr(''); };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQ.trim();
    if (!q) return;
    setSearching(true);
    clearSearch();
    try {
      let result: Record<string, unknown> | null = null;
      if (searchTab === 'block') {
        result = (await rpc.block(q)) as Record<string, unknown>;
      } else if (searchTab === 'tx') {
        result = (await rpc.tx(q)) as Record<string, unknown>;
      } else {
        result = (await rpc.address(q)) as Record<string, unknown>;
      }
      if (result && Object.keys(result).length > 0) {
        setSearchResult(result);
      } else {
        if (searchTab === 'block') setSearchErr(t('explorer.search.errors.block_not_found'));
        else if (searchTab === 'tx') setSearchErr(t('explorer.search.errors.tx_not_found'));
        else setSearchErr(t('explorer.search.errors.address_not_found'));
      }
    } catch (err) {
      const msg = String(err).toLowerCase();
      const nodeOffline = msg.includes('network') || msg.includes('connection') || msg.includes('econnrefused') || msg.includes('timeout') || msg.includes('offline');
      if (nodeOffline) {
        setSearchErr(t('explorer.search.errors.node_unreachable'));
      } else if (searchTab === 'block') {
        setSearchErr(t('explorer.search.errors.block_not_found'));
      } else if (searchTab === 'tx') {
        setSearchErr(t('explorer.search.errors.tx_not_found_detailed'));
      } else {
        setSearchErr(t('explorer.search.errors.address_not_found_detailed'));
      }
    } finally {
      setSearching(false);
    }
  };

  const searchPlaceholders: Record<SearchTab, string> = {
    block:   t('explorer.search.placeholders.block'),
    tx:      t('explorer.search.placeholders.tx'),
    address: t('explorer.search.placeholders.address'),
  };

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Header ──────────────────────────────────────── */}
      <div
        className="relative flex-shrink-0 px-8 pt-4 pb-3.5"
        style={{
          background: 'linear-gradient(180deg, rgba(5,16,38,0.55) 0%, transparent 100%)',
          borderBottom: '1px solid rgba(110,198,255,0.08)',
        }}
      >
        <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse 55% 100% at 50% -30%, rgba(42,171,238,0.07) 0%, transparent 70%)' }} />
        <div className="relative flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 style={{
                fontSize: 20, fontWeight: 900, letterSpacing: '0.05em', textTransform: 'uppercase',
                background: 'linear-gradient(90deg, #d4eeff 0%, #6ec6ff 55%, #a78bfa 100%)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
                fontFamily: '"Space Grotesk", sans-serif', lineHeight: 1,
              }}>
                {t('explorer.page_title_block_explorer')}
              </h1>
              {live && (
                <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full" style={{ background: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.22)' }}>
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#34d399' }} />
                  <span style={{ fontSize: 9.5, color: '#34d399', fontWeight: 700, letterSpacing: '0.1em', fontFamily: '"Space Grotesk", sans-serif' }}>{t('explorer.live_badge')}</span>
                </span>
              )}
            </div>
            <div className="mt-1" style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: 'rgba(110,198,255,0.50)' }}>
              {live
                ? `#${height.toLocaleString('en-US')} · ${peerCount}p · ${synced ? t('explorer.synced') : `${((height / (tip || 1)) * 100).toFixed(1)}% ${t('explorer.sync_suffix')}`}`
                : running ? t('explorer.loading_chain') : t('explorer.node_offline_hint')}
            </div>
          </div>

          <button onClick={handleRefresh} disabled={refreshing} className="btn-secondary text-xs gap-2">
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? t('common.loading') : t('dashboard.refresh')}
          </button>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto scroll-visible px-6 py-4 space-y-5">

        {/* ── Page tabs ─────────────────────────────────── */}
        <div className="flex items-center gap-1.5">
          <PageTabBtn
            active={pageTab === 'overview'}
            onClick={() => setPageTab('overview')}
            icon={Layers}
            label={t('explorer.tabs.overview')}
          />
          <PageTabBtn
            active={pageTab === 'rich_list'}
            onClick={() => setPageTab('rich_list')}
            icon={Trophy}
            label={t('explorer.tabs.rich_list')}
          />
          <PageTabBtn
            active={pageTab === 'pool_stats'}
            onClick={() => setPageTab('pool_stats')}
            icon={Server}
            label={t('explorer.tabs.pool_stats')}
          />
        </div>

        {/* Rich-list or Pool-stats takes over the body when selected.
            The Overview path falls through to the original layout. */}
        {pageTab === 'rich_list' ? <RichListSection running={running} /> :
         pageTab === 'pool_stats' ? <PoolStatsSection /> : (
        <>

        {/* ── Network Stats ─────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {!running ? (
            <div
              className="col-span-2 sm:col-span-3 lg:col-span-6 py-3 text-center text-sm"
              style={{ color: 'rgba(255,255,255,0.22)' }}
            >
              {t('explorer.start_node_hint')}
            </div>
          ) : !initialLoaded ? (
            Array.from({ length: 6 }).map((_, i) => <StatCardSkeleton key={i} />)
          ) : (
            <>
              <StatCard icon={Layers}     label={t('explorer.stats.block_height')}      value={`#${height.toLocaleString('en-US')}`}                         sub={tip > 0 && !synced ? t('explorer.stats.tip_height', { height: tip.toLocaleString('en-US') }) : t('explorer.stats.chain_tip')}   accent="#6ec6ff" />
              <StatCard icon={Coins}      label={t('explorer.stats.circulating_supply')} value={computeCirculatingSupply(height)}                      sub={t('explorer.stats.next_halving', { height: nextHalvingBlock(height).toLocaleString('en-US') })}           accent="#34d399" />
              <StatCard icon={Zap}        label={t('explorer.stats.network_hashrate')}   value={hashrateInfo?.hashrate != null ? formatHashrate(hashrateInfo.hashrate) : '—'} sub={t('explorer.stats.pow_sub')}                                accent="#fbbf24" />
              <StatCard icon={TrendingUp} label={t('explorer.stats.difficulty_lwma')}  value={hashrateInfo?.difficulty != null ? formatDifficulty(hashrateInfo.difficulty) : '—'} sub={t('explorer.stats.lwma_sub')}                        accent="#a78bfa" />
              <StatCard icon={Users}      label={t('explorer.stats.peers')}              value={peerCount.toLocaleString('en-US')}                            sub={t('explorer.stats.connected_sub')}                                                            accent="#6ec6ff" />
              <StatCard icon={Cpu}        label={t('explorer.stats.active_miners')}      value={activeMiners.toLocaleString('en-US')}                         sub={t('explorer.stats.recent_blocks_sub')}                                                        accent="#fb923c" />
            </>
          )}
        </div>

        {/* ── Search ─────────────────────────────────────── */}
        {running && (
          <div>
            <SectionLabel title={t('explorer.section_search')} />
            {/* Tab bar */}
            <div className="flex items-center gap-1.5 mb-3">
              <TabBtn active={searchTab === 'block'}   onClick={() => { setSearchTab('block');   clearSearch(); setSearchQ(''); }} icon={Layers}         label={t('explorer.search_tabs.block')} />
              <TabBtn active={searchTab === 'tx'}      onClick={() => { setSearchTab('tx');      clearSearch(); setSearchQ(''); }} icon={ArrowRightLeft} label={t('explorer.search_tabs.tx')} />
              <TabBtn active={searchTab === 'address'} onClick={() => { setSearchTab('address'); clearSearch(); setSearchQ(''); }} icon={Wallet}         label={t('explorer.search_tabs.address')} />
            </div>
            {/* Search input */}
            <form onSubmit={handleSearch} className="flex gap-2">
              <div className="flex-1 relative">
                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'rgba(110,198,255,0.35)' }} />
                <input
                  type="text"
                  value={searchQ}
                  onChange={(e) => { setSearchQ(e.target.value); clearSearch(); }}
                  placeholder={searchPlaceholders[searchTab]}
                  className="w-full pl-8 pr-4 py-2.5 outline-none"
                  style={{
                    background: 'rgba(0,0,0,0.40)',
                    border: '1px solid rgba(110,198,255,0.14)',
                    borderRadius: 7,
                    color: 'rgba(238,240,255,0.80)',
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: 12,
                    transition: 'border-color 0.15s',
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(110,198,255,0.38)'; }}
                  onBlur={(e)  => { e.currentTarget.style.borderColor = 'rgba(110,198,255,0.14)'; }}
                />
              </div>
              <button
                type="submit"
                disabled={searching || !searchQ.trim()}
                className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold flex-shrink-0 disabled:opacity-40 transition-opacity"
                style={{ background: 'rgba(110,198,255,0.12)', border: '1px solid rgba(110,198,255,0.28)', color: '#6ec6ff', borderRadius: 7, fontFamily: '"Space Grotesk", sans-serif' }}
              >
                {searching ? <RefreshCw size={11} className="animate-spin" /> : <Search size={11} />}
                {t('explorer.look_up')}
              </button>
            </form>
            <AnimatePresence>
              {searchErr && (
                <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="mt-2 text-xs" style={{ color: '#f87171' }}>
                  {searchErr}
                </motion.p>
              )}
              {searchResult && (
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <SearchResultCard
                    result={searchResult}
                    title={searchTab === 'block' ? t('explorer.search_results.block') : searchTab === 'tx' ? t('explorer.search_results.tx') : t('explorer.search_results.address')}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* ── Block Table ─────────────────────────────────── */}
        <div>
          <SectionLabel
            title={t('explorer.section_blocks')}
            right={
              blocks.length > 0 ? (
                <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: 'rgba(110,198,255,0.35)', whiteSpace: 'nowrap' }}>
                  {t('explorer.blocks_table.loaded_short', { count: blocks.length.toLocaleString('en-US') })}
                  {oldestLoaded !== undefined && ` · #${oldestLoaded.toLocaleString('en-US')}–#${newestLoaded?.toLocaleString('en-US')}`}
                </span>
              ) : undefined
            }
          />

          {!initialLoaded ? (
            !running ? (
              /* Node offline — don't perpetually skeleton; show clear offline state */
              <div className="py-10 text-center text-sm" style={{ background: 'var(--bg-elev-1)', border: '1px solid rgba(110,198,255,0.07)', borderRadius: 8, color: 'rgba(255,255,255,0.22)' }}>
                {t('explorer.empty_states.start_node_for_blocks')}
              </div>
            ) : (
              /* Loading skeleton while node is running but blocks not yet fetched */
              <div style={{ background: 'var(--bg-elev-1)', border: '1px solid rgba(110,198,255,0.08)', borderRadius: 8, overflow: 'hidden' }}>
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-3 animate-pulse" style={{ borderBottom: '1px solid rgba(255,255,255,0.025)' }}>
                    <div className="h-3.5 w-16 rounded" style={{ background: 'rgba(255,255,255,0.05)' }} />
                    <div className="h-3 w-48 rounded" style={{ background: 'rgba(255,255,255,0.04)' }} />
                    <div className="h-3 w-16 rounded ml-auto" style={{ background: 'rgba(255,255,255,0.03)' }} />
                  </div>
                ))}
              </div>
            )
          ) : blocks.length === 0 ? (
            <div className="py-10 text-center text-sm" style={{ background: 'var(--bg-elev-1)', border: '1px solid rgba(110,198,255,0.07)', borderRadius: 8, color: 'rgba(255,255,255,0.22)' }}>
              {t('explorer.empty_states.no_blocks_syncing')}
            </div>
          ) : (
            <>
              <div style={{ background: 'var(--bg-elev-1)', border: '1px solid rgba(110,198,255,0.13)', borderRadius: 8, overflow: 'hidden' }}>
                <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(110,198,255,0.08)', background: 'rgba(0,0,0,0.55)' }}>
                      <th className="pl-4 pr-2 py-2 text-left" style={TH_STYLE}>{t('explorer.blocks_table.height')}</th>
                      <th className="px-2 py-2 text-left" style={TH_STYLE}>{t('explorer.blocks_table.hash')}</th>
                      <th className="px-2 py-2 text-left" style={TH_STYLE}>{t('explorer.blocks_table.age')}</th>
                      <th className="px-2 py-2 text-center" style={TH_STYLE}>{t('explorer.blocks_table.txs_short')}</th>
                      <th className="px-2 py-2 text-left" style={TH_STYLE}>{t('explorer.blocks_table.miner')}</th>
                      <th className="pl-2 pr-4 py-2 text-right" style={TH_STYLE}>{t('explorer.blocks_table.reward')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* AnimatePresence with initial=false so only newly added blocks animate */}
                    <AnimatePresence initial={false}>
                      {blocks.map((block) => (
                        <BlockRow key={block.hash || block.height} block={block} onClick={() => setSelectedBlock(block)} />
                      ))}
                    </AnimatePresence>
                  </tbody>
                </table>
                </div>
              </div>

              {/* Load older blocks button */}
              <div className="mt-3 flex flex-col items-center gap-1.5">
                {reachedGenesis ? (
                  <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.22)', fontFamily: '"JetBrains Mono", monospace' }}>
                    {t('explorer.blocks_table.all_loaded', { count: blocks.length.toLocaleString('en-US') })}
                  </p>
                ) : (
                  <button
                    onClick={fetchOlder}
                    disabled={loadingMore || !canLoadMore}
                    className="flex items-center gap-2 px-5 py-2 text-xs font-semibold w-full justify-center transition-opacity disabled:opacity-40"
                    style={{
                      background: 'rgba(110,198,255,0.06)',
                      border: '1px solid rgba(110,198,255,0.18)',
                      borderRadius: 7,
                      color: 'rgba(110,198,255,0.70)',
                      fontFamily: '"Space Grotesk", sans-serif',
                    }}
                  >
                    {loadingMore
                      ? <><RefreshCw size={11} className="animate-spin" /> {t('explorer.load_more.loading_older')}</>
                      : <>{blockCursor !== null && blockCursor > 0
                          ? t('explorer.load_more.older_with_next', { height: blockCursor.toLocaleString('en-US') })
                          : t('explorer.load_more.older')}</>
                    }
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <div className="h-3" />
        </>
        )}
      </div>

      {/* ── Block detail modal ─────────────────────────── */}
      <AnimatePresence>
        {selectedBlock && (
          <BlockDetailModal block={selectedBlock} onClose={() => setSelectedBlock(null)} />
        )}
      </AnimatePresence>

      {/* ── Deep-link retry banner ─────────────────────────
          Shown when a click-through from the Miner page lands
          before iriumd has indexed the block. Backend returns
          "Block not found: N" (was the cryptic EOF); we surface
          a retry with a 5s delay so the user doesn't have to
          guess. Other failures (node offline, network) still
          surface as toast errors. */}
      <AnimatePresence>
        {pendingBlock && (
          <motion.div
            key="block-pending"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
            onClick={() => setPendingBlock(null)}
          >
            <motion.div
              initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 12 }}
              transition={{ duration: 0.16 }}
              className="w-full max-w-md"
              style={{ background: 'rgba(5,8,20,0.99)', border: '1px solid rgba(110,198,255,0.22)', borderRadius: 10, padding: 24 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2.5 mb-3">
                <Clock size={14} style={{ color: '#fbbf24' }} />
                <span style={{ fontFamily: '"Space Grotesk", sans-serif', fontSize: 14, fontWeight: 700, color: '#fbbf24' }}>
                  {t('explorer.block_modal.pending_title', { height: pendingBlock.height.toLocaleString('en-US') })}
                </span>
              </div>
              <p className="text-sm text-white/60 leading-relaxed mb-5">
                {t('explorer.block_modal.pending_body')}
              </p>
              <div className="flex items-center gap-3 justify-end">
                <button
                  onClick={() => setPendingBlock(null)}
                  className="btn-secondary text-xs py-2 px-4"
                  disabled={pendingBlock.retrying}
                >
                  {t('explorer.block_modal.dismiss')}
                </button>
                <button
                  onClick={handlePendingRetry}
                  className="btn-primary text-xs py-2 px-4 flex items-center gap-1.5"
                  disabled={pendingBlock.retrying}
                >
                  {pendingBlock.retrying ? (
                    <><RefreshCw size={12} className="animate-spin" /> {t('explorer.block_modal.retrying')}</>
                  ) : (
                    <><RefreshCw size={12} /> {t('explorer.block_modal.retry')}</>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
