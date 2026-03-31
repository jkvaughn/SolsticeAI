import type { ReactNode } from 'react';
import { motion } from './motion-shim';
import { LottieIcon } from './icons/LottieIcon';
import { useTheme } from './ThemeProvider';

// ============================================================
// PageShell — Consistent page layout matching Solstice Core XD
//
// Two-zone header card:
//   Top: LiquidGlass fill — page title
//   Bottom: Outline only (transparent) — 4 stat metrics
//
// Below: tab bar + content area
// ============================================================

export interface PageStat {
  /** Lottie animation data for the stat icon */
  lottieData?: object;
  /** Fallback: lucide-react icon component */
  icon?: React.ElementType;
  /** Large display value */
  value: string | number;
  /** Small label below value */
  label: string;
}

export interface PageTab {
  id: string;
  label: string;
  count?: number;
}

interface PageShellProps {
  /** Page title (e.g. "CODA Dashboard") */
  title: string;
  /** Optional subtitle below title */
  subtitle?: string;
  /** Up to 4 stat metrics displayed in the outline zone */
  stats?: PageStat[];
  /** Tab definitions for the filter bar */
  tabs?: PageTab[];
  /** Currently active tab ID */
  activeTab?: string;
  /** Tab change handler */
  onTabChange?: (tabId: string) => void;
  /** Right-side action in the tab bar (e.g. "+ Add" button) */
  tabAction?: ReactNode;
  /** Alert banner between header and content (e.g. orphan alert) */
  alert?: ReactNode;
  /** Main page content */
  children: ReactNode;
  /** Extra content rendered inside the title zone (right-aligned) */
  headerActions?: ReactNode;
}

// Shared spring for morph animations between pages
const shellTransition = {
  type: 'spring' as const,
  damping: 30,
  stiffness: 250,
  mass: 0.8,
};

export function PageShell({
  title,
  subtitle,
  stats,
  tabs,
  activeTab,
  onTabChange,
  tabAction,
  alert,
  children,
  headerActions,
}: PageShellProps) {
  const { resolved } = useTheme();
  const isDark = resolved === 'dark';

  // Glass styles adapted for light/dark
  const glassBg = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.55)';
  const glassBorder = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.7)';
  const glassShadow = isDark
    ? '0 8px 32px 0 rgba(0, 0, 0, 0.4)'
    : '0 8px 32px 0 rgba(0, 0, 0, 0.06), 0 1px 3px 0 rgba(0, 0, 0, 0.04)';

  return (
    <div className="space-y-4">
      {/* ─── Two-Zone Header Card ─── */}
      <motion.div
        layoutId="page-shell-header"
        transition={shellTransition}
      >
        {/* Top zone: LiquidGlass fill — title */}
        <motion.div
          layoutId="page-shell-title"
          transition={shellTransition}
          className="px-6 py-5 transition-colors duration-500"
          style={{
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            background: glassBg,
            borderTop: `1px solid ${glassBorder}`,
            borderLeft: `1px solid ${glassBorder}`,
            borderRight: `1px solid ${glassBorder}`,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            boxShadow: glassShadow,
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              <motion.h1
                layoutId="page-shell-heading"
                transition={shellTransition}
                className="text-2xl font-light text-coda-text leading-tight"
              >
                {title}
              </motion.h1>
              {subtitle && (
                <p className="text-xs text-coda-text-muted mt-0.5">{subtitle}</p>
              )}
            </div>
            {headerActions && (
              <div className="flex items-center gap-2">
                {headerActions}
              </div>
            )}
          </div>
        </motion.div>

        {/* Bottom zone: Outline only (transparent bg) — stats */}
        {stats && stats.length > 0 && (
          <motion.div
            layoutId="page-shell-stats"
            transition={shellTransition}
            className="px-6 py-4 transition-colors duration-500"
            style={{
              borderLeft: `1px solid ${glassBorder}`,
              borderRight: `1px solid ${glassBorder}`,
              borderBottom: `1px solid ${glassBorder}`,
              borderBottomLeftRadius: 28,
              borderBottomRightRadius: 28,
            }}
          >
            <div
              className="grid gap-4"
              style={{ gridTemplateColumns: `repeat(${Math.min(stats.length, 4)}, 1fr)` }}
            >
              {stats.map((stat, i) => (
                <StatMetric key={i} stat={stat} />
              ))}
            </div>
          </motion.div>
        )}
      </motion.div>

      {/* ─── Alert Banner (optional) ─── */}
      {alert}

      {/* ─── Tab Bar + Action ─── */}
      {tabs && tabs.length > 0 && (
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-1 relative">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => onTabChange?.(tab.id)}
                className="relative px-4 py-1.5 rounded-full text-sm cursor-pointer transition-colors duration-200"
              >
                {activeTab === tab.id && (
                  <motion.div
                    layoutId="settings-tab-pill"
                    className="absolute inset-0 bg-black dark:bg-white rounded-full"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <span className={`relative z-10 transition-colors duration-200 ${
                  activeTab === tab.id
                    ? 'text-white dark:text-black'
                    : 'text-coda-text-muted hover:text-coda-text'
                }`}>
                  {tab.label}
                  {tab.count !== undefined && (
                    <span className="ml-1.5 text-xs opacity-60">{tab.count}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
          {tabAction && (
            <div className="flex items-center gap-2">
              {tabAction}
            </div>
          )}
        </div>
      )}

      {/* ─── Page Content ─── */}
      <motion.div
        className="space-y-4"
        initial={{ opacity: 0, y: 12, filter: 'blur(4px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        {children}
      </motion.div>
    </div>
  );
}

function StatMetric({ stat }: { stat: PageStat }) {
  const Icon = stat.icon;

  return (
    <div className="flex items-center gap-3">
      <div className="w-8 h-8 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] flex items-center justify-center flex-shrink-0">
        {stat.lottieData ? (
          <LottieIcon
            animationData={stat.lottieData}
            size={18}
            trigger="hover"
            scale={1.15}
            className="opacity-50"
          />
        ) : Icon ? (
          <Icon size={16} className="text-coda-text-muted" />
        ) : null}
      </div>
      <div>
        <div className="text-xl font-medium text-coda-text leading-tight">
          {typeof stat.value === 'number'
            ? stat.value.toLocaleString()
            : stat.value}
        </div>
        <div className="text-[11px] text-coda-text-muted leading-tight mt-0.5">{stat.label}</div>
      </div>
    </div>
  );
}

export default PageShell;
