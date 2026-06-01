import { useEffect, useState } from 'react';
import { Loader2, Scale, Star, Shield, ExternalLink } from 'lucide-react';
import type { Agreement } from '../../lib/types';
import { TradingModal } from '../../components/ui';

// Settlement Step 5 - resolver selection screen for an open dispute.
//
// Shows:
//   - The agreement's nominated primary and fallback resolvers (parsed
//     directly from the agreement object, no extra fetch).
//   - The public registered-resolver feed pulled from iriumd's GET
//     /resolvers/list endpoint - presented as a list of candidates the
//     parties can co-nominate via the wallet's resolver re-nomination
//     flow if the original picks no-show.
//
// All addresses are formatted as 8...4. Fees are shown in IRM (never
// satoshis). No hex hashes / no policy talk surfaces in the UI.

export interface ResolverPickerProps {
  agreement: Agreement | null;
  // Optional override - if the host supplied a custom rpc URL we use
  // it; otherwise we hit the local node default.
  rpcUrl?: string;
  onClose: () => void;
}

interface RegisteredResolver {
  resolver_address: string;
  display_name?: string;
  bio?: string;
  registered_at_height?: number;
  fee_bps_self_quoted?: number;
  reputation_stars?: number;
}

function shortAddr(addr: string | undefined | null): string {
  if (!addr) return '-';
  if (addr.length <= 13) return addr;
  return `${addr.slice(0, 8)}...${addr.slice(-4)}`;
}

function formatFeeIrm(sats: number | null | undefined): string {
  if (sats == null || !Number.isFinite(sats) || sats <= 0) return '-';
  const irm = sats / 1e8;
  return `${irm.toLocaleString('en-US', { maximumFractionDigits: 8 })} IRM`;
}

function StarRow({ stars }: { stars: number | undefined | null }) {
  const n = typeof stars === 'number' && stars > 0 ? Math.min(5, Math.round(stars)) : 0;
  if (n === 0) {
    return (
      <span className="text-[11px]" style={{ color: 'rgba(238,240,255,0.35)' }}>
        no reputation yet
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5" style={{ color: '#fbbf24' }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={10} fill={i <= n ? 'currentColor' : 'none'} strokeWidth={1.5} />
      ))}
    </span>
  );
}

