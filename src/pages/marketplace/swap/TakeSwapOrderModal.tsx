import { useMemo, useState } from 'react';
import { ArrowRight, AlertTriangle, Check, Loader2, Send, Cloud, Wrench } from 'lucide-react';
import { fetch as tauriFetch, ResponseType } from '@tauri-apps/api/http';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import type { SwapOrderRow, SwapPairConfig, SwapTxResult } from './pairs/types';
import { TradingModal } from '../../../components/ui';
import { rpcCall } from '../../../lib/tauri';

// Three-step Take flow for a swap order.
//   Step 1 — Review the order, choose where IRM lands, confirm. Calls
//            fillOrder which creates the HTLC on the Irium side.
//   Step 2 — Payment instructions: where to send the foreign payment,
//            how much, OP_RETURN memo, optional reference for the seller.
//   Step 3 — Submit the foreign-chain payment proof so iriumd releases
//            the locked IRM. Auto-fetches the proof from mempool.space
//            for BTC swaps (user pastes only the txid). Falls back to a
//            manual 5-field entry behind a toggle.
//
// Cancelling at step 2 or 3 opens a dispute path (mirrors the OTC flow).

const DEFAULT_TIMEOUT_BLOCKS = 720;

export interface TakeSwapOrderModalProps {
  pair: SwapPairConfig;
  order: SwapOrderRow;
  takerIriumdAddress: string;
  takerForeignAddress?: string;
  onClose: () => void;
  // FIX BUG 3: opts.keepOpen=true means "the on-chain HTLC is funded but
  // the user hasn't submitted proof yet — register the activeSwap with
  // SwapPanel so MySwapsPanel + SwapProgress can pick it up, but leave
  // this modal mounted so the user can continue through steps 2 and 3".
  // Called at step 1 (fillOrder success) with keepOpen=true and again at
  // step 3 (claim submitted) without keepOpen so the modal closes.
  onFilled: (result: SwapTxResult, opts?: { keepOpen?: boolean }) => void;
}

type Step = 1 | 2 | 3;

