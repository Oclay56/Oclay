"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UIState {
  // Sidebar state
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  // Theme
  theme: "dark" | "light" | "system";
  setTheme: (theme: "dark" | "light" | "system") => void;

  // Global search
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  clearSearch: () => void;

  // Selected mint (for detail views)
  selectedMint: string | null;
  setSelectedMint: (mint: string | null) => void;

  // Drawer state
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;

  // Table density
  tableCompact: boolean;
  toggleTableDensity: () => void;

  // Auto-refresh
  autoRefresh: boolean;
  toggleAutoRefresh: () => void;

  // Notifications
  showNotifications: boolean;
  toggleNotifications: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      theme: "dark",
      setTheme: (theme) => set({ theme }),

      searchQuery: "",
      setSearchQuery: (query) => set({ searchQuery: query }),
      clearSearch: () => set({ searchQuery: "" }),

      selectedMint: null,
      setSelectedMint: (mint) => set({ selectedMint: mint }),

      drawerOpen: false,
      setDrawerOpen: (open) => set({ drawerOpen: open }),

      tableCompact: false,
      toggleTableDensity: () =>
        set((state) => ({ tableCompact: !state.tableCompact })),

      autoRefresh: true,
      toggleAutoRefresh: () =>
        set((state) => ({ autoRefresh: !state.autoRefresh })),

      showNotifications: false,
      toggleNotifications: () =>
        set((state) => ({ showNotifications: !state.showNotifications })),
    }),
    {
      name: "oclay-ui",
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        theme: state.theme,
        tableCompact: state.tableCompact,
        autoRefresh: state.autoRefresh,
        showNotifications: state.showNotifications,
      }),
    }
  )
);
