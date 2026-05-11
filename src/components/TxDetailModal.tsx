import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowUpRight, ArrowDownLeft, Loader2, ExternalLink, Copy, CheckCircle2,
  Pickaxe,
} from 'lucide-react';
import { formatIRM, computeConfirmations } from '../lib/types';
import { rpc } from '../lib/tauri';
import { useStore } from '../lib/store';
import type { Transaction } from '../lib/types';

// Shape verified empirically against running iriumd:
//   GET /rpc/tx?txid=... →
//     { txid, height, index, block_hash, inputs, outputs, output_value,
//       is_coinbase, tx_hex }
//   GET /rpc/block?height=N →
//     { header: { time, hash, prev_hash, merkle_root, nonce, bits, version },
//       height, miner_address, submit_source, tx_hex[] }
//
// Notably absent from /rpc/tx: time/timestamp, per-input/output addresses,
// fee. Time has to come from the block header. Input/output address parsing
// from tx_hex is non-trivial (script extraction) and is intentionally not
// implemented here — only counts are shown.

interface TxRpcResponse {
  txid?: string;
  height?: number;
  index?: number;
  block_hash?: string;
  inputs?: number;
  outputs?: number;
  output_value?: number;
  is_coinbase?: boolean;
  tx_hex?: string;
}

interface BlockRpcResponse {
  height?: number;
  miner_address?: string;
  header?: {
    time?: number;
    hash?: string;
    prev_hash?: string;
    merkle_root?: string;
    nonce?: number;
    bits?: string;
  };
}

function TxCopyBtn({ text }: { text: string }) {
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
      className="opacity-0 group-hover:opacity-50 hover:!opacity-90 transition-opacity ml-1.5 flex-shrink-0"
      title="Copy"
    >
      {copied
        ? <CheckCircle2 size={11} style={{ color: '#34d399' }} />
        : <Copy size={11} />}
    </button>
  );
}

// One key/value row inside a section.
function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className="flex-shrink-0 w-28 text-right"
        style={{
          fontSize: 10,
          color: 'rgba(255,255,255,0.30)',
          textTransform: 'uppercase',
          letterSpacing: '0.10em',
          paddingTop: 2,
          fontFamily: '"Space Grotesk", sans-serif',
        }}
      >
        {label}
      </span>
      <div className="group flex items-center min-w-0 flex-1">{children}</div>
    </div>
  );
}

function MonoValue({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      className="break-all"
      style={{
        fontSize: 12,
        color: color ?? 'rgba(255,255,255,0.85)',
        fontFamily: '"JetBrains Mono", monospace',
      }}
    >
      {children}
    </span>
  );
}

function PlainValue({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span style={{ fontSize: 12, color: color ?? 'rgba(255,255,255,0.85)' }}>
      {children}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[9px] font-display font-bold uppercase mb-2 mt-1"
      style={{ color: 'rgba(110,198,255,0.55)', letterSpacing: '0.16em' }}
    >
      {children}
    </div>
  );
}

