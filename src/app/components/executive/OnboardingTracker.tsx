import { UserPlus } from 'lucide-react';
import { WidgetShell } from '../dashboard/WidgetShell';

// ============================================================
// Onboarding Tracker (Task 168)
//
// Pipeline view for prospective consortium members showing
// stage progression from Discovery through to Live.
// ============================================================

type Stage = 'Discovery' | 'NDA' | 'KYB Review' | 'Technical Integration' | 'Sandbox' | 'Live';
type Health = 'on_track' | 'delayed' | 'blocked';

interface Prospect {
  name: string;
  stage: Stage;
  health: Health;
  targetDate: string;
  actualDate?: string;
  contact: string;
}

const STAGES: Stage[] = ['Discovery', 'NDA', 'KYB Review', 'Technical Integration', 'Sandbox', 'Live'];

const PROSPECTS: Prospect[] = [
  {
    name: 'Pacific National Bank',
    stage: 'Sandbox',
    health: 'on_track',
    targetDate: '2026-05-15',
    contact: 'M. Chen',
  },
  {
    name: 'Atlantic Trust Corp',
    stage: 'Technical Integration',
    health: 'delayed',
    targetDate: '2026-04-30',
    contact: 'J. Rivera',
  },
  {
    name: 'Summit Federal Credit Union',
    stage: 'KYB Review',
    health: 'on_track',
    targetDate: '2026-06-01',
    contact: 'A. Patel',
  },
  {
    name: 'Cascade Savings Bank',
    stage: 'Discovery',
    health: 'blocked',
    targetDate: '2026-07-15',
    contact: 'R. Kim',
  },
];

const HEALTH_STYLES: Record<Health, { label: string; color: string; bg: string }> = {
  on_track: { label: 'On Track', color: 'text-emerald-500 dark:text-emerald-400', bg: 'bg-emerald-500/15' },
  delayed: { label: 'Delayed', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/15' },
  blocked: { label: 'Blocked', color: 'text-red-500 dark:text-red-400', bg: 'bg-red-500/15' },
};

function stageIndex(stage: Stage): number {
  return STAGES.indexOf(stage);
}

export function OnboardingTracker() {
  return (
    <WidgetShell title="Member Onboarding Pipeline" icon={UserPlus}>
      <div className="space-y-4">
        {/* Stage headers */}
        <div className="grid grid-cols-6 gap-1">
          {STAGES.map((s) => (
            <div key={s} className="text-[10px] font-mono text-coda-text-muted uppercase tracking-wider text-center">
              {s}
            </div>
          ))}
        </div>

        {/* Prospect rows */}
        {PROSPECTS.map((p, i) => {
          const idx = stageIndex(p.stage);
          const healthCfg = HEALTH_STYLES[p.health];
          return (
            <div
              key={p.name}
              className={`${i > 0 ? 'border-t border-black/[0.06] dark:border-white/[0.06] pt-3' : ''}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="text-[13px] font-medium text-coda-text">{p.name}</span>
                  <span className="text-[11px] text-coda-text-muted ml-2">{p.contact}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-mono rounded ${healthCfg.bg} ${healthCfg.color}`}>
                    {healthCfg.label}
                  </span>
                  <span className="text-[11px] font-mono text-coda-text-muted tabular-nums">
                    Target: {p.targetDate}
                  </span>
                </div>
              </div>

              {/* Stage progress bar */}
              <div className="grid grid-cols-6 gap-1">
                {STAGES.map((s, si) => {
                  let bg = 'bg-black/[0.04] dark:bg-white/[0.04]';
                  if (si < idx) bg = 'bg-emerald-500/30';
                  else if (si === idx) {
                    bg = p.health === 'blocked'
                      ? 'bg-red-500/40'
                      : p.health === 'delayed'
                        ? 'bg-amber-500/40'
                        : 'bg-blue-500/40';
                  }
                  return (
                    <div
                      key={s}
                      className={`h-2 rounded-full ${bg} transition-colors`}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </WidgetShell>
  );
}
