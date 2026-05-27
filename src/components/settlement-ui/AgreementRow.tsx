import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Loader2 } from 'lucide-react';
import { formatIRM, truncateAddr } from '../../lib/types';
import type { Agreement, AgreementStatusResult } from '../../lib/types';
import { derivePlainStatus, plainStatusFromAgreement } from './PlainStatus';
import StatusBadge from './StatusBadge';
import TechnicalDetails from './TechnicalDetails';

interface AgreementRowProps {
  agreement: Agreement;
  // Per-agreement on-chain status fetched by the parent panel. When
  // provided, drives the status badge AND the primary-action selection
  // (release_eligible / refund_eligible from this shape are richer than
  // the list-response Agreement shape). null while a fetch is in flight.
  // undefined when the parent isn't fetching status (legacy behaviour).
  status?: AgreementStatusResult | null;
  // True while the per-row status fetch hasn't returned yet. Shows a
  // "Checking..." badge in place of a derived plain status.
  statusLoading?: boolean;
  // ALL of the local user's wallet addresses. Used to identify "the
  // other party" — if any address matches buyer/seller, the OTHER side
  // is the other party. Falls back to seller if no match.
  myAddresses: Set<string>;
  // True while the inline release/refund action for THIS row is in
  // flight. Parent owns this so it can sequence multiple rows.
  busy?: boolean;
  // Inline release handler. When omitted, "Release Funds" falls through
  // to onActionClick instead.
  onRelease?: (agreementId: string) => void;
  // Inline refund handler. Same fallback semantics.
  onRefund?: (agreementId: string) => void;
  // Catch-all for non-inline actions (view_details, view_dispute) and
  // legacy callers that haven't wired onRelease/onRefund yet.
  onActionClick: (action: 'release' | 'refund' | 'view_dispute' | 'view_details' | null, agreementId: string) => void;
}

// AgreementRow — one row in the active panel + agreement list views.
// Truncates the other party's address to 12 chars (5 prefix + ... + 4 suffix)
// rather than showing the role label. Status badge prefers the RPC-fetched
// AgreementStatusResult when available so refund-ready states surface.
export default function AgreementRow({
  agreement,
  status,
  statusLoading,
  myAddresses,
  busy,
  onRelease,
  onRefund,
  onActionClick,
}: AgreementRowProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Status precedence: live AgreementStatusResult > list-response Agreement.
  // The richer shape includes refund_eligible which the list response lacks.
  const plainStatus = useMemo(() => {
    if (statusLoading && !status) {
      return {
        kind: 'unknown' as const,
        labelKey: 'settlement_ui.status.checking',
        color: 'neutral' as const,
        primaryAction: 'view_details' as const,
        primaryActionLabelKey: 'settlement_ui.actions.view_details',
      };
    }
    if (status) {
      return derivePlainStatus({
        agreementStatus: status.status,
        releaseEligible: status.release_eligible,
        refundEligible: status.refund_eligible,
      });
    }
    return plainStatusFromAgreement(agreement);
  }, [agreement, status, statusLoading]);

  // "Other party" — first buyer/seller field that doesn't match any of
  // the local user's wallet addresses. Multi-address wallets work even
  // when the currently-selected address isn't the one on the agreement.
  const otherParty = useMemo(() => {
    const buyerIsMine = !!(agreement.buyer && myAddresses.has(agreement.buyer));
    const sellerIsMine = !!(agreement.seller && myAddresses.has(agreement.seller));
    if (buyerIsMine && !sellerIsMine) return agreement.seller ?? '—';
    if (sellerIsMine && !buyerIsMine) return agreement.buyer ?? '—';
    return agreement.seller ?? agreement.buyer ?? '—';
  }, [agreement, myAddresses]);

  // Dispatch the primary action button. Release / refund call the inline
  // handlers when provided; view_details / view_dispute always fall
  // through to onActionClick so the parent decides where to navigate.
  const handleAction = () => {
    if (plainStatus.primaryAction === 'release' && onRelease) {
      onRelease(agreement.id);
      return;
    }
    if (plainStatus.primaryAction === 'refund' && onRefund) {
      onRefund(agreement.id);
      return;
    }
    onActionClick(plainStatus.primaryAction, agreement.id);
  };

  // Visual emphasis for the action button: green tint when it's a
  // release action, amber for refund, rose for dispute, neutral otherwise.
  const buttonStyle =
    plainStatus.primaryAction === 'release'
      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
      : plainStatus.primaryAction === 'refund'
      ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25'
      : plainStatus.primaryAction === 'view_dispute'
      ? 'bg-rose-500/15 border-rose-500/40 text-rose-300 hover:bg-rose-500/25'
      : 'btn-secondary';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="rounded-xl border border-white/8 bg-white/[0.02] p-4 hover:bg-white/[0.04] transition-colors"
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        {/* Left: party + amount. Other party address truncated to 12 chars
            (5 prefix + "..." + 4 suffix). Role labels ("payee" / "payer")
            are intentionally NOT shown — the address is the source of truth. */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-white/35">{t('settlement_ui.hub.other_party')}</span>
            <span className="font-mono text-xs text-white/75 break-all">
              {truncateAddr(otherParty, 5, 4)}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-white/35">{t('settlement_ui.hub.amount')}</span>
            <span className="font-display font-semibold text-base text-white">
              {formatIRM(agreement.amount)}
            </span>
          </div>
        </div>

        {/* Right: status badge + action button */}
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
          <StatusBadge status={plainStatus} />
          <button
            onClick={handleAction}
            disabled={busy}
            className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50 ${buttonStyle}`}
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : null}
            {t(plainStatus.primaryActionLabelKey)}
            {!busy && <ArrowRight size={11} />}
          </button>
        </div>
      </div>

      <TechnicalDetails agreement={agreement} status={status ?? undefined} />

      {agreement.status !== 'released' && agreement.status !== 'refunded' && (
        <div className="mt-3 pt-3 border-t border-white/5 flex justify-end">
          <button
            onClick={() => navigate(`/settlement/dispute/${agreement.id}`)}
            className="text-[11px] text-white/35 hover:text-rose-300 transition-colors cursor-pointer"
          >
            {t('settlement_ui.actions.report_problem')}
          </button>
        </div>
      )}
    </motion.div>
  );
}
