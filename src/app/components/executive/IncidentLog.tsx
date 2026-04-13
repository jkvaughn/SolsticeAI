import { useState } from 'react';
import { AlertOctagon } from 'lucide-react';
import { WidgetShell } from '../dashboard/WidgetShell';

// ============================================================
// Incident Log (Task 168)
//
// Historical incident log with severity classification,
// timeline, impact, and resolution details.
// ============================================================

type Severity = 'P0' | 'P1' | 'P2' | 'P3';

interface Incident {
  id: string;
  severity: Severity;
  title: string;
  date: string;
  duration: string;
  impact: string;
  resolution: string;
  status: 'resolved' | 'monitoring';
}

const MOCK_INCIDENTS: Incident[] = [
  {
    id: 'INC-001',
    severity: 'P2',
    title: 'Elevated RPC latency on Solstice Network',
    date: '2026-03-28T14:30:00Z',
    duration: '47 minutes',
    impact: 'Settlement confirmations delayed by ~30s. No data loss.',
    resolution: 'Validator node restarted. Root cause: memory pressure from log accumulation.',
    status: 'resolved',
  },
  {
    id: 'INC-002',
    severity: 'P3',
    title: 'Cadenza false positive spike',
    date: '2026-03-15T09:15:00Z',
    duration: '2 hours',
    impact: '12 low-risk transactions flagged incorrectly. All manually approved.',
    resolution: 'Risk scoring threshold adjusted from 0.45 to 0.55 for velocity checks.',
    status: 'resolved',
  },
  {
    id: 'INC-003',
    severity: 'P1',
    title: 'Token mint authority rotation',
    date: '2026-02-20T03:00:00Z',
    duration: '15 minutes (planned)',
    impact: 'Planned maintenance window. No settlements during rotation.',
    resolution: 'Mint authority successfully rotated per quarterly security policy.',
    status: 'resolved',
  },
];

const SEVERITY_STYLES: Record<Severity, { color: string; bg: string }> = {
  P0: { color: 'text-red-500 dark:text-red-400', bg: 'bg-red-500/15' },
  P1: { color: 'text-orange-500 dark:text-orange-400', bg: 'bg-orange-500/15' },
  P2: { color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/15' },
  P3: { color: 'text-blue-500 dark:text-blue-400', bg: 'bg-blue-500/15' },
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function IncidentLog() {
  const [showReport, setShowReport] = useState(false);

  return (
    <WidgetShell
      title="Incident Log"
      icon={AlertOctagon}
      headerRight={
        <button
          onClick={() => setShowReport(!showReport)}
          className="text-[11px] font-mono text-coda-text-muted hover:text-coda-text transition-colors cursor-pointer"
        >
          {showReport ? 'Cancel' : 'Report Incident'}
        </button>
      }
    >
      <div className="space-y-0">
        {showReport && (
          <div className="py-4 mb-3 border-b border-black/[0.06] dark:border-white/[0.06]">
            <div className="text-[13px] text-coda-text-muted text-center italic">
              Incident reporting form coming soon. Contact network operations for urgent issues.
            </div>
          </div>
        )}

        {MOCK_INCIDENTS.map((inc, i) => {
          const sevStyle = SEVERITY_STYLES[inc.severity];
          return (
            <div
              key={inc.id}
              className={`py-3 ${
                i > 0 ? 'border-t border-black/[0.06] dark:border-white/[0.06]' : ''
              }`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-mono font-bold rounded ${sevStyle.bg} ${sevStyle.color}`}>
                  {inc.severity}
                </span>
                <span className="text-[13px] font-medium text-coda-text flex-1">{inc.title}</span>
                <span className="text-[11px] font-mono text-coda-text-muted tabular-nums">{fmtDate(inc.date)}</span>
              </div>
              <div className="grid grid-cols-3 gap-3 text-[12px]">
                <div>
                  <span className="text-coda-text-muted">Duration:</span>{' '}
                  <span className="text-coda-text">{inc.duration}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-coda-text-muted">Impact:</span>{' '}
                  <span className="text-coda-text">{inc.impact}</span>
                </div>
              </div>
              <div className="text-[12px] mt-1">
                <span className="text-coda-text-muted">Resolution:</span>{' '}
                <span className="text-coda-text">{inc.resolution}</span>
              </div>
            </div>
          );
        })}
      </div>
    </WidgetShell>
  );
}
