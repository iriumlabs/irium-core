import { rpcCall } from '../../../../lib/tauri';
import type {
  AssetDescriptor,
  CancelOrderInput,
  FillOrderInput,
  ListOrdersParams,
  ListOrdersResult,
  PostOrderInput,
  SwapOrderRow,
  SwapPairConfig,
  SwapTxResult,
  SweepOrderInput,
} from './types';

// Live IRM / Litecoin pair (Phase E). All RPC calls go through rpcCall.* —
// see src/lib/tauri.ts for the wire contracts. The pair config translates
// the pair-agnostic interface into Litecoin-specific argument names.

const SATS_PER_LTC = 100_000_000;
const SATS_PER_IRM = 100_000_000;

const irm: AssetDescriptor = {
  code: 'IRM',
  name: 'Iriumcoin',
  decimals: 8,
};

const ltc: AssetDescriptor = {
  code: 'LTC',
  name: 'Litecoin',
  decimals: 8,
  network: 'Litecoin mainnet (~2.5 min blocks)',
};

function formatLtc(sats: number): string {
  const whole = Math.floor(sats / SATS_PER_LTC);
  const frac = sats % SATS_PER_LTC;
  const fracStr = frac.toString().padStart(8, '0');
  return `${whole}.${fracStr} LTC`;
}

function formatPriceLtcPerIrm(ltcPerIrm: number): string {
  if (!Number.isFinite(ltcPerIrm) || ltcPerIrm <= 0) return '— LTC / IRM';
  return `${ltcPerIrm.toFixed(8)} LTC / IRM`;
}

function parseLtcToSats(input: string): number | null {
  const cleaned = input.trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * SATS_PER_LTC);
}

function validateLtcAddress(address: string): { valid: boolean; reason?: string } {
  const trimmed = address.trim();
  if (!trimmed) {
    return { valid: false, reason: 'Address is required' };
  }
  // Loose client-side check. Final validation happens on the node when the
  // tx is built. Litecoin mainnet legacy P2PKH starts with L (0x30 prefix)
  // and legacy P2SH starts with M (0x32) or 3 (0x05, shared with BTC).
  // bech32 P2WPKH starts with ltc1. Consensus on the node only accepts
  // P2PKH so a bech32 address will be rejected server-side with a helpful
  // error — we let it through here so users see that error instead of a
  // misleading "looks malformed" warning.
  if (/^[LM3][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed)) {
    return { valid: true };
  }
  if (/^ltc1[a-z0-9]{8,87}$/i.test(trimmed)) {
    return { valid: true };
  }
  return {
    valid: false,
    reason: 'Does not look like a Litecoin mainnet address',
  };
}

interface RawLtcSwapOrderListResponse {
  orders?: RawLtcSwapOrder[];
  total_open?: number;
}

interface RawLtcSwapOrder {
  outpoint?: { txid?: string; vout?: number };
  order_id_hex?: string;
  direction?: 'sell_irm' | 'buy_irm';
  irm_amount?: string | number;
  ltc_amount_sats?: number;
  implied_ltc_per_irm_sats?: string | number;
  maker_iriumd_address?: string;
  maker_ltc_pkh_hex?: string;
  confirmations_required?: number;
  expiry_height?: number;
  opened_at_height?: number;
  locked_value?: number;
  expected_hash_hex?: string | null;
}

function rowFromRaw(raw: RawLtcSwapOrder): SwapOrderRow {
  const txid = raw.outpoint?.txid ?? '';
  const vout = raw.outpoint?.vout ?? 0;
  const direction = raw.direction ?? 'sell_irm';
  // The iriumd LtcSwapOrder list endpoint returns irm_amount as a raw u64
  // sats integer (see iriumd.rs list_ltc_swap_orders). Treat string-ish
  // values defensively in case the wire shape evolves.
  const irmSats =
    typeof raw.irm_amount === 'number'
      ? raw.irm_amount
      : Number(raw.irm_amount ?? 0);
  const irmFloat = Number.isFinite(irmSats) ? irmSats / SATS_PER_IRM : 0;
  const irmHuman = irmFloat.toFixed(8);
  const ltcSats = raw.ltc_amount_sats ?? 0;
  const impliedRaw =
    typeof raw.implied_ltc_per_irm_sats === 'string'
      ? Number(raw.implied_ltc_per_irm_sats)
      : raw.implied_ltc_per_irm_sats ?? 0;
  const implied = Number.isFinite(impliedRaw)
    ? impliedRaw
    : irmFloat > 0
      ? (ltcSats / SATS_PER_LTC) / irmFloat
      : 0;
  return {
    outpoint: { txid, vout },
    order_id: raw.order_id_hex ?? '',
    direction,
    irm_amount_human: irmHuman,
    irm_amount_sats: Number.isFinite(irmSats) ? irmSats : 0,
    quote_amount_smallest: ltcSats,
    quote_amount_human: formatLtc(ltcSats),
    implied_quote_per_irm: implied,
    implied_quote_per_irm_human: formatPriceLtcPerIrm(implied),
    maker_iriumd_address: raw.maker_iriumd_address ?? '',
    // The list endpoint returns the LTC PKH as hex (no base58 wrapper
    // since the server cannot tell mainnet vs testnet prefix from PKH
    // alone). Surface the hex here; the UI displays it as the maker's
    // payout address and the user matches it to their off-chain
    // payment instructions.
    maker_foreign_address: raw.maker_ltc_pkh_hex ?? '',
    confirmations_required: raw.confirmations_required ?? 6,
    expiry_height: raw.expiry_height ?? 0,
    opened_at_height: raw.opened_at_height ?? 0,
    locked_value_sats: raw.locked_value ?? 0,
    expected_hash_hex: raw.expected_hash_hex ?? null,
  };
}

