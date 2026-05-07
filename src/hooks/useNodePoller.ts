import { useEffect, useRef, useCallback } from "react";
import { node, wallet } from "../lib/tauri";
import { useStore } from "../lib/store";

const NODE_POLL_MS = 5000;
const WALLET_POLL_MS = 15000;

export function useNodePoller() {
  const setNodeStatus = useStore((s) => s.setNodeStatus);
  const setBalance = useStore((s) => s.setBalance);
  const addNotification = useStore((s) => s.addNotification);
  const nodeRef = useRef<ReturnType<typeof setInterval>>();
  const walletRef = useRef<ReturnType<typeof setInterval>>();
  const prevRunning = useRef<boolean | null>(null);

  const pollNode = useCallback(async () => {
    try {
      const status = await node.status();
      setNodeStatus(status);
      // Alert on connect/disconnect
      if (prevRunning.current === false && status.running) {
        addNotification({ type: "success", title: "Node Connected", message: `Height: ${status.height}` });
      } else if (prevRunning.current === true && !status.running) {
        addNotification({ type: "warning", title: "Node Disconnected" });
      }
      prevRunning.current = status.running;
    } catch {
      setNodeStatus(null);
    }
  }, [setNodeStatus, addNotification]);

  const pollWallet = useCallback(async () => {
    try {
      const bal = await wallet.balance();
      setBalance(bal);
    } catch {
      // wallet may not be open
    }
  }, [setBalance]);

  useEffect(() => {
    pollNode();
    pollWallet();
    nodeRef.current = setInterval(pollNode, NODE_POLL_MS);
    walletRef.current = setInterval(pollWallet, WALLET_POLL_MS);
    return () => {
      clearInterval(nodeRef.current);
      clearInterval(walletRef.current);
    };
  }, [pollNode, pollWallet]);
}
