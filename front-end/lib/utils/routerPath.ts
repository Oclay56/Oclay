import { useMemo } from "react";
import { useLocation } from "react-router-dom";

// Hook for managing URL search params with localStorage persistence
export function useFilterParams<T extends Record<string, string>>(
  key: string,
  defaults: T
) {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);

  // Get current params from URL or localStorage
  const params = useMemo(() => {
    const urlParams: Partial<T> = {};

    // First try URL params
    Object.keys(defaults).forEach((k) => {
      const value = searchParams.get(k);
      if (value !== null) {
        (urlParams as Record<string, string>)[k] = value;
      }
    });

    // Then try localStorage for missing params
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem(`filters:${key}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          Object.keys(defaults).forEach((k) => {
            if (!(k in urlParams) && k in parsed) {
              (urlParams as Record<string, string>)[k] = parsed[k];
            }
          });
        }
      } catch {
        // Ignore localStorage errors
      }
    }

    return { ...defaults, ...urlParams };
  }, [searchParams, defaults, key]);

  return { params };
}

// Get route label for display
export function getRouteLabel(path: string): string {
  const labels: Record<string, string> = {
    "/dashboard": "Dashboard",
    "/positions": "Positions",
    "/executions": "Executions",
    "/risk": "Risk",
    "/blocklist": "Blocklist",
    "/latency": "Latency",
    "/leaderboard": "Leaderboard",
    "/analyze": "Analyze",
    "/strategy": "Strategies",
    "/strategies": "Strategies",
    "/system": "System",
  };

  return labels[path] || path;
}

// Navigation items
export const NAV_ITEMS = [
  { path: "/dashboard", label: "Dashboard", icon: "LayoutDashboard" },
  { path: "/positions", label: "Positions", icon: "Wallet" },
  { path: "/executions", label: "Executions", icon: "ArrowLeftRight" },
  { path: "/risk", label: "Risk", icon: "ShieldAlert" },
  { path: "/blocklist", label: "Blocklist", icon: "Ban" },
  { path: "/latency", label: "Latency", icon: "Timer" },
  { path: "/leaderboard", label: "Leaderboard", icon: "Trophy" },
  { path: "/analyze", label: "Analyze", icon: "Search" },
  { path: "/strategies", label: "Strategies", icon: "SlidersHorizontal" },
  { path: "/system", label: "System", icon: "Settings" },
];
