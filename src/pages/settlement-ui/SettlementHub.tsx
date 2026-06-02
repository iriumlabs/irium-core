import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftRight, Briefcase, Shield, Plus, ChevronDown } from 'lucide-react';
import ActiveAgreementsPanel from '../../components/settlement-ui/ActiveAgreementsPanel';

// SettlementHub — Binance-style dashboard. A single condensed header
// strip with a primary CTA (split-dropdown "+ New agreement"); below
// it, the Active Agreements panel surfaces the user's in-flight
// agreements as the page's primary content (was deprioritised under
// the previous landing-page hero with three marketing-style cards).

type FlowId = 'safe_trade' | 'pay_for_work' | 'deposit';

interface FlowOption {
  id: FlowId;
  titleKey: string;
  subtitleKey: string;
  Icon: React.ElementType;
  route: string;
}

const FLOW_OPTIONS: FlowOption[] = [
  {
    id: 'safe_trade',
    titleKey: 'settlement_ui.hub.safe_trade_title',
    subtitleKey: 'settlement_ui.hub.safe_trade_subtitle',
    Icon: ArrowLeftRight,
    route: '/settlement/safe-trade',
  },
  {
    id: 'pay_for_work',
    titleKey: 'settlement_ui.hub.pay_for_work_title',
    subtitleKey: 'settlement_ui.hub.pay_for_work_subtitle',
    Icon: Briefcase,
    route: '/settlement/pay-for-work',
  },
  {
    id: 'deposit',
    titleKey: 'settlement_ui.hub.deposit_title',
    subtitleKey: 'settlement_ui.hub.deposit_subtitle',
    Icon: Shield,
    route: '/settlement/deposit',
  },
];

export default function SettlementHub() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Click-outside close for the split-dropdown menu.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const handlePick = (route: string) => {
    setMenuOpen(false);
    navigate(route);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="h-full overflow-y-auto"
      style={{ background: 'var(--bg-elev-1)', color: 'var(--t1)' }}
    >
      <div className="mx-auto px-6 py-5" style={{ maxWidth: 1400 }}>
        {/* Header strip — title + subtitle + primary CTA (split-dropdown).
            Replaces the prior three large-card hero. */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="min-w-0">
            <h1 className="text-[20px] font-semibold tracking-tight text-[#eaecef]">
              {t('settlement_ui.hub.title')}
            </h1>
            <p className="text-[12px] text-[#b7bdc6] mt-0.5">
              All settlements are secured by IRM locked on-chain. Both parties must hold IRM to create or participate in an agreement.
            </p>
            <p className="text-[12px] text-[#b7bdc6] mt-1.5 max-w-3xl">
              Lock IRM in escrow for any trustless transaction — goods, services, freelance work, or trades. IRM releases automatically when both parties confirm.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/marketplace"
              onClick={(e) => { e.preventDefault(); navigate('/marketplace'); }}
              className="text-[12px] inline-flex items-center text-[#b7bdc6] hover:text-[#eaecef] transition-colors whitespace-nowrap"
            >
              ← Marketplace
            </a>
            {/* Split-button: a primary action that defaults to Safe Trade
                plus a chevron that opens a 3-item menu of all flows. */}
            <div className="relative" ref={menuRef}>
              <div className="inline-flex rounded overflow-hidden">
                <button
                  type="button"
                  onClick={() => navigate('/settlement/safe-trade')}
                  className="inline-flex items-center gap-1.5 h-9 px-3 text-[13px] font-semibold bg-[#fcd535] text-[#0b0e11] hover:bg-[#f0c020] transition-colors"
                >
                  <Plus size={13} />
                  New agreement
                </button>
                <button
                  type="button"
                  aria-label="Choose agreement type"
                  onClick={() => setMenuOpen((v) => !v)}
                  className="inline-flex items-center h-9 px-2 bg-[#fcd535] text-[#0b0e11] hover:bg-[#f0c020] transition-colors border-l border-[#0b0e11]/20"
                >
                  <ChevronDown size={14} />
                </button>
              </div>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.12 }}
                  className="absolute right-0 mt-1.5 z-20 w-[260px] rounded-lg bg-[#181a20] border border-[#2b3139] shadow-2xl overflow-hidden"
                >
                  {FLOW_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handlePick(opt.route)}
                      className="w-full text-left flex items-start gap-3 px-3 py-2.5 hover:bg-[#2b3139] transition-colors"
                    >
                      <opt.Icon size={16} className="text-[#b7bdc6] mt-0.5 flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-[#eaecef] leading-tight">
                          {t(opt.titleKey)}
                        </div>
                        <div className="text-[11px] text-[#b7bdc6] mt-0.5 leading-snug">
                          {t(opt.subtitleKey)}
                        </div>
                      </div>
                    </button>
                  ))}
                </motion.div>
              )}
            </div>
          </div>
        </div>

        {/* Active Agreements — the page's primary content now that the
            three hero cards have been replaced by the header CTA. */}
        <ActiveAgreementsPanel />
      </div>
    </motion.div>
  );
}
