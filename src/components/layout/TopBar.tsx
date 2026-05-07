import React, { useState } from "react";
import { Bell, X, Play, Square, RefreshCw } from "lucide-react";
import { useStore } from "../../lib/store";
import { node } from "../../lib/tauri";
import { formatIRM } from "../../lib/types";
import clsx from "clsx";

export default function TopBar() {
  const nodeStatus = useStore((s) => s.nodeStatus);
  const balance = useStore((s) => s.balance);
  const notifications = useStore((s) => s.notifications);
  const dismiss = useStore((s) => s.dismissNotification);
  const addNotification = useStore((s) => s.addNotification);
  const [showNotifs, setShowNotifs] = useState(false);
  const [loading, setLoading] = useState(false);

  const isRunning = nodeStatus?.running;
  const unread = notifications.length;

  const handleToggleNode = async () => {
    setLoading(true);
    try {
      if (isRunning) {
        await node.stop();
        addNotification({ type: "info", title: "Node stopping..." });
      } else {
        const result = await node.start();
        if (result.success) {
          addNotification({ type: "success", title: "Node started", message: result.message });
        } else {
          addNotification({ type: "error", title: "Failed to start node", message: result.message });
        }
      }
    } catch (e: unknown) {
      addNotification({ type: "error", title: "Error", message: String(e) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <header
      className="flex items-center justify-between h-14 px-4 border-b border-white/5 flex-shrink-0"
      style={{ background: "var(--color-surface)" }}
    >
      {/* Left: Node status */}
      <div className="flex items-center gap-3">
        <NodeStatusBadge status={nodeStatus} />
        {nodeStatus?.running && (
          <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-white/40">
            <span>Block #{nodeStatus.height.toLocaleString()}</span>
            <span className="text-white/20">·</span>
            <span>{nodeStatus.peers} peers</span>
            {nodeStatus.synced && (
              <>
                <span className="text-white/20">·</span>
                <span className="text-green-400">Synced</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Center: Balance */}
      {balance && (
        <div className="flex items-center gap-1 font-display">
          <span className="text-white/50 text-xs">Balance</span>
          <span className="gradient-text font-bold text-sm">
            {formatIRM(balance.confirmed)}
          </span>
          {balance.unconfirmed > 0 && (
            <span className="text-amber-400 text-xs">
              +{formatIRM(balance.unconfirmed)} pending
            </span>
          )}
        </div>
      )}

      {/* Right: Controls */}
      <div className="flex items-center gap-2">
        {/* Node toggle */}
        <button
          onClick={handleToggleNode}
          disabled={loading}
          className={clsx(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-display font-semibold",
            "transition-all duration-200",
            isRunning
              ? "bg-red-500/15 text-red-400 border border-red-500/20 hover:bg-red-500/25"
              : "bg-green-500/15 text-green-400 border border-green-500/20 hover:bg-green-500/25"
          )}
        >
          {loading ? (
            <RefreshCw size={12} className="animate-spin" />
          ) : isRunning ? (
            <Square size={12} fill="currentColor" />
          ) : (
            <Play size={12} fill="currentColor" />
          )}
          {isRunning ? "Stop Node" : "Start Node"}
        </button>

        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => setShowNotifs(!showNotifs)}
            className="relative flex items-center justify-center w-8 h-8 rounded-lg text-white/50 hover:text-white hover:bg-white/5 transition-all"
          >
            <Bell size={16} />
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-irium-500 text-white text-xs flex items-center justify-center font-bold">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </button>

          {showNotifs && (
            <div className="absolute right-0 top-full mt-2 w-80 z-50 card shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                <span className="font-display font-semibold text-sm">Notifications</span>
                <button
                  onClick={() => setShowNotifs(false)}
                  className="text-white/40 hover:text-white"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="px-4 py-6 text-center text-white/30 text-sm">
                    No notifications
                  </div>
                ) : (
                  notifications
                    .slice()
                    .reverse()
                    .map((n) => (
                      <div
                        key={n.id}
                        className="flex items-start gap-3 px-4 py-3 border-b border-white/5 hover:bg-white/3 group"
                      >
                        <NotifDot type={n.type} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-white/90">{n.title}</div>
                          {n.message && (
                            <div className="text-xs text-white/50 mt-0.5 truncate">{n.message}</div>
                          )}
                        </div>
                        <button
                          onClick={() => dismiss(n.id)}
                          className="text-white/20 hover:text-white/60 opacity-0 group-hover:opacity-100 flex-shrink-0"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function NodeStatusBadge({ status }: { status: import("../../lib/types").NodeStatus | null }) {
  if (!status) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="dot-offline" />
        <span className="text-xs font-display font-semibold text-white/30">Offline</span>
      </div>
    );
  }
  if (!status.running) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="dot-offline" />
        <span className="text-xs font-display font-semibold text-white/30">Node stopped</span>
      </div>
    );
  }
  if (!status.synced) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="dot-syncing" />
        <span className="text-xs font-display font-semibold text-amber-400">Syncing...</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <span className="dot-live" />
      <span className="text-xs font-display font-semibold text-green-400">Live</span>
    </div>
  );
}

function NotifDot({ type }: { type: string }) {
  const cls = {
    success: "bg-green-400",
    error: "bg-red-400",
    warning: "bg-amber-400",
    info: "bg-blue-400",
  }[type] ?? "bg-white/40";
  return <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${cls}`} />;
}
