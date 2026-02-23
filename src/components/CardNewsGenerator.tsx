import React, { useRef, useEffect, useState } from 'react';
import { Download, Edit3, RefreshCw, Loader2, Palette, Database } from 'lucide-react';

interface Props {
  imageUrl: string;
  summary: string;
  headline: string;
  onHeadlineChange: (val: string) => void;
  onSummaryChange: (val: string) => void;
  isRegeneratingImage?: boolean;
  onShowToast?: (msg: string) => void;
  selectedCategory: string;
  setSelectedCategory: (cat: string) => void;
  selectedStyleId: number;
  setSelectedStyleId: (id: number) => void;
  onRegenerate: (prompt: string) => void;
}

const FONT_OPTIONS = [
  { name: '노토산스 KR', family: "'Noto Sans KR', sans-serif" },
  { name: '나눔고딕', family: "'Nanum Gothic', sans-serif" },
  { name: '프리텐다드', family: "'Pretendard', sans-serif" },
  { name: 'G마켓 산스', family: "'GmarketSansMedium', sans-serif" },
  { name: '에스코어 드림', family: "'S-CoreDream-4Regular', sans-serif" },
  { name: '검은고딕', family: "'Black Han Sans', sans-serif" },
  { name: 'IBM Plex Sans KR', family: "'IBM Plex Sans KR', sans-serif" },
  { name: '나눔명조', family: "'Nanum Myeongjo', serif" },
  { name: '본명조', family: "'Noto Serif KR', serif" },
  { name: '바탕체', family: "'Batang', serif" },
  { name: '송명', family: "'Song Myung', serif" },
  { name: '나눔손글씨 펜', family: "'Nanum Pen Script', cursive" },
  { name: '나눔손글씨 붓', family: "'Nanum Brush Script', cursive" },
  { name: '가비아 온해', family: "'Gaegu', cursive" },
  { name: '동글', family: "'Dongle', sans-serif" },
  { name: '배달의민족 주아', family: "'Jua', sans-serif" },
  { name: '배달의민족 도현', family: "'Do Hyeon', sans-serif" },
  { name: '배달의민족 연성', family: "'Yeon Sung', cursive" },
  { name: '고도체', family: "'Godo', sans-serif" },
  { name: '카페24 써라운드', family: "'Cafe24Ssurround', sans-serif" }
];

