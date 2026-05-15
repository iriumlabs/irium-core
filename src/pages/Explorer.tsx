import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Copy, CheckCircle2, RefreshCw, Search,
  Cpu, Users, Layers, Clock, Activity, Zap, TrendingUp, Coins,
  Wallet, ArrowRightLeft,
} from 'lucide-react';
import { useStore } from '../lib/store';
import { rpc } from '../lib/tauri';
import { timeAgo } from '../lib/types';
import type { ExplorerBlock, NetworkHashrateInfo } from '../lib/types';

type SearchTab = 'block' | 'tx' | 'address';

// ── Helpers ───────────────────────────────────────────────────

const HALVING_INTERVAL = 50_000;

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
      title="Copy"
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
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const rows = [
    { label: 'Height',      value: `#${block.height.toLocaleString()}`,                                   mono: true,  copy: false },
    { label: 'Hash',        value: block.hash || '—',                                                     mono: true,  copy: !!block.hash },
    { label: 'Prev Hash',   value: block.prev_hash || '—',                                                mono: true,  copy: !!block.prev_hash },
    { label: 'Merkle Root', value: block.merkle_root || '—',                                              mono: true,  copy: !!block.merkle_root },
    { label: 'Time',        value: block.time ? new Date(block.time * 1000).toLocaleString() : '—',      mono: false, copy: false },
    { label: 'Reward',      value: blockReward(block.height),                                             mono: true,  copy: false, color: '#34d399' },
    { label: 'Transactions',value: String(block.tx_count),                                                mono: true,  copy: false },
    { label: 'Bits',        value: block.bits || '—',                                                     mono: true,  copy: false },
    { label: 'Nonce',       value: block.nonce != null ? String(block.nonce) : '—',                       mono: true,  copy: false },
    { label: 'Miner',       value: block.miner_address || '—',                                            mono: true,  copy: !!block.miner_address },
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
              Block #{block.height.toLocaleString()}
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
          #{block.height.toLocaleString()}
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
        <span style={{ fontSize: 11, color: '#34d399', fontVariantNumeric: 'tabular-nums', fontFamily: '"JetBrains Mono", monospace' }}>
          {blockReward(block.height)}
        </span>
      </td>
    </motion.tr>
  );
}

// ── Main page ─────────────────────────────────────────────────

