import { useEffect, useRef, useCallback } from "react";
import toast from 'react-hot-toast';
import { node, wallet, rpc, miner, gpuMiner, stratum } from "../lib/tauri";
import { useStore } from "../lib/store";
import { getUserMessage } from "../lib/errors";

const NODE_POLL_MS = 3000;
const WALLET_POLL_MS = 15000;
const MINER_POLL_MS = 3000;
const STRATUM_POLL_MS = 5000;
// Metrics drive the Settings UPnP card's inbound-peer detection. The counter
// changes slowly (a peer dialing in is a rare event) so a long cadence is fine.
// Keeping this separate from NODE_POLL_MS prevents the /metrics HTTP request
// from adding load to iriumd's RPC every 3s — when combined with Explorer's
// Refresh button (30 concurrent /rpc/block calls), the baseline +1 metrics
// request per 3s was enough to push iriumd's RPC into timing out the
// node-status poll, producing spurious "Node Disconnected" toasts.
const METRICS_POLL_MS = 30000;
// Number of consecutive failed /status polls required before we declare the
// node offline. At NODE_POLL_MS=3000 this is a 12-second grace window —
// enough to absorb a heavy Explorer Refresh burst (up to ~18s worst case for
// 30 /rpc/block calls capped at 5 concurrent with 3s each) without producing
// spurious "Node Disconnected" toasts on every refresh. Real outages still
// surface within 12s, which is well under the threshold for the user to act.
// Previously 2 (6s) — too tight; a single Refresh burst tripped it.
const OFFLINE_POLL_THRESHOLD = 4;

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
  const setNodeMetrics = useStore((s) => s.setNodeMetrics);
  const setBalance = useStore((s) => s.setBalance);
  const setAddresses = useStore((s) => s.setAddresses);
  const addNotification = useStore((s) => s.addNotification);
  const setNodeStarting = useStore((s) => s.setNodeStarting);
  const setNodeOperation = useStore((s) => s.setNodeOperation);
  const logError = useStore((s) => s.logError);
  const setPeerList = useStore((s) => s.setPeerList);
  const setHeightLastChanged = useStore((s) => s.setHeightLastChanged);

  const nodeRef = useRef<ReturnType<typeof setInterval>>();
  const walletRef = useRef<ReturnType<typeof setInterval>>();
  const peerRef = useRef<ReturnType<typeof setInterval>>();
  const metricsRef = useRef<ReturnType<typeof setInterval>>();
  const prevRunning = useRef<boolean | null>(null);
  const prevHeight = useRef<number | null>(null);
  // Counter incremented on each failed /status poll, reset to 0 on each
  // success. We only transition to the offline UI state once it reaches
  // OFFLINE_POLL_THRESHOLD — see that constant's comment for the rationale.
  const offlineCount = useRef(0);

  // Defined before pollNode so the height-change branch can trigger a wallet
  // refresh through the same code path used by the 15s poll. Previously
  // pollNode called wallet.balance() directly on every new block, which
  // doubled the RPC load (8 /rpc/balance from wallet.balance + 8 more from
  // wallet.listAddresses for the same addresses) and combined with the 15s
  // pollWallet burst regularly exceeded iriumd's per-IP rate limit, causing
  // /rpc/balance to return 429 and per-address balances to render as "—".
  // The new flow calls listAddresses ONCE and derives the total balance
  // client-side from the per-address balances it already returns.
  const pollWallet = useCallback(async () => {
    try {
      const list = await wallet.listAddresses();
      if (list) {
        setAddresses(list);
        // Sum per-address balances; addresses whose fetch failed/429'd
        // arrive as undefined and contribute 0, matching the previous
        // backend behaviour (wallet_get_balance silently skipped errors).
        const confirmed = list.reduce((s, a) => s + (a.balance ?? 0), 0);
        setBalance({ confirmed, unconfirmed: 0, total: confirmed });
      }
    } catch {
      // wallet may not be open
    }
  }, [setBalance, setAddresses]);

  const pollNode = useCallback(async () => {
    try {
      const status = await node.status();

      if (status.running) {
        offlineCount.current = 0;
        setNodeStatus(status);
        // NOTE: /metrics is scraped on its own 30s interval by pollMetrics
        // below — NOT here. Adding even a single extra HTTP request per 3s
        // node-poll cycle was enough to push iriumd's RPC over its capacity
        // when combined with Explorer's Refresh burst, producing spurious
        // "Node Disconnected" toasts. Keep the node-poll path lean.
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
          pollWallet();
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
        // Only transition to offline after OFFLINE_POLL_THRESHOLD consecutive
        // offline polls (currently 4 = 12 seconds of grace).
        if (offlineCount.current >= OFFLINE_POLL_THRESHOLD) {
          setNodeStatus(status);
          setNodeMetrics(null);
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
  }, [setNodeStatus, setNodeMetrics, setNodeStarting, setNodeOperation, addNotification, logError, setHeightLastChanged, pollWallet]);

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
    } catch (e) {
      // Surface /peers fetch failures to the in-app error log so a recurrence
      // of the "Connected Peers heights look stuck" symptom is debuggable —
      // a silent swallow previously hid HTTP 429 from the rate limiter.
      logError(getUserMessage(e), 'peer-poller');
    }
  }, [setPeerList, logError]);

  // Independent 30s poll for /metrics. Used only by the Settings UPnP card
  // to detect inbound peer connections (irium_inbound_accepted_total counter).
  // Deliberately separated from pollNode so the per-3s node-status poll path
  // stays lean — see comment on METRICS_POLL_MS for the regression that this
  // separation prevents.
  //
  // Skips entirely when the node isn't running, matching pollPeers. Every
  // failure mode (command-not-found, HTTP error, parse error) is swallowed
  // by the inner try/catch since metrics are optional context.
  const pollMetrics = useCallback(async () => {
    if (!useStore.getState().nodeStatus?.running) return;
    try {
      const metrics = await node.getMetrics();
      setNodeMetrics(metrics);
    } catch {
      // ignore — metrics are optional
    }
  }, [setNodeMetrics]);

  // Miner polls — global so the hashrate chart and status badges survive
  // page navigation. Each poll only appends to the history array when the
  // miner is actually running, so non-mining users don't accumulate a
  // useless trail of zero samples.
  const setMinerStatus = useStore((s) => s.setMinerStatus);
  const appendMinerHistory = useStore((s) => s.appendMinerHistory);
  const setGpuMinerStatus = useStore((s) => s.setGpuMinerStatus);
  const setGpuDevices = useStore((s) => s.setGpuDevices);
  const appendGpuMinerHistory = useStore((s) => s.appendGpuMinerHistory);
  const setStratumStatus = useStore((s) => s.setStratumStatus);
  const setCpuCores = useStore((s) => s.setCpuCores);

  const pollMiner = useCallback(async () => {
    try {
      const s = await miner.status();
      setMinerStatus(s);
      if (s.running) appendMinerHistory({ t: Date.now(), khs: s.hashrate_khs });
    } catch { /* miner sidecar not running — leave status as is */ }
  }, [setMinerStatus, appendMinerHistory]);

  const pollGpuMiner = useCallback(async () => {
    try {
      const [s, devs] = await Promise.all([gpuMiner.status(), gpuMiner.listDevices()]);
      setGpuMinerStatus(s);
      setGpuDevices(devs);
      if (s.running) appendGpuMinerHistory({ t: Date.now(), khs: s.hashrate_khs });
    } catch { /* offline / no GPU support */ }
  }, [setGpuMinerStatus, setGpuDevices, appendGpuMinerHistory]);

  const pollStratum = useCallback(async () => {
    try {
      const s = await stratum.status();
      setStratumStatus(s);
    } catch { /* not connected */ }
  }, [setStratumStatus]);

  const minerRef = useRef<ReturnType<typeof setInterval>>();
  const gpuMinerRef = useRef<ReturnType<typeof setInterval>>();
  const stratumRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    _pollNodeNow = pollNode;
    return () => { _pollNodeNow = null; };
  }, [pollNode]);

  // One-shot CPU core count fetch — backs the Miner page's threads slider.
  // Cheap (single fs/sysinfo call) so a single boot-time fetch is plenty.
  useEffect(() => {
    node.getSystemInfo()
      .then((info) => { if (info?.cpu_cores) setCpuCores(info.cpu_cores); })
      .catch(() => { /* tauri command missing in dev — fall back to navigator */ });
  }, [setCpuCores]);

  useEffect(() => {
    pollNode();
    pollWallet();
    pollPeers();
    pollMetrics();
    pollMiner();
    pollGpuMiner();
    pollStratum();
    nodeRef.current = setInterval(pollNode, NODE_POLL_MS);
    walletRef.current = setInterval(pollWallet, WALLET_POLL_MS);
    peerRef.current = setInterval(pollPeers, 10_000);
    metricsRef.current = setInterval(pollMetrics, METRICS_POLL_MS);
    minerRef.current = setInterval(pollMiner, MINER_POLL_MS);
    gpuMinerRef.current = setInterval(pollGpuMiner, MINER_POLL_MS);
    stratumRef.current = setInterval(pollStratum, STRATUM_POLL_MS);
    return () => {
      clearInterval(nodeRef.current);
      clearInterval(walletRef.current);
      clearInterval(peerRef.current);
      clearInterval(metricsRef.current);
      clearInterval(minerRef.current);
      clearInterval(gpuMinerRef.current);
      clearInterval(stratumRef.current);
    };
  }, [pollNode, pollWallet, pollPeers, pollMetrics, pollMiner, pollGpuMiner, pollStratum]);
}
