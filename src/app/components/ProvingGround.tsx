import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Shield, Play, Loader2, RotateCcw, ChevronDown, ChevronRight,
  BarChart3, Zap, FlaskConical, AlertCircle, GitCompareArrows, Building2,
  Trash2, Clock, Scale
} from 'lucide-react';
import { motion, AnimatePresence } from './motion-shim';
import { Link, Navigate } from 'react-router';
import { useIsAdmin } from '../hooks/useIsAdmin';
import { PageHeader } from './PageHeader';
import { PageTransition } from './PageTransition';
import { useBanks } from '../contexts/BanksContext';
import { callServer } from '../supabaseClient';
import { useSWRCache, writeSWRCache, readSWRCache, evictSWRCache } from '../hooks/useSWRCache';
import {
  ScenarioCard,
  type ProvingGroundScenario,
  type ScenarioResult,
  type ProvingGroundSummary,
} from './proving-ground/ScenarioCard';
import { ScenarioScorecard } from './proving-ground/ScenarioScorecard';
import { ProvingGroundSummaryView } from './proving-ground/ProvingGroundSummary';
import { ComparisonScorecard } from './proving-ground/ComparisonScorecard';
import { ComparisonSummaryView } from './proving-ground/ComparisonSummary';

// ── Category config ─────────────────────────────────────────

interface CategoryGroup {
  key: string;
  label: string;
  icon: React.ElementType;
}

const CATEGORIES: CategoryGroup[] = [
  { key: 'compliance',  label: 'Compliance Gauntlet',  icon: Shield },
  { key: 'risk',        label: 'Risk Provocation',     icon: BarChart3 },
  { key: 'operational', label: 'Operational Stress',   icon: Zap },
  { key: 'dispute',     label: 'Dispute Resolution',   icon: Scale },
];

// ── SWR cache key helpers ───────────────────────────────────

const PG_RESULTS_KEY = (bankId: string, suffix = '') => `pg-results-${bankId}${suffix}`;
const PG_SUMMARY_KEY = (bankId: string, suffix = '') => `pg-summary-${bankId}${suffix}`;

/** Serialize a Map<string, ScenarioResult> to the SWR cache */
function cacheResults(bankId: string, results: Map<string, ScenarioResult>, suffix = '') {
  writeSWRCache(PG_RESULTS_KEY(bankId, suffix), Array.from(results.entries()));
}

/** Read a cached results Map from the SWR cache */
function readCachedResults(bankId: string, suffix = ''): Map<string, ScenarioResult> {
  const arr = readSWRCache<[string, ScenarioResult][]>(PG_RESULTS_KEY(bankId, suffix));
  return arr ? new Map(arr) : new Map();
}

/** Serialize a summary to the SWR cache */
function cacheSummary(bankId: string, summary: ProvingGroundSummary | null, suffix = '') {
  if (summary) {
    writeSWRCache(PG_SUMMARY_KEY(bankId, suffix), summary);
  } else {
    evictSWRCache(PG_SUMMARY_KEY(bankId, suffix));
  }
}

/** Read a cached summary from the SWR cache */
function readCachedSummary(bankId: string, suffix = ''): ProvingGroundSummary | null {
  return readSWRCache<ProvingGroundSummary>(PG_SUMMARY_KEY(bankId, suffix));
}

/** Evict all PG caches for a bank */
function evictBankCaches(bankId: string) {
  ['', '-cmpA', '-cmpB'].forEach(suffix => {
    evictSWRCache(PG_RESULTS_KEY(bankId, suffix));
    evictSWRCache(PG_SUMMARY_KEY(bankId, suffix));
  });
}

// ── ETA helper ──────────────────────────────────────────────

function formatEta(ms: number): string {
  if (ms <= 0) return '';
  const sec = Math.ceil(ms / 1000);
  if (sec < 60) return `~${sec}s remaining`;
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return `~${min}m ${s}s remaining`;
}

// ── Main Component ──────────────────────────────────────────

