import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Trash2, ArrowDown, Search } from 'lucide-react';
import { node } from '../lib/tauri';
import { useStore } from '../lib/store';

export default function Logs() {
  const nodeStatus = useStore((s) => s.nodeStatus);
  const [lines, setLines] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const result = await node.logs(500);
      if (result) setLines(result);
    } catch { /* node offline */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchLogs();
    const id = setInterval(fetchLogs, 3000);
    return () => clearInterval(id);
  }, [fetchLogs]);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [lines, autoScroll]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  };

  const filtered = filter
    ? lines.filter((l) => l.toLowerCase().includes(filter.toLowerCase()))
    : lines;

  const colorLine = (line: string): string => {
    if (line.includes('[stderr]') || line.toLowerCase().includes('error')) return 'text-red-400';
    if (line.toLowerCase().includes('warn')) return 'text-amber-400';
    if (line.toLowerCase().includes('peer') || line.toLowerCase().includes('connect')) return 'text-blue-400';
    if (line.toLowerCase().includes('block') || line.toLowerCase().includes('sync')) return 'text-irium-300';
    return 'text-white/60';
  };

  const running = nodeStatus?.running ?? false;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="h-full flex flex-col px-8 py-6 gap-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="page-title">Node Logs</h1>
          <p className="page-subtitle">
            {running ? 'Live iriumd output · refreshes every 3s' : 'Node is offline — start the node to see logs'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {loading && <Loader2 size={14} className="animate-spin text-white/30" />}
          <button
            onClick={() => setAutoScroll(true)}
            title="Scroll to bottom"
            className={`btn-ghost p-2 ${autoScroll ? 'text-irium-400' : 'text-white/30'}`}
          >
            <ArrowDown size={15} />
          </button>
          <button
            onClick={() => setLines([])}
            title="Clear display"
            className="btn-ghost p-2 text-white/30 hover:text-white/70"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="flex-shrink-0 relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
        <input
          className="input pl-8 text-xs font-mono"
          placeholder="Filter logs…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {/* Log output */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto rounded-xl font-mono text-xs leading-relaxed p-4 space-y-0.5"
        style={{
          background: 'rgba(5, 7, 15, 0.8)',
          border: '1px solid rgba(255,255,255,0.06)',
          minHeight: 0,
        }}
      >
        {!running && lines.length === 0 && (
          <div className="flex items-center justify-center h-full text-white/20 text-sm font-sans">
            Start the node from the Dashboard to see logs here
          </div>
        )}
        {running && loading && lines.length === 0 && (
          <div className="flex items-center justify-center h-full gap-2 text-white/20 text-sm font-sans">
            <Loader2 size={14} className="animate-spin" />
            Loading logs…
          </div>
        )}
        {filtered.map((line, i) => (
          <div key={i} className={colorLine(line)}>
            {line}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 flex items-center justify-between text-xs text-white/20">
        <span>{filtered.length} line{filtered.length !== 1 ? 's' : ''}{filter ? ' (filtered)' : ''}</span>
        <span>{autoScroll ? 'Auto-scroll on' : 'Auto-scroll paused'}</span>
      </div>
    </motion.div>
  );
}
