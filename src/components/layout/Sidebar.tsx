import { useState, memo } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Wallet, ShieldCheck, ShoppingBag,
  FileText, Star, Cpu, Settings, Globe, Terminal, HelpCircle,
} from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../../lib/store';

// Settlement / Marketplace / Agreements / Reputation removed from the
// sidebar by request — their routes are redirected to /dashboard in
// App.tsx, but the page files, lazy imports, and the four lucide icons
// (ShieldCheck, ShoppingBag, FileText, Star) above are intentionally
// preserved so the entries can be reinstated by re-adding them here.
const NAV = [
  { to: '/dashboard',   icon: LayoutDashboard, label: 'Dashboard'   },
  { to: '/explorer',    icon: Globe,           label: 'Explorer'    },
  { to: '/wallet',      icon: Wallet,          label: 'Wallet'      },
  { to: '/settlement',  icon: ShieldCheck,     label: 'Settlement'  },
  { to: '/marketplace', icon: ShoppingBag,     label: 'Marketplace' },
  { to: '/agreements',  icon: FileText,        label: 'Agreements'  },
  { to: '/reputation',  icon: Star,            label: 'Reputation'  },
  { to: '/miner',       icon: Cpu,             label: 'Miner'       },
  { to: '/logs',        icon: Terminal,        label: 'Logs'        },
];

const ACTIVE_BG = 'linear-gradient(135deg, rgba(110,198,255,0.16) 0%, rgba(167,139,250,0.10) 100%)';

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
      className="relative flex flex-col h-full flex-shrink-0 z-30 overflow-hidden"
      style={{
        width: expanded ? 'var(--sidebar-w-expanded)' : 'var(--sidebar-w)',
        transition: 'width 260ms cubic-bezier(0.4, 0, 0.2, 1)',
        background: 'rgba(2, 5, 14, 0.88)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
      }}
    >
      {/* Logo — borderless, height pinned to match TopBar so visually
          the brand mark sits in the same band as the right-side header. */}
      <div
        className="flex items-center flex-shrink-0 overflow-hidden"
        style={{
          height: 'var(--topbar-h)',
          paddingLeft: '18px',
        }}
      >
        <img
          src="/logo.png"
          alt="Irium"
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            flexShrink: 0,
            boxShadow: '0 0 16px rgba(110,198,255,0.45), 0 0 28px rgba(167,139,250,0.20)',
          }}
        />
        <span
          className="font-display font-bold text-sm whitespace-nowrap ml-3"
          style={{
            background: 'linear-gradient(90deg, #d4eeff 0%, #6ec6ff 55%, #a78bfa 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            opacity: expanded ? 1 : 0,
            transform: expanded ? 'translateX(0)' : 'translateX(-10px)',
            transition: 'opacity 200ms ease, transform 200ms ease',
            transitionDelay: expanded ? '100ms' : '0ms',
            pointerEvents: 'none',
            letterSpacing: '0.04em',
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
                  : 'text-[rgba(238,240,255,0.40)] hover:text-[rgba(238,240,255,0.90)] hover:bg-[rgba(110,198,255,0.05)]',
              )
            }
            style={({ isActive }) => ({
              paddingLeft: 14,
              background: isActive ? ACTIVE_BG : undefined,
              borderLeft: isActive ? '2px solid #6ec6ff' : '2px solid transparent',
              boxShadow: isActive ? 'inset 0 0 22px rgba(110,198,255,0.10)' : undefined,
            })}
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span
                    className="absolute right-2 w-1 h-1 rounded-full"
                    style={{ background: '#6ec6ff', boxShadow: '0 0 6px #6ec6ff' }}
                  />
                )}
                <Icon size={17} className="flex-shrink-0" style={{ minWidth: 17, color: isActive ? '#6ec6ff' : undefined }} />
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

      {/* Bottom — borderless to match the top section's flush look */}
      <div className="flex flex-col gap-0.5 py-3 overflow-hidden">
        {/* Node status */}
        <div className="flex items-center h-8 mx-2 px-3.5 rounded-xl gap-3 overflow-hidden">
          <span className={nodeDotClass} style={{ flexShrink: 0 }} />
          <span
            className="text-xs whitespace-nowrap"
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              color: 'rgba(238,240,255,0.36)',
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
                : 'text-[rgba(238,240,255,0.40)] hover:text-[rgba(238,240,255,0.90)] hover:bg-[rgba(110,198,255,0.05)]',
            )
          }
          style={({ isActive }) => ({
            background: isActive ? ACTIVE_BG : undefined,
            borderLeft: isActive ? '2px solid #6ec6ff' : '2px solid transparent',
          })}
        >
          {({ isActive }) => (
            <>
              <Settings size={17} style={{ flexShrink: 0, minWidth: 17, color: isActive ? '#6ec6ff' : undefined }} />
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

        {/* Help & About */}
        <NavLink
          to="/about"
          className={({ isActive }) =>
            clsx(
              'flex items-center h-10 mx-2 px-3.5 rounded-xl overflow-hidden transition-all duration-150',
              isActive
                ? 'text-white'
                : 'text-[rgba(238,240,255,0.40)] hover:text-[rgba(238,240,255,0.90)] hover:bg-[rgba(110,198,255,0.05)]',
            )
          }
          style={({ isActive }) => ({
            background: isActive ? ACTIVE_BG : undefined,
            borderLeft: isActive ? '2px solid #6ec6ff' : '2px solid transparent',
          })}
        >
          {({ isActive }) => (
            <>
              <HelpCircle size={17} style={{ flexShrink: 0, minWidth: 17, color: isActive ? '#6ec6ff' : undefined }} />
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
                Help &amp; About
              </span>
            </>
          )}
        </NavLink>
      </div>
    </aside>
  );
});

export default Sidebar;
