import { Outlet } from 'react-router';
import { DashboardLayout } from './dashboard/dashboard-layout';
import { HeartbeatIndicator } from './HeartbeatIndicator';
import { BanksProvider } from '../contexts/BanksContext';
import { AriaProvider } from '../contexts/AriaContext';
import { PersonaBanner } from './PersonaBanner';
import { NotificationProvider } from '../contexts/NotificationContext';
import { Toaster } from './ui/sonner';

// ============================================================
// Layout
// ============================================================

function LayoutInner() {
  return (
    <NotificationProvider>
      <DashboardLayout>
        <PersonaBanner />
        <Outlet />
        <HeartbeatIndicator />
      </DashboardLayout>
      <Toaster />
    </NotificationProvider>
  );
}

export function Layout() {
  return (
    <BanksProvider>
      <AriaProvider>
        <LayoutInner />
      </AriaProvider>
    </BanksProvider>
  );
}
