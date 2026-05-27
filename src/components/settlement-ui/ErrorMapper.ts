// ErrorMapper — maps backend Rust error strings into stable i18n keys that
// render as plain English (or localized) sentences. Every catch block in
// the new settlement UI should pipe through `mapErrorToKey(e, ctx)` so
// users never see raw Rust panics or RPC error JSON.
//
// The function returns an i18n KEY (string) — call sites resolve it via
// `t(mapErrorToKey(e, ctx))`. Keys live under `settlement_ui.errors.*` so
// they survive locale switches.

export type ErrorContext =
  | 'create'      // creating an agreement
  | 'fund'        // funding the HTLC
  | 'release'    // releasing funds to recipient
  | 'refund'     // claiming refund
  | 'pack'        // building the deal code
  | 'unpack'     // importing a deal code
  | 'dispute'    // raising / responding to a dispute
  | 'proof'      // submitting / creating a proof
  | 'status'     // fetching status
  | 'generic';

// Each pattern matches a phrase the Rust error string is known to
// contain. The order matters — first match wins, so more specific
// patterns must come before more generic ones.
interface Pattern {
  re: RegExp;
  key: string;
}

const SHARED_PATTERNS: Pattern[] = [
  // Connectivity
  { re: /node is not running|connection refused|ECONNREFUSED|failed to connect/i, key: 'settlement_ui.errors.node_offline' },
  { re: /timed out|timeout/i,                                                       key: 'settlement_ui.errors.network_timeout' },
  { re: /401|unauthorized|invalid token|bad bearer/i,                               key: 'settlement_ui.errors.auth_failed' },

  // Funding-side
  { re: /insufficient funds|not enough/i,                                           key: 'settlement_ui.errors.insufficient_funds' },
  { re: /coinbase immature|coinbase not mature/i,                                   key: 'settlement_ui.errors.coinbase_immature' },
  { re: /mempool conflict|double[- ]spend/i,                                        key: 'settlement_ui.errors.double_spend' },

  // Agreement state
  { re: /already (funded|released|refunded|expired)/i,                              key: 'settlement_ui.errors.already_settled' },
  { re: /timeout not reached|cannot refund yet/i,                                   key: 'settlement_ui.errors.refund_not_ready' },
  { re: /policy not satisfied|proof not final|proof_not_satisfied/i,                key: 'settlement_ui.errors.release_not_ready' },
  { re: /agreement (hash|id) mismatch|wrong agreement/i,                            key: 'settlement_ui.errors.agreement_mismatch' },
  { re: /expired|deadline passed|trade.* expired/i,                                 key: 'settlement_ui.errors.expired' },

  // HTLC / preimage
  { re: /preimage|secret hash|wrong secret/i,                                       key: 'settlement_ui.errors.bad_secret' },

  // Address / format
  { re: /invalid address|bad address|address checksum/i,                            key: 'settlement_ui.errors.bad_address' },
  { re: /parse error|invalid json|malformed/i,                                      key: 'settlement_ui.errors.bad_format' },

  // Deal code IO
  { re: /not allowed by the scope|fs.scope|permission denied/i,                     key: 'settlement_ui.errors.fs_blocked' },
  { re: /no such file|enoent|cannot find/i,                                         key: 'settlement_ui.errors.file_missing' },
];

const CONTEXT_PATTERNS: Partial<Record<ErrorContext, Pattern[]>> = {
  pack: [
    { re: /no such agreement|agreement not found/i, key: 'settlement_ui.errors.pack_not_found' },
  ],
  unpack: [
    { re: /signature.*invalid|verify.* failed/i,    key: 'settlement_ui.errors.unpack_signature_invalid' },
  ],
  dispute: [
    { re: /already disputed|duplicate dispute/i,    key: 'settlement_ui.errors.dispute_duplicate' },
    { re: /not a party|signer.*mismatch/i,          key: 'settlement_ui.errors.dispute_not_party' },
  ],
};

// Convert anything (Error, string, unknown) into a single-line string for
// pattern matching. Truncates after 1000 chars to keep matching cheap.
function toMessage(err: unknown): string {
  if (!err) return '';
  if (err instanceof Error) return err.message.slice(0, 1000);
  if (typeof err === 'string') return err.slice(0, 1000);
  try { return JSON.stringify(err).slice(0, 1000); } catch { return String(err).slice(0, 1000); }
}

// Returns an i18n key. Caller does `toast.error(t(mapErrorToKey(e, 'fund')))`.
export function mapErrorToKey(err: unknown, ctx: ErrorContext = 'generic'): string {
  const msg = toMessage(err);
  if (!msg) return 'settlement_ui.errors.generic';

  const ctxPatterns = CONTEXT_PATTERNS[ctx] ?? [];
  for (const p of ctxPatterns) {
    if (p.re.test(msg)) return p.key;
  }
  for (const p of SHARED_PATTERNS) {
    if (p.re.test(msg)) return p.key;
  }
  return 'settlement_ui.errors.generic';
}

// Convenience: returns the raw message verbatim. Useful for the
// TechnicalDetails block where power users want to see the actual error.
export function rawErrorMessage(err: unknown): string {
  return toMessage(err);
}
