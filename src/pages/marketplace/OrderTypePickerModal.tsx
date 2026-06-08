import { ArrowRight, Bitcoin, Coins } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TradingModal } from '../../components/ui';
import { useStore } from '../../lib/store';
import { getPairById } from './swap/pairs';
import { pairAvailability } from './swap/hooks/usePairAvailability';

// First-step picker shown when the user clicks "Create Order" from the OTC
// tab of the Marketplace. Previously the click jumped straight into the OTC
// fiat/USDT form, which hid the fact that IRM is also tradable trustlessly
// against BTC / LTC via the atomic-swap layer. The picker surfaces all
// three paths at parity so the user picks the one that matches their intent
// before filling out any form.
//
// OTC option proceeds to the existing fiat/USDT CreateOrderModal.
// BTC / LTC options close the picker and switch the Marketplace page to the
// Spot Swap tab with the corresponding trading pair pre-selected. The LTC
// badge flips from "Coming soon" to "Live" automatically as the local chain
// tip crosses its activation height — see pairAvailability() for the rule.

export type OrderTypeChoice = 'otc' | 'swap-btc' | 'swap-ltc';

interface OrderTypePickerModalProps {
  onClose: () => void;
  onSelect: (choice: OrderTypeChoice) => void;
}

interface OptionDef {
  choice: OrderTypeChoice;
  title: string;
  description: string;
  badge?: string;
  badgeIntent: 'live' | 'soon';
  accent: string;
  Icon: typeof Bitcoin;
}

export default function OrderTypePickerModal({
  onClose,
  onSelect,
}: OrderTypePickerModalProps) {
  const { t } = useTranslation();

  // Dynamic LIVE-vs-COMING-SOON badge derivation. The Spot Swap page
  // already uses pairAvailability() to decide whether each pair is
  // tradable; the picker now reads the same source of truth so the
  // badge here can't drift from what the user sees when they click in.
  // Chain tip comes from the global node-status store (poll-backed).
  // Returns availability=true when activationHeight is set AND tip
  // >= activationHeight, which is the case for LTC and DOGE on any
  // node synced past block 24,800 (consolidation commit 338f3395).
  const tipHeight = useStore((s) => s.nodeStatus?.height ?? 0);
  const liveBadgeText = t('marketplace.order_type_picker.btc_badge');
  const ltcPair = getPairById('IRM_LTC');
  const ltcLive = ltcPair ? pairAvailability(ltcPair, tipHeight).available : false;

  const options: OptionDef[] = [
    {
      choice: 'otc',
      title: t('marketplace.order_type_picker.otc_title'),
      description: t('marketplace.order_type_picker.otc_description'),
      accent: '#fcd535',
      badgeIntent: 'live',
      Icon: Coins,
    },
    {
      choice: 'swap-btc',
      title: t('marketplace.order_type_picker.btc_title'),
      description: t('marketplace.order_type_picker.btc_description'),
      badge: t('marketplace.order_type_picker.btc_badge'),
      badgeIntent: 'live',
      accent: '#f7931a',
      Icon: Bitcoin,
    },
    {
      choice: 'swap-ltc',
      title: t('marketplace.order_type_picker.ltc_title'),
      description: t('marketplace.order_type_picker.ltc_description'),
      badge: ltcLive ? liveBadgeText : t('marketplace.order_type_picker.ltc_badge'),
      badgeIntent: ltcLive ? 'live' : 'soon',
      accent: '#345d9d',
      Icon: Coins,
    },
  ];

  return (
    <TradingModal
      open={true}
      onClose={onClose}
      title={t('marketplace.order_type_picker.title')}
      subtitle={t('marketplace.order_type_picker.subtitle')}
      size="md"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {options.map((opt) => {
          const Icon = opt.Icon;
          const badgeStyle =
            opt.badgeIntent === 'live'
              ? {
                  background: 'rgba(14,203,129,0.10)',
                  color: '#0ecb81',
                  border: '1px solid rgba(14,203,129,0.30)',
                }
              : {
                  background: 'rgba(252,211,53,0.10)',
                  color: '#fcd535',
                  border: '1px solid rgba(252,211,53,0.30)',
                };
          return (
            <button
              key={opt.choice}
              type="button"
              onClick={() => onSelect(opt.choice)}
              className="group text-left p-4 rounded bg-[#0b0e11] border border-[#2b3139] hover:border-[#fcd535] focus:outline-none focus:border-[#fcd535] transition-colors cursor-pointer"
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-10 h-10 rounded flex items-center justify-center flex-shrink-0"
                  style={{
                    background: opt.accent + '26',
                    border: '1px solid ' + opt.accent + '55',
                  }}
                >
                  <Icon size={18} style={{ color: opt.accent }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-[13px] font-semibold text-[#eaecef]">
                      {opt.title}
                    </span>
                    {opt.badge && (
                      <span
                        className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                        style={badgeStyle}
                      >
                        {opt.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-[#b7bdc6] leading-relaxed">
                    {opt.description}
                  </p>
                </div>
                <ArrowRight
                  size={14}
                  className="text-[#5e6673] group-hover:text-[#fcd535] flex-shrink-0 mt-0.5 transition-colors"
                />
              </div>
            </button>
          );
        })}
      </div>
    </TradingModal>
  );
}
