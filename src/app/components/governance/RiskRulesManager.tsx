import { useState, useEffect, useCallback } from 'react';
import {
  Shield, ChevronDown, ChevronRight, RefreshCw, Filter,
  ToggleLeft, ToggleRight, Clock, UserCheck,
} from 'lucide-react';
import { callServer } from '../../supabaseClient';
import { RuleSimulation } from './RuleSimulation';

// ============================================================
// RiskRulesManager — Browse, filter, expand, toggle risk rules
// (Task 163 — Hybrid Scoring UI)
// ============================================================

interface RiskRule {
  id: string;
  dimension: string;
  name: string;
  description: string | null;
  condition_type: string;
  condition_params: Record<string, any>;
  score_impact: number;
  override_type: string;
  active: boolean;
  version: number;
  approved_by: string | null;
  effective_from: string | null;
  created_at: string;
}

const DIMENSIONS = ['all', 'counterparty', 'jurisdiction', 'asset_type', 'behavioral'] as const;

const DIMENSION_COLORS: Record<string, string> = {
  counterparty:  'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  jurisdiction:  'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  asset_type:    'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  behavioral:    'bg-rose-500/10 text-rose-600 dark:text-rose-400',
};

const OVERRIDE_COLORS: Record<string, string> = {
  ADDITIVE:      'text-coda-text-muted',
  HARD_ESCALATE: 'text-amber-600 dark:text-amber-400',
  HARD_BLOCK:    'text-red-600 dark:text-red-400',
};

function formatDate(iso: string | null): string {
  if (!iso) return '\u2014';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function RiskRulesManager() {
  const [rules, setRules] = useState<RiskRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterDim, setFilterDim] = useState<string>('all');
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [showSim, setShowSim] = useState(false);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await callServer<{ rules: RiskRule[] }>('/risk-rules');
      setRules(res.rules ?? []);
    } catch (err) {
      console.error('[RiskRulesManager] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const toggleActive = async (rule: RiskRule) => {
    setTogglingId(rule.id);
    try {
      await callServer(`/risk-rules/${rule.id}/toggle`, { active: !rule.active });
      setRules(prev => prev.map(r => r.id === rule.id ? { ...r, active: !r.active } : r));
    } catch (err) {
      console.error('[RiskRulesManager] toggle error:', err);
    } finally {
      setTogglingId(null);
    }
  };

  const filtered = filterDim === 'all' ? rules : rules.filter(r => r.dimension === filterDim);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-light text-coda-text flex items-center gap-2">
          <Shield size={18} />
          Risk Rules
          <span className="text-xs text-coda-text-muted font-mono">({filtered.length})</span>
        </h3>
        <div className="flex items-center gap-2">
          {/* Dimension filter */}
          <div className="relative">
            <Filter size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-coda-text-muted" />
            <select
              value={filterDim}
              onChange={e => setFilterDim(e.target.value)}
              className="pl-7 pr-2 py-1 rounded-lg text-xs bg-black/[0.03] dark:bg-white/[0.03] border border-coda-border text-coda-text-secondary"
            >
              {DIMENSIONS.map(d => (
                <option key={d} value={d}>{d === 'all' ? 'All Dimensions' : d.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
          <button onClick={fetchRules} disabled={loading} className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-coda-text-muted transition-colors">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-coda-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-black/[0.02] dark:bg-white/[0.02] text-coda-text-muted text-[10px] uppercase tracking-wider">
              <th className="px-3 py-2 text-left">ID</th>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Dimension</th>
              <th className="px-3 py-2 text-left">Condition</th>
              <th className="px-3 py-2 text-center">Impact</th>
              <th className="px-3 py-2 text-left">Override</th>
              <th className="px-3 py-2 text-center">Active</th>
              <th className="px-3 py-2 text-center">V</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-coda-border/50">
            {filtered.map(rule => {
              const isExpanded = expandedId === rule.id;
              return (
                <tr key={rule.id} className="group">
                  <td colSpan={8} className="p-0">
                    {/* Main row */}
                    <div
                      className="grid grid-cols-[56px_1fr_100px_90px_64px_100px_56px_40px] items-center px-3 py-2 cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
                      onClick={() => setExpandedId(isExpanded ? null : rule.id)}
                    >
                      <span className="font-mono text-coda-text-secondary">{rule.id}</span>
                      <span className="text-coda-text font-medium flex items-center gap-1">
                        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        {rule.name}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium text-center ${DIMENSION_COLORS[rule.dimension] ?? 'text-coda-text-muted'}`}>
                        {rule.dimension.replace('_', ' ')}
                      </span>
                      <span className="font-mono text-coda-text-muted">{rule.condition_type}</span>
                      <span className="text-center font-mono font-bold text-coda-text-secondary">+{rule.score_impact}</span>
                      <span className={`font-mono text-[10px] ${OVERRIDE_COLORS[rule.override_type] ?? ''}`}>{rule.override_type}</span>
                      <span className="flex justify-center">
                        <button
                          onClick={e => { e.stopPropagation(); toggleActive(rule); }}
                          disabled={togglingId === rule.id}
                          className="transition-colors disabled:opacity-40"
                        >
                          {rule.active
                            ? <ToggleRight size={20} className="text-emerald-500" />
                            : <ToggleLeft size={20} className="text-coda-text-muted" />}
                        </button>
                      </span>
                      <span className="text-center font-mono text-coda-text-muted">v{rule.version}</span>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="px-6 pb-3 space-y-2 border-t border-coda-border/30 bg-black/[0.01] dark:bg-white/[0.01]">
                        {rule.description && (
                          <p className="text-[11px] text-coda-text-muted pt-2">{rule.description}</p>
                        )}
                        <div className="grid grid-cols-2 gap-4 text-[11px]">
                          <div>
                            <span className="text-coda-text-muted font-mono uppercase text-[9px] tracking-wider">Condition Params</span>
                            <pre className="mt-1 p-2 rounded-lg bg-black/[0.03] dark:bg-white/[0.03] text-coda-text-secondary font-mono text-[10px] overflow-x-auto max-h-32 whitespace-pre-wrap">
                              {JSON.stringify(rule.condition_params, null, 2)}
                            </pre>
                          </div>
                          <div className="space-y-1.5 pt-1">
                            <div className="flex items-center gap-1.5 text-coda-text-muted">
                              <UserCheck size={10} />
                              <span>Approved by: <span className="text-coda-text-secondary">{rule.approved_by ?? 'system'}</span></span>
                            </div>
                            <div className="flex items-center gap-1.5 text-coda-text-muted">
                              <Clock size={10} />
                              <span>Effective: <span className="text-coda-text-secondary">{formatDate(rule.effective_from)}</span></span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Simulation toggle */}
      <div>
        <button
          onClick={() => setShowSim(prev => !prev)}
          className="flex items-center gap-2 text-xs text-coda-text-muted hover:text-coda-text transition-colors"
        >
          {showSim ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Rule Simulation
        </button>
        {showSim && <RuleSimulation rules={rules} />}
      </div>
    </div>
  );
}
