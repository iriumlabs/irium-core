import React from "react";
import { useStore } from "../../lib/store";
import { truncateHash } from "../../lib/types";

export default function StatusBar() {
  const nodeStatus = useStore((s) => s.nodeStatus);

  return (
    <div
      className="flex items-center justify-between h-7 px-4 border-t border-white/5 text-xs font-mono text-white/25 flex-shrink-0"
      style={{ background: "var(--color-bg)" }}
    >
      <div className="flex items-center gap-3">
        <span>Irium Core v1.0.0</span>
        <span>·</span>
        <span>Network: Mainnet</span>
        {nodeStatus?.running && (
          <>
            <span>·</span>
            <span>RPC: {nodeStatus.rpc_url}</span>
          </>
        )}
      </div>
      {nodeStatus?.tip && (
        <div className="flex items-center gap-2">
          <span>Tip:</span>
          <span className="text-white/40">{truncateHash(nodeStatus.tip, 10)}</span>
        </div>
      )}
    </div>
  );
}
