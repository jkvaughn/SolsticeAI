// IntegrationActivityLog — per-bank, per-integration chronological log

import { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';

interface ActivityEntry {
  id: string;
  integration: string;
  action: string;
  endpoint: string | null;
  status_code: number | null;
  latency_ms: number | null;
  request_summary: string | null;
  response_summary: string | null;
  created_at: string;
}

const INTEGRATION_OPTIONS = [
  { value: 'all', label: 'All Integrations' },
  { value: 'verify', label: 'Identity Verification' },
  { value: 'compliance_filing', label: 'Compliance Filing' },
  { value: 'custody', label: 'Custody' },
];

function statusColor(code: number | null) {
  if (code === null) return 'text-white/30';
  if (code >= 200 && code < 300) return 'text-emerald-400';
  if (code >= 400 && code < 500) return 'text-amber-400';
  return 'text-red-400';
}

export function IntegrationActivityLog() {
  const [filter, setFilter] = useState('all');
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      let q = supabase
        .from('integration_activity_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (filter !== 'all') {
        q = q.eq('integration', filter);
      }

      const { data, error } = await q;
      if (!cancelled) {
        if (error) {
          console.error('Failed to load integration activity log:', error);
          setEntries([]);
        } else {
          setEntries(data ?? []);
        }
        setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [filter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider">
          Activity Log
        </h3>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/80 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
        >
          {INTEGRATION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-gray-900 text-white">
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm">
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="border-b border-white/10 text-white/50 text-xs uppercase tracking-wider">
              <th className="px-4 py-3 font-medium">Timestamp</th>
              <th className="px-4 py-3 font-medium">Integration</th>
              <th className="px-4 py-3 font-medium">Endpoint</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Latency</th>
              <th className="px-4 py-3 font-medium">Summary</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-white/30">
                  Loading...
                </td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-white/30">
                  No activity recorded yet.
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr key={entry.id} className="text-white/70 hover:bg-white/5 transition-colors">
                  <td className="px-4 py-2.5 text-xs whitespace-nowrap">
                    {new Date(entry.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-xs capitalize">
                    {entry.integration.replace('_', ' ')}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs">{entry.endpoint ?? '-'}</td>
                  <td className={`px-4 py-2.5 font-mono text-xs ${statusColor(entry.status_code)}`}>
                    {entry.status_code ?? '-'}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {entry.latency_ms !== null ? `${entry.latency_ms}ms` : '-'}
                  </td>
                  <td className="px-4 py-2.5 text-xs max-w-[200px] truncate">
                    {entry.request_summary ?? '-'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default IntegrationActivityLog;
