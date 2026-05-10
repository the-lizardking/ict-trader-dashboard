import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, RefreshCw, Workflow } from 'lucide-react';
import { fetchPipeline, type PipelineDoc, type PipelineStage } from '../lib/tradePipeline';
import { cn } from '../lib/utils';

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function StageCard({ stage }: { stage: PipelineStage }) {
  const [showFailures, setShowFailures] = useState(false);
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-8 h-8 rounded-full bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-xs font-semibold text-blue-300 tabular-nums">
          {stage.number}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-gray-100">{stage.name}</h2>
          {stage.lastVerified && (
            <p className="text-[10px] text-gray-500 mt-0.5">
              Last verified: {stage.lastVerified}
            </p>
          )}
        </div>
      </div>

      {stage.files.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">Files</p>
          <div className="flex flex-wrap gap-1.5">
            {stage.files.map((f) => (
              <span
                key={f}
                className="inline-flex items-center px-2 py-0.5 rounded bg-slate-800 text-emerald-300 text-[11px] font-mono break-all"
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      )}

      {(stage.inputs || stage.outputs) && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {stage.inputs && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Inputs</p>
              <p className="text-xs text-gray-300 leading-relaxed">{stage.inputs}</p>
            </div>
          )}
          {stage.outputs && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Outputs</p>
              <p className="text-xs text-gray-300 leading-relaxed">{stage.outputs}</p>
            </div>
          )}
        </div>
      )}

      {stage.description && (
        <div className="mt-3">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Description</p>
          <p className="text-xs text-gray-300 leading-relaxed">{stage.description}</p>
        </div>
      )}

      {stage.failureModes.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowFailures((v) => !v)}
            className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-gray-500 hover:text-gray-300"
          >
            {showFailures ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            Failure modes ({stage.failureModes.length})
          </button>
          {showFailures && (
            <ul className="mt-2 space-y-1 pl-5 list-disc marker:text-gray-700">
              {stage.failureModes.map((f, i) => (
                <li key={i} className="text-xs text-gray-400 leading-relaxed">
                  {f}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function StageArrow() {
  return (
    <div className="flex justify-center py-1">
      <svg width="16" height="22" viewBox="0 0 16 22" className="text-gray-700" aria-hidden="true">
        <line x1="8" y1="0" x2="8" y2="16" stroke="currentColor" strokeWidth="2" />
        <polyline
          points="3,14 8,20 13,14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function StageSkeleton() {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4 sm:p-5 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-gray-800" />
        <div className="flex-1 space-y-2">
          <div className="h-3 bg-gray-800 rounded w-1/3" />
          <div className="h-2 bg-gray-800 rounded w-1/4" />
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <div className="h-2 bg-gray-800 rounded w-full" />
        <div className="h-2 bg-gray-800 rounded w-5/6" />
        <div className="h-2 bg-gray-800 rounded w-4/6" />
      </div>
    </div>
  );
}

export default function TradeProcessTab() {
  const [doc, setDoc] = useState<PipelineDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const d = await fetchPipeline(force);
      setDoc(d);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <Workflow size={16} className="text-blue-400 shrink-0" />
            <h1 className="text-base font-semibold text-gray-100 truncate">Trade Process</h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {doc && (
              <span
                className="text-[10px] text-gray-500"
                title={doc.fetchedAt.toLocaleString()}
              >
                fetched {formatTime(doc.fetchedAt)}
              </span>
            )}
            <button
              type="button"
              onClick={() => load(true)}
              disabled={loading}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs',
                'bg-gray-800/60 text-gray-300 border border-gray-700 hover:bg-gray-800',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-2 leading-relaxed">
          End-to-end pipeline, sourced live from{' '}
          {doc ? (
            <a
              href={doc.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-blue-300 hover:text-blue-200 underline-offset-2 hover:underline"
            >
              <code className="font-mono">ict-trading-bot/docs/TRADE-PIPELINE.md</code>
              <ExternalLink size={10} />
            </a>
          ) : (
            <code className="font-mono text-gray-300">
              ict-trading-bot/docs/TRADE-PIPELINE.md
            </code>
          )}
          . Sprints touching the pipeline must keep this doc current — see the architecture doc's
          Update Rule.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-200">
          <p className="font-semibold mb-1">Failed to load pipeline doc</p>
          <p className="mb-2 text-red-300/90">{error}</p>
          <button
            type="button"
            onClick={() => load(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-red-600/20 hover:bg-red-600/30 text-red-200 border border-red-500/40"
          >
            <RefreshCw size={11} />
            Retry
          </button>
        </div>
      )}

      {!doc && !error && (
        <div className="space-y-2">
          <StageSkeleton />
          <StageSkeleton />
          <StageSkeleton />
        </div>
      )}

      {doc && (
        <div>
          {doc.stages.map((stage, i) => (
            <div key={stage.number}>
              <StageCard stage={stage} />
              {i < doc.stages.length - 1 && <StageArrow />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