interface FetchedProof {
  block_hash: string;
  tx_hex: string;
  merkle_branch_hex: string[];
  merkle_index: number;
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

export default function TakeSwapOrderModal({
  pair,
  order,
  takerIriumdAddress,
  takerForeignAddress,
  onClose,
  onFilled,
}: TakeSwapOrderModalProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [filled, setFilled] = useState<SwapTxResult | null>(null);
  const [timeoutBlocks, setTimeoutBlocks] = useState(DEFAULT_TIMEOUT_BLOCKS);
  const [paymentRef, setPaymentRef] = useState('');

  // Step 3 — proof submission state. Defaults to auto-fetch for BTC; user
  // can flip to manual at any time to paste the 5 fields themselves.
  const isBtcPair = pair.id === 'IRM_BTC';
  const [proofTxid, setProofTxid] = useState('');
  const [proofManual, setProofManual] = useState<boolean>(!isBtcPair);
  const [manualBlockHash, setManualBlockHash] = useState('');
  const [manualTxHex, setManualTxHex] = useState('');
  const [manualMerkleText, setManualMerkleText] = useState('');
  const [manualMerkleIndex, setManualMerkleIndex] = useState<string>('');
  const [fetchedProof, setFetchedProof] = useState<FetchedProof | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const isSellSide = order.direction === 'sell_irm';
  const takerReceivesIrm = isSellSide;
  const takerLabel = takerReceivesIrm
    ? t('marketplace.take_swap.buy_irm')
    : t('marketplace.take_swap.sell_irm');

  const truncatedMaker = useMemo(() => {
    const a = order.maker_iriumd_address;
    if (!a) return '—';
    if (a.length <= 16) return a;
    return `${a.slice(0, 10)}…${a.slice(-6)}`;
  }, [order.maker_iriumd_address]);

  const handleConfirm = async () => {
    if (!takerIriumdAddress) {
      toast.error(t('marketplace.take_swap.toast_no_wallet'));
      return;
    }
    if (timeoutBlocks < 10) {
      toast.error(t('marketplace.take_swap.toast_min_blocks'));
      return;
    }
    setBusy(true);
    try {
      const result = await pair.rpc.fillOrder({
        order_txid: order.outpoint.txid,
        order_vout: order.outpoint.vout,
        taker_iriumd_address: takerIriumdAddress,
        taker_foreign_address: takerForeignAddress,
        timeout_blocks_from_now: timeoutBlocks,
        broadcast: true,
      });
      setFilled(result);
      setStep(2);
      // FIX BUG 3: register the funded HTLC with SwapPanel immediately so
      // MySwapsPanel surfaces it under "Mine" and SwapProgress mounts the
      // inline proof-submission panel. keepOpen=true so SwapPanel does
      // not setTakeTarget(null) — the user can still walk through step 2
      // payment instructions and step 3 proof submission in this modal.
      // If they close the modal at this point, the activeSwap is now
      // tracked and they can resume proof submission from SwapProgress.
      onFilled(result, { keepOpen: true });
      toast.success(
        takerReceivesIrm
          ? t('marketplace.take_swap.toast_locked_buyer', { code: pair.quote.code })
          : t('marketplace.take_swap.toast_locked_seller'),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleAdvanceToProof = () => {
    if (!filled) return;
    if (takerReceivesIrm && !paymentRef.trim()) {
      toast.error(
        t('marketplace.take_swap.toast_need_ref', { code: pair.quote.code }),
      );
      return;
    }
    setStep(3);
  };

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
    if (!filled) return;
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

    const fundingTxid =
      filled.new_swap_outpoint?.txid ?? filled.order_outpoint?.txid ?? '';
    const fundingVout =
      filled.new_swap_outpoint?.vout ?? filled.order_outpoint?.vout ?? 0;
    if (!fundingTxid) {
      setProofError('Internal: missing swap outpoint from the fill response.');
      return;
    }

    setBusy(true);
    try {
      // iriumd's /rpc/claim{btc,ltc}swap endpoints each carry the chain prefix
      // on the four proof fields. Build the right body per pair.
      const base = {
        funding_txid: fundingTxid,
        vout: fundingVout,
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
      // Mark this swap as in-flight and let the parent route the user to
      // the SwapProgress panel for the rest of the lifecycle.
      onFilled(filled);
    } catch (e) {
      setProofError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDispute = () => {
    if (!filled) return;
    toast(
      t('marketplace.take_swap.toast_dispute_info'),
      { icon: 'i' },
    );
    onFilled(filled);
    onClose();
  };

  const stepCountLabel = step === 1 ? '1 / 3' : step === 2 ? '2 / 3' : '3 / 3';

  return (
    <TradingModal
      open={true}
      onClose={() => { if (!busy) onClose(); }}
      title={t('marketplace.take_swap.modal_title', { label: takerLabel, pair: pair.label })}
      subtitle={stepCountLabel}
      size="md"
    >
      <div className="space-y-4">

        {step === 1 && (
          <>
            <div className="text-xs" style={{ color: 'rgba(238,240,255,0.65)' }}>
              {takerReceivesIrm
                ? t('marketplace.take_swap.intro_buyer', { code: pair.quote.code })
                : t('marketplace.take_swap.intro_seller', { code: pair.quote.code })}
            </div>

            <div
              className="p-3 rounded space-y-2 text-xs"
              style={{
                background: 'rgba(0,0,0,0.25)',
                fontFamily: '"JetBrains Mono", monospace',
                color: 'var(--t1)',
              }}
            >
              <div className="flex items-center justify-between">
                <span style={{ color: 'rgba(238,240,255,0.55)' }}>
                  {takerReceivesIrm
                    ? t('marketplace.take_swap.you_receive')
                    : t('marketplace.take_swap.you_pay')}
                </span>
                <span style={{ color: '#34d399' }}>{order.irm_amount_human} IRM</span>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: 'rgba(238,240,255,0.55)' }}>
                  {takerReceivesIrm
                    ? t('marketplace.take_swap.you_send')
                    : t('marketplace.take_swap.you_receive')}
                </span>
                <span style={{ color: pair.accent.text }}>{order.quote_amount_human}</span>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: 'rgba(238,240,255,0.55)' }}>{t('marketplace.take_swap.price')}</span>
                <span>{order.implied_quote_per_irm_human}</span>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: 'rgba(238,240,255,0.55)' }}>{t('marketplace.take_swap.maker')}</span>
                <span title={order.maker_iriumd_address}>{truncatedMaker}</span>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: 'rgba(238,240,255,0.55)' }}>
                  {t('marketplace.take_swap.maker_foreign_address', { code: pair.quote.code })}
                </span>
                <span title={order.maker_foreign_address}>
                  {order.maker_foreign_address
                    ? `${order.maker_foreign_address.slice(0, 10)}…${order.maker_foreign_address.slice(-6)}`
                    : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: 'rgba(238,240,255,0.55)' }}>{t('marketplace.take_swap.needs')}</span>
                <span>
                  {order.confirmations_required === 1
                    ? t('marketplace.take_swap.confirmation_one', {
                        count: order.confirmations_required,
                        code: pair.quote.code,
                      })
                    : t('marketplace.take_swap.confirmation_other', {
                        count: order.confirmations_required,
                        code: pair.quote.code,
                      })}
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <label className="label" style={{ color: 'rgba(238,240,255,0.55)' }}>
                {t('marketplace.take_swap.refund_deadline_label')}
              </label>
              <input
                className="input w-full"
                type="number"
                min={10}
                value={timeoutBlocks}
                onChange={(e) => setTimeoutBlocks(Number(e.target.value) || DEFAULT_TIMEOUT_BLOCKS)}
                disabled={busy}
              />
              <p className="text-[10px]" style={{ color: 'rgba(238,240,255,0.45)' }}>
                {t('marketplace.take_swap.refund_deadline_hint')}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button onClick={onClose} disabled={busy} className="btn-secondary flex-1">
                {t('marketplace.take_swap.cancel')}
              </button>
              <button
                onClick={handleConfirm}
                disabled={busy || !takerIriumdAddress}
                className="btn-primary flex-1 inline-flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                {t('marketplace.take_swap.confirm_action', { label: takerLabel })}
                {!busy && <ArrowRight size={13} />}
              </button>
            </div>
          </>
        )}

        {step === 2 && filled && (
          <>
            <div
              className="p-3 rounded space-y-1 text-xs"
              style={{
                background: 'rgba(34,197,94,0.10)',
                border: '1px solid rgba(34,197,94,0.25)',
                color: 'var(--t1)',
              }}
            >
              <div
                className="inline-flex items-center gap-2 font-display font-semibold"
                style={{ color: '#22c55e' }}
              >
                <Check size={13} /> {t('marketplace.take_swap.escrow_locked')}
              </div>
              <p style={{ color: 'rgba(238,240,255,0.78)', lineHeight: 1.5 }}>
                {takerReceivesIrm
                  ? t('marketplace.take_swap.escrow_locked_buyer', { code: pair.quote.code })
                  : t('marketplace.take_swap.escrow_locked_seller', { code: pair.quote.code })}
              </p>
            </div>

            {takerReceivesIrm && (
              <>
                <div className="space-y-1">
                  <label className="label" style={{ color: 'rgba(238,240,255,0.55)' }}>
                    {t('marketplace.take_swap.send_to_label', { code: pair.quote.code })}
                  </label>
                  <pre
                    className="p-2 rounded text-xs whitespace-pre-wrap"
                    style={{
                      background: 'rgba(0,0,0,0.25)',
                      color: '#eef0ff',
                      border: '1px solid rgba(255,255,255,0.06)',
                      fontFamily: '"JetBrains Mono", monospace',
                    }}
                  >
                    {filled.expected_foreign_payment_address ?? order.maker_foreign_address}
                  </pre>
                </div>

                <div className="space-y-1">
                  <label className="label" style={{ color: 'rgba(238,240,255,0.55)' }}>
                    {t('marketplace.take_swap.exact_amount_label', { code: pair.quote.code })}
                  </label>
                  <pre
                    className="p-2 rounded text-xs"
                    style={{
                      background: 'rgba(0,0,0,0.25)',
                      color: pair.accent.text,
                      border: '1px solid rgba(255,255,255,0.06)',
                      fontFamily: '"JetBrains Mono", monospace',
                    }}
                  >
                    {pair.formatQuoteAmount(
                      filled.expected_foreign_amount_smallest ?? order.quote_amount_smallest,
                    )}
                  </pre>
                </div>

                {filled.expected_foreign_op_return_payload_hex && (
                  <div className="space-y-1">
                    <label className="label" style={{ color: 'rgba(238,240,255,0.55)' }}>
                      {t('marketplace.take_swap.required_memo_label')}
                    </label>
                    <pre
                      className="p-2 rounded text-xs whitespace-pre-wrap break-all"
                      style={{
                        background: 'rgba(0,0,0,0.25)',
                        color: '#eef0ff',
                        border: '1px solid rgba(255,255,255,0.06)',
                        fontFamily: '"JetBrains Mono", monospace',
                      }}
                    >
                      {filled.expected_foreign_op_return_payload_hex}
                    </pre>
                    <p className="text-[10px]" style={{ color: 'rgba(238,240,255,0.45)' }}>
                      {t('marketplace.take_swap.memo_hint', { name: pair.quote.name })}
                    </p>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="label" style={{ color: 'rgba(238,240,255,0.55)' }}>
                    {t('marketplace.take_swap.tx_reference_label')}
                  </label>
                  <input
                    className="input w-full"
                    value={paymentRef}
                    onChange={(e) => setPaymentRef(e.target.value)}
                    placeholder={t('marketplace.take_swap.tx_reference_placeholder', { code: pair.quote.code })}
                    disabled={busy}
                  />
                  <p className="text-[10px]" style={{ color: 'rgba(238,240,255,0.45)' }}>
                    {t('marketplace.take_swap.tx_reference_hint')}
                  </p>
                </div>
              </>
            )}

            <div
              className="p-2 rounded text-xs inline-flex items-center gap-2"
              style={{
                background: 'rgba(252,211,77,0.10)',
                color: '#fbbf24',
                border: '1px solid rgba(252,211,77,0.25)',
              }}
            >
              <AlertTriangle size={12} />
              {t('marketplace.take_swap.cancel_warning')}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleDispute}
                disabled={busy}
                className="btn-secondary flex-1"
              >
                {t('marketplace.take_swap.cancel_and_dispute')}
              </button>
              <button
                onClick={handleAdvanceToProof}
                disabled={busy}
                className="btn-primary flex-1 inline-flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                {takerReceivesIrm
                  ? t('marketplace.take_swap.i_have_sent', { code: pair.quote.code })
                  : t('marketplace.take_swap.watching_escrow')}
                {!busy && <ArrowRight size={13} />}
              </button>
            </div>
          </>
        )}

        {step === 3 && filled && (
          <>
            <div
              className="p-3 rounded space-y-1 text-xs"
              style={{
                background: 'rgba(110,198,255,0.10)',
                border: '1px solid rgba(110,198,255,0.30)',
                color: 'var(--t1)',
              }}
            >
              <div
                className="inline-flex items-center gap-2 font-display font-semibold"
                style={{ color: '#6EC6FF' }}
              >
                <Send size={13} /> Submit {pair.quote.code} payment proof
              </div>
              <p style={{ color: 'rgba(238,240,255,0.78)', lineHeight: 1.5 }}>
                The IRM is locked in escrow until iriumd sees proof that you funded the seller's
                {' '}{pair.quote.code} address. Paste the {pair.quote.code} transaction id below
                {isBtcPair ? ' and the rest is auto-fetched from mempool.space.' : '. Manual entry is required for ' + pair.quote.code + ' until an auto-lookup ships.'}
              </p>
            </div>

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
                disabled={busy || submitted}
                spellCheck={false}
                style={{ fontFamily: '"JetBrains Mono", monospace' }}
              />
            </div>

            {isBtcPair && !proofManual && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleFetchProof}
                  disabled={busy || !proofTxid.trim() || submitted}
                  className="btn-secondary inline-flex items-center gap-2"
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Cloud size={13} />}
                  Fetch proof from mempool.space
                </button>
                <button
                  type="button"
                  onClick={() => setProofManual(true)}
                  disabled={busy || submitted}
                  className="text-xs inline-flex items-center gap-1"
                  style={{ color: 'rgba(238,240,255,0.55)' }}
                >
                  <Wrench size={11} /> Enter manually
                </button>
              </div>
            )}

            {!proofManual && fetchedProof && (
              <div
                className="p-2 rounded text-xs space-y-1"
                style={{
                  background: 'rgba(34,197,94,0.08)',
                  border: '1px solid rgba(34,197,94,0.22)',
                  color: 'rgba(238,240,255,0.78)',
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                <div className="inline-flex items-center gap-2" style={{ color: '#22c55e' }}>
                  <Check size={11} /> Proof retrieved
                </div>
                <div className="text-[10px]" style={{ color: 'rgba(238,240,255,0.55)' }}>
                  block_hash: {fetchedProof.block_hash.slice(0, 16)}…{fetchedProof.block_hash.slice(-6)}
                </div>
                <div className="text-[10px]" style={{ color: 'rgba(238,240,255,0.55)' }}>
                  merkle_branch: {fetchedProof.merkle_branch_hex.length} hashes
                </div>
                <div className="text-[10px]" style={{ color: 'rgba(238,240,255,0.55)' }}>
                  merkle_index: {fetchedProof.merkle_index}
                </div>
                <div className="text-[10px]" style={{ color: 'rgba(238,240,255,0.55)' }}>
                  tx_hex: {fetchedProof.tx_hex.length} characters
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
                    disabled={busy || submitted}
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
                    disabled={busy || submitted}
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
                    rows={4}
                    value={manualMerkleText}
                    onChange={(e) => setManualMerkleText(e.target.value)}
                    placeholder={'abcdef…\n123456…'}
                    disabled={busy || submitted}
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
                    disabled={busy || submitted}
                  />
                </div>
                {isBtcPair && (
                  <button
                    type="button"
                    onClick={() => {
                      setProofManual(false);
                      setProofError(null);
                    }}
                    disabled={busy || submitted}
                    className="text-xs inline-flex items-center gap-1"
                    style={{ color: 'rgba(238,240,255,0.55)' }}
                  >
                    <Cloud size={11} /> Back to auto-fetch
                  </button>
                )}
              </>
            )}

            {proofError && (
              <div
                className="p-2 rounded text-xs inline-flex items-start gap-2"
                style={{
                  background: 'rgba(248,113,113,0.10)',
                  color: '#fbbf24',
                  border: '1px solid rgba(248,113,113,0.30)',
                  whiteSpace: 'pre-wrap',
                }}
              >
                <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                <span>{proofError}</span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={handleDispute}
                disabled={busy}
                className="btn-secondary flex-1"
              >
                {t('marketplace.take_swap.cancel_and_dispute')}
              </button>
              <button
                onClick={handleSubmitProof}
                disabled={busy || submitted || (!proofManual && !fetchedProof) || !proofTxid.trim()}
                className="btn-primary flex-1 inline-flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                {submitted ? 'Proof submitted' : 'Submit proof and release IRM'}
              </button>
            </div>
          </>
        )}
      </div>
    </TradingModal>
  );
}
