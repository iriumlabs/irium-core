import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal as TerminalIcon, Trash2 } from 'lucide-react';
import { runCommand, isBuiltin, buildHelpText } from '../lib/terminalCommands';

type Line =
  | { kind: 'echo'; text: string }
  | { kind: 'ok'; text: string }
  | { kind: 'err'; text: string }
  | { kind: 'info'; text: string }
  | { kind: 'pending' };

const HISTORY_KEY = 'irium-terminal-history';
const MAX_HISTORY = 200;
const MAX_OUTPUT_LINES = 1000;

const loadHistory = (): string[] => {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
};

const saveHistory = (h: string[]) => {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-MAX_HISTORY)));
  } catch {
    /* ignore quota errors */
  }
};

const formatResult = (data: unknown): string => {
  if (data === null || data === undefined) return '(no result)';
  if (typeof data === 'string') return data;
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
};

export default function Terminal() {
  const { t } = useTranslation();
  const [lines, setLines] = useState<Line[]>([
    { kind: 'info', text: 'Irium Core Terminal — restricted command runner.' },
    { kind: 'info', text: "Type 'help' to see allowed commands. There is no shell access." },
    { kind: 'info', text: '' },
  ]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Auto-scroll the output pane to the bottom whenever a new line lands.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lines]);

  // Focus the input on mount and whenever the page receives a click outside
  // a selectable region — terminals expect a click anywhere to return focus
  // to the prompt.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const appendLines = useCallback((next: Line[]) => {
    setLines((prev) => {
      const merged = [...prev, ...next];
      if (merged.length > MAX_OUTPUT_LINES) {
        return merged.slice(merged.length - MAX_OUTPUT_LINES);
      }
      return merged;
    });
  }, []);

  const clearOutput = useCallback(() => {
    setLines([]);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (busy) return;
    const cmd = input;
    setInput('');
    setHistoryIdx(null);

    const trimmed = cmd.trim();
    if (!trimmed) {
      appendLines([{ kind: 'echo', text: '' }]);
      return;
    }

    // Push to history (skip duplicate of last entry to avoid noise).
    setHistory((prev) => {
      if (prev[prev.length - 1] === trimmed) return prev;
      const next = [...prev, trimmed];
      saveHistory(next);
      return next;
    });

    appendLines([{ kind: 'echo', text: trimmed }]);

    const builtin = isBuiltin(trimmed);
    if (builtin === 'clear') {
      clearOutput();
      return;
    }
    if (builtin === 'history') {
      const lines: Line[] = history.length === 0
        ? [{ kind: 'info', text: '(no history yet)' }]
        : history.map((h, i) => ({ kind: 'info', text: `${String(i + 1).padStart(4, ' ')}  ${h}` }));
      appendLines(lines);
      return;
    }
    if (builtin === 'help') {
      appendLines([{ kind: 'info', text: buildHelpText() }]);
      return;
    }

    setBusy(true);
    appendLines([{ kind: 'pending' }]);
    try {
      const result = await runCommand(trimmed);
      // Replace the trailing pending line with the actual result.
      setLines((prev) => {
        const out = [...prev];
        // Pop the pending marker we just pushed (always the last entry here).
        if (out.length > 0 && out[out.length - 1].kind === 'pending') {
          out.pop();
        }
        if (result.kind === 'ok') {
          out.push({ kind: 'ok', text: formatResult(result.data) });
        } else if (result.kind === 'err') {
          out.push({ kind: 'err', text: `error: ${result.message}` });
        } else if (result.kind === 'text' && result.text) {
          out.push({ kind: 'info', text: result.text });
        }
        return out;
      });
    } finally {
      setBusy(false);
    }
  }, [appendLines, busy, clearOutput, history, input]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleSubmit();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      const nextIdx = historyIdx === null ? history.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(nextIdx);
      setInput(history[nextIdx] ?? '');
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx === null) return;
      const nextIdx = historyIdx + 1;
      if (nextIdx >= history.length) {
        setHistoryIdx(null);
        setInput('');
      } else {
        setHistoryIdx(nextIdx);
        setInput(history[nextIdx] ?? '');
      }
      return;
    }
    if (e.key === 'l' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      clearOutput();
    }
  };

  const handlePaneClick = () => {
    inputRef.current?.focus();
  };

  return (
    <div className="w-full h-full overflow-y-auto px-8 py-6">
      <div className="reading-col" style={{ maxWidth: 1100 }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="page-title">{t('terminal.page_title')}</h1>
            <p className="page-subtitle">{t('terminal.page_subtitle')}</p>
          </div>
          <button
            onClick={clearOutput}
            className="btn-secondary px-3 py-1.5 text-xs flex items-center gap-1.5"
            title={t('terminal.clear_output')}
          >
            <Trash2 size={13} />
            {t('terminal.clear_output')}
          </button>
        </div>

        <div
          className="card p-0 overflow-hidden"
          style={{
            background: '#02050E',
            border: '1px solid rgba(110,198,255,0.18)',
            boxShadow: '0 0 24px rgba(110,198,255,0.06) inset',
          }}
        >
          <div
            className="flex items-center gap-2 px-3 py-2"
            style={{
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              background: 'rgba(255,255,255,0.02)',
            }}
          >
            <TerminalIcon size={13} style={{ color: '#34d399' }} />
            <span
              className="text-xs"
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                color: 'rgba(238,240,255,0.55)',
              }}
            >
              irium-cli
            </span>
          </div>

          <div
            ref={scrollRef}
            onClick={handlePaneClick}
            className="overflow-y-auto"
            style={{
              height: 'calc(100vh - 280px)',
              minHeight: 320,
              padding: '12px 16px',
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 13,
              lineHeight: 1.55,
              cursor: 'text',
            }}
          >
            {lines.map((line, i) => {
              if (line.kind === 'pending') {
                return (
                  <div key={i} style={{ color: 'rgba(110,198,255,0.85)' }}>
                    running…
                  </div>
                );
              }
              if (line.kind === 'echo') {
                return (
                  <div key={i} style={{ color: '#eef0ff' }}>
                    <span style={{ color: '#34d399' }}>irium-cli&gt; </span>
                    {line.text}
                  </div>
                );
              }
              if (line.kind === 'err') {
                return (
                  <pre
                    key={i}
                    style={{
                      color: '#fbbf24',
                      margin: 0,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {line.text}
                  </pre>
                );
              }
              if (line.kind === 'ok') {
                return (
                  <pre
                    key={i}
                    style={{
                      color: 'rgba(238,240,255,0.88)',
                      margin: 0,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {line.text}
                  </pre>
                );
              }
              return (
                <pre
                  key={i}
                  style={{
                    color: 'rgba(238,240,255,0.55)',
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {line.text}
                </pre>
              );
            })}

            <div
              className="flex items-center mt-1"
              style={{ color: '#eef0ff' }}
            >
              <span style={{ color: '#34d399', marginRight: 4 }}>irium-cli&gt;</span>
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={busy}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: '#eef0ff',
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 13,
                  padding: '0 4px',
                }}
                placeholder={busy ? t('terminal.input_busy_placeholder') : t('terminal.input_placeholder')}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
