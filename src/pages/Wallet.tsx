import React, { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { save as saveDialog, open as openDialog } from "@tauri-apps/api/dialog";
import { motion, AnimatePresence } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import {
  Copy, Plus, ArrowUpRight, ArrowDownLeft, ArrowDownRight,
  Loader2, X, Upload, FileText, KeyRound, Hash,
  Shield, Eye, Download, ChevronDown, Wallet, Settings, Star, Trash2, Check, Pencil,
  Pickaxe,
} from "lucide-react";
import toast from "react-hot-toast";
import clsx from "clsx";
import { useStore } from "../lib/store";
import { wallet, config } from "../lib/tauri";
import TxDetailModal from "../components/TxDetailModal";
import { formatIRM, timeAgo, SATS_PER_IRM, computeConfirmations, getAddressBadgeText } from "../lib/types";
import type { AddressInfo, Transaction, SendResult, WalletCreateResult } from "../lib/types";

/* ── `irium:close-modal` event pattern ────────────────────────────────────────
 * Global keyboard-driven modal dismissal. Pressing Escape anywhere in the app
 * dispatches a single `irium:close-modal` CustomEvent — every open modal that
 * subscribes will close itself.
 *
 *   DISPATCHER (one):
 *     src/hooks/useKeyboardShortcuts.ts — fires on `Escape` keydown
 *
 *   SUBSCRIBERS in this file (three):
 *     • CreateWalletModal    (`useEffect` at line ~1226)
 *     • SendModal            (`useEffect` at line ~1585)
 *     • ReceiveModal         (`useEffect` at line ~1747)
 *
 * Why a custom event instead of prop-drilling an Escape handler? The modals
 * are deeply nested inside <AnimatePresence> and rendered conditionally — a
 * fire-and-forget event is simpler than threading a ref through every layer.
 * The pattern is intentionally listener-driven: any future modal can opt in
 * by registering the listener; no central registry needs updating.
 * ───────────────────────────────────────────────────────────────────────── */

export default function WalletPage() {
  const balance = useStore((s) => s.balance);
  const nodeStatus = useStore((s) => s.nodeStatus);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const nodeStatusRef = useRef(nodeStatus);
  useEffect(() => { nodeStatusRef.current = nodeStatus; }, [nodeStatus]);

  // Addresses + active selection live in the store so the TopBar mirrors the
  // hero's selection (and the selection persists across page navigations).
  const addresses = useStore((s) => s.addresses);
  const setAddresses = useStore((s) => s.setAddresses);
  const activeAddrIdx = useStore((s) => s.activeAddrIdx);
  const setActiveAddrIdx = useStore((s) => s.setActiveAddrIdx);
  // Hidden addresses are persisted to localStorage so removed addresses
  // don't keep reappearing on every 15s poller refresh.
  const hiddenAddresses = useStore((s) => s.hiddenAddresses);
  const hideAddress = useStore((s) => s.hideAddress);
  const unhideAddress = useStore((s) => s.unhideAddress);
  // Custom per-address labels ("Mining", "Savings", etc) persisted to
  // localStorage. Read by every badge-rendering site via getAddressBadgeText.
  const addressLabels = useStore((s) => s.addressLabels);
  const setAddressLabel = useStore((s) => s.setAddressLabel);

  // Currently-displayed address. Hoisted here (was previously derived later
  // in the function) because loadData below depends on it for the per-
  // address transaction filter. Duplicated further down for hero-only
  // helpers — those use the same expression so the value is identical.
  const activeAddress = addresses[activeAddrIdx]?.address ?? "";

  const [txs, setTxs] = useState<Transaction[]>([]);
  // Loading is split so switching addresses only shimmers the Transactions
  // panel — the Addresses list is unchanged on a switch and shouldn't blank.
  //   loadingAddresses: true only on the first load (before the list exists)
  //   loadingTxs:        true on every loadData call (initial + each switch)
  const [loadingAddresses, setLoadingAddresses] = useState(true);
  const [loadingTxs, setLoadingTxs] = useState(true);
  const hasLoadedOnceRef = useRef(false);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  const [showSend, setShowSend] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [showCreateWallet, setShowCreateWallet] = useState(false);
  const [createWalletDefaultTab, setCreateWalletDefaultTab] = useState<'create' | 'import'>('create');
  const [createWalletDefaultImportTab, setCreateWalletDefaultImportTab] = useState<'mnemonic' | 'wif'>('wif');
  // True when the modal should be locked to import-only (no Create tab,
  // no path to wallet.create()). Set by callers that semantically mean
  // "restore"; reset on every close so the next opener starts fresh.
  const [createWalletLockImport, setCreateWalletLockImport] = useState(false);
  // Companion flag to createWalletLockImport: when both are true, the
  // modal also hides the inner Seed Phrase / WIF Key method selector so
  // callers that already know which import flavour they want (Restore
  // Seed Phrase, Restore WIF Key, Manage > Import Seed/WIF) open directly
  // to the chosen sub-form. Has no effect on its own.
  const [createWalletHideImportTabs, setCreateWalletHideImportTabs] = useState(false);

  // Manage Wallets drawer + new-address details modal
  const [showManagePanel, setShowManagePanel] = useState(false);
  const [addingAddress, setAddingAddress] = useState(false);
  const [newAddressInfo, setNewAddressInfo] = useState<{ address: string; wif?: string } | null>(null);
  const [walletFiles, setWalletFiles] = useState<import('../lib/types').WalletFileInfo[]>([]);
  const [activeWalletPath, setActiveWalletPath] = useState<string | null>(null);
  const [qrAddress, setQrAddress] = useState<string | null>(null);

  const loadWalletFiles = useCallback(async () => {
    const files = await wallet.listFiles().catch(() => null);
    if (files) {
      setWalletFiles(files);
      const active = files.find(f => f.is_active);
      if (active) setActiveWalletPath(active.path);
    }
  }, []);

  const [showSeedModal, setShowSeedModal] = useState(false);
  const [seedValue, setSeedValue] = useState('');
  const [seedBlurred, setSeedBlurred] = useState(true);
  const [seedIsMnemonic, setSeedIsMnemonic] = useState(false);
  const [loadingSeed, setLoadingSeed] = useState(false);
  const [exportingSecurityWif, setExportingSecurityWif] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [showRestoreBackupConfirm, setShowRestoreBackupConfirm] = useState(false);
  const [restoreBackupPath, setRestoreBackupPath] = useState('');
  const [restoringBackup, setRestoringBackup] = useState(false);

  // Refreshes the wallet's address list + balances. Called on mount and
  // by the wallet poller (every 15s via useNodePoller). NOT called on
  // simple address switch — switching is a pure UI change with no
  // on-chain effect, so re-fetching the entire list (which fires N
  // concurrent /rpc/balance calls inside wallet_list_addresses) would
  // just saturate iriumd's RPC port and cause spurious "node disconnected"
  // toasts on rapid alternation.
  //
  // Independent identity (only depends on setAddresses, which is stable
  // from the Zustand store), so the mount useEffect below fires exactly
  // once for this concern.
  const refreshAddresses = useCallback(async () => {
    if (!hasLoadedOnceRef.current) setLoadingAddresses(true);
    try {
      const addrs = await wallet.listAddresses();
      if (addrs) setAddresses(addrs);
    } catch {
      // Only surface errors when the node is supposed to be running —
      // offline wallets are a valid mode.
      if (nodeStatusRef.current?.running) toast.error('Failed to load addresses');
    } finally {
      hasLoadedOnceRef.current = true;
      setLoadingAddresses(false);
    }
  }, [setAddresses]);

  // Refreshes ONLY the transactions list for the currently selected
  // address. The Tauri command's `address` parameter is forwarded to the
  // RPC's `/rpc/history?address=…` so the binary returns just that
  // address's txs (the Dashboard's recent-activity feed still calls
  // wallet.transactions() with no address and gets the wallet-wide list).
  //
  // SERIALIZED — at most ONE /rpc/history HTTP request is in flight at
  // any time. Without this, slow clicks (>250ms apart, debounce can't
  // help) each fire their own 10-second-budget HTTP request; 3-4 of
  // them in flight is enough to saturate iriumd's RPC port, which makes
  // get_node_status time out (3s budget) and the UI flips to "Node
  // Disconnected" → reconnect on the next poll. The lock+loop pattern
  // below ensures clicks during an in-flight fetch only bump a "wanted"
  // counter; the in-flight fetch's finally re-loops and catches up to
  // the latest activeAddress. So 10 clicks during one in-flight fetch
  // collapse into AT MOST 2 HTTP requests total (the in-flight one +
  // one catch-up for the final address).
  //
  // First-load shimmer is gated by hasLoadedTxsOnceRef. After the first
  // successful load we keep the previous list visible while fetching
  // the new one — eliminates the shimmer flicker that appeared on
  // every switch before.
  //
  // activeAddressRef holds the latest value so the loop body uses the
  // current address rather than the closure's stale capture. This is
  // why refreshTxs has no React deps — the latest address is always
  // read via the ref.
  const hasLoadedTxsOnceRef = useRef(false);
  const isFetchingTxsRef = useRef(false);
  const txsWantedGenRef = useRef(0);
  const txsLastFetchedGenRef = useRef(-1);
  const activeAddressRef = useRef(activeAddress);
  useEffect(() => { activeAddressRef.current = activeAddress; }, [activeAddress]);

  const refreshTxs = useCallback(async () => {
    // Bump "wanted" generation. Either start the loop ourselves or
    // piggyback on an existing in-flight loop (which will see the
    // bumped wantedGenRef and continue).
    txsWantedGenRef.current++;
    if (isFetchingTxsRef.current) return;
    isFetchingTxsRef.current = true;
    try {
      while (txsLastFetchedGenRef.current < txsWantedGenRef.current) {
        const targetGen = txsWantedGenRef.current;
        txsLastFetchedGenRef.current = targetGen;
        const targetAddr = activeAddressRef.current;

        if (!hasLoadedTxsOnceRef.current) setLoadingTxs(true);
        try {
          const transactions = targetAddr
            ? await wallet.transactions(20, targetAddr)
            : [];
          // Only apply if this is still the latest wanted gen (no newer
          // click happened while we awaited the fetch).
          if (targetGen === txsWantedGenRef.current) {
            setTxs(transactions);
          }
        } catch {
          if (targetGen === txsWantedGenRef.current && nodeStatusRef.current?.running) {
            toast.error('Failed to load transactions');
          }
        } finally {
          if (targetGen === txsWantedGenRef.current) {
            hasLoadedTxsOnceRef.current = true;
            setLoadingTxs(false);
          }
        }
      }
    } finally {
      isFetchingTxsRef.current = false;
    }
  }, []);

  // Convenience helper for callers that legitimately need both refreshed
  // at once (after add-address, restore-backup, wallet file switch, etc).
  // Not used by the activeAddress-driven useEffect — only refreshTxs is.
  const loadData = useCallback(async () => {
    await Promise.all([refreshAddresses(), refreshTxs()]);
  }, [refreshAddresses, refreshTxs]);

  // Add a fresh address derived from the active wallet's BIP32 seed.
  // Declared AFTER loadData so React's exhaustive-deps rule can include
  // loadData in its dependency list (loadData itself depends on
  // activeAddress, so without this dep handleAddAddress would have captured
  // a stale loadData and re-fetched txs for the wrong address after add).
  const handleAddAddress = useCallback(async () => {
    setAddingAddress(true);
    try {
      const newAddr = await wallet.newAddress();
      if (!newAddr) { toast.error('No address returned'); return; }
      // Pull the WIF for the new address (best-effort)
      let wif: string | undefined;
      try { wif = await wallet.readWif(newAddr) ?? undefined; } catch { /* ok */ }
      setNewAddressInfo({ address: newAddr, wif });
      // Refresh address list
      await loadData();
    } catch (e) {
      toast.error(`Failed to add address: ${e}`);
    } finally {
      setAddingAddress(false);
    }
  }, [loadData]);

  // Confirmation dialog before adding a new address. Both the main-page
  // "+ Add Address" button and the Manage panel's add row route through
  // requestAddAddress, which opens this dialog instead of firing
  // handleAddAddress directly. handleAddAddress runs only when the user
  // clicks the "Add Address" button inside the modal.
  const [showAddAddressConfirm, setShowAddAddressConfirm] = useState(false);
  const requestAddAddress = useCallback(() => {
    setShowAddAddressConfirm(true);
  }, []);

  // Two split effects (was one `loadData` effect): the addresses effect
  // fires exactly once on mount; the transactions effect fires on mount
  // AND every time activeAddress changes. This decouples the per-switch
  // refresh from the (expensive) list-addresses RPC storm — see the
  // refreshAddresses / refreshTxs comments above.
  useEffect(() => { refreshAddresses(); }, [refreshAddresses]);
  // 250ms debounce on tx refresh. Rapid alternating clicks between
  // addresses collapse into a single refreshTxs call. Combined with
  // refreshTxs's internal serialization (only one /rpc/history in
  // flight at a time, queued clicks fetch the latest activeAddress
  // after the in-flight completes), this caps iriumd's RPC load
  // regardless of click cadence. activeAddress is the dep — refreshTxs
  // is intentionally stable (reads activeAddressRef inside the loop).
  // First mount also debounces (250ms delay before tx list appears).
  useEffect(() => {
    const handle = setTimeout(() => { refreshTxs(); }, 250);
    return () => clearTimeout(handle);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAddress]);
  useEffect(() => { loadWalletFiles(); }, [loadWalletFiles]);

  useEffect(() => {
    const openSend = () => {
      if (nodeStatusRef.current?.running) setShowSend(true);
      else toast.error('Node must be online to send transactions');
    };
    const openReceive = () => setShowReceive(true);
    window.addEventListener('irium:open-send', openSend);
    window.addEventListener('irium:open-receive', openReceive);
    return () => {
      window.removeEventListener('irium:open-send', openSend);
      window.removeEventListener('irium:open-receive', openReceive);
    };
  }, []);

  // (Out-of-range activeAddrIdx clamping is handled centrally by the store's
  // setAddresses — see src/lib/store.ts. A duplicate useEffect here would be
  // an extra render with no behavioural effect.)

  const handleShowSeed = async () => {
    setLoadingSeed(true);
    try {
      // Try mnemonic first (BIP32 wallets); fall back to hex seed (custom-derivation)
      try {
        const phrase = await wallet.exportMnemonic();
        if (phrase) {
          setSeedValue(phrase);
          setSeedIsMnemonic(true);
          setSeedBlurred(true);
          setShowSeedModal(true);
          return;
        }
      } catch {}
      const seed = await wallet.exportSeed();
      if (!seed) throw new Error('No recovery data found in wallet');
      setSeedValue(seed);
      setSeedIsMnemonic(false);
      setSeedBlurred(true);
      setShowSeedModal(true);
    } catch (e) {
      const msg = String(e).toLowerCase();
      if (msg.includes('seed') || msg.includes('no seed') || msg.includes('not found') || msg.includes('mnemonic')) {
        toast.error('This wallet has no seed backup — use WIF Key or Export Backup File instead');
      } else {
        toast.error(String(e));
      }
    } finally {
      setLoadingSeed(false);
    }
  };

  const handleSecurityExportWif = async () => {
    // Export the WIF for the currently SELECTED address, not always the
    // primary. The Security panel button has no per-address chooser, so
    // following the active selection is the least-surprising behaviour
    // (the hero and Transactions list already scope to this address).
    const selectedAddr = addresses[activeAddrIdx]?.address;
    if (!selectedAddr) { toast.error('No address loaded'); return; }
    setExportingSecurityWif(true);
    try {
      const outPath = await saveDialog({
        title: 'Export WIF Key',
        defaultPath: `${selectedAddr.slice(0, 8)}-wif.txt`,
        filters: [{ name: 'Text', extensions: ['txt'] }],
      });
      if (!outPath) return;
      await wallet.exportWif(selectedAddr, outPath as string);
      toast.success('WIF key exported');
    } catch (e) {
      toast.error(String(e));
    } finally {
      setExportingSecurityWif(false);
    }
  };

  const handleBackup = async () => {
    setBackingUp(true);
    try {
      const outPath = await saveDialog({
        title: 'Save Wallet Backup',
        defaultPath: 'irium-wallet-backup.bak',
        filters: [{ name: 'Wallet Backup', extensions: ['bak', 'dat', '*'] }],
      });
      if (!outPath) return;
      await wallet.backup(outPath as string);
      toast.success('Wallet backup saved');
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBackingUp(false);
    }
  };

  // (activeAddress is hoisted earlier in the function — see loadData
  // dependency note.)

  // Hero balance: ALWAYS the balance of the currently displayed address only.
  // Each address has its own balance — there is no "total wallet balance"
  // shown in the hero anymore. The TopBar mirrors this by reading the same
  // store fields (addresses + activeAddrIdx).
  const activeBalance = addresses[activeAddrIdx]?.balance ?? 0;

  const balanceLabel = activeAddrIdx === 0
    ? 'Balance'
    : `Balance · Address ${activeAddrIdx + 1}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="h-full overflow-y-auto"
    >
      <div className="px-8 py-6 space-y-6 w-full">

        {/* ── Balance Hero ──────────────────────────────────── */}
        <div className="panel-hero p-8 relative overflow-hidden">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: "radial-gradient(ellipse 80% 60% at 30% 40%, rgba(110,198,255,0.16) 0%, transparent 70%)", animation: "mesh-drift 20s ease-in-out infinite alternate" }}
          />
          <div className="relative z-10">
            {/* Address bar — badge + FULL address inline, no pill container,
                no truncation. The address stays mono and selectable so the
                user can copy any portion; wraps onto a second line on
                narrow windows. */}
            {addresses.length > 0 ? (
              <div className="flex items-center gap-3 mb-5 flex-wrap">
                {activeAddrIdx === 0 ? (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-display font-bold flex-shrink-0"
                    style={{
                      background: 'linear-gradient(135deg, rgba(59,59,255,0.20) 0%, rgba(110,198,255,0.16) 50%, rgba(167,139,250,0.20) 100%)',
                      border: '1px solid rgba(110,198,255,0.40)',
                      color: '#6ec6ff',
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                    }}
                  >
                    <Star size={9} fill="currentColor" />
                    {getAddressBadgeText(activeAddress, activeAddrIdx, addressLabels)}
                  </span>
                ) : (
                  <span
                    className="px-2 py-1 rounded-full text-[9px] font-display font-bold uppercase flex-shrink-0"
                    style={{
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.10)',
                      color: 'rgba(238,240,255,0.55)',
                      letterSpacing: '0.12em',
                    }}
                  >
                    {getAddressBadgeText(activeAddress, activeAddrIdx, addressLabels)}
                  </span>
                )}
                <span className="font-mono text-sm text-white/85 break-all min-w-0">
                  {activeAddress}
                </span>
                <button
                  onClick={() => { navigator.clipboard.writeText(activeAddress); toast.success('Address copied'); }}
                  className="text-white/45 hover:text-white transition-colors flex-shrink-0"
                  title="Copy address"
                >
                  <Copy size={12} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 mb-5">
                <div className="w-2 h-2 rounded-full bg-amber-400/60" />
                <span className="text-xs text-white/40">No wallet loaded — create or import one below</span>
              </div>
            )}

            <div className="text-white/40 text-sm font-display mb-2">{balanceLabel}</div>

            {/* Hero balance shimmer guard — uses `loadingAddresses` (NOT
                `loadingTxs`). The hero reads `activeBalance` directly from
                `addresses[activeAddrIdx]?.balance`, which is already in
                memory after the first load. Switching addresses is a pure
                lookup; no RPC fetch is required. `loadingAddresses` only
                flips true on the very first load (see `hasLoadedOnceRef`
                in loadData), so the hero shimmers exactly once at mount
                and is instant on every subsequent address switch. */}
            {loadingAddresses ? (
              <div className="shimmer h-12 w-48 rounded mb-2" />
            ) : (
              <>
                {/* Hero balance — uses the EXACT same gradient as the
                    TopBar balance (inline to avoid any class/CSS-var drift)
                    so the two displays read with one consistent colour. */}
                <div
                  className="font-display font-bold text-5xl mb-1 leading-tight"
                  style={{
                    background: 'linear-gradient(90deg, #d4eeff 0%, #6ec6ff 55%, #a78bfa 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                    letterSpacing: '0.01em',
                  }}
                >
                  {formatIRM(activeBalance)}
                </div>
                <div className="font-mono text-white/30 text-sm mb-1">
                  {activeBalance.toLocaleString('en-US')} satoshis
                </div>
                {/* Unconfirmed pending — the RPC's /rpc/balance returns a
                    single wallet-wide `unconfirmed` field (no per-address
                    breakdown), so we show it for ANY selected address with
                    an explicit "wallet-wide" disclaimer to set expectations. */}
                {(balance?.unconfirmed ?? 0) > 0 && (
                  <div className="text-amber-400 text-sm">
                    +{formatIRM(balance!.unconfirmed)} unconfirmed
                    <span className="text-amber-400/55 text-xs ml-2 font-normal">(wallet-wide)</span>
                  </div>
                )}
              </>
            )}

            <div className="flex gap-3 mt-6 flex-wrap items-center">
              <button
                onClick={() => setShowSend(true)}
                disabled={!nodeStatus?.running}
                title={!nodeStatus?.running ? 'Node must be online to send' : undefined}
                className="btn-primary gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ArrowUpRight size={16} /> Send
              </button>
              <button onClick={() => setShowReceive(true)} className="btn-secondary gap-2">
                <ArrowDownLeft size={16} /> Receive
              </button>
              {/* Add Address — derives a fresh address from the existing
                  BIP32 seed (the mnemonic doesn't change). Replaces the old
                  "+ Create Wallet" which silently switched to a new file
                  and made the existing addresses disappear from the UI.
                  Click opens a confirmation modal first; the actual add
                  only fires after the user clicks Add Address inside it. */}
              <button
                onClick={requestAddAddress}
                disabled={addingAddress}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-display font-semibold text-sm transition-all duration-200 active:scale-[0.97] disabled:opacity-60"
                style={{
                  background: 'rgba(0,0,0,0.30)',
                  border: '1px dashed rgba(110,198,255,0.40)',
                  color: '#6ec6ff',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderStyle = 'solid';
                  e.currentTarget.style.borderColor = 'rgba(110,198,255,0.65)';
                  e.currentTarget.style.background   = 'rgba(110,198,255,0.08)';
                  e.currentTarget.style.boxShadow    = '0 0 18px rgba(110,198,255,0.20)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderStyle = 'dashed';
                  e.currentTarget.style.borderColor = 'rgba(110,198,255,0.40)';
                  e.currentTarget.style.background   = 'rgba(0,0,0,0.30)';
                  e.currentTarget.style.boxShadow    = 'none';
                }}
              >
                {addingAddress ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                {addingAddress ? 'Generating…' : 'Add Address'}
              </button>
              {/* Manage Wallets — opens the slide-out drawer for the file
                  picker, advanced create, import flows, and hidden-address
                  unhide. Replaces the old top-right "Manage Addresses"
                  dropdown button (per-address actions live in the address
                  cards below the hero now, so the dropdown was redundant). */}
              <button
                onClick={() => { setShowManagePanel(true); loadWalletFiles(); }}
                className="btn-secondary text-xs gap-1.5"
                title="Wallet files, import, hidden addresses"
              >
                <Settings size={12} /> Manage
              </button>
            </div>
          </div>
        </div>

        {/* ── Addresses ─────────────────────────────────────────
            Quick-view list of all addresses + balances. Click a row to
            switch the active selection (mirrors the hero + TopBar). All
            management actions (set primary, hide, WIF export, QR) live
            in the Manage Wallets drawer to keep this list clean. */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display font-semibold text-white/90">Addresses</h2>
            <span className="badge badge-irium">{addresses.length}</span>
          </div>
          {loadingAddresses ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="card p-4">
                  <div className="shimmer h-4 w-full rounded mb-2" />
                  <div className="shimmer h-3 w-24 rounded" />
                </div>
              ))}
            </div>
          ) : addresses.length === 0 ? (
            <div className="card p-8 text-center text-white/30 text-sm">
              No addresses yet. Open Manage to add one.
            </div>
          ) : (
            <div className="space-y-2">
              {addresses.map((addr, idx) => (
                <AddressCard
                  key={addr.address}
                  addr={addr}
                  index={idx}
                  isPrimary={idx === 0}
                  isActive={idx === activeAddrIdx}
                  /* onSelect ONLY updates which address is displayed in the
                     hero and which address scopes the Transactions list.
                     It calls a pure setter — no array reorder, no change
                     to which address sits at index 0 (the primary). Setting
                     the primary is exclusive to the Manage Wallets drawer's
                     star button (which is wired with onSetPrimary). */
                  onSelect={() => setActiveAddrIdx(idx)}
                  /* onSetPrimary / onRemove deliberately NOT passed — the
                     card on the main page is view-only. AddressCard's
                     internal logic suppresses the Set-Primary / Hide /
                     WIF-Export buttons when these callbacks are absent
                     (see AddressCard render). */
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Transactions ──────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="font-display font-semibold text-white/90">Transactions</h2>
              {activeAddress && (
                <p className="text-[10px] font-mono mt-0.5" style={{ color: 'rgba(238,240,255,0.35)' }}>
                  for {activeAddress.slice(0, 12)}…{activeAddress.slice(-6)}
                </p>
              )}
            </div>
            <span className="badge badge-irium">{txs.length}</span>
          </div>
          {loadingTxs ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="card p-4">
                  <div className="shimmer h-4 w-full rounded mb-2" />
                  <div className="shimmer h-3 w-32 rounded" />
                </div>
              ))}
            </div>
          ) : txs.length === 0 ? (
            <div className="card p-8 text-center text-white/30 text-sm">No transactions yet.</div>
          ) : (
            <div className="card overflow-hidden">
              {/* Card-based layout — no grid column header. Each TxRow is
                  a flex-based card with its own bottom border for
                  separation; the outer .card frame just visually groups
                  them. */}
              {txs.map((tx) => (
                <TxRow key={tx.txid} tx={tx} onClick={() => setSelectedTx(tx)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Modals ───────────────────────────────────────────── */}
      <AnimatePresence>
        {selectedTx && <TxDetailModal tx={selectedTx} onClose={() => setSelectedTx(null)} />}
      </AnimatePresence>

      <AnimatePresence>
        {showSend && (
          <SendModal
            onClose={() => setShowSend(false)}
            onSuccess={() => { setShowSend(false); loadData(); }}
            availableBalance={activeBalance}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showReceive && <ReceiveModal address={activeAddress} onClose={() => setShowReceive(false)} />}
      </AnimatePresence>

      <AnimatePresence>
        {showCreateWallet && (
          <CreateWalletModal
            defaultTab={createWalletDefaultTab}
            defaultImportTab={createWalletDefaultImportTab}
            restrictToImport={createWalletLockImport}
            hideImportTabs={createWalletHideImportTabs}
            /* X-button / backdrop close path. The user may have already
               clicked "Create New Wallet" inside the modal (createResult is
               populated) without confirming Done — the wallet file already
               exists on disk and just hasn't been picked up by the UI. We
               refresh both data sources here so the new wallet appears
               immediately instead of waiting for the next 15s poll cycle.
               Also reset the import-lock flags so the next opener starts clean. */
            onClose={() => {
              setShowCreateWallet(false);
              setCreateWalletLockImport(false);
              setCreateWalletHideImportTabs(false);
              loadData();
              loadWalletFiles();
            }}
            onSuccess={() => {
              setShowCreateWallet(false);
              setCreateWalletLockImport(false);
              setCreateWalletHideImportTabs(false);
              // Reset to the first address of whatever the newly-active wallet
              // is. Without this, activeAddrIdx may still point at an index
              // valid in the previous wallet, leaving the hero showing a stale
              // selection (or no balance) until the user clicks an address.
              setActiveAddrIdx(0);
              loadData();
              loadWalletFiles();
            }}
          />
        )}
      </AnimatePresence>

      {/* Add-address confirmation — gates wallet.newAddress() behind an
          explicit confirm step so the user doesn't accidentally fork a
          new derivation. Adding cannot be undone (addresses live in the
          wallet file forever); the body copy notes hiding as the only
          way to remove them from view. Backdrop + Cancel are disabled
          while a previous add is in flight to prevent double-submission. */}
      <AnimatePresence>
        {showAddAddressConfirm && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm"
              onClick={() => !addingAddress && setShowAddAddressConfirm(false)}
            />
            <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 pointer-events-none">
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={{ duration: 0.18 }}
                className="pointer-events-auto w-full max-w-md p-6 space-y-4"
                style={{
                  background: 'rgba(2,5,14,0.98)',
                  border: '1px solid rgba(110,198,255,0.45)',
                  borderRadius: 14,
                  boxShadow: '0 24px 64px rgba(0,0,0,0.8), 0 0 32px rgba(110,198,255,0.18)',
                }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(110,198,255,0.16)', border: '1px solid rgba(110,198,255,0.40)' }}
                  >
                    <Plus size={18} style={{ color: '#6ec6ff' }} />
                  </div>
                  <h3 className="font-display font-bold text-lg" style={{ color: '#6ec6ff' }}>
                    Add a new address?
                  </h3>
                </div>

                <div
                  className="flex items-start gap-2 p-3 rounded-lg text-xs leading-relaxed"
                  style={{ background: 'rgba(110,198,255,0.08)', border: '1px solid rgba(110,198,255,0.28)', color: 'rgba(238,240,255,0.75)' }}
                >
                  This will derive the next address from your wallet seed.
                  Addresses cannot be removed from the wallet file once
                  created — only hidden from the visible list.
                </div>

                <div className="flex items-center gap-3 pt-1">
                  <button
                    onClick={() => setShowAddAddressConfirm(false)}
                    disabled={addingAddress}
                    className="btn-secondary flex-1 justify-center disabled:opacity-40"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      setShowAddAddressConfirm(false);
                      handleAddAddress();
                    }}
                    disabled={addingAddress}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-display font-semibold text-sm transition-all active:scale-[0.97] disabled:opacity-40"
                    style={{
                      background: 'rgba(110,198,255,0.16)',
                      border: '1px solid rgba(110,198,255,0.55)',
                      color: '#fff',
                      boxShadow: '0 0 16px rgba(110,198,255,0.18)',
                    }}
                  >
                    {addingAddress ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                    Add Address
                  </button>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      {/* New-address details modal — shown after "+ Add Address" succeeds.
          The mnemonic does NOT change because all addresses share the same
          BIP32 seed; the modal therefore omits a recovery phrase and shows
          only this address's public/private material. */}
      <AnimatePresence>
        {newAddressInfo && (
          <NewAddressModal
            info={newAddressInfo}
            onClose={() => setNewAddressInfo(null)}
            onShowRecoveryPhrase={handleShowSeed}
          />
        )}
      </AnimatePresence>

      {/* Address QR code popup */}
      <AnimatePresence>
        {qrAddress && (
          <AddressQrModal address={qrAddress} onClose={() => setQrAddress(null)} />
        )}
      </AnimatePresence>

      {/* Manage Wallets drawer */}
      <AnimatePresence>
        {showManagePanel && (
          <ManageWalletsPanel
            walletFiles={walletFiles}
            activeWalletPath={activeWalletPath}
            addresses={addresses}
            activeAddrIdx={activeAddrIdx}
            hiddenAddresses={hiddenAddresses}
            onUnhide={unhideAddress}
            addressLabels={addressLabels}
            onSetAddressLabel={setAddressLabel}
            onRenameWalletFile={async (oldPath, newName) => {
              try {
                const newPath = await wallet.renameFile(oldPath, newName);
                // If the renamed file was the user-persisted active wallet,
                // update settings so it survives an app restart.
                if (settings.wallet_path === oldPath && newPath) {
                  updateSettings({ wallet_path: newPath });
                }
                await loadWalletFiles();
                toast.success('Wallet renamed');
              } catch (e) {
                toast.error(`Rename failed: ${e}`);
              }
            }}
            onClose={() => setShowManagePanel(false)}
            onSwitchWallet={async (path) => {
              try {
                await wallet.setPath(path);
                // Persist so the switch survives restart — App.tsx's startup
                // effect rehydrates state.wallet_path from settings.wallet_path
                // on every launch, so the backend setPath alone is not enough.
                updateSettings({ wallet_path: path });
                // Order matters: load the NEW wallet's addresses first so
                // the store has fresh data, THEN reset the selection to 0.
                // If we reset first, the next render briefly points idx 0
                // at the OLD addresses array — a stale-data flash. (The
                // store's setAddresses also re-anchors selection by address
                // string, so this explicit reset only matters for the rare
                // case where the new wallet happens to share an address
                // with the old one.)
                await loadData();
                setActiveAddrIdx(0);
                await loadWalletFiles();
                toast.success(`Switched to ${path.split(/[\\/]/).pop()}`);
              } catch (e) { toast.error(`Failed to switch: ${e}`); }
            }}
            onCreateNewWalletFile={() => {
              setCreateWalletDefaultTab('create');
              setCreateWalletLockImport(false);
              setCreateWalletHideImportTabs(false);
              setShowCreateWallet(true);
              setShowManagePanel(false);
            }}
            onDeleteWalletFile={async (path) => {
              try {
                await wallet.deleteFile(path);
                await loadWalletFiles();
                toast.success(`Deleted ${path.split(/[\\/]/).pop()}`);
              } catch (e) {
                toast.error(`Delete failed: ${e}`);
              }
            }}
            onSetPrimary={(idx) => {
              setAddresses(prev => [prev[idx], ...prev.filter((_, i) => i !== idx)]);
              setActiveAddrIdx(0);
              toast.success('Set as primary');
            }}
            onRemove={(_idx, addr) => {
              hideAddress(addr);
              toast.success('Address hidden');
            }}
            onAddAddress={requestAddAddress}
            onShowQr={(addr) => setQrAddress(addr)}
            onImportSeed={() => {
              setCreateWalletDefaultTab('import');
              setCreateWalletDefaultImportTab('mnemonic');
              setCreateWalletLockImport(true);
              setCreateWalletHideImportTabs(true);
              setShowCreateWallet(true);
              setShowManagePanel(false);
            }}
            onImportWif={() => {
              setCreateWalletDefaultTab('import');
              setCreateWalletDefaultImportTab('wif');
              setCreateWalletLockImport(true);
              setCreateWalletHideImportTabs(true);
              setShowCreateWallet(true);
              setShowManagePanel(false);
            }}
            /* Security pass-throughs — handler bodies are identical to the
               ones the Security section used when it lived on the main
               Wallet page; only the call site moved. Show Recovery Phrase
               and the WIF/Backup-file exports do NOT close the drawer (OS
               save dialogs don't visually conflict with the drawer). Import
               Backup File DOES close the drawer for parity with the other
               Restore actions (Seed Phrase, WIF Key) since it opens a full
               confirmation modal. */
            onShowSeed={handleShowSeed}
            loadingSeed={loadingSeed}
            onExportSecurityWif={handleSecurityExportWif}
            exportingSecurityWif={exportingSecurityWif}
            onBackupFile={handleBackup}
            backingUp={backingUp}
            onImportBackupFile={async () => {
              try {
                // Two-filter pattern so macOS users see both the preferred
                // backup extensions AND can switch to "All Files" — CLI
                // backups may carry .json, .tar.gz, or no extension at all.
                const selected = await openDialog({
                  title: 'Select Wallet Backup File',
                  multiple: false,
                  filters: [
                    { name: 'Wallet Backup', extensions: ['bak', 'dat', 'json', 'tar', 'gz'] },
                    { name: 'All Files',     extensions: ['*'] },
                  ],
                });
                if (!selected) return;
                setRestoreBackupPath(selected as string);
                setShowRestoreBackupConfirm(true);
                setShowManagePanel(false);
              } catch (e) {
                toast.error(String(e));
              }
            }}
          />
        )}
      </AnimatePresence>

      {/* Recovery Phrase / Wallet Seed modal */}
      <AnimatePresence>
        {showSeedModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40"
              onClick={() => { setShowSeedModal(false); setSeedValue(''); setSeedBlurred(true); setSeedIsMnemonic(false); }}
            />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 8 }}
                transition={{ duration: 0.2 }}
                className="glass-heavy rounded-2xl p-6 w-full max-w-lg pointer-events-auto space-y-5"
              >
                <div className="flex items-center justify-between">
                  <h2 className="font-display font-bold text-lg text-white flex items-center gap-2">
                    <Eye size={18} className="text-amber-400" />
                    {seedIsMnemonic ? 'Recovery Phrase' : 'Wallet Seed'}
                  </h2>
                  <button onClick={() => { setShowSeedModal(false); setSeedValue(''); setSeedBlurred(true); setSeedIsMnemonic(false); }} className="btn-ghost text-white/40 p-1">
                    <X size={16} />
                  </button>
                </div>
                <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <span className="text-amber-400 text-xs leading-relaxed">
                    {seedIsMnemonic
                      ? 'Never share your recovery phrase. Anyone with these 24 words can access all your funds. Store it offline securely.'
                      : 'Never share your wallet seed. This hex value gives full access to all funds. Store it offline securely.'}
                  </span>
                </div>
                {seedIsMnemonic ? (
                  <div className="relative">
                    <div className={`transition-all duration-300 ${seedBlurred ? 'blur-sm select-none pointer-events-none' : ''}`}>
                      <div className="grid grid-cols-4 gap-1.5">
                        {seedValue.split(/\s+/).map((word, i) => (
                          <div key={i} className="flex items-center gap-1.5 p-2 rounded-lg bg-white/5 border border-white/5">
                            <span className="text-[10px] text-white/25 font-mono w-4 text-right flex-shrink-0">{i + 1}</span>
                            <span className="font-mono text-xs text-white/80">{word}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {seedBlurred && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <button onClick={() => setSeedBlurred(false)} className="btn-secondary flex items-center gap-2 text-sm">
                          <Eye size={14} /> Reveal
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <div className={`p-3 rounded-lg bg-white/5 border border-white/5 transition-all duration-300 ${seedBlurred ? 'blur-sm select-none pointer-events-none' : ''}`}>
                        <div className="font-mono text-xs text-white/80 break-all leading-relaxed">{seedValue}</div>
                      </div>
                      {seedBlurred && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <button onClick={() => setSeedBlurred(false)} className="btn-secondary flex items-center gap-2 text-sm">
                            <Eye size={14} /> Reveal
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-white/30 leading-relaxed">
                      This wallet uses a custom seed. Back up this hex seed to restore.
                    </div>
                  </>
                )}
                {!seedBlurred && (
                  <button
                    onClick={() => { navigator.clipboard.writeText(seedValue); toast.success(seedIsMnemonic ? 'Recovery phrase copied' : 'Seed copied'); }}
                    className="btn-ghost flex items-center gap-2 text-white/50 hover:text-white"
                  >
                    <Copy size={13} /> {seedIsMnemonic ? 'Copy Phrase' : 'Copy Seed'}
                  </button>
                )}
                <button
                  onClick={() => { setShowSeedModal(false); setSeedValue(''); setSeedBlurred(true); setSeedIsMnemonic(false); }}
                  className="btn-primary w-full"
                >
                  Done
                </button>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      {/* Restore from backup confirm */}
      <AnimatePresence>
        {showRestoreBackupConfirm && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-40"
              onClick={() => setShowRestoreBackupConfirm(false)}
            />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 8 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="glass-heavy rounded-2xl p-6 w-full max-w-md pointer-events-auto space-y-4"
              >
                <div className="flex items-center justify-between">
                  <h2 className="font-display font-bold text-lg text-white flex items-center gap-2">
                    <Upload size={18} className="text-amber-400" /> Restore from Backup
                  </h2>
                  <button onClick={() => setShowRestoreBackupConfirm(false)} className="btn-ghost text-white/40 p-1">
                    <X size={16} />
                  </button>
                </div>
                <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-sm text-amber-300 leading-relaxed">
                  This will overwrite your current wallet data. Make sure you have your WIF key or backup file before continuing.
                </div>
                <p className="text-xs text-white/40 font-mono truncate">{restoreBackupPath}</p>
                <div className="flex gap-3">
                  <button onClick={() => setShowRestoreBackupConfirm(false)} className="btn-secondary flex-1">Cancel</button>
                  <button
                    disabled={restoringBackup}
                    onClick={async () => {
                      setRestoringBackup(true);
                      try {
                        await wallet.restoreBackup(restoreBackupPath);
                        toast.success('Wallet restored from backup');
                        setShowRestoreBackupConfirm(false);
                        loadData();
                      } catch (e) {
                        toast.error(String(e));
                      } finally {
                        setRestoringBackup(false);
                      }
                    }}
                    className="btn-primary flex-1 flex items-center justify-center gap-2"
                  >
                    {restoringBackup ? <Loader2 size={14} className="animate-spin" /> : null}
                    Restore Wallet
                  </button>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Address card ──────────────────────────────────────────────
// When mounted in management contexts (the old standalone list), all three
// callbacks (onSelect, onSetPrimary, onRemove) are wired and the row shows
// the Set-Primary button + Hide button + WIF-Export button.
// When mounted as a quick-view row on the main Wallet page, only onSelect
// is wired — the row shows just the badge / address / balance / copy
// affordance. Management actions live in the Manage Wallets drawer.
function AddressCard({
  addr,
  index,
  isPrimary,
  isActive,
  onSelect,
  onRemove,
  onSetPrimary,
}: {
  addr: AddressInfo;
  index: number;
  isPrimary: boolean;
  // (consumed below via getAddressBadgeText — reads addressLabels from store)
  isActive: boolean;
  onSelect: () => void;
  onRemove?: () => void;
  onSetPrimary?: () => void;
}) {
  const [exportingWif, setExportingWif] = useState(false);
  // Read labels from store so the badge stays in sync with edits made in
  // the Manage Wallets panel.
  const addressLabels = useStore((s) => s.addressLabels);
  const badgeText = getAddressBadgeText(addr.address, index, addressLabels);

  const handleExportWif = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setExportingWif(true);
    try {
      const outPath = await saveDialog({
        title: 'Export WIF Private Key',
        defaultPath: `${addr.address.slice(0, 8)}-wif.txt`,
        filters: [{ name: 'Text', extensions: ['txt'] }],
      });
      if (!outPath) return;
      await wallet.exportWif(addr.address, outPath as string);
      toast.success('WIF key exported');
    } catch (e) {
      toast.error(String(e));
    } finally {
      setExportingWif(false);
    }
  };

  // Plain <div> instead of <motion.div variants={itemVariants}> — the
  // staggered entrance animation was visibly flickering the primary card
  // (index 0, 0ms delay) every time the poller produced a new address-array
  // reference. Layout is stable once mounted, so no entrance animation is
  // needed; hover/active states are still handled by the card-interactive
  // class.
  //
  // Click handler contract: invokes ONLY the onSelect callback (which the
  // main-page caller wires to setActiveAddrIdx). It must not reorder the
  // addresses array or change which address is primary. The arrow wrapper
  // explicitly drops the event object so onSelect can never be accidentally
  // overloaded to do more than swap the active index.
  return (
    <div
      role="button"
      tabIndex={0}
      className={clsx(
        "card-interactive cursor-pointer flex items-center gap-4 px-4 py-3.5",
        isActive && "ring-1 ring-irium-400/40"
      )}
      onClick={() => onSelect()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      {/* Left: badge + full address + label */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {/* Badge column — fixed width so addresses align across rows */}
        <div className="flex-shrink-0" style={{ width: 92 }}>
          {isPrimary ? (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-display font-bold uppercase"
              style={{
                background: 'linear-gradient(135deg, rgba(59,59,255,0.20) 0%, rgba(110,198,255,0.16) 50%, rgba(167,139,250,0.20) 100%)',
                border: '1px solid rgba(110,198,255,0.40)',
                color: '#6ec6ff',
                letterSpacing: '0.10em',
              }}
            >
              <Star size={9} fill="currentColor" /> {badgeText}
            </span>
          ) : onSetPrimary ? (
            <button
              onClick={(e) => { e.stopPropagation(); onSetPrimary(); }}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-display font-bold uppercase transition-colors"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.10)',
                color: 'rgba(238,240,255,0.55)',
                letterSpacing: '0.10em',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background   = 'rgba(110,198,255,0.10)';
                e.currentTarget.style.borderColor  = 'rgba(110,198,255,0.40)';
                e.currentTarget.style.color        = '#6ec6ff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background   = 'rgba(255,255,255,0.04)';
                e.currentTarget.style.borderColor  = 'rgba(255,255,255,0.10)';
                e.currentTarget.style.color        = 'rgba(238,240,255,0.55)';
              }}
              title="Set as primary"
            >
              <Star size={9} /> Set Primary
            </button>
          ) : (
            /* View-only — uses the same shared formatter so a custom
               label shows here too (e.g. "Mining" instead of "Addr 2"). */
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-display font-bold uppercase"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.10)',
                color: 'rgba(238,240,255,0.55)',
                letterSpacing: '0.10em',
              }}
            >
              {badgeText}
            </span>
          )}
        </div>

        {/* Full address (mono) — flexes to fill available width; wraps
            via break-all when needed so the full hash is always visible,
            matching the hero and Manage panel rendering. */}
        <div className="min-w-0 flex-1">
          <div
            className="font-mono text-sm text-white/85 break-all leading-snug"
            title={addr.address}
          >
            {addr.address}
          </div>
        </div>
      </div>

      {/* Right: balance + actions */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <div
          className="font-display font-bold text-sm tabular-nums"
          style={{
            background: 'linear-gradient(90deg, #d4eeff 0%, #6ec6ff 55%, #a78bfa 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          {addr.balance !== undefined ? formatIRM(addr.balance) : "—"}
        </div>
        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(addr.address); toast.success("Address copied"); }}
            className="btn-ghost p-1.5 text-white/40 hover:text-white"
            title="Copy address"
          >
            <Copy size={13} />
          </button>
          {/* WIF export + Hide live only in management contexts. The
              presence of either callback signals "this row is in a
              management view"; in the quick-view list both are omitted
              and only Copy renders. */}
          {(onRemove || onSetPrimary) && (
            <button
              onClick={handleExportWif}
              disabled={exportingWif}
              className="btn-ghost p-1.5 text-white/40 hover:text-amber-400"
              title="Export WIF key"
            >
              {exportingWif ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            </button>
          )}
          {onRemove && (
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              className="btn-ghost p-1.5 text-white/40 hover:text-amber-400"
              title="Hide address (stays in wallet file, removable from view)"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Transaction row ───────────────────────────────────────────
function TxRow({ tx, onClick }: { tx: Transaction; onClick: () => void }) {
  const navigate = useNavigate();
  const isSend = tx.direction === "send";
  const isCoinbase = tx.is_coinbase === true;
  // Type-specific styling. Coinbase wins over the send/receive direction —
  // mining rewards are conceptually different from a regular incoming tx.
  const typeLabel = isCoinbase ? "Mining Reward" : isSend ? "Sent" : "Received";
  const typeColor = isCoinbase ? "text-green-400" : isSend ? "text-red-400" : "text-green-400";
  const typeBg    = isCoinbase ? "bg-green-500/10" : isSend ? "bg-red-500/10" : "bg-green-500/10";
  const TypeIcon  = isCoinbase ? Pickaxe : isSend ? ArrowUpRight : ArrowDownLeft;

  // Confirmations — single source of truth shared with the detail modal.
  const currentTip = useStore((s) => s.nodeStatus?.height) ?? 0;
  const confirmations = tx.height
    ? computeConfirmations(tx.height, currentTip)
    : tx.confirmations;
  const isConfirmed = confirmations > 0;

  const goToBlock = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!tx.height) return;
    navigate("/explorer", { state: { searchTab: "block", searchQ: String(tx.height) } });
  };

  const copyTxid = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(tx.txid);
    toast.success("TXID copied");
  };

  // Middle-truncate helper. Uses three literal dots (not ellipsis char) to
  // match the spec format ("Q8Ni6T...vaLa", "6a133c3a...1c2b6").
  const shortMid = (s: string, head: number, tail: number) =>
    s.length <= head + tail + 3 ? s : `${s.slice(0, head)}...${s.slice(-tail)}`;

  // Type-specific detail tail rendered after "Block #N" (or the full
  // mempool string when the tx isn't yet in a block). The full miner
  // address and full TXID stay accessible — full TXID is shown on Row 2
  // below, and the detail modal exposes the full miner address.
  const detailTail = (() => {
    if (!tx.height) return "Mempool · awaiting confirmation";
    const parts: string[] = [];
    if (isCoinbase) {
      if (tx.address) parts.push(`Miner: ${shortMid(tx.address, 6, 4)}`);
    } else if (isSend) {
      if (tx.fee != null && tx.fee > 0) parts.push(`Fee: ${tx.fee.toLocaleString()} sats`);
      parts.push(`TXID: ${shortMid(tx.txid, 8, 5)}`);
    } else {
      parts.push(`TXID: ${shortMid(tx.txid, 8, 5)}`);
    }
    parts.push(`${confirmations} conf`);
    return parts.join(" · ");
  })();

  return (
    <div
      className="px-4 py-3 cursor-pointer hover:bg-white/[0.03] transition-colors border-b border-white/[0.04] last:border-b-0"
      onClick={onClick}
    >
      {/* ── Row 1 — three flex children:
          LEFT: icon + type label + clickable Block# + truncating detail tail,
                content-sized so it doesn't leave empty space to the right.
          MIDDLE: a dotted leader (`flex-1 border-b border-dotted`) that
                  visually fills the gap between LEFT and RIGHT.
          RIGHT: amount + status badge + confirmations, fixed cluster. */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
          <div className={clsx("w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0", typeBg)}>
            <TypeIcon size={11} className={typeColor} />
          </div>
          <div className="flex items-baseline gap-1.5 min-w-0 whitespace-nowrap overflow-hidden">
            <span className={clsx("font-display font-semibold text-sm flex-shrink-0", typeColor)}>
              {typeLabel}
            </span>
            {tx.height && (
              <>
                <span className="text-white/20 flex-shrink-0">·</span>
                <button
                  onClick={goToBlock}
                  className="text-xs hover:underline flex-shrink-0"
                  style={{ color: '#6ec6ff' }}
                  title="Open in Explorer"
                >
                  Block #{tx.height.toLocaleString()}
                </button>
              </>
            )}
            <span className="text-white/20 flex-shrink-0">·</span>
            <span className="truncate text-xs text-white/50">{detailTail}</span>
          </div>
        </div>

        <div className="flex-1 self-center border-b border-dotted border-white/15" aria-hidden="true" />

        <div className="flex items-center gap-3 flex-shrink-0">
          <span className={clsx("font-display font-semibold text-sm tabular-nums whitespace-nowrap", typeColor)}>
            {isSend ? "−" : "+"}{formatIRM(Math.abs(tx.amount))}
          </span>
          <span className={clsx("badge", isConfirmed ? "badge-success" : "badge-warning")}>
            {isConfirmed ? "Confirmed" : "Pending"}
          </span>
          <span className="font-mono text-xs text-white/45 tabular-nums">
            {confirmations}
          </span>
        </div>
      </div>

      {/* ── Row 2 — full TXID + inline copy. 32px left padding so the hex
          starts under the type label rather than under the icon.
          break-all wraps the long hex on narrow windows. */}
      <div
        className="mt-1.5 flex items-start gap-1.5 text-[10px] font-mono opacity-40 leading-snug"
        style={{ paddingLeft: 32 }}
      >
        <span className="break-all min-w-0" title={tx.txid}>{tx.txid}</span>
        <button
          onClick={copyTxid}
          className="text-white/30 hover:text-white/85 transition-colors flex-shrink-0 mt-0.5"
          title="Copy TXID"
        >
          <Copy size={9} />
        </button>
      </div>
    </div>
  );
}

// ── Create / Import Wallet Modal ──────────────────────────────
type CreateWalletTab = 'create' | 'import';
type ImportMethod = 'mnemonic' | 'wif';

function CreateWalletModal({
  defaultTab = 'create',
  defaultImportTab = 'mnemonic',
  restrictToImport = false,
  hideImportTabs = false,
  onClose,
  onSuccess,
}: {
  defaultTab?: CreateWalletTab;
  defaultImportTab?: ImportMethod;
  // When true, the modal renders import-only — no Create/Import tab
  // switcher, no path to wallet.create(). Used by call sites that
  // explicitly mean "restore an existing wallet" (the Security Restore
  // card and the Manage drawer's Seed Phrase / WIF Key imports), so the
  // user can't accidentally land in the create flow from there.
  restrictToImport?: boolean;
  // Companion to restrictToImport. When BOTH are true, also hide the
  // inner Seed Phrase / WIF Key method selector so the modal opens
  // directly to the sub-form selected by defaultImportTab. Has no effect
  // unless restrictToImport is also true (a defensive narrow scope —
  // callers in create mode would never want the method selector hidden).
  hideImportTabs?: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [tab, setTab] = useState<CreateWalletTab>(restrictToImport ? 'import' : defaultTab);
  const [importMethod, setImportMethod] = useState<ImportMethod>(defaultImportTab);

  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<WalletCreateResult | null>(null);
  const [wifValue, setWifValue] = useState('');
  const [wifBlurred, setWifBlurred] = useState(true);
  const [exportingWif, setExportingWif] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [mnemonicWords, setMnemonicWords] = useState<string[]>([]);
  const [mnemonicBlurred, setMnemonicBlurred] = useState(true);

  const [mnemonic, setMnemonic] = useState('');
  const [wif, setWif] = useState('');
  const [importing, setImporting] = useState(false);

  const updateSettings = useStore((s) => s.updateSettings);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const result = await wallet.create();
      setCreateResult(result);
      // NB: we intentionally do NOT call updateSettings({ wallet_path: ... })
      // here. The backend's wallet_create also no longer registers the new
      // wallet as state.wallet_path. Both happen only when the user clicks
      // Done after confirming they saved the seed (see handleDone). This
      // makes cancel-after-create a true rollback: the file on disk gets
      // deleted in handleModalClose, and neither the backend's active path
      // nor the persisted settings ever pointed at it.
      // Mnemonic is returned directly by wallet_create (BIP32 --bip32 mode)
      if (result.mnemonic) setMnemonicWords(result.mnemonic.trim().split(/\s+/));
      // Fetch WIF inline. Pass result.wallet_path explicitly — the newly
      // created wallet is NOT registered as state.wallet_path yet (we
      // defer that to the Done button), so readWif without an explicit
      // path would target the previous wallet and fail.
      try {
        const w = await wallet.readWif(result.address, result.wallet_path);
        if (w) setWifValue(w);
      } catch {}
    } catch (e) {
      toast.error(String(e));
    } finally {
      setCreating(false);
    }
  };

  // Done-button handler — the user has confirmed they saved their seed.
  // Register the new wallet with the backend (state.wallet_path) and the
  // frontend store (settings.wallet_path), then defer to onSuccess which
  // closes the modal and refreshes data.
  // Best-effort setPath — if the backend call fails for some reason we
  // still update the frontend store and proceed, since the wallet file
  // does exist on disk and the next refresh / app restart will pick it up.
  const handleDone = useCallback(async () => {
    if (createResult?.wallet_path) {
      try {
        await wallet.setPath(createResult.wallet_path);
      } catch (e) {
        console.warn('Failed to register new wallet path with backend:', e);
      }
      updateSettings({ wallet_path: createResult.wallet_path });
    }
    onSuccess();
  }, [createResult, updateSettings, onSuccess]);

  // Cancel-after-create cleanup. The wallet file is on disk (wallet_create
  // wrote it), but neither the backend's state.wallet_path nor the frontend's
  // settings.wallet_path was ever pointed at it (we deferred those to
  // handleDone). So a clean cancel just deletes the file and closes the
  // modal — no settings restoration is needed. confirmed === true means the
  // user pressed Done; that path goes through handleDone, not here.
  const handleModalClose = useCallback(async () => {
    if (createResult && !confirmed) {
      try {
        await wallet.deleteFile(createResult.wallet_path);
      } catch (e) {
        console.warn('Failed to delete cancelled wallet:', e);
      }
    }
    onClose();
  }, [createResult, confirmed, onClose]);

  useEffect(() => {
    window.addEventListener('irium:close-modal', handleModalClose);
    return () => window.removeEventListener('irium:close-modal', handleModalClose);
  }, [handleModalClose]);

  const handleExportWif = async () => {
    if (!createResult) return;
    setExportingWif(true);
    try {
      const outPath = await saveDialog({
        title: 'Export WIF Key',
        defaultPath: `${createResult.address.slice(0, 8)}-wif.txt`,
        filters: [{ name: 'Text', extensions: ['txt'] }],
      });
      if (!outPath) return;
      await wallet.exportWif(createResult.address, outPath as string);
      toast.success('WIF key saved');
    } catch (e) {
      toast.error(String(e));
    } finally {
      setExportingWif(false);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      let resolvedPath: string | null = null;
      if (importMethod === 'mnemonic') {
        const words = mnemonic.trim();
        if (words.split(/\s+/).length < 12) { toast.error("Enter at least 12 mnemonic words"); setImporting(false); return; }
        resolvedPath = await wallet.importMnemonic(words);
      } else {
        if (!wif.trim()) { toast.error("Enter a WIF key"); setImporting(false); return; }
        resolvedPath = await wallet.importWif(wif.trim());
      }
      if (resolvedPath) {
        updateSettings({ wallet_path: resolvedPath });
        // Belt-and-suspenders: explicitly tell Rust about the new active
        // wallet path. The App.tsx useEffect that mirrors settings.wallet_path
        // to Rust runs AFTER React commits — but onSuccess() below kicks off
        // loadData() which talks to Rust immediately, creating a race where
        // loadData reads the OLD wallet. Awaiting setPath here closes that
        // window so loadData always sees the freshly-imported wallet.
        await wallet.setPath(resolvedPath);
      }
      toast.success("Wallet imported successfully");
      onSuccess();
    } catch (e) {
      toast.error(String(e));
      setImporting(false);
    }
  };


  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    color: 'rgba(255,255,255,0.30)',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    fontFamily: '"Space Grotesk", sans-serif',
    marginBottom: 6,
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 z-40"
        /* Backdrop is non-dismissible after wallet creation so the user
           can't accidentally lose the displayed mnemonic. Pre-create it
           routes through handleModalClose for consistency, but the
           cleanup branch only fires when createResult is set, so this is
           equivalent to onClose for the pre-create case. */
        onClick={createResult ? undefined : handleModalClose}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 8 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="glass-heavy rounded-2xl p-6 w-full max-w-lg pointer-events-auto max-h-[90vh] overflow-y-auto"
        >
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-display font-bold text-lg text-white flex items-center gap-2">
              <Wallet size={18} className="text-irium-400" />
              {tab === 'create' ? 'Create Wallet' : 'Import Wallet'}
            </h2>
            <button onClick={handleModalClose} className="btn-ghost text-white/40 p-1"><X size={16} /></button>
          </div>

          {/* Tab switcher hidden when restrictToImport === true so callers
              that mean "restore an existing wallet" never expose the
              create flow. With the switcher absent, `tab` is pinned to
              its initial 'import' value (see initial-state derivation
              in useState above). */}
          {!createResult && !restrictToImport && (
            <div className="flex gap-1 mb-5 p-1 bg-white/5 rounded-xl">
              {(['create', 'import'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={clsx(
                    "flex-1 py-2 px-3 rounded-lg text-sm font-display font-medium transition-all duration-150",
                    tab === t ? "bg-irium-600/50 text-irium-200 shadow-sm" : "text-white/40 hover:text-white/60"
                  )}
                >
                  {t === 'create' ? 'Create New' : 'Import'}
                </button>
              ))}
            </div>
          )}

          <AnimatePresence mode="wait">
            {tab === 'create' && (
              <motion.div key="create" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.15 }}>
                {!createResult ? (
                  <div className="space-y-4 text-center py-4">
                    <p className="text-sm text-white/40 leading-relaxed">
                      Generate a new BIP39 wallet with a 24-word recovery phrase.
                    </p>
                    <button
                      onClick={handleCreate}
                      disabled={creating}
                      className="btn-primary gap-2 mx-auto"
                    >
                      {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                      {creating ? 'Creating…' : 'Create New Wallet'}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                      <span className="text-amber-400 text-xs leading-relaxed">
                        Save your 24-word recovery phrase offline — it can restore your full wallet. Your WIF key backs up a single address. Neither can be recovered if lost.
                      </span>
                    </div>

                    {/* Address */}
                    <div>
                      <div style={labelStyle}>Address</div>
                      <div className="flex items-center justify-center mb-2 p-3 bg-white rounded-xl w-fit mx-auto">
                        <QRCodeSVG value={createResult.address} size={120} />
                      </div>
                      <div className="flex items-center gap-2 p-3 rounded-lg bg-white/5 border border-white/5">
                        <span className="font-mono text-xs text-white/80 break-all flex-1">{createResult.address}</span>
                        <button
                          onClick={() => { navigator.clipboard.writeText(createResult.address); toast.success("Copied"); }}
                          className="btn-ghost p-1 text-white/30 hover:text-white flex-shrink-0"
                        >
                          <Copy size={11} />
                        </button>
                      </div>
                    </div>

                    {/* Recovery Phrase (24 words) — BIP32 wallets */}
                    {mnemonicWords.length > 0 && (
                      <div>
                        <div style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>Recovery Phrase (24 words)</span>
                          <span style={{ color: 'rgba(255,255,255,0.22)', textTransform: 'none', letterSpacing: 'normal', fontSize: 10 }}>(any one phrase restores your wallet)</span>
                        </div>
                        <div className="relative">
                          <div className={`transition-all duration-300 ${mnemonicBlurred ? 'blur-sm select-none pointer-events-none' : ''}`}>
                            <div className="grid grid-cols-4 gap-1">
                              {mnemonicWords.map((word, i) => (
                                <div key={i} className="flex items-center gap-1 p-1.5 rounded bg-white/5 border border-white/5">
                                  <span className="text-[9px] text-white/20 font-mono w-4 text-right flex-shrink-0">{i + 1}</span>
                                  <span className="font-mono text-[11px] text-white/75">{word}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                          {mnemonicBlurred && (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <button onClick={() => setMnemonicBlurred(false)} className="btn-secondary flex items-center gap-2 text-sm">
                                <Eye size={13} /> Reveal
                              </button>
                            </div>
                          )}
                        </div>
                        {!mnemonicBlurred && (
                          <button
                            onClick={() => { navigator.clipboard.writeText(mnemonicWords.join(' ')); toast.success('Recovery phrase copied'); }}
                            className="btn-ghost flex items-center gap-2 text-white/40 hover:text-white mt-1"
                          >
                            <Copy size={11} /> Copy Phrase
                          </button>
                        )}
                      </div>
                    )}

                    {/* WIF key — inline display */}
                    <div>
                      <div style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>WIF Key</span>
                        <span style={{ color: 'rgba(255,255,255,0.22)', textTransform: 'none', letterSpacing: 'normal', fontSize: 10 }}>(your private key in portable format)</span>
                      </div>
                      {wifValue ? (
                        <div className="relative">
                          <div className={clsx("flex items-center gap-2 p-3 rounded-lg bg-white/5 border border-white/5 transition-all duration-300", wifBlurred && "blur-sm select-none pointer-events-none")}>
                            <span className="font-mono text-xs text-white/80 break-all flex-1">{wifValue}</span>
                            <button
                              onClick={() => { navigator.clipboard.writeText(wifValue); toast.success("WIF copied"); }}
                              className="btn-ghost p-1 text-white/30 hover:text-white flex-shrink-0"
                            >
                              <Copy size={11} />
                            </button>
                          </div>
                          {wifBlurred && (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <button onClick={() => setWifBlurred(false)} className="btn-secondary flex items-center gap-2 text-sm">
                                <Eye size={13} /> Reveal
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-white/5 border border-white/5">
                          <Loader2 size={12} className="animate-spin text-white/30" />
                          <span className="text-xs text-white/30">Loading WIF…</span>
                        </div>
                      )}
                      <button
                        onClick={handleExportWif}
                        disabled={exportingWif}
                        className="w-full btn-ghost flex items-center gap-2 justify-start text-white/40 hover:text-white mt-1"
                      >
                        {exportingWif ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                        Export WIF to File
                      </button>
                    </div>

                    {/* Confirmation */}
                    <label className="flex items-center gap-3 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(e) => setConfirmed(e.target.checked)}
                        className="w-4 h-4 rounded cursor-pointer"
                        style={{ accentColor: '#6ec6ff' }}
                      />
                      <span className="text-sm text-white/50 group-hover:text-white/70 transition-colors leading-snug">
                        I have saved my recovery phrase and WIF key securely.
                      </span>
                    </label>

                    <button
                      onClick={handleDone}
                      disabled={!confirmed}
                      className="btn-primary w-full disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Done
                    </button>
                  </div>
                )}
              </motion.div>
            )}

            {tab === 'import' && (
              <motion.div key="import" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.15 }} className="space-y-4">
                {/* Non-destructive import notice — explains that the imported
                    wallet lands in a new slot (wallet-N.json) and the user's
                    current wallet stays intact. Without this banner, users
                    feared imports would overwrite their active wallet (and
                    in older builds they did — fixed in v1.0.5). */}
                <div className="flex items-start gap-2 p-3 rounded-lg" style={{ background: 'rgba(110,198,255,0.06)', border: '1px solid rgba(110,198,255,0.18)' }}>
                  <Shield size={13} className="mt-0.5 flex-shrink-0" style={{ color: '#6ec6ff' }} />
                  <p className="text-xs leading-relaxed" style={{ color: 'rgba(238,240,255,0.65)' }}>
                    This will import a new wallet. Your current wallet remains untouched and can be switched back from <span className="font-semibold">Manage Wallets</span>.
                  </p>
                </div>

                {/* Method selector — hidden when restrictToImport && hideImportTabs
                    so callers that picked a specific import method (Restore Seed
                    Phrase, Restore WIF Key, etc.) open directly to that sub-form.
                    With the selector absent, importMethod stays pinned to its
                    initial value (defaultImportTab) for the lifetime of the modal. */}
                {!(restrictToImport && hideImportTabs) && (
                  <div className="flex gap-2 flex-wrap">
                    {(['mnemonic', 'wif'] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setImportMethod(m)}
                        className={clsx(
                          "flex items-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-display font-medium transition-all border",
                          importMethod === m
                            ? "border-irium-500/50 bg-irium-600/20 text-irium-300"
                            : "border-white/10 text-white/40 hover:text-white/60 hover:border-white/20"
                        )}
                      >
                        {m === 'mnemonic' ? <><FileText size={11} /> Seed Phrase</> : <><KeyRound size={11} /> WIF Key</>}
                      </button>
                    ))}
                  </div>
                )}

                {importMethod === 'mnemonic' ? (
                  <div className="space-y-2">
                    <label className="label">Seed Phrase (12 or 24 words)</label>
                    <textarea
                      autoFocus
                      rows={4}
                      className="input resize-none font-mono text-sm"
                      placeholder="word1 word2 word3 …"
                      value={mnemonic}
                      onChange={(e) => setMnemonic(e.target.value)}
                    />
                    <p className="text-white/30 text-xs">BIP39 recovery phrase separated by spaces.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label className="label">WIF Key <span className="text-white/30 font-normal normal-case" style={{ letterSpacing: 'normal' }}>(your private key in portable format)</span></label>
                    <input
                      autoFocus
                      className="input font-mono text-sm"
                      placeholder="5J… or K… or L…"
                      value={wif}
                      onChange={(e) => setWif(e.target.value)}
                    />
                    <p className="text-white/30 text-xs">Wallet Import Format — starts with 5, K, or L.</p>
                  </div>
                )}

                <div className="flex gap-3">
                  <button onClick={onClose} className="btn-secondary flex-1 justify-center">Cancel</button>
                  <button
                    onClick={handleImport}
                    disabled={importing}
                    className="btn-primary flex-1 justify-center gap-2"
                  >
                    {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    Import
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </>
  );
}

// ── Send Modal ────────────────────────────────────────────────
function SendModal({
  onClose,
  onSuccess,
  availableBalance,
}: {
  onClose: () => void;
  onSuccess: () => void;
  availableBalance: number; // sats
}) {
  const [sendTo, setSendTo] = useState("");
  const [sendAmountIrm, setSendAmountIrm] = useState("");
  const [sendStep, setSendStep] = useState<"form" | "confirm" | "success">("form");
  const [sendLoading, setSendLoading] = useState(false);
  const [addrError, setAddrError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentTxid, setSentTxid] = useState<string | null>(null);
  const navigate = useNavigate();

  const parsedIrm = parseFloat(sendAmountIrm);
  const amountSats = !isNaN(parsedIrm) && parsedIrm > 0 ? Math.round(parsedIrm * SATS_PER_IRM) : 0;
  const insufficientFunds = amountSats > 0 && amountSats > availableBalance;
  const noFunds = availableBalance === 0;

  const validateAddress = (addr: string): boolean => {
    if (!addr) return false;
    if (!/^[QP]/.test(addr)) { setAddrError("Address must start with Q or P"); return false; }
    if (addr.length < 30 || addr.length > 40) { setAddrError("Invalid address length"); return false; }
    setAddrError(null);
    return true;
  };

  useEffect(() => {
    const handler = () => sendStep === "success" ? onSuccess() : onClose();
    window.addEventListener('irium:close-modal', handler);
    return () => window.removeEventListener('irium:close-modal', handler);
  }, [onClose, onSuccess, sendStep]);

  const handleConfirmSend = async () => {
    if (!sendTo || !sendAmountIrm) return;
    setSendLoading(true);
    setSendError(null);
    try {
      const result: SendResult = await wallet.send(sendTo, amountSats);
      setSentTxid(result.txid);
      setSendStep("success");
      setSendLoading(false);
    } catch (e) {
      const raw = String(e).toLowerCase();
      let msg: string;
      if (raw.includes('insufficient funds') || raw.includes('insufficient balance') || raw.includes('not enough')) {
        msg = 'You do not have enough IRM to complete this transaction. Check your balance and try a smaller amount.';
      } else if (raw.includes('no spendable') || raw.includes('no utxo') || raw.includes('no outputs') || raw.includes('unspent')) {
        msg = 'Your funds are not yet confirmed. Wait for at least 1 confirmation before sending.';
      } else if (raw.includes('double spend') || raw.includes('already spent') || raw.includes('txn-mempool-conflict')) {
        msg = 'This transaction conflicts with another pending transaction. Please wait and try again.';
      } else {
        // Strip raw hex blobs and reject any messages containing mining vocabulary
        const stripped = String(e).replace(/\b[0-9a-fA-F]{16,}\b/g, '').trim();
        msg = /\b(share|nonce|difficulty|hashrate|proof.of.work|submitted)\b/i.test(String(e)) || stripped.length > 200
          ? 'Transaction could not be broadcast. Please check that the node is online and try again.'
          : stripped || 'Transaction failed. Please try again.';
      }
      setSendError(msg);
      setSendLoading(false);
    }
  };

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 z-40" onClick={sendStep === "success" ? onSuccess : onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 8 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="glass-heavy rounded-2xl p-6 w-full max-w-lg pointer-events-auto"
        >
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-display font-bold text-lg text-white">Send IRM</h2>
            <button onClick={sendStep === "success" ? onSuccess : onClose} className="btn-ghost text-white/40 p-1"><X size={16} /></button>
          </div>

          {/* Available balance */}
          <div className={`font-mono text-xs mb-5 ${noFunds ? 'text-amber-400' : 'text-white/35'}`}>
            Available: {formatIRM(availableBalance)}{noFunds ? ' — No spendable funds' : ''}
          </div>

          <AnimatePresence mode="wait">
            {sendStep === "form" ? (
              <motion.div key="form" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }} className="space-y-4">
                <div>
                  <label htmlFor="send-to" className="label">To Address <span className="text-red-400">*</span></label>
                  <input
                    id="send-to" autoFocus
                    className={`input ${addrError ? 'border-red-500/60' : ''}`}
                    placeholder="Q… or P… address"
                    value={sendTo}
                    onChange={(e) => { setSendTo(e.target.value); if (addrError) validateAddress(e.target.value); }}
                    onBlur={(e) => { if (e.target.value) validateAddress(e.target.value); }}
                  />
                  {addrError && <p className="text-red-400 text-xs mt-1">{addrError}</p>}
                </div>
                <div>
                  <label htmlFor="send-amount" className="label">Amount (IRM) <span className="text-red-400">*</span></label>
                  <input
                    id="send-amount"
                    className={`input ${insufficientFunds ? 'border-red-500/60' : ''}`}
                    type="number" min="0" step="0.0001" placeholder="0.0000"
                    value={sendAmountIrm}
                    onChange={(e) => setSendAmountIrm(e.target.value)}
                  />
                  {sendAmountIrm && !insufficientFunds && (
                    <div className="text-white/30 font-mono text-xs mt-1">
                      = {amountSats.toLocaleString('en-US')} sats
                    </div>
                  )}
                  {insufficientFunds && (
                    <p className="text-red-400 text-xs mt-1">
                      Insufficient funds. You have {formatIRM(availableBalance)} available.
                    </p>
                  )}
                </div>
                <div className="text-white/30 text-xs font-mono">Estimated fee: ~1,000 sats</div>
                <div className="flex gap-3 pt-1">
                  <button onClick={onClose} className="btn-secondary flex-1 justify-center">Cancel</button>
                  <button
                    onClick={() => {
                      const amt = parseFloat(sendAmountIrm);
                      if (isNaN(amt) || amt <= 0) { toast.error('Enter a valid positive amount'); return; }
                      if (validateAddress(sendTo)) setSendStep("confirm");
                    }}
                    disabled={!sendTo || !sendAmountIrm || insufficientFunds}
                    className="btn-primary flex-1 justify-center"
                  >
                    Review →
                  </button>
                </div>
              </motion.div>
            ) : sendStep === "confirm" ? (
              <motion.div key="confirm" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }} className="space-y-4">
                <div className="card p-4 space-y-3">
                  <div className="text-white/50 text-sm font-display">
                    Send <span className="gradient-text font-bold">{sendAmountIrm} IRM</span> to
                  </div>
                  <div className="font-mono text-sm text-white/80 break-all">{sendTo}</div>
                  <div className="border-t border-white/5 pt-3 space-y-1.5">
                    <div className="flex justify-between text-xs text-white/40">
                      <span>Amount (sats)</span>
                      <span className="font-mono">{amountSats.toLocaleString('en-US')}</span>
                    </div>
                    <div className="flex justify-between text-xs text-white/40">
                      <span>Estimated fee</span>
                      <span className="font-mono">~1,000 sats</span>
                    </div>
                  </div>
                </div>

                {/* Inline error from failed send */}
                {sendError && (
                  <div className="flex items-start gap-2.5 p-3 rounded-xl bg-red-500/10 border border-red-500/25">
                    <span className="text-red-400 text-xs leading-relaxed">{sendError}</span>
                  </div>
                )}

                {/* No funds warning */}
                {noFunds && (
                  <div className="text-xs text-amber-400/80 text-center">
                    This wallet has no spendable funds.
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={() => { setSendStep("form"); setSendError(null); }}
                    className="btn-secondary flex-1 justify-center"
                    disabled={sendLoading}
                  >
                    ← Back
                  </button>
                  <button
                    onClick={handleConfirmSend}
                    disabled={sendLoading || noFunds}
                    className="btn-primary flex-1 justify-center"
                  >
                    {sendLoading ? <Loader2 size={14} className="animate-spin" /> : null}
                    Confirm Send
                  </button>
                </div>
              </motion.div>
            ) : (
              /* ── Success step ──────────────────────────────────────────── */
              <motion.div key="success" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }} className="space-y-5">
                <div className="flex flex-col items-center gap-3 pt-2 pb-1">
                  <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
                    <Check size={26} className="text-emerald-400" />
                  </div>
                  <div className="text-center space-y-1">
                    <div className="font-display font-bold text-white text-lg">Transaction Sent</div>
                    <div className="text-white/40 text-xs">Your transaction will appear in the next block</div>
                  </div>
                </div>

                <div>
                  <div className="label mb-1.5">Transaction ID</div>
                  <div className="card p-3 flex items-start gap-2.5">
                    <span className="font-mono text-xs text-white/70 break-all flex-1 select-all leading-relaxed">{sentTxid}</span>
                    <button
                      onClick={() => { navigator.clipboard.writeText(sentTxid ?? ''); toast.success('Transaction ID copied'); }}
                      className="shrink-0 p-1 text-white/35 hover:text-white/70 transition-colors"
                      title="Copy transaction ID"
                    >
                      <Copy size={13} />
                    </button>
                  </div>
                </div>

                <div className="flex gap-3 pt-1">
                  <button
                    onClick={() => { navigate('/explorer', { state: { searchTab: 'tx', searchQ: sentTxid } }); onSuccess(); }}
                    className="btn-secondary flex-1 justify-center gap-1.5"
                  >
                    <ArrowUpRight size={14} />
                    View in Explorer
                  </button>
                  <button onClick={onSuccess} className="btn-primary flex-1 justify-center">
                    Done
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </>
  );
}

// ── Receive Modal ─────────────────────────────────────────────
function ReceiveModal({ address, onClose }: { address: string; onClose: () => void }) {
  useEffect(() => {
    const handler = () => onClose();
    window.addEventListener('irium:close-modal', handler);
    return () => window.removeEventListener('irium:close-modal', handler);
  }, [onClose]);

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 8 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="glass-heavy rounded-2xl p-6 w-full max-w-lg pointer-events-auto"
        >
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-display font-bold text-lg text-white">Receive IRM</h2>
            <button onClick={onClose} className="btn-ghost text-white/40 p-1"><X size={16} /></button>
          </div>
          <div className="text-center space-y-4">
            <div className="text-white/40 text-sm">Send IRM to this address:</div>
            {address ? (
              <div className="flex items-center justify-center p-3 bg-white rounded-xl mx-auto w-fit">
                <QRCodeSVG value={address} size={180} />
              </div>
            ) : (
              <div className="w-48 h-48 border-2 border-irium-500/30 rounded-xl flex items-center justify-center mx-auto glass">
                <span className="text-white/30 text-xs">No address</span>
              </div>
            )}
            <div className="font-mono text-sm text-white/80 bg-surface-700 rounded-lg p-3 break-all">
              {address || "No address available"}
            </div>
            <button
              onClick={() => { if (address) { navigator.clipboard.writeText(address); toast.success("Address copied"); } }}
              className="btn-primary mx-auto gap-2"
              disabled={!address}
            >
              <Copy size={14} /> Copy Address
            </button>
          </div>
        </motion.div>
      </div>
    </>
  );
}

// ── New address details modal ───────────────────────────────────────────────
// Shown after "+ Add Address" succeeds. The mnemonic is shared by the whole
// BIP32 wallet file and does not change when an address is derived, so this
// modal omits the recovery phrase and shows only this address's material.
function NewAddressModal({
  info,
  onClose,
  onShowRecoveryPhrase,
}: {
  info: { address: string; wif?: string };
  onClose: () => void;
  onShowRecoveryPhrase?: () => void;
}) {
  const [revealWif, setRevealWif] = useState(false);
  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 8 }}
          transition={{ duration: 0.2 }}
          className="pointer-events-auto w-full max-w-lg p-6 space-y-5"
          style={{
            background: 'rgba(2,5,14,0.97)',
            border: '1px solid rgba(110,198,255,0.30)',
            borderRadius: 16,
            boxShadow: '0 24px 64px rgba(0,0,0,0.7), 0 0 0 1px rgba(110,198,255,0.06)',
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{
                  background: 'linear-gradient(135deg, #3b3bff 0%, #6ec6ff 50%, #a78bfa 100%)',
                  boxShadow: '0 0 18px rgba(110,198,255,0.30)',
                }}
              >
                <Plus size={18} color="#fff" />
              </div>
              <h2 className="font-display font-bold text-lg gradient-text">New Address</h2>
            </div>
            <button onClick={onClose} className="btn-ghost text-white/40 p-1"><X size={16} /></button>
          </div>

          <p className="text-xs leading-relaxed" style={{ color: 'rgba(238,240,255,0.55)' }}>
            A fresh address has been derived from your wallet's BIP32 seed.
            Your <strong className="text-white">recovery phrase has not changed</strong> — this address
            shares the same wallet file as your existing addresses.
          </p>

          {/* QR */}
          <div className="flex flex-col items-center gap-3 p-4 rounded-xl" style={{ background: 'rgba(0,0,0,0.40)', border: '1px solid rgba(110,198,255,0.14)' }}>
            <div className="bg-white p-2.5 rounded-lg">
              <QRCodeSVG value={info.address} size={156} bgColor="#ffffff" fgColor="#02050E" level="M" />
            </div>
            <div className="font-mono text-[11px] text-white/80 break-all text-center px-2">{info.address}</div>
            <button
              onClick={() => { navigator.clipboard.writeText(info.address); toast.success('Address copied'); }}
              className="btn-ghost text-xs gap-1.5"
            >
              <Copy size={12} /> Copy address
            </button>
          </div>

          {/* WIF */}
          {info.wif && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-display font-bold uppercase" style={{ color: 'rgba(110,198,255,0.55)', letterSpacing: '0.14em' }}>
                  WIF Private Key
                </span>
                <button
                  onClick={() => setRevealWif(v => !v)}
                  className="btn-ghost text-[10px] gap-1.5"
                  style={{ color: revealWif ? 'rgba(238,240,255,0.50)' : '#fbbf24' }}
                >
                  {revealWif ? <><EyeOff size={11} /> Hide</> : <><Eye size={11} /> Reveal</>}
                </button>
              </div>
              <div
                className={clsx('font-mono text-xs rounded-lg p-3 break-all transition-all', !revealWif && 'blur-sm select-none')}
                style={{ background: 'rgba(0,0,0,0.40)', border: '1px solid rgba(110,198,255,0.14)', color: 'rgba(238,240,255,0.85)' }}
              >
                {info.wif}
              </div>
              {revealWif && (
                <div className="flex items-start gap-2 p-2.5 rounded-lg" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.22)' }}>
                  <span className="text-[11px] leading-relaxed" style={{ color: '#fbbf24' }}>
                    Anyone with this WIF can spend funds at this address. Store it offline.
                  </span>
                </div>
              )}
              {revealWif && (
                <button
                  onClick={() => { navigator.clipboard.writeText(info.wif!); toast.success('WIF copied'); }}
                  className="btn-ghost text-xs gap-1.5"
                >
                  <Copy size={12} /> Copy WIF
                </button>
              )}
            </div>
          )}

          {/* Recovery-phrase reminder — shared by the whole BIP32 wallet,
              not derived per-address. The link closes this modal and triggers
              the same Show Recovery Phrase action as the Security panel so
              the user can confirm their backup without leaving this flow. */}
          {onShowRecoveryPhrase && (
            <div
              className="flex items-start gap-3 p-3 rounded-xl"
              style={{ background: 'rgba(110,198,255,0.06)', border: '1px solid rgba(110,198,255,0.22)' }}
            >
              <Shield size={14} className="flex-shrink-0 mt-0.5" style={{ color: '#6ec6ff' }} />
              <div className="flex-1 text-xs leading-relaxed" style={{ color: 'rgba(238,240,255,0.65)' }}>
                This address shares your wallet recovery phrase. To view it, go to{' '}
                <span className="text-white/85">Security → Show Recovery Phrase</span>.
                <button
                  onClick={() => { onClose(); onShowRecoveryPhrase(); }}
                  className="ml-1 underline underline-offset-2 transition-colors"
                  style={{ color: '#6ec6ff' }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#a78bfa')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = '#6ec6ff')}
                >
                  Show Recovery Phrase
                </button>
              </div>
            </div>
          )}

          <button onClick={onClose} className="btn-primary w-full">Done</button>
        </motion.div>
      </div>
    </>
  );
}

// EyeOff is needed by NewAddressModal — re-import locally to avoid touching
// the giant top-level import block.
function EyeOff(props: { size?: number }) {
  const s = props.size ?? 12;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

// ── Address QR modal — small popup showing one address as QR ────────────────
function AddressQrModal({ address, onClose }: { address: string; onClose: () => void }) {
  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 pointer-events-none">
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.92 }}
          transition={{ duration: 0.18 }}
          className="pointer-events-auto p-6 space-y-3"
          style={{
            background: 'rgba(2,5,14,0.97)',
            border: '1px solid rgba(110,198,255,0.30)',
            borderRadius: 14,
            boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
          }}
        >
          <div className="flex items-center justify-between gap-4">
            <span className="text-[10px] font-display font-bold uppercase" style={{ color: 'rgba(110,198,255,0.55)', letterSpacing: '0.14em' }}>Address QR</span>
            <button onClick={onClose} className="btn-ghost text-white/40 p-1"><X size={14} /></button>
          </div>
          <div className="bg-white p-3 rounded-lg">
            <QRCodeSVG value={address} size={200} bgColor="#ffffff" fgColor="#02050E" level="M" />
          </div>
          <div className="font-mono text-[11px] text-white/75 break-all text-center max-w-[220px]">{address}</div>
          <button
            onClick={() => { navigator.clipboard.writeText(address); toast.success('Address copied'); }}
            className="btn-ghost text-xs gap-1.5 w-full justify-center"
          >
            <Copy size={12} /> Copy
          </button>
        </motion.div>
      </div>
    </>
  );
}

// ── Manage Wallets drawer ───────────────────────────────────────────────────
function ManageWalletsPanel({
  walletFiles,
  activeWalletPath,
  addresses,
  activeAddrIdx,
  hiddenAddresses,
  onUnhide,
  onClose,
  onSwitchWallet,
  onCreateNewWalletFile,
  onDeleteWalletFile,
  onRenameWalletFile,
  addressLabels,
  onSetAddressLabel,
  onSetPrimary,
  onRemove,
  onAddAddress,
  onShowQr,
  onImportSeed,
  onImportWif,
  // Security section pass-throughs. The Security UI lives in this drawer
  // now (moved out of the main Wallet page) but the underlying handlers
  // and loading flags live in WalletPage where the related state and
  // modals are mounted. The panel renders the buttons and routes clicks
  // back via these props.
  onShowSeed,
  loadingSeed,
  onExportSecurityWif,
  exportingSecurityWif,
  onBackupFile,
  backingUp,
  onImportBackupFile,
}: {
  walletFiles: import('../lib/types').WalletFileInfo[];
  activeWalletPath: string | null;
  addresses: AddressInfo[];
  activeAddrIdx: number;
  hiddenAddresses: Set<string>;
  onUnhide: (addr: string) => void;
  addressLabels: Record<string, string>;
  onSetAddressLabel: (address: string, label: string) => void;
  onClose: () => void;
  onSwitchWallet: (path: string) => void;
  onCreateNewWalletFile: () => void;
  onDeleteWalletFile: (path: string) => void;
  onRenameWalletFile: (oldPath: string, newName: string) => void;
  onSetPrimary: (idx: number) => void;
  onRemove: (idx: number, address: string) => void;
  onAddAddress: () => void;
  onShowQr: (addr: string) => void;
  onImportSeed: () => void;
  onImportWif: () => void;
  onShowSeed: () => void;
  loadingSeed: boolean;
  onExportSecurityWif: () => void;
  exportingSecurityWif: boolean;
  onBackupFile: () => void;
  backingUp: boolean;
  onImportBackupFile: () => void;
}) {
  const [exportingWifAddr, setExportingWifAddr] = useState<string | null>(null);
  // Per-row delete-confirmation state. Holds the WalletFileInfo of the
  // file the user is in the process of deleting (null when no modal open).
  const [deleteTarget, setDeleteTarget] = useState<import('../lib/types').WalletFileInfo | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  // Wallet inspection for the Delete modal — populated when the modal
  // opens via wallet.getInfo(path). Read-only on the backend (does NOT
  // change the active wallet). null while loading or if the backend call
  // failed; the modal falls back to a generic warning in either case.
  const [deleteTargetInfo, setDeleteTargetInfo] = useState<import('../lib/types').WalletInfo | null>(null);
  const [deleteTargetInfoLoading, setDeleteTargetInfoLoading] = useState(false);
  // Hide-address confirmation state. Replaces the earlier `window.confirm`
  // with a styled modal that matches the rest of the panel — amber tint
  // (reversible action, less destructive than Delete) instead of red.
  const [hideTarget, setHideTarget] = useState<{ idx: number; address: string } | null>(null);
  // Inline editors — at most one open at a time per type.
  // For files: the path of the file being renamed + the working name.
  // For addresses: the address being labeled + the working label.
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameDraft,  setRenameDraft]  = useState('');
  const [labelingAddr, setLabelingAddr] = useState<string | null>(null);
  const [labelDraft,   setLabelDraft]   = useState('');

  // Commit helpers — both use a guard so Enter+Blur doesn't double-fire.
  const renameCommitted = useRef(false);
  const labelCommitted  = useRef(false);
  // Escape-cancel flag for the rename input. Pressing Escape unmounts the
  // input via setRenamingPath(null), which fires the blur handler — without
  // this ref, blur would commit the draft as if the user had pressed Enter.
  // The ref is checked in onBlur and reset when a fresh edit starts.
  const escapedRenameRef = useRef(false);
  const commitRename = (path: string, name: string) => {
    if (renameCommitted.current) return;
    renameCommitted.current = true;
    setRenamingPath(null);
    // Don't fire if the name didn't change (strip .json for comparison).
    const currentName = path.split(/[\\/]/).pop()?.replace(/\.json$/i, '') ?? '';
    if (name.trim() && name.trim() !== currentName) onRenameWalletFile(path, name.trim());
  };
  const commitLabel = (address: string, label: string) => {
    if (labelCommitted.current) return;
    labelCommitted.current = true;
    setLabelingAddr(null);
    onSetAddressLabel(address, label);
  };

  // Inspect the target wallet whenever the Delete modal opens, so the
  // user sees address count + per-address balance + total before they
  // type DELETE. The backend command is read-only — it does NOT change
  // the active wallet. A race is possible if the user closes the modal
  // before the fetch resolves: the `cancelled` flag drops a stale
  // setState that would otherwise leak into a newly-opened modal.
  useEffect(() => {
    if (!deleteTarget) {
      setDeleteTargetInfo(null);
      setDeleteTargetInfoLoading(false);
      return;
    }
    let cancelled = false;
    setDeleteTargetInfo(null);
    setDeleteTargetInfoLoading(true);
    wallet.getInfo(deleteTarget.path)
      .then((info) => { if (!cancelled) setDeleteTargetInfo(info); })
      .catch(() => { /* fall back to generic warning silently */ })
      .finally(() => { if (!cancelled) setDeleteTargetInfoLoading(false); });
    return () => { cancelled = true; };
  }, [deleteTarget]);

  const exportWif = async (addr: string) => {
    setExportingWifAddr(addr);
    try {
      const outPath = await saveDialog({
        title: 'Export WIF Private Key',
        defaultPath: `${addr.slice(0, 8)}-wif.txt`,
        filters: [{ name: 'Text', extensions: ['txt'] }],
      });
      if (!outPath) return;
      await wallet.exportWif(addr, outPath as string);
      toast.success('WIF key exported');
    } catch (e) { toast.error(String(e)); }
    finally { setExportingWifAddr(null); }
  };

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/65 backdrop-blur-sm z-40" onClick={onClose} />
      <motion.aside
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-[520px] flex flex-col"
        style={{
          background: 'rgba(2,5,14,0.97)',
          borderLeft: '1px solid rgba(110,198,255,0.22)',
          boxShadow: '-24px 0 64px rgba(0,0,0,0.6)',
          backdropFilter: 'blur(24px)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid rgba(110,198,255,0.10)' }}>
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, #3b3bff 0%, #6ec6ff 50%, #a78bfa 100%)',
                boxShadow: '0 0 18px rgba(110,198,255,0.28)',
              }}
            >
              <Settings size={16} color="#fff" />
            </div>
            <h2 className="font-display font-bold text-lg gradient-text">Manage Wallets</h2>
          </div>
          <button onClick={onClose} className="btn-ghost text-white/45 p-1.5">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-7">

          {/* ── Section 0: Security ───────────────────────────────────
              Moved from the main Wallet page so backup/restore actions
              live alongside the wallet-file management they relate to.
              All handlers are pass-throughs to WalletPage where the
              related state and modals (seed-reveal, backup-save dialog,
              restore-backup confirmation, CreateWalletModal) are
              mounted. The drawer is 520px wide, so the lg:grid-cols-2
              never triggers in practice — cards stack vertically. */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Shield size={14} style={{ color: '#6ec6ff' }} />
              <h3 className="text-[10px] font-display font-bold uppercase" style={{ color: 'rgba(110,198,255,0.65)', letterSpacing: '0.14em' }}>
                Security
              </h3>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="card p-5 space-y-3">
                <div className="text-sm font-semibold text-white/80">Backup</div>
                <div className="space-y-2">
                  <button
                    onClick={onShowSeed}
                    disabled={loadingSeed}
                    className="w-full btn-ghost flex items-center gap-2 text-white/60 hover:text-white justify-start"
                  >
                    {loadingSeed ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                    Show Recovery Phrase
                  </button>
                  <button
                    onClick={onExportSecurityWif}
                    disabled={exportingSecurityWif || addresses.length === 0}
                    className="w-full btn-ghost flex items-center gap-2 text-white/60 hover:text-white justify-start disabled:opacity-40"
                  >
                    {exportingSecurityWif ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    Export WIF Key
                  </button>
                  <button
                    onClick={onBackupFile}
                    disabled={backingUp}
                    className="w-full btn-ghost flex items-center gap-2 text-white/70 hover:text-white justify-start"
                  >
                    {backingUp ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    Export Backup File
                  </button>
                </div>
              </div>
              <div className="card p-5 space-y-3">
                <div className="text-sm font-semibold text-white/80">Restore</div>
                <div className="space-y-2">
                  <button
                    onClick={onImportSeed}
                    className="w-full btn-ghost flex items-center gap-2 text-white/60 hover:text-white justify-start"
                  >
                    <FileText size={14} /> Seed Phrase
                  </button>
                  <button
                    onClick={onImportWif}
                    className="w-full btn-ghost flex items-center gap-2 text-white/60 hover:text-white justify-start"
                  >
                    <KeyRound size={14} /> WIF Key
                  </button>
                  <button
                    onClick={onImportBackupFile}
                    className="w-full btn-ghost flex items-center gap-2 text-white/70 hover:text-white justify-start"
                  >
                    <Download size={14} /> Import Backup File
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* ── Section 1: Wallet files ─────────────────────────────── */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-[10px] font-display font-bold uppercase" style={{ color: 'rgba(110,198,255,0.65)', letterSpacing: '0.14em' }}>
                  Wallet Files
                </h3>
                <p className="text-[10px] mt-0.5" style={{ color: 'rgba(238,240,255,0.40)' }}>
                  Each file has its own seed. Switch to load a different wallet.
                </p>
              </div>
              <span className="badge badge-irium">{walletFiles.length}</span>
            </div>
            <div className="space-y-2">
              {walletFiles.length === 0 && (
                <div className="panel p-4 text-center text-xs" style={{ color: 'rgba(238,240,255,0.40)' }}>
                  No wallet files found in ~/.irium/
                </div>
              )}
              {walletFiles.map((f) => {
                const isActive = activeWalletPath ? activeWalletPath === f.path : f.is_active;
                return (
                  <div
                    key={f.path}
                    className="flex items-center gap-3 px-4 py-3 rounded-lg transition-colors"
                    style={{
                      background: isActive ? 'rgba(110,198,255,0.08)' : 'rgba(0,0,0,0.30)',
                      border: `1px solid ${isActive ? 'rgba(110,198,255,0.40)' : 'rgba(110,198,255,0.10)'}`,
                    }}
                  >
                    <div className="flex-shrink-0">
                      {isActive
                        ? <span className="dot-live" />
                        : <span className="w-2 h-2 rounded-full bg-white/15 inline-block" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {renamingPath === f.path ? (
                          /* Inline rename input — Enter or blur commits,
                             Esc cancels. The committed.current ref guards
                             against Enter+Blur double-firing. */
                          <input
                            type="text"
                            autoFocus
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename(f.path, renameDraft);
                              else if (e.key === 'Escape') {
                                escapedRenameRef.current = true;
                                setRenamingPath(null);
                              }
                            }}
                            onBlur={() => {
                              if (escapedRenameRef.current) {
                                escapedRenameRef.current = false;
                                return;
                              }
                              commitRename(f.path, renameDraft);
                            }}
                            placeholder="wallet-name"
                            className="font-mono text-xs px-2 py-0.5 rounded outline-none flex-1 min-w-0"
                            style={{
                              background: 'rgba(0,0,0,0.50)',
                              border: '1px solid rgba(110,198,255,0.40)',
                              color: '#fff',
                            }}
                          />
                        ) : (
                          <>
                            <span className="font-mono text-xs text-white/90 truncate">{f.name}</span>
                            <button
                              onClick={() => {
                                renameCommitted.current = false;
                                escapedRenameRef.current = false;
                                setRenameDraft(f.name.replace(/\.json$/i, ''));
                                setRenamingPath(f.path);
                              }}
                              className="opacity-60 hover:opacity-100 transition-opacity"
                              style={{ color: '#6ec6ff' }}
                              title="Rename wallet file"
                            >
                              <Pencil size={10} />
                            </button>
                            {isActive && (
                              <span className="text-[8px] font-display font-bold uppercase px-1.5 py-0.5 rounded-full" style={{ color: '#34d399', background: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.30)', letterSpacing: '0.10em' }}>
                                Active
                              </span>
                            )}
                          </>
                        )}
                      </div>
                      <div className="text-[10px] mt-0.5 font-mono" style={{ color: 'rgba(238,240,255,0.30)' }}>
                        {(f.size / 1024).toFixed(1)} KB · {f.path}
                      </div>
                    </div>
                    {!isActive && (
                      <button
                        onClick={() => onSwitchWallet(f.path)}
                        className="btn-ghost text-[10px] py-1 px-2 gap-1"
                        style={{ color: '#6ec6ff' }}
                      >
                        Switch
                      </button>
                    )}
                    {/* Delete button — rendered for any non-active wallet
                        file. The only rule is: the currently-active wallet
                        cannot be deleted (switch to another wallet first).
                        wallet.json is treated like any other wallet file —
                        if it's not active, it's deletable. We use the SAME
                        `isActive` derived variable that the Active pill and
                        Switch button gates use (`activeWalletPath === f.path`
                        if set, else `f.is_active`) so all three affordances
                        stay in sync across renders. */}
                    {!isActive && (
                      <button
                        onClick={() => { setDeleteTarget(f); setDeleteConfirmText(''); }}
                        className="btn-ghost text-[10px] py-1 px-2 gap-1"
                        style={{ color: '#f87171' }}
                        title="Permanently delete this wallet file"
                      >
                        <Trash2 size={11} /> Delete
                      </button>
                    )}
                  </div>
                );
              })}

              <button
                onClick={onCreateNewWalletFile}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-display font-semibold transition-colors"
                style={{
                  background: 'rgba(0,0,0,0.30)',
                  border: '1px dashed rgba(110,198,255,0.30)',
                  color: 'rgba(110,198,255,0.85)',
                }}
              >
                <Plus size={12} /> Create New Wallet File <span style={{ color: 'rgba(238,240,255,0.40)', fontWeight: 400, marginLeft: 4 }}>(advanced — separate seed)</span>
              </button>
              <p className="text-[10px] leading-relaxed" style={{ color: 'rgba(238,240,255,0.35)' }}>
                Creates a separate wallet file with its own seed. Your current wallet remains on disk and can be switched back to from this list.
              </p>
            </div>
          </section>

          {/* ── Section 2: Addresses (active wallet) ────────────────── */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-[10px] font-display font-bold uppercase" style={{ color: 'rgba(110,198,255,0.65)', letterSpacing: '0.14em' }}>
                  Addresses
                </h3>
                <p className="text-[10px] mt-0.5 leading-relaxed" style={{ color: 'rgba(238,240,255,0.40)' }}>
                  Addresses are derived from your wallet seed and cannot be permanently deleted. Use Hide to remove them from view.
                </p>
              </div>
              <span className="badge badge-irium">{addresses.length}</span>
            </div>

            <div className="space-y-2">
              {addresses.map((addr, idx) => {
                const isPrimary = idx === 0;
                const isActive  = idx === activeAddrIdx;
                const badgeText = getAddressBadgeText(addr.address, idx, addressLabels);
                const editingThis = labelingAddr === addr.address;
                return (
                  <div
                    key={addr.address}
                    className="px-4 py-3 rounded-lg"
                    style={{
                      background: isActive ? 'rgba(110,198,255,0.06)' : 'rgba(0,0,0,0.30)',
                      border: `1px solid ${isActive ? 'rgba(110,198,255,0.30)' : 'rgba(110,198,255,0.10)'}`,
                    }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      {editingThis ? (
                        /* Inline label editor — Enter or blur commits,
                           Esc cancels. Empty value clears any existing
                           label. */
                        <input
                          type="text"
                          autoFocus
                          value={labelDraft}
                          onChange={(e) => setLabelDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitLabel(addr.address, labelDraft);
                            else if (e.key === 'Escape') {
                              labelCommitted.current = true;
                              setLabelingAddr(null);
                            }
                          }}
                          onBlur={() => commitLabel(addr.address, labelDraft)}
                          placeholder={isPrimary ? 'e.g. Primary · Mining' : 'e.g. Mining'}
                          maxLength={32}
                          className="text-[10px] px-2 py-0.5 rounded-full outline-none flex-1 min-w-0"
                          style={{
                            background: 'rgba(0,0,0,0.50)',
                            border: '1px solid rgba(110,198,255,0.40)',
                            color: '#fff',
                          }}
                        />
                      ) : isPrimary ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-display font-bold uppercase" style={{ background: 'linear-gradient(135deg, rgba(59,59,255,0.20) 0%, rgba(110,198,255,0.16) 50%, rgba(167,139,250,0.20) 100%)', border: '1px solid rgba(110,198,255,0.40)', color: '#6ec6ff', letterSpacing: '0.10em' }}>
                          <Star size={8} fill="currentColor" /> {badgeText}
                        </span>
                      ) : (
                        <span className="text-[8px] font-display font-bold uppercase px-1.5 py-0.5 rounded-full" style={{ color: 'rgba(238,240,255,0.40)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', letterSpacing: '0.10em' }}>
                          {badgeText}
                        </span>
                      )}
                      {!editingThis && (
                        <button
                          onClick={() => {
                            labelCommitted.current = false;
                            setLabelDraft(addressLabels[addr.address] ?? '');
                            setLabelingAddr(addr.address);
                          }}
                          className="opacity-60 hover:opacity-100 transition-opacity"
                          style={{ color: '#6ec6ff' }}
                          title={addressLabels[addr.address] ? 'Edit label' : 'Add a custom label'}
                        >
                          <Pencil size={10} />
                        </button>
                      )}
                      <span
                        className="font-display font-bold text-xs ml-auto tabular-nums"
                        style={{ background: 'linear-gradient(90deg, #d4eeff 0%, #6ec6ff 55%, #a78bfa 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}
                      >
                        {formatIRM(addr.balance ?? 0)}
                      </span>
                    </div>
                    <div className="font-mono text-[11px] text-white/85 break-all leading-relaxed">{addr.address}</div>
                    <div className="flex items-center gap-1 mt-2.5">
                      {!isPrimary && (
                        <button
                          onClick={() => onSetPrimary(idx)}
                          className="btn-ghost text-[10px] py-1 px-2 gap-1"
                          style={{ color: '#6ec6ff' }}
                          title="Set as primary"
                        >
                          <Star size={11} /> Primary
                        </button>
                      )}
                      <button
                        onClick={() => exportWif(addr.address)}
                        disabled={exportingWifAddr === addr.address}
                        className="btn-ghost text-[10px] py-1 px-2 gap-1"
                        style={{ color: '#fbbf24' }}
                        title="Export WIF"
                      >
                        {exportingWifAddr === addr.address
                          ? <Loader2 size={11} className="animate-spin" />
                          : <Download size={11} />} WIF
                      </button>
                      <button
                        onClick={() => onShowQr(addr.address)}
                        className="btn-ghost text-[10px] py-1 px-2 gap-1"
                        style={{ color: 'rgba(238,240,255,0.65)' }}
                        title="Show QR code"
                      >
                        <Hash size={11} /> QR
                      </button>
                      <button
                        onClick={() => { navigator.clipboard.writeText(addr.address); toast.success('Address copied'); }}
                        className="btn-ghost text-[10px] py-1 px-2 gap-1"
                        style={{ color: 'rgba(238,240,255,0.65)' }}
                        title="Copy"
                      >
                        <Copy size={11} /> Copy
                      </button>
                      {!isPrimary && (
                        <button
                          onClick={() => setHideTarget({ idx, address: addr.address })}
                          className="btn-ghost text-[10px] py-1 px-2 gap-1 ml-auto"
                          style={{ color: '#fbbf24' }}
                          title="Hide address (stays in wallet file, can be unhidden later)"
                        >
                          <Trash2 size={11} /> Hide
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {addresses.length === 0 && (
                <div className="panel p-4 text-center text-xs" style={{ color: 'rgba(238,240,255,0.40)' }}>
                  No addresses yet.
                </div>
              )}

              {/* Add address footer */}
              <button
                onClick={onAddAddress}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-display font-semibold transition-all"
                style={{
                  background: 'linear-gradient(135deg, rgba(59,59,255,0.18) 0%, rgba(110,198,255,0.14) 50%, rgba(167,139,250,0.18) 100%)',
                  border: '1px solid rgba(110,198,255,0.40)',
                  color: '#fff',
                }}
              >
                <Plus size={14} /> Add Address
              </button>
            </div>
          </section>

          {/* ── Section 3: Hidden addresses ──────────────────────────
              Only renders when there are hidden addresses to surface.
              Unhiding adds the address back into the visible list on the
              next poller tick (the binary's listing already includes it). */}
          {hiddenAddresses.size > 0 && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[10px] font-display font-bold uppercase" style={{ color: 'rgba(110,198,255,0.65)', letterSpacing: '0.14em' }}>
                  Hidden Addresses <span style={{ color: 'rgba(238,240,255,0.40)', letterSpacing: '0.12em' }}>(still in wallet file)</span>
                </h3>
                <span className="badge badge-irium">{hiddenAddresses.size}</span>
              </div>
              <p className="text-[10px] mb-3" style={{ color: 'rgba(238,240,255,0.40)' }}>
                Addresses cannot be permanently deleted from the wallet file. Hidden addresses are removed from view but remain recoverable — click Unhide to bring them back.
              </p>
              <div className="space-y-2">
                {[...hiddenAddresses].map((addr) => (
                  <div
                    key={addr}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                    style={{ background: 'rgba(0,0,0,0.30)', border: '1px solid rgba(110,198,255,0.10)' }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-[11px] text-white/65 break-all leading-relaxed">{addr}</div>
                    </div>
                    <button
                      onClick={() => { onUnhide(addr); toast.success('Address unhidden'); }}
                      className="btn-ghost text-[10px] py-1 px-2 gap-1 flex-shrink-0"
                      style={{ color: '#6ec6ff' }}
                      title="Unhide this address"
                    >
                      Unhide
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </motion.aside>

      {/* ── Delete-wallet-file confirmation ───────────────────────
          Strong warning + type-DELETE confirmation. Backend also
          enforces the same constraints (not the currently-active
          wallet, content-verified as a wallet file, inside ~/.irium/)
          so even if this UI is bypassed nothing unsafe can happen. */}
      <AnimatePresence>
        {deleteTarget && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm"
              onClick={() => !deleting && setDeleteTarget(null)}
            />
            <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 pointer-events-none">
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={{ duration: 0.18 }}
                className="pointer-events-auto w-full max-w-md p-6 space-y-4"
                style={{
                  background: 'rgba(2,5,14,0.98)',
                  border: '1px solid rgba(239,68,68,0.45)',
                  borderRadius: 14,
                  boxShadow: '0 24px 64px rgba(0,0,0,0.8), 0 0 32px rgba(239,68,68,0.18)',
                }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(239,68,68,0.16)', border: '1px solid rgba(239,68,68,0.40)' }}
                  >
                    <Trash2 size={18} style={{ color: '#f87171' }} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-display font-bold text-lg" style={{ color: '#f87171' }}>
                      Permanently delete this wallet file?
                    </h3>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="font-mono text-[11px]" style={{ color: 'rgba(238,240,255,0.55)' }}>
                        {deleteTarget.name}
                      </span>
                      {/* Address-count badge — fills in once getInfo resolves. */}
                      {deleteTargetInfoLoading ? (
                        <span className="text-[9px] font-display font-bold uppercase px-1.5 py-0.5 rounded-full"
                          style={{ color: 'rgba(238,240,255,0.40)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', letterSpacing: '0.10em' }}>
                          Loading…
                        </span>
                      ) : deleteTargetInfo ? (
                        <span className="text-[9px] font-display font-bold uppercase px-1.5 py-0.5 rounded-full"
                          style={{ color: 'rgba(238,240,255,0.55)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', letterSpacing: '0.10em' }}>
                          {deleteTargetInfo.address_count} {deleteTargetInfo.address_count === 1 ? 'address' : 'addresses'}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                {/* Address list (scrollable if long) — shown once getInfo
                    resolves. Each row: address (mono) + balance (or "—"
                    if RPC didn't return one for that address). */}
                {deleteTargetInfo && deleteTargetInfo.addresses.length > 0 && (
                  <div
                    className="rounded-lg overflow-hidden"
                    style={{ background: 'rgba(0,0,0,0.30)', border: '1px solid rgba(110,198,255,0.12)' }}
                  >
                    <div className="max-h-40 overflow-y-auto divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                      {deleteTargetInfo.addresses.map((a) => (
                        <div key={a.address} className="flex items-center gap-3 px-3 py-2">
                          <span className="font-mono text-[10px] flex-1 min-w-0 truncate" style={{ color: 'rgba(238,240,255,0.70)' }} title={a.address}>
                            {a.address}
                          </span>
                          <span className="font-display font-bold text-[11px] tabular-nums flex-shrink-0"
                            style={{
                              color: a.balance === null
                                ? 'rgba(238,240,255,0.30)'
                                : a.balance > 0 ? '#fca5a5' : 'rgba(238,240,255,0.55)',
                            }}
                          >
                            {a.balance === null ? '—' : formatIRM(a.balance)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Conditional warning — three tones based on what
                    getInfo returned. See WalletInfo.total_balance docs:
                      > 0     → elevated red, names the exact funds at stake
                      === 0   → standard red, no funds emphasis
                      === null → cautionary amber, "balance unknown" */}
                {deleteTargetInfo && (deleteTargetInfo.total_balance ?? 0) > 0 ? (
                  <div
                    className="flex items-start gap-2 p-3 rounded-lg text-xs leading-relaxed"
                    style={{ background: 'rgba(239,68,68,0.14)', border: '1px solid rgba(239,68,68,0.55)', color: '#fecaca', boxShadow: '0 0 18px rgba(239,68,68,0.18) inset' }}
                  >
                    <span>
                      <strong className="text-white">WARNING:</strong> This wallet contains funds. Deleting it without a backup means permanent loss of <strong className="text-white">{formatIRM(deleteTargetInfo.total_balance!)}</strong>. Make sure you have exported your WIF keys or seed phrase before proceeding.
                    </span>
                  </div>
                ) : deleteTargetInfo && deleteTargetInfo.total_balance === null ? (
                  <div
                    className="flex items-start gap-2 p-3 rounded-lg text-xs leading-relaxed"
                    style={{ background: 'rgba(251,191,36,0.10)', border: '1px solid rgba(251,191,36,0.35)', color: '#fde68a' }}
                  >
                    Balance could not be confirmed — the node may be offline. If this wallet held funds and you have not backed up the seed phrase or WIF keys, deletion will <strong className="text-white">permanently lose</strong> them.
                  </div>
                ) : (
                  <div
                    className="flex items-start gap-2 p-3 rounded-lg text-xs leading-relaxed"
                    style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.28)', color: '#fca5a5' }}
                  >
                    This will delete the file from disk. If you have not backed up the seed phrase or WIF keys for this wallet, all funds in it will be <strong className="text-white">permanently lost</strong>. This cannot be undone.
                  </div>
                )}

                <div>
                  <label className="block text-[10px] font-display font-bold uppercase mb-1.5" style={{ color: 'rgba(238,240,255,0.55)', letterSpacing: '0.12em' }}>
                    Type <span style={{ color: '#f87171' }}>DELETE</span> to confirm
                  </label>
                  <input
                    type="text"
                    autoFocus
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    placeholder="DELETE"
                    className="input"
                    disabled={deleting}
                  />
                </div>

                <div className="flex items-center gap-3 pt-1">
                  <button
                    onClick={() => setDeleteTarget(null)}
                    disabled={deleting}
                    className="btn-secondary flex-1 justify-center"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      setDeleting(true);
                      try {
                        await onDeleteWalletFile(deleteTarget.path);
                        setDeleteTarget(null);
                        setDeleteConfirmText('');
                      } finally {
                        setDeleting(false);
                      }
                    }}
                    disabled={deleteConfirmText.toUpperCase() !== 'DELETE' || deleting}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-display font-semibold text-sm transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{
                      background: 'rgba(239,68,68,0.16)',
                      border: '1px solid rgba(239,68,68,0.55)',
                      color: '#fff',
                      boxShadow: '0 0 16px rgba(239,68,68,0.18)',
                    }}
                  >
                    {deleting
                      ? <><Loader2 size={14} className="animate-spin" /> Deleting…</>
                      : <><Trash2 size={14} /> Delete forever</>}
                  </button>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      {/* ── Hide-address confirmation ─────────────────────────────
          Reversible — the address stays in the wallet file. Amber
          chrome (warning-tone) instead of the Delete modal's red
          (destructive-tone). */}
      <AnimatePresence>
        {hideTarget && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm"
              onClick={() => setHideTarget(null)}
            />
            <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 pointer-events-none">
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={{ duration: 0.18 }}
                className="pointer-events-auto w-full max-w-md p-6 space-y-4"
                style={{
                  background: 'rgba(2,5,14,0.98)',
                  border: '1px solid rgba(251,191,36,0.45)',
                  borderRadius: 14,
                  boxShadow: '0 24px 64px rgba(0,0,0,0.8), 0 0 32px rgba(251,191,36,0.16)',
                }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(251,191,36,0.16)', border: '1px solid rgba(251,191,36,0.40)' }}
                  >
                    <Trash2 size={18} style={{ color: '#fbbf24' }} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-display font-bold text-lg" style={{ color: '#fbbf24' }}>
                      Hide this address?
                    </h3>
                    <p className="font-mono text-[11px] mt-1 truncate" style={{ color: 'rgba(238,240,255,0.55)' }} title={hideTarget.address}>
                      {hideTarget.address}
                    </p>
                  </div>
                </div>

                <div
                  className="flex items-start gap-2 p-3 rounded-lg text-xs leading-relaxed"
                  style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.28)', color: 'rgba(251,191,36,0.85)' }}
                >
                  The address stays in the wallet file — only the visible
                  list is updated. You can <strong className="text-white">unhide</strong> it
                  later from the Hidden Addresses section.
                </div>

                <div className="flex items-center gap-3 pt-1">
                  <button
                    onClick={() => setHideTarget(null)}
                    className="btn-secondary flex-1 justify-center"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      onRemove(hideTarget.idx, hideTarget.address);
                      setHideTarget(null);
                    }}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-display font-semibold text-sm transition-all active:scale-[0.97]"
                    style={{
                      background: 'rgba(251,191,36,0.16)',
                      border: '1px solid rgba(251,191,36,0.55)',
                      color: '#fff',
                      boxShadow: '0 0 16px rgba(251,191,36,0.18)',
                    }}
                  >
                    <Trash2 size={14} /> Hide address
                  </button>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
