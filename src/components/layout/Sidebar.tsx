import { useState, memo } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Wallet, ShieldCheck, ShoppingBag,
  FileText, Star, Cpu, Settings,
} from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../../lib/store';

const NAV = [
  { to: '/dashboard',   icon: LayoutDashboard, label: 'Dashboard'   },
  { to: '/wallet',      icon: Wallet,          label: 'Wallet'      },
  { to: '/settlement',  icon: ShieldCheck,     label: 'Settlement'  },
  { to: '/marketplace', icon: ShoppingBag,     label: 'Marketplace' },
  { to: '/agreements',  icon: FileText,        label: 'Agreements'  },
  { to: '/reputation',  icon: Star,            label: 'Reputation'  },
  { to: '/miner',       icon: Cpu,             label: 'Miner'       },
];

const Sidebar = memo(function Sidebar() {
  const nodeStatus = useStore((s) => s.nodeStatus);
  const [expanded, setExpanded] = useState(false);

  const nodeLabel =
    nodeStatus?.running && nodeStatus?.synced ? 'Live' :
    nodeStatus?.running ? 'Syncing…' : 'Offline';

  const nodeDotClass =
    nodeStatus?.running && nodeStatus?.synced ? 'dot-live' :
    nodeStatus?.running ? 'dot-syncing' : 'dot-offline';

  return (
    <aside
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      className="flex flex-col h-full flex-shrink-0 z-30 overflow-hidden"
      style={{
        width: expanded ? 'var(--sidebar-w-expanded)' : 'var(--sidebar-w)',
        transition: 'width 260ms cubic-bezier(0.4, 0, 0.2, 1)',
        background: 'rgba(8, 11, 20, 0.95)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderRight: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center h-12 flex-shrink-0 overflow-hidden"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingLeft: '18px' }}
      >
        <img
          src="/logo.png"
          alt="Irium"
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            flexShrink: 0,
            boxShadow: '0 0 14px rgba(139,92,246,0.45)',
          }}
        />
        <span
          className="font-display font-bold text-sm whitespace-nowrap ml-3"
          style={{
            background: 'linear-gradient(90deg, #A78BFA 0%, #60A5FA 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            opacity: expanded ? 1 : 0,
            transform: expanded ? 'translateX(0)' : 'translateX(-10px)',
            transition: 'opacity 200ms ease, transform 200ms ease',
            transitionDelay: expanded ? '100ms' : '0ms',
            pointerEvents: 'none',
          }}
        >
          Irium Core
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 flex flex-col py-3 gap-0.5 overflow-y-auto overflow-x-hidden">
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              clsx(
                'relative flex items-center h-10 mx-2 rounded-xl overflow-hidden transition-all duration-150',
                isActive
                  ? 'text-white'
                  : 'text-[rgba(238,240,255,0.38)] hover:text-[rgba(238,240,255,0.85)] hover:bg-[rgba(255,255,255,0.05)]',
              )
            }
            style={({ isActive }) => ({
              paddingLeft: 14,
              background: isActive
                ? 'linear-gradient(135deg, rgba(139,92,246,0.22) 0%, rgba(59,130,246,0.12) 100%)'
                : undefined,
              borderLeft: isActive ? '2px solid #8B5CF6' : '2px solid transparent',
              boxShadow: isActive ? 'inset 0 0 20px rgba(139,92,246,0.08)' : undefined,
            })}
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span
                    className="absolute right-2 w-1 h-1 rounded-full"
                    style={{ background: '#A78BFA', boxShadow: '0 0 6px #A78BFA' }}
                  />
                )}
                <Icon size={17} className="flex-shrink-0" style={{ minWidth: 17 }} />
                <span
                  className="text-sm font-display font-medium whitespace-nowrap ml-3"
                  style={{
                    opacity: expanded ? 1 : 0,
                    transform: expanded ? 'translateX(0)' : 'translateX(-8px)',
                    transition: 'opacity 180ms ease, transform 180ms ease',
                    transitionDelay: expanded ? '70ms' : '0ms',
                    pointerEvents: 'none',
                  }}
                >
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Bottom */}
      <div
        className="flex flex-col gap-0.5 py-3 overflow-hidden"
        style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
      >
        {/* Node status */}
        <div
          className="flex items-center h-8 mx-2 px-3.5 rounded-xl gap-3 overflow-hidden"
        >
          <span className={nodeDotClass} style={{ flexShrink: 0 }} />
          <span
            className="text-xs whitespace-nowrap"
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              color: 'rgba(238,240,255,0.30)',
              opacity: expanded ? 1 : 0,
              transition: 'opacity 180ms ease',
              transitionDelay: expanded ? '70ms' : '0ms',
            }}
          >
            {nodeLabel}
          </span>
        </div>

        {/* Settings */}
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            clsx(
              'flex items-center h-10 mx-2 px-3.5 rounded-xl overflow-hidden transition-all duration-150',
              isActive
                ? 'text-white'
                : 'text-[rgba(238,240,255,0.38)] hover:text-[rgba(238,240,255,0.85)] hover:bg-[rgba(255,255,255,0.05)]',
            )
          }
          style={({ isActive }) => ({
            background: isActive
              ? 'linear-gradient(135deg, rgba(139,92,246,0.22) 0%, rgba(59,130,246,0.12) 100%)'
              : undefined,
            borderLeft: isActive ? '2px solid #8B5CF6' : '2px solid transparent',
          })}
        >
          {() => (
            <>
              <Settings size={17} style={{ flexShrink: 0, minWidth: 17 }} />
              <span
                className="text-sm font-display font-medium whitespace-nowrap ml-3"
                style={{
                  opacity: expanded ? 1 : 0,
                  transform: expanded ? 'translateX(0)' : 'translateX(-8px)',
                  transition: 'opacity 180ms ease, transform 180ms ease',
                  transitionDelay: expanded ? '70ms' : '0ms',
                  pointerEvents: 'none',
                }}
              >
                Settings
              </span>
            </>
          )}
        </NavLink>
      </div>
    </aside>
  );
});

export default Sidebar;