function txResultFromRaw(raw: unknown): SwapTxResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    txid: typeof r.txid === 'string' ? r.txid : undefined,
    accepted: r.accepted !== false,
    raw_tx_hex: typeof r.raw_tx_hex === 'string' ? r.raw_tx_hex : undefined,
    expected_foreign_payment_address:
      typeof r.expected_ltc_payment_address === 'string'
        ? r.expected_ltc_payment_address
        : undefined,
    expected_foreign_amount_smallest:
      typeof r.expected_ltc_amount_sats === 'number'
        ? r.expected_ltc_amount_sats
        : undefined,
    expected_foreign_op_return_payload_hex:
      typeof r.expected_ltc_op_return_payload_hex === 'string'
        ? r.expected_ltc_op_return_payload_hex
        : undefined,
    new_swap_outpoint:
      r.new_swap_outpoint && typeof r.new_swap_outpoint === 'object'
        ? (r.new_swap_outpoint as { txid: string; vout: number })
        : undefined,
    order_outpoint:
      r.order_outpoint && typeof r.order_outpoint === 'object'
        ? (r.order_outpoint as { txid: string; vout: number })
        : undefined,
    order_id_hex: typeof r.order_id_hex === 'string' ? r.order_id_hex : undefined,
    expiry_height: typeof r.expiry_height === 'number' ? r.expiry_height : undefined,
    raw,
  };
}

export const irmLtcPair: SwapPairConfig = {
  id: 'IRM_LTC',
  label: 'IRM / LTC',
  longLabel: 'Iriumcoin / Litecoin',
  base: irm,
  quote: ltc,
  available: true,
  // Chain-gated: consensus activates IRM/LTC swap orders at this height.
  activationHeight: 25_000,

  accent: {
    primary: '#345D9D',
    glow: 'rgba(52,93,157,0.12)',
    text: '#7CACE0',
  },

  paymentInstructionsHelp:
    'Paste a Litecoin mainnet P2PKH address you control (starts with L). The buyer will send LTC directly to this address.',

  validateForeignAddress: validateLtcAddress,
  parseQuoteToSmallest: parseLtcToSats,
  formatQuoteAmount: formatLtc,
  formatPrice: formatPriceLtcPerIrm,

  rpc: {
    async postOrder(input: PostOrderInput): Promise<SwapTxResult> {
      const raw = await rpcCall.postLtcSwapOrder({
        direction: input.direction,
        irm_amount: input.irm_amount,
        ltc_amount_sats: input.quote_amount_smallest,
        maker_iriumd_address: input.maker_iriumd_address,
        maker_ltc_address: input.maker_foreign_address,
        confirmations_required: input.confirmations_required,
        expiry_blocks_from_now: input.expiry_blocks_from_now,
        expected_hash_hex: input.expected_hash_hex,
        fee_per_byte: input.fee_per_byte,
        broadcast: input.broadcast,
      });
      return txResultFromRaw(raw);
    },

    async listOrders(params?: ListOrdersParams): Promise<ListOrdersResult> {
      const raw = (await rpcCall.listLtcSwapOrders({
        direction: params?.direction === 'both' ? undefined : params?.direction,
        min_irm: params?.min_irm,
        max_irm: params?.max_irm,
        min_ltc: params?.min_quote_smallest,
        max_ltc: params?.max_quote_smallest,
        limit: params?.limit,
        offset: params?.offset,
        sort: params?.sort,
      })) as RawLtcSwapOrderListResponse;
      const orders = (raw?.orders ?? []).map(rowFromRaw);
      return { orders, total_open: raw?.total_open ?? orders.length };
    },

    async getOrder(txid: string, vout: number): Promise<SwapOrderRow | null> {
      try {
        const raw = (await rpcCall.getLtcSwapOrder(txid, vout)) as RawLtcSwapOrder | null;
        if (!raw) return null;
        return rowFromRaw(raw);
      } catch {
        return null;
      }
    },

    async cancelOrder(input: CancelOrderInput): Promise<SwapTxResult> {
      const raw = await rpcCall.cancelLtcSwapOrder({
        order_txid: input.order_txid,
        order_vout: input.order_vout,
        destination_address: input.destination_address,
        fee_per_byte: input.fee_per_byte,
        broadcast: input.broadcast,
      });
      return txResultFromRaw(raw);
    },

    async fillOrder(input: FillOrderInput): Promise<SwapTxResult> {
      const raw = await rpcCall.fillLtcSwapOrder({
        order_txid: input.order_txid,
        order_vout: input.order_vout,
        taker_iriumd_address: input.taker_iriumd_address,
        taker_ltc_address: input.taker_foreign_address,
        timeout_blocks_from_now: input.timeout_blocks_from_now,
        fee_per_byte: input.fee_per_byte,
        broadcast: input.broadcast,
      });
      return txResultFromRaw(raw);
    },

    async sweepExpiredOrder(input: SweepOrderInput): Promise<SwapTxResult> {
      const raw = await rpcCall.sweepLtcExpiredOrder({
        order_txid: input.order_txid,
        order_vout: input.order_vout,
        fee_per_byte: input.fee_per_byte,
        broadcast: input.broadcast,
      });
      return txResultFromRaw(raw);
    },
  },
};
