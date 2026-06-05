import { useState } from 'react';
import { Loader2, Check, AlertTriangle, Cloud, Wrench, Send } from 'lucide-react';
import { fetch as tauriFetch, ResponseType } from '@tauri-apps/api/http';
import toast from 'react-hot-toast';
import type { SwapPairConfig } from './pairs/types';
import { rpcCall } from '../../../lib/tauri';

// BUG 3: inline trade-action panel for the taker. Renders inside
// SwapProgress so the user can submit the foreign-payment proof without
// having to keep TakeSwapOrderModal open. Mirrors step 3 of
// TakeSwapOrderModal (auto-fetch from mempool.space for BTC + manual
// fallback for everything else, then claim{Btc,Ltc,Doge}Swap). When the
// claim is accepted, the panel transitions to a "Proof submitted" state
// and SwapProgress's lifecycle polling carries the user through the rest.

interface FetchedProof {
  block_hash: string;
  tx_hex: string;
  merkle_branch_hex: string[];
  merkle_index: number;
}

export interface ProofSubmitInlineProps {
  pair: SwapPairConfig;
  swapOutpoint: { txid: string; vout: number };
  takerIriumdAddress: string;
  onSubmitted?: () => void;
}

async function fetchBtcProofFromMempoolSpace(txid: string): Promise<FetchedProof> {
  const cleanTxid = txid.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(cleanTxid)) {
    throw new Error('Transaction id must be 64 hex characters.');
  }
  const [txInfoResp, txHexResp, merkleResp] = await Promise.all([
    tauriFetch<{ status?: { confirmed?: boolean; block_hash?: string } }>(
      `https://mempool.space/api/tx/${cleanTxid}`,
      { method: 'GET', responseType: ResponseType.JSON },
    ),
    tauriFetch<string>(
      `https://mempool.space/api/tx/${cleanTxid}/hex`,
      { method: 'GET', responseType: ResponseType.Text },
    ),
    tauriFetch<{ block_height?: number; merkle?: string[]; pos?: number }>(
      `https://mempool.space/api/tx/${cleanTxid}/merkle-proof`,
      { method: 'GET', responseType: ResponseType.JSON },
    ),
  ]);
  if (!txInfoResp.ok) {
    throw new Error(
      `Bitcoin lookup failed (HTTP ${txInfoResp.status}). Wait a moment and retry, or use manual entry.`,
    );
  }
  if (!txHexResp.ok || !merkleResp.ok) {
    throw new Error(
      'Bitcoin proof lookup failed. The transaction might not be confirmed yet, or mempool.space is unreachable.',
    );
  }
  const status = txInfoResp.data?.status;
  if (!status?.confirmed || !status?.block_hash) {
    throw new Error(
      'Transaction is not yet confirmed in a block. Wait for at least one confirmation and try again.',
    );
  }
  const merkle = Array.isArray(merkleResp.data?.merkle) ? merkleResp.data?.merkle : null;
  const pos = typeof merkleResp.data?.pos === 'number' ? merkleResp.data.pos : null;
  if (!merkle || pos === null) {
    throw new Error('Merkle proof was not available from mempool.space yet — wait and retry.');
  }
  const txHexRaw = txHexResp.data;
  const txHex = typeof txHexRaw === 'string' ? txHexRaw.trim() : '';
  if (!txHex) {
    throw new Error('Raw transaction hex was empty. Retry after a confirmation lands.');
  }
  return {
    block_hash: status.block_hash,
    tx_hex: txHex,
    merkle_branch_hex: merkle,
    merkle_index: pos,
  };
}

function parseMerkleBranchText(text: string): { values: string[]; bad: string | null } {
  const lines = text
    .split(/[\s,]+/)
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean);
  for (const l of lines) {
    if (!/^[0-9a-f]{64}$/.test(l)) {
      return { values: [], bad: l };
    }
  }
  return { values: lines, bad: null };
}

