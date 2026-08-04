import React from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, Loader2 } from 'lucide-react';
import { useStore } from '../lib/store';

// PoAW-X (Proof of Assigned Work, eXtended) activated on Irium mainnet at this height.
// See the irium-source submodule, `MAINNET_POAWX_ACTIVATION_HEIGHT`. This is a HISTORICAL
// fact about the network, not a local setting: mainnet passed it long ago.
const POAWX_ACTIVATION_HEIGHT = 50000;

/**
 * PoAW-X activation status.
 *
 * PREVIOUS BEHAVIOUR AND WHY IT WAS WRONG. This component used to compute
 * `remaining = POAWX_ACTIVATION_HEIGHT - height` from the node's LOCAL connected height and
 * render a pre-activation countdown whenever that was positive. Local height is a statement
 * about how far THIS node has synced, not about where the network is — so a node that had
 * connected no blocks (height 0) rendered:
 *
 *     "50000 blocks until PoAW-X activation — activates at block 50,000 (now 0).
 *      Make sure your node is on v1.9.119 or later before then."
 *
 * on a network whose tip was 66,000+. Every part of that is false, and it sent users chasing
 * an activation that happened months earlier instead of the real problem (their node had not
 * synced). It also pinned advice — "v1.9.119 or later" — that went stale across the
 * 61,414 / 62,236 / 64,465 / 66,179 activations.
 *
 * The fix separates the two questions the old code fused:
 *   1. Has the NETWORK activated?  Answer from `network_tip`, the peer-advertised header tip,
 *      which a node learns from a handshake long before it connects any block.
 *   2. Has THIS NODE caught up?    Answer from `height` vs `network_tip`, reported as sync
 *      progress — never as a claim about consensus.
 *
 * When we genuinely know nothing about the network (no tip yet), the banner renders nothing
 * rather than inventing a countdown from a height of zero.
 */
export default function PoawxActivationBanner() {
  const { t } = useTranslation();
  const nodeStatus = useStore((s) => s.nodeStatus);
  const height = nodeStatus?.height;
  const networkTip = nodeStatus?.network_tip;

  // Nothing known yet: node offline, not polled, or handshaked but no header tip. A height of
  // 0 with no tip is "we know nothing", NOT "the chain is at block 0" — rendering anything
  // here is what produced the false countdown.
  if (height == null) return null;
  if (!networkTip || networkTip <= 0) return null;

  // Consensus state comes from the NETWORK tip only.
  const networkActivated = networkTip >= POAWX_ACTIVATION_HEIGHT;
  // Sync state is a separate axis. Mirrors the 10-block tolerance used by the node-status
  // poller's `synced` computation so the two cannot disagree.
  const behind = Math.max(0, networkTip - height);
  const caughtUp = behind <= 10;

  // The network is past activation (the only case on mainnet today) but we are still syncing.
  // Report the SYNC gap — do not imply anything about activation.
  if (networkActivated && !caughtUp) {
    return (
      <div className="mx-4 mt-3 rounded-lg p-3 flex items-center gap-2.5 border border-amber-500/40 bg-amber-500/10 text-amber-200 text-sm">
        <Loader2 size={16} className="text-amber-400 flex-shrink-0 animate-spin" />
        <div className="flex-1 min-w-0">
          <strong className="text-amber-100">
            {t('poawx_banner.syncing_title', {
              defaultValue: 'Syncing — {{behind}} blocks behind the network',
              behind: behind.toLocaleString(),
            })}
          </strong>{' '}
          <span className="text-amber-200/80">
            {t('poawx_banner.syncing_body', {
              defaultValue:
                'PoAW-X consensus is already active on the network (since block 50,000). Your node is at {{height}} of {{tip}} and is still catching up.',
              height: height.toLocaleString(),
              tip: networkTip.toLocaleString(),
            })}
          </span>
        </div>
      </div>
    );
  }

  // Synced, and the network is past activation.
  if (networkActivated) {
    return (
      <div className="mx-4 mt-3 rounded-lg p-3 flex items-center gap-2.5 border border-indigo-500/40 bg-indigo-500/10 text-indigo-200 text-sm">
        <Zap size={16} className="text-indigo-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <strong className="text-indigo-100">
            {t('poawx_banner.active_title', { defaultValue: 'PoAW-X consensus is active' })}
          </strong>{' '}
          <span className="text-indigo-200/80">
            {t('poawx_banner.active_body', {
              defaultValue:
                'Proof of Assigned Work, eXtended — VRF-selected block proposers are live (activated at block 50,000).',
            })}
          </span>
        </div>
      </div>
    );
  }

  // Genuinely pre-activation: we have a real network tip and it is below the activation
  // height. Unreachable on mainnet today; retained so the component stays correct on a
  // network that has not yet crossed it (devnet/testnet), and so the countdown is driven by
  // the NETWORK tip rather than local sync progress.
  const remaining = POAWX_ACTIVATION_HEIGHT - networkTip;
  return (
    <div className="mx-4 mt-3 rounded-lg p-3 flex items-center gap-2.5 border border-indigo-500/40 bg-indigo-500/10 text-indigo-200 text-sm">
      <Zap size={16} className="text-indigo-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <strong className="text-indigo-100">
          {t('poawx_banner.title', {
            defaultValue: '{{blocks}} blocks until PoAW-X activation',
            blocks: remaining.toLocaleString(),
          })}
        </strong>{' '}
        <span className="text-indigo-200/80">
          {t('poawx_banner.body', {
            defaultValue:
              'The PoAW-X consensus upgrade activates at block 50,000 (network is at {{tip}}).',
            tip: networkTip.toLocaleString(),
          })}
        </span>
      </div>
    </div>
  );
}
