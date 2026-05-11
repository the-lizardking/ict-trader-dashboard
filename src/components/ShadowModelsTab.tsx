import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Filter, RefreshCw, TrendingUp, AlertTriangle } from 'lucide-react';
import {
  ShadowDriftResponse,
  ShadowPredictionsResponse,
  ShadowStatsResponse,
} from '../types';
import {
  BotApiError,
  describeError,
  getShadowDrift,
  getShadowPredictions,
  getShadowStats,
} from '../services/api';
import { cn } from '../lib/utils';

const POLL_MS = 30_000;
const DEFAULT_PREDICTIONS_LIMIT = 100;

type SinceWindow = '24h' | '7d' | '30d' | 'all';

function sinceWindowToIso(window: SinceWindow): string | undefined {
  if (window === 'all') return undefined;
  const now = new Date();
  const ms = window === '24h' ? 86_400_000 : window === '7d' ? 604_800_000 : 2_592_000_000;
  return new Date(now.getTime() - ms).toISOString();
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!isFinite(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatNumber(v: number | null | undefined, digits = 3): string {
  if (v == null || !isFinite(v)) return '—';
  return v.toFixed(digits);
}

function verdictBadgeClasses(verdict: string): string {
  // Aligned with the bot's drift verdict taxonomy
  // (ml.shadow.drift.interpret_ks / interpret_psi). Pick the worst-case
  // colour so a "moderate" KS doesn't read as fine when PSI is high.
  switch (verdict) {
    case 'no_change':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40';
    case 'minor':
      return 'bg-yellow-500/15 text-yellow-300 border-yellow-500/40';
    case 'moderate':
      return 'bg-orange-500/15 text-orange-300 border-orange-500/40';
    case 'significant':
      return 'bg-red-500/15 text-red-300 border-red-500/40';
    case 'insufficient_data':
      return 'bg-gray-700/40 text-gray-400 border-gray-600';
    default:
      return 'bg-gray-700/40 text-gray-400 border-gray-600';
  }
}

function verdictLabel(verdict: string): string {
  switch (verdict) {
    case 'no_change':
      return 'No change';
    case 'minor':
      return 'Minor';
    case 'moderate':
      return 'Moderate';
    case 'significant':
      return 'Significant';
    case 'insufficient_data':
      return 'Insufficient data';
    default:
      return verdict;
  }
}

interface SummaryStats {
  predictionsLastWindow: number;
  uniqueModels: number;
  stages: string[];
  lastSeen: string | null;
}

function computeSummary(
  stats: ShadowStatsResponse | null,
  predictions: ShadowPredictionsResponse | null,
): SummaryStats {
  const records = stats?.records ?? [];
  const uniqueModels = new Set(records.map((r) => r.model_id)).size;
  const stages = Array.from(new Set(records.map((r) => r.stage))).sort();
  let lastSeen: string | null = null;
  for (const r of records) {
    if (r.last_seen && (!lastSeen || r.last_seen > lastSeen)) lastSeen = r.last_seen;
  }
  return {
    predictionsLastWindow: predictions?.count ?? 0,
    uniqueModels,
    stages,
    lastSeen,
  };
}

export default function ShadowModelsTab() {
  const [stats, setStats] = useState<ShadowStatsResponse | null>(null);
  const [predictions, setPredictions] = useState<ShadowPredictionsResponse | null>(null);
  const [drift, setDrift] = useState<ShadowDriftResponse | null>(null);

  const [statsError, setStatsError] = useState<BotApiError | null>(null);
  const [predictionsError, setPredictionsError] = useState<BotApiError | null>(null);
  const [driftError, setDriftError] = useState<BotApiError | null>(null);

  const [loading, setLoading] = useState(false);
  const [driftLoading, setDriftLoading] = useState(false);

  // Filter state — defaults to "all" so the operator gets the full picture
  // on first load. `selectedModelId` empties out the drift panel until a
  // specific model is chosen (drift is per-model by construction).
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [modelFilter, setModelFilter] = useState<string>('all');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [sinceWindow, setSinceWindow] = useState<SinceWindow>('7d');
  const [selectedModelId, setSelectedModelId] = useState<string>('');

  const cancelledRef = useRef(false);

  const fetchStatsAndPredictions = useCallback(async () => {
    setLoading(true);
    const sinceIso = sinceWindowToIso(sinceWindow);
    const modelArg = modelFilter === 'all' ? undefined : modelFilter;
    const stageArg = stageFilter === 'all' ? undefined : stageFilter;

    const [statsRes, predictionsRes] = await Promise.allSettled([
      getShadowStats(modelArg, stageArg, sinceIso),
      getShadowPredictions(DEFAULT_PREDICTIONS_LIMIT, modelArg, stageArg, sinceIso),
    ]);

    if (cancelledRef.current) return;

    if (statsRes.status === 'fulfilled') {
      setStats(statsRes.value);
      setStatsError(null);
    } else {
      setStatsError(
        statsRes.reason instanceof BotApiError
          ? statsRes.reason
          : new BotApiError('?', 0, String(statsRes.reason), 'network'),
      );
    }

    if (predictionsRes.status === 'fulfilled') {
      setPredictions(predictionsRes.value);
      setPredictionsError(null);
    } else {
      setPredictionsError(
        predictionsRes.reason instanceof BotApiError
          ? predictionsRes.reason
          : new BotApiError('?', 0, String(predictionsRes.reason), 'network'),
      );
    }

    setLoading(false);
  }, [modelFilter, stageFilter, sinceWindow]);

  const fetchDrift = useCallback(async (modelId: string) => {
    if (!modelId) {
      setDrift(null);
      setDriftError(null);
      return;
    }
    setDriftLoading(true);
    try {
      const stageArg = stageFilter === 'all' ? undefined : stageFilter;
      const result = await getShadowDrift(modelId, { stage: stageArg });
      if (cancelledRef.current) return;
      setDrift(result);
      setDriftError(null);
    } catch (err) {
      if (cancelledRef.current) return;
      setDriftError(
        err instanceof BotApiError
          ? err
          : new BotApiError('?', 0, String(err), 'network'),
      );
      setDrift(null);
    } finally {
      if (!cancelledRef.current) setDriftLoading(false);
    }
  }, [stageFilter]);

  useEffect(() => {
    cancelledRef.current = false;
    fetchStatsAndPredictions();
    const id = setInterval(fetchStatsAndPredictions, POLL_MS);
    return () => {
      cancelledRef.current = true;
      clearInterval(id);
    };
  }, [fetchStatsAndPredictions]);

  useEffect(() => {
    if (!selectedModelId) {
      setDrift(null);
      return;
    }
    fetchDrift(selectedModelId);
  }, [selectedModelId, fetchDrift]);

  // Populate dropdowns from stats response — the bot returns one row
  // per (model_id, stage), so the union of distinct values is the
  // operator's choice surface.
  const modelOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of stats?.records ?? []) set.add(r.model_id);
    return Array.from(set).sort();
  }, [stats]);

  const stageOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of stats?.records ?? []) set.add(r.stage);
    return Array.from(set).sort();
  }, [stats]);

  const summary = useMemo(
    () => computeSummary(stats, predictions),
    [stats, predictions],
  );

  // log_present is false when the WS7 shadow harness has never written
  // to runtime_logs/shadow_predictions.jsonl on the live VM — which is
  // the steady state until the trainer VM is up + a model is registered
  // + wired into a strategy's shadow_model_ids YAML field.
  const logMissing =
    !!stats && !stats.log_present && (!predictions || !predictions.log_present);

  const empty = stats?.records.length === 0 && predictions?.records.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Activity size={16} className="text-blue-400 shrink-0" />
          <h1 className="text-base font-semibold text-gray-100 truncate">
            Shadow Models
          </h1>
          <span
            className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30"
            title="Backed by /api/bot/shadow/{predictions,stats,drift} — WS7 audit log + WS8 monitoring"
          >
            WS8
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border transition-colors',
              filtersOpen
                ? 'bg-blue-600/20 text-blue-300 border-blue-500/40'
                : 'bg-gray-800/60 text-gray-300 border-gray-700 hover:bg-gray-800',
            )}
          >
            <Filter size={12} />
            Filters
          </button>
          <button
            type="button"
            onClick={fetchStatsAndPredictions}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs bg-gray-800/60 text-gray-300 border border-gray-700 hover:bg-gray-800 disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {filtersOpen && (
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3 sm:p-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-gray-500">
              Model
              <select
                value={modelFilter}
                onChange={(e) => setModelFilter(e.target.value)}
                className="rounded-md bg-gray-900 border border-gray-700 px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
              >
                <option value="all">All</option>
                {modelOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-gray-500">
              Stage
              <select
                value={stageFilter}
                onChange={(e) => setStageFilter(e.target.value)}
                className="rounded-md bg-gray-900 border border-gray-700 px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
              >
                <option value="all">All</option>
                {stageOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-gray-500">
              Window
              <select
                value={sinceWindow}
                onChange={(e) => setSinceWindow(e.target.value as SinceWindow)}
                className="rounded-md bg-gray-900 border border-gray-700 px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
              >
                <option value="24h">Last 24 hours</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="all">All time</option>
              </select>
            </label>
          </div>
        </div>
      )}

      {(statsError || predictionsError) && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs text-red-200">
          Failed to load shadow data ({describeError(statsError ?? predictionsError)}).
          The endpoints are part of the S-AI-WS8-PART-2 + PART-3 surface; if the
          bot is rolling, retry shortly.
        </div>
      )}

      {logMissing ? (
        <ShadowEmptyState />
      ) : empty ? (
        <NoMatchesState
          modelFilter={modelFilter}
          stageFilter={stageFilter}
          sinceWindow={sinceWindow}
        />
      ) : (
        <>
          <SummaryStrip summary={summary} loading={loading} />
          <DriftPanel
            modelOptions={modelOptions}
            selectedModelId={selectedModelId}
            onSelectModel={setSelectedModelId}
            drift={drift}
            error={driftError}
            loading={driftLoading}
          />
          <StatsTable stats={stats} />
          <PredictionsFeed predictions={predictions} />
        </>
      )}
    </div>
  );
}

