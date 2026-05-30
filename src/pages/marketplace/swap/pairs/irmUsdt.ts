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

// Coming-soon IRM / USDT pair. The pair shows up in the switcher so users
// can see what is on the roadmap, but every RPC call rejects with a plain
// English message. Once the cross-chain proof layer ships, this file
// becomes a live config and nothing else changes.

const NOT_AVAILABLE_MESSAGE =
  'This trading pair is not available yet. The cross-chain proof layer is still in development.';

const irm: AssetDescriptor = {
  code: 'IRM',
  name: 'Iriumcoin',
  decimals: 8,
};

const usdt: AssetDescriptor = {
  code: 'USDT',
  name: 'Tether USD',
  decimals: 6,
  network: 'Tron (TRC-20)',
};

function notReady<T>(): Promise<T> {
  return Promise.reject(new Error(NOT_AVAILABLE_MESSAGE));
}

export const irmUsdtPair: SwapPairConfig = {
  id: 'IRM_USDT',
  label: 'IRM / USDT',
  longLabel: 'Iriumcoin / Tether USD',
  base: irm,
  quote: usdt,
  available: false,
  comingSoonReason: 'Cross-chain proof layer required',

  accent: {
    primary: '#26A17B',
    glow: 'rgba(38,161,123,0.10)',
    text: '#34D399',
  },

  paymentInstructionsHelp:
    'USDT trading will use the cross-chain proof layer. Address fields are disabled until the upgrade lands.',

  validateForeignAddress: () => ({
    valid: false,
    reason: NOT_AVAILABLE_MESSAGE,
  }),
  parseQuoteToSmallest: () => null,
  formatQuoteAmount: (smallest: number) => {
    const whole = Math.floor(smallest / 1_000_000);
    const frac = (smallest % 1_000_000).toString().padStart(6, '0');
    return `${whole}.${frac} USDT`;
  },
  formatPrice: (usdtPerIrm: number) => {
    if (!Number.isFinite(usdtPerIrm) || usdtPerIrm <= 0) return '— USDT / IRM';
    return `${usdtPerIrm.toFixed(6)} USDT / IRM`;
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
