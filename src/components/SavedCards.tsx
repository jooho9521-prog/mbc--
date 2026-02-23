import React, { useEffect, useState } from 'react';
import { Trash2, Search, Calendar, Tag, Grid, List, Download } from 'lucide-react';

interface SavedCard {
  id: number;
  imageUrl: string;
  title: string;
  date: string;
  summary: string;
  category?: string;
}

const SavedCards: React.FC = () => {
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  useEffect(() => {
    const loadCards = () => {
      try {
        const saved = localStorage.getItem('saved_cards');
        if (saved) {
          setCards(JSON.parse(saved));
        }
      } catch (e) {
        console.error("Failed to load cards", e);
      }
    };

    loadCards();
    window.addEventListener('storage', loadCards);
    return () => window.removeEventListener('storage', loadCards);
  }, []);

  // [수정됨] window.confirm 제거 (샌드박스 환경 오류 해결)
  const handleDelete = (id: number) => {
    // 확인 팝업 없이 즉시 삭제 처리
    const updatedCards = cards.filter(card => card.id !== id);
    setCards(updatedCards);
    localStorage.setItem('saved_cards', JSON.stringify(updatedCards));
  };

  const handleDownload = (card: SavedCard) => {
    const link = document.createElement('a');
    link.href = card.imageUrl;
    link.download = `TrendPulse_Card_${card.id}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredCards = cards.filter(card =>
    card.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (card.summary && card.summary.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-6 rounded-[24px] border border-gray-100 shadow-sm sticky top-0 z-10">
        <div className="relative w-full md:w-96 group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-[#0071e3] transition-colors" size={20} />
          <input
            type="text"
            placeholder="제목 또는 내용 검색..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-gray-50 border-none rounded-xl text-sm font-medium focus:ring-2 focus:ring-[#0071e3]/20 focus:bg-white outline-none transition-all"
          />
        </div>
        
        <div className="flex gap-2 bg-gray-50 p-1 rounded-xl">
            <button 
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-white text-[#0071e3] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
              title="갤러리 뷰"
            >
              <Grid size={20} />
            </button>
            <button 
              onClick={() => setViewMode('list')}
              className={`p-2 rounded-lg transition-all ${viewMode === 'list' ? 'bg-white text-[#0071e3] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
              title="리스트 뷰"
            >
              <List size={20} />
            </button>
        </div>
      </div>

      {filteredCards.length === 0 ? (
        <div className="py-32 text-center flex flex-col items-center gap-4">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center text-gray-400">
            <Search size={32} />
          </div>
          <p className="text-gray-400 font-medium">
            {searchTerm ? `"${searchTerm}"에 대한 검색 결과가 없습니다.` : "아직 저장된 카드뉴스가 없습니다."}
          </p>
        </div>
      ) : (
        <div className={viewMode === 'grid' ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8" : "space-y-4"}>
          {filteredCards.map((card) => (
            <div 
              key={card.id} 
              className={`group bg-white rounded-[24px] border border-gray-100 overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-300 ${viewMode === 'list' ? 'flex gap-6 p-4 items-center' : 'flex flex-col'}`}
            >
              <div className={`relative overflow-hidden ${viewMode === 'list' ? 'w-32 h-32 rounded-2xl shrink-0' : 'aspect-[9/16] w-full'}`}>
                <img 
                  src={card.imageUrl} 
                  alt={card.title} 
                  className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-500" 
                />
                
                {viewMode === 'grid' && (
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex flex-col justify-end p-4 opacity-0 group-hover:opacity-100 gap-2">
                    <div className="flex justify-end gap-2">
                      <button 
                        onClick={() => handleDownload(card)}
                        className="p-3 bg-white/90 backdrop-blur-md text-gray-700 rounded-full hover:bg-white hover:text-[#0071e3] transition-all shadow-lg transform translate-y-4 group-hover:translate-y-0"
                        title="다운로드"
                      >
                        <Download size={18} />
                      </button>
                      <button 
                        onClick={() => handleDelete(card.id)}
                        className="p-3 bg-white/90 backdrop-blur-md text-red-500 rounded-full hover:bg-red-500 hover:text-white transition-all shadow-lg transform translate-y-4 group-hover:translate-y-0"
                        title="삭제"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className={`flex flex-col ${viewMode === 'list' ? 'flex-1 py-2' : 'p-6'}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-1 bg-blue-50 text-blue-600 text-[10px] font-bold rounded-md uppercase flex items-center gap-1">
                    <Tag size={10} /> {card.category || 'CARD NEWS'}
                  </span>
                  <span className="text-[10px] text-gray-400 font-medium flex items-center gap-1">
                    <Calendar size={10} /> {card.date}
                  </span>
                </div>
                
                <h3 className="font-bold text-base text-gray-900 leading-tight mb-2 line-clamp-2 group-hover:text-[#0071e3] transition-colors">
                  {card.title}
                </h3>
                
                {viewMode === 'list' && (
                  <p className="text-xs text-gray-500 line-clamp-2 mb-2 flex-1">
                    {card.summary}
                  </p>
                )}

                {viewMode === 'list' && (
                   <div className="flex justify-end mt-auto gap-2">
                      <button 
                        onClick={() => handleDownload(card)}
                        className="flex items-center gap-1 text-xs font-bold text-gray-500 hover:text-[#0071e3] hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        <Download size={14} /> 다운로드
                      </button>
                      <button 
                        onClick={() => handleDelete(card.id)}
                        className="flex items-center gap-1 text-xs font-bold text-gray-400 hover:text-red-500 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        <Trash2 size={14} /> 삭제
                      </button>
                   </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SavedCards;