import { useEffect, useRef } from 'react';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

export type IriumEventType =
  | 'agreement.funded'
  | 'agreement.proof_submitted'
  | 'agreement.satisfied'
  | 'agreement.timeout'
  | 'agreement.disputed'
  | 'agreement.proof_reorged'
  | 'proof.gossip_received'
  | 'offer.created'
  | 'offer.taken'
  | 'block.new'
  | 'peer.connected'
  | 'peer.disconnected';

export interface IriumEvent {
  type: IriumEventType | string;
  ts: number;
  data: Record<string, unknown>;
}

// useIriumEvents — subscribe to the Rust-bridged WebSocket event stream.
// The handler is kept in a ref so callers don't need to stabilise it with
// useCallback; the listener registers once on mount and unregisters on
// unmount. Components filter by event.type inside their handler.
export function useIriumEvents(handler: (event: IriumEvent) => void): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let mounted = true;
    listen<IriumEvent>('irium-event', (e) => {
      if (mounted) handlerRef.current(e.payload);
    })
      .then((fn) => {
        if (mounted) unlisten = fn;
        else fn();
      })
      .catch(() => {});
    return () => {
      mounted = false;
      if (unlisten) unlisten();
    };
  }, []);
}
