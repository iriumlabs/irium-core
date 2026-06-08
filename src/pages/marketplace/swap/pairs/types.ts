// Pair-agnostic types for the Swap marketplace. Every component talks to
// trading pairs through this interface — never against a BTC-specific
// shape. Adding a new pair (e.g. IRM/USDT once the APV Layer ships) is a
// matter of writing a new SwapPairConfig and registering it in pairs/index.ts.
// No component code should change to add a pair.

export type SwapDirection = 'sell_irm' | 'buy_irm';

export type SwapSortKey = 'price_asc' | 'price_desc' | 'recent';

export interface AssetDescriptor {
  // Short canonical symbol shown on rows ("IRM", "BTC", "USDT").
  code: string;
  // Friendly display name shown in tooltips and chrome ("Iriumcoin", "Bitcoin", "Tether USD").
  name: string;
  // Number of decimal places the user sees when entering or reading amounts.
  decimals: number;
  // Optional network qualifier shown on the address help line (e.g. "Bitcoin mainnet",
  // "TRC-20", "ERC-20"). The Swap UI surfaces this so the user does not paste a
  // wrong-network address.
  network?: string;
}

// Inputs the wallet needs to publish a new order. The pair config's
// postOrder method translates this neutral shape into whatever the
// pair-specific RPC expects.
export interface PostOrderInput {
  direction: SwapDirection;
  irm_amount: string;                      // human IRM, e.g. "1.00000000"
  quote_amount_smallest: number;           // smallest pair unit, e.g. sats for BTC
  maker_iriumd_address: string;            // local Irium address that signs / receives IRM
  maker_foreign_address: string;           // address on the foreign chain that receives the quote leg
  confirmations_required: number;          // confirmations on the foreign chain before claim is valid
  expiry_blocks_from_now: number;          // Irium-side expiry, in blocks
  expected_hash_hex?: string;              // only required for buy-IRM orders
  fee_per_byte?: number;
  broadcast?: boolean;
}

export interface CancelOrderInput {
  order_txid: string;
  order_vout: number;
  destination_address: string;
  fee_per_byte?: number;
  broadcast?: boolean;
}

export interface FillOrderInput {
  order_txid: string;
  order_vout: number;
  taker_iriumd_address: string;
  taker_foreign_address?: string;
  timeout_blocks_from_now: number;
  fee_per_byte?: number;
  broadcast?: boolean;
}

export interface SweepOrderInput {
  order_txid: string;
  order_vout: number;
  fee_per_byte?: number;
  broadcast?: boolean;
}

export interface ListOrdersParams {
  direction?: SwapDirection | 'both';
  min_irm?: number;
  max_irm?: number;
  min_quote_smallest?: number;
  max_quote_smallest?: number;
  limit?: number;
  offset?: number;
  sort?: SwapSortKey;
}

// Neutral row shape every component renders. Pair configs are responsible
// for mapping the raw RPC response into this shape.
export interface SwapOrderRow {
  outpoint: { txid: string; vout: number };
  order_id: string;
  direction: SwapDirection;
  irm_amount_human: string;                // already formatted, e.g. "1.00000000"
  irm_amount_sats: number;                 // raw IRM in sats for sort/filter
  quote_amount_smallest: number;           // raw foreign-leg amount in its smallest unit
  quote_amount_human: string;              // pre-formatted, e.g. "0.00050000 BTC"
  implied_quote_per_irm: number;           // e.g. 0.00050000 BTC per IRM
  implied_quote_per_irm_human: string;     // formatted price string
  maker_iriumd_address: string;
  maker_foreign_address: string;
  confirmations_required: number;
  expiry_height: number;
  opened_at_height: number;
  locked_value_sats: number;
  expected_hash_hex: string | null;
}

export interface ListOrdersResult {
  orders: SwapOrderRow[];
  total_open: number;
}

// Time-series sample used by the price chart. One sample = one observation
// of the implied mid-market price for the pair.
export interface PriceSample {
  ts_ms: number;
  price: number;
}

// Standard return shape for every post / cancel / fill / sweep call so
// the caller can render the same success / error toast regardless of pair.
export interface SwapTxResult {
  txid?: string;
  accepted: boolean;
  raw_tx_hex?: string;
  expected_foreign_payment_address?: string;
  expected_foreign_amount_smallest?: number;
  expected_foreign_op_return_payload_hex?: string;
  new_swap_outpoint?: { txid: string; vout: number };
  order_outpoint?: { txid: string; vout: number };
  order_id_hex?: string;
  expiry_height?: number;
  raw?: unknown;
}

// Per-pair RPC bindings. The live IRM/BTC pair wires these to the
// concrete rpcCall.* methods; coming-soon pairs reject every call.
export interface SwapPairRpc {
  postOrder(input: PostOrderInput): Promise<SwapTxResult>;
  listOrders(params?: ListOrdersParams): Promise<ListOrdersResult>;
  getOrder(txid: string, vout: number): Promise<SwapOrderRow | null>;
  cancelOrder(input: CancelOrderInput): Promise<SwapTxResult>;
  fillOrder(input: FillOrderInput): Promise<SwapTxResult>;
  sweepExpiredOrder(input: SweepOrderInput): Promise<SwapTxResult>;
}

// Full configuration for one trading pair. Everything pair-specific lives
// here so components stay generic.
export interface SwapPairConfig {
  // Stable identifier used in URLs / persistence / registry lookups.
  id: string;                              // "IRM_BTC" | "IRM_USDT" | ...
  // Short label on the pair switcher pill ("IRM / BTC").
  label: string;
  // Longer name shown in tooltips and the panel header ("Iriumcoin / Bitcoin").
  longLabel: string;
  // Base asset is always Irium — included for symmetry / display.
  base: AssetDescriptor;
  // The foreign side of the pair.
  quote: AssetDescriptor;

  // Availability gate. When false, the panel shows a Coming Soon overlay
  // and the pair config's rpc methods all reject.
  available: boolean;
  // Short one-line reason shown on the overlay when available=false.
  // Plain English. No technical jargon.
  comingSoonReason?: string;
  // Optional consensus activation height. When set, the pair is treated as
  // unavailable until the local chain tip reaches this height. Used for
  // LTC which is a post-fork rollout. BTC and USDT leave this undefined.
  activationHeight?: number;

  // UI accent color for chrome, pill highlights, chart lines.
  accent: {
    primary: string;   // headline / button background hue
    glow: string;      // soft background tint
    text: string;      // foreground on dark
  };

  // Plain-English help text shown next to the maker payment-address input.
  paymentInstructionsHelp: string;

  // Address validation for the foreign side. Used to refuse paste of a
  // wrong-network address before the user posts.
  validateForeignAddress(address: string): { valid: boolean; reason?: string };

  // Convert a human input like "0.00050000" (BTC) to the chain's smallest
  // unit (sats). Returns null when input is empty / unparseable.
  parseQuoteToSmallest(input: string): number | null;

  // Format a smallest-unit integer back to a human string with the unit
  // suffix. Example for BTC: 50000 -> "0.00050000 BTC".
  formatQuoteAmount(smallest: number): string;

  // Format an implied price (foreign per IRM) as a price tag.
  formatPrice(quotePerIrm: number): string;

  // Pair-specific RPC layer. Coming-soon pairs reject all calls.
  rpc: SwapPairRpc;
}
