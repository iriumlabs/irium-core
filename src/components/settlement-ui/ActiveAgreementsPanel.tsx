import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence } from 'framer-motion';
import { RefreshCw, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { agreements as agreementsApi, agreementSpend, wallet } from '../../lib/tauri';
import { useStore } from '../../lib/store';
import { useIriumEvents } from '../../lib/hooks';
import type { Agreement, AgreementStatusResult } from '../../lib/types';
import { mapErrorToKey } from './ErrorMapper';
import AgreementRow from './AgreementRow';

interface ActiveAgreementsPanelProps {
  // Optional override for non-inline actions (view_details / view_dispute).
  // Inline release / refund are handled directly inside this component so
  // the action completes without a route change. When omitted, view_*
  // navigates to /agreements via useNavigate.
  onAgreementAction?: (action: 'release' | 'refund' | 'view_dispute' | 'view_details' | null, agreementId: string) => void;
}

// Terminal states — these agreements are done and don't need to clutter
// the "active" view. Users can still find them via the full /agreements
// page. "expired" stays surfaced (refund may still be claimable).
const TERMINAL_STATES = new Set(['released', 'refunded']);

// Per-row status fetches run with a small concurrency cap so a wallet
// with 100+ agreements doesn't fire 100 simultaneous RPCs at iriumd.
async function fetchStatusInBatches(ids: string[], onStatus: (id: string, s: AgreementStatusResult | null) => void) {
  const CONCURRENCY = 6;
  let i = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, ids.length) }, async () => {
    while (i < ids.length) {
      const id = ids[i++];
      try {
        const s = await agreementSpend.status(id);
        onStatus(id, s ?? null);
      } catch {
        // Per-row failure → leave as null. The row's badge will fall
        // back to the list-response Agreement.status string via
        // PlainStatus's secondary derivation path.
        onStatus(id, null);
      }
    }
  });
  await Promise.all(workers);
}

