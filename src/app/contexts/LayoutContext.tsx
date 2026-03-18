/**
 * LayoutContext — Exposes sidebar geometry from DashboardLayout
 * so child pages can position fixed elements (e.g., Aria input bar)
 * without duplicating sidebar state logic.
 */

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

interface LayoutContextValue {
  /** Total left offset in pixels (sidebar width + gap) */
  sidebarWidth: number;
}

const LayoutContext = createContext<LayoutContextValue>({ sidebarWidth: 104 });

export function LayoutProvider({
  sidebarWidth,
  children,
}: {
  sidebarWidth: number;
  children: ReactNode;
}) {
  return (
    <LayoutContext.Provider value={{ sidebarWidth }}>
      {children}
    </LayoutContext.Provider>
  );
}

export function useLayout(): LayoutContextValue {
  return useContext(LayoutContext);
}
