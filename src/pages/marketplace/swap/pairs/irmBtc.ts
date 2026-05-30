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

// Live IRM / Bitcoin pair. All RPC calls go through rpcCall.* — see
// src/lib/tauri.ts for the wire contracts. The pair config translates the
// pair-agnostic interface into Bitcoin-specific argument names.

const SATS_PER_BTC = 100_000_000;
const SATS_PER_IRM = 100_000_000;

const irm: AssetDescriptor = {
  code: 'IRM',
  name: 'Iriumcoin',
  decimals: 8,
};

const btc: AssetDescriptor = {
  code: 'BTC',
  name: 'Bitcoin',
  decimals: 8,
  network: 'Bitcoin mainnet',
};

function formatBtc(sats: number): string {
  const whole = Math.floor(sats / SATS_PER_BTC);
  const frac = sats % SATS_PER_BTC;
  const fracStr = frac.toString().padStart(8, '0');
  return `${whole}.${fracStr} BTC`;
}

function formatPriceBtcPerIrm(btcPerIrm: number): string {
  if (!Number.isFinite(btcPerIrm) || btcPerIrm <= 0) return '— BTC / IRM';
  // 8 decimals so dust-priced pairs still read correctly.
  return `${btcPerIrm.toFixed(8)} BTC / IRM`;
}

function parseBtcToSats(input: string): number | null {
  const cleaned = input.trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * SATS_PER_BTC);
}

function validateBtcAddress(address: string): { valid: boolean; reason?: string } {
  const trimmed = address.trim();
  if (!trimmed) {
    return { valid: false, reason: 'Address is required' };
  }
  // Loose client-side check. Final validation happens on the node when the
  // tx is built. We only screen out obviously-wrong-network input.
  if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed)) {
    return { valid: true };
  }
  if (/^bc1[a-z0-9]{8,87}$/i.test(trimmed)) {
    return { valid: true };
  }
  return {
    valid: false,
    reason: 'Does not look like a Bitcoin mainnet address',
  };
}

interface RawSwapOrderListResponse {
  orders?: RawSwapOrder[];
  total_open?: number;
}

interface RawSwapOrder {
  outpoint?: { txid?: string; vout?: number };
  order_id_hex?: string;
  direction?: 'sell_irm' | 'buy_irm';
  irm_amount?: string;
  btc_amount_sats?: number;
  implied_btc_per_irm?: string | number;
  maker_iriumd_address?: string;
  maker_btc_address?: string;
  confirmations_required?: number;
  expiry_height?: number;
  opened_at_height?: number;
  locked_value?: number;
  expected_hash_hex?: string | null;
}

