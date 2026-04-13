import { useState, useMemo } from 'react';
import {
  Brain, Shield, Gauge, Link2, Music, TrendingUp, TrendingDown,
  AlertTriangle, Flag, RotateCcw, ArrowUpRight,
} from 'lucide-react';
import { fetchAgentMessages } from '../../dataClient';
import { useSWRCache } from '../../hooks/useSWRCache';
import { useBanks } from '../../contexts/BanksContext';
import { WidgetShell } from '../dashboard/WidgetShell';
import type { MessageType } from '../../types';

// ============================================================
// AgentPerformanceDashboard (Task 162)
//
// Per-agent performance metrics over a selectable time window.
// Maps agent_messages to the 5 CODA agents using message_type
// and natural_language heuristics, then computes decision
// distribution, confidence, flag rate, escalation rate, and
// reversal rate per agent.
// ============================================================

type TimeWindow = '7d' | '30d' | '90d';

const WINDOW_MS: Record<TimeWindow, number> = {
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
  '90d': 90 * 86_400_000,
};

interface AgentDef {
  key: string;
  name: string;
  role: string;
  icon: typeof Shield;
  matchTypes: MessageType[];
  matchKeyword: string;
}

const AGENTS: AgentDef[] = [
  { key: 'maestro', name: 'Maestro', role: 'Orchestrator', icon: Brain, matchTypes: ['payment_request', 'payment_accept', 'payment_reject', 'status_update'], matchKeyword: 'maestro' },
  { key: 'concord', name: 'Concord', role: 'Compliance', icon: Shield, matchTypes: ['compliance_query', 'compliance_response'], matchKeyword: 'concord' },
  { key: 'fermata', name: 'Fermata', role: 'Risk', icon: Gauge, matchTypes: ['risk_alert'], matchKeyword: 'fermata' },
  { key: 'cadenza', name: 'Cadenza', role: 'Dispute Resolution', icon: Music, matchTypes: ['cadenza_decision', 'lockup_action'], matchKeyword: 'cadenza' },
  { key: 'canto', name: 'Canto', role: 'Settlement', icon: Link2, matchTypes: ['settlement_confirm'], matchKeyword: 'canto' },
];

function resolveAgentKey(msg: any): string {
  const nl = ((msg.natural_language || '') as string).toLowerCase();
  for (const a of AGENTS) {
    if (nl.startsWith(a.matchKeyword)) return a.key;
  }
  for (const a of AGENTS) {
    if (a.matchTypes.includes(msg.message_type)) return a.key;
  }
  return 'maestro';
}

interface AgentMetrics {
  total: number;
  byType: Record<string, number>;
  avgConfidence: number;
  flagRate: number;
  escalationRate: number;
  reversalRate: number;
}

const BASELINE_THRESHOLD = 0.15; // 15% deviation triggers alert

function computeMetrics(msgs: any[]): AgentMetrics {
  const total = msgs.length;
  const byType: Record<string, number> = {};
  let confidenceSum = 0;
  let confidenceCount = 0;
  let flags = 0;
  let escalations = 0;
  let reversals = 0;

  for (const m of msgs) {
    byType[m.message_type] = (byType[m.message_type] || 0) + 1;
    const content = typeof m.content === 'object' ? m.content : {};
    if (content?.confidence != null) {
      confidenceSum += Number(content.confidence);
      confidenceCount++;
    }
    if (content?.flagged || m.message_type === 'risk_alert') flags++;
    if (content?.action === 'escalate' || content?.escalated) escalations++;
    if (content?.action === 'reversal' || m.message_type === 'payment_reject') reversals++;
  }

  return {
    total,
    byType,
    avgConfidence: confidenceCount > 0 ? Math.round((confidenceSum / confidenceCount) * 100) / 100 : 0,
    flagRate: total > 0 ? flags / total : 0,
    escalationRate: total > 0 ? escalations / total : 0,
    reversalRate: total > 0 ? reversals / total : 0,
  };
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

// ── Bar component for decision distribution ──
function DistributionBar({ label, count, max }: { label: string; count: number; max: number }) {
  const width = max > 0 ? Math.max((count / max) * 100, 2) : 0;
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-28 text-coda-text-muted font-mono truncate">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-black/[0.04] dark:bg-white/[0.06] overflow-hidden">
        <div className="h-full rounded-full bg-coda-brand/60 transition-all" style={{ width: `${width}%` }} />
      </div>
      <span className="w-6 text-right font-mono text-coda-text tabular-nums">{count}</span>
    </div>
  );
}

