import * as React from "react";
import { useNavigate, useLocation } from "react-router";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger
} from "../ui/tooltip";
import { motion } from "../motion-shim";
import { useTheme } from "../ThemeProvider";
import { AnimatedBackground } from "../AnimatedBackground";
import { LottieIcon } from "../icons/LottieIcon";
import {
  dashboard as dashboardAnim,
  aiNeuralNetworks as treasuryAnim,
  transfer as transferAnim,
  eye3 as escalationsAnim,
  blockchainExplorer as explorerAnim,
  networkSquare as networkSetupAnim,
  nodes as agentConfigAnim,
  settings as settingsAnim,
  userProfile as userProfileAnim,
  sidebarOpen as sidebarOpenAnim,
  sidebarClose as sidebarCloseAnim,
} from "../icons/lottie";
import { useAuth } from "../../contexts/AuthContext";
import codaIcon from "../icons/coda-icon.svg";
import { LayoutProvider } from "../../contexts/LayoutContext";
import { supabase } from "../../supabaseClient";
import { useRealtimeSubscription } from "../../hooks/useRealtimeSubscription";
import { usePersona } from "../../contexts/PersonaContext";
import { useIsAdmin } from "../../hooks/useIsAdmin";
import type { PersonaType } from "../../types";

// ============================================================
// ENVIRONMENT BANNER (local / staging only, hidden in production)
// ============================================================
function EnvironmentBanner() {
  const isProduction = !!import.meta.env.VITE_SERVER_BASE_URL;
  if (isProduction) return null;

  const isLocal = typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const label = isLocal ? 'LOCAL' : 'STAGING';
  const dotColor = isLocal ? '#b45309' : '#2563eb';

  return (
    <div className="sticky top-0 z-30 ml-0 mr-[10px] mt-4 py-1.5 flex items-center justify-center gap-2 rounded-xl border border-white/70 dark:border-white/10 bg-white/20 dark:bg-white/[0.02] backdrop-blur-sm">
      <span
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{ background: dotColor, boxShadow: `0 0 6px ${dotColor}40` }}
      />
      <span className="text-[10.5px] font-semibold tracking-widest text-coda-text-secondary">
        {label}
      </span>
    </div>
  );
}

// ============================================================
// TYPES
// ============================================================
type TimeRange = '1H' | '24H' | '7D' | '30D';

interface NavItem {
  id: string;
  label: string;
  icon?: React.ElementType;
  lottieData?: object;
  /** Per-icon visual scale to normalize sizes across different Lottie files */
  lottieScale?: number;
  route: string;
}

interface DashboardLayoutProps {
  children: React.ReactNode;
  timeRange?: TimeRange;
  onTimeRangeChange?: (range: TimeRange) => void;
}

// ============================================================
// NAVIGATION CONFIG
// ============================================================

// Operations — daily-use views: overview → operate → monitor → visualise
// lottieScale normalises visual size across icons with different viewBox usage
const opsNav: NavItem[] = [
  { id: 'dashboard',    label: 'Dashboard',       lottieData: dashboardAnim,     lottieScale: 1.05, route: '/' },
  { id: 'treasury-ops', label: 'Treasury Ops',    lottieData: treasuryAnim,      lottieScale: 1.3,  route: '/treasury-ops' },
  { id: 'transactions', label: 'Transactions',    lottieData: transferAnim,      lottieScale: 1.25, route: '/transactions' },
  { id: 'escalations',  label: 'Escalations',     lottieData: escalationsAnim,   lottieScale: 1.35, route: '/escalations' },
  { id: 'visualizer',   label: 'Visualizer',      lottieData: explorerAnim,      lottieScale: 1.2,  route: '/visualizer' },
];

// Admin — consolidated admin-only tools (visible only to admins)
const adminNav: NavItem[] = [
  { id: 'admin', label: 'Admin Console', lottieData: networkSetupAnim, lottieScale: 1.2, route: '/admin' },
];

// Configuration — agent tuning (visible to all)
const configNav: NavItem[] = [
  { id: 'agent-config', label: 'Agent Config', lottieData: agentConfigAnim, lottieScale: 1.15, route: '/agent-config' },
];

// Bottom — utilities (Settings removed; user pill navigates to /settings)
const bottomNav: NavItem[] = [];

