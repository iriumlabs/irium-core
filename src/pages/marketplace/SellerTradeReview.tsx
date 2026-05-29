import { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, Loader2, Inbox } from 'lucide-react';
import toast from 'react-hot-toast';
import { agreements, proofs, disputes } from '../../lib/tauri';
import type { Agreement, Proof } from '../../lib/types';
import { formatIRM } from '../../lib/types';

// The wire shape returned by `proofs.list()` carries extra runtime
// fields (`proof_type`, `evidence_summary`, `created_at`) that the
// strict TS Proof interface in lib/types.ts does not yet declare.
// We narrow into this local type via cast at use-time rather than
// patching the global interface from a feature file.
type RawProof = Proof & {
  proof_type?: string;
  evidence_summary?: string;
  created_at?: number;
};

// Settlement Step 4 — seller-side verification screen. Lists the user's
// sales whose escrow is funded and waiting on the seller to either
// confirm payment received (release IRM to the buyer) or open a dispute
// because no payment arrived.
//
// For each row we pull the buyer's most recent payment-sent proof and
// surface its evidence summary verbatim so the seller has the
// transaction reference / wire id the buyer claimed they sent.
//
// Plain language throughout - no hex hashes, no preimage talk, no
// policy talk. Addresses formatted 8...4, amounts in IRM.

export interface SellerTradeReviewProps {
  sellingTrades: { agreement: Agreement; side: 'buying' | 'selling' }[];
  onDisputeOpened: (agreementId: string) => void;
}

interface TradeRow {
  agreement: Agreement;
  lifecycle: string;
  paymentProof: RawProof | null;
  proofLoading: boolean;
}

const POLL_PROOFS_MS = 20_000;

// Heuristic: the proof types we treat as a buyer claiming they sent
// payment. The wallet sidecar uses 'payment_sent' by convention but the
// underlying RPC accepts any string, so we also accept anything
// containing 'payment'.
function isPaymentProof(p: RawProof): boolean {
  const t = (p.proof_type ?? '').toLowerCase();
  return t === 'payment_sent' || t.includes('payment');
}

function shortAddr(addr: string | undefined): string {
  if (!addr) return '-';
  if (addr.length <= 13) return addr;
  return `${addr.slice(0, 8)}...${addr.slice(-4)}`;
}

