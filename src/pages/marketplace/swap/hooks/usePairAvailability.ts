import type { SwapPairConfig } from '../pairs/types';

export interface PairAvailability {
  available: boolean;
  reason: string | null;
}

// Tiny derive so consumers don't have to remember which field carries the
// reason text and avoid spreading the "available ? ... : ..." check across
// the codebase.
export function usePairAvailability(pair: SwapPairConfig): PairAvailability {
  if (pair.available) {
    return { available: true, reason: null };
  }
  return {
    available: false,
    reason: pair.comingSoonReason ?? 'This trading pair is not available yet.',
  };
}
