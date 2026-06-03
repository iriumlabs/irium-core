import { useStore } from '../../../../lib/store';
import type { SwapPairConfig } from '../pairs/types';

export interface PairAvailability {
  available: boolean;
  reason: string | null;
  // Populated when the pair is chain-gated (activationHeight set and not yet
  // reached). Components use this to render a countdown chip / overlay.
  blocksUntilActive?: number;
  activationHeight?: number;
}

// Estimate the wall-clock time until `blocks` more blocks are mined. The
// network targets V2 block time = 120s after the activation fork, so 2 min
// per block is the right multiplier for any future-dated countdown.
const SECONDS_PER_BLOCK_V2 = 120;

export function formatBlocksRemaining(blocks: number): string {
  if (blocks <= 0) return 'live';
  const totalSec = blocks * SECONDS_PER_BLOCK_V2;
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  if (hours >= 48) return `~${Math.round(hours / 24)} days`;
  if (hours >= 1) return `~${hours}h ${minutes}m`;
  if (minutes >= 1) return `~${minutes}m`;
  return `~${totalSec}s`;
}

// Pure helper used by both the hook and PairSwitcher (which iterates pairs
// and can't call the hook per-row).
export function pairAvailability(pair: SwapPairConfig, tipHeight: number): PairAvailability {
  if (!pair.available) {
    return {
      available: false,
      reason: pair.comingSoonReason ?? 'This trading pair is not available yet.',
    };
  }
  if (pair.activationHeight && tipHeight > 0 && tipHeight < pair.activationHeight) {
    const blocksUntilActive = pair.activationHeight - tipHeight;
    return {
      available: false,
      reason: `Activates at block ${pair.activationHeight.toLocaleString()}. ${blocksUntilActive.toLocaleString()} blocks remaining (${formatBlocksRemaining(blocksUntilActive)} at 2 min per block).`,
      blocksUntilActive,
      activationHeight: pair.activationHeight,
    };
  }
  return { available: true, reason: null };
}

// Tiny derive so consumers don't have to remember which field carries the
// reason text and avoid spreading the "available ? ... : ..." check across
// the codebase.
export function usePairAvailability(pair: SwapPairConfig): PairAvailability {
  const tipHeight = useStore((s) => s.nodeStatus?.height ?? 0);
  return pairAvailability(pair, tipHeight);
}
