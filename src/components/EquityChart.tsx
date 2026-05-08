import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { EquityPoint } from '../types';

interface EquityChartProps {
  data: EquityPoint[];
}

export default function EquityChart({ data }: EquityChartProps) {
  const ready = data.length >= 2;
  return (
    <div className="metric-card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-200">Equity Curve</h3>
        <span className="text-xs text-gray-500">
          {ready ? `live · ${data.length} points` : 'warming up…'}
        </span>
      </div>
      {ready ? (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="time" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} domain={['dataMin', 'dataMax']} />
            <Tooltip
              contentStyle={{ backgroundColor: '#111827', border: '1px solid #1f2937', borderRadius: '6px', fontSize: '12px' }}
              labelStyle={{ color: '#9ca3af' }}
              itemStyle={{ color: '#3b82f6' }}
              formatter={(v: number) => [`$${v.toFixed(2)}`, 'Total PnL']}
            />
            <Area type="monotone" dataKey="equity" stroke="#3b82f6" strokeWidth={2} fill="url(#equityGradient)" />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-[200px] flex flex-col items-center justify-center gap-2 text-gray-500">
          <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs">Collecting equity points (one per refresh tick)</p>
        </div>
      )}
    </div>
  );
}