// ── Trend arrow ──
function Trend({ current, baseline }: { current: number; baseline: number }) {
  if (baseline === 0 && current === 0) return <span className="text-[11px] text-coda-text-muted">--</span>;
  const delta = baseline > 0 ? (current - baseline) / baseline : current > 0 ? 1 : 0;
  const isAlert = Math.abs(delta) > BASELINE_THRESHOLD;
  if (delta > 0) return <TrendingUp size={13} className={isAlert ? 'text-red-500' : 'text-emerald-500'} />;
  if (delta < 0) return <TrendingDown size={13} className={isAlert ? 'text-red-500' : 'text-coda-text-muted'} />;
  return <span className="text-[11px] text-coda-text-muted">=</span>;
}

export function AgentPerformanceDashboard() {
  const { cacheVersion } = useBanks();
  const [window, setWindow] = useState<TimeWindow>('30d');

  const { data: allMessages } = useSWRCache<any[]>({
    key: 'agent-perf-messages',
    fetcher: () => fetchAgentMessages({ limit: 500 }),
    deps: [cacheVersion],
    ttl: 3 * 60 * 1000,
  });

  const { currentMetrics, prevMetrics, alerts } = useMemo(() => {
    const msgs = allMessages ?? [];
    const now = Date.now();
    const windowMs = WINDOW_MS[window];

    // Split into current window and previous window (for trend comparison)
    const current = msgs.filter(m => now - new Date(m.created_at).getTime() < windowMs);
    const previous = msgs.filter(m => {
      const age = now - new Date(m.created_at).getTime();
      return age >= windowMs && age < windowMs * 2;
    });

    // Group by agent
    const curByAgent: Record<string, any[]> = {};
    const prevByAgent: Record<string, any[]> = {};
    for (const a of AGENTS) { curByAgent[a.key] = []; prevByAgent[a.key] = []; }
    for (const m of current) curByAgent[resolveAgentKey(m)].push(m);
    for (const m of previous) prevByAgent[resolveAgentKey(m)].push(m);

    const curMetrics: Record<string, AgentMetrics> = {};
    const prvMetrics: Record<string, AgentMetrics> = {};
    const alertList: string[] = [];

    for (const a of AGENTS) {
      curMetrics[a.key] = computeMetrics(curByAgent[a.key]);
      prvMetrics[a.key] = computeMetrics(prevByAgent[a.key]);

      // Check for >15% deviations
      const cm = curMetrics[a.key];
      const pm = prvMetrics[a.key];
      if (pm.total > 0) {
        if (Math.abs(cm.flagRate - pm.flagRate) > BASELINE_THRESHOLD) alertList.push(`${a.name}: flag rate shifted ${pct(cm.flagRate - pm.flagRate)}`);
        if (Math.abs(cm.escalationRate - pm.escalationRate) > BASELINE_THRESHOLD) alertList.push(`${a.name}: escalation rate shifted ${pct(cm.escalationRate - pm.escalationRate)}`);
        if (Math.abs(cm.reversalRate - pm.reversalRate) > BASELINE_THRESHOLD) alertList.push(`${a.name}: reversal rate shifted ${pct(cm.reversalRate - pm.reversalRate)}`);
      }
    }

    return { currentMetrics: curMetrics, prevMetrics: prvMetrics, alerts: alertList };
  }, [allMessages, window]);

  return (
    <WidgetShell
      title="Agent Performance"
      icon={Brain}
      headerRight={
        <div className="flex items-center gap-1.5">
          {(['7d', '30d', '90d'] as TimeWindow[]).map((w) => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={`text-[11px] font-mono px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                window === w ? 'bg-black/10 dark:bg-white/10 text-coda-text' : 'text-coda-text-muted hover:text-coda-text'
              }`}
            >
              {w}
            </button>
          ))}
        </div>
      }
    >
      {/* Alerts banner */}
      {alerts.length > 0 && (
        <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={13} className="text-amber-500" />
            <span className="text-[11px] font-mono font-semibold text-amber-600 dark:text-amber-400">METRIC DEVIATION ALERT</span>
          </div>
          {alerts.map((a, i) => (
            <p key={i} className="text-[11px] text-amber-600 dark:text-amber-400 font-mono">{a}</p>
          ))}
        </div>
      )}

      {/* Agent cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {AGENTS.map((agent) => {
          const m = currentMetrics[agent.key] || { total: 0, byType: {}, avgConfidence: 0, flagRate: 0, escalationRate: 0, reversalRate: 0 };
          const pm = prevMetrics[agent.key] || { total: 0, byType: {}, avgConfidence: 0, flagRate: 0, escalationRate: 0, reversalRate: 0 };
          const Icon = agent.icon;
          const maxType = Math.max(...Object.values(m.byType), 1);
          return (
            <div key={agent.key} className="p-4 rounded-xl border border-black/[0.06] dark:border-white/[0.06] bg-black/[0.01] dark:bg-white/[0.02]">
              {/* Header */}
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-black/[0.06] dark:bg-white/[0.08] text-coda-text-secondary">
                  <Icon size={14} />
                </div>
                <div>
                  <div className="text-[13px] font-medium text-coda-text">{agent.name}</div>
                  <div className="text-[10px] text-coda-text-muted">{agent.role}</div>
                </div>
                <span className="ml-auto text-[11px] font-mono text-coda-text-muted">{m.total} decisions</span>
              </div>

              {/* Decision distribution */}
              <div className="space-y-1 mb-3">
                {Object.entries(m.byType).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([type, count]) => (
                  <DistributionBar key={type} label={type.replace(/_/g, ' ')} count={count} max={maxType} />
                ))}
                {Object.keys(m.byType).length === 0 && (
                  <p className="text-[11px] text-coda-text-muted">No decisions in window</p>
                )}
              </div>

              {/* Metric grid */}
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                <div className="flex items-center gap-1.5">
                  <Gauge size={11} className="text-coda-text-muted" />
                  <span className="text-coda-text-muted">Confidence</span>
                  <span className="ml-auto font-mono text-coda-text tabular-nums">{m.avgConfidence.toFixed(2)}</span>
                </div>
                <div className="flex items-center gap-1.5 justify-end">
                  <Trend current={m.avgConfidence} baseline={pm.avgConfidence} />
                </div>

                <div className="flex items-center gap-1.5">
                  <Flag size={11} className="text-coda-text-muted" />
                  <span className="text-coda-text-muted">Flag Rate</span>
                  <span className="ml-auto font-mono text-coda-text tabular-nums">{pct(m.flagRate)}</span>
                </div>
                <div className="flex items-center gap-1.5 justify-end">
                  <Trend current={m.flagRate} baseline={pm.flagRate} />
                </div>

                <div className="flex items-center gap-1.5">
                  <ArrowUpRight size={11} className="text-coda-text-muted" />
                  <span className="text-coda-text-muted">Escalation</span>
                  <span className="ml-auto font-mono text-coda-text tabular-nums">{pct(m.escalationRate)}</span>
                </div>
                <div className="flex items-center gap-1.5 justify-end">
                  <Trend current={m.escalationRate} baseline={pm.escalationRate} />
                </div>

                <div className="flex items-center gap-1.5">
                  <RotateCcw size={11} className="text-coda-text-muted" />
                  <span className="text-coda-text-muted">Reversal</span>
                  <span className="ml-auto font-mono text-coda-text tabular-nums">{pct(m.reversalRate)}</span>
                </div>
                <div className="flex items-center gap-1.5 justify-end">
                  <Trend current={m.reversalRate} baseline={pm.reversalRate} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </WidgetShell>
  );
}