function ShadowEmptyState() {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-6">
      <div className="flex items-start gap-3">
        <Activity size={20} className="text-gray-500 shrink-0 mt-0.5" />
        <div className="text-xs text-gray-400 space-y-2">
          <p className="text-sm font-semibold text-gray-200">
            Shadow audit log not yet written
          </p>
          <p>
            <code className="text-gray-300">runtime_logs/shadow_predictions.jsonl</code>{' '}
            doesn't exist on the live VM yet. This is the steady state until
            three things have happened:
          </p>
          <ol className="list-decimal list-inside space-y-1 ml-2">
            <li>The trainer VM (<code className="text-gray-300">ict-trainer-vm</code>) is provisioned (tracked under <code className="text-gray-300">[provision-training-vm]</code> issues).</li>
            <li>At least one model is trained, registered, and promoted to stage <code className="text-gray-300">shadow</code> or higher in the registry.</li>
            <li>The model's id is added to <code className="text-gray-300">shadow_model_ids</code> in a strategy YAML on the live VM (operator step — see <code className="text-gray-300">docs/claude/trainer-vm-mode.md § 5</code>).</li>
          </ol>
          <p>
            Once the live <code className="text-gray-300">Coordinator</code>{' '}
            loads a shadow predictor, every tick appends a row here.
          </p>
        </div>
      </div>
    </div>
  );
}