function rowFromRaw(raw: RawSwapOrder): SwapOrderRow {
  const txid = raw.outpoint?.txid ?? '';
  const vout = raw.outpoint?.vout ?? 0;
  const direction = raw.direction ?? 'sell_irm';
  const irmHuman = raw.irm_amount ?? '0';
  const irmFloat = Number(irmHuman);
  const irmSats = Number.isFinite(irmFloat) ? Math.round(irmFloat * SATS_PER_IRM) : 0;
  const btcSats = raw.btc_amount_sats ?? 0;
  const impliedRaw =
    typeof raw.implied_btc_per_irm === 'string'
      ? Number(raw.implied_btc_per_irm)
      : raw.implied_btc_per_irm ?? 0;
  const implied = Number.isFinite(impliedRaw) ? impliedRaw : (irmFloat > 0 ? (btcSats / SATS_PER_BTC) / irmFloat : 0);
  return {
    outpoint: { txid, vout },
    order_id: raw.order_id_hex ?? '',
    direction,
    irm_amount_human: irmHuman,
    irm_amount_sats: irmSats,
    quote_amount_smallest: btcSats,
    quote_amount_human: formatBtc(btcSats),
    implied_quote_per_irm: implied,
    implied_quote_per_irm_human: formatPriceBtcPerIrm(implied),
    maker_iriumd_address: raw.maker_iriumd_address ?? '',
    maker_foreign_address: raw.maker_btc_address ?? '',
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
      typeof r.expected_btc_payment_address === 'string' ? r.expected_btc_payment_address : undefined,
    expected_foreign_amount_smallest:
      typeof r.expected_btc_amount_sats === 'number' ? r.expected_btc_amount_sats : undefined,
    expected_foreign_op_return_payload_hex:
      typeof r.expected_btc_op_return_payload_hex === 'string'
        ? r.expected_btc_op_return_payload_hex
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

export const irmBtcPair: SwapPairConfig = {
  id: 'IRM_BTC',
  label: 'IRM / BTC',
  longLabel: 'Iriumcoin / Bitcoin',
  base: irm,
  quote: btc,
  available: true,

  accent: {
    primary: '#F7931A',
    glow: 'rgba(247,147,26,0.12)',
    text: '#FBBF24',
  },

  paymentInstructionsHelp:
    'Paste a Bitcoin mainnet address you control. The buyer will send BTC directly to this address.',

  validateForeignAddress: validateBtcAddress,
  parseQuoteToSmallest: parseBtcToSats,
  formatQuoteAmount: formatBtc,
  formatPrice: formatPriceBtcPerIrm,

  rpc: {
    async postOrder(input: PostOrderInput): Promise<SwapTxResult> {
      const raw = await rpcCall.postSwapOrder({
        direction: input.direction,
        irm_amount: input.irm_amount,
        btc_amount_sats: input.quote_amount_smallest,
        maker_iriumd_address: input.maker_iriumd_address,
        maker_btc_address: input.maker_foreign_address,
        confirmations_required: input.confirmations_required,
        expiry_blocks_from_now: input.expiry_blocks_from_now,
        expected_hash_hex: input.expected_hash_hex,
        fee_per_byte: input.fee_per_byte,
        broadcast: input.broadcast,
      });
      return txResultFromRaw(raw);
    },

    async listOrders(params?: ListOrdersParams): Promise<ListOrdersResult> {
      const raw = (await rpcCall.listSwapOrders({
        direction: params?.direction === 'both' ? undefined : params?.direction,
        min_irm: params?.min_irm,
        max_irm: params?.max_irm,
        min_btc: params?.min_quote_smallest,
        max_btc: params?.max_quote_smallest,
        limit: params?.limit,
        offset: params?.offset,
        sort: params?.sort,
      })) as RawSwapOrderListResponse;
      const orders = (raw?.orders ?? []).map(rowFromRaw);
      return { orders, total_open: raw?.total_open ?? orders.length };
    },

    async getOrder(txid: string, vout: number): Promise<SwapOrderRow | null> {
      try {
        const raw = (await rpcCall.getSwapOrder(txid, vout)) as RawSwapOrder | null;
        if (!raw) return null;
        return rowFromRaw(raw);
      } catch {
        return null;
      }
    },

    async cancelOrder(input: CancelOrderInput): Promise<SwapTxResult> {
      const raw = await rpcCall.cancelSwapOrder({
        order_txid: input.order_txid,
        order_vout: input.order_vout,
        destination_address: input.destination_address,
        fee_per_byte: input.fee_per_byte,
        broadcast: input.broadcast,
      });
      return txResultFromRaw(raw);
    },

    async fillOrder(input: FillOrderInput): Promise<SwapTxResult> {
      const raw = await rpcCall.fillSwapOrder({
        order_txid: input.order_txid,
        order_vout: input.order_vout,
        taker_iriumd_address: input.taker_iriumd_address,
        taker_btc_address: input.taker_foreign_address,
        timeout_blocks_from_now: input.timeout_blocks_from_now,
        fee_per_byte: input.fee_per_byte,
        broadcast: input.broadcast,
      });
      return txResultFromRaw(raw);
    },

    async sweepExpiredOrder(input: SweepOrderInput): Promise<SwapTxResult> {
      const raw = await rpcCall.sweepExpiredOrder({
        order_txid: input.order_txid,
        order_vout: input.order_vout,
        fee_per_byte: input.fee_per_byte,
        broadcast: input.broadcast,
      });
      return txResultFromRaw(raw);
    },
  },
};