const CardNewsGenerator: React.FC<Props> = ({ 
  imageUrl, 
  summary, 
  headline, 
  onHeadlineChange, 
  onSummaryChange, 
  isRegeneratingImage, 
  onShowToast,
  selectedCategory,
  setSelectedCategory,
  selectedStyleId,
  setSelectedStyleId,
  onRegenerate
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [localWatermark, setLocalWatermark] = useState('');
  const [headlineSize, setHeadlineSize] = useState(80);
  const [bodySize, setBodySize] = useState(35); // 35px maintained
  const [selectedFont, setSelectedFont] = useState(FONT_OPTIONS[0].family);
  const [customPrompt, setCustomPrompt] = useState("");
  const [isPromptEdited, setIsPromptEdited] = useState(false);

  // Internal state management
  const [bodyText, setBodyText] = useState("");
  const [headlineText, setHeadlineText] = useState("");

  // Sync headline
  useEffect(() => {
    setHeadlineText(headline || ""); 
  }, [headline]);

  // Sync body text
  useEffect(() => {
    if (summary) {
      const formattedText = summary
        .replace(/(\d+\.\s)/g, '\n\n$1') 
        .replace(/\(출처.*?\)/g, '')
        .replace(/\[.*?\]/g, '')
        .trim();
      setBodyText(formattedText);
    } else {
      setBodyText("");
    }
  }, [summary]);

  useEffect(() => {
    if (headlineText && !isPromptEdited) {
      setCustomPrompt(`High quality minimalist cinematic scene related to: ${headlineText}`);
    }
  }, [headlineText, isPromptEdited]);

  const drawTextWithWrap = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) => {
    if (!text) return y;

    const paragraphs = text.split('\n');
    let currentY = y;

    paragraphs.forEach(paragraph => {
      // Reduce spacing for empty lines
      if (!paragraph.trim()) {
        currentY += lineHeight * 0.4;
        return;
      }

      const words = paragraph.split(' ');
      let line = '';
      
      for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + ' ';
        const metrics = ctx.measureText(testLine);
        const testWidth = metrics.width;
        
        if (testWidth > maxWidth && n > 0) {
          ctx.fillText(line, x, currentY);
          line = words[n] + ' ';
          currentY += lineHeight;
        } else {
          line = testLine;
        }
      }
      ctx.fillText(line, x, currentY);
      currentY += lineHeight;
    });
    
    return currentY;
  };

  const drawCardNewsOnCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = "anonymous"; 
    img.src = imageUrl;

    img.onload = () => {
      canvas.width = 1080;
      canvas.height = 1920;
      
      const baseScale = Math.max(canvas.width / img.width, canvas.height / img.height);
      const dw = img.width * baseScale;
      const dh = img.height * baseScale;
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
      
      const gradient = ctx.createLinearGradient(0, 0, 0, 1920);
      gradient.addColorStop(0, 'rgba(0,0,0,0.3)');
      gradient.addColorStop(0.4, 'rgba(0,0,0,0.6)');
      gradient.addColorStop(1, 'rgba(0,0,0,0.95)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 1080, 1920);

      ctx.fillStyle = 'white';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top'; 
      const maxWidth = 880;
      const startX = 100;

      // Draw Headline
      ctx.font = `bold ${headlineSize}px ${selectedFont}`;
      const displayHeadline = (headlineText || "제목 없음").replace(/[\*\#\[\]]/g, "").trim();
      
      // Start headline slightly higher
      let currentY = 220; 
      currentY = drawTextWithWrap(ctx, displayHeadline, startX, currentY, maxWidth, headlineSize * 1.3);

      ctx.fillStyle = '#0071e3';
      ctx.fillRect(startX, currentY + 30, 150, 8);

      // Draw Body
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.font = `500 ${bodySize}px ${selectedFont}`;
      
      // Adjust body start position
      currentY += 60;
      
      const displayBody = bodyText || "내용이 없습니다.";
      // Adjusted line height for 35px font
      drawTextWithWrap(ctx, displayBody, startX, currentY, maxWidth, bodySize * 1.35);

      // Draw Watermark
      ctx.font = `bold 28px ${selectedFont}`;
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText(localWatermark || "TrendPulse OSMU Intelligent Engine", startX, 1840);
      
      ctx.textAlign = 'right';
      ctx.fillText(new Date().toLocaleDateString('ko-KR'), 1080 - startX, 1840);
    };
  };

  useEffect(() => {
    if (imageUrl) {
      const timer = setTimeout(() => {
        drawCardNewsOnCanvas();
      }, 50); 
      return () => clearTimeout(timer);
    }
  }, [imageUrl, headlineText, bodyText, localWatermark, headlineSize, bodySize, selectedFont]);

  const handleDownload = () => {
    if (!canvasRef.current) return;
    const link = document.createElement('a');
    link.download = `TrendPulse_Card_${Date.now()}.png`;
    link.href = canvasRef.current.toDataURL('image/png', 1.0);
    link.click();
  };

  const handleSaveToLibrary = () => {
    if (!canvasRef.current) return;
    try {
      const dataUrl = canvasRef.current.toDataURL('image/png');
      const savedCards = JSON.parse(localStorage.getItem('saved_cards') || '[]');
      const newCard = {
        id: Date.now(),
        imageUrl: dataUrl,
        title: headlineText || "무제",
        date: new Date().toLocaleDateString('ko-KR'),
        summary: bodyText
      };
      localStorage.setItem('saved_cards', JSON.stringify([newCard, ...savedCards]));
      window.dispatchEvent(new Event('storage'));
      alert("✅ 카드뉴스가 보관함에 안전하게 저장되었습니다.");
      if (onShowToast) onShowToast("보관함 저장 완료");
    } catch (e) {
      console.error(e);
      alert("브라우저 저장소 용량이 부족하거나 오류가 발생했습니다.");
    }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-16">
      <div className="w-full lg:w-[420px] space-y-8">
        <div className="relative aspect-[9/16] rounded-[40px] overflow-hidden shadow-2xl border border-gray-100 bg-white apple-transition group">
          <canvas ref={canvasRef} className="w-full h-full object-contain" />
          {isRegeneratingImage && (
            <div className="absolute inset-0 bg-white/80 backdrop-blur-md flex flex-col items-center justify-center gap-4 z-20">
              <Loader2 className="animate-spin text-[#0071e3]" size={48} />
              <p className="text-gray-900 font-bold text-sm">이미지 스타일링 중...</p>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <button onClick={handleDownload} className="py-4 bg-gray-100 hover:bg-gray-200 text-gray-900 rounded-full font-bold text-sm transition-all flex items-center justify-center gap-2 active:scale-95">
            <Download size={18} /> PNG 저장
          </button>
          <button onClick={handleSaveToLibrary} className="py-4 bg-[#0071e3] hover:bg-[#0077ed] text-white rounded-full font-bold text-sm shadow-lg transition-all flex items-center justify-center gap-2 active:scale-95">
            <Database size={18} /> 보관함 저장
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-12">
        <div className="bg-white rounded-[32px] p-8 border border-gray-100 shadow-sm space-y-8">
          <div className="space-y-5">
            <div className="flex justify-between items-center">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2"><Edit3 size={14} /> 헤드라인 텍스트</label>
              <span className="text-[10px] font-bold text-[#0071e3]">SIZE: {headlineSize}px</span>
            </div>
            <input 
              type="text" 
              value={headlineText} 
              onChange={(e) => {
                setHeadlineText(e.target.value);
                onHeadlineChange(e.target.value);
              }} 
              className="w-full bg-gray-50 p-4 rounded-2xl border-none text-gray-900 font-bold text-lg focus:ring-2 focus:ring-[#0071e3]/20 outline-none" 
              placeholder="헤드라인을 입력하세요"
            />
            <input 
              type="range" min="20" max="150" value={headlineSize} 
              onChange={(e) => setHeadlineSize(parseInt(e.target.value))}
              className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-[#0071e3]"
            />
          </div>

          <div className="space-y-5">
            <div className="flex justify-between items-center">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2"><Edit3 size={14} /> 본문 요약 내용</label>
              <span className="text-[10px] font-bold text-[#0071e3]">SIZE: {bodySize}px</span>
            </div>
            <textarea 
              value={bodyText} 
              onChange={(e) => {
                const val = e.target.value;
                setBodyText(val);
                onSummaryChange(val);
              }} 
              className="w-full h-40 p-4 rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#0071e3]/20 whitespace-pre-wrap outline-none resize-none bg-gray-50 text-gray-700 text-sm leading-relaxed" 
              placeholder="본문 내용을 입력하세요..."
            />
            <input 
              type="range" min="10" max="80" value={bodySize} 
              onChange={(e) => setBodySize(parseInt(e.target.value))}
              className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-[#0071e3]"
            />
          </div>
        </div>

        <div className="bg-gray-50 rounded-[32px] p-8 space-y-8">
          <h4 className="text-sm font-bold text-gray-900 flex items-center gap-2"><Palette size={18} className="text-[#0071e3]" /> 상세 스타일링</h4>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-3">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">폰트 페이스</label>
              <select 
                value={selectedFont} 
                onChange={(e) => setSelectedFont(e.target.value)} 
                className="w-full bg-white rounded-xl p-3 text-sm focus:ring-2 focus:ring-[#0071e3]/20 border-none outline-none shadow-sm font-medium"
              >
                {FONT_OPTIONS.map(f => <option key={f.family} value={f.family}>{f.name}</option>)}
              </select>
            </div>
            <div className="space-y-3">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">워터마크 텍스트</label>
              <input 
                type="text" 
                placeholder="입력 시 하단에 표시됩니다"
                value={localWatermark} 
                onChange={(e) => setLocalWatermark(e.target.value)} 
                className="w-full bg-white p-3 rounded-xl border-none text-gray-600 text-sm outline-none shadow-sm" 
              />
            </div>
          </div>

          <div className="space-y-4 pt-4 border-t border-gray-200">
            <div className="flex justify-between items-center">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">배경 이미지 AI 프롬프트</label>
              <button 
                onClick={() => onRegenerate(customPrompt)} 
                disabled={isRegeneratingImage} 
                className="text-[10px] font-black text-[#0071e3] flex items-center gap-2 hover:bg-[#0071e3]/5 px-3 py-1.5 rounded-full transition-all disabled:opacity-50"
              >
                <RefreshCw size={12} className={isRegeneratingImage ? 'animate-spin' : ''} /> 
                스타일링 적용하기
              </button>
            </div>
            <textarea 
              value={customPrompt} 
              onChange={(e) => { setCustomPrompt(e.target.value); setIsPromptEdited(true); }} 
              className="w-full h-24 bg-white p-4 rounded-2xl border-none text-gray-700 text-xs leading-relaxed focus:ring-2 focus:ring-[#0071e3]/20 outline-none resize-none shadow-sm" 
              placeholder="원하는 배경 이미지를 영어로 묘사해보세요..."
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default CardNewsGenerator;