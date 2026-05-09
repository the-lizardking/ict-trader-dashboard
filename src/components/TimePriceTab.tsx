import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Clock, Lock } from 'lucide-react';
import { Signal } from '../types';
import { cn } from '../lib/utils';

interface TimePriceTabProps {
  signals: Signal[] | null;
}

interface Killzone {
  id: 'asia' | 'london' | 'ny';
  label: string;
  short: string;
  /** Inclusive start hour, UTC. */
  startHourUtc: number;
  /** Exclusive end hour, UTC. */
  endHourUtc: number;
  band: string;
  bar: string;
  text: string;
}

// Killzone windows match the operator's S-062 brief:
// Asia 00–04 UTC, London 07–10 UTC, NY 12–15 UTC.
const KILLZONES: Killzone[] = [
  {
    id: 'asia',
    label: 'Asia',
    short: 'ASIA',
    startHourUtc: 0,
    endHourUtc: 4,
    band: 'rgba(99, 102, 241, 0.18)', // indigo-500/18
    bar: '#6366f1',
    text: 'text-indigo-300',
  },
  {
    id: 'london',
    label: 'London',
    short: 'LDN',
    startHourUtc: 7,
    endHourUtc: 10,
    band: 'rgba(34, 197, 94, 0.16)', // emerald-500/16
    bar: '#22c55e',
    text: 'text-emerald-300',
  },
  {
    id: 'ny',
    label: 'New York',
    short: 'NY',
    startHourUtc: 12,
    endHourUtc: 15,
    band: 'rgba(244, 114, 182, 0.18)', // pink-400/18
    bar: '#f472b6',
    text: 'text-pink-300',
  },
];