function timeAgoFromUnix(unix: number | undefined): string {
  if (!unix) return '';
  const secs = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function SellerTradeReview({ sellingTrades, onDisputeOpened }: SellerTradeReviewProps) {
  const [rows, setRows] = useState<TradeRow[]>([]);
  const [busy, setBusy] = useState<Record<string, 'releasing' | 'disputing' | null>>({});

  // Filter to only the funded / partially-released rows; anything past
  // that is either complete or already in dispute and lives on the
  // Agreements page rather than this hot inbox.
  const pending = sellingTrades.filter(({ agreement }) => {
    const state = (agreement as unknown as { lifecycle?: { state?: string } })?.lifecycle?.state ?? 'unknown';
    return state === 'funded' || state === 'partially_released';
  });

  // Per-row proofs poll - fan out one proofs.list() per pending row.
  // Cached in row state; refreshed at POLL_PROOFS_MS. Best-effort: a
  // proofs.list() failure leaves paymentProof=null and the row shows
  // "Buyer has not yet reported payment".
  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      const next: TradeRow[] = [];
      for (const t of pending) {
        const id = (t.agreement as unknown as { agreement_id?: string; id?: string }).agreement_id
          ?? (t.agreement as unknown as { id?: string }).id ?? '';
        if (!id) continue;
        try {
          const list = (await proofs.list(id)) as RawProof[] | null;
          const payProof = (list ?? []).filter(isPaymentProof).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0] ?? null;
          next.push({
            agreement: t.agreement,
            lifecycle: (t.agreement as unknown as { lifecycle?: { state?: string } })?.lifecycle?.state ?? 'unknown',
            paymentProof: payProof,
            proofLoading: false,
          });
        } catch {
          next.push({
            agreement: t.agreement,
            lifecycle: (t.agreement as unknown as { lifecycle?: { state?: string } })?.lifecycle?.state ?? 'unknown',
            paymentProof: null,
            proofLoading: false,
          });
        }
      }
      if (!cancelled) setRows(next);
    };
    fetchAll();
    const tick = setInterval(fetchAll, POLL_PROOFS_MS);
    return () => {
      cancelled = true;
      clearInterval(tick);
    };
    // pending is recomputed every render from props; using its length +
    // the first/last id as a coarse dep avoids the noisy "deps array
    // contains objects" deopt without re-fetching on every parent tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending.length, pending[0]?.agreement, pending[pending.length - 1]?.agreement]);

  const handleConfirmRelease = async (agreementId: string) => {
    setBusy((p) => ({ ...p, [agreementId]: 'releasing' }));
    try {
      // Pull the preimage the wallet sidecar stashed at agreement
      // creation - the seller doesn't see this; we just feed it back
      // into the release transaction.
      let secret: string | null = null;
      try {
        secret = await agreements.getSecret(agreementId);
      } catch {
        secret = null;
      }
      await agreements.release(agreementId, secret ?? undefined, true);
      toast.success('IRM released. The buyer now has the funds.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy((p) => ({ ...p, [agreementId]: null }));
    }
  };

  const handleOpenDispute = async (agreementId: string) => {
    setBusy((p) => ({ ...p, [agreementId]: 'disputing' }));
    try {
      await disputes.open(agreementId, 'seller did not receive off-chain payment');
      toast.success('Dispute opened. A resolver will review the evidence.');
      onDisputeOpened(agreementId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy((p) => ({ ...p, [agreementId]: null }));
    }
  };

  if (pending.length === 0) {
    return (
      <div
        className="card p-4 text-xs text-center"
        style={{ border: '1px solid rgba(167,139,250,0.18)', color: 'rgba(238,240,255,0.45)' }}
      >
        <Inbox size={18} className="mx-auto mb-2" style={{ color: 'rgba(167,139,250,0.55)' }} />
        No incoming trades waiting on you. When a buyer takes one of your offers and reports
        payment, it shows up here.
      </div>
    );
  }

  return (
    <div className="card p-4 space-y-3" style={{ border: '1px solid rgba(167,139,250,0.18)' }}>
      <div className="flex items-center justify-between">
        <h3 className="font-display font-semibold text-sm" style={{ color: 'var(--t1)' }}>
          Incoming trades to verify
        </h3>
        <span className="text-[11px]" style={{ color: 'rgba(238,240,255,0.55)' }}>
          {pending.length} waiting
        </span>
      </div>

      <div className="space-y-3 overflow-y-auto" style={{ maxHeight: 420 }}>
        {rows.map((row) => {
          const a = row.agreement;
          const id = (a as unknown as { agreement_id?: string; id?: string }).agreement_id
            ?? (a as unknown as { id?: string }).id ?? '';
          const amount = (a as unknown as { total_amount?: number; amount?: number }).total_amount
            ?? (a as unknown as { amount?: number }).amount ?? 0;
          const buyer = (a as unknown as { buyer?: string }).buyer ?? '';
          const proof = row.paymentProof;
          const busyState = busy[id] ?? null;

          return (
            <div
              key={id}
              className="rounded space-y-2"
              style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(167,139,250,0.18)',
                borderLeft: '3px solid #A78BFA',
                padding: 14,
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <div
                  className="tabular-nums font-display font-bold"
                  style={{ color: '#eef0ff', fontSize: 18, fontFamily: '"JetBrains Mono", monospace' }}
                >
                  {formatIRM(amount)}
                </div>
                <span
                  className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded"
                  style={{
                    background: 'rgba(167,139,250,0.12)',
                    color: '#A78BFA',
                    border: '1px solid rgba(167,139,250,0.25)',
                  }}
                >
                  {row.lifecycle === 'partially_released' ? 'Releasing' : 'Funded'}
                </span>
              </div>

              <div className="text-[11px]" style={{ color: 'rgba(238,240,255,0.55)' }}>
                <span style={{ color: 'rgba(238,240,255,0.40)' }}>Buyer: </span>
                <span style={{ fontFamily: '"JetBrains Mono", monospace' }} title={buyer}>
                  {shortAddr(buyer)}
                </span>
              </div>

              {/* Buyer's payment claim, surfaced from proofs.list. When
                  no payment proof has been submitted yet the row shows
                  a muted "waiting" notice so the seller knows the
                  trade is alive but the buyer hasn't reported. */}
              {proof ? (
                <div
                  className="rounded p-2 space-y-1 text-xs"
                  style={{
                    background: 'rgba(34,197,94,0.08)',
                    border: '1px solid rgba(34,197,94,0.20)',
                    color: 'rgba(238,240,255,0.78)',
                  }}
                >
                  <div className="text-[10px] uppercase tracking-wide" style={{ color: '#22c55e' }}>
                    Buyer claims payment sent {timeAgoFromUnix(proof.created_at)}
                  </div>
                  <div style={{ fontFamily: '"JetBrains Mono", monospace', wordBreak: 'break-word' }}>
                    {proof.evidence_summary ?? '(no transaction reference provided)'}
                  </div>
                </div>
              ) : (
                <div
                  className="rounded p-2 text-xs"
                  style={{
                    background: 'rgba(252,211,77,0.06)',
                    border: '1px solid rgba(252,211,77,0.18)',
                    color: 'rgba(238,240,255,0.55)',
                  }}
                >
                  Buyer has not yet reported sending payment. Wait, or open a dispute if the
                  deadline has passed.
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleOpenDispute(id)}
                  disabled={busyState !== null}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[11px] font-display font-semibold"
                  style={{
                    color: '#fbbf24',
                    background: 'rgba(252,211,77,0.10)',
                    border: '1px solid rgba(252,211,77,0.30)',
                    cursor: busyState ? 'wait' : 'pointer',
                  }}
                >
                  {busyState === 'disputing' ? <Loader2 size={11} className="animate-spin" /> : <AlertTriangle size={11} />}
                  No payment - open dispute
                </button>
                <button
                  type="button"
                  onClick={() => handleConfirmRelease(id)}
                  disabled={busyState !== null}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[11px] font-display font-semibold"
                  style={{
                    color: '#22c55e',
                    background: 'rgba(34,197,94,0.12)',
                    border: '1px solid rgba(34,197,94,0.30)',
                    cursor: busyState ? 'wait' : 'pointer',
                  }}
                >
                  {busyState === 'releasing' ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                  Confirm received and release
                </button>
              </div>
            </div>
          );
        })}

        {/* Quietly retry the parent poll if we have pending rows but
            haven't drawn any proof state yet - this protects against
            the first-render race where pending has items but the proofs
            fetch hasn't returned yet. */}
        {rows.length === 0 && pending.length > 0 && (
          <div className="text-xs text-center py-4" style={{ color: 'rgba(238,240,255,0.45)' }}>
            <Loader2 size={14} className="animate-spin inline-block mr-1" />
            Loading trades...
          </div>
        )}
      </div>
    </div>
  );
}
