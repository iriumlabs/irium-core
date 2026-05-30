import { useMemo, useState } from 'react';
import { X, Loader2, Check, Lock, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import type { SwapDirection, SwapPairConfig, SwapTxResult } from './pairs/types';

// Create a swap order on the active pair. Mirrors the OTC CreateOrderModal
// shape but adds a direction toggle (sell IRM / buy IRM) up top and uses
// the pair config for every label, formatter, and address validator.

const DEFAULT_CONFIRMATIONS = 6;
const DEFAULT_EXPIRY_BLOCKS = 1440;

export interface CreateSwapOrderModalProps {
  pair: SwapPairConfig;
  makerIriumdAddress: string;
  onClose: () => void;
  onCreated: (result: SwapTxResult) => void;
}

export default function CreateSwapOrderModal({
  pair,
  makerIriumdAddress,
  onClose,
  onCreated,
}: CreateSwapOrderModalProps) {
  const [direction, setDirection] = useState<SwapDirection>('sell_irm');
  const [amountIrm, setAmountIrm] = useState('');
  const [quoteAmount, setQuoteAmount] = useState('');
  const [makerForeignAddress, setMakerForeignAddress] = useState('');
  const [confirmations, setConfirmations] = useState(DEFAULT_CONFIRMATIONS);
  const [expiryBlocks, setExpiryBlocks] = useState(DEFAULT_EXPIRY_BLOCKS);
  const [busy, setBusy] = useState(false);

  const numericIrm = useMemo(() => {
    const n = Number(amountIrm);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amountIrm]);

  const quoteSmallest = useMemo(
    () => pair.parseQuoteToSmallest(quoteAmount),
    [pair, quoteAmount],
  );

  const impliedPrice = useMemo(() => {
    if (!quoteSmallest || !numericIrm) return null;
    const denom = numericIrm;
    if (!denom) return null;
    return quoteSmallest / 10 ** pair.quote.decimals / denom;
  }, [pair.quote.decimals, quoteSmallest, numericIrm]);

  const addressCheck = useMemo(
    () => pair.validateForeignAddress(makerForeignAddress),
    [pair, makerForeignAddress],
  );

  const handleCreate = async () => {
    if (!makerIriumdAddress) {
      toast.error('No active Irium wallet address. Open a wallet first.');
      return;
    }
    if (numericIrm <= 0) {
      toast.error('Enter a positive IRM amount');
      return;
    }
    if (quoteSmallest === null) {
      toast.error(`Enter a positive ${pair.quote.code} amount`);
      return;
    }
    if (!addressCheck.valid) {
      toast.error(addressCheck.reason ?? `Invalid ${pair.quote.name} address`);
      return;
    }
    if (confirmations < 1 || confirmations > 144) {
      toast.error('Confirmations must be between 1 and 144');
      return;
    }
    if (expiryBlocks < 10) {
      toast.error('Expiry must be at least 10 blocks');
      return;
    }
    setBusy(true);
    try {
      const result = await pair.rpc.postOrder({
        direction,
        irm_amount: numericIrm.toFixed(pair.base.decimals),
        quote_amount_smallest: quoteSmallest,
        maker_iriumd_address: makerIriumdAddress,
        maker_foreign_address: makerForeignAddress.trim(),
        confirmations_required: confirmations,
        expiry_blocks_from_now: expiryBlocks,
        broadcast: true,
      });
      toast.success(
        direction === 'sell_irm'
          ? `IRM is now locked in escrow. Buyers can fill your order.`
          : `Order posted. Sellers can fill it with their IRM.`,
      );
      onCreated(result);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const directionLabel =
    direction === 'sell_irm'
      ? `Sell IRM for ${pair.quote.code}`
      : `Buy IRM with ${pair.quote.code}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(2,5,14,0.78)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg card p-5 space-y-4"
        style={{ border: `1px solid ${pair.accent.primary}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="text-sm font-display font-semibold" style={{ color: 'var(--t1)' }}>
            New {pair.label} swap order
          </div>
          <button onClick={onClose} className="btn-secondary px-2 py-1" disabled={busy}>
            <X size={14} />
          </button>
        </div>

        {/* Direction toggle — first because every other field's label depends on it */}
        <div className="grid grid-cols-2 gap-2">
          {(['sell_irm', 'buy_irm'] as SwapDirection[]).map((d) => {
            const active = d === direction;
            const Icon = d === 'sell_irm' ? ArrowUpRight : ArrowDownLeft;
            const color = d === 'sell_irm' ? '#34d399' : '#6EC6FF';
            return (
              <button
                key={d}
                type="button"
                onClick={() => setDirection(d)}
                disabled={busy}
                className="p-3 rounded text-xs font-display font-semibold inline-flex items-center justify-center gap-2 transition-colors"
                style={{
                  border: active ? `1px solid ${color}` : '1px solid rgba(238,240,255,0.10)',
                  background: active ? `${color}1f` : 'transparent',
                  color: active ? color : 'rgba(238,240,255,0.65)',
                }}
              >
                <Icon size={13} />
                {d === 'sell_irm'
                  ? `Sell IRM for ${pair.quote.code}`
                  : `Buy IRM with ${pair.quote.code}`}
              </button>
            );
          })}
        </div>

        {/* Escrow reassurance */}
        <div
          className="p-3 rounded inline-flex items-start gap-2"
          style={{
            background: 'rgba(34,197,94,0.08)',
            border: '1px solid rgba(34,197,94,0.22)',
          }}
        >
          <Lock size={13} style={{ color: '#22c55e', flexShrink: 0, marginTop: 2 }} />
          <div className="text-xs" style={{ color: 'rgba(238,240,255,0.78)', lineHeight: 1.5 }}>
            {direction === 'sell_irm'
              ? `Your IRM stays in your wallet until a buyer locks the order. Then it moves into escrow and only releases when the buyer's ${pair.quote.code} payment is verified.`
              : `A small fee locks the order. Sellers fill it with their IRM, you send ${pair.quote.code}, and the IRM is released automatically once your payment is confirmed.`}
          </div>
        </div>

        {/* Amount of IRM */}
        <div className="space-y-1">
          <label className="label" style={{ color: 'rgba(238,240,255,0.55)' }}>
            Amount of IRM
          </label>
          <div className="flex items-center gap-2">
            <input
              className="input flex-1"
              value={amountIrm}
              onChange={(e) => setAmountIrm(e.target.value)}
              placeholder="100"
              inputMode="decimal"
              disabled={busy}
            />
            <span
              className="text-xs px-2 py-1 rounded"
              style={{
                background: 'rgba(238,240,255,0.06)',
                color: 'rgba(238,240,255,0.65)',
              }}
            >
              IRM
            </span>
          </div>
        </div>

        {/* Quote amount */}
        <div className="space-y-1">
          <label className="label" style={{ color: 'rgba(238,240,255,0.55)' }}>
            {direction === 'sell_irm'
              ? `Total ${pair.quote.code} you want to receive`
              : `Total ${pair.quote.code} you will pay`}
          </label>
          <div className="flex items-center gap-2">
            <input
              className="input flex-1"
              value={quoteAmount}
              onChange={(e) => setQuoteAmount(e.target.value)}
              placeholder="0.00050000"
              inputMode="decimal"
              disabled={busy}
            />
            <span
              className="text-xs px-2 py-1 rounded"
              style={{
                background: pair.accent.glow,
                color: pair.accent.text,
              }}
            >
              {pair.quote.code}
            </span>
          </div>
          {impliedPrice !== null && (
            <p className="text-xs" style={{ color: 'rgba(238,240,255,0.55)' }}>
              Implied price{' '}
              <span style={{ color: pair.accent.text, fontFamily: '"JetBrains Mono", monospace' }}>
                {pair.formatPrice(impliedPrice)}
              </span>
            </p>
          )}
        </div>

        {/* Foreign address */}
        <div className="space-y-1">
          <label className="label" style={{ color: 'rgba(238,240,255,0.55)' }}>
            Your {pair.quote.name} address
          </label>
          <input
            className="input w-full"
            value={makerForeignAddress}
            onChange={(e) => setMakerForeignAddress(e.target.value)}
            placeholder={pair.quote.network ? `${pair.quote.network} address` : `${pair.quote.code} address`}
            disabled={busy}
          />
          <p className="text-xs" style={{ color: 'rgba(238,240,255,0.45)' }}>
            {pair.paymentInstructionsHelp}
          </p>
          {!addressCheck.valid && makerForeignAddress.trim().length > 0 && (
            <p className="text-xs" style={{ color: '#fbbf24' }}>
              {addressCheck.reason}
            </p>
          )}
        </div>

        {/* Confirmations + expiry — collapsed into a single row of small inputs */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="label" style={{ color: 'rgba(238,240,255,0.55)' }}>
              Confirmations on {pair.quote.code}
            </label>
            <input
              className="input w-full"
              type="number"
              min={1}
              max={144}
              value={confirmations}
              onChange={(e) => setConfirmations(Number(e.target.value) || DEFAULT_CONFIRMATIONS)}
              disabled={busy}
            />
            <p className="text-[10px]" style={{ color: 'rgba(238,240,255,0.45)' }}>
              How many confirmations to wait for. Higher is safer, slower.
            </p>
          </div>

          <div className="space-y-1">
            <label className="label" style={{ color: 'rgba(238,240,255,0.55)' }}>
              Expires in (Irium blocks)
            </label>
            <input
              className="input w-full"
              type="number"
              min={10}
              value={expiryBlocks}
              onChange={(e) => setExpiryBlocks(Number(e.target.value) || DEFAULT_EXPIRY_BLOCKS)}
              disabled={busy}
            />
            <p className="text-[10px]" style={{ color: 'rgba(238,240,255,0.45)' }}>
              Order is auto-cancelled after this many blocks if nobody fills it.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <button onClick={onClose} disabled={busy} className="btn-secondary flex-1">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={busy}
            className="btn-primary flex-1 inline-flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            Post {directionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
