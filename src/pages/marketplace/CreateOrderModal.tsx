import { useMemo, useState } from 'react';
import { X, Loader2, Check, Lock } from 'lucide-react';
import toast from 'react-hot-toast';
import { offers } from '../../lib/tauri';
import type { CreateOfferParams } from '../../lib/types';

// Inline create-offer form. The user post a sell offer with the minimum
// information a buyer needs to decide whether to take it: how much IRM,
// the per-unit USDT rate, the payment rail, and the seller's payment
// details. Everything technical (timeout block height, offer expiry,
// asset_reference shape, etc.) is handled by the wallet sidecar's
// defaults.

export interface CreateOrderModalProps {
  sellerAddress: string;
  onClose: () => void;
  onCreated: () => void;
}

const PAYMENT_OPTIONS: { value: string; label: string }[] = [
  { value: 'bank-transfer', label: 'Bank transfer' },
  { value: 'paypal',        label: 'PayPal' },
  { value: 'usdt-trc20',    label: 'USDT (TRC-20)' },
  { value: 'usdt-erc20',    label: 'USDT (ERC-20)' },
  { value: 'sepa',          label: 'SEPA' },
  { value: 'cash',          label: 'Cash' },
  { value: 'other',         label: 'Other' },
];

export default function CreateOrderModal({ sellerAddress, onClose, onCreated }: CreateOrderModalProps) {
  // Marketplace Fix 3 — exactly four fields. Anything else gets resolved
  // by the wallet sidecar's defaults (offer id, seller address from the
  // active wallet, default expiry).
  const [amountIrm, setAmountIrm] = useState('');
  const [pricePerIrmUsdt, setPricePerIrmUsdt] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('bank-transfer');
  const [paymentDetails, setPaymentDetails] = useState('');
  const [busy, setBusy] = useState(false);

  const numericAmount = useMemo(() => {
    const n = Number(amountIrm);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amountIrm]);
  const numericPrice = useMemo(() => {
    const n = Number(pricePerIrmUsdt);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [pricePerIrmUsdt]);
  // Total = amount × per-unit. Shown to the seller as a live preview so
  // they can sanity-check the math before posting.
  const totalUsdt = numericAmount * numericPrice;

  const handleCreate = async () => {
    if (numericAmount <= 0) {
      toast.error('Enter a positive IRM amount');
      return;
    }
    if (numericPrice <= 0) {
      // The OrderBook now strict-filters offers without a parseable
      // price, so refusing here keeps the seller from posting an offer
      // that will never appear in the book.
      toast.error('Enter a positive USDT price per IRM');
      return;
    }
    if (!paymentMethod.trim()) {
      toast.error('Select a payment method');
      return;
    }
    if (!paymentDetails.trim()) {
      toast.error('Enter your payment details so the buyer knows how to pay');
      return;
    }
    setBusy(true);
    try {
      // asset_reference carries the TOTAL the seller wants in return.
      // The OrderBook parses this regex-style ("N USDT") and divides by
      // the IRM amount to recover the per-unit rate. We post the total
      // (not the per-unit) so the wire format stays compatible with the
      // existing parser and any other client that consumes the offer.
      const params: CreateOfferParams = {
        amount_sats: Math.round(numericAmount * 1e8),
        payment_method: paymentMethod.trim(),
        payment_instructions: paymentDetails.trim(),
        seller_address: sellerAddress || undefined,
        description: `${totalUsdt} USDT`,
      };
      await offers.create(params);
      toast.success('Offer posted. IRM will lock the moment a buyer commits.');
      onCreated();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(2,5,14,0.78)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md card p-5 space-y-4"
        style={{ border: '1px solid rgba(110,198,255,0.25)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="text-sm font-display font-semibold" style={{ color: 'var(--t1)' }}>
            Create Sell Order
          </div>
          <button onClick={onClose} className="btn-secondary px-2 py-1" disabled={busy}>
            <X size={14} />
          </button>
        </div>

        <div
          className="p-3 rounded inline-flex items-start gap-2"
          style={{
            background: 'rgba(34,197,94,0.08)',
            border: '1px solid rgba(34,197,94,0.22)',
          }}
        >
          <Lock size={13} style={{ color: '#22c55e', flexShrink: 0, marginTop: 2 }} />
          <div className="text-xs" style={{ color: 'rgba(238,240,255,0.78)', lineHeight: 1.5 }}>
            Your IRM is locked the moment a buyer commits. You then receive the buyer's
            off-chain payment and click <span style={{ color: '#22c55e' }}>Confirm received</span> to
            release. Or open a dispute if they don't pay.
          </div>
        </div>

        <div className="space-y-3">
          {/* 1 — Amount of IRM to sell */}
          <div className="space-y-1">
            <label className="label" style={{ color: 'rgba(238,240,255,0.55)' }}>
              Amount of IRM to sell
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
              <span className="text-xs px-2 py-1 rounded" style={{
                background: 'rgba(238,240,255,0.06)',
                color: 'rgba(238,240,255,0.65)',
              }}>IRM</span>
            </div>
          </div>

          {/* 2 — Price per IRM in USDT */}
          <div className="space-y-1">
            <label className="label" style={{ color: 'rgba(238,240,255,0.55)' }}>
              Price per IRM in USDT
            </label>
            <div className="flex items-center gap-2">
              <input
                className="input flex-1"
                value={pricePerIrmUsdt}
                onChange={(e) => setPricePerIrmUsdt(e.target.value)}
                placeholder="0.50"
                inputMode="decimal"
                disabled={busy}
              />
              <span className="text-xs px-2 py-1 rounded" style={{
                background: 'rgba(238,240,255,0.06)',
                color: 'rgba(238,240,255,0.65)',
              }}>USDT / IRM</span>
            </div>
            {totalUsdt > 0 && (
              <p className="text-xs" style={{ color: 'rgba(238,240,255,0.55)' }}>
                Buyer pays a total of{' '}
                <span style={{ color: '#34d399', fontFamily: '"JetBrains Mono", monospace' }}>
                  {totalUsdt.toLocaleString('en-US', { maximumFractionDigits: 4 })} USDT
                </span>
              </p>
            )}
          </div>

          {/* 3 — Payment method */}
          <div className="space-y-1">
            <label className="label" style={{ color: 'rgba(238,240,255,0.55)' }}>
              Payment method
            </label>
            <select
              className="input w-full"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              disabled={busy}
            >
              {PAYMENT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} style={{ background: '#0f0f23' }}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* 4 — Your payment details */}
          <div className="space-y-1">
            <label className="label" style={{ color: 'rgba(238,240,255,0.55)' }}>
              Your payment details
            </label>
            <textarea
              className="input w-full"
              rows={3}
              value={paymentDetails}
              onChange={(e) => setPaymentDetails(e.target.value)}
              placeholder="e.g. IBAN DE89 3704 0044 0532 0130 00 or PayPal: seller@example.com"
              disabled={busy}
            />
            <p className="text-xs" style={{ color: 'rgba(238,240,255,0.45)' }}>
              The buyer sees these details after they take the offer.
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
            Post Offer
          </button>
        </div>
      </div>
    </div>
  );
}
