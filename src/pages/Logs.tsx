import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Loader2, Trash2, ArrowDown, Search } from 'lucide-react';
import { node } from '../lib/tauri';
import { useStore } from '../lib/store';

// FIX 9: heuristic log-level classifier. iriumd's log lines don't
// carry a uniform [INFO]/[WARN]/[ERROR] prefix — some lines come
// from tracing macros, some from raw eprintln!/println!, and the
// shell injects [stderr] for anything on the stderr stream. We
// piggyback on the same keyword set the existing colorLine function
// uses, with ERROR > WARN > INFO precedence so a line that mentions
// both "warn" and "error" lands in ERROR (the more actionable bucket).
type LogLevel = 'INFO' | 'WARN' | 'ERROR';
function classifyLevel(line: string): LogLevel {
  const lower = line.toLowerCase();
  if (line.includes('[stderr]') || lower.includes('error') || lower.includes('fatal') || lower.includes('panic')) return 'ERROR';
  if (lower.includes('warn')) return 'WARN';
  return 'INFO';
}

export default function Logs() {
  const { t } = useTranslation();
  const nodeStatus = useStore((s) => s.nodeStatus);
  const [lines, setLines] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  // FIX 9: when empty, the level filter is treated as "show all".
  // Toggle pills below the search box add/remove levels from this set.
  const [enabledLevels, setEnabledLevels] = useState<Set<LogLevel>>(new Set());
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

  // FIX 9: apply keyword + level filters in one pass. Memoised so
  // tab navigation and unrelated state changes don't re-run a full
  // 500-line classify+match cycle each render.
  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const useLevelFilter = enabledLevels.size > 0;
    return lines.filter((line) => {
      if (needle && !line.toLowerCase().includes(needle)) return false;
      if (useLevelFilter && !enabledLevels.has(classifyLevel(line))) return false;
      return true;
    });
  }, [lines, filter, enabledLevels]);

  const toggleLevel = (level: LogLevel) => {
    setEnabledLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  };

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
          <h1 className="page-title">{t('logs.page_title')}</h1>
          <p className="page-subtitle">
            {running ? t('logs.page_subtitle_live') : t('logs.page_subtitle_offline')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {loading && <Loader2 size={14} className="animate-spin text-white/30" />}
          <button
            onClick={() => setAutoScroll(true)}
            title={t('logs.scroll_to_bottom')}
            className={`btn-ghost p-2 ${autoScroll ? 'text-irium-400' : 'text-white/30'}`}
          >
            <ArrowDown size={15} />
          </button>
          <button
            onClick={() => setLines([])}
            title={t('logs.clear_display')}
            className="btn-ghost p-2 text-white/30 hover:text-white/70"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="flex-shrink-0 space-y-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
          <input
            className="input pl-8 text-xs font-mono"
            placeholder={t('logs.filter_placeholder')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        {/* FIX 9: log-level pills. Multi-select — click multiple to
            see (e.g.) WARN + ERROR. Empty selection means show all,
            so a fresh page load isn't accidentally filtering out
            INFO lines (which are the majority of iriumd output). */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-white/30 font-display font-bold">
            {t('logs.level_label')}
          </span>
          {(['INFO', 'WARN', 'ERROR'] as const).map((level) => {
            const active = enabledLevels.has(level);
            const palette = level === 'ERROR'
              ? { bgOn: 'rgba(244,63,94,0.18)', bgOff: 'rgba(255,255,255,0.04)', borderOn: 'rgba(244,63,94,0.40)', borderOff: 'rgba(255,255,255,0.10)', textOn: '#fda4af', textOff: 'rgba(255,255,255,0.50)' }
              : level === 'WARN'
              ? { bgOn: 'rgba(251,191,36,0.18)', bgOff: 'rgba(255,255,255,0.04)', borderOn: 'rgba(251,191,36,0.40)', borderOff: 'rgba(255,255,255,0.10)', textOn: '#fbbf24', textOff: 'rgba(255,255,255,0.50)' }
              : { bgOn: 'rgba(110,198,255,0.18)', bgOff: 'rgba(255,255,255,0.04)', borderOn: 'rgba(110,198,255,0.40)', borderOff: 'rgba(255,255,255,0.10)', textOn: '#6ec6ff', textOff: 'rgba(255,255,255,0.50)' };
            return (
              <button
                key={level}
                onClick={() => toggleLevel(level)}
                className="px-2.5 py-1 rounded-md text-[10px] font-mono font-semibold transition-all duration-150"
                style={{
                  background: active ? palette.bgOn : palette.bgOff,
                  border: `1px solid ${active ? palette.borderOn : palette.borderOff}`,
                  color: active ? palette.textOn : palette.textOff,
                }}
              >
                {level}
              </button>
            );
          })}
          {enabledLevels.size > 0 && (
            <button
              onClick={() => setEnabledLevels(new Set())}
              className="text-[10px] text-white/40 hover:text-white/70 underline ml-1"
            >
              {t('logs.clear_levels')}
            </button>
          )}
        </div>
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
            {t('logs.empty_offline')}
          </div>
        )}
        {running && loading && lines.length === 0 && (
          <div className="flex items-center justify-center h-full gap-2 text-white/20 text-sm font-sans">
            <Loader2 size={14} className="animate-spin" />
            {t('logs.loading')}
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
        <span>{t('logs.line_count', { count: filtered.length })}{filter ? t('logs.filtered_suffix') : ''}</span>
        <span>{autoScroll ? t('logs.autoscroll_on') : t('logs.autoscroll_paused')}</span>
      </div>
    </motion.div>
  );
}