export default function Explorer() {
  const nodeStatus  = useStore((s) => s.nodeStatus);
  const location    = useLocation();

  // Block list state — grows as user loads older blocks
  const [blocks,        setBlocks]        = useState<ExplorerBlock[]>([]);
  const [initialLoaded, setInitialLoaded] = useState(false);
  // null = not yet known, number = oldest loaded height minus 1, 0 = reached genesis
  const [blockCursor,   setBlockCursor]   = useState<number | null>(null);
  const [loadingMore,   setLoadingMore]   = useState(false);

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
    // openBlockData: full block object pre-fetched by the Miner page via
    // fetch_block_details. When present, used directly — no extra RPC call.
    openBlockData?: ExplorerBlock;
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
  // Blocks list. If openBlockData is present, use it directly (no extra RPC
  // call — the Miner page already fetched it via fetch_block_details). If
  // only openBlockHeight is present, fetch from iriumd as a fallback,
  // extracting fields from the nested "header" sub-object that iriumd uses.
  // The consumed ref guards against StrictMode's double-invoke and stale
  // location.state. window.history.replaceState clears state so back/forward
  // navigation doesn't re-open the modal.
  const deepLinkConsumedRef = useRef(false);
  useEffect(() => {
    if (deepLinkConsumedRef.current) return;
    const h = navState?.openBlockHeight;
    if (h == null) return;
    deepLinkConsumedRef.current = true;
    window.history.replaceState({}, '');

    const passedBlock = navState?.openBlockData;
    if (passedBlock) {
      setSelectedBlock(passedBlock);
      return;
    }

    (async () => {
      try {
        const raw = (await rpc.block(String(h))) as Record<string, unknown>;
        if (!raw || Object.keys(raw).length === 0) return;
        const str = (v: unknown): string => (typeof v === 'string' ? v : '');
        const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);
        const txArr = Array.isArray(raw.tx) ? (raw.tx as unknown[]) : null;
        // iriumd nests hash/prev_hash/merkle_root/time/bits/nonce in "header".
        const hdr = (typeof raw.header === 'object' && raw.header !== null)
          ? (raw.header as Record<string, unknown>)
          : {};
        const block: ExplorerBlock = {
          height:       num(raw.height) || h,
          hash:         str(hdr.hash) || str(raw.hash),
          prev_hash:    str(hdr.prev_hash) || str(raw.prev_hash) || str(raw.previousblockhash) || str(raw.previous_block_hash),
          merkle_root:  str(hdr.merkle_root) || str(raw.merkle_root) || str(raw.merkleroot),
          time:         num(hdr.time) || num(raw.time),
          tx_count:     num(raw.tx_count) || num(raw.n_tx) || (txArr ? txArr.length : 0),
          bits:         str(hdr.bits) || str(raw.bits),
          nonce:        typeof hdr.nonce === 'number' ? hdr.nonce : (typeof raw.nonce === 'number' ? raw.nonce : undefined),
          miner_address: str(raw.miner_address) || str(raw.miner),
        };
        setSelectedBlock(block);
      } catch { /* block not found / node offline — silent */ }
    })();
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
        setSearchErr('No result found.');
      }
    } catch {
      if (searchTab === 'block') {
        setSearchErr('Block not found.');
      } else if (searchTab === 'tx') {
        setSearchErr('Transaction not found — the node may not yet index transactions by ID.');
      } else {
        setSearchErr('Address not found — the node may not yet expose address balance lookup.');
      }
    } finally {
      setSearching(false);
    }
  };

  const searchPlaceholders: Record<SearchTab, string> = {
    block:   'Block height or hash (e.g. 21000 or 00a3b…)',
    tx:      'Transaction ID (64-char hex)',
    address: 'Irium address (e.g. Q… or P…)',
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
                Block Explorer
              </h1>
              {live && (
                <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full" style={{ background: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.22)' }}>
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#34d399' }} />
                  <span style={{ fontSize: 9.5, color: '#34d399', fontWeight: 700, letterSpacing: '0.1em', fontFamily: '"Space Grotesk", sans-serif' }}>LIVE</span>
                </span>
              )}
            </div>
            <div className="mt-1" style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: 'rgba(110,198,255,0.50)' }}>
              {live
                ? `#${height.toLocaleString()} · ${peerCount}p · ${synced ? 'synced' : `${((height / (tip || 1)) * 100).toFixed(1)}% sync`}`
                : running ? 'Loading chain data…' : 'Node offline — start node on Dashboard'}
            </div>
          </div>

          <button onClick={handleRefresh} disabled={refreshing} className="btn-secondary text-xs gap-2">
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">

        {/* ── Network Stats ─────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {!running ? (
            <div
              className="col-span-2 sm:col-span-3 lg:col-span-6 py-3 text-center text-sm"
              style={{ color: 'rgba(255,255,255,0.22)' }}
            >
              Start the node on the Dashboard to see network stats
            </div>
          ) : !initialLoaded ? (
            Array.from({ length: 6 }).map((_, i) => <StatCardSkeleton key={i} />)
          ) : (
            <>
              <StatCard icon={Layers}     label="Block Height"      value={`#${height.toLocaleString()}`}                         sub={tip > 0 && !synced ? `tip #${tip.toLocaleString()}` : 'chain tip'}   accent="#6ec6ff" />
              <StatCard icon={Coins}      label="Circulating Supply" value={computeCirculatingSupply(height)}                      sub={`Next halving: #${nextHalvingBlock(height).toLocaleString()}`}           accent="#34d399" />
              <StatCard icon={Zap}        label="Network Hashrate"   value={hashrateInfo?.hashrate != null ? formatHashrate(hashrateInfo.hashrate) : '—'} sub="proof-of-work"                                accent="#fbbf24" />
              <StatCard icon={TrendingUp} label="Difficulty (LWMA)"  value={hashrateInfo?.difficulty != null ? formatDifficulty(hashrateInfo.difficulty) : '—'} sub="LWMA-144 target"                        accent="#a78bfa" />
              <StatCard icon={Users}      label="Peers"              value={peerCount.toLocaleString()}                            sub="connected"                                                            accent="#6ec6ff" />
              <StatCard icon={Cpu}        label="Active Miners"      value={activeMiners.toLocaleString()}                         sub="recent blocks"                                                        accent="#fb923c" />
            </>
          )}
        </div>

        {/* ── Search ─────────────────────────────────────── */}
        {running && (
          <div>
            <SectionLabel title="Search" />
            {/* Tab bar */}
            <div className="flex items-center gap-1.5 mb-3">
              <TabBtn active={searchTab === 'block'}   onClick={() => { setSearchTab('block');   clearSearch(); setSearchQ(''); }} icon={Layers}         label="Block" />
              <TabBtn active={searchTab === 'tx'}      onClick={() => { setSearchTab('tx');      clearSearch(); setSearchQ(''); }} icon={ArrowRightLeft} label="Transaction" />
              <TabBtn active={searchTab === 'address'} onClick={() => { setSearchTab('address'); clearSearch(); setSearchQ(''); }} icon={Wallet}         label="Address" />
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
                Look up
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
                    title={searchTab === 'block' ? 'Block Details' : searchTab === 'tx' ? 'Transaction' : 'Address Info'}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* ── Block Table ─────────────────────────────────── */}
        <div>
          <SectionLabel
            title="Blocks"
            right={
              blocks.length > 0 ? (
                <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: 'rgba(110,198,255,0.35)', whiteSpace: 'nowrap' }}>
                  {blocks.length.toLocaleString()} loaded
                  {oldestLoaded !== undefined && ` · #${oldestLoaded.toLocaleString()}–#${newestLoaded?.toLocaleString()}`}
                </span>
              ) : undefined
            }
          />

          {!initialLoaded ? (
            !running ? (
              /* Node offline — don't perpetually skeleton; show clear offline state */
              <div className="py-10 text-center text-sm" style={{ background: 'var(--bg-elev-1)', border: '1px solid rgba(110,198,255,0.07)', borderRadius: 8, color: 'rgba(255,255,255,0.22)' }}>
                Start the node on the Dashboard to load blocks
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
              No blocks yet — syncing…
            </div>
          ) : (
            <>
              <div style={{ background: 'var(--bg-elev-1)', border: '1px solid rgba(110,198,255,0.13)', borderRadius: 8, overflow: 'hidden' }}>
                <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(110,198,255,0.08)', background: 'rgba(0,0,0,0.55)' }}>
                      <th className="pl-4 pr-2 py-2 text-left" style={TH_STYLE}>Height</th>
                      <th className="px-2 py-2 text-left" style={TH_STYLE}>Hash</th>
                      <th className="px-2 py-2 text-left" style={TH_STYLE}>Age</th>
                      <th className="px-2 py-2 text-center" style={TH_STYLE}>Txs</th>
                      <th className="px-2 py-2 text-left" style={TH_STYLE}>Miner</th>
                      <th className="pl-2 pr-4 py-2 text-right" style={TH_STYLE}>Reward</th>
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
                    All {blocks.length.toLocaleString()} blocks loaded — from genesis to tip
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
                      ? <><RefreshCw size={11} className="animate-spin" /> Loading older blocks…</>
                      : <>Load older blocks {blockCursor !== null && blockCursor > 0 ? `(next: #${blockCursor.toLocaleString()})` : ''}</>
                    }
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <div className="h-3" />
      </div>

      {/* ── Block detail modal ─────────────────────────── */}
      <AnimatePresence>
        {selectedBlock && (
          <BlockDetailModal block={selectedBlock} onClose={() => setSelectedBlock(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
