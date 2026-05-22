import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { useIriumEvents, type IriumEvent } from '../lib/hooks';

// FIX 8 — Global agreement-state notifier.
//
// useIriumEvents is also called inside Agreements / Settlement /
// Marketplace pages, but those handlers only fire while the page is
// mounted. A user mining on the Miner tab would otherwise miss every
// settlement state transition until they navigated back.
//
// This component mounts inside the always-alive AppShell (App.tsx)
// and surfaces a toast for the on-chain agreement events iriumd
// emits via the WebSocket bridge:
//   agreement.funded
//   agreement.proof_submitted
//   agreement.satisfied
//   agreement.timeout
//   agreement.proof_reorged
//
// Released / refunded are not separate on-chain events — they ride
// the satisfied/timeout transitions plus a regular tx accept. Toasts
// for the user-initiated Release/Refund clicks already exist inside
// the pages where the action is taken, so we don't double up here.
//
// Each toast carries a stable id of `agreement-<type>-<hash>` so a
// reorg that re-emits the same event in the same session collapses
// to a single toast instead of stacking.

function shortHash(hash: string): string {
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-4)}`;
}

export default function GlobalAgreementNotifier() {
  const { t } = useTranslation();

  useIriumEvents((event: IriumEvent) => {
    if (!event.type.startsWith('agreement.')) return;
    const hash = String(event.data.agreement_hash ?? '');
    if (!hash) return;
    const short = shortHash(hash);
    const toastId = `agreement-${event.type}-${hash}`;

    switch (event.type) {
      case 'agreement.funded':
        toast.success(
          t('notifications.agreement_funded', { hash: short, defaultValue: `Agreement ${short} funded` }),
          { id: toastId, duration: 6000 },
        );
        break;
      case 'agreement.proof_submitted':
        toast(
          t('notifications.agreement_proof_submitted', { hash: short, defaultValue: `Proof submitted for agreement ${short}` }),
          { id: toastId, duration: 6000 },
        );
        break;
      case 'agreement.satisfied':
        toast.success(
          t('notifications.agreement_satisfied', { hash: short, defaultValue: `Agreement ${short} satisfied — funds can be released` }),
          { id: toastId, duration: 8000 },
        );
        break;
      case 'agreement.timeout':
        toast.error(
          t('notifications.agreement_timeout', { hash: short, defaultValue: `Agreement ${short} timed out — refund available` }),
          { id: toastId, duration: 8000 },
        );
        break;
      case 'agreement.proof_reorged':
        toast(
          t('notifications.agreement_proof_reorged', { hash: short, defaultValue: `Proof for agreement ${short} was reorged — re-submit may be needed` }),
          { id: toastId, duration: 10000 },
        );
        break;
      default:
        break;
    }
  });

  return null;
}
