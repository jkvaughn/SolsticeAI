import { useSearchParams, Navigate } from 'react-router';
import { useIsAdmin } from '../hooks/useIsAdmin';
import { PageShell, type PageStat, type PageTab } from './PageShell';
import { SetupPageContent } from './SetupPage';
import { ProvingGroundContent } from './ProvingGround';
import { NetworkCommandContent } from './NetworkCommand';
import DangerZoneContent from './admin/DangerZoneContent';
import { useBanks } from '../contexts/BanksContext';
import { Building2, Coins, FlaskConical, Shield } from 'lucide-react';

const VALID_TABS = ['setup', 'proving-ground', 'network-command', 'danger-zone'] as const;
type AdminTab = (typeof VALID_TABS)[number];

const TABS: PageTab[] = [
  { id: 'setup', label: 'Network Setup' },
  { id: 'proving-ground', label: 'Proving Ground' },
  { id: 'network-command', label: 'Network Command' },
  { id: 'danger-zone', label: 'Danger Zone' },
];

export function AdminConsole() {
  const isAdmin = useIsAdmin();
  const [searchParams, setSearchParams] = useSearchParams();
  const { banks } = useBanks();

  if (!isAdmin) return <Navigate to="/" replace />;

  const rawTab = searchParams.get('tab') ?? 'setup';
  const activeTab: AdminTab = VALID_TABS.includes(rawTab as AdminTab)
    ? (rawTab as AdminTab)
    : 'setup';

  const handleTabChange = (tabId: string) => {
    setSearchParams({ tab: tabId }, { replace: true });
  };

  const activeBanks = banks?.filter((b: any) => b.status === 'active') ?? [];
  const totalLiquidity = activeBanks.reduce((sum: number, b: any) => sum + (b.balance ?? 0), 0);

  const stats: PageStat[] = [
    { icon: Building2, value: activeBanks.length, label: 'Active Banks' },
    { icon: Coins, value: `$${(totalLiquidity / 1_000_000).toFixed(0)}M`, label: 'Total Liquidity' },
    { icon: FlaskConical, value: '4', label: 'Test Categories' },
    { icon: Shield, value: 'Admin', label: 'Access Level' },
  ];

  return (
    <PageShell
      title="Admin Console"
      subtitle="Network configuration, testing, and maintenance"
      stats={stats}
      tabs={TABS}
      activeTab={activeTab}
      onTabChange={handleTabChange}
    >
      {activeTab === 'setup' && <SetupPageContent />}
      {activeTab === 'proving-ground' && <ProvingGroundContent />}
      {activeTab === 'network-command' && <NetworkCommandContent containerMode />}
      {activeTab === 'danger-zone' && <DangerZoneContent />}
    </PageShell>
  );
}

export default AdminConsole;
