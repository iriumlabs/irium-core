import { irmBtcPair } from './irmBtc';
import { irmLtcPair } from './irmLtc';
import { irmDogePair } from './irmDoge';
import { irmUsdtPair } from './irmUsdt';
import type { SwapPairConfig } from './types';

// Master registry. The order here is the order shown in the PairSwitcher.
// SPV-relay-style pairs first (BTC, LTC, DOGE — all live since iriumd
// consolidated their activations to block 24,800 in commit 338f3395 on
// iriumlabs/irium, 2026-06-03), then the USDT pair which depends on a
// different cross-chain proof layer.
// Add a new pair: import its config and append it. No component changes.
export const SWAP_PAIRS: SwapPairConfig[] = [
  irmBtcPair,
  irmLtcPair,
  irmDogePair,
  irmUsdtPair,
];

export const DEFAULT_PAIR_ID = irmBtcPair.id;

export function getPairById(id: string): SwapPairConfig | undefined {
  return SWAP_PAIRS.find((p) => p.id === id);
}

export function defaultPair(): SwapPairConfig {
  return SWAP_PAIRS.find((p) => p.available) ?? SWAP_PAIRS[0];
}

export type { SwapPairConfig } from './types';
