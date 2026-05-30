import { irmBtcPair } from './irmBtc';
import { irmUsdtPair } from './irmUsdt';
import type { SwapPairConfig } from './types';

// Master registry. The order here is the order shown in the PairSwitcher.
// Add a new pair: import its config and append it. No component changes.
export const SWAP_PAIRS: SwapPairConfig[] = [irmBtcPair, irmUsdtPair];

export const DEFAULT_PAIR_ID = irmBtcPair.id;

export function getPairById(id: string): SwapPairConfig | undefined {
  return SWAP_PAIRS.find((p) => p.id === id);
}

export function defaultPair(): SwapPairConfig {
  return SWAP_PAIRS.find((p) => p.available) ?? SWAP_PAIRS[0];
}

export type { SwapPairConfig } from './types';