// ============================================================
// PERSONA NAV DIMMING (Task 126)
// ============================================================
const PERSONA_PRIMARY_ITEMS: Record<Exclude<PersonaType, null>, string[]> = {
  compliance: ['escalations', 'transactions', 'admin'],
  treasury: ['treasury-ops', 'agent-config', 'transactions'],
  leadership: ['dashboard', 'visualizer', 'admin'],
};

function isNavDimmed(persona: PersonaType, itemId: string): boolean {
  if (!persona) return false;
  // Settings is now on user pill, no longer in nav items
  const primaryIds = PERSONA_PRIMARY_ITEMS[persona];
  return !primaryIds.includes(itemId);
}

// ============================================================
// COMPONENT
// ============================================================
export function DashboardLayout({
  children,
  timeRange,
  onTimeRangeChange,
}: DashboardLayoutProps) {
  const { resolved } = useTheme();
  const isDark = resolved === 'dark';
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { persona } = usePersona();
  const isAdmin = useIsAdmin();

  // --- Escalation count badge (real-time) ---
  const [escalationCount, setEscalationCount] = React.useState(0);

  const reQueryEscalatedCount = React.useCallback(() => {
    supabase
      .from('lockup_tokens')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'escalated')
      .then(({ count }) => {
        if (count !== null) setEscalationCount(count);
      });
  }, []);

  // Initial count
  React.useEffect(() => {
    reQueryEscalatedCount();
  }, [reQueryEscalatedCount]);

  // Realtime subscription
  useRealtimeSubscription({
    channelName: 'sidebar-escalation-count',
    subscriptions: [
      {
        table: 'lockup_tokens',
        event: '*',
        callback: () => reQueryEscalatedCount(),
      },
    ],
    onPoll: reQueryEscalatedCount,
  });

  // --- Sidebar expand/collapse ---
  const [isLargeScreen, setIsLargeScreen] = React.useState(
    typeof window !== 'undefined' ? window.innerWidth >= 1280 : true
  );
  const [isManuallyExpanded, setIsManuallyExpanded] = React.useState<boolean | null>(null);

  // Priority: manual state > auto (screen size)
  const sidebarExpanded = isManuallyExpanded !== null ? isManuallyExpanded : isLargeScreen;

  // --- Icon hover state for collapsed logo ---
  const [isIconHovered, setIsIconHovered] = React.useState<string | null>(null);

  React.useEffect(() => {
    const handleResize = () => {
      setIsLargeScreen(window.innerWidth >= 1280);
      setIsManuallyExpanded(null); // reset manual override on breakpoint cross
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // --- Route helpers ---
  const isActive = React.useCallback(
    (route: string) => {
      if (route === '/') return location.pathname === '/';
      return location.pathname.startsWith(route);
    },
    [location.pathname],
  );

  const handleNavigate = React.useCallback(
    (route: string) => navigate(route),
    [navigate],
  );

  // --- Shared button renderer ---
  const renderNavButton = (item: NavItem) => {
    const Icon = item.icon;
    const active = isActive(item.route);
    const showBadge = item.id === 'escalations' && escalationCount > 0;
    const dimmed = isNavDimmed(persona, item.id);
    if (dimmed) return null;

    // Lottie icons are black strokes — invert when icon would be invisible against bg
    // Light mode: inactive = dark text on light bg (no invert), active = white text on black bg (invert)
    // Dark mode: inactive = light text on dark bg (invert), active = black text on white bg (no invert)
    const invertIcon = isDark !== active;

    return (
      <div key={item.id}>
      <Tooltip open={sidebarExpanded ? false : undefined}>
        <TooltipTrigger asChild>
          <button
            onClick={() => handleNavigate(item.route)}
            className={`
              squircle-sm w-full flex items-center gap-3 duration-500 ease-out relative cursor-pointer
              ${sidebarExpanded ? 'px-3 py-2.5' : 'justify-center py-3'}
              ${active
                ? isDark
                  ? 'bg-white text-black shadow-lg'
                  : 'bg-black text-white shadow-lg'
                : isDark
                  ? 'text-coda-text-secondary hover:bg-white/10 hover:text-white backdrop-blur-sm'
                  : 'text-coda-text-secondary hover:bg-black/10 hover:text-black backdrop-blur-sm'
              }
            `}
          >
            <div className="relative flex-shrink-0">
              {item.lottieData ? (
                <LottieIcon
                  animationData={item.lottieData}
                  size={20}
                  trigger="hover"
                  scale={item.lottieScale}
                  className={`transition-[filter] duration-500 ${invertIcon ? 'invert' : ''}`}
                />
              ) : Icon ? (
                <Icon size={20} />
              ) : null}
              {showBadge && !sidebarExpanded && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-[9px] font-bold text-white flex items-center justify-center shadow-md">
                  {escalationCount > 9 ? '9+' : escalationCount}
                </span>
              )}
            </div>
            {sidebarExpanded && (
              <span className="whitespace-nowrap flex-1 text-left">
                {item.label}
              </span>
            )}
            {showBadge && sidebarExpanded && (
              <span className="flex-shrink-0 min-w-[20px] h-5 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center px-1.5 shadow-md tabular-nums">
                {escalationCount}
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>{item.label}{showBadge ? ` (${escalationCount})` : ''}</p>
        </TooltipContent>
      </Tooltip>
      </div>
    );
  };

  // User initials
  const userInitial = (user?.name || user?.email || '?')[0].toUpperCase();
  const userName = user?.name || 'User';
  const userEmail = user?.email || '';

  return (
    <div className="min-h-screen bg-coda-bg transition-colors duration-500 relative overflow-hidden">
      {/* ===== ANIMATED BACKGROUND ORBS ===== */}
      <AnimatedBackground />

      {/* ===== FLOATING LEFT SIDEBAR ===== */}
      <TooltipProvider delayDuration={0}>
        <motion.div
          initial={{ x: -100, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -100, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="fixed left-4 top-4 bottom-4 z-50 transition-all duration-500 ease-out"
          style={{ width: sidebarExpanded ? '280px' : '70px' }}
        >
          <div className="h-full transition-all duration-500 flex flex-col squircle-xl relative backdrop-blur-xl bg-white/10 dark:bg-white/5 border border-white/20 dark:border-white/10 shadow-2xl">

            {/* Header: Logo + Expand/Collapse */}
            <div className="py-6 px-3 border-b border-black/[0.06] dark:border-white/[0.06]">
              <div className="flex items-center justify-between transition-all duration-300">
                {/* Icon - Left Aligned - Clickable when collapsed */}
                <button
                  onClick={() => !sidebarExpanded && setIsManuallyExpanded(true)}
                  onMouseEnter={() => setIsIconHovered('logo')}
                  onMouseLeave={() => setIsIconHovered(null)}
                  className={`w-10 h-10 flex items-center justify-center flex-shrink-0 relative ${
                    !sidebarExpanded ? 'cursor-pointer' : 'cursor-default'
                  }`}
                >
                  {/* Logo — fades out on hover when collapsed */}
                  <div className={`w-full h-full flex items-center justify-center transition-opacity duration-300 ${
                    !sidebarExpanded && isIconHovered === 'logo' ? 'opacity-0' : 'opacity-100'
                  }`}>
                    <img src={codaIcon} alt="CODA" className="w-[90%] h-[90%] object-contain dark:invert" />
                  </div>
                  {/* Expand icon — fades in on hover when collapsed */}
                  {!sidebarExpanded && (
                    <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${
                      isIconHovered === 'logo' ? 'opacity-40' : 'opacity-0'
                    }`}>
                      <LottieIcon
                        animationData={sidebarOpenAnim}
                        size={22}
                        trigger="hover"
                        scale={1.15}
                        className={`transition-[filter] duration-500 ${isDark ? 'invert' : ''}`}
                      />
                    </div>
                  )}
                </button>

                {/* Expand/Collapse Button - Right Aligned - Only visible when expanded */}
                {sidebarExpanded && (
                  <button
                    onClick={() => setIsManuallyExpanded(false)}
                    className="flex items-center justify-center cursor-pointer duration-300 mr-3"
                  >
                    <LottieIcon
                      animationData={sidebarCloseAnim}
                      size={22}
                      trigger="hover"
                      scale={1.15}
                      className={`transition-[filter] duration-500 opacity-40 ${isDark ? 'invert' : ''}`}
                    />
                  </button>
                )}
              </div>
            </div>

            {/* Primary Navigation */}
            <div className="px-3 py-[1.1rem] flex-1 overflow-y-auto overflow-x-hidden min-h-0">
              <div className={`overflow-hidden transition-all duration-500 ease-out ${
                sidebarExpanded ? 'max-h-6 opacity-100 mb-2' : 'max-h-0 opacity-0 mb-0'
              }`}>
                <p className="text-[9px] font-mono uppercase tracking-widest text-black/30 dark:text-white/25 px-3">Ops</p>
              </div>
              <div className="space-y-1">
                {opsNav.map(renderNavButton)}
              </div>

              {/* Divider between ops and admin */}
              {isAdmin && (
                <>
                  <div className="my-3 mx-1 border-t border-black/[0.06] dark:border-white/[0.06]" />
                  <div className={`overflow-hidden transition-all duration-500 ease-out ${
                    sidebarExpanded ? 'max-h-6 opacity-100 mb-2' : 'max-h-0 opacity-0 mb-0'
                  }`}>
                    <p className="text-[9px] font-mono uppercase tracking-widest text-black/30 dark:text-white/25 px-3">Admin</p>
                  </div>
                  <div className="space-y-1">
                    {adminNav.map(renderNavButton)}
                  </div>
                </>
              )}

              {/* Divider between admin/ops and config */}
              <div className="my-3 mx-1 border-t border-black/[0.06] dark:border-white/[0.06]" />

              <div className={`overflow-hidden transition-all duration-500 ease-out ${
                sidebarExpanded ? 'max-h-6 opacity-100 mb-2' : 'max-h-0 opacity-0 mb-0'
              }`}>
                <p className="text-[9px] font-mono uppercase tracking-widest text-black/30 dark:text-white/25 px-3">Config</p>
              </div>
              <div className="space-y-1">
                {configNav.map(renderNavButton)}
              </div>
            </div>

            {/* Bottom section: Settings + User */}
            <div className="px-3 py-[0.825rem] space-y-1.5 border-t mt-auto border-black/[0.06] dark:border-white/[0.06]">
              {/* Settings nav */}
              <div className="space-y-1">
                {bottomNav.map(renderNavButton)}
              </div>

              {/* User pill — navigates to Settings (Profile tab) */}
              {user && (
                <Tooltip open={sidebarExpanded ? false : undefined}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => handleNavigate('/settings')}
                      className={`squircle-sm w-full flex items-center gap-3 py-2 duration-500 ease-out cursor-pointer ${
                        location.pathname === '/settings'
                          ? isDark ? 'bg-white/[0.10]' : 'bg-black/[0.06]'
                          : isDark ? 'hover:bg-white/[0.06]' : 'hover:bg-black/[0.04]'
                      } ${sidebarExpanded ? 'px-3' : 'justify-center px-0'}`}
                    >
                      <LottieIcon
                        animationData={userProfileAnim}
                        size={20}
                        trigger="hover"
                        scale={1.2}
                        className={`flex-shrink-0 transition-[filter] duration-500 ${isDark ? 'invert' : ''}`}
                      />
                      {sidebarExpanded && (
                        <div className="flex-1 min-w-0 text-left">
                          <p className={`text-[12px] font-medium truncate text-coda-text`}>
                            {userName}
                          </p>
                          <p className={`text-[9px] truncate font-mono text-coda-text-muted`}>
                            {userEmail}
                          </p>
                        </div>
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <p>{userName}</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        </motion.div>
      </TooltipProvider>

      {/* ===== MAIN CONTENT AREA ===== */}
      <LayoutProvider sidebarWidth={sidebarExpanded ? 312 : 102}>
        <div
          className={`h-screen overflow-y-auto transition-all duration-500 ease-out ${
            sidebarExpanded ? 'pl-[312px]' : 'pl-[102px]'
          }`}
        >
          <div className="flex flex-col min-h-full">
            <EnvironmentBanner />
            <div className={`flex-1 pb-4 pr-[10px] relative z-10 min-h-0 ${import.meta.env.VITE_SERVER_BASE_URL ? 'pt-4' : 'pt-2'}`}>
              {children}
            </div>
          </div>
        </div>
      </LayoutProvider>
    </div>
  );
}