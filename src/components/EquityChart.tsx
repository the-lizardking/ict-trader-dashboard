import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const MOCK_DATA = [
  { time: '00:00', equity: 10000 },
  { time: '02:00', equity: 10120 },
  { time: '04:00', equity: 10085 },
  { time: '06:00', equity: 10230 },
  { time: '08:00', equity: 10195 },
  { time: '10:00', equity: 10380 },
  { time: '12:00', equity: 10340 },
  { time: '14:00', equity: 10510 },
  { time: '16:00', equity: 10475 },
  { time: '18:00', equity: 10620 },
  { time: '20:00', equity: 10590 },
  { time: '22:00', equity: 10750 },
];

export default function EquityChart() {
  return (
    <div className="metric-card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-200">Equity Curve</h3>
        <span className="text-xs text-gray-500">24h — mock data</span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={MOCK_DATA} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis dataKey="time" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ backgroundColor: '#111827', border: '1px solid #1f2937', borderRadius: '6px', fontSize: '12px' }}
            labelStyle={{ color: '#9ca3af' }}
            itemStyle={{ color: '#3b82f6' }}
          />
          <Area type="monotone" dataKey="equity" stroke="#3b82f6" strokeWidth={2} fill="url(#equityGradient)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
