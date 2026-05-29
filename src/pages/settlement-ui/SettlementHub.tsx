import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftRight, Briefcase, Shield, ArrowRight } from 'lucide-react';
import ActiveAgreementsPanel from '../../components/settlement-ui/ActiveAgreementsPanel';

// SettlementHub — the landing view for the Settlement section. Three
// big entry cards above the fold (Safe Trade / Pay for Work /
// Refundable Deposit), then the Active Agreements list below.

interface HubCardSpec {
  id: 'safe_trade' | 'pay_for_work' | 'deposit';
  titleKey: string;
  subtitleKey: string;
  Icon: React.ElementType;
  // Accent colors — set per-card so the three cards are visually
  // distinct without overwhelming the page. CSS variables are not used
  // here because the cards intentionally render in fixed brand-tinted
  // hues that don't shift with the active theme.
  accentBg: string;
  accentBorder: string;
  accentText: string;
  accentGlow: string;
}

const CARDS: HubCardSpec[] = [
  {
    id: 'safe_trade',
    titleKey: 'settlement_ui.hub.safe_trade_title',
    subtitleKey: 'settlement_ui.hub.safe_trade_subtitle',
    Icon: ArrowLeftRight,
    accentBg: 'rgba(110,198,255,0.14)',
    accentBorder: 'rgba(110,198,255,0.32)',
    accentText: '#6ec6ff',
    accentGlow: '#6ec6ff',
  },
  {
    id: 'pay_for_work',
    titleKey: 'settlement_ui.hub.pay_for_work_title',
    subtitleKey: 'settlement_ui.hub.pay_for_work_subtitle',
    Icon: Briefcase,
    accentBg: 'rgba(167,139,250,0.16)',
    accentBorder: 'rgba(167,139,250,0.30)',
    accentText: '#a78bfa',
    accentGlow: '#a78bfa',
  },
  {
    id: 'deposit',
    titleKey: 'settlement_ui.hub.deposit_title',
    subtitleKey: 'settlement_ui.hub.deposit_subtitle',
    Icon: Shield,
    accentBg: 'rgba(251,191,36,0.14)',
    accentBorder: 'rgba(251,191,36,0.32)',
    accentText: '#fbbf24',
    accentGlow: '#fbbf24',
  },
];

export default function SettlementHub() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // HubCardSpec.id is a closed string-literal union of the three IDs
  // below, so TS enforces exhaustiveness — no fallback arm needed.
  const handleCardClick = (cardId: HubCardSpec['id']) => {
    if (cardId === 'safe_trade')   { navigate('/settlement/safe-trade');   return; }
    if (cardId === 'pay_for_work') { navigate('/settlement/pay-for-work'); return; }
    if (cardId === 'deposit')      { navigate('/settlement/deposit');      return; }
  };

  // Inline release / refund are handled inside ActiveAgreementsPanel.
  // View Details + View Dispute use the panel's default navigation
  // (no override needed here).

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="h-full overflow-y-auto scroll-visible"
    >
      <div className="w-full px-8 py-6 max-w-5xl mx-auto">
        {/* Header — single-purpose page title + one-line subtitle.
            "Back to Marketplace" link added so users who landed here via
            the Marketplace page's "Advanced flows" link have an obvious
            way back to the price-sorted order book. The new Marketplace
            redesign positions this page as the lower-level / power-user
            entry; most casual P2P trades happen on the order book. */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="page-title">{t('settlement_ui.hub.title')}</h1>
            <p className="page-subtitle">For direct deals between two people you already know. To post a public offer anyone can find, use the Marketplace.</p>
          </div>
          <a
            href="/marketplace"
            onClick={(e) => { e.preventDefault(); navigate('/marketplace'); }}
            className="text-xs inline-flex items-center gap-1.5 mt-1"
            style={{ color: 'rgba(110,198,255,0.85)', whiteSpace: 'nowrap' }}
            title="Browse the public order book and take an open offer."
          >
            ← Back to Marketplace
          </a>
        </div>

        {/* Three entry cards — equal weight, equal size, only three.
            Above-the-fold real estate is reserved for these three
            choices and nothing else, per the design rule. */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
          {CARDS.map((card) => (
            <motion.button
              key={card.id}
              type="button"
              whileHover={{ scale: 1.02, y: -2 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleCardClick(card.id)}
              className="card-interactive p-6 text-left flex flex-col gap-4 relative overflow-hidden cursor-pointer min-h-[200px]"
            >
              {/* Soft glow behind the icon — subtle visual weight */}
              <div
                className="absolute top-4 right-4 w-24 h-24 rounded-full blur-3xl opacity-30"
                style={{ background: card.accentGlow }}
              />
              <div
                className="p-3 rounded-xl w-fit"
                style={{
                  background: card.accentBg,
                  border: `1px solid ${card.accentBorder}`,
                }}
              >
                <card.Icon size={22} style={{ color: card.accentText }} />
              </div>
              <div className="flex-1">
                <div className="font-display font-bold text-lg text-white leading-tight">
                  {t(card.titleKey)}
                </div>
                <div className="text-white/50 text-sm mt-2 leading-relaxed">
                  {t(card.subtitleKey)}
                </div>
              </div>
              <div
                className="text-xs font-medium flex items-center gap-1.5"
                style={{ color: card.accentText }}
              >
                {t('settlement_ui.hub.start_cta')}
                <ArrowRight size={12} />
              </div>
            </motion.button>
          ))}
        </div>

        {/* Active Agreements panel — below the entry cards. Lists the
            user's non-terminal agreements with plain status badges.
            Release / Refund act inline; View Details navigates to the
            existing /agreements page. */}
        <ActiveAgreementsPanel />
      </div>
    </motion.div>
  );
}