export default function ResolverPicker({ agreement, rpcUrl, onClose }: ResolverPickerProps) {
  const [registry, setRegistry] = useState<RegisteredResolver[] | null>(null);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Pull the agreement's nominated resolvers + fees out of the
  // free-shape Agreement object. We probe both the top-level fields
  // (per SETTLEMENT-DEV.md "Resolver fields on the agreement") and any
  // nested 'agreement_json' that wallet sidecars sometimes use as a
  // pass-through holder.
  const a = (agreement as unknown as Record<string, unknown>) ?? {};
  const nested = (a.agreement_json as Record<string, unknown> | undefined) ?? a;
  const primaryResolver = (nested.primary_resolver as string | undefined) ?? null;
  const fallbackResolver = (nested.fallback_resolver as string | undefined) ?? null;
  const primaryFee = (nested.primary_resolver_fee as number | undefined) ?? null;
  const fallbackFee = (nested.fallback_resolver_fee as number | undefined) ?? null;
  const hasNominated = Boolean(primaryResolver || fallbackResolver);

  useEffect(() => {
    let cancelled = false;
    const base = (rpcUrl ?? 'http://127.0.0.1:38300').replace(/\/+$/, '');
    const url = `${base}/resolvers/list?limit=20`;
    // The /resolvers/list endpoint is public per SETTLEMENT-DEV.md so
    // no bearer header is required. If iriumd has not yet shipped the
    // endpoint, the fetch returns 404 - we degrade gracefully by
    // showing only the nominated resolvers.
    fetch(url, { method: 'GET' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: unknown) => {
        if (cancelled) return;
        // Best-effort shape detection - the endpoint returns either a
        // bare array or an object with a `resolvers` field, depending
        // on the iriumd version.
        const arr = Array.isArray(data)
          ? data
          : (data as { resolvers?: unknown })?.resolvers;
        const norm = Array.isArray(arr) ? (arr as RegisteredResolver[]) : [];
        setRegistry(norm);
        setRegistryError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setRegistryError(e instanceof Error ? e.message : String(e));
        setRegistry([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rpcUrl]);

  return (
    <TradingModal
      open={true}
      onClose={onClose}
      title={
        <span className="inline-flex items-center gap-2">
          <Scale size={15} className="text-[#f0b90b]" />
          Resolver selection
        </span>
      }
      size="lg"
    >
      <div className="space-y-4">

        <div className="text-xs" style={{ color: 'rgba(238,240,255,0.65)', lineHeight: 1.6 }}>
          A resolver is a verified third party who decides who gets the IRM when buyer and
          seller cannot agree. The resolver earns a small fee, deducted from the disputed
          amount when the trade settles.
        </div>

        {/* Nominated resolvers section - what the original agreement
            already picked. These act first; the fallback steps in only
            if the primary does not respond within the dispute window. */}
        <div>
          <div className="text-[11px] uppercase tracking-wide font-display font-semibold mb-2" style={{ color: 'rgba(238,240,255,0.55)' }}>
            Resolvers nominated for this trade
          </div>
          {hasNominated ? (
            <div className="space-y-2">
              {primaryResolver && (
                <div
                  className="rounded p-3 space-y-1"
                  style={{
                    background: 'rgba(34,197,94,0.06)',
                    border: '1px solid rgba(34,197,94,0.25)',
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="inline-flex items-center gap-2">
                      <Shield size={12} style={{ color: '#22c55e' }} />
                      <span className="text-[10px] uppercase tracking-wide" style={{ color: '#22c55e' }}>Primary</span>
                    </div>
                    <span className="text-[11px]" style={{ color: 'rgba(238,240,255,0.55)' }}>
                      Fee: {formatFeeIrm(primaryFee)}
                    </span>
                  </div>
                  <div className="text-xs" style={{ fontFamily: '"JetBrains Mono", monospace', color: '#eef0ff' }} title={primaryResolver}>
                    {shortAddr(primaryResolver)}
                  </div>
                </div>
              )}
              {fallbackResolver && (
                <div
                  className="rounded p-3 space-y-1"
                  style={{
                    background: 'rgba(110,198,255,0.06)',
                    border: '1px solid rgba(110,198,255,0.25)',
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="inline-flex items-center gap-2">
                      <Shield size={12} style={{ color: '#6EC6FF' }} />
                      <span className="text-[10px] uppercase tracking-wide" style={{ color: '#6EC6FF' }}>Fallback</span>
                    </div>
                    <span className="text-[11px]" style={{ color: 'rgba(238,240,255,0.55)' }}>
                      Fee: {formatFeeIrm(fallbackFee)}
                    </span>
                  </div>
                  <div className="text-xs" style={{ fontFamily: '"JetBrains Mono", monospace', color: '#eef0ff' }} title={fallbackResolver}>
                    {shortAddr(fallbackResolver)}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div
              className="rounded p-3 text-xs"
              style={{
                background: 'rgba(252,211,77,0.06)',
                border: '1px solid rgba(252,211,77,0.20)',
                color: 'rgba(238,240,255,0.65)',
                lineHeight: 1.5,
              }}
            >
              This trade was created without nominated resolvers. Both parties can co-sign a
              fresh nomination from the wallet's resolver re-nomination flow before any
              resolver below can act.
            </div>
          )}
        </div>

        {/* Registered-resolver feed - candidates the parties can pick
            from when re-nominating. Pulled from GET /resolvers/list. */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] uppercase tracking-wide font-display font-semibold" style={{ color: 'rgba(238,240,255,0.55)' }}>
              Available resolvers
            </div>
            {loading && (
              <Loader2 size={11} className="animate-spin" style={{ color: 'rgba(238,240,255,0.55)' }} />
            )}
          </div>

          {registryError && !loading && (
            <div
              className="rounded p-3 text-xs mb-2"
              style={{
                background: 'rgba(252,211,77,0.06)',
                border: '1px solid rgba(252,211,77,0.20)',
                color: 'rgba(238,240,255,0.65)',
                lineHeight: 1.5,
              }}
            >
              The resolver registry endpoint is not reachable on this node ({registryError}).
              Use the resolver re-nomination flow from your wallet to discover candidates
              directly via the resolver-list CLI.
            </div>
          )}

          {!loading && registry && registry.length === 0 && !registryError && (
            <div className="text-xs" style={{ color: 'rgba(238,240,255,0.45)' }}>
              No resolvers have registered on this node yet. Resolvers register by calling
              <code style={{ marginLeft: 4 }}>irium-wallet resolver-register</code> after
              their address has appeared in a recent coinbase output.
            </div>
          )}

          {!loading && registry && registry.length > 0 && (
            <div className="space-y-2">
              {registry.map((r) => (
                <div
                  key={r.resolver_address}
                  className="rounded p-3 space-y-1"
                  style={{
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display font-semibold text-sm" style={{ color: '#eef0ff' }}>
                      {r.display_name || 'Unnamed resolver'}
                    </span>
                    <StarRow stars={r.reputation_stars} />
                  </div>
                  {r.bio && (
                    <div className="text-[11px]" style={{ color: 'rgba(238,240,255,0.55)', lineHeight: 1.4 }}>
                      {r.bio}
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 text-[11px]" style={{ color: 'rgba(238,240,255,0.55)' }}>
                    <span style={{ fontFamily: '"JetBrains Mono", monospace' }} title={r.resolver_address}>
                      {shortAddr(r.resolver_address)}
                    </span>
                    <span>
                      Fee: {typeof r.fee_bps_self_quoted === 'number'
                        ? `${(r.fee_bps_self_quoted / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`
                        : '-'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div
          className="rounded p-3 text-xs inline-flex items-start gap-2"
          style={{
            background: 'rgba(110,198,255,0.06)',
            border: '1px solid rgba(110,198,255,0.20)',
          }}
        >
          <ExternalLink size={11} style={{ color: '#6EC6FF', flexShrink: 0, marginTop: 2 }} />
          <div style={{ color: 'rgba(238,240,255,0.72)', lineHeight: 1.5 }}>
            Use the Agreements page to submit additional evidence to the resolver and to
            watch the dispute resolution unfold. Both parties can submit evidence at any
            time before the resolver decides.
          </div>
        </div>

        <div className="flex justify-end">
          <button onClick={onClose} className="btn-secondary px-4 py-1.5 text-xs">
            Close
          </button>
        </div>
      </div>
    </TradingModal>
  );
}
