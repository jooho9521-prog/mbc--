
import React from 'react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';

interface TrendChartProps {
  score: number;
}

export const TrendChart: React.FC<TrendChartProps> = ({ score }) => {
  // Generate dummy trend data culminating in the current score
  const data = [
    { name: '4주 전', value: Math.max(0, score - 30) },
    { name: '3주 전', value: Math.max(0, score - 15) },
    { name: '2주 전', value: Math.max(0, score - 22) },
    { name: '현재', value: score },
  ];

  return (
    <div className="h-64 w-full bg-slate-800/50 p-4 rounded-2xl border border-slate-700/50 shadow-inner">
      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">트렌드 모멘텀 지수</h3>
      <ResponsiveContainer width="100%" height="80%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4}/>
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
          <XAxis dataKey="name" stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} />
          <YAxis hide domain={[0, 100]} />
          <Tooltip 
            contentStyle={{ backgroundColor: '#1e293b', borderRadius: '12px', border: '1px solid #334155', color: '#fff' }}
            itemStyle={{ color: '#818cf8' }}
          />
          <Area 
            type="monotone" 
            dataKey="value" 
            stroke="#6366f1" 
            strokeWidth={4}
            fillOpacity={1} 
            fill="url(#colorValue)" 
            animationDuration={1500}
          />
        </AreaChart>
      </ResponsiveContainer>
      <div className="flex justify-between mt-2 text-[10px] font-bold text-slate-500">
        <span className="uppercase tracking-tighter">최근 4주 추이</span>
        <span className="text-indigo-400">현재 스코어: {score}pt</span>
      </div>
    </div>
  );
};
