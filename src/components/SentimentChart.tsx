import React, { useEffect, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Loader2, Gauge, ThumbsUp, ThumbsDown, Minus } from 'lucide-react';
import { generateExpandedContent } from '../services/geminiService';

interface Props {
  keyword: string;
  context: string;
  isDarkMode: boolean; // 다크모드 Prop 추가
}

interface SentimentData {
  positive: number;
  negative: number;
  neutral: number;
  reason: string;
}

const COLORS = {
  positive: '#34C759', 
  neutral: '#8E8E93',  
  negative: '#FF3B30'  
};

const SentimentChart: React.FC<Props> = ({ keyword, context, isDarkMode }) => {
  const [data, setData] = useState<SentimentData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const analyzeSentiment = async () => {
      if (!keyword || !context) return;
      setLoading(true);

      try {
        const prompt = `
          Analyze the public sentiment regarding "${keyword}" based on the following context.
          
          [CONTEXT]
          ${context}

          [INSTRUCTION]
          1. Estimate the sentiment percentage breakdown: Positive, Negative, Neutral (Sum must be 100%).
          2. Provide a short "One-line Insight" explaining the dominant sentiment (in Korean).
          3. Output MUST be valid JSON only.

          [OUTPUT FORMAT]
          {
            "positive": 60,
            "negative": 30,
            "neutral": 10,
            "reason": "기술 혁신에 대한 기대감이 높으나, 가격 경쟁 심화가 우려됨"
          }
        `;

        // generateExpandedContent 함수가 services/geminiService에 있다고 가정
        const response = await generateExpandedContent(prompt, 'general', '');
        
        if (!isMounted) return;

        let jsonString = response.replace(/```json/g, '').replace(/```/g, '').trim();
        const firstBrace = jsonString.indexOf('{');
        const lastBrace = jsonString.lastIndexOf('}');
        
        if (firstBrace !== -1 && lastBrace !== -1) {
          const parsed = JSON.parse(jsonString.substring(firstBrace, lastBrace + 1));
          if (
            typeof parsed?.positive === "number" &&
            typeof parsed?.negative === "number" &&
            typeof parsed?.neutral === "number"
          ) {
            setData(parsed);
          }
        }
      } catch (e) {
        console.error("Sentiment Analysis Failed", e);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    analyzeSentiment();
    return () => { isMounted = false; };
  }, [keyword, context]);

  // 로딩 상태 UI
  if (loading) {
    return (
      <div className={`w-full rounded-[32px] p-8 border shadow-sm flex flex-col items-center justify-center gap-3 min-h-[200px] ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-100'}`}>
        <Loader2 className="animate-spin text-[#0071e3]" size={32} />
        <p className={`text-xs font-bold ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>🔍 여론 데이터를 분석하고 있습니다...</p>
      </div>
    );
  }

  if (!data) return null;

  const chartData = [
    { name: '긍정', value: data.positive, color: COLORS.positive },
    { name: '중립', value: data.neutral, color: COLORS.neutral },
    { name: '부정', value: data.negative, color: COLORS.negative },
  ];

  return (
    <div className={`w-full rounded-[32px] p-8 border shadow-sm space-y-6 transition-colors duration-300 ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-100'}`}>
      <div className="flex items-center justify-between">
        <h4 className={`text-lg font-black flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
          <Gauge className="text-[#0071e3]" size={24} /> 여론 감성 분석
        </h4>
        <span className={`text-[10px] font-bold px-2 py-1 rounded-lg ${isDarkMode ? 'bg-gray-800 text-gray-400' : 'bg-gray-50 text-gray-400'}`}>AI SENTIMENT</span>
      </div>

      <div className="flex flex-col md:flex-row items-center gap-8">
        {/* 왼쪽: 게이지 차트 (반원형) */}
        <div className="relative w-full" style={{ height: '250px' }}> 
           <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                startAngle={180}
                endAngle={0}
                innerRadius={60}
                outerRadius={80}
                paddingAngle={2}
                dataKey="value"
                stroke="none"
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip 
                formatter={(value: number) => `${value}%`} 
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
              />
            </PieChart>
          </ResponsiveContainer>
          {/* 중앙 점수 표시 */}
          <div className="absolute inset-0 flex flex-col items-center justify-end pb-2 pointer-events-none">
            <span className={`text-2xl font-black ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{data.positive}%</span>
            <span className="text-[10px] text-gray-400 font-bold">긍정 지수</span>
          </div>
        </div>

        {/* 오른쪽: 상세 데이터 및 코멘트 */}
        <div className="flex-1 space-y-4 w-full">
          {/* 막대 그래프 바 */}
          <div className={`flex h-4 rounded-full overflow-hidden w-full ${isDarkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
            <div style={{ width: `${data.positive}%`, background: COLORS.positive }} title="긍정" />
            <div style={{ width: `${data.neutral}%`, background: COLORS.neutral }} title="중립" />
            <div style={{ width: `${data.negative}%`, background: COLORS.negative }} title="부정" />
          </div>
          
          {/* 범례 */}
          <div className="flex justify-between text-xs font-bold text-gray-500">
            <div className="flex items-center gap-1"><ThumbsUp size={12} className="text-green-500"/> 긍정 {data.positive}%</div>
            <div className="flex items-center gap-1"><Minus size={12} className="text-gray-400"/> 중립 {data.neutral}%</div>
            <div className="flex items-center gap-1"><ThumbsDown size={12} className="text-red-500"/> 부정 {data.negative}%</div>
          </div>

          {/* AI 한줄 평 */}
          <div className={`p-4 rounded-2xl border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-100'}`}>
            <p className={`text-sm font-medium leading-relaxed ${isDarkMode ? 'text-gray-300' : 'text-gray-800'}`}>
              💡 <span className="font-bold">Insight:</span> {data.reason}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SentimentChart;