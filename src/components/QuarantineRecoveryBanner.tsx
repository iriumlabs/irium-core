import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, X } from 'lucide-react';
import { useStore } from '../lib/store';

// Banner shown at the top of the Dashboard and Miner pages when
// scan_quarantined_blocks (run once per session in App.tsx) reports a
// non-zero file count. Quarantined blocks live on disk under
// $IRIUM_DATA_DIR/blocks-quarantine/ — they are blocks iriumd persisted
// during a partial write that the next start couldn't validate. They
// don't break anything on their own, but they don't count toward
// mining history or chain stats, so we surface them so the user can
// recover via the Help page's QuarantineRecovery flow.
//
// The banner is dismissable for the current session via the X button.
// We don't persist dismissal across launches — a future bug that
// quarantines more blocks should resurface the warning.
export default function QuarantineRecoveryBanner() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const count = useStore((s) => s.quarantinedBlockCount);
  const dismissed = useStore((s) => s.quarantineBannerDismissed);
  const dismiss = useStore((s) => s.dismissQuarantineBanner);

  if (count <= 0 || dismissed) return null;

  return (
    <div
      className="relative flex items-center gap-3 rounded-xl px-5 py-4 overflow-hidden"
      style={{
        background: 'rgba(245,158,11,0.15)',
        border: '1px solid rgba(245,158,11,0.55)',
        boxShadow: '0 0 24px rgba(245,158,11,0.10)',
      }}
    >
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: 'rgba(245,158,11,0.18)', border: '1px solid rgba(245,158,11,0.40)' }}
      >
        <AlertTriangle size={18} style={{ color: '#fbbf24' }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-display font-bold" style={{ color: '#fbbf24' }}>
          {t('quarantine_banner.title', { count })}
        </p>
        <p className="text-xs mt-0.5" style={{ color: 'rgba(238,240,255,0.65)' }}>
          {t('quarantine_banner.subtitle')}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={() => navigate('/help')}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-display font-semibold transition-all active:scale-[0.97]"
          style={{
            background: 'rgba(245,158,11,0.16)',
            border: '1px solid rgba(245,158,11,0.55)',
            color: '#fff',
            boxShadow: '0 0 16px rgba(245,158,11,0.18)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(245,158,11,0.24)';
            e.currentTarget.style.borderColor = 'rgba(245,158,11,0.75)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(245,158,11,0.16)';
            e.currentTarget.style.borderColor = 'rgba(245,158,11,0.55)';
          }}
        >
          {t('quarantine_banner.recover_now')}
        </button>
        <button
          onClick={dismiss}
          aria-label={t('quarantine_banner.dismiss')}
          className="w-8 h-8 inline-flex items-center justify-center rounded-lg transition-all"
          style={{
            background: 'transparent',
            border: '1px solid rgba(245,158,11,0.35)',
            color: 'rgba(251,191,36,0.85)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(245,158,11,0.10)';
            e.currentTarget.style.borderColor = 'rgba(245,158,11,0.60)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.borderColor = 'rgba(245,158,11,0.35)';
          }}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