export default function ProofSubmitInline({
  pair,
  swapOutpoint,
  takerIriumdAddress,
  onSubmitted,
}: ProofSubmitInlineProps) {
  const isBtcPair = pair.id === 'IRM_BTC';
  const [proofTxid, setProofTxid] = useState('');
  const [proofManual, setProofManual] = useState<boolean>(!isBtcPair);
  const [manualBlockHash, setManualBlockHash] = useState('');
  const [manualTxHex, setManualTxHex] = useState('');
  const [manualMerkleText, setManualMerkleText] = useState('');
  const [manualMerkleIndex, setManualMerkleIndex] = useState<string>('');
  const [fetchedProof, setFetchedProof] = useState<FetchedProof | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleFetchProof = async () => {
    setProofError(null);
    setFetchedProof(null);
    if (!isBtcPair) {
      setProofError(
        `Automatic proof lookup is currently available for Bitcoin only. Enter the proof manually below for ${pair.quote.code}.`,
      );
      setProofManual(true);
      return;
    }
    setBusy(true);
    try {
      const proof = await fetchBtcProofFromMempoolSpace(proofTxid);
      setFetchedProof(proof);
      toast.success('Bitcoin proof retrieved from mempool.space.');
    } catch (e) {
      setProofError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitProof = async () => {
    setProofError(null);

    let proof: FetchedProof | null = fetchedProof;
    if (proofManual) {
      const parsed = parseMerkleBranchText(manualMerkleText);
      if (parsed.bad !== null) {
        setProofError(`Merkle branch entry is not 64-hex: "${parsed.bad}".`);
        return;
      }
      const idx = Number(manualMerkleIndex);
      if (!Number.isFinite(idx) || idx < 0 || !Number.isInteger(idx)) {
        setProofError('Merkle index must be a non-negative integer.');
        return;
      }
      const blockHash = manualBlockHash.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(blockHash)) {
        setProofError('Block hash must be 64 hex characters.');
        return;
      }
      const txHex = manualTxHex.trim().toLowerCase().replace(/\s+/g, '');
      if (!/^[0-9a-f]+$/.test(txHex)) {
        setProofError('Raw transaction hex must contain only hex characters.');
        return;
      }
      const txid = proofTxid.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(txid)) {
        setProofError('Transaction id must be 64 hex characters.');
        return;
      }
      proof = {
        block_hash: blockHash,
        tx_hex: txHex,
        merkle_branch_hex: parsed.values,
        merkle_index: idx,
      };
    }
    if (!proof) {
      setProofError(
        'No proof data yet. Either fetch it from mempool.space or fill in the manual entry fields.',
      );
      return;
    }
    if (!takerIriumdAddress) {
      setProofError(
        'No Irium wallet address loaded yet. Open the Wallet page once, then retry.',
      );
      return;
    }

    setBusy(true);
    try {
      const base = {
        funding_txid: swapOutpoint.txid,
        vout: swapOutpoint.vout,
        destination_address: takerIriumdAddress,
        broadcast: true,
      };
      let resp: unknown;
      if (pair.id === 'IRM_BTC') {
        resp = await rpcCall.claimBtcSwap({
          ...base,
          btc_block_hash: proof.block_hash,
          btc_tx_hex: proof.tx_hex,
          btc_merkle_branch_hex: proof.merkle_branch_hex,
          btc_merkle_index: proof.merkle_index,
        });
      } else if (pair.id === 'IRM_LTC') {
        resp = await rpcCall.claimLtcSwap({
          ...base,
          ltc_block_hash: proof.block_hash,
          ltc_tx_hex: proof.tx_hex,
          ltc_merkle_branch_hex: proof.merkle_branch_hex,
          ltc_merkle_index: proof.merkle_index,
        });
      } else if (pair.id === 'IRM_DOGE') {
        resp = await rpcCall.claimDogeSwap({
          ...base,
          doge_block_hash: proof.block_hash,
          doge_tx_hex: proof.tx_hex,
          doge_merkle_branch_hex: proof.merkle_branch_hex,
          doge_merkle_index: proof.merkle_index,
        });
      } else {
        throw new Error(`Claim is not supported for ${pair.label} yet.`);
      }
      const r = (resp ?? {}) as Record<string, unknown>;
      const accepted = r.accepted !== false;
      if (!accepted) {
        setProofError(
          'iriumd rejected the proof. Re-check the block hash, transaction id, and merkle branch.',
        );
        return;
      }
      setSubmitted(true);
      toast.success(
        'Proof submitted. iriumd will release the IRM once the claim tx confirms.',
      );
      onSubmitted?.();
    } catch (e) {
      setProofError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (submitted) {
    return (
      <div
        className="px-3 py-2 rounded text-xs inline-flex items-center gap-2"
        style={{
          background: 'rgba(34,197,94,0.10)',
          color: '#22c55e',
          border: '1px solid rgba(34,197,94,0.25)',
        }}
      >
        <Check size={12} />
        Proof submitted. iriumd will release the IRM once the claim tx confirms.
      </div>
    );
  }

  return (
    <div
      className="rounded p-3 space-y-2 text-xs"
      style={{
        background: 'rgba(110,198,255,0.06)',
        border: '1px solid rgba(110,198,255,0.20)',
      }}
    >
      <div
        className="inline-flex items-center gap-2 font-display font-semibold"
        style={{ color: '#6EC6FF' }}
      >
        <Send size={12} /> Submit {pair.quote.code} payment proof
      </div>
      <p style={{ color: 'rgba(238,240,255,0.72)', lineHeight: 1.5 }}>
        Paste the {pair.quote.code} transaction id of your payment.
        {isBtcPair
          ? ' The rest is auto-fetched from mempool.space.'
          : ` Manual entry is required for ${pair.quote.code} until an auto-lookup ships.`}
      </p>

      <div className="space-y-1">
        <label className="label" style={{ color: 'rgba(238,240,255,0.55)' }}>
          {pair.quote.code} transaction id
        </label>
        <input
          className="input w-full"
          value={proofTxid}
          onChange={(e) => {
            setProofTxid(e.target.value);
            setFetchedProof(null);
            setProofError(null);
          }}
          placeholder="64-character hex transaction id"
          disabled={busy}
          spellCheck={false}
          style={{ fontFamily: '"JetBrains Mono", monospace' }}
        />
      </div>

      {isBtcPair && !proofManual && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleFetchProof}
            disabled={busy || !proofTxid.trim()}
            className="btn-secondary inline-flex items-center gap-2 text-[11px] px-2 py-1"
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Cloud size={11} />}
            Fetch proof from mempool.space
          </button>
          <button
            type="button"
            onClick={() => setProofManual(true)}
            disabled={busy}
            className="text-[11px] inline-flex items-center gap-1"
            style={{ color: 'rgba(238,240,255,0.55)' }}
          >
            <Wrench size={10} /> Enter manually
          </button>
        </div>
      )}

      {!proofManual && fetchedProof && (
        <div
          className="p-2 rounded text-[10px] space-y-1"
          style={{
            background: 'rgba(34,197,94,0.08)',
            border: '1px solid rgba(34,197,94,0.22)',
            color: 'rgba(238,240,255,0.78)',
            fontFamily: '"JetBrains Mono", monospace',
          }}
        >
          <div className="inline-flex items-center gap-2" style={{ color: '#22c55e' }}>
            <Check size={10} /> Proof retrieved
          </div>
          <div style={{ color: 'rgba(238,240,255,0.55)' }}>
            block_hash: {fetchedProof.block_hash.slice(0, 16)}…{fetchedProof.block_hash.slice(-6)}
          </div>
          <div style={{ color: 'rgba(238,240,255,0.55)' }}>
            merkle_branch: {fetchedProof.merkle_branch_hex.length} hashes
          </div>
          <div style={{ color: 'rgba(238,240,255,0.55)' }}>
            merkle_index: {fetchedProof.merkle_index}
          </div>
        </div>
      )}

      {proofManual && (
        <>
          <div className="space-y-1">
            <label className="label" style={{ color: 'rgba(238,240,255,0.55)' }}>
              Block hash (64 hex)
            </label>
            <input
              className="input w-full"
              value={manualBlockHash}
              onChange={(e) => setManualBlockHash(e.target.value)}
              placeholder="00000000000000000000…"
              disabled={busy}
              spellCheck={false}
              style={{ fontFamily: '"JetBrains Mono", monospace' }}
            />
          </div>
          <div className="space-y-1">
            <label className="label" style={{ color: 'rgba(238,240,255,0.55)' }}>
              Raw transaction hex
            </label>
            <textarea
              className="input w-full"
              rows={3}
              value={manualTxHex}
              onChange={(e) => setManualTxHex(e.target.value)}
              placeholder="0100000001…"
              disabled={busy}
              spellCheck={false}
              style={{ fontFamily: '"JetBrains Mono", monospace' }}
            />
          </div>
          <div className="space-y-1">
            <label className="label" style={{ color: 'rgba(238,240,255,0.55)' }}>
              Merkle branch (one 64-hex hash per line)
            </label>
            <textarea
              className="input w-full"
              rows={3}
              value={manualMerkleText}
              onChange={(e) => setManualMerkleText(e.target.value)}
              placeholder={'abcdef…\n123456…'}
              disabled={busy}
              spellCheck={false}
              style={{ fontFamily: '"JetBrains Mono", monospace' }}
            />
          </div>
          <div className="space-y-1">
            <label className="label" style={{ color: 'rgba(238,240,255,0.55)' }}>
              Merkle index (0-based position of the tx in the block)
            </label>
            <input
              className="input w-full"
              type="number"
              min={0}
              value={manualMerkleIndex}
              onChange={(e) => setManualMerkleIndex(e.target.value)}
              disabled={busy}
            />
          </div>
          {isBtcPair && (
            <button
              type="button"
              onClick={() => {
                setProofManual(false);
                setProofError(null);
              }}
              disabled={busy}
              className="text-[11px] inline-flex items-center gap-1"
              style={{ color: 'rgba(238,240,255,0.55)' }}
            >
              <Cloud size={10} /> Back to auto-fetch
            </button>
          )}
        </>
      )}

      {proofError && (
        <div
          className="p-2 rounded text-[11px] inline-flex items-start gap-2"
          style={{
            background: 'rgba(248,113,113,0.10)',
            color: '#fbbf24',
            border: '1px solid rgba(248,113,113,0.30)',
            whiteSpace: 'pre-wrap',
          }}
        >
          <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />
          <span>{proofError}</span>
        </div>
      )}

      <button
        type="button"
        onClick={handleSubmitProof}
        disabled={busy || (!proofManual && !fetchedProof) || !proofTxid.trim()}
        className="btn-primary w-full inline-flex items-center justify-center gap-2"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
        Submit proof and release IRM
      </button>
    </div>
  );
}
