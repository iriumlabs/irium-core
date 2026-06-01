import { useMemo, useState } from 'react';
import { ArrowRight, AlertTriangle, Check, Loader2, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import type { SwapOrderRow, SwapPairConfig, SwapTxResult } from './pairs/types';
import { TradingModal } from '../../../components/ui';

// Two-step Take flow for a swap order.
//   Step 1 — Review the order, choose where IRM lands, confirm.
//   Step 2 — Payment instructions: where to send the foreign payment,
//            how much, and a reference field the seller can use to
//            verify the payment off-chain.
//
// Cancelling at step 2 opens a dispute path (mirrors the OTC flow).

const DEFAULT_TIMEOUT_BLOCKS = 720;

export interface TakeSwapOrderModalProps {
  pair: SwapPairConfig;
  order: SwapOrderRow;
  takerIriumdAddress: string;
  takerForeignAddress?: string;
  onClose: () => void;
  onFilled: (result: SwapTxResult) => void;
}

type Step = 1 | 2;

export default function TakeSwapOrderModal({
  pair,
  order,
  takerIriumdAddress,
  takerForeignAddress,
  onClose,
  onFilled,
}: TakeSwapOrderModalProps) {
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [filled, setFilled] = useState<SwapTxResult | null>(null);
  const [timeoutBlocks, setTimeoutBlocks] = useState(DEFAULT_TIMEOUT_BLOCKS);
  const [paymentRef, setPaymentRef] = useState('');

  const isSellSide = order.direction === 'sell_irm';
  const takerReceivesIrm = isSellSide;
  const takerLabel = takerReceivesIrm ? 'Buy IRM' : 'Sell IRM';

  const truncatedMaker = useMemo(() => {
    const a = order.maker_iriumd_address;
    if (!a) return '—';
    if (a.length <= 16) return a;
    return `${a.slice(0, 10)}…${a.slice(-6)}`;
  }, [order.maker_iriumd_address]);

  const handleConfirm = async () => {
    if (!takerIriumdAddress) {
      toast.error('No active Irium wallet address. Open a wallet first.');
      return;
    }
    if (timeoutBlocks < 10) {
      toast.error('Refund deadline must be at least 10 blocks');
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
      toast.success(
        takerReceivesIrm
          ? `Order locked. Send the ${pair.quote.code} payment and report it.`
          : `Order locked. The seller's IRM is in escrow.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handlePaymentReported = () => {
    if (!filled) return;
    if (takerReceivesIrm && !paymentRef.trim()) {
      toast.error(
        `Enter a transaction id or note so the seller can verify your ${pair.quote.code} payment`,
      );
      return;
    }
    toast.success('Payment reported. The seller has been notified.');
    onFilled(filled);
    onClose();
  };

  const handleDispute = () => {
    if (!filled) return;
    toast(
      'A dispute can be opened from the Agreements page. Cancel here for now and revisit it there.',
      { icon: 'i' },
    );
    onFilled(filled);
    onClose();
  };

  return (
    <TradingModal
      open={true}
      onClose={() => { if (!busy) onClose(); }}
      title={`${takerLabel} on ${pair.label}`}
      subtitle={`Step ${step} of 2`}
      size="md"
    >
      <div className="space-y-4">

        {step === 1 && (
          <>
            <div className="text-xs" style={{ color: 'rgba(238,240,255,0.65)' }}>
              {takerReceivesIrm
                ? `Confirming will lock the seller's IRM in escrow. You will then send ${pair.quote.code} to the address shown next.`
                : `Confirming will create a matching escrow with your IRM. The buyer will send ${pair.quote.code} to your address.`}
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
                <span style={{ color: 'rgba(238,240,255,0.55)' }}>You {takerReceivesIrm ? 'receive' : 'pay'}</span>
                <span style={{ color: '#34d399' }}>{order.irm_amount_human} IRM</span>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: 'rgba(238,240,255,0.55)' }}>
                  You {takerReceivesIrm ? 'send' : 'receive'}
                </span>
                <span style={{ color: pair.accent.text }}>{order.quote_amount_human}</span>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: 'rgba(238,240,255,0.55)' }}>Price</span>
                <span>{order.implied_quote_per_irm_human}</span>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: 'rgba(238,240,255,0.55)' }}>Maker</span>
                <span title={order.maker_iriumd_address}>{truncatedMaker}</span>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: 'rgba(238,240,255,0.55)' }}>Maker {pair.quote.code} address</span>
                <span title={order.maker_foreign_address}>
                  {order.maker_foreign_address
                    ? `${order.maker_foreign_address.slice(0, 10)}…${order.maker_foreign_address.slice(-6)}`
                    : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: 'rgba(238,240,255,0.55)' }}>Needs</span>
                <span>
                  {order.confirmations_required} {pair.quote.code} confirmation
                  {order.confirmations_required === 1 ? '' : 's'}
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <label className="label" style={{ color: 'rgba(238,240,255,0.55)' }}>
                Refund deadline (Irium blocks)
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
                If payment is not confirmed by this deadline, your funds can be refunded.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button onClick={onClose} disabled={busy} className="btn-secondary flex-1">
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={busy || !takerIriumdAddress}
                className="btn-primary flex-1 inline-flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                Confirm {takerLabel}
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
                <Check size={13} /> Escrow locked
              </div>
              <p style={{ color: 'rgba(238,240,255,0.78)', lineHeight: 1.5 }}>
                {takerReceivesIrm
                  ? `Send the ${pair.quote.code} payment to the address below. Once your payment confirms, the IRM is released to your wallet automatically.`
                  : `Your IRM is in escrow. The buyer will send ${pair.quote.code} to your address. When their payment confirms, the IRM is released to them and the buyer flow finishes on its own.`}
              </p>
            </div>

            {takerReceivesIrm && (
              <>
                <div className="space-y-1">
                  <label className="label" style={{ color: 'rgba(238,240,255,0.55)' }}>
                    Send {pair.quote.code} to
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
                    Exact {pair.quote.code} amount
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
                      Required payment memo
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
                      Most {pair.quote.name} wallets include this as an extra data field on the
                      payment. It links your payment to this trade so the IRM can release
                      automatically.
                    </p>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="label" style={{ color: 'rgba(238,240,255,0.55)' }}>
                    Your transaction reference
                  </label>
                  <input
                    className="input w-full"
                    value={paymentRef}
                    onChange={(e) => setPaymentRef(e.target.value)}
                    placeholder={`${pair.quote.code} transaction id or note`}
                    disabled={busy}
                  />
                  <p className="text-[10px]" style={{ color: 'rgba(238,240,255,0.45)' }}>
                    The seller sees this exactly. Anything they can use to confirm your payment works.
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
              If you cancel now, your funds stay locked until the refund deadline above.
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleDispute}
                disabled={busy}
                className="btn-secondary flex-1"
              >
                Cancel and dispute
              </button>
              <button
                onClick={handlePaymentReported}
                disabled={busy}
                className="btn-primary flex-1 inline-flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                {takerReceivesIrm ? `I have sent ${pair.quote.code}` : 'Watching escrow'}
              </button>
            </div>
          </>
        )}
      </div>
    </TradingModal>
  );
}
