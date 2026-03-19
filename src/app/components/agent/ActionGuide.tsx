import {
  Send, DollarSign, BarChart3, Search,
  ArrowRight, Zap, Shield, Activity,
  Link2, CheckCircle2
} from 'lucide-react';

const FLOW_STEPS = [
  { icon: Send, label: 'You instruct Maestro', detail: '"Send $1M to CITI..."' },
  { icon: Zap, label: 'AI reasons & creates Tx', detail: 'Gemini 2.5 Flash' },
  { icon: Shield, label: 'Compliance + Risk check', detail: '5 checks + AI scoring' },
  { icon: Activity, label: 'Receiver agent decides', detail: 'Accept or reject' },
  { icon: Link2, label: 'On-chain settlement', detail: 'Solana Token-2022' },
  { icon: CheckCircle2, label: 'Confirmed & finalized', detail: 'Both wallets updated' },
];

interface QuickAction {
  label: string;
  command: string;
  category: 'payment' | 'query' | 'info';
}

export function ActionGuide({
  bankName,
  bankCode,
  otherBanks,
  onSelectCommand,
}: {
  bankName: string;
  bankCode: string;
  otherBanks: string[];
  onSelectCommand: (command: string) => void;
}) {
  const targetBank = otherBanks.find(b => b !== bankCode) || 'CITI';

  const quickActions: QuickAction[] = [
    {
      label: 'Send $1M for treasury',
      command: `Send $1,000,000 to ${targetBank} for wholesale treasury settlement`,
      category: 'payment',
    },
    {
      label: 'Send $1 test payment',
      command: `Send $1 to ${targetBank} for testing`,
      category: 'payment',
    },
    {
      label: 'Send $500K trade finance',
      command: `Transfer $500,000 to ${targetBank} for trade financing`,
      category: 'payment',
    },
    {
      label: 'Check my balance',
      command: 'What is my current token balance?',
      category: 'query',
    },
    {
      label: 'Show network banks',
      command: 'Show me all active banks on the Solstice Network',
      category: 'info',
    },
    {
      label: 'Network capabilities',
      command: 'What settlement capabilities does the CODA network support?',
      category: 'info',
    },
  ];

  const categoryConfig = {
    payment: { label: 'Initiate Settlement', color: 'text-coda-brand', bg: 'bg-coda-brand/10 border-coda-brand/30 hover:bg-coda-brand/20', icon: DollarSign },
    query: { label: 'Check Status', color: 'text-blue-500 dark:text-blue-400', bg: 'bg-blue-500/10 border-blue-800/30 hover:bg-blue-500/20', icon: Search },
    info: { label: 'Network Info', color: 'text-coda-brand', bg: 'bg-coda-brand/10 border-coda-brand/30 hover:bg-coda-brand/20', icon: BarChart3 },
  };

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 py-8 max-w-2xl mx-auto">
      {/* Title */}
      <div className="text-center mb-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-coda-brand/10 border border-coda-brand/30 mb-3">
          <div className="w-2 h-2 rounded-full bg-coda-brand animate-pulse" />
          <span className="text-[11px] font-bold text-coda-brand uppercase tracking-widest">
            Agent Online
          </span>
        </div>
        <h2 className="text-lg font-bold text-coda-text mb-1">
          Maestro Agent Terminal
        </h2>
        <p className="text-xs text-coda-text-muted">
          {bankName} ({bankCode}) {'\u2014'} Solstice Network Settlement Agent
        </p>
      </div>

      {/* Payment Flow */}
      <div className="w-full mb-6">
        <div className="text-[11px] font-bold text-coda-text-muted uppercase tracking-wider mb-2 px-1">
          Settlement Flow
        </div>
        <div className="flex items-center gap-0 overflow-x-auto pb-1">
          {FLOW_STEPS.map((step, idx) => (
            <div key={idx} className="flex items-center shrink-0">
              <div className="flex flex-col items-center gap-1 w-[90px]">
                <div className="w-7 h-7 rounded-lg bg-coda-surface-hover border border-coda-border/50 flex items-center justify-center">
                  <step.icon className="w-3.5 h-3.5 text-coda-text-secondary" />
                </div>
                <span className="text-[10px] text-coda-text-secondary text-center leading-tight">
                  {step.label}
                </span>
                <span className="text-[9px] text-coda-text-muted text-center leading-tight">
                  {step.detail}
                </span>
              </div>
              {idx < FLOW_STEPS.length - 1 && (
                <ArrowRight className="w-3 h-3 text-coda-text-muted shrink-0 -mt-4" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="w-full">
        <div className="text-[11px] font-bold text-coda-text-muted uppercase tracking-wider mb-2 px-1">
          Quick Actions {'\u2014'} Click to send
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {quickActions.map((action, idx) => {
            const cat = categoryConfig[action.category];
            return (
              <button
                key={idx}
                onClick={() => onSelectCommand(action.command)}
                className={`text-left px-3 py-2.5 rounded-lg border transition-all ${cat.bg} group`}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <cat.icon className={`w-3 h-3 ${cat.color}`} />
                  <span className={`text-[11px] font-bold ${cat.color}`}>
                    {action.label}
                  </span>
                </div>
                <p className="text-[11px] text-coda-text-muted group-hover:text-coda-text-secondary transition-colors leading-relaxed">
                  "{action.command}"
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Hint */}
      <div className="mt-6 text-center">
        <p className="text-[11px] text-coda-text-muted">
          Type any natural language instruction below, or click a quick action above.
        </p>
        <p className="text-[11px] text-coda-text-muted mt-1">
          Settlements are real on-chain Token-2022 transfers on Solana Devnet.
        </p>
      </div>
    </div>
  );
}