// ActiveAgreementsPanel — filters agreements to those where the user is a
// party, enriches each row with a live agreementSpend.status() fetch, and
// handles inline Release / Claim Refund actions WITHOUT navigating away.
// "View Details" still falls through to /agreements for the full modal UI.
export default function ActiveAgreementsPanel({ onAgreementAction }: ActiveAgreementsPanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const nodeRunning = useStore((s) => s.nodeStatus?.running ?? false);

  // User wallet addresses. Fetched via wallet.listAddresses() per the
  // spec — store.addresses would also work but the spec says to call
  // the RPC, so we honor that and cache the result locally.
  const [myAddresses, setMyAddresses] = useState<Set<string>>(new Set());

  const [list, setList] = useState<Agreement[] | null>(null);
  // Per-agreement status fetched via agreementSpend.status(). 'loading'
  // means a fetch is in flight; the actual result lives once the
  // fetch resolves. Missing key = not yet attempted.
  const [statusById, setStatusById] = useState<Record<string, AgreementStatusResult | null | 'loading'>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  // Tracks which row is currently mid-release / mid-refund so we can
  // disable that row's button + show its spinner. Only one inline
  // action can be in flight at a time per panel.
  const [busyId, setBusyId] = useState<string | null>(null);

  // Fetch user addresses ONCE. They rarely change mid-session and
  // re-fetching on every refresh wastes an RPC.
  useEffect(() => {
    wallet.listAddresses()
      .then((addrs) => setMyAddresses(new Set((addrs ?? []).map((a) => a.address))))
      .catch(() => { /* empty set → no filtering applied */ });
  }, []);

  const refresh = useCallback(async () => {
    setErr(null);
    try {
      const data = await agreementsApi.list();
      setList(data ?? []);
    } catch (e) {
      setErr(t(mapErrorToKey(e, 'status')));
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useIriumEvents((event) => {
    if (event.type.startsWith('agreement.')) {
      refresh();
    }
  });

  // Filter to MY agreements only — where any of the user's wallet
  // addresses appears as buyer or seller. Terminal states removed too.
  const visible = useMemo(() => {
    if (!list) return [];
    return list.filter((a) => {
      if (TERMINAL_STATES.has(a.status)) return false;
      if (myAddresses.size === 0) return true; // pre-load: show nothing-filtered
      const buyerMatch = !!(a.buyer && myAddresses.has(a.buyer));
      const sellerMatch = !!(a.seller && myAddresses.has(a.seller));
      return buyerMatch || sellerMatch;
    });
  }, [list, myAddresses]);

  // Eager status fetch for every visible agreement. Runs once per
  // visible-set change (e.g. after refresh, after addresses load).
  // Already-fetched ids are skipped — only 'loading' or missing entries
  // trigger a new RPC.
  useEffect(() => {
    const todo = visible.map((a) => a.id).filter((id) => !(id in statusById));
    if (todo.length === 0) return;
    // Mark as loading upfront so badges show "Checking..." while RPCs run.
    setStatusById((prev) => {
      const next = { ...prev };
      for (const id of todo) next[id] = 'loading';
      return next;
    });
    fetchStatusInBatches(todo, (id, s) => {
      setStatusById((prev) => ({ ...prev, [id]: s }));
    });
  }, [visible, statusById]);

  const handleRelease = async (agreementId: string) => {
    setBusyId(agreementId);
    try {
      // Auto-fetch the persisted preimage. If missing (peer-created
      // agreement), agreement.release will fall back to the wallet's
      // own derivation logic.
      let secret: string | undefined;
      try { secret = await agreementsApi.getSecret(agreementId); } catch { /* no local secret — backend may auto-derive */ }
      const result = await agreementsApi.release(agreementId, secret, true);
      if (result.success) {
        toast.success(t('settlement_ui.hub.toast_released'));
        // Drop the row's cached status so refresh re-fetches and the
        // badge advances to "Complete".
        setStatusById((prev) => { const n = { ...prev }; delete n[agreementId]; return n; });
        refresh();
      } else {
        toast.error(result.message ?? t(mapErrorToKey('release failed', 'release')));
      }
    } catch (e) {
      toast.error(t(mapErrorToKey(e, 'release')));
    } finally {
      setBusyId(null);
    }
  };

  const handleRefund = async (agreementId: string) => {
    setBusyId(agreementId);
    try {
      const result = await agreementsApi.refund(agreementId, true);
      if (result.success) {
        toast.success(t('settlement_ui.hub.toast_refunded'));
        setStatusById((prev) => { const n = { ...prev }; delete n[agreementId]; return n; });
        refresh();
      } else {
        toast.error(result.message ?? t(mapErrorToKey('refund failed', 'refund')));
      }
    } catch (e) {
      toast.error(t(mapErrorToKey(e, 'refund')));
    } finally {
      setBusyId(null);
    }
  };

  // Non-inline actions (view_details, view_dispute) navigate. The parent
  // can override this via onAgreementAction; otherwise we default to the
  // existing /agreements page with the row's id in nav state.
  const handleViewAction = (action: 'release' | 'refund' | 'view_dispute' | 'view_details' | null, agreementId: string) => {
    if (onAgreementAction) {
      onAgreementAction(action, agreementId);
      return;
    }
    if (action === 'view_dispute') {
      navigate(`/settlement/dispute/${agreementId}`);
      return;
    }
    navigate('/agreements', { state: { expandId: agreementId } });
  };

  return (
    <section className="space-y-3" aria-label={t('settlement_ui.hub.active_title')}>
      <div className="flex items-center justify-between">
        <h2 className="font-display font-semibold text-base text-white">
          {t('settlement_ui.hub.active_title')}
        </h2>
        <button
          onClick={refresh}
          disabled={loading}
          className="btn-ghost text-xs text-white/50 hover:text-white flex items-center gap-1.5 cursor-pointer"
          aria-label={t('common.retry')}
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {err && !nodeRunning && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/8 p-3 text-xs text-amber-200 flex items-start gap-2">
          <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
          <span>{t('settlement_ui.hub.active_load_error')}</span>
        </div>
      )}

      {loading && list === null && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card p-4 h-20 shimmer rounded-xl" />
          ))}
        </div>
      )}

      {!loading && visible.length === 0 && (
        <div className="rounded-xl border border-white/8 bg-white/[0.02] p-6 text-center">
          <p className="text-sm text-white/45">{t('settlement_ui.hub.active_empty')}</p>
        </div>
      )}

      <AnimatePresence initial={false}>
        {visible.map((agreement) => {
          const s = statusById[agreement.id];
          const statusLoading = s === 'loading';
          const statusValue = s === 'loading' ? null : s ?? null;
          return (
            <AgreementRow
              key={agreement.id}
              agreement={agreement}
              status={statusValue}
              statusLoading={statusLoading}
              myAddresses={myAddresses}
              busy={busyId === agreement.id}
              onRelease={handleRelease}
              onRefund={handleRefund}
              onActionClick={handleViewAction}
            />
          );
        })}
      </AnimatePresence>
    </section>
  );
}
