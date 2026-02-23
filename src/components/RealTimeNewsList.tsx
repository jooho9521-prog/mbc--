import React, { useEffect, useState } from 'react';
import { Globe, ExternalLink, Loader2, AlertCircle } from 'lucide-react';

interface GoogleSearchResult {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
}

interface Props {
  keyword: string;
}

const RealTimeNewsList: React.FC<Props> = ({ keyword }) => {
  const [news, setNews] = useState<GoogleSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 사용자님이 주신 실제 키 (하드코딩)
  const API_KEY = 'AIzaSyABvPp81DrEHHgQbdf7t58KCb3ddRvahwk';
  const CX_ID = '023f4c7f4a28a4dc8'; 

  useEffect(() => {
    const loadNews = async () => {
      // 키워드가 없으면 "최신 트렌드"로 검색
      const searchKeyword = keyword || "최신 트렌드";
      
      setLoading(true);
      setErrorMsg(null);

      try {
        console.log(`🔍 검색 시작: ${searchKeyword}`); // F12 콘솔에서 확인 가능
        
        const url = `https://www.googleapis.com/customsearch/v1?key=${API_KEY}&cx=${CX_ID}&q=${encodeURIComponent(searchKeyword)}&sort=date`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        console.log("📡 구글 API 응답:", data); // F12 콘솔에서 응답 확인 가능

        if (response.ok && data.items && data.items.length > 0) {
          setNews(data.items.slice(0, 4));
        } else if (data.error) {
          // 구글 API 에러 발생 시 (예: 하루 사용량 초과 등)
          setErrorMsg(`API 오류: ${data.error.message}`);
          setNews([]); 
        } else {
          setErrorMsg("검색 결과가 없습니다.");
          setNews([]);
        }
      } catch (error) {
        console.error("연결 실패:", error);
        setErrorMsg("서버 연결 실패");
        setNews([]);
      } finally {
        setLoading(false);
      }
    };

    loadNews();
  }, [keyword]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-6 text-gray-400 mt-8 bg-white rounded-3xl border border-gray-100">
        <Loader2 className="animate-spin mr-2" size={16} /> 구글 서버 통신 중...
      </div>
    );
  }

  // 에러가 있거나 뉴스가 없을 때 표시 (가짜 데이터 아님)
  if (errorMsg || news.length === 0) {
    return (
      <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 mt-12 no-print shadow-sm">
        <h3 className="text-[#1d1d1f] text-sm font-black mb-4 flex items-center gap-3">
          <Globe size={22} className="text-[#0071e3]" /> 실시간 팩트체크 (Google Search)
        </h3>
        <div className="p-4 bg-red-50 text-red-500 text-xs rounded-xl font-medium text-center">
          ⚠️ {errorMsg || "검색 결과를 불러오지 못했습니다."}
        </div>
      </div>
    );
  }

  // 실제 데이터가 있을 때만 렌더링
  return (
    <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 mt-12 no-print shadow-sm">
      <h3 className="text-[#1d1d1f] text-sm font-black mb-6 flex items-center gap-3">
        <Globe size={22} className="text-[#0071e3]" /> 실시간 팩트체크 (Google Search)
      </h3>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {news.map((item, idx) => (
          <a 
            key={idx} 
            href={item.link} 
            target="_blank" 
            rel="noopener noreferrer"
            className="group block p-5 rounded-2xl border border-gray-100 hover:border-[#0071e3]/30 hover:shadow-md transition-all bg-gray-50 hover:bg-white"
          >
            <div className="flex justify-between items-start gap-3">
              <h4 className="font-bold text-sm text-gray-800 line-clamp-2 group-hover:text-[#0071e3] transition-colors leading-snug">
                {item.title}
              </h4>
              <ExternalLink size={14} className="text-gray-400 shrink-0 mt-1" />
            </div>
            <p className="text-xs text-gray-500 mt-2 line-clamp-2 leading-relaxed">
              {item.snippet}
            </p>
            <div className="mt-3 flex items-center gap-2">
               <span className="text-[10px] text-gray-400 font-medium bg-white px-2 py-0.5 rounded border border-gray-100">
                 {item.displayLink}
               </span>
            </div>
          </a>
        ))}
      </div>
      <p className="text-[10px] text-gray-400 mt-4 text-center flex items-center justify-center gap-1">
        <AlertCircle size={10} /> 100% Google 실시간 API 검색 결과입니다.
      </p>
    </div>
  );
};

export default RealTimeNewsList;