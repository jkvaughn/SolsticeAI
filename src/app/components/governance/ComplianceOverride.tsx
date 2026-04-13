import { useState } from 'react';
import { Shield, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { callServer } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';

// ============================================================
// ComplianceOverride — 3-layer score breakdown + override form
// (Task 163 — Hybrid Scoring UI)
// ============================================================

interface ComplianceOverrideProps {
  transactionId: string;
  riskScore: any;
  onOverrideApplied?: () => void;
}

export function ComplianceOverride({ transactionId, riskScore, onOverrideApplied }: ComplianceOverrideProps) {
  const { user } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState('');
  const [newScore, setNewScore] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  if (!riskScore) return null;

  const floorScore = riskScore.floor_score ?? 0;
  const fermataScore = riskScore.composite_score ?? 0;
  const overrideScore = riskScore.override_score;
  const finalScore = overrideScore ?? fermataScore;

  const handleSubmit = async () => {
    const parsed = Number(newScore);
    if (isNaN(parsed) || parsed < 0 || parsed > 100) {
      setError('Score must be 0-100');
      return;
    }
    if (!reason.trim()) {
      setError('Reason is required');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await callServer(`/risk-scores/${transactionId}/override`, {
        override_score: parsed,
        override_reason: reason.trim(),
        override_by: user?.email ?? 'unknown',
      });
      setSuccess(true);
      setShowForm(false);
      onOverrideApplied?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3 pt-3 border-t border-black/[0.06] dark:border-white/[0.06]">
      {/* 3-layer breakdown */}
      <div>
        <p className="text-[10px] font-mono uppercase text-coda-text-muted tracking-wider mb-2">Score Layers</p>
        <div className="flex items-center gap-2">
          {/* Floor */}
          <div className="flex-1 rounded-lg bg-black/[0.03] dark:bg-white/[0.03] p-2 text-center">
            <p className="text-[9px] font-mono text-coda-text-muted uppercase">Floor</p>
            <p className="text-lg font-bold font-mono text-coda-text">{floorScore}</p>
            <div className="w-full h-1 mt-1 rounded-full bg-black/[0.06] dark:bg-white/[0.06] overflow-hidden">
              <div className="h-full rounded-full bg-amber-500/60" style={{ width: `${floorScore}%` }} />
            </div>
          </div>
          <span className="text-coda-text-muted text-[10px]">+</span>
          {/* Fermata */}
          <div className="flex-1 rounded-lg bg-black/[0.03] dark:bg-white/[0.03] p-2 text-center">
            <p className="text-[9px] font-mono text-coda-text-muted uppercase">Fermata</p>
            <p className="text-lg font-bold font-mono text-coda-text">{fermataScore}</p>
            <div className="w-full h-1 mt-1 rounded-full bg-black/[0.06] dark:bg-white/[0.06] overflow-hidden">
              <div className="h-full rounded-full bg-blue-500/60" style={{ width: `${fermataScore}%` }} />
            </div>
          </div>
          <span className="text-coda-text-muted text-[10px]">=</span>
          {/* Final / Override */}
          <div className={`flex-1 rounded-lg p-2 text-center ${overrideScore != null ? 'bg-purple-500/10 border border-purple-500/20' : 'bg-black/[0.03] dark:bg-white/[0.03]'}`}>
            <p className="text-[9px] font-mono text-coda-text-muted uppercase">
              {overrideScore != null ? 'Override' : 'Final'}
            </p>
            <p className="text-lg font-bold font-mono text-coda-text">{finalScore}</p>
            <div className="w-full h-1 mt-1 rounded-full bg-black/[0.06] dark:bg-white/[0.06] overflow-hidden">
              <div
                className={`h-full rounded-full ${finalScore >= 70 ? 'bg-emerald-500' : finalScore >= 40 ? 'bg-amber-500' : 'bg-red-500'}`}
                style={{ width: `${finalScore}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Existing override info */}
      {riskScore.override_score != null && (
        <div className="flex items-center gap-2 text-[11px] text-purple-600 dark:text-purple-400 bg-purple-500/10 px-3 py-1.5 rounded-lg">
          <Shield size={12} />
          Override applied by {riskScore.override_by ?? 'unknown'}: {riskScore.override_reason ?? 'No reason provided'}
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 text-[11px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-lg">
          <CheckCircle2 size={12} />
          Override applied successfully
        </div>
      )}

      {/* Override button + form */}
      {!showForm && !success && (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20 transition-colors"
        >
          <Shield size={12} />
          Apply Compliance Override
        </button>
      )}

      {showForm && (
        <div className="space-y-2 p-3 rounded-lg border border-purple-500/20 bg-purple-500/5">
          <div className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
            <AlertTriangle size={12} />
            Override requires dual approval if it changes finality recommendation
          </div>
          <div className="grid grid-cols-[80px_1fr] gap-2 items-center">
            <label className="text-[11px] text-coda-text-muted">New Score</label>
            <input
              type="number"
              min={0}
              max={100}
              value={newScore}
              onChange={e => setNewScore(e.target.value)}
              placeholder="0-100"
              className="px-2 py-1 rounded-lg text-xs bg-black/[0.03] dark:bg-white/[0.03] border border-coda-border text-coda-text font-mono w-24"
            />
            <label className="text-[11px] text-coda-text-muted">Reason</label>
            <input
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Justification for override..."
              className="px-2 py-1 rounded-lg text-xs bg-black/[0.03] dark:bg-white/[0.03] border border-coda-border text-coda-text flex-1"
            />
          </div>
          {error && <p className="text-[10px] text-red-500">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium bg-purple-600 text-white hover:bg-purple-700 transition-colors disabled:opacity-40"
            >
              {submitting ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
              Submit Override
            </button>
            <button
              onClick={() => { setShowForm(false); setError(''); }}
              className="px-3 py-1 rounded-lg text-xs text-coda-text-muted hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
