import { useState } from 'react';
import { X, Loader2, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { offers } from '../../lib/tauri';
import type { CreateOfferParams } from '../../lib/types';

// Inline create-offer form. Lets a user post a sell offer directly from
// the Marketplace without bouncing to Settlement Hub / Advanced flows.
// Required fields: IRM amount + payment method. Everything else is
// optional and falls through to the wallet sidecar's defaults
// (auto-generated offer_id, seller address resolved from the active
// wallet, no instructions, no timeout override). On success the parent
// closes the modal and the next /offer-list poll picks up the new row.

export interface CreateOrderModalProps {
  sellerAddress: string;
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateOrderModal({ sellerAddress, onClose, onCreated }: CreateOrderModalProps) {
  const [amountIrm, setAmountIrm] = useState('');
  const [priceUsdt, setPriceUsdt] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('bank-transfer');
  const [paymentInstructions, setPaymentInstructions] = useState('');
  const [timeoutBlocks, setTimeoutBlocks] = useState('');
  const [busy, setBusy] = useState(false);

  const handleCreate = async () => {
    const irm = Number(amountIrm);
    if (!Number.isFinite(irm) || irm <= 0) {
      toast.error('Enter a positive IRM amount');
      return;
    }
    if (!paymentMethod.trim()) {
      toast.error('Select a payment method');
      return;
    }
    setBusy(true);
    try {
      // asset_reference describes what the seller wants in return —
      // surfaced as "Price" in the OrderBook card. We persist it as the
      // free-text description so a buyer-side viewer can render it
      // verbatim (offer.create maps description → asset_reference on
      // the wallet sidecar side).
      const descriptionBits: string[] = [];
      if (priceUsdt && Number(priceUsdt) > 0) descriptionBits.push(`${priceUsdt} USDT`);
      const params: CreateOfferParams = {
        amount_sats: Math.round(irm * 1e8),
        payment_method: paymentMethod.trim(),
        payment_instructions: paymentInstructions.trim() || undefined,
        timeout_blocks: timeoutBlocks ? parseInt(timeoutBlocks, 10) || undefined : undefined,
        seller_address: sellerAddress || undefined,
        description: descriptionBits.length > 0 ? descriptionBits.join(' · ') : undefined,
      };
      await offers.create(params);
      toast.success('Offer posted to the order book');
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

        <div className="text-xs" style={{ color: 'rgba(238,240,255,0.55)' }}>
          Your IRM will be locked in escrow when a buyer takes the offer. You'll receive the
          off-chain payment from the buyer, then confirm to release the IRM.
        </div>

        <div className="space-y-3">
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

          <div className="space-y-1">
            <label className="label" style={{ color: 'rgba(238,240,255,0.55)' }}>
              Price you want (USDT, optional)
            </label>
            <div className="flex items-center gap-2">
              <input
                className="input flex-1"
                value={priceUsdt}
                onChange={(e) => setPriceUsdt(e.target.value)}
                placeholder="50"
                inputMode="decimal"
                disabled={busy}
              />
              <span className="text-xs px-2 py-1 rounded" style={{
                background: 'rgba(238,240,255,0.06)',
                color: 'rgba(238,240,255,0.65)',
              }}>USDT</span>
            </div>
            <p className="text-xs" style={{ color: 'rgba(238,240,255,0.35)' }}>
              Total off-chain payment you'll request from the buyer.
            </p>
          </div>

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
              <option value="bank-transfer" style={{ background: '#0f0f23' }}>Bank transfer</option>
              <option value="paypal" style={{ background: '#0f0f23' }}>PayPal</option>
              <option value="usdt-trc20" style={{ background: '#0f0f23' }}>USDT (TRC-20)</option>
              <option value="usdt-erc20" style={{ background: '#0f0f23' }}>USDT (ERC-20)</option>
              <option value="sepa" style={{ background: '#0f0f23' }}>SEPA</option>
              <option value="cash" style={{ background: '#0f0f23' }}>Cash</option>
              <option value="other" style={{ background: '#0f0f23' }}>Other</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="label" style={{ color: 'rgba(238,240,255,0.55)' }}>
              Payment instructions for the buyer (optional)
            </label>
            <textarea
              className="input w-full"
              rows={3}
              value={paymentInstructions}
              onChange={(e) => setPaymentInstructions(e.target.value)}
              placeholder="e.g. IBAN DE89 ... or PayPal: seller@example.com"
              disabled={busy}
            />
          </div>

          <div className="space-y-1">
            <label className="label" style={{ color: 'rgba(238,240,255,0.55)' }}>
              Offer expiry (blocks, optional)
            </label>
            <input
              className="input w-full"
              value={timeoutBlocks}
              onChange={(e) => setTimeoutBlocks(e.target.value)}
              placeholder="e.g. 25000"
              inputMode="numeric"
              disabled={busy}
            />
            <p className="text-xs" style={{ color: 'rgba(238,240,255,0.35)' }}>
              Block height at which this offer auto-expires. Leave blank to use the wallet default.
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
