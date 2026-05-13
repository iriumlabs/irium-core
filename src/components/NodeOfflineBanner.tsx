import React from 'react';
import { AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';

// Persistent banner shown on every page that requires a running node.
// Renders nothing when the node is reachable. Subscribes to nodeStatus
// from the global store and re-evaluates when polling updates fire.

export default function NodeOfflineBanner() {
  const nodeStatus = useStore((s) => s.nodeStatus);
  if (nodeStatus?.running) return null;
  return (
    <div className="rounded-lg p-3 flex items-center gap-2.5 border border-amber-500/40 bg-amber-500/10 text-amber-200 text-sm">
      <AlertCircle size={16} className="text-amber-400 flex-shrink-0" />
      <div className="flex-1">
        <strong className="text-amber-100">Node is offline.</strong>{' '}
        <span className="text-amber-200/80">Start it from the Dashboard to use this feature.</span>
      </div>
      <Link
        to="/dashboard"
        className="btn-secondary text-xs py-1 px-3 flex-shrink-0 border-amber-400/40 text-amber-100 hover:text-white"
      >
        Open Dashboard →
      </Link>
    </div>
  );
}
