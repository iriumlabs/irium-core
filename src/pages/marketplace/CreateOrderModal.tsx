import { useMemo, useState } from 'react';
import { Loader2, Check, Lock } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
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
  /// Hides the OTC payment-method dropdown + payment-details textarea.
  /// Pass `true` when this modal is reused in a Spot Swap context: swap
  /// payments are settled on-chain via atomic swap HTLCs, so no manual
  /// fiat/USDT payment rail is involved. Default `false` preserves the
  /// OTC P2P behaviour for the existing caller in Marketplace.tsx.
  hidePaymentMethod?: boolean;
}

const PAYMENT_OPTIONS: { value: string; labelKey: string }[] = [
  { value: 'bank-transfer', labelKey: 'marketplace.create_offer.payment_options.bank_transfer' },
  { value: 'paypal',        labelKey: 'marketplace.create_offer.payment_options.paypal' },
  { value: 'usdt-trc20',    labelKey: 'marketplace.create_offer.payment_options.usdt_trc20' },
  { value: 'usdt-erc20',    labelKey: 'marketplace.create_offer.payment_options.usdt_erc20' },
  { value: 'sepa',          labelKey: 'marketplace.create_offer.payment_options.sepa' },
  { value: 'cash',          labelKey: 'marketplace.create_offer.payment_options.cash' },
  { value: 'other',         labelKey: 'marketplace.create_offer.payment_options.other' },
];

const INPUT_CLASS = 'w-full h-10 px-3 rounded bg-[#0b0e11] border border-[#2b3139] text-[#eaecef] text-[13px] focus:outline-none focus:border-[#fcd535] disabled:opacity-50 placeholder:text-[#5e6673]';
const LABEL_CLASS = 'block text-[12px] font-medium text-[#b7bdc6] mb-1';

export default function CreateOrderModal({
  sellerAddress,
  onClose,
  onCreated,
  hidePaymentMethod = false,
}: CreateOrderModalProps) {
  const { t } = useTranslation();
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
      toast.error(t('marketplace.create_offer.errors.positive_irm_amount'));
      return;
    }
    if (numericPrice <= 0) {
      toast.error(t('marketplace.create_offer.errors.positive_usdt_price'));
      return;
    }
    if (!hidePaymentMethod) {
      if (!paymentMethod.trim()) {
        toast.error(t('marketplace.create_offer.errors.select_payment_method'));
        return;
      }
      if (!paymentDetails.trim()) {
        toast.error(t('marketplace.create_offer.errors.payment_details_required'));
        return;
      }
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
      toast.success(t('marketplace.create_offer.toasts.offer_posted'));
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
      title={t('marketplace.create_offer.modal_title')}
      subtitle={t('marketplace.create_offer.modal_subtitle')}
      size="md"
      footer={
        <>
          <button
            onClick={onClose}
            disabled={busy}
            className="h-9 px-4 rounded text-[13px] font-medium text-[#b7bdc6] hover:text-[#eaecef] hover:bg-[#2b3139] transition-colors disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleCreate}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 h-9 px-4 rounded text-[13px] font-semibold bg-[#fcd535] text-[#0b0e11] hover:bg-[#f0c020] transition-colors disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            {t('marketplace.create_offer.post_offer_button')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="p-3 rounded inline-flex items-start gap-2 bg-[rgba(14,203,129,0.08)] border border-[rgba(14,203,129,0.22)]">
          <Lock size={13} className="text-[#0ecb81] flex-shrink-0 mt-0.5" />
          <div className="text-[12px] text-[#b7bdc6] leading-relaxed">
            {t('marketplace.create_offer.lock_info_prefix')}{' '}
            <span className="text-[#0ecb81] font-medium">{t('marketplace.create_offer.confirm_received_label')}</span>
            {' '}{t('marketplace.create_offer.lock_info_suffix')}
          </div>
        </div>

        <div>
          <label className={LABEL_CLASS}>{t('marketplace.create_offer.amount_to_sell_label')}</label>
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
          <label className={LABEL_CLASS}>{t('marketplace.create_offer.price_per_irm_label')}</label>
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
              {t('marketplace.create_offer.buyer_pays_total_prefix')}{' '}
              <span className="text-[#0ecb81] font-mono tabular-nums">
                {t('marketplace.create_offer.buyer_pays_total_amount', { amount: totalUsdt.toLocaleString('en-US', { maximumFractionDigits: 4 }) })}
              </span>
            </p>
          )}
        </div>

        {!hidePaymentMethod && (
          <>
            <div>
              <label className={LABEL_CLASS}>{t('marketplace.create_offer.payment_method_label')}</label>
              <select
                className={INPUT_CLASS}
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                disabled={busy}
              >
                {PAYMENT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} className="bg-[#181a20]">
                    {t(opt.labelKey)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={LABEL_CLASS}>{t('marketplace.create_offer.your_payment_details_label')}</label>
              <textarea
                className={INPUT_CLASS + ' h-auto py-2'}
                rows={3}
                value={paymentDetails}
                onChange={(e) => setPaymentDetails(e.target.value)}
                placeholder={t('marketplace.create_offer.payment_details_placeholder')}
                disabled={busy}
              />
              <p className="text-[11px] text-[#5e6673] mt-1.5">
                {t('marketplace.create_offer.payment_details_helper')}
              </p>
            </div>
          </>
        )}
      </div>
    </TradingModal>
  );
}
