import React, { useState, useEffect } from 'react';
import { Loader2, Sliders } from 'lucide-react';
import { callServer } from '../../supabaseClient';
import type { BankAgentConfig, NetworkDefaults } from '../../types';

// ── Config field metadata ───────────────────────────────────

interface FieldMeta {
  label: string;
  agent: string;
  format: (v: unknown) => string;
}

const fmtDollar = (v: unknown) => {
  const n = Number(v);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
};
const fmtPct = (v: unknown) => `${(Number(v) * 100).toFixed(0)}%`;
const fmtWeight = (v: unknown) => Number(v).toFixed(2);
const fmtNum = (v: unknown) => String(v);
const fmtList = (v: unknown) => Array.isArray(v) ? v.join(', ') : String(v);
const fmtBool = (v: unknown) => v ? 'Yes' : 'No';
const fmtSensitivity = (v: unknown) => {
  const s = String(v);
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const fmtSeconds = (v: unknown) => {
  const n = Number(v);
  return n >= 3600 ? `${(n / 3600).toFixed(1)}h` : n >= 60 ? `${Math.round(n / 60)}m` : `${n}s`;
};
const fmtHours = (v: unknown) => `${Number(v)}h`;
const fmtMultiplier = (v: unknown) => `${Number(v).toFixed(1)}x`;
const fmtThreshold = (v: unknown) => `${(Number(v) * 100).toFixed(0)}%`;

const FIELD_META: Record<string, FieldMeta> = {
  auto_accept_ceiling:            { label: 'Auto-Accept Ceiling',       agent: 'Maestro',  format: fmtDollar },
  escalation_first_time_threshold:{ label: 'First-Time Escalation',     agent: 'Maestro',  format: fmtDollar },
  escalation_cross_jurisdiction:  { label: 'Cross-Jurisdiction Limit',  agent: 'Maestro',  format: fmtDollar },
  escalation_velocity_count:      { label: 'Velocity Count Trigger',    agent: 'Maestro',  format: fmtNum },
  jurisdiction_whitelist:         { label: 'Jurisdiction Whitelist',     agent: 'Concord',  format: fmtList },
  approved_purpose_codes:         { label: 'Approved Purpose Codes',    agent: 'Concord',  format: fmtList },
  risk_weight_counterparty:       { label: 'Risk Weight: Counterparty', agent: 'Fermata',  format: fmtWeight },
  risk_weight_jurisdiction:       { label: 'Risk Weight: Jurisdiction',  agent: 'Fermata',  format: fmtWeight },
  risk_weight_asset_type:         { label: 'Risk Weight: Asset Type',   agent: 'Fermata',  format: fmtWeight },
  risk_weight_behavioral:         { label: 'Risk Weight: Behavioral',   agent: 'Fermata',  format: fmtWeight },
  risk_instant_ceiling:           { label: 'Instant Risk Ceiling',      agent: 'Fermata',  format: fmtNum },
  risk_deferred_24h_ceiling:      { label: '24h Deferred Ceiling',      agent: 'Fermata',  format: fmtNum },
  risk_deferred_72h_ceiling:      { label: '72h Deferred Ceiling',      agent: 'Fermata',  format: fmtNum },
  balance_safety_floor_pct:       { label: 'Balance Safety Floor',      agent: 'Treasury', format: fmtPct },
  heartbeat_participation:        { label: 'Heartbeat Participation',   agent: 'Treasury', format: fmtBool },
  // Cadenza (Dispute Resolution)
  cadenza_monitoring_sensitivity:   { label: 'Monitoring Sensitivity',    agent: 'Cadenza',  format: fmtSensitivity },
  cadenza_auto_reverse_enabled:     { label: 'Auto-Reverse Enabled',     agent: 'Cadenza',  format: fmtBool },
  cadenza_escalation_threshold:     { label: 'Escalation Threshold',     agent: 'Cadenza',  format: fmtThreshold },
  cadenza_velocity_spike_multiplier:{ label: 'Velocity Spike Multiplier', agent: 'Cadenza',  format: fmtMultiplier },
  cadenza_duplicate_window_seconds: { label: 'Duplicate Window',         agent: 'Cadenza',  format: fmtSeconds },
  cadenza_max_lockup_hours:         { label: 'Max Lockup Duration',      agent: 'Cadenza',  format: fmtHours },
};

const AGENT_COLORS: Record<string, string> = {
  Maestro:  'text-coda-text-secondary',
  Concord:  'text-coda-text-secondary',
  Fermata:  'text-coda-text-secondary',
  Treasury: 'text-coda-text-secondary',
  Cadenza:  'text-coda-brand',
};

// ── Types ───────────────────────────────────────────────────

export interface ConfigDiff {
  field: string;
  label: string;
  agent: string;
  valueA: string;
  valueB: string;
  isDefault_A: boolean;
  isDefault_B: boolean;
}

interface ConfigDeltaProps {
  bankIdA: string;
  bankIdB: string;
  bankNameA: string;
  bankNameB: string;
  /** When provided, skips internal fetch and uses these diffs */
  diffs?: ConfigDiff[];
  compact?: boolean;
  /** When provided, only show diffs for these agents */
  filterAgents?: string[];
}

// ── Utility: compare two config values ──────────────────────

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

// ── Fetch + diff logic (exported for reuse) ─────────────────

export async function fetchConfigDiffs(bankIdA: string, bankIdB: string): Promise<ConfigDiff[]> {
  try {
    const [respA, respB, defaultsResp] = await Promise.all([
      callServer<{ config: BankAgentConfig }>('/agent-config', { action: 'get', bank_id: bankIdA }),
      callServer<{ config: BankAgentConfig }>('/agent-config', { action: 'get', bank_id: bankIdB }),
      callServer<{ network_defaults: NetworkDefaults }>('/agent-config', { action: 'get_defaults' }),
    ]);

    if (!respA?.config || !respB?.config || !defaultsResp?.network_defaults) return [];

    const cfgA = respA.config;
    const cfgB = respB.config;
    const defaults = defaultsResp.network_defaults;
    const diffs: ConfigDiff[] = [];

    for (const [field, meta] of Object.entries(FIELD_META)) {
      const vA = (cfgA as any)[field];
      const vB = (cfgB as any)[field];
      if (!valuesEqual(vA, vB)) {
        const defVal = (defaults as any)[field];
        diffs.push({
          field,
          label: meta.label,
          agent: meta.agent,
          valueA: meta.format(vA),
          valueB: meta.format(vB),
          isDefault_A: valuesEqual(vA, defVal),
          isDefault_B: valuesEqual(vB, defVal),
        });
      }
    }
    return diffs;
  } catch (err) {
    console.error('[ConfigDelta] Failed to fetch configs:', err);
    return [];
  }
}

// ── Component ───────────────────────────────────────────────

export function ConfigDelta({ bankIdA, bankIdB, bankNameA, bankNameB, diffs: externalDiffs, compact, filterAgents }: ConfigDeltaProps) {
  const [diffs, setDiffs] = useState<ConfigDiff[]>(externalDiffs || []);
  const [loading, setLoading] = useState(!externalDiffs);

  useEffect(() => {
    if (externalDiffs) { setDiffs(externalDiffs); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    fetchConfigDiffs(bankIdA, bankIdB).then(d => {
      if (!cancelled) { setDiffs(d); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [bankIdA, bankIdB, externalDiffs]);

  if (loading) {
    return (
      <div className="dashboard-card-subtle p-3 flex items-center gap-2 text-xs text-coda-text-muted">
        <Loader2 size={12} className="animate-spin" /> Loading configuration delta...
      </div>
    );
  }

  const filteredDiffs = filterAgents
    ? diffs.filter(d => filterAgents.includes(d.agent))
    : diffs;

  if (filteredDiffs.length === 0) {
    return (
      <div className="dashboard-card-subtle p-3 text-xs text-coda-text-muted text-center">
        No configuration differences between {bankNameA} and {bankNameB}
        {filterAgents ? ` for ${filterAgents.join(', ')}` : ''}
      </div>
    );
  }

  return (
    <div className={`dashboard-card-subtle overflow-hidden ${compact ? '' : 'p-3'}`}>
      {!compact && (
        <p className="text-[10px] font-mono uppercase text-coda-text-muted tracking-wider mb-2 flex items-center gap-1.5">
          <Sliders size={10} />
          Configuration Delta ({filteredDiffs.length} difference{filteredDiffs.length !== 1 ? 's' : ''})
          {filterAgents && <span className="text-coda-brand/60 ml-1">({filterAgents.join(', ')})</span>}
        </p>
      )}
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/10">
            <th className="text-left py-1 px-2 text-coda-text-muted font-medium">Parameter</th>
            <th className="text-left py-1 px-2 text-coda-text-muted font-medium">Agent</th>
            <th className="text-center py-1 px-2 text-coda-text-muted font-medium truncate">{bankNameA}</th>
            <th className="text-center py-1 px-2 text-coda-text-muted font-medium truncate">{bankNameB}</th>
          </tr>
        </thead>
        <tbody>
          {filteredDiffs.map(d => (
            <tr key={d.field} className="border-t border-white/10">
              <td className="py-1 px-2 text-coda-text">{d.label}</td>
              <td className={`py-1 px-2 font-mono ${AGENT_COLORS[d.agent] || 'text-coda-text-muted'}`}>{d.agent}</td>
              <td className="py-1 px-2 text-center font-mono text-coda-text-muted">
                {d.valueA}
                {d.isDefault_A && <span className="text-[9px] text-coda-text-muted ml-1">(default)</span>}
              </td>
              <td className="py-1 px-2 text-center font-mono text-coda-text-muted">
                {d.valueB}
                {d.isDefault_B && <span className="text-[9px] text-coda-text-muted ml-1">(default)</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}