function NoMatchesState({
  modelFilter,
  stageFilter,
  sinceWindow,
}: {
  modelFilter: string;
  stageFilter: string;
  sinceWindow: SinceWindow;
}) {
  const filters: string[] = [];
  if (modelFilter !== 'all') filters.push(`model = ${modelFilter}`);
  if (stageFilter !== 'all') filters.push(`stage = ${stageFilter}`);
  if (sinceWindow !== 'all') filters.push(`window = ${sinceWindow}`);
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-6 text-center">
      <p className="text-sm text-gray-300">No shadow predictions match.</p>
      {filters.length > 0 && (
        <p className="text-xs text-gray-500 mt-1">
          Active filters: {filters.join(', ')}.
        </p>
      )}
    </div>
  );
}

function SummaryStrip({
  summary,
  loading,
}: {
  summary: SummaryStats;
  loading: boolean;
}) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div className="metric-card">
        <p className="text-[10px] uppercase tracking-wider text-gray-500">
          Predictions in window
        </p>
        <p className="text-lg font-semibold text-gray-100 mt-0.5 tabular-nums">
          {loading && summary.predictionsLastWindow === 0 ? '—' : summary.predictionsLastWindow}
        </p>
      </div>
      <div className="metric-card">
        <p className="text-[10px] uppercase tracking-wider text-gray-500">
          Unique models
        </p>
        <p className="text-lg font-semibold text-gray-100 mt-0.5 tabular-nums">
          {summary.uniqueModels}
        </p>
      </div>
      <div className="metric-card">
        <p className="text-[10px] uppercase tracking-wider text-gray-500">
          Stages seen
        </p>
        <p
          className="text-lg font-semibold text-gray-100 mt-0.5 truncate"
          title={summary.stages.join(', ')}
        >
          {summary.stages.length === 0 ? '—' : summary.stages.join(', ')}
        </p>
      </div>
      <div className="metric-card">
        <p className="text-[10px] uppercase tracking-wider text-gray-500">
          Last seen
        </p>
        <p className="text-lg font-semibold text-gray-100 mt-0.5 truncate">
          {formatTimestamp(summary.lastSeen)}
        </p>
      </div>
    </div>
  );
}

