// PromotionWorkflow — sandbox → live promotion with prerequisite checklist + dual approval

import { useState } from 'react';
import { CheckCircle2, Circle, ShieldAlert, ArrowUpCircle } from 'lucide-react';
import { SandboxBadge } from './SandboxBadge';

interface Prerequisite {
  id: string;
  label: string;
  met: boolean;
}

interface IntegrationPromotion {
  key: string;
  name: string;
  mode: 'sandbox' | 'live';
  prerequisites: Prerequisite[];
  initiatedBy: string | null;
  approvedBy: string | null;
  promotedAt: string | null;
}

// Mock data — prerequisites tied to Proving Ground scenario categories
const MOCK_PROMOTIONS: IntegrationPromotion[] = [
  {
    key: 'verify',
    name: 'Identity Verification',
    mode: 'sandbox',
    prerequisites: [
      { id: 'pg-kyc-basic', label: 'Proving Ground: KYC basic flow', met: false },
      { id: 'pg-kyc-edge', label: 'Proving Ground: KYC edge cases', met: false },
      { id: 'pg-verify-latency', label: 'P95 latency < 500ms over 100 calls', met: false },
    ],
    initiatedBy: null,
    approvedBy: null,
    promotedAt: null,
  },
  {
    key: 'compliance_filing',
    name: 'Compliance Filing',
    mode: 'sandbox',
    prerequisites: [
      { id: 'pg-sar-filing', label: 'Proving Ground: SAR filing scenarios', met: false },
      { id: 'pg-ctr-filing', label: 'Proving Ground: CTR filing scenarios', met: false },
      { id: 'pg-compliance-latency', label: 'P95 latency < 2000ms over 50 calls', met: false },
    ],
    initiatedBy: null,
    approvedBy: null,
    promotedAt: null,
  },
  {
    key: 'custody',
    name: 'Custody',
    mode: 'sandbox',
    prerequisites: [
      { id: 'pg-custody-transfer', label: 'Proving Ground: Custody transfer flow', met: false },
      { id: 'pg-custody-reconcile', label: 'Proving Ground: Reconciliation scenarios', met: false },
      { id: 'pg-custody-latency', label: 'P95 latency < 1000ms over 100 calls', met: false },
    ],
    initiatedBy: null,
    approvedBy: null,
    promotedAt: null,
  },
];

export function PromotionWorkflow() {
  const [promotions] = useState<IntegrationPromotion[]>(MOCK_PROMOTIONS);
  const [promoting, setPromoting] = useState<string | null>(null);

  const handlePromote = (key: string) => {
    // In production this writes to bank_agent_config.integrations + audit log
    // For now just show the flow
    setPromoting(key);
    setTimeout(() => setPromoting(null), 2000);
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider">
        Promotion Workflow
      </h3>

      <div className="grid gap-4">
        {promotions.map((promo) => {
          const allMet = promo.prerequisites.every((p) => p.met);
          const isPromoting = promoting === promo.key;

          return (
            <div
              key={promo.key}
              className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-4 space-y-3"
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="font-medium text-white/90">{promo.name}</span>
                  <SandboxBadge integration={promo.key} mode={promo.mode} />
                </div>
                {promo.mode === 'live' ? (
                  <span className="text-xs text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Promoted {promo.promotedAt ? new Date(promo.promotedAt).toLocaleDateString() : ''}
                  </span>
                ) : null}
              </div>

              {/* Prerequisites checklist */}
              <div className="space-y-1.5 pl-1">
                {promo.prerequisites.map((prereq) => (
                  <div key={prereq.id} className="flex items-center gap-2 text-sm">
                    {prereq.met ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    ) : (
                      <Circle className="h-4 w-4 text-white/25 shrink-0" />
                    )}
                    <span className={prereq.met ? 'text-white/70' : 'text-white/40'}>
                      {prereq.label}
                    </span>
                  </div>
                ))}
              </div>

              {/* Dual approval display */}
              {promo.initiatedBy && (
                <div className="text-xs text-white/40 pl-1 space-y-0.5">
                  <div>Initiated by: {promo.initiatedBy}</div>
                  {promo.approvedBy ? (
                    <div>Approved by: {promo.approvedBy}</div>
                  ) : (
                    <div className="flex items-center gap-1 text-amber-400">
                      <ShieldAlert className="h-3 w-3" />
                      Awaiting second approval
                    </div>
                  )}
                </div>
              )}

              {/* Promote button */}
              {promo.mode === 'sandbox' && (
                <button
                  disabled={!allMet || isPromoting}
                  onClick={() => handlePromote(promo.key)}
                  className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all
                    disabled:opacity-30 disabled:cursor-not-allowed
                    enabled:bg-blue-500/20 enabled:text-blue-300 enabled:hover:bg-blue-500/30 enabled:border enabled:border-blue-500/40"
                >
                  <ArrowUpCircle className="h-4 w-4" />
                  {isPromoting ? 'Initiating promotion...' : 'Promote to Live'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default PromotionWorkflow;
