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

// Coming-soon IRM / Litecoin pair. Litecoin uses ~2.5 min blocks so 6
// confirmations land in roughly 15 min — faster than Bitcoin's hour. Once
// the Litecoin SPV header relay is live this file becomes the live config
// and nothing else changes.

const NOT_AVAILABLE_MESSAGE =
  'This trading pair is not available yet. The Litecoin proof relay is still in development.';

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

function notReady<T>(): Promise<T> {
  return Promise.reject(new Error(NOT_AVAILABLE_MESSAGE));
}

export const irmLtcPair: SwapPairConfig = {
  id: 'IRM_LTC',
  label: 'IRM / LTC',
  longLabel: 'Iriumcoin / Litecoin',
  base: irm,
  quote: ltc,
  available: false,
  comingSoonReason: 'Litecoin SPV relay coming soon',

  accent: {
    primary: '#345D9D',
    glow: 'rgba(52,93,157,0.12)',
    text: '#7CACE0',
  },

  paymentInstructionsHelp:
    'Litecoin trading will route payments through a verifiable proof relay. Address fields are disabled until the relay is live.',

  validateForeignAddress: () => ({
    valid: false,
    reason: NOT_AVAILABLE_MESSAGE,
  }),
  parseQuoteToSmallest: () => null,
  formatQuoteAmount: (smallest: number) => {
    // Litecoin uses 8 decimals — same as Bitcoin's sats accounting.
    const whole = Math.floor(smallest / 100_000_000);
    const frac = (smallest % 100_000_000).toString().padStart(8, '0');
    return `${whole}.${frac} LTC`;
  },
  formatPrice: (ltcPerIrm: number) => {
    if (!Number.isFinite(ltcPerIrm) || ltcPerIrm <= 0) return '— LTC / IRM';
    return `${ltcPerIrm.toFixed(8)} LTC / IRM`;
  },

  rpc: {
    postOrder: (_input: PostOrderInput): Promise<SwapTxResult> => notReady<SwapTxResult>(),
    listOrders: async (_params?: ListOrdersParams): Promise<ListOrdersResult> => ({
      orders: [],
      total_open: 0,
    }),
    getOrder: (_txid: string, _vout: number): Promise<SwapOrderRow | null> =>
      Promise.resolve(null),
    cancelOrder: (_input: CancelOrderInput): Promise<SwapTxResult> => notReady<SwapTxResult>(),
    fillOrder: (_input: FillOrderInput): Promise<SwapTxResult> => notReady<SwapTxResult>(),
    sweepExpiredOrder: (_input: SweepOrderInput): Promise<SwapTxResult> => notReady<SwapTxResult>(),
  },
};
