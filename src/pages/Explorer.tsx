import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Copy, CheckCircle2, RefreshCw, Search,
  Cpu, Users, Layers, Clock, Activity, Zap, TrendingUp, Coins,
  Wallet, ArrowRightLeft, Trophy, Medal, Award, Server, UserCircle2, Lock,
  Calculator,
} from 'lucide-react';
import { fetch as tauriFetch, ResponseType } from '@tauri-apps/api/http';
import { useStore } from '../lib/store';
import { rpc, wallet, miner, gpuMiner, stratum } from '../lib/tauri';
import { timeAgo, formatIRM, SATS_PER_IRM } from '../lib/types';
import type {
  ExplorerBlock, NetworkHashrateInfo, RichListEntry, PoolStats,
  MinerStatus, GpuMinerStatus, StratumStatus,
} from '../lib/types';

type SearchTab = 'block' | 'tx' | 'address';
type PageTab = 'overview' | 'rich_list' | 'pool_stats';

// ── Helpers ───────────────────────────────────────────────────

// Consensus-defined halving interval. Mirrors HALVING_INTERVAL in
// irium-source/src/constants.rs:18 (`const HALVING_INTERVAL: u64 = 210_000`).
// The GUI used to carry 50_000 here which was a launch-era estimate that
// never matched the released chain — every "Next halving" hint was off by
// 4.2x as a result.
const HALVING_INTERVAL = 210_000;

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

// Protocol-enforced maximum issuance. Hardcoded because it is consensus-
// critical and never changes; surfacing it in the Rich List header lets
// users see how much of the cap has been minted so far and contextualises
// the "Minted supply" line above it.
const MAX_SUPPLY_IRM = 100_000_000;

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

// ── Mining Calculator ────────────────────────────────────────
// Formatters for the calculator output rows. Kept local to the
// component-area of the file because they are tuned for "expected
// daily mining yield" units and not general-purpose elsewhere.
function fmtBlocks(n: number | null): string {
  if (n === null) return '—';
  if (n < 0.0001) return '<0.0001';
  if (n < 1)      return n.toFixed(4);
  if (n < 100)    return n.toFixed(2);
  return Math.round(n).toLocaleString('en-US');
}

function fmtIrm(n: number | null): string {
  if (n === null) return '—';
  if (n < 0.01)   return '<0.01';
  if (n < 100)    return n.toFixed(2);
  return Math.round(n).toLocaleString('en-US');
}

type HashUnit = 'TH' | 'GH' | 'MH' | 'KH' | 'H';
const HASH_UNIT_TO_HPS: Record<HashUnit, number> = {
  TH: 1e12, GH: 1e9, MH: 1e6, KH: 1e3, H: 1,
};

function MiningCalculatorCard({ networkHps }: { networkHps: number | null }) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [unit, setUnit] = useState<HashUnit>('TH');

  // parseFloat() returns NaN on empty / non-numeric input; both Number.isNaN()
  // and the <= 0 guard reject those so the outputs render '—' rather than
  // 'NaN blocks/day'. parseFloat also accepts '17.5' and '1e6' which is the
  // intended behavior for a hashrate field.
  const parsed = parseFloat(input);
  const userHps =
    Number.isFinite(parsed) && parsed > 0 ? parsed * HASH_UNIT_TO_HPS[unit] : null;

  const haveBoth = userHps !== null && networkHps !== null && networkHps > 0;
  const ratio = haveBoth ? userHps! / networkHps! : null;
  // 144 = 86_400 / 600 (10-min protocol target).
  // 1_440 = 86_400 / 60 (currently observed ~1-min block time; matches the
  // BLOCKS_PER_HOUR=60 figure used elsewhere in the app for cooldowns).
  // Both numbers are shown so the user can compare design-target yield
  // against current-reality yield without the calculator picking a side.
  const protocolBlocksPerDay = ratio !== null ? ratio * 144  : null;
  const currentBlocksPerDay  = ratio !== null ? ratio * 1440 : null;
  const protocolIrmPerDay    = protocolBlocksPerDay !== null ? protocolBlocksPerDay * 50 : null;
  const currentIrmPerDay     = currentBlocksPerDay  !== null ? currentBlocksPerDay  * 50 : null;

  return (
    <div style={{ background: 'var(--bg-elev-1)', border: '1px solid rgba(110,198,255,0.10)', borderRadius: 8, padding: '14px 16px' }}>
      {/* Input row */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="flex items-center gap-1.5 mb-1.5" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.30)', fontFamily: '"Space Grotesk", sans-serif' }}>
            <Calculator size={10} style={{ color: '#6ec6ff', opacity: 0.75 }} />
            {t('explorer.calculator.your_hashrate')}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('explorer.calculator.placeholder')}
              className="flex-1 px-3 py-2 outline-none"
              style={{
                background: 'rgba(0,0,0,0.40)',
                border: '1px solid rgba(110,198,255,0.14)',
                borderRadius: 7,
                color: 'rgba(238,240,255,0.85)',
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 13,
                transition: 'border-color 0.15s',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(110,198,255,0.38)'; }}
              onBlur={(e)  => { e.currentTarget.style.borderColor = 'rgba(110,198,255,0.14)'; }}
            />
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as HashUnit)}
              className="px-3 py-2 outline-none"
              style={{
                background: 'rgba(0,0,0,0.40)',
                border: '1px solid rgba(110,198,255,0.14)',
                borderRadius: 7,
                color: 'rgba(238,240,255,0.85)',
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 13,
              }}
            >
              <option value="TH">TH/s</option>
              <option value="GH">GH/s</option>
              <option value="MH">MH/s</option>
              <option value="KH">KH/s</option>
              <option value="H">H/s</option>
            </select>
          </div>
        </div>
      </div>

      {/* Network context row */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1" style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', fontFamily: '"Space Grotesk", sans-serif' }}>
        <span>
          {t('explorer.calculator.network_label')}: <span style={{ color: 'rgba(255,255,255,0.70)', fontFamily: '"JetBrains Mono", monospace' }}>{networkHps != null && networkHps > 0 ? formatHashrate(networkHps) : '—'}</span>
        </span>
        <span>
          {t('explorer.calculator.block_reward_label')}: <span style={{ color: 'rgba(255,255,255,0.70)', fontFamily: '"JetBrains Mono", monospace' }}>50 IRM</span>
        </span>
      </div>

      {/* Output rows — protocol target then current chain rate.
          Two visually-distinct row styles so the user reads them as two
          different perspectives, not as alternatives to pick between. */}
      <div className="mt-4 space-y-2.5">
        <CalculatorOutputRow
          accent="#a78bfa"
          label={t('explorer.calculator.protocol_target')}
          sub={t('explorer.calculator.protocol_target_sub')}
          blocks={protocolBlocksPerDay}
          irm={protocolIrmPerDay}
          blocksSuffix={t('explorer.calculator.blocks_per_day_suffix')}
          irmSuffix={t('explorer.calculator.irm_per_day_suffix')}
        />
        <CalculatorOutputRow
          accent="#34d399"
          label={t('explorer.calculator.current_rate')}
          sub={t('explorer.calculator.current_rate_sub')}
          blocks={currentBlocksPerDay}
          irm={currentIrmPerDay}
          blocksSuffix={t('explorer.calculator.blocks_per_day_suffix')}
          irmSuffix={t('explorer.calculator.irm_per_day_suffix')}
        />
      </div>

      <p className="mt-3" style={{ fontSize: 10, color: 'rgba(255,255,255,0.28)', lineHeight: 1.45, fontFamily: '"Space Grotesk", sans-serif' }}>
        {t('explorer.calculator.disclaimer')}
      </p>
    </div>
  );
}

