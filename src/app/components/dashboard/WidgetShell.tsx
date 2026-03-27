import { useState, useEffect, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTheme } from '../ThemeProvider';

// ============================================================
// WidgetShell — Glass card for dashboard content widgets
//
// Simple bordered container with title row + content.
// Only the PageShell header uses the two-zone glass fill pattern.
// Widgets are subordinate — outline only, no glass fill.
//
// Supports optional collapsible behavior, icon, variant, and
// dirty indicator for use across all pages.
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
  /** Optional icon displayed before the title */
  icon?: React.ElementType;
  /** Enable collapsible accordion behavior */
  collapsible?: boolean;
  /** Whether the collapsible starts open (default: true) */
  defaultOpen?: boolean;
  /** Force open/closed from parent (overrides internal state) */
  forceOpen?: boolean;
  /** Show a dirty/unsaved indicator dot */
  dirty?: boolean;
  /** Visual variant — 'danger' tints the icon red */
  variant?: 'default' | 'danger';
}

export function WidgetShell({
  title,
  headerRight,
  children,
  footer,
  className = '',
  icon: Icon,
  collapsible = false,
  defaultOpen = true,
  forceOpen,
  dirty = false,
  variant = 'default',
}: WidgetShellProps) {
  const { resolved } = useTheme();
  const isDark = resolved === 'dark';
  const [open, setOpen] = useState(forceOpen ?? defaultOpen);

  useEffect(() => {
    if (forceOpen !== undefined) setOpen(forceOpen);
  }, [forceOpen]);

  const glassBg = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.55)';
  const borderColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.7)';
  const glassShadow = isDark
    ? '0 8px 32px 0 rgba(0, 0, 0, 0.4)'
    : '0 8px 32px 0 rgba(0, 0, 0, 0.06), 0 1px 3px 0 rgba(0, 0, 0, 0.04)';

  const iconBg = variant === 'danger'
    ? 'bg-red-500/10 text-red-500 dark:text-red-400'
    : 'bg-black/[0.06] dark:bg-white/[0.08] text-coda-text-secondary';

  const isOpen = !collapsible || open;

  const titleContent = (
    <>
      {Icon && (
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${iconBg}`}>
          <Icon size={15} />
        </div>
      )}
      <h2 className="text-base font-light text-coda-text flex-1 text-left">{title}</h2>
      {dirty && <span className="w-2 h-2 rounded-full bg-coda-text-secondary mr-1" title="Unsaved changes" />}
      {headerRight && (
        <div className="flex items-center gap-2">
          {headerRight}
        </div>
      )}
      {collapsible && (
        isOpen
          ? <ChevronDown size={16} className="text-coda-text-muted" />
          : <ChevronRight size={16} className="text-coda-text-muted" />
      )}
    </>
  );

  return (
    <div
      className={`transition-colors duration-500 overflow-hidden ${className}`}
      style={{
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        background: glassBg,
        border: `1px solid ${borderColor}`,
        borderRadius: 20,
        boxShadow: glassShadow,
      }}
    >
      {/* Title row — clickable when collapsible */}
      {collapsible ? (
        <button
          onClick={() => setOpen(!open)}
          className="w-full px-5 py-3.5 flex items-center gap-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors cursor-pointer"
        >
          {titleContent}
        </button>
      ) : (
        <div className="px-5 py-3.5 flex items-center gap-3">
          {titleContent}
        </div>
      )}

      {/* Content — animated for collapsible */}
      <div
        className={collapsible ? 'transition-all duration-200 ease-in-out overflow-hidden' : 'flex-1 min-h-0 flex flex-col'}
        style={collapsible ? { maxHeight: isOpen ? '2000px' : '0', opacity: isOpen ? 1 : 0 } : undefined}
      >
        <div className="px-5 pb-4 flex-1 min-h-0 flex flex-col">
          {children}
        </div>
      </div>

      {/* Footer (optional) */}
      {footer && isOpen && (
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
