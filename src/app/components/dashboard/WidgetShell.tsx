import type { ReactNode } from 'react';
import { useTheme } from '../ThemeProvider';

// ============================================================
// WidgetShell — Outline-only card for dashboard content widgets
//
// Simple bordered container with title row + content.
// Only the PageShell header uses the two-zone glass fill pattern.
// Widgets are subordinate — outline only, no glass fill.
// ============================================================

interface WidgetShellProps {
  /** Widget title (regular case, not uppercase) */
  title: string;
  /** Right-side content in the header (status badges, loaders) */
  headerRight?: ReactNode;
  /** Main content */
  children: ReactNode;
  /** Optional footer below content (e.g. "View all" link) */
  footer?: ReactNode;
  /** Additional className on the outer wrapper */
  className?: string;
}

export function WidgetShell({
  title,
  headerRight,
  children,
  footer,
  className = '',
}: WidgetShellProps) {
  const { resolved } = useTheme();
  const isDark = resolved === 'dark';

  const glassBg = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.55)';
  const borderColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.7)';
  const glassShadow = isDark
    ? '0 8px 32px 0 rgba(0, 0, 0, 0.4)'
    : '0 8px 32px 0 rgba(0, 0, 0, 0.06), 0 1px 3px 0 rgba(0, 0, 0, 0.04)';

  return (
    <div
      className={`transition-colors duration-500 ${className}`}
      style={{
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        background: glassBg,
        border: `1px solid ${borderColor}`,
        borderRadius: 20,
        boxShadow: glassShadow,
      }}
    >
      {/* Title row */}
      <div className="px-5 py-3.5 flex items-center justify-between">
        <h2 className="text-base font-light text-coda-text">{title}</h2>
        {headerRight && (
          <div className="flex items-center gap-2">
            {headerRight}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="px-5 pb-4">
        {children}
      </div>

      {/* Footer (optional) */}
      {footer && (
        <div
          className="px-5 py-2.5 transition-colors duration-500"
          style={{
            borderTop: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)'}`,
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