function CalculatorOutputRow({
  accent, label, sub, blocks, irm, blocksSuffix, irmSuffix,
}: {
  accent: string;
  label: string;
  sub: string;
  blocks: number | null;
  irm: number | null;
  blocksSuffix: string;
  irmSuffix: string;
}) {
  return (
    <div className="px-3.5 py-2.5" style={{ background: 'rgba(0,0,0,0.20)', border: `1px solid ${accent}22`, borderLeft: `2px solid ${accent}`, borderRadius: 6 }}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex flex-col">
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: accent, fontFamily: '"Space Grotesk", sans-serif' }}>
            {label}
          </span>
          <span style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.30)', fontFamily: '"Space Grotesk", sans-serif' }}>
            {sub}
          </span>
        </div>
        <div className="flex items-baseline gap-4" style={{ fontFamily: '"JetBrains Mono", monospace' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(238,240,255,0.90)' }}>
            ≈ {fmtBlocks(blocks)} <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.40)', fontWeight: 500 }}>{blocksSuffix}</span>
          </span>
          <span style={{ fontSize: 14, fontWeight: 700, color: accent }}>
            ≈ {fmtIrm(irm)} <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.40)', fontWeight: 500 }}>{irmSuffix}</span>
          </span>
        </div>
      </div>
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
    // (HALVING_INTERVAL = 210_000, initial = 50 IRM). iriumd doesn't currently
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

// Per-miner row returned by pool.iriumlabs.org:3337/miners. Matches the
// shape produced by /opt/irium-pool/stats-proxy.py: workers are keyed by
// Stratum worker name (<address>.<rig>), profile distinguishes ASIC vs
// CPU/GPU, hashrate_15m and last_share_ago_seconds may be null while the
// rolling window warms up (< 2 min of samples).
interface MinerRow {
  worker: string;
  // 'solo' was added when the stats-proxy patch merged the solo-stratum
  // profile into the unified /miners and /stats endpoints (a previously
  // separate /solo-miners route). The desktop's mining-overview panel
  // cross-references myAddresses against this list to surface pool-mining
  // hashrate even when the local CPU/GPU sidecar is idle.
  // 'port443' rows come from the sslh-multiplexed cpuminer stratum on
  // 127.0.0.1:3443 (publicly reached as :443). The UI merges port443
  // rows into the ASIC Miners panel rather than rendering a separate
  // section — see PoolStatsSection.
  profile: 'asic' | 'cpu_gpu' | 'solo' | 'port443';
  accepted: number;
  rejected: number;
  // Rolling deltas over the proxy's 15-min window. Distinct from
  // accepted/rejected (which are cumulative since the stratum's last
  // restart) so the GUI can show recent activity without the historical
  // warmup-burst tail dominating. Null during warmup, after a counter
  // rollback, or when the proxy's deque hasn't surfaced delta data yet
  // (pre-upgrade 2-tuple entries).
  accepted_15m?: number | null;
  rejected_15m?: number | null;
  reject_rate_pct: number | null;
  hashrate_15m: number | null;
  last_share_ago_seconds: number | null;
  // Cumulative blocks the worker has found at this stratum, populated by
  // the stats-proxy. Optional + nullable because older proxies and the
  // warmup window emit null; the column renders "—" when missing.
  blocks_found?: number | null;
}

interface MinersResponse {
  total_miners: number;
  miners: MinerRow[];
}

// Hashrate formatter that tolerates null and 0 — the existing inline
// formatHashrate inside PoolStatsSection is typed `(hps: number)` and is
// only called from a code path that already null-checked. Per-miner rows
// can carry null (warmup) or 0 (no shares yet) so we need a separate fn.
const formatMinerHashrate = (hps: number | null | undefined): string => {
  if (hps == null) return '—';
  if (hps === 0) return '0 H/s';
  if (hps >= 1e12) return `${(hps / 1e12).toFixed(2)} TH/s`;
  if (hps >= 1e9)  return `${(hps / 1e9).toFixed(2)} GH/s`;
  if (hps >= 1e6)  return `${(hps / 1e6).toFixed(2)} MH/s`;
  if (hps >= 1e3)  return `${(hps / 1e3).toFixed(2)} KH/s`;
  return `${Math.round(hps)} H/s`;
};

// Plain-English elapsed-time formatter for the per-miner table. The existing
// timeAgo() from ../lib/types takes a unix timestamp; the proxy returns a
// delta in seconds, so we wrap it with a different unit and pick natural
// English phrasing (single vs plural, "just now" for very recent).
const formatAgoPlainEnglish = (secs: number | null | undefined): string => {
  if (secs == null) return '—';
  if (secs < 5) return 'just now';
  if (secs < 60) {
    const s = Math.floor(secs);
    return `${s} second${s === 1 ? '' : 's'} ago`;
  }
  if (secs < 3600) {
    const m = Math.floor(secs / 60);
    return `${m} minute${m === 1 ? '' : 's'} ago`;
  }
  if (secs < 86400) {
    const h = Math.floor(secs / 3600);
    return `${h} hour${h === 1 ? '' : 's'} ago`;
  }
  const d = Math.floor(secs / 86400);
  return `${d} day${d === 1 ? '' : 's'} ago`;
};

// Truncate a stratum worker name to 12 visible characters using the
// "head…tail" pattern (5 head + 1 ellipsis + 6 tail = 12). The full
// worker name is preserved in the `title` attribute on the rendering site
// for hover-to-see-full-name.
const truncateMinerWorker = (w: string, n: number = 12): string => {
  if (w.length <= n) return w;
  const headLen = 5;
  const tailLen = Math.max(1, n - headLen - 1);
  return `${w.slice(0, headLen)}…${w.slice(-tailLen)}`;
};

// A miner is "offline" if they've stopped submitting shares recently.
// Two thresholds: hard cutoff at last share > 5 min (hide regardless of
// hashrate), and a stalled cutoff for zero 15-min hashrate + last share
// > 2 min. Rows where last_share_ago_seconds is null (proxy warmup) stay
// visible — "no data" must not be treated as "offline" because the
// rolling window genuinely has no samples yet.
const isMinerOffline = (m: MinerRow): boolean => {
  const last = m.last_share_ago_seconds;
  if (last == null) return false;
  if (last > 300) return true;
  if ((m.hashrate_15m ?? 0) === 0 && last > 120) return true;
  return false;
};

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