function killzoneOf(hourUtc: number): Killzone | null {
  for (const k of KILLZONES) {
    if (hourUtc >= k.startHourUtc && hourUtc < k.endHourUtc) return k;
  }
  return null;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function relativeTime(ts: number, now: number): string {
  const sec = Math.max(0, Math.floor((now - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

type Lookback = '24h' | '168h';

const LOOKBACK_MS: Record<Lookback, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '168h': 168 * 60 * 60 * 1000,
};

export default function TimePriceTab({ signals }: TimePriceTabProps) {
  const [lookback, setLookback] = useState<Lookback>('24h');

  const now = Date.now();
  const list = signals ?? [];

  // Filter to signals inside the lookback window with a parseable timestamp.
  const windowed = useMemo(() => {
    const cutoff = now - LOOKBACK_MS[lookback];
    return list
      .map((s) => ({ s, ts: new Date(s.timestamp).getTime() }))
      .filter(({ ts }) => isFinite(ts) && ts >= cutoff && ts <= now);
  }, [list, lookback, now]);

  // Per-killzone counts over the window.
  const kzCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const k of KILLZONES) counts.set(k.id, 0);
    let outside = 0;
    for (const { ts } of windowed) {
      const hr = new Date(ts).getUTCHours();
      const kz = killzoneOf(hr);
      if (kz) counts.set(kz.id, (counts.get(kz.id) ?? 0) + 1);
      else outside += 1;
    }
    return { counts, outside };
  }, [windowed]);

  // Recharts-shaped data for the density bar chart.
  const densityData = useMemo(
    () =>
      KILLZONES.map((k) => ({
        name: k.short,
        count: kzCounts.counts.get(k.id) ?? 0,
        fill: k.bar,
        windowLabel: `${pad2(k.startHourUtc)}:00–${pad2(k.endHourUtc)}:00 UTC`,
      })),
    [kzCounts],
  );

  const totalInZones = densityData.reduce((acc, d) => acc + d.count, 0);
  const totalOutside = kzCounts.outside;

  // Loading skeleton — first poll hasn't returned yet.
  if (signals === null) {
    return (
      <div className="space-y-4">
        <div className="metric-card animate-pulse">
          <div className="h-4 bg-gray-700 rounded w-1/3 mb-3" />
          <div className="h-3 bg-gray-700 rounded w-2/3" />
        </div>
        <div className="metric-card animate-pulse h-40" />
        <div className="metric-card animate-pulse h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Header
        lookback={lookback}
        onLookbackChange={setLookback}
        totalSignals={windowed.length}
      />

      {/* Killzone overlay strip */}
      <section>
        <SectionTitle title="Killzone overlay (24h, UTC)" />
        <KillzoneStrip windowed={windowed} now={now} />
        <KillzoneLegend />
      </section>

      {/* Signal density bar chart */}
      <section>
        <SectionTitle
          title={`Signal density · last ${lookback === '24h' ? '24h' : '168h'}`}
          right={
            <span className="text-[10px] text-gray-500 tabular-nums">
              {totalInZones} in killzones · {totalOutside} outside
            </span>
          }
        />
        {windowed.length === 0 ? (
          <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-8 text-center">
            <Clock size={20} className="text-gray-600 mx-auto mb-2" />
            <p className="text-sm text-gray-300">
              No signals fired in the last {lookback === '24h' ? '24 hours' : '7 days'}.
            </p>
          </div>
        ) : (
          <DensityChart data={densityData} />
        )}
      </section>

      {/* Power-of-3 phase strip — disabled (needs richer signal metadata) */}
      <section>
        <SectionTitle title="Power-of-3 phase strip" />
        <PowerOfThreeStrip />
      </section>
    </div>
  );
}

function Header({
  lookback,
  onLookbackChange,
  totalSignals,
}: {
  lookback: Lookback;
  onLookbackChange: (l: Lookback) => void;
  totalSignals: number;
}) {
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div className="flex items-center gap-2 min-w-0">
        <Clock size={16} className="text-blue-400 shrink-0" />
        <h1 className="text-base font-semibold text-gray-100">Time &amp; Price</h1>
        <span className="text-[10px] text-gray-500 hidden sm:inline">
          killzones, session overlays, signal density
        </span>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-gray-500">
          <span className="text-gray-200 tabular-nums">{totalSignals}</span> in window
        </span>
        <div
          className="inline-flex rounded-md border border-gray-700 overflow-hidden text-[10px]"
          role="tablist"
          aria-label="Lookback window"
        >
          {(['24h', '168h'] as Lookback[]).map((opt) => (
            <button
              key={opt}
              type="button"
              role="tab"
              aria-selected={lookback === opt}
              onClick={() => onLookbackChange(opt)}
              className={cn(
                'px-2.5 py-1 uppercase tracking-wider transition-colors',
                lookback === opt
                  ? 'bg-blue-600/20 text-blue-200'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800',
              )}
            >
              {opt === '24h' ? '24h' : '7d'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({
  title,
  right,
}: {
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-2 px-1">
      <h3 className="text-xs uppercase tracking-wider text-gray-500">{title}</h3>
      {right}
    </div>
  );
}

function KillzoneStrip({
  windowed,
  now,
}: {
  windowed: { s: Signal; ts: number }[];
  now: number;
}) {
  // 24-hour grid. Each hour is a column. Bands shaded by killzone, ticks every
  // 6 hours, and a marker per signal in the *last 24h* slice (regardless of
  // outer lookback) so the strip stays a "today" view.
  const last24Cutoff = now - LOOKBACK_MS['24h'];
  const last24 = windowed.filter(({ ts }) => ts >= last24Cutoff);

  // Group signals by hour for compact stacking.
  const byHour = new Map<number, Signal[]>();
  for (const { s, ts } of last24) {
    const hr = new Date(ts).getUTCHours();
    const arr = byHour.get(hr) ?? [];
    arr.push(s);
    byHour.set(hr, arr);
  }

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
      {/* 24-column timeline. Use a CSS grid so signal markers align cleanly with
          tick labels regardless of viewport width. */}
      <div
        className="relative grid"
        style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))', minHeight: 64 }}
      >
        {/* Bands */}
        {KILLZONES.map((k) => (
          <div
            key={k.id}
            className="row-start-1 col-start-1 h-full pointer-events-none rounded-sm"
            style={{
              backgroundColor: k.band,
              gridColumn: `${k.startHourUtc + 1} / span ${
                k.endHourUtc - k.startHourUtc
              }`,
              gridRow: '1 / -1',
            }}
            title={`${k.label} · ${pad2(k.startHourUtc)}:00–${pad2(k.endHourUtc)}:00 UTC`}
          />
        ))}
        {/* Hour cells (ghost) — gives signals a column to live in */}
        {Array.from({ length: 24 }, (_, hr) => {
          const sigs = byHour.get(hr) ?? [];
          const kz = killzoneOf(hr);
          return (
            <div
              key={hr}
              className="relative flex flex-col items-center justify-end pt-3 pb-4"
              style={{ gridColumn: `${hr + 1} / span 1`, gridRow: '1 / -1' }}
            >
              {sigs.length > 0 && (
                <div
                  className="w-1.5 rounded-t-sm"
                  style={{
                    height: `${Math.min(28, 6 + sigs.length * 4)}px`,
                    backgroundColor: kz?.bar ?? '#9ca3af',
                  }}
                  title={`${sigs.length} signal${sigs.length === 1 ? '' : 's'} at ${pad2(hr)}:00 UTC`}
                />
              )}
            </div>
          );
        })}
      </div>
      {/* Hour ticks */}
      <div
        className="grid mt-1 text-[9px] text-gray-600 tabular-nums"
        style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}
      >
        {Array.from({ length: 24 }, (_, hr) => (
          <div key={hr} className="text-center">
            {hr % 6 === 0 ? `${pad2(hr)}` : ''}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-500 mt-2">
        Vertical bars mark hours where signals fired in the last 24h. Shaded bands
        are the three operator killzones (Asia, London, NY). All times UTC.
      </p>
      {last24.length > 0 && (
        <p className="text-[10px] text-gray-600 mt-1">
          Most recent signal: {relativeTime(last24[last24.length - 1].ts, now)}
        </p>
      )}
    </div>
  );
}

function KillzoneLegend() {
  return (
    <div className="flex items-center gap-3 flex-wrap mt-2 px-1">
      {KILLZONES.map((k) => (
        <div key={k.id} className="inline-flex items-center gap-1.5 text-[10px]">
          <span
            className="w-3 h-3 rounded-sm"
            style={{ backgroundColor: k.band, borderColor: k.bar }}
          />
          <span className={cn('uppercase tracking-wider', k.text)}>{k.label}</span>
          <span className="text-gray-500 font-mono">
            {pad2(k.startHourUtc)}–{pad2(k.endHourUtc)}
          </span>
        </div>
      ))}
    </div>
  );
}

function DensityChart({
  data,
}: {
  data: { name: string; count: number; fill: string; windowLabel: string }[];
}) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="#1f2937" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="name"
              stroke="#6b7280"
              tick={{ fontSize: 11 }}
              axisLine={{ stroke: '#374151' }}
              tickLine={false}
            />
            <YAxis
              stroke="#6b7280"
              tick={{ fontSize: 11 }}
              axisLine={{ stroke: '#374151' }}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ fill: 'rgba(59,130,246,0.08)' }}
              contentStyle={{
                backgroundColor: '#0d1117',
                border: '1px solid #1f2937',
                borderRadius: 6,
                fontSize: 12,
              }}
              labelStyle={{ color: '#d1d5db' }}
              formatter={(value: number) => [value, 'signals']}
              labelFormatter={(_, payload) => {
                const row = payload && payload[0]?.payload;
                return row ? `${row.name} · ${row.windowLabel}` : '';
              }}
            />
            <Bar dataKey="count" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function PowerOfThreeStrip() {
  // Power-of-3 (accumulation / manipulation / distribution) requires a
  // bot-side phase classifier on each signal. The current /api/bot/signals
  // contract has no such field, so we render a disabled placeholder strip
  // rather than fabricate phases from price/timestamp heuristics. Sprint
  // S-062 explicitly calls this out as a non-goal — don't fake it.
  const phases = [
    { label: 'Accumulation', tone: 'text-indigo-300' },
    { label: 'Manipulation', tone: 'text-amber-300' },
    { label: 'Distribution', tone: 'text-pink-300' },
  ];
  return (
    <div className="rounded-lg border border-dashed border-gray-700 bg-gray-900/30 p-4">
      <div className="flex items-start gap-3">
        <Lock size={16} className="text-gray-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-300">Disabled — needs richer signal metadata</p>
          <p className="text-[11px] text-gray-500 mt-1">
            Power-of-3 requires a phase tag on each signal (accumulation /
            manipulation / distribution). The bot's /api/bot/signals contract
            doesn't yet include this field. We'll wire the strip when the bot
            adds <code>signal.phase</code> — until then, faking it from price
            or timestamp would be misleading.
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {phases.map((p) => (
              <div
                key={p.label}
                className="rounded-md border border-gray-800 bg-gray-900/40 px-2 py-1.5 opacity-50"
              >
                <p className={cn('text-[10px] uppercase tracking-wider', p.tone)}>
                  {p.label}
                </p>
                <p className="text-[10px] text-gray-600">no data</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
