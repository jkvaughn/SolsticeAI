import React, { useState, useEffect } from 'react';
import { Eye, Loader2, ArrowRight, CheckCircle2, XCircle } from 'lucide-react';
import { callServer } from '../../supabaseClient';
import type { BankAgentConfig, NetworkDefaults } from '../../types';
import type { ScenarioResult } from './ScenarioCard';

// ── Cadenza config field display metadata ───────────────────

interface CadenzaFieldMeta {
  key: string;
  label: string;
  format: (v: unknown) => string;
  /** Describe the effect of a difference for dispute scenarios */
  impactFn: (vA: unknown, vB: unknown, scenarioId: string) => string | null;
}

const fmtSensitivity = (v: unknown) => {
  const s = String(v);
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const fmtBool = (v: unknown) => v ? 'Enabled' : 'Disabled';
const fmtPctConf = (v: unknown) => `${(Number(v) * 100).toFixed(0)}%`;
const fmtMultiplier = (v: unknown) => `${Number(v).toFixed(1)}x`;
const fmtSeconds = (v: unknown) => {
  const n = Number(v);
  return n >= 3600 ? `${(n / 3600).toFixed(1)}h` : n >= 60 ? `${Math.round(n / 60)}m` : `${n}s`;
};
const fmtHours = (v: unknown) => `${Number(v)}h`;

const CADENZA_FIELDS: CadenzaFieldMeta[] = [
  {
    key: 'cadenza_monitoring_sensitivity',
    label: 'Monitoring Sensitivity',
    format: fmtSensitivity,
    impactFn: (vA, vB, sid) => {
      if (vA === vB) return null;
      const more = String(vA) === 'aggressive' ? 'A' : String(vB) === 'aggressive' ? 'B' : null;
      if (more) return `Bank ${more} (${fmtSensitivity(more === 'A' ? vA : vB)}) is more likely to flag anomalies`;
      const less = String(vA) === 'conservative' ? 'A' : String(vB) === 'conservative' ? 'B' : null;
      if (less) return `Bank ${less} (${fmtSensitivity(less === 'A' ? vA : vB)}) requires higher confidence to act`;
      return `Different sensitivity levels affect flag thresholds`;
    },
  },
  {
    key: 'cadenza_auto_reverse_enabled',
    label: 'Auto-Reverse',
    format: fmtBool,
    impactFn: (vA, vB, sid) => {
      if (vA === vB) return null;
      if (['D1', 'D2', 'D3'].some(d => sid.startsWith(d))) {
        const disabled = !vA ? 'A' : 'B';
        return `Bank ${disabled} has auto-reverse disabled \u2014 reversal scenarios will escalate instead`;
      }
      return `Auto-reverse toggle affects D1\u2013D3 reversal scenarios`;
    },
  },
  {
    key: 'cadenza_escalation_threshold',
    label: 'Escalation Threshold',
    format: fmtPctConf,
    impactFn: (vA, vB, sid) => {
      if (vA === vB) return null;
      const nA = Number(vA), nB = Number(vB);
      const higher = nA > nB ? 'A' : 'B';
      return `Bank ${higher} (${fmtPctConf(Math.max(nA, nB))}) escalates more readily \u2014 lower confidence required`;
    },
  },
  {
    key: 'cadenza_velocity_spike_multiplier',
    label: 'Velocity Spike Multiplier',
    format: fmtMultiplier,
    impactFn: (vA, vB, sid) => {
      if (vA === vB) return null;
      if (sid.startsWith('D2')) {
        const lower = Number(vA) < Number(vB) ? 'A' : 'B';
        return `Bank ${lower} (${fmtMultiplier(Math.min(Number(vA), Number(vB)))}) has a tighter velocity trigger \u2014 more likely to catch D2`;
      }
      return `Affects velocity spike detection in D2 scenario`;
    },
  },
  {
    key: 'cadenza_duplicate_window_seconds',
    label: 'Duplicate Window',
    format: fmtSeconds,
    impactFn: (vA, vB, sid) => {
      if (vA === vB) return null;
      if (sid.startsWith('D1')) {
        const wider = Number(vA) > Number(vB) ? 'A' : 'B';
        return `Bank ${wider} (${fmtSeconds(Math.max(Number(vA), Number(vB)))}) has a wider duplicate window \u2014 more likely to catch D1`;
      }
      return `Affects duplicate detection window in D1 scenario`;
    },
  },
  {
    key: 'cadenza_max_lockup_hours',
    label: 'Max Lockup Duration',
    format: fmtHours,
    impactFn: (vA, vB, sid) => {
      if (vA === vB) return null;
      if (sid.startsWith('D4') || sid.startsWith('D6')) {
        const shorter = Number(vA) < Number(vB) ? 'A' : 'B';
        return `Bank ${shorter} (${fmtHours(Math.min(Number(vA), Number(vB)))}) auto-escalates sooner on extended lockups`;
      }
      return `Affects auto-escalation timing for extended lockups`;
    },
  },
];

// ── Component ───────────────────────────────────────────────

interface CadenzaConfigComparisonProps {
  bankIdA: string;
  bankIdB: string;
  bankNameA: string;
  bankNameB: string;
  resultA: ScenarioResult;
  resultB: ScenarioResult;
}

interface CadenzaConfigPair {
  configA: BankAgentConfig | null;
  configB: BankAgentConfig | null;
  defaults: NetworkDefaults | null;
}

export function CadenzaConfigComparison({
  bankIdA, bankIdB, bankNameA, bankNameB, resultA, resultB,
}: CadenzaConfigComparisonProps) {
  const [data, setData] = useState<CadenzaConfigPair>({ configA: null, configB: null, defaults: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      callServer<{ config: BankAgentConfig }>('/agent-config', { action: 'get', bank_id: bankIdA }),
      callServer<{ config: BankAgentConfig }>('/agent-config', { action: 'get', bank_id: bankIdB }),
      callServer<{ network_defaults: NetworkDefaults }>('/agent-config', { action: 'get_defaults' }),
    ]).then(([rA, rB, rD]) => {
      if (!cancelled) {
        setData({
          configA: rA?.config || null,
          configB: rB?.config || null,
          defaults: rD?.network_defaults || null,
        });
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [bankIdA, bankIdB]);

  if (loading) {
    return (
      <div className="dashboard-card-subtle p-3 flex items-center gap-2 text-xs text-coda-text-muted">
        <Loader2 size={12} className="animate-spin" /> Loading Cadenza configuration...
      </div>
    );
  }

  const { configA, configB, defaults } = data;
  if (!configA || !configB) return null;

  const scenarioId = resultA.scenario_id || '';
  const hasDivergent = resultA.overall_result !== resultB.overall_result;

  // Build row data
  const rows = CADENZA_FIELDS.map(field => {
    const vA = (configA as any)[field.key];
    const vB = (configB as any)[field.key];
    const defVal = defaults ? (defaults as any)[field.key] : undefined;
    const isDiff = String(vA) !== String(vB);
    const isDefaultA = defVal !== undefined && String(vA) === String(defVal);
    const isDefaultB = defVal !== undefined && String(vB) === String(defVal);
    const impact = isDiff ? field.impactFn(vA, vB, scenarioId) : null;

    return {
      ...field,
      vA, vB,
      displayA: field.format(vA),
      displayB: field.format(vB),
      isDiff,
      isDefaultA,
      isDefaultB,
      impact,
    };
  });

  const diffCount = rows.filter(r => r.isDiff).length;

  return (
    <div className="dashboard-card-subtle p-3 space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-mono uppercase text-coda-text-muted tracking-wider flex items-center gap-1.5">
          <Eye size={10} className="text-coda-brand" />
          Cadenza Configuration Comparison
        </p>
        {diffCount > 0 ? (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-coda-brand/10 text-coda-brand border border-coda-brand/20">
            {diffCount} difference{diffCount !== 1 ? 's' : ''}
          </span>
        ) : (
          <span className="text-[10px] font-mono text-coda-text-muted">
            identical configs
          </span>
        )}
      </div>

      {/* Table */}
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/10">
            <th className="text-left py-1.5 px-2 text-coda-text-muted font-medium">Parameter</th>
            <th className="text-center py-1.5 px-2 text-coda-text-muted font-medium truncate max-w-[120px]">
              {bankNameA}
              {resultA.overall_result && (
                <span className="ml-1 inline-flex">
                  {resultA.overall_result === 'PASS'
                    ? <CheckCircle2 size={10} className="text-emerald-400 inline" />
                    : <XCircle size={10} className="text-red-400 inline" />}
                </span>
              )}
            </th>
            <th className="text-center py-1.5 px-2 text-coda-text-muted font-medium truncate max-w-[120px]">
              {bankNameB}
              {resultB.overall_result && (
                <span className="ml-1 inline-flex">
                  {resultB.overall_result === 'PASS'
                    ? <CheckCircle2 size={10} className="text-emerald-400 inline" />
                    : <XCircle size={10} className="text-red-400 inline" />}
                </span>
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <React.Fragment key={row.key}>
              <tr className={`border-t ${row.isDiff ? 'border-coda-brand/20 bg-coda-brand/[0.03]' : 'border-white/10'}`}>
                <td className="py-1.5 px-2 text-coda-text">
                  {row.label}
                </td>
                <td className={`py-1.5 px-2 text-center font-mono ${row.isDiff ? 'text-coda-text' : 'text-coda-text-muted'}`}>
                  {row.displayA}
                  {row.isDefaultA && <span className="text-[9px] text-coda-text-muted ml-1">(default)</span>}
                </td>
                <td className={`py-1.5 px-2 text-center font-mono ${row.isDiff ? 'text-coda-text' : 'text-coda-text-muted'}`}>
                  {row.displayB}
                  {row.isDefaultB && <span className="text-[9px] text-coda-text-muted ml-1">(default)</span>}
                </td>
              </tr>
              {/* Impact annotation row */}
              {row.isDiff && row.impact && hasDivergent && (
                <tr className="border-0">
                  <td colSpan={3} className="px-2 pb-1.5 pt-0">
                    <div className="flex items-start gap-1.5 pl-2">
                      <ArrowRight size={9} className="text-coda-brand/60 mt-0.5 flex-shrink-0" />
                      <span className="text-[10px] text-coda-brand/80 leading-relaxed italic">
                        {row.impact}
                      </span>
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>

      {/* Summary when results diverge */}
      {hasDivergent && diffCount > 0 && (
        <div className="p-2.5 rounded-lg bg-coda-brand/5 border border-coda-brand/15">
          <p className="text-[10px] text-coda-brand/90 leading-relaxed">
            <span className="font-semibold">Config impact:</span>{' '}
            {diffCount} Cadenza parameter{diffCount !== 1 ? 's differ' : ' differs'} between banks,
            which may explain the divergent {resultA.overall_result === 'PASS' ? (
              <><span className="text-emerald-400">PASS</span> / <span className="text-red-400">FAIL</span></>
            ) : (
              <><span className="text-red-400">FAIL</span> / <span className="text-emerald-400">PASS</span></>
            )} outcome on this dispute scenario.
          </p>
        </div>
      )}

      {/* Summary when results are identical despite config diffs */}
      {!hasDivergent && diffCount > 0 && (
        <div className="p-2.5 rounded-lg bg-white/3 border border-white/10">
          <p className="text-[10px] text-coda-text-muted leading-relaxed">
            Despite {diffCount} config difference{diffCount !== 1 ? 's' : ''}, both banks produced the same
            {' '}<span className="font-mono">{resultA.overall_result}</span> result on this scenario.
          </p>
        </div>
      )}
    </div>
  );
}