// Network-side response shape from iriumd's /rpc/network_hashrate. Fields
// match irium-source/src/bin/iriumd.rs:NetworkHashrateResponse one-for-one.
// hashrate / avg_block_time are nullable on the wire while the rolling
// window is still warming up (the endpoint needs at least 2 blocks of
// timestamp data); we treat both null and 0 as "—" in the render.
interface NetworkHashrateResp {
  tip_height: number;
  current_network_era: string;
  current_network_era_description: string;
  current_network_era_tagline: string | null;
  early_participation_signal: boolean;
  difficulty: number;
  hashrate: number | null;
  avg_block_time: number | null;
  window: number;
  sample_blocks: number;
}

// Human-readable block-time formatter. The chain targets 10 min but the
// observed mean on the small current network is ~1-2 min/block; we render
// in seconds below 60 s, minutes below an hour, then hours.
function formatBlockTime(secs: number | null | undefined): string {
  if (secs == null || secs <= 0) return '—';
  if (secs < 60) return `${Math.round(secs)}s`;
  if (secs < 3600) return `${(secs / 60).toFixed(1)}m`;
  return `${(secs / 3600).toFixed(1)}h`;
}

// NetworkMiningOverview — three-panel summary at the top of the Pool
// Stats tab. Sits above PoolStatsSection and gives the user a single-
// screen answer to "how is the network doing, how is the pool doing,
// how am I doing?" before drilling into the per-miner table below.
//
// All three panels refresh together on a single 30 s timer:
//   Panel 1 — Network Summary: iriumd /rpc/network_hashrate via
//             tauriFetch (no auth required; check_rate only).
//   Panel 2 — Pool Mining: pool.iriumlabs.org:3337/miners via
//             tauriFetch + the existing get_pool_stats Tauri command
//             for the lifetime blocks-found counter.
//   Panel 3 — Your Mining: local miner / gpu-miner / stratum status
//             via the existing Tauri commands. "Solo vs Pool" is
//             derived from stratum.connected — if the stratum client
//             is connected the CPU/GPU miner is feeding it work
//             through the pool path; otherwise the miner is talking
//             directly to iriumd over RPC (solo mode).
//
// Promise.allSettled so a single slow/failing endpoint never blocks
// the others — each panel renders whatever it has and shows "—" for
// the rest until the next poll.
function NetworkMiningOverview() {
  const [network, setNetwork] = useState<NetworkHashrateResp | null>(null);
  const [poolMiners, setPoolMiners] = useState<MinerRow[] | null>(null);
  const [poolAggregate, setPoolAggregate] = useState<PoolStats | null>(null);
  const [cpuStatus, setCpuStatus] = useState<MinerStatus | null>(null);
  const [gpuStatus, setGpuStatus] = useState<GpuMinerStatus | null>(null);
  const [stratumS, setStratumS] = useState<StratumStatus | null>(null);
  // Wallet addresses fetched once on mount. Cross-referenced against the
  // /miners proxy below to surface pool-mining state in Panel 3 even when
  // the local CPU/GPU miner is idle (the user might be mining via an
  // ASIC on the official pool, a SoloStratum bridge, or the cpu_gpu pool
  // profile from a different host). Empty set → no cross-reference,
  // Panel 3 falls back to the legacy local-miner-only behaviour.
  const [myAddresses, setMyAddresses] = useState<Set<string>>(new Set());

  const fetchAll = useCallback(async () => {
    const [netR, poolMinersR, poolStatsR, cpuR, gpuR, strR, addrR] = await Promise.allSettled([
      tauriFetch<NetworkHashrateResp>('http://127.0.0.1:38300/rpc/network_hashrate', {
        method: 'GET',
        responseType: ResponseType.JSON,
        timeout: 5,
      }),
      tauriFetch<MinersResponse>('http://pool.iriumlabs.org:3337/miners', {
        method: 'GET',
        responseType: ResponseType.JSON,
        timeout: 10,
      }),
      rpc.poolStats().catch(() => null),
      miner.status().catch(() => null),
      gpuMiner.status().catch(() => null),
      stratum.status().catch(() => null),
      wallet.listAddresses(),
    ]);
    if (netR.status === 'fulfilled' && netR.value.ok && netR.value.data) {
      setNetwork(netR.value.data);
    }
    if (poolMinersR.status === 'fulfilled' && poolMinersR.value.ok && poolMinersR.value.data) {
      setPoolMiners(poolMinersR.value.data.miners ?? []);
    }
    if (poolStatsR.status === 'fulfilled') setPoolAggregate(poolStatsR.value);
    if (cpuR.status === 'fulfilled') setCpuStatus(cpuR.value);
    if (gpuR.status === 'fulfilled') setGpuStatus(gpuR.value);
    if (strR.status === 'fulfilled') setStratumS(strR.value);
    if (addrR.status === 'fulfilled' && addrR.value) {
      setMyAddresses(
        new Set((addrR.value ?? []).map((a) => (a.address ?? '').trim()).filter(Boolean)),
      );
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 30_000);
    return () => clearInterval(id);
  }, [fetchAll]);

  // ── Derived values ──────────────────────────────────────────

  // Panel 1: network-wide.
  const networkHashrate = network?.hashrate ?? null;
  const networkDifficulty = network?.difficulty ?? null;
  const avgBlockTime = network?.avg_block_time ?? null;

  // Panel 2: pool aggregate from the per-miner rows.
  const poolRows = poolMiners ?? [];
  // Filter offline workers before aggregating. Same isMinerOffline
  // predicate the Active Miners table uses below, so the displayed Pool
  // Hashrate, Active Pool Miners count, and the table all agree on who
  // counts. The /miners feed's 15-min EMA tail keeps stale rows visible
  // for ~15 min after a worker disconnects (notably MRR rental sessions
  // that auto-failover after a stratum bounce), which would otherwise
  // inflate the aggregate Pool Hashrate.
  const activeRows = poolRows.filter((m) => !isMinerOffline(m));
  const poolHashrateRaw = activeRows.length > 0
    ? activeRows.reduce((sum, m) => sum + (m.hashrate_15m ?? 0), 0)
    : null;
  // Sanity cap: the proxy estimates per-worker hashrate from
  // accepted-share counts × current_diff over a rolling window. Vardiff
  // drift, transient bursts, or stale window samples can produce sums
  // that exceed the actual network hashrate — which is physically
  // impossible (the pool is a subset of the network). When the raw sum
  // exceeds the network value, clamp the displayed pool hashrate to the
  // network value and flag the panel so the user knows it's a clamped
  // estimate, not a measured value.
  const poolHashrateCapped = (poolHashrateRaw != null && networkHashrate != null && poolHashrateRaw > networkHashrate)
    ? networkHashrate
    : poolHashrateRaw;
  const poolHashrateClamped = poolHashrateRaw != null && networkHashrate != null && poolHashrateRaw > networkHashrate;
  const poolHashrate = poolHashrateCapped;
  // Active miner count derived from the same activeRows filter so the
  // count and the hashrate sum stay consistent.
  const activePoolMiners = activeRows.length;
  const poolBlocksFound = poolAggregate?.total_blocks_found ?? null;
  const poolShareOfNetwork = (poolHashrate != null && networkHashrate != null && networkHashrate > 0)
    ? (poolHashrate / networkHashrate) * 100
    : null;

  // Panel 1 derived: estimated active miners across the whole network.
  // Heuristic: assume the pool's average-active-miner hashrate is
  // representative of the wider network's average. This biases low for
  // networks where mega-farms mine solo (typical Bitcoin pattern) but is
  // the best single-data-source proxy available without crawling other
  // pools. Falls back to "—" when we don't have enough samples.
  const avgPoolMinerHashrate = (poolHashrate != null && activePoolMiners > 0)
    ? poolHashrate / activePoolMiners
    : null;
  const estimatedNetworkMiners = (networkHashrate != null && avgPoolMinerHashrate != null && avgPoolMinerHashrate > 0)
    ? Math.max(1, Math.round(networkHashrate / avgPoolMinerHashrate))
    : null;

  // Panel 3: local mining state.
  const cpuRunning = cpuStatus?.running === true;
  const gpuRunning = gpuStatus?.running === true;
  const localMining = cpuRunning || gpuRunning;
  // Hashrate fields on both miner-status structs are in kH/s; convert to
  // H/s for the shared formatter. Sum across CPU + GPU when both run.
  const localHashrateHps = (
    (cpuRunning ? (cpuStatus?.hashrate_khs ?? 0) : 0) +
    (gpuRunning ? (gpuStatus?.hashrate_khs ?? 0) : 0)
  ) * 1000;
  // Solo vs pool for the LOCAL miner: stratum.connected is the
  // authoritative bit. When the user starts mining via the Miner page's
  // "Pool" button the desktop wires the miner up to the stratum client,
  // and stratum.status() reports connected=true. Direct Mine-Solo path
  // keeps stratum disconnected, so localMining + !stratum.connected =
  // Solo.
  const stratumConnected = stratumS?.connected === true;
  const localBlocksFound = (cpuStatus?.blocks_found ?? 0) + (gpuStatus?.blocks_found ?? 0);

  // Pool-side cross-reference: rows on the /miners feed whose worker
  // name's base address is in the user's wallet. Profile distinguishes
  // ASIC (port 3333), cpu_gpu (3335), and solo (3336) — the same data
  // the stats-proxy patch already routes through /miners. We compute:
  //
  //   - aggregate hashrate across all of the user's pool rows
  //   - aggregate accepted shares
  //   - most-recent share timestamp (smallest last_share_ago_seconds)
  //   - dominant mode (Pool vs Solo) based on which profile has the
  //     larger hashrate; ties prefer the profile with more accepted
  //     shares so a single high-hashrate row in solo doesn't mask a
  //     larger sustained ASIC presence on the official pool
  // ExtRow extends MinerRow with the proxy's optional session_status
  // field. Profile union mirrors MinerRow (including 'port443' which
  // was added when sslh-multiplexed cpuminer stratum got wired into
  // /miners). The narrower 'asic'|'cpu_gpu'|'solo' typing here was a
  // pre-port443 artifact that forced an unsafe `as unknown as ExtRow`
  // cast; the new union lets the rows flow through with a clean cast.
  type ExtRow = MinerRow & { session_status?: 'active' | 'stale' };
  const myPoolRows: ExtRow[] = (poolMiners ?? [])
    .filter((m) => {
      const baseAddr = (m.worker.split('.')[0] ?? '').trim();
      return baseAddr.length > 0 && myAddresses.has(baseAddr);
    })
    .map((m) => m as ExtRow);
  const myPoolHashrateHps = myPoolRows.reduce(
    (sum, m) => sum + (m.hashrate_15m ?? 0),
    0,
  );
  const myPoolAccepted = myPoolRows.reduce((sum, m) => sum + (m.accepted ?? 0), 0);
  const myPoolLastShareSecs = myPoolRows.reduce<number | null>((min, m) => {
    if (m.last_share_ago_seconds == null) return min;
    if (min == null) return m.last_share_ago_seconds;
    return Math.min(min, m.last_share_ago_seconds);
  }, null);
  const myPoolMode: 'Pool' | 'Solo' | null = (() => {
    if (myPoolRows.length === 0) return null;
    let soloHr = 0;
    let poolHr = 0;
    let soloAcc = 0;
    let poolAcc = 0;
    for (const m of myPoolRows) {
      const hr = m.hashrate_15m ?? 0;
      const acc = m.accepted ?? 0;
      if (m.profile === 'solo') {
        soloHr += hr;
        soloAcc += acc;
      } else {
        poolHr += hr;
        poolAcc += acc;
      }
    }
    if (poolHr > soloHr) return 'Pool';
    if (soloHr > poolHr) return 'Solo';
    return poolAcc >= soloAcc ? 'Pool' : 'Solo';
  })();

  // Combined "Your Mining" surface. The user is mining if either the
  // local CPU/GPU miner is alive OR their address appears in any pool
  // row that's actually accepted shares. Hashrate is the union sum;
  // mode prefers the local stratum bit (because that's the most
  // immediate, real-time signal) and falls back to the pool cross-
  // reference when the user is exclusively pool-mining.
  const isMining = localMining || myPoolRows.length > 0;
  const yourHashrateHps = localHashrateHps + myPoolHashrateHps;
  const yourMode = !isMining
    ? '—'
    : localMining
      ? (stratumConnected ? 'Pool' : 'Solo')
      : (myPoolMode ?? '—');
  const yourBlocksFound = localBlocksFound;

  // ── Render ──────────────────────────────────────────────────

  const panelStyle: React.CSSProperties = {
    background: 'var(--bg-elev-1)',
    border: '1px solid rgba(110,198,255,0.10)',
    borderRadius: 8,
  };
  const panelTitleStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 800,
    color: '#d4eeff',
    fontFamily: '"Space Grotesk", sans-serif',
    letterSpacing: '0.02em',
  };

  return (
    <div className="space-y-3">
      <div>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: '#d4eeff', fontFamily: '"Space Grotesk", sans-serif', letterSpacing: '0.02em' }}>
          Network Mining Overview
        </h2>
        <p className="mt-1" style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)' }}>
          One-screen view of network, pool, and your own mining. Refreshes every 30 seconds.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Panel 1 — Network Summary */}
        <div className="p-4 space-y-3" style={panelStyle}>
          <h3 style={panelTitleStyle}>Network Summary</h3>
          <div className="grid grid-cols-2 gap-2">
            <PoolStatsTile
              label="Network Hashrate"
              value={networkHashrate != null ? formatHashrate(networkHashrate) : '—'}
              accent="#6ec6ff"
            />
            <PoolStatsTile
              label="Difficulty"
              value={networkDifficulty != null ? formatDifficulty(networkDifficulty) : '—'}
              accent="#6ec6ff"
            />
            <PoolStatsTile
              label="Avg Block Time"
              value={formatBlockTime(avgBlockTime)}
              accent="#6ec6ff"
            />
            <PoolStatsTile
              label="Est. Active Miners"
              value={estimatedNetworkMiners != null ? estimatedNetworkMiners.toLocaleString('en-US') : '—'}
              sub="network-wide estimate"
              accent="#6ec6ff"
            />
          </div>
        </div>

        {/* Panel 2 — Pool Mining */}
        <div className="p-4 space-y-3" style={panelStyle}>
          <h3 style={panelTitleStyle}>Pool Mining</h3>
          <div className="grid grid-cols-2 gap-2">
            <PoolStatsTile
              label="Pool Hashrate"
              value={poolHashrate != null ? formatHashrate(poolHashrate) : '—'}
              sub={poolHashrateClamped ? 'estimate' : undefined}
              accent="#a78bfa"
            />
            <PoolStatsTile
              label="Active Pool Miners"
              value={poolRows.length > 0 ? activePoolMiners.toLocaleString('en-US') : '—'}
              accent="#a78bfa"
            />
            <PoolStatsTile
              label="Pool Blocks Found"
              value={poolBlocksFound != null ? poolBlocksFound.toLocaleString('en-US') : '—'}
              sub="all time"
              accent="#a78bfa"
            />
            <PoolStatsTile
              label="Pool / Network"
              value={poolShareOfNetwork != null ? `${poolShareOfNetwork.toFixed(1)}%` : '—'}
              sub="share of network hashrate"
              accent="#a78bfa"
            />
          </div>
        </div>

        {/* Panel 3 — Your Mining. Surfaces both LOCAL miner state (CPU
            / GPU sidecars on this host) AND POOL miner state derived
            from cross-referencing the user's wallet addresses against
            the /miners feed. A user mining via an ASIC on the official
            pool would previously show as "not mining" here even though
            their hashrate was clearly attributable on the public stats
            page; the pool cross-reference fixes that. */}
        <div className="p-4 space-y-3" style={panelStyle}>
          <h3 style={panelTitleStyle}>Your Mining</h3>
          <div className="grid grid-cols-2 gap-2">
            <PoolStatsTile
              label="Your Hashrate"
              value={isMining && yourHashrateHps > 0
                ? formatHashrate(yourHashrateHps)
                : (isMining ? 'collecting…' : '—')}
              sub={myPoolRows.length > 0 && !localMining
                ? `${myPoolRows.length} pool worker${myPoolRows.length === 1 ? '' : 's'}`
                : undefined}
              accent="#34d399"
            />
            <PoolStatsTile
              label="Mode"
              value={yourMode}
              sub={!isMining
                ? 'not mining'
                : localMining
                  ? (stratumConnected ? 'connected via stratum' : 'direct to local node')
                  : (myPoolMode === 'Pool'
                    ? 'on pool.iriumlabs.org'
                    : 'on solo-stratum bridge')}
              accent="#34d399"
            />
            <PoolStatsTile
              label="Accepted Shares"
              value={myPoolRows.length > 0
                ? myPoolAccepted.toLocaleString('en-US')
                : (localMining
                  ? `${cpuRunning ? 'CPU ' : ''}${gpuRunning ? 'GPU ' : ''}`.trim()
                  : 'none')}
              sub={myPoolRows.length > 0 ? 'pool, lifetime' : undefined}
              accent="#34d399"
            />
            <PoolStatsTile
              label={myPoolRows.length > 0 ? 'Last Share' : 'Blocks You Found'}
              value={myPoolRows.length > 0
                ? formatAgoPlainEnglish(myPoolLastShareSecs)
                : yourBlocksFound.toLocaleString('en-US')}
              sub={myPoolRows.length > 0 ? 'from pool worker' : 'this session'}
              accent="#34d399"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function PoolStatsSection() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<PoolStats | null>(null);
  // Per-miner rows from pool.iriumlabs.org:3337/miners. Fetched in parallel
  // with /stats via Promise.all so a slow upstream on one endpoint doesn't
  // serialize the other. Null until the first successful fetch; empty
  // array on a fetch that succeeded but returned zero workers.
  const [miners, setMiners] = useState<MinerRow[]>([]);
  // User's wallet addresses — used to highlight rows for workers the user
  // owns (worker name "<address>.<rig>"). Once on mount; wallet addition
  // mid-session is rare and the next refresh picks it up if needed.
  const [myAddresses, setMyAddresses] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>('');
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  // Hide stale rows (e.g. an MRR rental that disconnected and is still
  // showing in the 15-min EMA tail). Default false; user can flip via the
  // toggle in the table header to inspect offline workers when debugging.
  const [showOffline, setShowOffline] = useState(false);

  // Parallel fetch of both endpoints. /stats goes via the Tauri command
  // (which is cached 30s on the Rust side); /miners goes via tauriFetch
  // (Rust-side reqwest) — NOT browser fetch. The renderer is served from
  // a tauri:// origin and Chromium blocks plain http:// targets as mixed
  // content regardless of the CSP connect-src directive, so the old
  // browser-fetch path failed silently with a swallowed catch and the
  // per-miner table never populated. tauriFetch bypasses the browser
  // policy by routing the request through the Rust process; the URL is
  // already in `http.scope` in tauri.conf.json so the request is
  // permitted by Tauri's own allowlist. Errors are now logged via
  // console.error so any future regression is diagnosable from DevTools
  // instead of vanishing into a silent .catch.
  const fetchStats = useCallback(async (silent: boolean = false) => {
    if (!silent) setLoading(true);
    setErr('');
    try {
      const [statsResult, minersResp] = await Promise.all([
        rpc.poolStats(),
        tauriFetch<MinersResponse>('http://pool.iriumlabs.org:3337/miners', {
          method: 'GET',
          responseType: ResponseType.JSON,
          timeout: 10,
        })
          .then((r) => {
            if (!r.ok) {
              // eslint-disable-next-line no-console
              console.warn('[Explorer] /miners non-ok status:', r.status, r.data);
              return null;
            }
            return r.data;
          })
          .catch((e) => {
            // eslint-disable-next-line no-console
            console.error('[Explorer] /miners fetch failed:', e);
            return null;
          }),
      ]);
      if (!statsResult) throw new Error('empty response');
      setStats(statsResult);
      if (minersResp) setMiners(minersResp.miners ?? []);
      setLastUpdated(Math.floor(Date.now() / 1000));
    } catch (e) {
      if (!silent) setErr(String(e));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Initial fetch + 30-second background refresh. Silent on the polled
  // refreshes so the loading skeleton only appears on the first paint and
  // on user-initiated Refresh clicks.
  useEffect(() => {
    fetchStats(false);
    const id = setInterval(() => fetchStats(true), 30_000);
    return () => clearInterval(id);
  }, [fetchStats]);

  // Wallet addresses for the "yours" highlight. Tolerates a wallet that's
  // not yet initialised — empty set just means no rows highlighted.
  useEffect(() => {
    let cancelled = false;
    wallet.listAddresses().then((list) => {
      if (cancelled) return;
      setMyAddresses(
        new Set((list ?? []).map((a) => (a.address ?? '').trim()).filter(Boolean)),
      );
    }).catch(() => { /* empty set → no rows highlighted, harmless */ });
    return () => { cancelled = true; };
  }, []);

  // Merge + sort. /miners emits one row per (worker, profile) pair —
  // a wallet connected to multiple stratums (e.g. ASIC 3333 + port-443
  // multiplex + solo 3336) gets a row each, and even on the same port
  // multiple rigs under the same address (worker name = "<addr>.<rig>")
  // produce separate rows. Aggregating the table view by summing all
  // those rows double-counts the wallet's true contribution and was
  // producing pool totals that exceeded the network hashrate — an
  // impossible result.
  //
  // Merge rule (per user spec): group rows by wallet base address (the
  // part before "."). For each group: SUM accepted, SUM rejected, take
  // MAX hashrate_15m ("use the higher hashrate" — avoids inflating
  // when the same physical rig is observed on multiple ports), take
  // MAX reject_rate_pct (most conservative for ops visibility), take
  // MIN last_share_ago_seconds (most-recent activity wins). Sort the
  // merged groups: wallet-owned first, then by hashrate desc, then by
  // accepted desc.
  const sortedMiners = useMemo(() => {
    type Merged = MinerRow;
    const byBase = new Map<string, Merged>();
    for (const m of miners) {
      const base = (m.worker.split('.')[0] ?? '').trim();
      if (!base) continue;
      const existing = byBase.get(base);
      if (!existing) {
        byBase.set(base, {
          worker: base,
          profile: m.profile,
          accepted: m.accepted ?? 0,
          rejected: m.rejected ?? 0,
          accepted_15m: m.accepted_15m ?? null,
          rejected_15m: m.rejected_15m ?? null,
          reject_rate_pct: m.reject_rate_pct,
          hashrate_15m: m.hashrate_15m,
          last_share_ago_seconds: m.last_share_ago_seconds,
          blocks_found: m.blocks_found ?? null,
        });
        continue;
      }
      existing.accepted = (existing.accepted ?? 0) + (m.accepted ?? 0);
      existing.rejected = (existing.rejected ?? 0) + (m.rejected ?? 0);
      // Sum rolling deltas across the merged group so the "Rejected
      // (15m)" column shows the wallet's full recent-window picture,
      // not just one connection's slice. Nulls treated as 0 for
      // accumulation but the sum stays null if NO row had data
      // (preserves "warmup" semantics in the UI).
      if (m.accepted_15m != null) {
        existing.accepted_15m = (existing.accepted_15m ?? 0) + m.accepted_15m;
      }
      if (m.rejected_15m != null) {
        existing.rejected_15m = (existing.rejected_15m ?? 0) + m.rejected_15m;
      }
      // Sum blocks_found across the merged group so the column reflects
      // the wallet's total per-pool block credit. Same null-as-0
      // accumulation as the rejected_15m field above; the sum stays
      // null if NO row in the group had data.
      if (m.blocks_found != null) {
        existing.blocks_found = (existing.blocks_found ?? 0) + m.blocks_found;
      }
      const eHr = existing.hashrate_15m ?? -1;
      const mHr = m.hashrate_15m ?? -1;
      if (mHr > eHr) existing.hashrate_15m = m.hashrate_15m;
      const eRr = existing.reject_rate_pct ?? -1;
      const mRr = m.reject_rate_pct ?? -1;
      if (mRr > eRr) existing.reject_rate_pct = m.reject_rate_pct;
      const eLs = existing.last_share_ago_seconds ?? Number.POSITIVE_INFINITY;
      const mLs = m.last_share_ago_seconds ?? Number.POSITIVE_INFINITY;
      if (mLs < eLs) existing.last_share_ago_seconds = m.last_share_ago_seconds;
    }
    return Array.from(byBase.values()).sort((a, b) => {
      const aMine = myAddresses.has(a.worker);
      const bMine = myAddresses.has(b.worker);
      if (aMine !== bMine) return aMine ? -1 : 1;
      const aHr = a.hashrate_15m ?? 0;
      const bHr = b.hashrate_15m ?? 0;
      if (aHr !== bHr) return bHr - aHr;
      return (b.accepted ?? 0) - (a.accepted ?? 0);
    });
  }, [miners, myAddresses]);

  // Split sortedMiners into active vs offline. activeMiners drives the
  // header counter and the default-visible table; displayedMiners adds the
  // offline rows back in when the user toggles showOffline on. Keeping the
  // partition separate from sortedMiners means a single sort/merge feeds
  // both views and the offline-toggle is just a filter, not a re-fetch.
  const activeMiners = useMemo(
    () => sortedMiners.filter((m) => !isMinerOffline(m)),
    [sortedMiners],
  );
  const offlineCount = sortedMiners.length - activeMiners.length;
  const displayedMiners = showOffline ? sortedMiners : activeMiners;

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
          onClick={() => fetchStats(false)}
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
      ) : (() => {
        // Port 443 (sslh-multiplexed cpuminer stratum) is its own service
        // but Ibrahim's intent is to surface it as part of the ASIC Miners
        // section, not as a separate pool. The /stats endpoint doesn't
        // expose port443 as a top-level key (yet), so we sum the port443
        // rows from /miners client-side and merge them into the ASIC
        // numbers for display purposes. Done at the JSX-block level (not
        // inside the inner IIFE) so the per-profile detail panel below
        // can see the same merged data.
        type RowExt = MinerRow & { session_status?: 'active' | 'stale' };
        const port443Rows = miners.filter((m) => m.profile === 'port443');
        const port443Active = port443Rows.filter((m) => {
          const ext = m as RowExt;
          return ext.session_status
            ? ext.session_status === 'active'
            : (m.hashrate_15m ?? 0) > 0;
        }).length;
        const port443Accepted = port443Rows.reduce((s, m) => s + (m.accepted ?? 0), 0);
        const port443Rejected = port443Rows.reduce((s, m) => s + (m.rejected ?? 0), 0);
        const port443Hashrate = port443Rows.reduce((s, m) => s + (m.hashrate_15m ?? 0), 0);
        const has443 = port443Rows.length > 0;

        const asicMerged = {
          ...stats.asic,
          active_miners: stats.asic.active_miners + port443Active,
          tcp_sessions: stats.asic.tcp_sessions + port443Rows.length,
          accepted_shares: stats.asic.accepted_shares + port443Accepted,
          rejected_shares: stats.asic.rejected_shares + port443Rejected,
          hashrate_estimate_hps: (stats.asic.hashrate_estimate_hps ?? 0) + port443Hashrate,
        };

        return (
        <>
          {(() => {
            // Effective miner count per profile: only count a profile as
            // having "active miners" once at least one share has been
            // accepted. Otherwise the displayed number is 0, regardless of
            // how many raw TCP sessions are open — those are dominated by
            // port scanners and abandoned connections in practice. The raw
            // socket count is still surfaced below as "TCP connections".
            const asicEffective = asicMerged.accepted_shares > 0 ? asicMerged.active_miners : 0;
            const cpuEffective = stats.cpu_gpu.accepted_shares > 0 ? stats.cpu_gpu.active_miners : 0;
            const totalEffective = asicEffective + cpuEffective;
            const asicPortSub = has443
              ? `ports ${stats.asic_port} + 443`
              : t('explorer.pool_stats.asic_port', { port: stats.asic_port });
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
                    sub={asicPortSub}
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
              { key: 'asic',    label: t('explorer.pool_stats.asic_miners'),    port: has443 ? `${stats.asic_port}+443` : `${stats.asic_port}`, data: asicMerged },
              { key: 'cpu_gpu', label: t('explorer.pool_stats.cpu_gpu_miners'), port: `${stats.cpu_gpu_port}`,                                  data: stats.cpu_gpu },
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

          {/* Per-miner table — fetched from pool.iriumlabs.org:3337/miners
              alongside /stats (parallel Promise.all, 30 s polling). Rows
              are pre-sorted: wallet-owned workers pinned to top, then by
              15-min hashrate desc, then by accepted-share count desc. */}
          <div
            className="p-4"
            style={{ background: 'var(--bg-elev-1)', border: '1px solid rgba(110,198,255,0.13)', borderRadius: 8 }}
          >
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span style={{ fontSize: 13, fontWeight: 700, color: '#d4eeff', fontFamily: '"Space Grotesk", sans-serif' }}>
                  Active Miners
                </span>
                <span className="font-mono" style={{ fontSize: 11, color: 'rgba(110,198,255,0.55)' }}>
                  {activeMiners.length} {activeMiners.length === 1 ? 'worker' : 'workers'}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {myAddresses.size > 0 && displayedMiners.some((m) => myAddresses.has((m.worker.split('.')[0] ?? '').trim())) && (
                  <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)' }}>
                    Your miners pinned to top
                  </span>
                )}
                {offlineCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowOffline((s) => !s)}
                    style={{
                      fontSize: 10.5,
                      color: showOffline ? '#a78bfa' : 'rgba(255,255,255,0.55)',
                      background: showOffline ? 'rgba(167,139,250,0.10)' : 'transparent',
                      border: `1px solid ${showOffline ? 'rgba(167,139,250,0.40)' : 'rgba(110,198,255,0.20)'}`,
                      borderRadius: 6,
                      padding: '3px 8px',
                      fontFamily: '"Space Grotesk", sans-serif',
                      cursor: 'pointer',
                      letterSpacing: '0.02em',
                    }}
                  >
                    {showOffline ? `Hide offline (${offlineCount})` : `Show offline miners (${offlineCount})`}
                  </button>
                )}
              </div>
            </div>
            {displayedMiners.length === 0 ? (
              <div className="py-6 text-center" style={{ fontSize: 12, color: 'rgba(255,255,255,0.40)' }}>
                No active miners reporting.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full" style={{ fontSize: 12 }}>
                  <thead>
                    <tr style={{ color: 'rgba(255,255,255,0.40)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: '"Space Grotesk", sans-serif' }}>
                      <th className="text-left py-2 pr-3 font-semibold">Worker</th>
                      <th className="text-right py-2 px-3 font-semibold">Accepted</th>
                      <th className="text-right py-2 px-3 font-semibold" title="Rejected shares in the last 15 minutes only. The cumulative count (since stratum restart) kept a worker showing a stale warmup-burst total even after they recovered.">Rejected (15m)</th>
                      <th className="text-right py-2 px-3 font-semibold" title="Rolling rejection rate over the last 15 minutes. The cumulative-since-restart rate kept a worker stuck on a post-restart warmup burst even after they recovered.">Reject % (15m)</th>
                      <th className="text-right py-2 px-3 font-semibold">Hashrate (15m)</th>
                      <th className="text-right py-2 px-3 font-semibold" title="Blocks found by this worker at the pool. Populated by the stats-proxy; shows '—' until the proxy backfills per-worker block credit.">Blocks</th>
                      <th className="text-right py-2 pl-3 font-semibold">Last Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedMiners.map((m, idx) => {
                      const addressPart = (m.worker.split('.')[0] ?? '').trim();
                      const isMine = addressPart.length > 0 && myAddresses.has(addressPart);
                      // Color by reject rate: < 10% green, 10-30% amber,
                      // > 30% red. Null (not enough samples) → dim grey.
                      const rejectColor =
                        m.reject_rate_pct == null ? 'rgba(255,255,255,0.40)'
                        : m.reject_rate_pct < 10 ? '#34d399'
                        : m.reject_rate_pct < 30 ? '#fbbf24'
                        : '#f87171';
                      return (
                        <tr
                          key={`${m.worker}-${m.profile}-${idx}`}
                          style={{
                            borderTop: '1px solid rgba(255,255,255,0.04)',
                            ...(isMine ? {
                              background: 'rgba(110,198,255,0.07)',
                              boxShadow: 'inset 3px 0 0 0 rgba(110,198,255,0.55)',
                            } : {}),
                          }}
                        >
                          <td className="py-2 pr-3" style={{ fontFamily: '"JetBrains Mono", monospace' }}>
                            <span title={m.worker}>{truncateMinerWorker(m.worker, 12)}</span>
                            {isMine && (
                              <span
                                className="ml-2"
                                style={{
                                  display: 'inline-block',
                                  padding: '1px 6px',
                                  borderRadius: 3,
                                  background: 'rgba(110,198,255,0.18)',
                                  border: '1px solid rgba(110,198,255,0.40)',
                                  color: '#6ec6ff',
                                  fontSize: 9,
                                  fontWeight: 700,
                                  letterSpacing: '0.04em',
                                  textTransform: 'uppercase',
                                  fontFamily: '"Space Grotesk", sans-serif',
                                  verticalAlign: 'middle',
                                }}
                              >
                                yours
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right font-mono" style={{ color: '#34d399' }}>
                            {m.accepted.toLocaleString('en-US')}
                          </td>
                          <td className="py-2 px-3 text-right font-mono" style={{ color: (m.rejected_15m ?? 0) > 0 ? '#fda4af' : 'rgba(255,255,255,0.30)' }}>
                            {(m.rejected_15m ?? 0).toLocaleString('en-US')}
                          </td>
                          <td className="py-2 px-3 text-right font-mono" style={{ color: rejectColor }}>
                            {m.reject_rate_pct == null ? '—' : `${m.reject_rate_pct.toFixed(1)}%`}
                          </td>
                          <td className="py-2 px-3 text-right font-mono" style={{ color: 'rgba(255,255,255,0.80)' }}>
                            {formatMinerHashrate(m.hashrate_15m)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono" style={{ color: (m.blocks_found ?? 0) > 0 ? '#fbbf24' : 'rgba(255,255,255,0.30)' }}>
                            {m.blocks_found == null ? '—' : m.blocks_found.toLocaleString('en-US')}
                          </td>
                          <td className="py-2 pl-3 text-right" style={{ color: 'rgba(255,255,255,0.55)' }}>
                            {formatAgoPlainEnglish(m.last_share_ago_seconds)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
        );
      })()}
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
  // Rich-list balances render as IRM. Whole-IRM balances drop the
  // fractional part entirely ("292,900 IRM"); anything carrying
  // fractional sats renders with EXACTLY 2 decimals ("37,134.90 IRM")
  // so trailing zeros aren't trimmed and adjacent rows stay aligned.
  const formatRichListIRM = (balanceSats: number): string => {
    const irm = balanceSats / 100_000_000;
    const hasDecimals = balanceSats % 100_000_000 !== 0;
    return irm.toLocaleString('en-US', {
      minimumFractionDigits: hasDecimals ? 2 : 0,
      maximumFractionDigits: 2,
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
  // Percentages in the Rich List are normalised against the *protocol*
  // maximum supply (100M IRM), not the currently-minted supply. Anchoring
  // to the hard cap means each row's "% of supply" stays meaningful as
  // more IRM is mined — a 1M IRM holder shows 1.0000% today and still
  // shows 1.0000% at full issuance, instead of shrinking as the minted
  // base grows.
  const MAX_SUPPLY_SATS = MAX_SUPPLY_IRM * 100_000_000;
  const lockedPct: number = (lockedSats / MAX_SUPPLY_SATS) * 100;
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
              {/* Maximum supply — hardcoded protocol constant. Styled muted
                  so users can tell at a glance that this is the static
                  ceiling, not a live measurement. The pct-minted figure is
                  computed against totalSupply (which already includes the
                  CLTV-locked founder allocation) so it represents the
                  fraction of the hard cap that has been minted so far. */}
              {(() => {
                const mintedIrm = totalSupply / 100_000_000;
                const pctMinted = ((mintedIrm / MAX_SUPPLY_IRM) * 100).toFixed(4);
                return (
                  <p
                    style={{ color: 'rgba(255,255,255,0.32)' }}
                    title={t('explorer.richlist.max_supply_tooltip')}
                  >
                    {t('explorer.richlist.maximum_supply')}:{' '}
                    <span style={{ color: 'rgba(255,255,255,0.55)' }}>
                      {MAX_SUPPLY_IRM.toLocaleString('en-US')} IRM
                    </span>{' '}
                    <span style={{ color: 'rgba(255,255,255,0.30)' }}>
                      {t('explorer.richlist.hard_cap_suffix')} · {t('explorer.richlist.pct_minted', { pct: pctMinted })}
                    </span>
                  </p>
                );
              })()}
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
                        {lockedPct.toFixed(4)}%
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
                      {/* % of supply — computed locally against MAX_SUPPLY_SATS,
                          NOT the server-provided e.percentage (which is
                          relative to currently-minted supply and so over-
                          weights every row early in the chain's lifetime). */}
                      <td className="px-2 py-2.5 text-right whitespace-nowrap">
                        <span style={{ fontSize: 11, color: 'rgba(110,198,255,0.75)', fontFamily: '"JetBrains Mono", monospace', fontVariantNumeric: 'tabular-nums' }}>
                          {((e.balance_sats / MAX_SUPPLY_SATS) * 100).toFixed(4)}%
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
                  {formatRichListIRM(lockedSats)} <span style={{ color: 'rgba(253,230,138,0.60)', fontSize: 11 }}>({lockedPct.toFixed(4)}% {t('explorer.richlist.of_total_supply')})</span>
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
  // table; 'rich_list' swaps the body for the Top Holders table;
  // 'pool_stats' shows the public pool snapshot. Lazy initializer reads
  // `pageTab` from location.state so a deep-link from another page (e.g.
  // the Mining page's "View Pool Stats" button) can pre-select a specific
  // tab. Falls back to 'overview' for a bare /explorer visit.
  const [pageTab, setPageTab] = useState<PageTab>(() => {
    const ns = location.state as { pageTab?: PageTab } | null;
    return ns?.pageTab ?? 'overview';
  });

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
         pageTab === 'pool_stats' ? (
           <div className="space-y-6">
             <NetworkMiningOverview />
             <PoolStatsSection />
           </div>
         ) : (
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

        {/* ── Mining Calculator ─────────────────────────── */}
        {running && (
          <div>
            <SectionLabel title={t('explorer.calculator.title')} />
            <MiningCalculatorCard networkHps={hashrateInfo?.hashrate ?? null} />
          </div>
        )}

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
                  {(() => {
                    // For address search results, render sat-denominated
                    // fields as IRM and surface a special card for the
                    // founder-vesting address (whose CLTV-locked UTXO
                    // never registers as a P2PKH spendable balance, so
                    // it always reports 0 even though 3.5M IRM live at
                    // that PKH).
                    if (searchTab !== 'address') {
                      return (
                        <SearchResultCard
                          result={searchResult}
                          title={searchTab === 'block' ? t('explorer.search_results.block') : t('explorer.search_results.tx')}
                        />
                      );
                    }
                    const formatIrm = (sats: number): string => {
                      const irm = sats / 100_000_000;
                      return irm.toLocaleString('en-US', {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 4,
                      }) + ' IRM';
                    };
                    const displayResult: Record<string, unknown> = { ...searchResult };
                    if (typeof displayResult.balance === 'number') {
                      displayResult.balance = formatIrm(displayResult.balance);
                    }
                    if (typeof displayResult.mined_balance === 'number') {
                      displayResult.mined_balance = formatIrm(displayResult.mined_balance);
                    }
                    const isFounder = displayResult.address === FOUNDER_VESTING_ADDRESS;
                    const blocksRemaining = Math.max(0, FOUNDER_VESTING_UNLOCK_HEIGHT - height);
                    return (
                      <>
                        {isFounder && (
                          <div
                            className="mt-2.5 px-4 py-3 rounded-lg"
                            style={{
                              background: 'rgba(245,158,11,0.08)',
                              border: '1px solid rgba(245,158,11,0.40)',
                            }}
                          >
                            <div className="flex items-center gap-2 mb-1.5">
                              <Lock size={13} style={{ color: '#fbbf24' }} />
                              <span style={{ fontSize: 12.5, fontWeight: 700, color: '#fde68a', fontFamily: '"Space Grotesk", sans-serif' }}>
                                Founder Vesting Address
                              </span>
                            </div>
                            <p style={{ fontSize: 11.5, color: 'rgba(253,230,138,0.85)', lineHeight: 1.55 }}>
                              This address holds 3,500,000 IRM locked via CLTV timelock at genesis.
                              Balance shown as 0 because locked funds use a special script not counted
                              as spendable balance.
                            </p>
                            <p className="mt-1.5" style={{ fontSize: 11, color: 'rgba(253,230,138,0.70)', fontFamily: '"JetBrains Mono", monospace' }}>
                              Unlocks at block #{FOUNDER_VESTING_UNLOCK_HEIGHT.toLocaleString('en-US')}
                              {height > 0 && ` (~${blocksRemaining.toLocaleString('en-US')} blocks remaining)`}
                            </p>
                          </div>
                        )}
                        <SearchResultCard
                          result={displayResult}
                          title={t('explorer.search_results.address')}
                        />
                      </>
                    );
                  })()}
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
