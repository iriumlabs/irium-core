import { useMemo, useState } from 'react';
import { Loader2, Check, Lock } from 'lucide-react';
import toast from 'react-hot-toast';
import { offers } from '../../lib/tauri';
import type { CreateOfferParams } from '../../lib/types';
import { TradingModal } from '../../components/ui';

// Inline create-offer form. The user posts a sell offer with the minimum
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

const INPUT_CLASS = 'w-full h-10 px-3 rounded bg-[#0b0e11] border border-[#2b3139] text-[#eaecef] text-[13px] focus:outline-none focus:border-[#fcd535] disabled:opacity-50 placeholder:text-[#5e6673]';
const LABEL_CLASS = 'block text-[12px] font-medium text-[#b7bdc6] mb-1';

export default function CreateOrderModal({ sellerAddress, onClose, onCreated }: CreateOrderModalProps) {
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
  const totalUsdt = numericAmount * numericPrice;

  const handleCreate = async () => {
    if (numericAmount <= 0) {
      toast.error('Enter a positive IRM amount');
      return;
    }
    if (numericPrice <= 0) {
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
    <TradingModal
      open={true}
      onClose={() => { if (!busy) onClose(); }}
      title="Create Sell Order"
      subtitle="Post an offer to the order book — IRM locks the moment a buyer takes it."
      size="md"
      footer={
        <>
          <button
            onClick={onClose}
            disabled={busy}
            className="h-9 px-4 rounded text-[13px] font-medium text-[#b7bdc6] hover:text-[#eaecef] hover:bg-[#2b3139] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 h-9 px-4 rounded text-[13px] font-semibold bg-[#fcd535] text-[#0b0e11] hover:bg-[#f0c020] transition-colors disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            Post Offer
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="p-3 rounded inline-flex items-start gap-2 bg-[rgba(14,203,129,0.08)] border border-[rgba(14,203,129,0.22)]">
          <Lock size={13} className="text-[#0ecb81] flex-shrink-0 mt-0.5" />
          <div className="text-[12px] text-[#b7bdc6] leading-relaxed">
            Your IRM is locked the moment a buyer commits. You then receive the buyer's
            off-chain payment and click <span className="text-[#0ecb81] font-medium">Confirm received</span> to
            release. Or open a dispute if they don't pay.
          </div>
        </div>

        <div>
          <label className={LABEL_CLASS}>Amount of IRM to sell</label>
          <div className="flex items-center gap-2">
            <input
              className={INPUT_CLASS + ' text-right font-mono tabular-nums'}
              value={amountIrm}
              onChange={(e) => setAmountIrm(e.target.value)}
              placeholder="100"
              inputMode="decimal"
              disabled={busy}
            />
            <span className="text-[11px] px-2 py-1 rounded bg-[#0b0e11] text-[#b7bdc6] font-medium">IRM</span>
          </div>
        </div>

        <div>
          <label className={LABEL_CLASS}>Price per IRM in USDT</label>
          <div className="flex items-center gap-2">
            <input
              className={INPUT_CLASS + ' text-right font-mono tabular-nums'}
              value={pricePerIrmUsdt}
              onChange={(e) => setPricePerIrmUsdt(e.target.value)}
              placeholder="0.50"
              inputMode="decimal"
              disabled={busy}
            />
            <span className="text-[11px] px-2 py-1 rounded bg-[#0b0e11] text-[#b7bdc6] font-medium whitespace-nowrap">USDT / IRM</span>
          </div>
          {totalUsdt > 0 && (
            <p className="text-[11px] text-[#5e6673] mt-1.5">
              Buyer pays a total of{' '}
              <span className="text-[#0ecb81] font-mono tabular-nums">
                {totalUsdt.toLocaleString('en-US', { maximumFractionDigits: 4 })} USDT
              </span>
            </p>
          )}
        </div>

        <div>
          <label className={LABEL_CLASS}>Payment method</label>
          <select
            className={INPUT_CLASS}
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            disabled={busy}
          >
            {PAYMENT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-[#181a20]">
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={LABEL_CLASS}>Your payment details</label>
          <textarea
            className={INPUT_CLASS + ' h-auto py-2'}
            rows={3}
            value={paymentDetails}
            onChange={(e) => setPaymentDetails(e.target.value)}
            placeholder="e.g. IBAN DE89 3704 0044 0532 0130 00 or PayPal: seller@example.com"
            disabled={busy}
          />
          <p className="text-[11px] text-[#5e6673] mt-1.5">
            The buyer sees these details after they take the offer.
          </p>
        </div>
      </div>
    </TradingModal>
  );
}