function DriftPanel({
  modelOptions,
  selectedModelId,
  onSelectModel,
  drift,
  error,
  loading,
}: {
  modelOptions: string[];
  selectedModelId: string;
  onSelectModel: (id: string) => void;
  drift: ShadowDriftResponse | null;
  error: BotApiError | null;
  loading: boolean;
}) {
  // Drift is per-model by construction (ml.shadow.drift.compute_drift
  // compares two slices of the same model's score distribution).
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <TrendingUp size={14} className="text-blue-400 shrink-0" />
          <h2 className="text-sm font-semibold text-gray-100 truncate">
            Drift (reference vs current window)
          </h2>
        </div>
        <label className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-gray-500">
          Model
          <select
            value={selectedModelId}
            onChange={(e) => onSelectModel(e.target.value)}
            className="rounded-md bg-gray-900 border border-gray-700 px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
          >
            <option value="">— pick a model —</option>
            {modelOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!selectedModelId ? (
        <p className="text-xs text-gray-500">
          Pick a model above to see a 30-day reference vs 7-day current window
          drift report.
        </p>
      ) : error ? (
        <p className="text-xs text-red-300">
          Drift fetch failed: {describeError(error)}.
        </p>
      ) : loading || !drift ? (
        <p className="text-xs text-gray-500">Computing drift…</p>
      ) : (
        <DriftReport drift={drift} />
      )}
    </div>
  );
}

function DriftReport({ drift }: { drift: ShadowDriftResponse }) {
  const insufficient = drift.verdict === 'insufficient_data';
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
            verdictBadgeClasses(drift.verdict),
          )}
        >
          {drift.verdict === 'significant' && <AlertTriangle size={12} />}
          {verdictLabel(drift.verdict)}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-gray-500">
          Reference: {formatTimestamp(drift.reference_window_start)} (n={drift.reference_count})
        </span>
        <span className="text-[10px] uppercase tracking-wider text-gray-500">
          Current: {formatTimestamp(drift.current_window_start)} (n={drift.current_count})
        </span>
      </div>

      {insufficient ? (
        <p className="text-xs text-gray-500">
          Need at least one prediction in each window to compute drift. Wait
          for more shadow predictions to accumulate, or relax the window.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <DriftMetric
            label="KS statistic"
            value={formatNumber(drift.ks, 4)}
            verdict={drift.ks_verdict}
          />
          <DriftMetric
            label="PSI score"
            value={formatNumber(drift.psi, 4)}
            verdict={drift.psi_verdict}
          />
          <DriftMetric
            label="Mean (ref → cur)"
            value={`${formatNumber(drift.reference_mean, 3)} → ${formatNumber(drift.current_mean, 3)}`}
          />
          <DriftMetric
            label="Stdev (ref → cur)"
            value={`${formatNumber(drift.reference_stdev, 3)} → ${formatNumber(drift.current_stdev, 3)}`}
          />
        </div>
      )}
    </div>
  );
}

