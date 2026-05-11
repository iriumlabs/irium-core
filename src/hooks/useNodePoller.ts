import { useEffect, useRef, useCallback } from "react";
import toast from 'react-hot-toast';
import { node, wallet, rpc } from "../lib/tauri";
import { useStore } from "../lib/store";
import { getUserMessage } from "../lib/errors";

const NODE_POLL_MS = 3000;
const WALLET_POLL_MS = 15000;

// Module-level ref so any component can trigger an immediate poll without prop-drilling.
let _pollNodeNow: (() => void) | null = null;
export const pollNodeNow = () => _pollNodeNow?.();

// Poll every 500 ms for `durationMs` to catch node start/stop quickly.
export function startAggressivePoll(durationMs = 12_000) {
  const end = Date.now() + durationMs;
  const id = setInterval(() => {
    _pollNodeNow?.();
    if (Date.now() >= end) clearInterval(id);
  }, 500);
}

export function useNodePoller() {
  const setNodeStatus = useStore((s) => s.setNodeStatus);
  const setBalance = useStore((s) => s.setBalance);
  const addNotification = useStore((s) => s.addNotification);
  const setNodeStarting = useStore((s) => s.setNodeStarting);
  const setNodeOperation = useStore((s) => s.setNodeOperation);
  const logError = useStore((s) => s.logError);
  const setPeerList = useStore((s) => s.setPeerList);
  const setHeightLastChanged = useStore((s) => s.setHeightLastChanged);

  const nodeRef = useRef<ReturnType<typeof setInterval>>();
  const walletRef = useRef<ReturnType<typeof setInterval>>();
  const peerRef = useRef<ReturnType<typeof setInterval>>();
  const prevRunning = useRef<boolean | null>(null);
  const prevHeight = useRef<number | null>(null);
  // Require 2 consecutive offline polls before declaring node disconnected to
  // avoid false "restart" toasts from a single transient RPC timeout.
  const offlineCount = useRef(0);

  const pollNode = useCallback(async () => {
    try {
      const status = await node.status();

      if (status.running) {
        offlineCount.current = 0;
        setNodeStatus(status);
        // Only clear the "starting" / "operation" flags once peers are
        // connected. This lets the Dashboard's NodeOperationBanner show a
        // proper completion state (CONNECTING checkmark + "Connected to N
        // peers" message + 100% progress bar) instead of unmounting the
        // moment iriumd binds its RPC port. The banner itself also clears
        // these flags after a 2s celebration window — whichever fires
        // first wins; both setting false is idempotent.
        if ((status.peers ?? 0) > 0) {
          setNodeStarting(false);
          if (useStore.getState().nodeOperation === 'starting') setNodeOperation(null);
        }

        // Track height changes — new block arrived.
        if (prevHeight.current !== null && status.height !== prevHeight.current) {
          setHeightLastChanged(Date.now());
          wallet.balance().then(setBalance).catch(() => {});
        }
        prevHeight.current = status.height;

        // Node came back online.
        if (prevRunning.current === false) {
          addNotification({ type: "success", title: "Node Connected", message: `Height: ${status.height}` });
          toast.success(`Node connected — block #${status.height}`);
        }
        prevRunning.current = true;
      } else {
        offlineCount.current += 1;
        // Only transition to offline after 2 consecutive offline polls.
        if (offlineCount.current >= 2) {
          setNodeStatus(status);
          if (prevRunning.current === true) {
            addNotification({ type: "warning", title: "Node Disconnected" });
            toast(`Node disconnected`, { icon: '🔴' });
          }
          prevRunning.current = false;
        }
      }
    } catch (e) {
      logError(getUserMessage(e), 'node-poller');
    }
  }, [setNodeStatus, setNodeStarting, setNodeOperation, addNotification, logError, setHeightLastChanged]);

  const setAddresses = useStore((s) => s.setAddresses);

  const pollWallet = useCallback(async () => {
    try {
      const bal = await wallet.balance();
      setBalance(bal);
    } catch {
      // wallet may not be open
    }
    // Refresh addresses too — the hero balance and the TopBar balance both
    // read from addresses[activeAddrIdx]?.balance, so they need to stay in
    // sync with the actual on-chain state for every address.
    //
    // The store's setAddresses now does the order-preserving merge AND the
    // hidden-address filter centrally for ALL array-input callers (us,
    // loadData, file-switch, etc), so we just pass the raw binary list
    // through. Single source of truth — no risk of a call site bypassing
    // either step.
    try {
      const list = await wallet.listAddresses();
      if (list) setAddresses(list);
    } catch {
      // wallet may not be open
    }
  }, [setBalance, setAddresses]);

  const pollPeers = useCallback(async () => {
    if (!useStore.getState().nodeStatus?.running) return;
    try {
      const peers = await rpc.peers();
      setPeerList(peers);

      // Persist live peer addresses into seedlist.extra so future restarts
      // have a growing pool of real nodes to connect to.
      const liveAddrs = peers
        .filter((p) => p.multiaddr && (p.source === 'live' || p.source === 'peer_exchange' || p.dialable === true))
        .map((p) => p.multiaddr);
      if (liveAddrs.length > 0) {
        node.saveDiscoveredPeers(liveAddrs).catch(() => {});
      }
    } catch {
      // ignore — node may be offline
    }
  }, [setPeerList]);

  useEffect(() => {
    _pollNodeNow = pollNode;
    return () => { _pollNodeNow = null; };
  }, [pollNode]);

  useEffect(() => {
    pollNode();
    pollWallet();
    pollPeers();
    nodeRef.current = setInterval(pollNode, NODE_POLL_MS);
    walletRef.current = setInterval(pollWallet, WALLET_POLL_MS);
    peerRef.current = setInterval(pollPeers, 10_000);
    return () => {
      clearInterval(nodeRef.current);
      clearInterval(walletRef.current);
      clearInterval(peerRef.current);
    };
  }, [pollNode, pollWallet, pollPeers]);
}
