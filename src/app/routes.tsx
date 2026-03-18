import { createBrowserRouter } from 'react-router';
import { lazy, Suspense } from 'react';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { SetupPage } from './components/SetupPage';
import { AgentTerminal } from './components/AgentTerminal';
import { TransactionMonitor } from './components/TransactionMonitor';
import { TransactionDetail } from './components/TransactionDetail';
import { Visualizer } from './components/Visualizer';
import HeartbeatControl from './components/HeartbeatControl';
import { SettingsPage } from './components/SettingsPage';
import { ProfilePage } from './components/ProfilePage';
import { AgentConfig } from './components/AgentConfig';
import { ProvingGround } from './components/ProvingGround';
import { AuthGate } from './components/AuthGate';
import { LoginPage } from './components/LoginPage';
import { NetworkCommand } from './components/NetworkCommand';

const LazyEscalationDashboard = lazy(() =>
  import('./components/EscalationDashboard').then(m => ({ default: m.EscalationDashboard }))
);

function EscalationDashboardPage() {
  return (
    <Suspense fallback={<div className="p-12 flex items-center justify-center"><span className="text-sm text-coda-text-muted">Loading escalations…</span></div>}>
      <LazyEscalationDashboard />
    </Suspense>
  );
}

function NotFound() {
  return (
    <div className="p-6 text-center">
      <p className="text-sm font-mono text-muted-foreground">404 — Page not found</p>
    </div>
  );
}

export const router = createBrowserRouter([
  {
    path: '/login',
    Component: LoginPage,
  },
  {
    path: '/',
    Component: AuthGate,
    children: [
      {
        Component: Layout,
        children: [
          { index: true, Component: Dashboard },
          { path: 'setup', Component: SetupPage },
          { path: 'agent/:bankId', Component: AgentTerminal },
          { path: 'transactions', Component: TransactionMonitor },
          { path: 'transactions/:txId', Component: TransactionDetail },
          { path: 'escalations', Component: EscalationDashboardPage },
          { path: 'treasury-ops', Component: HeartbeatControl },
          { path: 'network-command', Component: NetworkCommand },
          { path: 'agent-config', Component: AgentConfig },
          { path: 'proving-ground', Component: ProvingGround },
          { path: 'visualizer', Component: Visualizer },
          { path: 'settings', Component: SettingsPage },
          { path: 'profile', Component: ProfilePage },
          { path: '*', Component: NotFound },
        ],
      },
    ],
  },
]);