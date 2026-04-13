import { useState } from 'react';
import { Download } from 'lucide-react';
import { fetchTransactions, fetchCadenzaFlags } from '../../dataClient';
import { useBanks } from '../../contexts/BanksContext';

// ============================================================
// Regulatory Export (Task 167)
//
// Export panel: select date range + report type, generate JSON
// blob and trigger download. Shows preview of export data.
// ============================================================

type ReportType = 'transaction_volume' | 'flag_summary' | 'sar_candidates' | 'compliance_checks';

const REPORT_TYPES: { value: ReportType; label: string }[] = [
  { value: 'transaction_volume', label: 'Transaction Volume' },
  { value: 'flag_summary', label: 'Flag Summary' },
  { value: 'sar_candidates', label: 'SAR Candidates' },
  { value: 'compliance_checks', label: 'Compliance Checks' },
];

export function RegulatoryExport({ onClose }: { onClose?: () => void }) {
  const { cacheVersion } = useBanks();
  const [reportType, setReportType] = useState<ReportType>('transaction_volume');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [generating, setGenerating] = useState(false);

  const generate = async () => {
    setGenerating(true);
    try {
      const txs = await fetchTransactions({ limit: 500 }).catch(() => []);
      const flags = await fetchCadenzaFlags().catch(() => []);

      // Filter by date range if provided
      const start = startDate ? new Date(startDate).getTime() : 0;
      const end = endDate ? new Date(endDate).getTime() + 86400000 : Infinity;
      const filteredTxs = txs.filter((t: any) => {
        const ts = new Date(t.created_at).getTime();
        return ts >= start && ts <= end;
      });
      const filteredFlags = flags.filter((f: any) => {
        const ts = new Date(f.created_at || f.detected_at).getTime();
        return ts >= start && ts <= end;
      });

      let data: any;
      switch (reportType) {
        case 'transaction_volume':
          data = {
            report: 'Transaction Volume Report',
            generated: new Date().toISOString(),
            period: { start: startDate || 'all', end: endDate || 'all' },
            summary: {
              total_transactions: filteredTxs.length,
              settled: filteredTxs.filter((t: any) => t.status === 'settled').length,
              total_volume: filteredTxs.reduce((s: number, t: any) => s + (t.amount || 0), 0),
            },
            transactions: filteredTxs.map((t: any) => ({
              id: t.id, amount: t.amount, status: t.status,
              risk_level: t.risk_level, purpose_code: t.purpose_code,
              created_at: t.created_at, settled_at: t.settled_at,
            })),
          };
          break;
        case 'flag_summary':
          data = {
            report: 'Flag Summary Report',
            generated: new Date().toISOString(),
            period: { start: startDate || 'all', end: endDate || 'all' },
            summary: {
              total_flags: filteredFlags.length,
              critical: filteredFlags.filter((f: any) => f.severity === 'critical').length,
              warning: filteredFlags.filter((f: any) => f.severity === 'warning').length,
              info: filteredFlags.filter((f: any) => f.severity === 'info').length,
            },
            flags: filteredFlags,
          };
          break;
        case 'sar_candidates':
          data = {
            report: 'SAR Candidate Report',
            generated: new Date().toISOString(),
            period: { start: startDate || 'all', end: endDate || 'all' },
            candidates: filteredTxs
              .filter((t: any) => (t.risk_score || 0) > 70 || t.risk_level === 'high')
              .map((t: any) => ({
                id: t.id, amount: t.amount, risk_score: t.risk_score,
                risk_level: t.risk_level, purpose_code: t.purpose_code,
                created_at: t.created_at,
              })),
          };
          break;
        case 'compliance_checks':
          data = {
            report: 'Compliance Checks Report',
            generated: new Date().toISOString(),
            period: { start: startDate || 'all', end: endDate || 'all' },
            summary: {
              total_checked: filteredTxs.length,
              passed: filteredTxs.filter((t: any) => t.compliance_passed === true).length,
              failed: filteredTxs.filter((t: any) => t.compliance_passed === false).length,
              pending: filteredTxs.filter((t: any) => t.compliance_passed == null).length,
            },
            transactions: filteredTxs.map((t: any) => ({
              id: t.id, amount: t.amount, compliance_passed: t.compliance_passed,
              compliance_checks: t.compliance_checks, created_at: t.created_at,
            })),
          };
          break;
      }

      setPreview(data);

      // Trigger download
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `coda-${reportType}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[10px] font-mono text-coda-text-muted uppercase tracking-wider mb-1">Report Type</label>
          <select
            value={reportType}
            onChange={(e) => setReportType(e.target.value as ReportType)}
            className="text-[12px] font-mono bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.08] dark:border-white/[0.08] rounded-lg px-3 py-1.5 text-coda-text"
          >
            {REPORT_TYPES.map((rt) => (
              <option key={rt.value} value={rt.value}>{rt.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-mono text-coda-text-muted uppercase tracking-wider mb-1">Start Date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="text-[12px] font-mono bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.08] dark:border-white/[0.08] rounded-lg px-3 py-1.5 text-coda-text"
          />
        </div>
        <div>
          <label className="block text-[10px] font-mono text-coda-text-muted uppercase tracking-wider mb-1">End Date</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="text-[12px] font-mono bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.08] dark:border-white/[0.08] rounded-lg px-3 py-1.5 text-coda-text"
          />
        </div>
        <button
          onClick={generate}
          disabled={generating}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-mono bg-coda-brand/10 text-coda-brand rounded-lg hover:bg-coda-brand/20 transition-colors disabled:opacity-50 cursor-pointer"
        >
          <Download size={13} />
          {generating ? 'Generating...' : 'Generate Report'}
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="text-[11px] font-mono text-coda-text-muted hover:text-coda-text transition-colors cursor-pointer"
          >
            Close
          </button>
        )}
      </div>

      {/* Preview */}
      {preview && (
        <div className="rounded-lg bg-black/[0.02] dark:bg-white/[0.02] p-3 max-h-48 overflow-y-auto">
          <div className="text-[10px] font-mono text-coda-text-muted uppercase tracking-wider mb-1">Preview</div>
          <pre className="text-[11px] font-mono text-coda-text whitespace-pre-wrap">
            {JSON.stringify(preview.summary || preview.candidates?.length || preview, null, 2).slice(0, 500)}
          </pre>
        </div>
      )}
    </div>
  );
}
