// SandboxBadge — small pill showing sandbox/live mode per integration

interface SandboxBadgeProps {
  integration: string; // 'verify' | 'compliance_filing' | 'custody'
  mode: 'sandbox' | 'live';
}

const LABELS: Record<string, string> = {
  verify: 'Verify',
  compliance_filing: 'Compliance Filing',
  custody: 'Custody',
};

export function SandboxBadge({ integration, mode }: SandboxBadgeProps) {
  const label = LABELS[integration] ?? integration;

  if (mode === 'live') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-400 border border-emerald-500/30">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        LIVE
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/15 px-2.5 py-0.5 text-xs font-medium text-blue-400 border border-blue-500/30">
      <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
      SANDBOX &mdash; {label}
    </span>
  );
}

export default SandboxBadge;
