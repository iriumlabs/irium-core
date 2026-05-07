import { useLocation, NavLink } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Wallet, ShieldCheck, ShoppingBag,
  FileText, Star, Cpu, Settings, ChevronRight,
} from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../../lib/store';

const NAV = [
  { to: '/dashboard',  icon: LayoutDashboard, label: 'Dashboard'   },
  { to: '/wallet',     icon: Wallet,          label: 'Wallet'      },
  { to: '/settlement', icon: ShieldCheck,     label: 'Settlement'  },
  { to: '/marketplace',icon: ShoppingBag,     label: 'Marketplace' },
  { to: '/agreements', icon: FileText,        label: 'Agreements'  },
  { to: '/reputation', icon: Star,            label: 'Reputation'  },
  { to: '/miner',      icon: Cpu,             label: 'Miner'       },
  { to: '/settings',   icon: Settings,        label: 'Settings'    },
];

export default function Sidebar() {
  const collapsed = useStore((s) => s.sidebarCollapsed);
  const toggle    = useStore((s) => s.toggleSidebar);
  const nodeStatus = useStore((s) => s.nodeStatus);
  const location  = useLocation();

  const nodeDot =
    nodeStatus?.running && nodeStatus?.synced ? 'dot-live' :
    nodeStatus?.running                       ? 'dot-syncing' :
                                                'dot-offline';
  const nodeLabel =
    nodeStatus?.running && nodeStatus?.synced ? 'Live' :
    nodeStatus?.running                       ? 'Syncing…' :
                                                'Offline';

  return (
    <motion.aside
      animate={{ width: collapsed ? 64 : 240 }}
      transition={{ duration: 0.3, ease: [0.34, 1.56, 0.64, 1] }}
      className={clsx(
        'flex flex-col h-full flex-shrink-0 relative z-30',
        'border-r border-white/[0.06]',
        'glass',
      )}
      style={{ overflow: 'hidden' }}
    >
      {/* ── Logo ── */}
      <div className={clsx(
        'flex items-center h-14 border-b border-white/[0.06] flex-shrink-0 px-4',
        collapsed ? 'justify-center' : 'gap-3',
      )}>
        <motion.img
          src="/logo.png"
          alt="Irium"
          animate={{ width: collapsed ? 28 : 32, height: collapsed ? 28 : 32 }}
          transition={{ duration: 0.3 }}
          className="object-contain flex-shrink-0"
          style={{
            filter: 'drop-shadow(0 0 8px rgba(123,47,226,0.6))',
          }}
        />
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              key="wordmark"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.18 }}
            >
              <div className="font-display font-bold text-sm text-white leading-none tracking-wide">
                IRIUM
              </div>
              <div className="font-mono text-[10px] text-white/30 leading-none mt-0.5 tracking-widest">
                CORE
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Nav ── */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {NAV.map(({ to, icon: Icon, label }, index) => {
          const isActive = location.pathname === to ||
            (to !== '/dashboard' && location.pathname.startsWith(to));

          return (
            <NavLink
              key={to}
              to={to}
              className={clsx(
                'relative flex items-center rounded-lg px-3 py-2.5 text-sm font-display font-medium',
                'transition-colors duration-150 group',
                collapsed ? 'justify-center' : 'gap-3',
                isActive ? 'text-white' : 'text-white/50 hover:text-white/80',
              )}
            >
              {/* Animated active pill */}
              {isActive && (
                <motion.div
                  layoutId="nav-pill"
                  className="absolute inset-0 rounded-lg"
                  style={{
                    background: 'linear-gradient(135deg, rgba(123,47,226,0.22) 0%, rgba(37,99,235,0.16) 100%)',
                    border: '1px solid rgba(123,47,226,0.28)',
                  }}
                  transition={{ duration: 0.25, ease: [0.34, 1.56, 0.64, 1] }}
                />
              )}

              {/* Hover fill (non-active) */}
              {!isActive && (
                <motion.div
                  className="absolute inset-0 rounded-lg bg-white/0 group-hover:bg-white/[0.04]"
                  transition={{ duration: 0.12 }}
                />
              )}

              <Icon
                size={17}
                className={clsx(
                  'relative z-10 flex-shrink-0',
                  isActive ? 'text-irium-400' : '',
                )}
              />

              {/* Staggered label */}
              <AnimatePresence initial={false}>
                {!collapsed && (
                  <motion.span
                    key={to + '-label'}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{
                      opacity: 1, x: 0,
                      transition: { duration: 0.15, delay: index * 0.025 },
                    }}
                    exit={{
                      opacity: 0, x: -6,
                      transition: { duration: 0.1, delay: index * 0.015 },
                    }}
                    className="relative z-10 truncate flex-1 min-w-0"
                  >
                    {label}
                  </motion.span>
                )}
              </AnimatePresence>

              {/* Collapsed tooltip */}
              {collapsed && (
                <div className="absolute left-full ml-2.5 px-2.5 py-1 bg-surface-600 border border-white/10 rounded-lg text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50 transition-opacity duration-150">
                  {label}
                </div>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* ── Node status ── */}
      <div className={clsx(
        'flex items-center border-t border-white/[0.06] px-3 py-2.5 gap-2',
        collapsed && 'justify-center',
      )}>
        <span className={nodeDot} />
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.span
              key="node-label"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { delay: 0.1 } }}
              exit={{ opacity: 0 }}
              className="text-xs font-mono text-white/40 truncate"
            >
              {nodeLabel}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* ── Collapse toggle ── */}
      <button
        onClick={toggle}
        className="flex items-center justify-center h-9 border-t border-white/[0.06] text-white/30 hover:text-white/70 hover:bg-white/5 transition-all flex-shrink-0"
      >
        <motion.span
          animate={{ rotate: collapsed ? 0 : 180 }}
          transition={{ duration: 0.3 }}
        >
          <ChevronRight size={14} />
        </motion.span>
      </button>
    </motion.aside>
  );
}
