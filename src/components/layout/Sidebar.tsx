import React from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Wallet,
  ShieldCheck,
  ShoppingBag,
  FileText,
  Star,
  Cpu,
  Settings,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useStore } from "../../lib/store";
import clsx from "clsx";

const NAV = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/wallet", icon: Wallet, label: "Wallet" },
  { to: "/settlement", icon: ShieldCheck, label: "Settlement" },
  { to: "/marketplace", icon: ShoppingBag, label: "Marketplace" },
  { to: "/agreements", icon: FileText, label: "Agreements" },
  { to: "/reputation", icon: Star, label: "Reputation" },
  { to: "/miner", icon: Cpu, label: "Miner" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export default function Sidebar() {
  const collapsed = useStore((s) => s.sidebarCollapsed);
  const toggle = useStore((s) => s.toggleSidebar);
  const location = useLocation();

  return (
    <aside
      className={clsx(
        "flex flex-col h-full transition-all duration-300 ease-in-out relative",
        "border-r border-white/5",
        collapsed ? "w-16" : "w-60"
      )}
      style={{ background: "var(--color-surface)" }}
    >
      {/* Logo */}
      <div
        className={clsx(
          "flex items-center h-14 px-4 border-b border-white/5 flex-shrink-0",
          collapsed ? "justify-center" : "gap-3"
        )}
      >
        <img
          src="/logo.png"
          alt="Irium"
          className={clsx(
            "object-contain flex-shrink-0",
            collapsed ? "w-8 h-8" : "w-9 h-9"
          )}
        />
        {!collapsed && (
          <div>
            <div className="font-display font-bold text-sm text-white leading-none">
              IRIUM
            </div>
            <div className="font-mono text-xs text-white/30 leading-none mt-0.5">
              CORE
            </div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {NAV.map(({ to, icon: Icon, label }) => {
          const isActive =
            to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);

          return (
            <NavLink
              key={to}
              to={to}
              className={clsx(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-display font-medium",
                "transition-all duration-150 relative group",
                isActive
                  ? "text-white"
                  : "text-white/50 hover:text-white/80 hover:bg-white/5",
                collapsed && "justify-center"
              )}
            >
              {isActive && (
                <div
                  className="absolute inset-0 rounded-lg opacity-100"
                  style={{
                    background:
                      "linear-gradient(135deg, rgba(123,47,226,0.2) 0%, rgba(37,99,235,0.15) 100%)",
                    border: "1px solid rgba(123,47,226,0.3)",
                  }}
                />
              )}
              <Icon
                size={18}
                className={clsx(
                  "relative z-10 flex-shrink-0",
                  isActive ? "text-irium-400" : ""
                )}
              />
              {!collapsed && (
                <span className="relative z-10 truncate">{label}</span>
              )}
              {/* Tooltip when collapsed */}
              {collapsed && (
                <div className="absolute left-full ml-2 px-2 py-1 bg-surface-600 border border-white/10 rounded text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50 transition-opacity">
                  {label}
                </div>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={toggle}
        className={clsx(
          "flex items-center justify-center h-10 border-t border-white/5",
          "text-white/30 hover:text-white/70 hover:bg-white/5 transition-all"
        )}
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>
    </aside>
  );
}



