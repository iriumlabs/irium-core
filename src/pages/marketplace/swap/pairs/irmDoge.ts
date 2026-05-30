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

// Coming-soon IRM / Dogecoin pair. Dogecoin's 1-minute target block time
// makes 6 confirmations land in ~6 minutes, the fastest of the planned
// pairs. This file becomes the live config once the Dogecoin proof relay
// ships.

const NOT_AVAILABLE_MESSAGE =
  'This trading pair is not available yet. The Dogecoin proof relay is still in development.';

const irm: AssetDescriptor = {
  code: 'IRM',
  name: 'Iriumcoin',
  decimals: 8,
};

const doge: AssetDescriptor = {
  code: 'DOGE',
  name: 'Dogecoin',
  decimals: 8,
  network: 'Dogecoin mainnet (~1 min blocks)',
};

function notReady<T>(): Promise<T> {
  return Promise.reject(new Error(NOT_AVAILABLE_MESSAGE));
}

export const irmDogePair: SwapPairConfig = {
  id: 'IRM_DOGE',
  label: 'IRM / DOGE',
  longLabel: 'Iriumcoin / Dogecoin',
  base: irm,
  quote: doge,
  available: false,
  comingSoonReason: 'Dogecoin SPV relay coming soon',

  accent: {
    primary: '#C2A633',
    glow: 'rgba(194,166,51,0.12)',
    text: '#E5CA60',
  },

  paymentInstructionsHelp:
    'Dogecoin trading will route payments through a verifiable proof relay. Address fields are disabled until the relay is live.',

  validateForeignAddress: () => ({
    valid: false,
    reason: NOT_AVAILABLE_MESSAGE,
  }),
  parseQuoteToSmallest: () => null,
  formatQuoteAmount: (smallest: number) => {
    // Dogecoin uses 8 decimals like Bitcoin / Litecoin.
    const whole = Math.floor(smallest / 100_000_000);
    const frac = (smallest % 100_000_000).toString().padStart(8, '0');
    return `${whole}.${frac} DOGE`;
  },
  formatPrice: (dogePerIrm: number) => {
    if (!Number.isFinite(dogePerIrm) || dogePerIrm <= 0) return '— DOGE / IRM';
    return `${dogePerIrm.toFixed(8)} DOGE / IRM`;
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
