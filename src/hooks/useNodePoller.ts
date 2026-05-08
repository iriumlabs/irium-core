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
  const logError = useStore((s) => s.logError);
  const setPeerList = useStore((s) => s.setPeerList);
  const setHeightLastChanged = useStore((s) => s.setHeightLastChanged);

  const nodeRef = useRef<ReturnType<typeof setInterval>>();
  const walletRef = useRef<ReturnType<typeof setInterval>>();
  const peerRef = useRef<ReturnType<typeof setInterval>>();
  const prevRunning = useRef<boolean | null>(null);
  const prevHeight = useRef<number | null>(null);

  const pollNode = useCallback(async () => {
    try {
      const status = await node.status();
      setNodeStatus(status);

      // Clear the "starting" state as soon as the RPC responds.
      if (status.running) setNodeStarting(false);

      // Track height changes.
      if (prevHeight.current !== null && status.height !== prevHeight.current) {
        setHeightLastChanged(Date.now());
      }
      prevHeight.current = status.height;

      // Alert on node connect/disconnect transitions.
      if (prevRunning.current === false && status.running) {
        addNotification({ type: "success", title: "Node Connected", message: `Height: ${status.height}` });
        toast.success(`Node connected — block #${status.height}`);
      } else if (prevRunning.current === true && !status.running) {
        addNotification({ type: "warning", title: "Node Disconnected" });
        toast(`Node disconnected`, { icon: '🔴' });
      }
      prevRunning.current = status.running;
    } catch (e) {
      setNodeStatus(null);
      prevRunning.current = false;
      logError(getUserMessage(e), 'node-poller');
    }
  }, [setNodeStatus, setNodeStarting, addNotification, logError, setHeightLastChanged]);

  const pollWallet = useCallback(async () => {
    try {
      const bal = await wallet.balance();
      setBalance(bal);
    } catch {
      // wallet may not be open
    }
  }, [setBalance]);

  const pollPeers = useCallback(async () => {
    if (!useStore.getState().nodeStatus?.running) return;
    try {
      const peers = await rpc.peers();
      setPeerList(peers);

      // Persist live peer addresses into seedlist.extra so future restarts
      // have a growing pool of real nodes to connect to.
      const liveAddrs = peers
        .filter((p) => p.multiaddr && (p.source === 'live' || p.dialable === true))
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
