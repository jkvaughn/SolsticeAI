import { Outlet } from 'react-router';
import { DashboardLayout } from './dashboard/dashboard-layout';
import { HeartbeatIndicator } from './HeartbeatIndicator';
import { BanksProvider } from '../contexts/BanksContext';
import { AriaProvider } from '../contexts/AriaContext';
import { PersonaBanner } from './PersonaBanner';

// ============================================================
// Layout
// ============================================================

function LayoutInner() {
  return (
    <DashboardLayout>
      <PersonaBanner />
      <Outlet />
      <HeartbeatIndicator />
    </DashboardLayout>
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
