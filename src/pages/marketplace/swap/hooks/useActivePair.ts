import { createContext, useContext } from 'react';
import type { SwapPairConfig } from '../pairs/types';
import { defaultPair } from '../pairs';

// Active-pair context lives in the SwapPanel and is consumed everywhere
// below it. Single source of truth for the currently-selected pair so
// PairOrderBook, PriceChart, MySwapsPanel etc. always agree.

export interface ActivePairContextValue {
  pair: SwapPairConfig;
  setPairById: (id: string) => void;
  allPairs: SwapPairConfig[];
}

export const ActivePairContext = createContext<ActivePairContextValue | null>(null);

export function useActivePair(): ActivePairContextValue {
  const ctx = useContext(ActivePairContext);
  if (!ctx) {
    // Safe fallback so unit-test renders without the provider don't crash.
    return {
      pair: defaultPair(),
      setPairById: () => undefined,
      allPairs: [],
    };
  }
  return ctx;
}
