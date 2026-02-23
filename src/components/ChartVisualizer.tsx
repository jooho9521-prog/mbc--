import React, { useEffect, useState } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, Legend 
} from 'recharts';
import { Loader2, PieChart as PieIcon, BarChart as BarIcon } from 'lucide-react';
import { generateExpandedContent } from '../services/geminiService';

interface Props {
  analysisText: string;
  keyword: string;
  language: string;
}

interface ChartData {
  title: string;
  type: 'bar' | 'pie';
  data: { name: string; value: number; unit: string }[];
  summary: string;
}

const COLORS = ['#0071e3', '#34c759', '#ff9500', '#ff2d55', '#5856d6', '#af52de'];

const ChartVisualizer: React.FC<Props> = ({ analysisText, keyword, language }) => {
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const extractData = async () => {
      if (!analysisText) return;
      setLoading(true);

      try {
        const prompt = `
          Analyze the following market analysis text about "${keyword}" and extract numerical data for visualization.
          
          [INSTRUCTION]
          1. Find the most significant statistics (e.g., Market Share, Revenue Growth, Sales Volume).
          2. Choose the best chart type: 'pie' (for market share/percentages) or 'bar' (for growth/comparison).
          3. Extract the data into a JSON format.
          4. **CRITICAL**: The 'title', 'summary', 'unit', and 'data.name' MUST be translated into **${language}**.
          
          [TEXT DATA]
          ${analysisText}

          [OUTPUT FORMAT (JSON ONLY)]
          {
            "title": "Chart Title",
            "type": "bar" or "pie",
            "data": [
              { "name": "Category Name", "value": 123.4, "unit": "%" },
              ...
            ],
            "summary": "One line insight."
          }
        `;

        const response = await generateExpandedContent(prompt, 'sns', '');
        
        if (!isMounted) return;

        let jsonString = response.replace(/```json/g, '').replace(/```/g, '').trim();
        const firstBrace = jsonString.indexOf('{');
        const lastBrace = jsonString.lastIndexOf('}');
        
        if (firstBrace !== -1 && lastBrace !== -1) {
          jsonString = jsonString.substring(firstBrace, lastBrace + 1);
          const parsedData = JSON.parse(jsonString);
          if (parsedData && parsedData.data && parsedData.data.length > 0) {
            setChartData(parsedData);
          }
        }
      } catch (err) {
        console.error("Chart Error:", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    extractData();
    return () => { isMounted = false; };
  }, [analysisText, keyword, language]);

  if (loading) {
    return (
      <div className="w-full h-64 bg-gray-50 rounded-3xl border border-gray-100 flex flex-col items-center justify-center gap-3 animate-pulse mb-8">
        <Loader2 className="animate-spin text-[#0071e3]" size={32} />
        <p className="text-xs font-bold text-gray-400">📊 데이터 시각화 차트 생성 중...</p>
      </div>
    );
  }

  if (!chartData) return null;

  return (
    <div className="w-full bg-white rounded-3xl border border-gray-200 p-8 shadow-sm space-y-6 animate-in fade-in slide-in-from-bottom-4 mb-12">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-[#0071e3]/10 rounded-xl text-[#0071e3]">
            {chartData.type === 'pie' ? <PieIcon size={20} /> : <BarIcon size={20} />}
          </div>
          <div>
            <h4 className="font-bold text-gray-900 text-lg">{chartData.title}</h4>
            <p className="text-xs text-gray-500 font-medium">{chartData.summary}</p>
          </div>
        </div>
        <span className="px-3 py-1 bg-gray-100 rounded-lg text-[10px] font-bold text-gray-500 uppercase">
          AI GENERATED CHART
        </span>
      </div>

      <div className="w-full h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          {chartData.type === 'pie' ? (
            <PieChart>
              <Pie
                data={chartData.data}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={5}
                dataKey="value"
                nameKey="name" // [중요] 이름 키 지정
              >
                {chartData.data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              {/* [수정] 툴팁 포맷 변경: '수치' 대신 실제 항목 이름(name)을 표시 */}
              <Tooltip 
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                formatter={(value: number, name: string) => [`${value}${chartData.data[0].unit}`, name]}
              />
              <Legend verticalAlign="bottom" height={36} />
            </PieChart>
          ) : (
            <BarChart data={chartData.data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis 
                dataKey="name" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 12, fill: '#6b7280' }} 
                dy={10}
              />
              <YAxis 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 12, fill: '#6b7280' }} 
              />
              {/* [수정] 툴팁 포맷 변경 */}
              <Tooltip 
                cursor={{ fill: '#f3f4f6' }}
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                formatter={(value: number, name: string) => [`${value}${chartData.data[0].unit}`, name]}
              />
              <Bar dataKey="value" fill="#0071e3" radius={[6, 6, 0, 0]} barSize={40}>
                {chartData.data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default ChartVisualizer;