export default function TxDetailModal({ tx, onClose }: { tx: Transaction; onClose: () => void }) {
  const navigate = useNavigate();
  const nodeStatus = useStore((s) => s.nodeStatus);

  const [txData, setTxData] = useState<TxRpcResponse | null>(null);
  const [blockData, setBlockData] = useState<BlockRpcResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // Esc closes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Fetch tx, then (if confirmed) the block — block carries the `time`
  // and `miner_address` that /rpc/tx doesn't expose.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = (await rpc.tx(tx.txid)) as TxRpcResponse | null;
        if (cancelled) return;
        if (!t || Object.keys(t).length === 0) {
          setFailed(true);
          setLoading(false);
          return;
        }
        setTxData(t);
        if (typeof t.height === 'number' && t.height > 0) {
          try {
            const b = (await rpc.block(String(t.height))) as BlockRpcResponse | null;
            if (!cancelled && b && Object.keys(b).length > 0) setBlockData(b);
          } catch { /* block lookup failed — keep going without it */ }
        }
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tx.txid]);

  // ── Derived state ─────────────────────────────────────────────────────────
  // Prefer the freshly-fetched RPC height; fall back to the height carried
  // on the wallet-history `Transaction` row so the modal reads correctly
  // even before the RPC call resolves. computeConfirmations is the single
  // source of truth shared with the wallet's transaction-list TxRow — they
  // can never disagree on Pending vs Confirmed.
  const txHeight     = (typeof txData?.height === 'number' && txData.height > 0)
    ? txData.height
    : (tx.height ?? 0);
  const currentTip   = nodeStatus?.height ?? 0;
  const isConfirmed  = txHeight > 0;
  const confirmations = computeConfirmations(txHeight, currentTip);

  const blockTime     = blockData?.header?.time;
  const timeStr       = blockTime
    ? new Date(blockTime * 1000).toLocaleString()
    : (tx.timestamp && tx.timestamp > 0)
      ? new Date(tx.timestamp * 1000).toLocaleString()
      : '—';

  const isCoinbase    = !!txData?.is_coinbase;
  const isSend        = tx.direction === 'send';
  const minerAddress  = blockData?.miner_address;

  // Type/direction badge — coinbase wins over send/receive.
  const typeLabel  = isCoinbase ? 'Mining Reward' : isSend ? 'Sent' : 'Received';
  const typeColor  = isCoinbase ? '#34d399' : isSend ? '#f87171' : '#34d399';
  const typeBg     = isCoinbase
    ? 'rgba(52,211,153,0.10)'
    : isSend ? 'rgba(248,113,113,0.10)' : 'rgba(52,211,153,0.10)';
  const typeBorder = isCoinbase
    ? 'rgba(52,211,153,0.32)'
    : isSend ? 'rgba(248,113,113,0.32)' : 'rgba(52,211,153,0.32)';

  const headerAmount = isCoinbase
    ? (txData?.output_value ?? Math.abs(tx.amount))
    : Math.abs(tx.amount);
  const headerSign   = isCoinbase || !isSend ? '+' : '−';

  const goToBlock = () => {
    onClose();
    navigate('/explorer', { state: { searchTab: 'block', searchQ: String(txHeight) } });
  };

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
        className="w-full max-w-xl max-h-[90vh] overflow-y-auto"
        style={{
          background: 'rgba(2,5,14,0.97)',
          border: '1px solid rgba(110,198,255,0.30)',
          borderRadius: 12,
          padding: 24,
          boxShadow: '0 32px 80px rgba(0,0,0,0.9), 0 0 0 1px rgba(110,198,255,0.06)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header: amount + type badge + close ──────────────────────── */}
        <div className="flex items-start justify-between mb-5 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {isCoinbase
              ? <Pickaxe       size={16} style={{ color: typeColor, flexShrink: 0 }} />
              : isSend
              ? <ArrowUpRight  size={16} style={{ color: typeColor, flexShrink: 0 }} />
              : <ArrowDownLeft size={16} style={{ color: typeColor, flexShrink: 0 }} />}
            <span
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 16,
                fontWeight: 700,
                color: typeColor,
              }}
            >
              {headerSign}{formatIRM(headerAmount)}
            </span>
            <span
              className="font-display font-bold uppercase px-2 py-0.5 rounded-full"
              style={{
                fontSize: 9,
                color: typeColor,
                background: typeBg,
                border: `1px solid ${typeBorder}`,
                letterSpacing: '0.12em',
              }}
            >
              {typeLabel}
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors flex-shrink-0"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.40)',
            }}
          >
            ×
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 size={20} className="animate-spin" style={{ color: 'rgba(255,255,255,0.30)' }} />
          </div>
        ) : (
          <div className="space-y-4">
            {/* ── Status ─────────────────────────────────────────────── */}
            <div>
              <SectionLabel>Status</SectionLabel>
              <div className="space-y-2.5">
                <DetailRow label="Status">
                  <PlainValue color={isConfirmed ? '#34d399' : '#fbbf24'}>
                    {isConfirmed ? 'Confirmed' : 'Unconfirmed'}
                  </PlainValue>
                </DetailRow>
                <DetailRow label="Confirmations">
                  <MonoValue color={isConfirmed ? 'rgba(255,255,255,0.85)' : '#fbbf24'}>
                    {confirmations.toLocaleString()}
                  </MonoValue>
                </DetailRow>
                <DetailRow label="Time"><PlainValue>{timeStr}</PlainValue></DetailRow>
              </div>
            </div>

            {/* ── Block (only when confirmed) ────────────────────────── */}
            {isConfirmed && (
              <div>
                <SectionLabel>Block</SectionLabel>
                <div className="space-y-2.5">
                  <DetailRow label="Block Height">
                    <button
                      onClick={goToBlock}
                      className="flex items-center gap-1 transition-colors"
                      style={{
                        fontFamily: '"JetBrains Mono", monospace',
                        fontSize: 12,
                        color: '#6ec6ff',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = '#a78bfa')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = '#6ec6ff')}
                      title="Open this block in Explorer"
                    >
                      #{txHeight.toLocaleString()}
                      <ExternalLink size={11} />
                    </button>
                  </DetailRow>
                  {txData?.block_hash && (
                    <DetailRow label="Block Hash">
                      <MonoValue>{txData.block_hash}</MonoValue>
                      <TxCopyBtn text={txData.block_hash} />
                    </DetailRow>
                  )}
                  {typeof txData?.index === 'number' && (
                    <DetailRow label="Index in Block">
                      <MonoValue>#{txData.index}</MonoValue>
                    </DetailRow>
                  )}
                </div>
              </div>
            )}

            {/* ── Mining (coinbase) ──────────────────────────────────── */}
            {isCoinbase && (txData?.output_value != null || minerAddress) && (
              <div>
                <SectionLabel>Mining</SectionLabel>
                <div className="space-y-2.5">
                  {txData?.output_value != null && (
                    <DetailRow label="Block Reward">
                      <MonoValue color="#34d399">
                        {formatIRM(txData.output_value)}
                      </MonoValue>
                    </DetailRow>
                  )}
                  {minerAddress && (
                    <DetailRow label="Miner">
                      <MonoValue>{minerAddress}</MonoValue>
                      <TxCopyBtn text={minerAddress} />
                    </DetailRow>
                  )}
                </div>
              </div>
            )}

            {/* ── Transaction details ────────────────────────────────── */}
            <div>
              <SectionLabel>Transaction</SectionLabel>
              <div className="space-y-2.5">
                {txData?.txid && (
                  <DetailRow label="TXID">
                    <MonoValue>{txData.txid}</MonoValue>
                    <TxCopyBtn text={txData.txid} />
                  </DetailRow>
                )}
                {typeof txData?.inputs === 'number' && (
                  <DetailRow label="Inputs">
                    <MonoValue>{txData.inputs}</MonoValue>
                  </DetailRow>
                )}
                {typeof txData?.outputs === 'number' && (
                  <DetailRow label="Outputs">
                    <MonoValue>{txData.outputs}</MonoValue>
                  </DetailRow>
                )}
                {txData?.output_value != null && !isCoinbase && (
                  <DetailRow label="Total Output">
                    <MonoValue>{formatIRM(txData.output_value)}</MonoValue>
                  </DetailRow>
                )}
                {tx.fee != null && (
                  <DetailRow label="Fee">
                    <MonoValue>{tx.fee.toLocaleString()} sats</MonoValue>
                  </DetailRow>
                )}
                {tx.address && !isCoinbase && (
                  <DetailRow label={isSend ? 'To (your)' : 'Receiving'}>
                    <MonoValue>{tx.address}</MonoValue>
                    <TxCopyBtn text={tx.address} />
                  </DetailRow>
                )}
              </div>
            </div>

            {/* ── Failure footer ─────────────────────────────────────── */}
            {failed && (
              <div
                className="mt-4 pt-4 flex items-center justify-between"
                style={{ borderTop: '1px solid rgba(110,198,255,0.10)' }}
              >
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)' }}>
                  Full details not available yet.
                </span>
                <button
                  onClick={() => {
                    onClose();
                    navigate('/explorer', { state: { searchTab: 'tx', searchQ: tx.txid } });
                  }}
                  className="flex items-center gap-1.5 text-xs"
                  style={{ color: '#6ec6ff' }}
                >
                  <ExternalLink size={11} /> View on Explorer
                </button>
              </div>
            )}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