export function ProvingGround() {
  const isAdmin = useIsAdmin();
  const { banks } = useBanks();
  const activeBanks = (banks || []).filter((b) => b.status === 'active');

  // ── Mode ──────────────────────────────────────────────────
  const [compareMode, setCompareMode] = useState(false);

  // ── Bank selection ────────────────────────────────────────
  const [selectedBankId, setSelectedBankId] = useState<string>('');
  const [bankIdA, setBankIdA] = useState<string>('');
  const [bankIdB, setBankIdB] = useState<string>('');

  // ── Scenarios (SWR-cached) ────────────────────────────────
  const {
    data: scenariosData,
    error: scenariosError,
  } = useSWRCache<ProvingGroundScenario[]>({
    key: 'pg-scenarios',
    fetcher: async () => {
      const resp = await callServer<{ scenarios: ProvingGroundScenario[] }>('/proving-ground', { action: 'list_scenarios' }, 5);
      return resp?.scenarios ?? [];
    },
    ttl: 30 * 60 * 1000, // 30 min — scenarios rarely change
  });
  const scenarios = scenariosData ?? [];
  const loadError = scenariosError ? (scenariosError.message || 'Failed to load scenarios') : null;

  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  // ── Single-bank results ───────────────────────────────────
  const [results, setResults] = useState<Map<string, ScenarioResult>>(new Map());
  const [allSummary, setAllSummary] = useState<ProvingGroundSummary | null>(null);

  // ── Compare-mode results ─────────────────────────────────
  const [resultsA, setResultsA] = useState<Map<string, ScenarioResult>>(new Map());
  const [resultsB, setResultsB] = useState<Map<string, ScenarioResult>>(new Map());
  const [summaryA, setSummaryA] = useState<ProvingGroundSummary | null>(null);
  const [summaryB, setSummaryB] = useState<ProvingGroundSummary | null>(null);

  // ── Execution state ───────────────────────────────────────
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [currentRunningId, setCurrentRunningId] = useState<string | null>(null);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [runAllProgress, setRunAllProgress] = useState<{ current: number; total: number; phase?: string } | null>(null);
  const [cleanupStatus, setCleanupStatus] = useState<string | null>(null);
  const abortRef = useRef(false);

  // ── ETA tracking ──────────────────────────────────────────
  const completedDurations = useRef<number[]>([]);
  const runAllStartTime = useRef<number>(0);

  // ── Auto-select banks ─────────────────────────────────────
  useEffect(() => {
    if (!selectedBankId && activeBanks.length > 0) setSelectedBankId(activeBanks[0].id);
    if (!bankIdA && activeBanks.length > 0) setBankIdA(activeBanks[0].id);
    if (!bankIdB && activeBanks.length > 1) setBankIdB(activeBanks[1].id);
    else if (!bankIdB && activeBanks.length === 1 && bankIdA) setBankIdB(activeBanks[0].id);
  }, [activeBanks, selectedBankId, bankIdA, bankIdB]);

  // ── Restore results from SWR cache on bank/mode change ────
  useEffect(() => {
    if (!compareMode && selectedBankId) {
      const cached = readCachedResults(selectedBankId);
      if (cached.size > 0) setResults(cached);
      const cachedSummary = readCachedSummary(selectedBankId);
      if (cachedSummary) setAllSummary(cachedSummary);
    }
  }, [selectedBankId, compareMode]);

  useEffect(() => {
    if (compareMode && bankIdA && bankIdB) {
      const cachedA = readCachedResults(bankIdA, '-cmpA');
      const cachedB = readCachedResults(bankIdB, '-cmpB');
      if (cachedA.size > 0) setResultsA(cachedA);
      if (cachedB.size > 0) setResultsB(cachedB);
      const cachedSumA = readCachedSummary(bankIdA, '-cmpA');
      const cachedSumB = readCachedSummary(bankIdB, '-cmpB');
      if (cachedSumA) setSummaryA(cachedSumA);
      if (cachedSumB) setSummaryB(cachedSumB);
    }
  }, [bankIdA, bankIdB, compareMode]);

  // ── Persist results to SWR cache ──────────────────────────
  useEffect(() => {
    if (!compareMode && selectedBankId && results.size > 0) {
      cacheResults(selectedBankId, results);
    }
  }, [results, selectedBankId, compareMode]);

  useEffect(() => {
    if (!compareMode && selectedBankId && allSummary) {
      cacheSummary(selectedBankId, allSummary);
    }
  }, [allSummary, selectedBankId, compareMode]);

  useEffect(() => {
    if (compareMode && bankIdA && resultsA.size > 0) cacheResults(bankIdA, resultsA, '-cmpA');
  }, [resultsA, bankIdA, compareMode]);

  useEffect(() => {
    if (compareMode && bankIdB && resultsB.size > 0) cacheResults(bankIdB, resultsB, '-cmpB');
  }, [resultsB, bankIdB, compareMode]);

  useEffect(() => {
    if (compareMode && bankIdA && summaryA) cacheSummary(bankIdA, summaryA, '-cmpA');
  }, [summaryA, bankIdA, compareMode]);

  useEffect(() => {
    if (compareMode && bankIdB && summaryB) cacheSummary(bankIdB, summaryB, '-cmpB');
  }, [summaryB, bankIdB, compareMode]);

  // ── Bank name helpers ─────────────────────────────────────
  const getBankName = useCallback((id: string) => {
    const b = activeBanks.find(b => b.id === id);
    return b ? b.name : 'Unknown';
  }, [activeBanks]);

  const bankNameA = getBankName(bankIdA);
  const bankNameB = getBankName(bankIdB);

  // ── Toggle category collapse ──────────────────────────────
  const toggleCategory = useCallback((key: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // ── Reset ─────────────────────────────────────────────────
  const resetResults = useCallback(() => {
    abortRef.current = true;
    setResults(new Map());
    setResultsA(new Map());
    setResultsB(new Map());
    setAllSummary(null);
    setSummaryA(null);
    setSummaryB(null);
    setSelectedScenarioId(null);
    setIsRunningAll(false);
    setCurrentRunningId(null);
    setRunAllProgress(null);
    completedDurations.current = [];
    // Evict SWR caches
    if (selectedBankId) evictBankCaches(selectedBankId);
    if (bankIdA) evictBankCaches(bankIdA);
    if (bankIdB) evictBankCaches(bankIdB);
  }, [selectedBankId, bankIdA, bankIdB]);

  // ── Mode toggle ───────────────────────────────────────────
  const handleModeToggle = useCallback((mode: boolean) => {
    setCompareMode(mode);
    // Don't call full reset — just clear running state. Let SWR cache restore happen.
    abortRef.current = true;
    setIsRunningAll(false);
    setCurrentRunningId(null);
    setRunAllProgress(null);
    setSelectedScenarioId(null);
    completedDurations.current = [];
    // Clear results for mode switch (will reload from session if available)
    setResults(new Map());
    setResultsA(new Map());
    setResultsB(new Map());
    setAllSummary(null);
    setSummaryA(null);
    setSummaryB(null);
  }, []);

  // ── Cleanup ───────────────────────────────────────────────
  const runCleanup = useCallback(async () => {
    setCleanupStatus('cleaning');
    try {
      const resp = await callServer<{ cleaned: boolean; counts: Record<string, number>; total: number }>('/proving-ground', { action: 'cleanup' }, 5);
      if (resp?.cleaned) {
        setCleanupStatus(`Cleaned ${resp.total} rows`);
        setTimeout(() => setCleanupStatus(null), 3000);
      } else {
        setCleanupStatus('Cleanup failed');
        setTimeout(() => setCleanupStatus(null), 3000);
      }
    } catch (err) {
      console.error('[ProvingGround] Cleanup failed:', err);
      setCleanupStatus('Cleanup error');
      setTimeout(() => setCleanupStatus(null), 3000);
    }
  }, []);

  // ── Effective bank IDs for current mode ───────────────────
  const canRun = compareMode ? (bankIdA && bankIdB && bankIdA !== bankIdB) : !!selectedBankId;

  // ── ETA calculation ───────────────────────────────────────
  const getEta = useCallback(() => {
    if (!runAllProgress || completedDurations.current.length === 0) return '';
    const avgMs = completedDurations.current.reduce((s, d) => s + d, 0) / completedDurations.current.length;
    const remaining = runAllProgress.total - runAllProgress.current;
    // In compare mode during phase B, we only need remaining from current phase
    const etaMs = remaining * avgMs;
    return formatEta(etaMs);
  }, [runAllProgress]);

  // ── Run single scenario ───────────────────────────────────
  const runScenario = useCallback(async (scenarioId: string) => {
    if (!canRun || currentRunningId) return;
    setCurrentRunningId(scenarioId);
    setSelectedScenarioId(scenarioId);
    setAllSummary(null);
    setSummaryA(null);
    setSummaryB(null);

    try {
      if (compareMode) {
        const resA = await callServer<ScenarioResult>('/proving-ground', {
          action: 'run_scenario', scenario_id: scenarioId, bank_id: bankIdA,
        }, 5);
        if (resA?.scenario_id) setResultsA(prev => new Map(prev).set(scenarioId, resA));

        const resB = await callServer<ScenarioResult>('/proving-ground', {
          action: 'run_scenario', scenario_id: scenarioId, bank_id: bankIdB,
        }, 5);
        if (resB?.scenario_id) setResultsB(prev => new Map(prev).set(scenarioId, resB));
      } else {
        const result = await callServer<ScenarioResult>('/proving-ground', {
          action: 'run_scenario', scenario_id: scenarioId, bank_id: selectedBankId,
        }, 5);
        if (result?.scenario_id) setResults(prev => new Map(prev).set(scenarioId, result));
      }
    } catch (err) {
      console.error(`[ProvingGround] Scenario ${scenarioId} failed:`, err);
    } finally {
      setCurrentRunningId(null);
    }
  }, [canRun, currentRunningId, compareMode, bankIdA, bankIdB, selectedBankId]);

  // ── Run all scenarios ─────────────────────────────────────
  const runAll = useCallback(async () => {
    if (!canRun || isRunningAll) return;
    // resetResults() sets isRunningAll=false and abortRef=true internally,
    // so we must call it FIRST, then override both after.
    resetResults();
    setIsRunningAll(true);
    abortRef.current = false;
    completedDurations.current = [];
    runAllStartTime.current = Date.now();

    // Helper: compute summary from collected results
    const buildSummary = (collected: ScenarioResult[]): ProvingGroundSummary => {
      const summary: ProvingGroundSummary = {
        total: collected.length,
        passed: collected.filter(r => r.overall_result === 'PASS').length,
        failed: collected.filter(r => r.overall_result !== 'PASS').length,
        duration_ms: collected.reduce((sum, r) => sum + r.duration_ms, 0),
        by_category: {},
      };
      for (const r of collected) {
        if (!summary.by_category[r.category]) {
          summary.by_category[r.category] = { passed: 0, failed: 0 };
        }
        summary.by_category[r.category][r.overall_result === 'PASS' ? 'passed' : 'failed']++;
      }
      return summary;
    };

    try {
      if (compareMode) {
        // Phase 1: Bank A — run each scenario individually for real-time feedback
        const collectedA: ScenarioResult[] = [];
        setRunAllProgress({ current: 0, total: scenarios.length, phase: bankNameA });
        for (let i = 0; i < scenarios.length; i++) {
          if (abortRef.current) break;
          const scenario = scenarios[i];
          setCurrentRunningId(scenario.id);
          setRunAllProgress({ current: i, total: scenarios.length, phase: bankNameA });
          try {
            const r = await callServer<ScenarioResult>('/proving-ground', {
              action: 'run_scenario', scenario_id: scenario.id, bank_id: bankIdA,
            }, 5);
            if (r?.scenario_id) {
              collectedA.push(r);
              setResultsA(prev => new Map(prev).set(scenario.id, r));
              completedDurations.current.push(r.duration_ms);
            }
          } catch (err) {
            console.error(`[ProvingGround] Scenario ${scenario.id} (A) failed:`, err);
          }
          setRunAllProgress({ current: i + 1, total: scenarios.length, phase: bankNameA });
        }
        if (collectedA.length > 0) setSummaryA(buildSummary(collectedA));

        if (abortRef.current) return;
        completedDurations.current = []; // Reset for phase B

        // Phase 2: Bank B
        const collectedB: ScenarioResult[] = [];
        setRunAllProgress({ current: 0, total: scenarios.length, phase: bankNameB });
        for (let i = 0; i < scenarios.length; i++) {
          if (abortRef.current) break;
          const scenario = scenarios[i];
          setCurrentRunningId(scenario.id);
          setRunAllProgress({ current: i, total: scenarios.length, phase: bankNameB });
          try {
            const r = await callServer<ScenarioResult>('/proving-ground', {
              action: 'run_scenario', scenario_id: scenario.id, bank_id: bankIdB,
            }, 5);
            if (r?.scenario_id) {
              collectedB.push(r);
              setResultsB(prev => new Map(prev).set(scenario.id, r));
              completedDurations.current.push(r.duration_ms);
            }
          } catch (err) {
            console.error(`[ProvingGround] Scenario ${scenario.id} (B) failed:`, err);
          }
          setRunAllProgress({ current: i + 1, total: scenarios.length, phase: bankNameB });
        }
        if (collectedB.length > 0) setSummaryB(buildSummary(collectedB));

        setCurrentRunningId(null);
        setRunAllProgress(null);
      } else {
        // Single-bank mode — run each scenario individually for real-time feedback
        const collected: ScenarioResult[] = [];
        setRunAllProgress({ current: 0, total: scenarios.length });
        for (let i = 0; i < scenarios.length; i++) {
          if (abortRef.current) break;
          const scenario = scenarios[i];
          setCurrentRunningId(scenario.id);
          setRunAllProgress({ current: i, total: scenarios.length });
          try {
            const r = await callServer<ScenarioResult>('/proving-ground', {
              action: 'run_scenario', scenario_id: scenario.id, bank_id: selectedBankId,
            }, 5);
            if (r?.scenario_id) {
              collected.push(r);
              setResults(prev => new Map(prev).set(scenario.id, r));
              completedDurations.current.push(r.duration_ms);
            }
          } catch (err) {
            console.error(`[ProvingGround] Scenario ${scenario.id} failed:`, err);
          }
          setRunAllProgress({ current: i + 1, total: scenarios.length });
        }
        setCurrentRunningId(null);
        setRunAllProgress(null);
        if (collected.length > 0) setAllSummary(buildSummary(collected));
      }
    } catch (err) {
      console.error('[ProvingGround] Run All failed:', err);
    } finally {
      setIsRunningAll(false);
      setCurrentRunningId(null);
      setRunAllProgress(null);
    }
  }, [canRun, isRunningAll, compareMode, bankIdA, bankIdB, selectedBankId, bankNameA, bankNameB, scenarios, resetResults]);

  // ── Grouped scenarios ─────────────────────────────────────
  const grouped = CATEGORIES.map(cat => ({
    ...cat,
    scenarios: scenarios.filter(s => s.category === cat.key),
  }));

  // ── Determine right-panel state ───────────────────────────
  const activeResults = compareMode ? resultsA : results;
  const activeResultsB = compareMode ? resultsB : new Map<string, ScenarioResult>();
  const selectedResultA = selectedScenarioId ? activeResults.get(selectedScenarioId) : null;
  const selectedResultB = selectedScenarioId ? activeResultsB.get(selectedScenarioId) : null;

  const showCompareSummary = compareMode && summaryA && summaryB && !selectedScenarioId;
  const showSingleSummary = !compareMode && allSummary && !selectedScenarioId;
  const showCompareScorecard = compareMode && selectedResultA && selectedResultB && !isRunningAll;
  const showSingleScorecard = !compareMode && selectedResultA && !isRunningAll;
  const showRunAllProgress = isRunningAll && runAllProgress;
  const showIdle = !showCompareSummary && !showSingleSummary && !showCompareScorecard && !showSingleScorecard && !showRunAllProgress && !currentRunningId;

  if (!isAdmin) return <Navigate to="/" replace />;

  // ── No active banks state ─────────────────────────────────
  if (activeBanks.length === 0 && !loadError) {
    return (
      <div className="space-y-4">
        <PageHeader icon={FlaskConical} title="Solstice Proving Ground" subtitle="Adversarial scenario testing for agent pipeline resilience" />
        <PageTransition>
          <div className="dashboard-card p-12 flex flex-col items-center justify-center text-center" style={{ minHeight: '400px' }}>
            <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
              <AlertCircle size={28} className="text-coda-text-muted" />
            </div>
            <p className="text-sm font-medium text-coda-text mb-1">No Active Banks</p>
            <p className="text-xs text-coda-text-muted mb-4">
              Onboard at least one bank before running adversarial tests.
            </p>
            <Link
              to="/setup"
              className="px-4 py-2 rounded-lg bg-black/[0.06] dark:bg-white/[0.08] text-coda-text text-xs font-medium hover:bg-black/[0.10] dark:hover:bg-white/[0.12] transition-colors"
            >
              Go to Setup
            </Link>
          </div>
        </PageTransition>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <PageHeader icon={FlaskConical} title="Solstice Proving Ground" subtitle="Adversarial scenario testing for agent pipeline resilience" />

      {/* Toolbar — mode toggle, bank selector, actions */}
      <div className="dashboard-card-subtle p-2 flex items-center gap-2 overflow-x-auto">
        {/* Mode toggle */}
        <div className="flex items-center bg-white/5 rounded-lg border border-white/10 p-0.5">
          <button
            onClick={() => handleModeToggle(false)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium cursor-pointer transition-colors ${
              !compareMode
                ? 'bg-black/[0.08] dark:bg-white/[0.10] text-coda-text'
                : 'text-coda-text-muted hover:text-coda-text'
            }`}
          >
            <Building2 size={11} className="inline mr-1 -mt-0.5" />
            <span>Single Bank</span>
          </button>
          <button
            onClick={() => handleModeToggle(true)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium cursor-pointer transition-colors ${
              compareMode
                ? 'bg-black/[0.08] dark:bg-white/[0.10] text-coda-text'
                : 'text-coda-text-muted hover:text-coda-text'
            }`}
          >
            <GitCompareArrows size={11} className="inline mr-1 -mt-0.5" />
            <span>Compare Banks</span>
          </button>
        </div>

        {/* Separator */}
        <div className="w-px h-5 bg-coda-border-subtle" />

        {/* Bank selector(s) */}
        {compareMode ? (
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <div className="flex items-center gap-1 min-w-0 flex-1">
              <span className="text-[9px] font-mono text-coda-text-muted flex-shrink-0">A</span>
              <select
                value={bankIdA}
                onChange={(e) => { setBankIdA(e.target.value); resetResults(); }}
                disabled={isRunningAll}
                className="h-7 px-2 rounded-lg bg-white/5 border border-white/10 text-[11px] text-coda-text font-mono focus:outline-none focus:border-white/30 disabled:opacity-50 min-w-0 w-full"
              >
                {activeBanks.map(b => (
                  <option key={b.id} value={b.id} className="bg-coda-surface text-coda-text">
                    {b.name} ({b.short_code})
                  </option>
                ))}
              </select>
            </div>
            <span className="text-[10px] text-coda-text-muted flex-shrink-0">vs</span>
            <div className="flex items-center gap-1 min-w-0 flex-1">
              <span className="text-[9px] font-mono text-coda-text-muted flex-shrink-0">B</span>
              <select
                value={bankIdB}
                onChange={(e) => { setBankIdB(e.target.value); resetResults(); }}
                disabled={isRunningAll}
                className="h-7 px-2 rounded-lg bg-white/5 border border-white/10 text-[11px] text-coda-text font-mono focus:outline-none focus:border-white/30 disabled:opacity-50 min-w-0 w-full"
              >
                {activeBanks.filter(b => b.id !== bankIdA).map(b => (
                  <option key={b.id} value={b.id} className="bg-coda-surface text-coda-text">
                    {b.name} ({b.short_code})
                  </option>
                ))}
              </select>
            </div>
            {bankIdA === bankIdB && bankIdA && (
              <span className="text-[9px] text-red-400 font-mono">Same bank</span>
            )}
          </div>
        ) : (
          <select
            value={selectedBankId}
            onChange={(e) => { setSelectedBankId(e.target.value); resetResults(); }}
            disabled={isRunningAll}
            className="h-8 px-3 rounded-lg bg-white/5 border border-white/10 text-xs text-coda-text font-mono focus:outline-none focus:border-white/30 disabled:opacity-50 min-w-0 flex-1"
          >
            {activeBanks.length === 0 && <option value="">No active banks</option>}
            {activeBanks.map(b => (
              <option key={b.id} value={b.id} className="bg-coda-surface text-coda-text">
                {b.name} ({b.short_code})
              </option>
            ))}
          </select>
        )}

        {/* Run All */}
        <button
          onClick={runAll}
          disabled={isRunningAll || !canRun}
          className="liquid-button flex items-center px-3 py-1.5 text-coda-text text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap flex-shrink-0"
        >
          {isRunningAll ? (
            <><Loader2 size={13} className="animate-spin" /> <span>Running...</span></>
          ) : (
            <><Play size={13} /> <span>{compareMode ? 'Compare All' : 'Run All Scenarios'}</span></>
          )}
        </button>

        {/* Cleanup */}
        <button
          onClick={runCleanup}
          disabled={cleanupStatus === 'cleaning' || isRunningAll}
          title="Remove leftover pg_* test rows from database"
          className="liquid-button flex items-center px-2.5 py-1.5 text-coda-text-muted text-xs font-medium disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap flex-shrink-0"
        >
          {cleanupStatus === 'cleaning' ? (
            <><Loader2 size={12} className="animate-spin" /> <span>Cleaning...</span></>
          ) : cleanupStatus ? (
            <><Trash2 size={12} /> <span>{cleanupStatus}</span></>
          ) : (
            <><Trash2 size={12} /> <span>Cleanup</span></>
          )}
        </button>

        {/* Reset */}
        <button
          onClick={resetResults}
          disabled={activeResults.size === 0 && !isRunningAll}
          className="liquid-button flex items-center px-3 py-1.5 text-coda-text-muted text-xs font-medium disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap flex-shrink-0"
        >
          <RotateCcw size={13} />
          <span>Reset</span>
        </button>
      </div>

      {/* Content */}
      <PageTransition className="space-y-0">
        {loadError ? (
          <div className="dashboard-card p-8 text-center">
            <AlertCircle size={24} className="mx-auto text-red-400 mb-2" />
            <p className="text-sm font-medium text-coda-text mb-1">Backend Unavailable</p>
            <p className="text-xs text-coda-text-muted mb-3">{loadError}</p>
            <p className="text-[10px] text-coda-text-muted">Ensure the Edge Function is deployed and the /proving-ground route is accessible.</p>
          </div>
        ) : (
          <div className="flex gap-4 min-h-[calc(100vh-10rem)]">
            {/* ── LEFT PANEL — Scenario Catalog ── */}
            <div className="w-[38%] flex-shrink-0 space-y-2 overflow-y-auto max-h-[calc(100vh-10rem)] pr-1 scrollbar-thin">
              {grouped.map(cat => {
                const CatIcon = cat.icon;
                const isCollapsed = collapsedCategories.has(cat.key);
                const catResultsA = cat.scenarios.map(s => activeResults.get(s.id)).filter(Boolean);
                const passedA = catResultsA.filter(r => r?.overall_result === 'PASS').length;
                const errorsA = catResultsA.filter(r => r?.overall_result === 'ERROR').length;
                const totalA = catResultsA.length;

                return (
                  <div key={cat.key} className="dashboard-card-subtle overflow-hidden">
                    <button
                      onClick={() => toggleCategory(cat.key)}
                      className="w-full flex items-center gap-3 p-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors cursor-pointer"
                    >
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                        cat.key === 'dispute' ? 'bg-coda-brand/10' : 'bg-white/5'
                      }`}>
                        <CatIcon size={14} className={cat.key === 'dispute' ? 'text-coda-brand' : 'text-coda-text-muted'} />
                      </div>
                      <div className="flex-1 text-left">
                        <span className="text-sm font-medium text-coda-text">{cat.label}</span>
                        <span className="text-[10px] text-coda-text-muted ml-2">
                          {cat.scenarios.length} scenarios
                        </span>
                      </div>
                      {totalA > 0 && (
                        <span className="text-[10px] font-mono text-coda-text-muted mr-2">
                          {compareMode ? `A:${passedA}/${totalA}` : `${passedA}/${totalA}`}
                          {errorsA > 0 && <span className="text-amber-600 dark:text-amber-400 ml-1">{errorsA}err</span>}
                        </span>
                      )}
                      {isCollapsed ? (
                        <ChevronRight size={14} className="text-coda-text-muted" />
                      ) : (
                        <ChevronDown size={14} className="text-coda-text-muted" />
                      )}
                    </button>

                    <AnimatePresence initial={false}>
                      {!isCollapsed && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="px-2 pb-2 space-y-1">
                            {cat.scenarios.map(scenario => (
                              <ScenarioCard
                                key={scenario.id}
                                scenario={scenario}
                                result={activeResults.get(scenario.id)}
                                resultB={compareMode ? activeResultsB.get(scenario.id) : undefined}
                                compareMode={compareMode}
                                bankNameA={compareMode ? bankNameA : undefined}
                                bankNameB={compareMode ? bankNameB : undefined}
                                isRunning={currentRunningId === scenario.id}
                                isSelected={selectedScenarioId === scenario.id}
                                disabled={isRunningAll || (!!currentRunningId && currentRunningId !== scenario.id) || !canRun}
                                onRun={() => runScenario(scenario.id)}
                                onSelect={() => {
                                  setSelectedScenarioId(scenario.id);
                                  setAllSummary(null);
                                  setSummaryA(null);
                                  setSummaryB(null);
                                }}
                              />
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>

            {/* ── RIGHT PANEL ── */}
            <div className="flex-1 min-w-0 overflow-y-auto max-h-[calc(100vh-10rem)] scrollbar-thin">
              <AnimatePresence mode="popLayout">
                {/* Idle */}
                {showIdle && !currentRunningId && (
                  <motion.div
                    key="idle"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="dashboard-card p-12 flex flex-col items-center justify-center text-center"
                    style={{ minHeight: '400px' }}
                  >
                    <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
                      {compareMode ? (
                        <GitCompareArrows size={28} className="text-coda-text-muted" />
                      ) : (
                        <Shield size={28} className="text-coda-text-muted" />
                      )}
                    </div>
                    <p className="text-sm text-coda-text-muted font-medium">
                      {compareMode
                        ? 'Select a scenario or Compare All to begin side-by-side testing'
                        : 'Select a scenario or Run All to begin testing'}
                    </p>
                    <p className="text-xs text-coda-text-muted mt-1">
                      {compareMode
                        ? `Comparing ${bankNameA} vs ${bankNameB}`
                        : 'Results will appear here with detailed per-agent breakdowns'}
                    </p>
                  </motion.div>
                )}

                {/* Running single scenario */}
                {currentRunningId && !isRunningAll && (
                  <motion.div
                    key={`running-${currentRunningId}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="dashboard-card p-8 flex flex-col items-center justify-center text-center"
                    style={{ minHeight: '400px' }}
                  >
                    <Loader2 size={32} className="text-coda-text-muted animate-spin mb-4" />
                    <p className="text-sm text-coda-text font-medium">
                      Running: {scenarios.find(s => s.id === currentRunningId)?.name}
                    </p>
                    <p className="text-xs text-coda-text-muted mt-1">
                      {compareMode
                        ? `Testing against ${bankNameA} and ${bankNameB}...`
                        : 'Executing against live agent pipeline...'}
                    </p>
                    <div className="mt-4 flex items-center gap-3 text-[10px] font-mono text-coda-text-muted">
                      <span className="flex items-center gap-1"><Shield size={10} /> Compliance</span>
                      <span>&rarr;</span>
                      <span className="flex items-center gap-1"><BarChart3 size={10} /> Risk</span>
                      <span>&rarr;</span>
                      <span className="flex items-center gap-1"><Zap size={10} /> Agent Think</span>
                    </div>
                  </motion.div>
                )}

                {/* Run All progress */}
                {showRunAllProgress && (
                  <motion.div
                    key="run-all-progress"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="dashboard-card p-6"
                    style={{ minHeight: '400px' }}
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <Loader2 size={20} className="text-coda-text-muted animate-spin" />
                        <div>
                          <p className="text-sm font-medium text-coda-text">
                            {compareMode && runAllProgress.phase
                              ? `Testing ${runAllProgress.phase} — scenario ${runAllProgress.current}/${runAllProgress.total}`
                              : `Running scenario ${runAllProgress.current}/${runAllProgress.total}`}
                          </p>
                          <p className="text-xs text-coda-text-muted">
                            {scenarios.find(s => s.id === currentRunningId)?.name || '...'}
                          </p>
                        </div>
                      </div>
                      {/* ETA */}
                      {getEta() && (
                        <span className="text-[10px] font-mono text-coda-text-muted flex items-center gap-1">
                          <Clock size={10} />
                          {getEta()}
                        </span>
                      )}
                    </div>

                    {/* Progress bar */}
                    <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden mb-5">
                      <motion.div
                        className="h-full rounded-full bg-neutral-700 dark:bg-neutral-300"
                        initial={{ width: 0 }}
                        animate={{ width: `${(runAllProgress.current / runAllProgress.total) * 100}%` }}
                        transition={{ duration: 0.3 }}
                      />
                    </div>

                    {/* Results so far */}
                    <div className="space-y-1.5 max-h-80 overflow-y-auto scrollbar-thin">
                      {compareMode ? (
                        <>
                          {Array.from(resultsA.entries()).map(([id, r]) => (
                            <div key={`a-${id}`} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-white/3 text-xs">
                              <span className="text-coda-text truncate flex-1">{r.scenario_name}</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[8px] font-mono text-coda-text-muted">A</span>
                                <ResultBadge result={r.overall_result} />
                                {resultsB.has(id) && (
                                  <>
                                    <span className="text-[8px] font-mono text-coda-text-muted">B</span>
                                    <ResultBadge result={resultsB.get(id)!.overall_result} />
                                  </>
                                )}
                              </div>
                            </div>
                          ))}
                          {Array.from(resultsB.entries()).filter(([id]) => !resultsA.has(id)).map(([id, r]) => (
                            <div key={`b-${id}`} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-white/3 text-xs">
                              <span className="text-coda-text truncate flex-1">{r.scenario_name}</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[8px] font-mono text-coda-text-muted">B</span>
                                <ResultBadge result={r.overall_result} />
                              </div>
                            </div>
                          ))}
                        </>
                      ) : (
                        Array.from(results.entries()).map(([id, r]) => (
                          <div key={id} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-white/3 text-xs">
                            <span className="text-coda-text truncate flex-1">{r.scenario_name}</span>
                            <ResultBadge result={r.overall_result} />
                          </div>
                        ))
                      )}
                    </div>
                  </motion.div>
                )}

                {/* Compare scorecard (single scenario) */}
                {showCompareScorecard && (
                  <motion.div
                    key={`compare-scorecard-${selectedScenarioId}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    <ComparisonScorecard resultA={selectedResultA!} resultB={selectedResultB!} />
                  </motion.div>
                )}

                {/* Single-bank scorecard */}
                {showSingleScorecard && (
                  <motion.div
                    key={`scorecard-${selectedScenarioId}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    <ScenarioScorecard result={selectedResultA!} />
                  </motion.div>
                )}

                {/* Compare summary (Run All) */}
                {showCompareSummary && (
                  <motion.div
                    key="compare-summary"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <ComparisonSummaryView
                      resultsA={Array.from(resultsA.values())}
                      resultsB={Array.from(resultsB.values())}
                      summaryA={summaryA!}
                      summaryB={summaryB!}
                      bankNameA={bankNameA}
                      bankNameB={bankNameB}
                      bankIdA={bankIdA}
                      bankIdB={bankIdB}
                    />
                  </motion.div>
                )}

                {/* Single-bank summary */}
                {showSingleSummary && (
                  <motion.div
                    key="summary"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <ProvingGroundSummaryView
                      results={Array.from(results.values())}
                      summary={allSummary!}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </PageTransition>
    </div>
  );
}

// ── Inline helper ───────────────────────────────────────────

function ResultBadge({ result }: { result: string }) {
  const style = result === 'PASS'
    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
    : result === 'ERROR'
      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
      : 'bg-red-500/15 text-red-600 dark:text-red-400';
  return (
    <span className={`font-mono font-semibold px-1.5 py-0.5 rounded-full text-[10px] ${style}`}>
      {result}
    </span>
  );
}

export default ProvingGround;