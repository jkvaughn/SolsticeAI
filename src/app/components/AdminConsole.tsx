import { useSearchParams, Navigate } from 'react-router';
import { useIsAdmin } from '../hooks/useIsAdmin';
import { PageShell } from './PageShell';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { SetupPageContent } from './SetupPage';
import { ProvingGroundContent } from './ProvingGround';
import { NetworkCommandContent } from './NetworkCommand';
import DangerZoneContent from './admin/DangerZoneContent';
import { Settings, Network, FlaskConical, Globe, AlertTriangle } from 'lucide-react';

const VALID_TABS = ['setup', 'proving-ground', 'network-command', 'danger-zone'] as const;
type AdminTab = (typeof VALID_TABS)[number];

export function AdminConsole() {
  const isAdmin = useIsAdmin();
  const [searchParams, setSearchParams] = useSearchParams();

  if (!isAdmin) return <Navigate to="/" replace />;

  const rawTab = searchParams.get('tab') ?? 'setup';
  const activeTab: AdminTab = VALID_TABS.includes(rawTab as AdminTab)
    ? (rawTab as AdminTab)
    : 'setup';

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value }, { replace: true });
  };

  const triggerClass = [
    'relative px-4 py-2 text-sm font-medium rounded-none border-b-2 border-transparent',
    'text-coda-text-muted hover:text-coda-text transition-colors duration-200',
    'data-[state=active]:border-black data-[state=active]:text-coda-text',
    'dark:data-[state=active]:border-white dark:data-[state=active]:text-coda-text',
    'bg-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none',
    'cursor-pointer',
  ].join(' ');

  return (
    <PageShell
      title="Admin Console"
      subtitle="Network configuration, testing, and maintenance"
    >
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="w-full justify-start gap-1 bg-transparent border-b border-black/[0.06] dark:border-white/[0.06] rounded-none px-0 pb-0 h-auto">
          <TabsTrigger value="setup" className={triggerClass}>
            <Network size={14} className="mr-1.5 opacity-60" />
            Network Setup
          </TabsTrigger>
          <TabsTrigger value="proving-ground" className={triggerClass}>
            <FlaskConical size={14} className="mr-1.5 opacity-60" />
            Proving Ground
          </TabsTrigger>
          <TabsTrigger value="network-command" className={triggerClass}>
            <Globe size={14} className="mr-1.5 opacity-60" />
            Network Command
          </TabsTrigger>
          <TabsTrigger value="danger-zone" className={triggerClass}>
            <AlertTriangle size={14} className="mr-1.5 opacity-60" />
            Danger Zone
          </TabsTrigger>
        </TabsList>

        <TabsContent value="setup" className="mt-4">
          <SetupPageContent />
        </TabsContent>
        <TabsContent value="proving-ground" className="mt-4">
          <ProvingGroundContent />
        </TabsContent>
        <TabsContent value="network-command" className="mt-4">
          <NetworkCommandContent containerMode />
        </TabsContent>
        <TabsContent value="danger-zone" className="mt-4">
          <DangerZoneContent />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

export default AdminConsole;