function DriftMetric({
  label,
  value,
  verdict,
}: {
  label: string;
  value: string;
  verdict?: string;
}) {
  return (
    <div className="metric-card">
      <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
      <p className="text-sm font-semibold text-gray-100 mt-0.5 tabular-nums truncate" title={value}>
        {value}
      </p>
      {verdict && (
        <p className={cn('text-[10px] mt-1', verdictBadgeClasses(verdict).split(' ')[1])}>
          {verdictLabel(verdict)}
        </p>
      )}
    </div>
  );
}

function StatsTable({ stats }: { stats: ShadowStatsResponse | null }) {
  if (!stats || stats.records.length === 0) return null;
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-800 text-xs font-semibold text-gray-200">
        Per-(model, stage) aggregate
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-900/60 border-b border-gray-800">
            <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500">
              <th className="px-3 py-2 font-medium">Model</th>
              <th className="px-3 py-2 font-medium">Stage</th>
              <th className="px-3 py-2 font-medium text-right">Count</th>
              <th className="px-3 py-2 font-medium text-right">Mean</th>
              <th className="px-3 py-2 font-medium text-right">Min</th>
              <th className="px-3 py-2 font-medium text-right">Max</th>
              <th className="px-3 py-2 font-medium">First seen</th>
              <th className="px-3 py-2 font-medium">Last seen</th>
              <th className="px-3 py-2 font-medium">Feature keys</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {stats.records.map((r) => (
              <tr key={`${r.model_id}|${r.stage}`} className="hover:bg-gray-800/30">
                <td className="px-3 py-2 font-mono text-gray-200">{r.model_id}</td>
                <td className="px-3 py-2 text-gray-300">{r.stage}</td>
                <td className="px-3 py-2 text-right text-gray-300 font-mono tabular-nums">
                  {r.count}
                </td>
                <td className="px-3 py-2 text-right text-gray-200 font-mono tabular-nums">
                  {formatNumber(r.score_mean, 3)}
                </td>
                <td className="px-3 py-2 text-right text-gray-300 font-mono tabular-nums">
                  {formatNumber(r.score_min, 3)}
                </td>
                <td className="px-3 py-2 text-right text-gray-300 font-mono tabular-nums">
                  {formatNumber(r.score_max, 3)}
                </td>
                <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                  {formatTimestamp(r.first_seen)}
                </td>
                <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                  {formatTimestamp(r.last_seen)}
                </td>
                <td className="px-3 py-2 text-gray-500 text-[10px]" title={r.row_keys_seen.join(', ')}>
                  {r.row_keys_seen.length > 0
                    ? `${r.row_keys_seen.length} keys`
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PredictionsFeed({
  predictions,
}: {
  predictions: ShadowPredictionsResponse | null;
}) {
  if (!predictions) return null;
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-800 text-xs font-semibold text-gray-200 flex items-center justify-between">
        <span>Recent predictions</span>
        <span className="text-[10px] uppercase tracking-wider text-gray-500">
          newest first · {predictions.records.length} shown
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-900/60 border-b border-gray-800">
            <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500">
              <th className="px-3 py-2 font-medium">Timestamp</th>
              <th className="px-3 py-2 font-medium">Model</th>
              <th className="px-3 py-2 font-medium">Stage</th>
              <th className="px-3 py-2 font-medium text-right">Score</th>
              <th className="px-3 py-2 font-medium">Features</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {predictions.records.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-gray-500">
                  No predictions yet in the current filter window.
                </td>
              </tr>
            )}
            {predictions.records.map((r, i) => (
              <tr key={`${r.predicted_at_utc}|${r.model_id}|${i}`} className="hover:bg-gray-800/30">
                <td className="px-3 py-2 text-gray-300 whitespace-nowrap">
                  {formatTimestamp(r.predicted_at_utc)}
                </td>
                <td className="px-3 py-2 font-mono text-gray-200">{r.model_id}</td>
                <td className="px-3 py-2 text-gray-300">{r.stage}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-100">
                  {formatNumber(r.score, 4)}
                </td>
                <td
                  className="px-3 py-2 text-gray-500 text-[10px]"
                  title={r.row_keys.join(', ')}
                >
                  {r.row_keys.length > 0 ? `${r.row_keys.length} keys` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
