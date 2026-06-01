import type { ReactNode } from 'react';

// Segmented control for the new Marketplace and Settlement surfaces.
// Two variants:
//   - `underline`: thin 2px under-line on active tab, Binance-style top-of-page nav
//   - `pill`: rounded background fill on active tab, used inside cards
//
// Each tab can optionally surface a `count` chip (e.g. "Open (3)") and an
// `intent` color hint — buy/sell tabs in the Trade Panel get a green/red
// underline, neutral tabs use the brand-neutral underline.

export type TabIntent = 'neutral' | 'buy' | 'sell';
export type TabsVariant = 'underline' | 'pill';

export interface TabSpec<T extends string = string> {
  id: T;
  label: ReactNode;
  count?: number | null;
  intent?: TabIntent;
  disabled?: boolean;
}

export interface TabsProps<T extends string = string> {
  tabs: TabSpec<T>[];
  value: T;
  onChange: (id: T) => void;
  variant?: TabsVariant;
  size?: 'sm' | 'md';
  className?: string;
}

const intentColor: Record<TabIntent, string> = {
  neutral: '#fcd535',
  buy:     '#0ecb81',
  sell:    '#f6465d',
};

export default function Tabs<T extends string = string>({
  tabs,
  value,
  onChange,
  variant = 'underline',
  size = 'md',
  className = '',
}: TabsProps<T>) {
  const itemH = size === 'sm' ? 'h-7 text-[11px] px-2' : 'h-9 text-[13px] px-3';

  if (variant === 'pill') {
    return (
      <div
        role="tablist"
        className={`inline-flex items-center gap-1 p-1 rounded bg-[#181a20] border border-[#2b3139] ${className}`}
      >
        {tabs.map((tab) => {
          const active = tab.id === value;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={tab.disabled}
              onClick={() => !tab.disabled && onChange(tab.id)}
              className={`${itemH} inline-flex items-center gap-1.5 rounded font-medium transition-colors ${
                active
                  ? 'bg-[#2b3139] text-[#eaecef]'
                  : 'text-[#b7bdc6] hover:text-[#eaecef] hover:bg-[#1e2026]'
              } ${tab.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              <span>{tab.label}</span>
              {tab.count != null && (
                <span
                  className={`text-[10px] px-1 rounded ${
                    active ? 'bg-[#0b0e11] text-[#b7bdc6]' : 'bg-[#181a20] text-[#5e6673]'
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  // underline variant
  return (
    <div
      role="tablist"
      className={`flex items-center gap-1 border-b border-[#2b3139] ${className}`}
    >
      {tabs.map((tab) => {
        const active = tab.id === value;
        const color = intentColor[tab.intent ?? 'neutral'];
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={tab.disabled}
            onClick={() => !tab.disabled && onChange(tab.id)}
            className={`${itemH} relative inline-flex items-center gap-1.5 font-medium tracking-tight transition-colors ${
              active ? 'text-[#eaecef]' : 'text-[#b7bdc6] hover:text-[#eaecef]'
            } ${tab.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
            style={{ marginBottom: -1 }}
          >
            <span>{tab.label}</span>
            {tab.count != null && (
              <span
                className={`text-[10px] px-1 rounded ${
                  active ? 'bg-[#2b3139] text-[#eaecef]' : 'bg-[#181a20] text-[#5e6673]'
                }`}
              >
                {tab.count}
              </span>
            )}
            {active && (
              <span
                aria-hidden
                className="absolute left-0 right-0 -bottom-[1px] h-[2px]"
                style={{ backgroundColor: color }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
