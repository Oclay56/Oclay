"use client";

import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  ShieldAlert,
  Ban,
  Timer,
  Trophy,
  Search,
  SlidersHorizontal,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/lib/state";

const navItems = [
  { path: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { path: "/positions", label: "Positions", icon: Wallet },
  { path: "/executions", label: "Executions", icon: ArrowLeftRight },
  { path: "/risk", label: "Risk", icon: ShieldAlert },
  { path: "/blocklist", label: "Blocklist", icon: Ban },
  { path: "/latency", label: "Latency", icon: Timer },
  { path: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { path: "/analyze", label: "Analyze", icon: Search },
  { path: "/strategies", label: "Strategies", icon: SlidersHorizontal },
  { path: "/system", label: "System", icon: Settings },
];

export function SidebarNav() {
  const location = useLocation();
  const { sidebarCollapsed, toggleSidebar } = useUIStore();

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 h-screen",
        "bg-[#0B0D10] border-r border-[rgba(142,152,169,0.12)]",
        "transition-all duration-300 ease-in-out",
        sidebarCollapsed ? "w-16" : "w-56"
      )}
    >
      {/* Logo */}
      <div className="flex h-14 items-center border-b border-[rgba(142,152,169,0.12)] px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded bg-[#2EC3E5]/15">
          <span className="text-sm font-bold text-[#2EC3E5]">O</span>
        </div>
        {!sidebarCollapsed && (
          <span className="ml-3 text-sm font-semibold text-[#F2F5FA]">
            Oclay
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-1 p-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname.startsWith(item.path);

          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5",
                "text-sm transition-colors duration-150",
                isActive
                  ? "bg-[#2EC3E5]/15 text-[#2EC3E5]"
                  : "text-[#A7AFBF] hover:bg-[#1E222C] hover:text-[#F2F5FA]"
              )}
              title={sidebarCollapsed ? item.label : undefined}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              {!sidebarCollapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={toggleSidebar}
        className={cn(
          "absolute bottom-4 left-1/2 -translate-x-1/2",
          "flex h-8 w-8 items-center justify-center rounded-lg",
          "text-[#8B93A7] hover:bg-[#1E222C] hover:text-[#F2F5FA]",
          "transition-colors duration-150"
        )}
        title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <svg
          className={cn(
            "h-4 w-4 transition-transform duration-300",
            sidebarCollapsed && "rotate-180"
          )}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
          />
        </svg>
      </button>
    </aside>
  );
}
