import React from 'react';
import { ExternalLink, Globe } from 'lucide-react';
import { NewsItem } from '../types';

interface NewsCardProps {
  item: NewsItem;
  keyword?: string; // [신규] 검색어 하이라이트를 위해 추가
}

// [신규] 형광펜 효과 컴포넌트
const HighlightedText = ({ text, keyword }: { text: string, keyword?: string }) => {
  if (!keyword || !text) return <>{text}</>;
  
  const parts = text.split(new RegExp(`(${keyword})`, 'gi'));
  
  return (
    <span>
      {parts.map((part, i) =>
        part.toLowerCase() === keyword.toLowerCase() ? (
          <span key={i} className="bg-[#fff6d1] text-gray-900 font-extrabold px-0.5 rounded border-b-2 border-[#ffd700] box-decoration-clone">
            {part}
          </span>
        ) : (
          part
        )
      )}
    </span>
  );
};

export const NewsCard: React.FC<NewsCardProps> = ({ item, keyword }) => {
  let domain = 'source';
  let faviconUrl = '';

  if (item.uri && item.uri !== '#') {
    try {
      const urlObj = new URL(item.uri);
      domain = urlObj.hostname.replace('www.', '');
      faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
    } catch (e) {
      console.error("Invalid URI for favicon:", item.uri);
    }
  }

  const handleOpenSource = () => {
    if (item.uri && item.uri !== '#') {
      window.open(item.uri, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div 
      className="bg-white border border-gray-100 rounded-3xl p-5 transition-all duration-300 hover:shadow-md group cursor-default hover:border-[#0071e3]/30"
    >
      <div className="flex gap-4">
        {/* 파비콘 영역 */}
        <div className="w-12 h-12 rounded-xl bg-gray-50 flex items-center justify-center shrink-0 overflow-hidden border border-gray-100 shadow-sm">
          {faviconUrl ? (
            <img 
              src={faviconUrl} 
              alt={item.source} 
              className="w-8 h-8 object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
                (e.target as HTMLImageElement).parentElement!.innerHTML = '<div class="text-gray-300"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20"/><path d="M2 12h20"/></svg></div>';
              }}
            />
          ) : (
             <div className="w-8 h-8 flex items-center justify-center text-gray-300">
               <Globe size={20} />
             </div>
          )}
        </div>

        <div className="flex-1 min-w-0 flex flex-col">
          {/* 소스명 */}
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest truncate">
              {item.source || domain}
            </span>
          </div>
          
          {/* 제목 (하이라이트 적용) */}
          <h4 className="text-[14px] font-bold text-gray-900 leading-tight line-clamp-2 tracking-tight mb-2 group-hover:text-[#0071e3] transition-colors cursor-pointer" onClick={handleOpenSource}>
            <HighlightedText text={item.title} keyword={keyword} />
          </h4>

          {/* [복구됨] 본문 요약 (하이라이트 적용) */}
          {item.snippet && (
            <p className="text-xs text-gray-500 line-clamp-2 mb-3 leading-relaxed">
              <HighlightedText text={item.snippet} keyword={keyword} />
            </p>
          )}

          {/* 하단 정보 및 버튼 */}
          <div className="flex items-center justify-between mt-auto pt-2 border-t border-gray-50">
            <div className="flex items-center gap-1.5 text-[9px] text-gray-400 font-bold truncate">
              <span className="truncate">{domain}</span>
              <span className="w-0.5 h-2 bg-gray-300 rounded-full"></span>
              <span>{item.date}</span>
            </div>
            
            <button 
              onClick={handleOpenSource}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-gray-50 hover:bg-[#0071e3] hover:text-white text-gray-600 rounded-full text-[10px] font-bold transition-all active:scale-95"
            >
              <span>원문보기</span>
              <ExternalLink size={10} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};