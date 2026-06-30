import React from 'react';
import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import { useStore } from '../lib/store';

// PoAW-X (Proof of Assigned Work, eXtended) consensus activates on Irium mainnet
// at this block height. See the irium-source submodule MAINNET_POAWX_ACTIVATION_HEIGHT.
const POAWX_ACTIVATION_HEIGHT = 50000;

/**
 * Global banner showing the PoAW-X mainnet activation countdown: how many blocks
 * remain until block 50,000, plus a short explanation of the upgrade. Reads the
 * current chain height from the node-status store and hides itself when the height
 * is unknown (node offline / not yet polled). Once activated it shows a live state.
 */
export default function PoawxActivationBanner() {
  const { t } = useTranslation();
  const nodeStatus = useStore((s) => s.nodeStatus);
  const height = nodeStatus?.height;
  if (height == null) return null;

  const remaining = POAWX_ACTIVATION_HEIGHT - height;
  const active = remaining <= 0;

  return (
    <div className="mx-4 mt-3 rounded-lg p-3 flex items-center gap-2.5 border border-indigo-500/40 bg-indigo-500/10 text-indigo-200 text-sm">
      <Zap size={16} className="text-indigo-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <strong className="text-indigo-100">
          {active
            ? t('poawx_banner.active_title', { defaultValue: 'PoAW-X consensus is active' })
            : t('poawx_banner.title', {
                defaultValue: '{{blocks}} blocks until PoAW-X activation',
                blocks: remaining,
              })}
        </strong>{' '}
        <span className="text-indigo-200/80">
          {active
            ? t('poawx_banner.active_body', {
                defaultValue:
                  'Proof of Assigned Work, eXtended — VRF-selected block proposers are live (activated at block 50,000).',
              })
            : t('poawx_banner.body', {
                defaultValue:
                  'The PoAW-X consensus upgrade activates at block 50,000 (now {{height}}). Make sure your node is on v1.9.119 or later before then.',
                height,
              })}
        </span>
      </div>
    </div>
  );
}
