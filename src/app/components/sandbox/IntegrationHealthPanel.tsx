// IntegrationHealthPanel — executive view of all 3 integration statuses

import { SandboxBadge } from './SandboxBadge';

interface IntegrationStatus {
  name: string;
  key: string;
  mode: 'sandbox' | 'live';
  lastCall: string | null;
  p95Latency: number | null;
  errorRate: number | null;
  promotedAt: string | null;
  promotedBy: string | null;
}

// Mock data — will be replaced with real API reads once endpoints exist
const MOCK_INTEGRATIONS: IntegrationStatus[] = [
  {
    name: 'Identity Verification',
    key: 'verify',
    mode: 'sandbox',
    lastCall: null,
    p95Latency: null,
    errorRate: null,
    promotedAt: null,
    promotedBy: null,
  },
  {
    name: 'Compliance Filing',
    key: 'compliance_filing',
    mode: 'sandbox',
    lastCall: null,
    p95Latency: null,
    errorRate: null,
    promotedAt: null,
    promotedBy: null,
  },
  {
    name: 'Custody',
    key: 'custody',
    mode: 'sandbox',
    lastCall: null,
    p95Latency: null,
    errorRate: null,
    promotedAt: null,
    promotedBy: null,
  },
];

function fmt(val: number | null, suffix: string) {
  if (val === null) return <span className="text-white/30">No activity</span>;
  return `${val}${suffix}`;
}

function fmtTime(iso: string | null) {
  if (!iso) return <span className="text-white/30">No activity</span>;
  return new Date(iso).toLocaleString();
}

export function IntegrationHealthPanel() {
  const integrations = MOCK_INTEGRATIONS;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider">
        Integration Health
      </h3>

      <div className="overflow-x-auto rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm">
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="border-b border-white/10 text-white/50 text-xs uppercase tracking-wider">
              <th className="px-4 py-3 font-medium">Integration</th>
              <th className="px-4 py-3 font-medium">Mode</th>
              <th className="px-4 py-3 font-medium">Last API Call</th>
              <th className="px-4 py-3 font-medium">P95 Latency</th>
              <th className="px-4 py-3 font-medium">Error Rate</th>
              <th className="px-4 py-3 font-medium">Promotion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {integrations.map((integ) => (
              <tr key={integ.key} className="text-white/80 hover:bg-white/5 transition-colors">
                <td className="px-4 py-3 font-medium">{integ.name}</td>
                <td className="px-4 py-3">
                  <SandboxBadge integration={integ.key} mode={integ.mode} />
                </td>
                <td className="px-4 py-3">{fmtTime(integ.lastCall)}</td>
                <td className="px-4 py-3">{fmt(integ.p95Latency, 'ms')}</td>
                <td className="px-4 py-3">{fmt(integ.errorRate, '%')}</td>
                <td className="px-4 py-3">
                  {integ.promotedAt ? (
                    <span className="text-xs text-white/50">
                      {new Date(integ.promotedAt).toLocaleDateString()} by {integ.promotedBy}
                    </span>
                  ) : (
                    <span className="text-white/30 text-xs">Not promoted</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default IntegrationHealthPanel;
